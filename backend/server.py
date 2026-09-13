from fastapi import FastAPI, APIRouter, HTTPException, Header, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
from pathlib import Path
from urllib.parse import urlsplit
from pydantic import BaseModel, Field, ConfigDict, BeforeValidator, field_validator
from typing import List, Optional, Annotated
from datetime import datetime, timezone

from brochure import build_pdf
from invoice_admin import initialize_invoice_admin, router as invoice_admin_router, set_database_provider

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
ADMIN_KEY = os.environ['ADMIN_KEY']

app = FastAPI(title="Suvi Interior API")
api_router = APIRouter(prefix="/api")


def _current_invoice_db():
    # Resolve the module global at call time so local launchers can replace server.db before startup.
    return db


set_database_provider(_current_invoice_db)

PyObjectId = Annotated[str, BeforeValidator(str)]

PROJECT_TYPES = [
    "Full Home Interior",
    "Modular Kitchen",
    "Living Room",
    "Bedroom",
    "Furniture",
    "TV Unit",
    "Other",
]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True, exclude_none=True)
        data.pop("_id", None)
        return data

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)


class EnquiryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=7, max_length=20)
    email: Optional[str] = Field(default=None, max_length=160)
    project_type: str
    budget: Optional[str] = Field(default=None, max_length=120)
    requirement: Optional[str] = Field(default=None, max_length=300)
    message: Optional[str] = Field(default=None, max_length=2000)
    source_page: Optional[str] = Field(default=None, max_length=200)

    @field_validator("phone")
    @classmethod
    def phone_digits(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v)
        if len(digits) < 10 or len(digits) > 13:
            raise ValueError("Please enter a valid phone number")
        return v.strip()

    @field_validator("email")
    @classmethod
    def email_shape(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v.strip() == "":
            return None
        v = v.strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Please enter a valid email address")
        return v

    @field_validator("project_type")
    @classmethod
    def project_type_allowed(cls, v: str) -> str:
        if v not in PROJECT_TYPES:
            raise ValueError("Please choose a project type")
        return v


class Enquiry(EnquiryCreate, BaseDocument):
    status: str = "new"
    created_at: str


@api_router.get("/health")
async def health():
    return {"status": "ok", "service": "suvi-interior"}


@api_router.get("/enquiries/project-types")
async def project_types():
    return {"project_types": PROJECT_TYPES}


@api_router.post("/enquiries", response_model=Enquiry, response_model_by_alias=False, status_code=201)
async def create_enquiry(payload: EnquiryCreate):
    enquiry = Enquiry(
        **payload.model_dump(),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    result = await db.enquiries.insert_one(enquiry.to_mongo())
    doc = await db.enquiries.find_one({"_id": result.inserted_id})
    return Enquiry.from_mongo(doc)


@api_router.get("/enquiries", response_model=List[Enquiry], response_model_by_alias=False)
async def list_enquiries(x_admin_key: Optional[str] = Header(default=None)):
    if x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")
    docs = await db.enquiries.find({}).sort("created_at", -1).to_list(500)
    return [Enquiry.from_mongo(d) for d in docs]


_pdf_cache: dict = {}


@api_router.get("/brochure.pdf")
async def brochure_pdf():
    if "bytes" not in _pdf_cache:
        _pdf_cache["bytes"] = await run_in_threadpool(build_pdf)
    return Response(
        content=_pdf_cache["bytes"],
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="Suvi-Interior-Brochure.pdf"', "Cache-Control": "public, max-age=3600"},
    )


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.exception_handler(RequestValidationError)
async def request_validation_error(request: Request, exc: RequestValidationError):
    if not request.url.path.startswith("/api/v1/admin"):
        return await request_validation_exception_handler(request, exc)
    errors = [
        {
            "field": ".".join(str(part) for part in error.get("loc", [])[1:]),
            "message": error.get("msg", "Invalid value").removeprefix("Value error, "),
            "type": error.get("type", "validation_error"),
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=400,
        content={
            "detail": {
                "code": "validation_error",
                "message": "Please correct the highlighted fields",
                "errors": errors,
            }
        },
    )


def _parse_cors_origins(raw: str) -> tuple[list[str], bool]:
    configured = []
    for candidate in raw.split(','):
        candidate = candidate.strip()
        if not candidate:
            continue
        if candidate == '*':
            return ['*'], False
        candidate = candidate.rstrip('/')
        try:
            parsed = urlsplit(candidate)
            port = parsed.port
        except ValueError:
            logger.warning("Ignoring malformed CORS origin %r; configure exact http(s) origins only", candidate)
            continue
        if (
            parsed.scheme not in {'http', 'https'}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            logger.warning("Ignoring invalid CORS origin %r; configure exact http(s) origins only", candidate)
            continue
        host = f"[{parsed.hostname}]" if ':' in parsed.hostname else parsed.hostname
        normalized = f"{parsed.scheme.lower()}://{host}{f':{port}' if port else ''}"
        if normalized not in configured:
            configured.append(normalized)
    return configured, bool(configured)


app.include_router(api_router)
app.include_router(invoice_admin_router)

cors_origins, cors_credentials = _parse_cors_origins(os.environ.get('CORS_ORIGINS', '*'))
app.add_middleware(
    CORSMiddleware,
    allow_credentials=cors_credentials,
    allow_origins=cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "X-Admin-Key", "X-CSRF-Token"],
)


@app.on_event("startup")
async def startup_invoice_admin():
    # The provider reads the current global, including a mock/replacement installed after import.
    await initialize_invoice_admin()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
