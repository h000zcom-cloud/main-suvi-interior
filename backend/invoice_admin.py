from __future__ import annotations

import copy
import hashlib
import hmac
import inspect
import logging
import os
import re
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Annotated, Any, Callable, Literal, Optional

import bcrypt
from bson import ObjectId
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

try:
    from invoice_pdf import SignedQrEncodingError, preflight_signed_qr_data, render_invoice_pdf
    from quotation_pdf import render_quotation_pdf
except ImportError:  # Supports package-style imports in tooling.
    from .invoice_pdf import SignedQrEncodingError, preflight_signed_qr_data, render_invoice_pdf
    from .quotation_pdf import render_quotation_pdf

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["invoice-admin"])

DatabaseProvider = Callable[[], Any]
_db_provider: DatabaseProvider | None = None

SESSION_COOKIE = "suvi_invoice_admin_session"
SESSION_HOURS_DEFAULT = 12
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_FAILURES = 5
_LOGIN_FAILURES: dict[str, deque[float]] = {}
_LOGIN_FAILURES_LOCK = threading.Lock()

MONEY_QUANTUM = Decimal("0.01")
ZERO = Decimal("0.00")
MAX_MONEY = Decimal("9999999999.99")
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_LOGIN_THROTTLE_KEYS = 2048
BUSINESS_TIMEZONE_NAME = "Asia/Kolkata"
BUSINESS_TIMEZONE = timezone(timedelta(hours=5, minutes=30), name="IST")
BUSINESS_UTC_OFFSET = "+05:30"

GST_REGISTRATION_MODES = ("not_configured", "unregistered", "regular", "composition")
ISSUABLE_GST_REGISTRATION_MODES = frozenset({"unregistered", "regular", "composition"})
GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
PAN_RE = re.compile(r"^[A-Z]{5}\d{4}[A-Z]$")
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
PINCODE_RE = re.compile(r"^[1-9]\d{5}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UPI_RE = re.compile(r"^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$")
INVOICE_PREFIX_RE = re.compile(r"^[A-Z0-9-]{1,12}$")

INDIAN_STATES = [
    {"code": "01", "name": "Jammu and Kashmir"},
    {"code": "02", "name": "Himachal Pradesh"},
    {"code": "03", "name": "Punjab"},
    {"code": "04", "name": "Chandigarh"},
    {"code": "05", "name": "Uttarakhand"},
    {"code": "06", "name": "Haryana"},
    {"code": "07", "name": "Delhi"},
    {"code": "08", "name": "Rajasthan"},
    {"code": "09", "name": "Uttar Pradesh"},
    {"code": "10", "name": "Bihar"},
    {"code": "11", "name": "Sikkim"},
    {"code": "12", "name": "Arunachal Pradesh"},
    {"code": "13", "name": "Nagaland"},
    {"code": "14", "name": "Manipur"},
    {"code": "15", "name": "Mizoram"},
    {"code": "16", "name": "Tripura"},
    {"code": "17", "name": "Meghalaya"},
    {"code": "18", "name": "Assam"},
    {"code": "19", "name": "West Bengal"},
    {"code": "20", "name": "Jharkhand"},
    {"code": "21", "name": "Odisha"},
    {"code": "22", "name": "Chhattisgarh"},
    {"code": "23", "name": "Madhya Pradesh"},
    {"code": "24", "name": "Gujarat"},
    {"code": "26", "name": "Dadra and Nagar Haveli and Daman and Diu"},
    {"code": "27", "name": "Maharashtra"},
    {"code": "29", "name": "Karnataka"},
    {"code": "30", "name": "Goa"},
    {"code": "31", "name": "Lakshadweep"},
    {"code": "32", "name": "Kerala"},
    {"code": "33", "name": "Tamil Nadu"},
    {"code": "34", "name": "Puducherry"},
    {"code": "35", "name": "Andaman and Nicobar Islands"},
    {"code": "36", "name": "Telangana"},
    {"code": "37", "name": "Andhra Pradesh"},
    {"code": "38", "name": "Ladakh"},
]

STATE_NAMES_BY_CODE = {item["code"]: item["name"] for item in INDIAN_STATES}


def _normalize_gst_registration_mode(value: Any) -> str:
    return str(value or "").strip().casefold()


def _gstin_checksum_character(value: str) -> str:
    factor = 2
    total = 0
    for character in reversed(value):
        code_point = GSTIN_ALPHABET.index(character)
        addend = factor * code_point
        total += (addend // len(GSTIN_ALPHABET)) + (addend % len(GSTIN_ALPHABET))
        factor = 1 if factor == 2 else 2
    return GSTIN_ALPHABET[(len(GSTIN_ALPHABET) - (total % len(GSTIN_ALPHABET))) % len(GSTIN_ALPHABET)]


def _normalize_and_validate_gstin(value: str) -> str:
    normalized = value.upper()
    if not normalized:
        return normalized
    if not GSTIN_RE.fullmatch(normalized):
        raise ValueError("gstin must be a valid 15-character GSTIN")
    if normalized[:2] not in STATE_NAMES_BY_CODE:
        raise ValueError("gstin state prefix must be a current Indian state or union territory code")
    if normalized[-1] != _gstin_checksum_character(normalized[:-1]):
        raise ValueError("gstin checksum is invalid")
    return normalized


def _validate_gstin_state_prefix(gstin: str, state_code: str, *, address_field: str) -> None:
    if gstin and state_code and gstin[:2] != state_code:
        raise ValueError(f"gstin state prefix must match {address_field}")


def _validate_state_pair(state: str, state_code: str, *, required: bool = False) -> None:
    if required and (not state or not state_code):
        raise ValueError("state and state_code are required")
    if not state_code:
        return
    expected = STATE_NAMES_BY_CODE.get(state_code)
    if expected is None:
        raise ValueError("state_code must be a current Indian state or union territory code")
    if state and state.casefold() != expected.casefold():
        raise ValueError(f"state must be '{expected}' for state_code {state_code}")


COMMON_UNITS = ["NOS", "PCS", "SET", "LOT", "JOB", "SQFT", "SQM", "MTR", "HRS", "DAYS"]
COMMON_GST_RATES = ["0.00", "0.25", "3.00", "5.00", "12.00", "18.00", "28.00"]
PAYMENT_METHODS = ["cash", "bank_transfer", "upi", "cheque", "card", "other"]
INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"]

DEFAULT_BUSINESS_SETTINGS = {
    "display_name": "Suvi Interior",
    "trade_name": "Suvi Interior",
    "legal_name": "",
    "address": {
        "line1": "Shop No. G2, Pandhari Mala",
        "line2": "273, Shree Kulswamini Business Centre",
        "line3": "10, Ambad–Uttam Nagar Road, Opp. Rajat Park",
        "city": "Nashik",
        "state": "Maharashtra",
        "state_code": "27",
        "pincode": "422010",
        "country": "India",
    },
    "phone": "+91 97020 39381",
    "email": "",
    "website": "",
    "gstin": "",
    "pan": "",
    "gst_registration_mode": "not_configured",
    "invoice_prefix": "INV",
    "default_due_days": 0,
    "default_terms": "",
    "default_notes": "",
    "round_to_rupee": False,
    "e_invoice_applicable": False,
    "e_invoice_applicability_note": "",
    "bank": {
        "account_name": "",
        "bank_name": "",
        "account_number": "",
        "branch": "",
        "ifsc": "",
    },
    "upi_id": "",
    "authorised_signatory": "",
    "signature": "",
}


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LoginInput(APIModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=512)


class AddressInput(APIModel):
    line1: str = Field(default="", max_length=240)
    line2: str = Field(default="", max_length=240)
    line3: str = Field(default="", max_length=240)
    city: str = Field(default="", max_length=120)
    state: str = Field(default="", max_length=120)
    state_code: str = Field(default="", max_length=2)
    pincode: str = Field(default="", max_length=6)
    country: str = Field(default="India", max_length=80)

    @field_validator("state_code")
    @classmethod
    def validate_state_code(cls, value: str) -> str:
        if value and not re.fullmatch(r"\d{2}", value):
            raise ValueError("state_code must contain two digits")
        return value

    @field_validator("pincode")
    @classmethod
    def validate_pincode(cls, value: str) -> str:
        if value and not PINCODE_RE.fullmatch(value):
            raise ValueError("pincode must be a valid six-digit Indian PIN code")
        return value

    @model_validator(mode="after")
    def validate_state(self) -> "AddressInput":
        _validate_state_pair(self.state, self.state_code)
        return self


class BankDetailsInput(APIModel):
    account_name: str = Field(default="", max_length=160)
    bank_name: str = Field(default="", max_length=160)
    account_number: str = Field(default="", max_length=40)
    branch: str = Field(default="", max_length=160)
    ifsc: str = Field(default="", max_length=11)

    @field_validator("ifsc")
    @classmethod
    def validate_ifsc(cls, value: str) -> str:
        value = value.upper()
        if value and not IFSC_RE.fullmatch(value):
            raise ValueError("ifsc must be a valid 11-character IFSC")
        return value


class BusinessSettingsInput(APIModel):
    display_name: str = Field(min_length=1, max_length=160)
    trade_name: str = Field(min_length=1, max_length=160)
    legal_name: str = Field(default="", max_length=200)
    address: AddressInput
    phone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=254)
    website: str = Field(default="", max_length=300)
    gstin: str = Field(default="", max_length=15)
    pan: str = Field(default="", max_length=10)
    gst_registration_mode: Literal["not_configured", "unregistered", "regular", "composition"] = "not_configured"
    invoice_prefix: str = Field(default="INV", min_length=1, max_length=12)
    default_due_days: int = Field(default=0, ge=0, le=365)
    default_terms: str = Field(default="", max_length=5000)
    default_notes: str = Field(default="", max_length=5000)
    round_to_rupee: bool = False
    e_invoice_applicable: bool = False
    e_invoice_applicability_note: str = Field(default="", max_length=1000)
    bank: BankDetailsInput = Field(default_factory=BankDetailsInput)
    upi_id: str = Field(default="", max_length=321)
    authorised_signatory: str = Field(default="", max_length=160)
    signature: str = Field(default="", max_length=160)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        if value:
            digits = re.sub(r"\D", "", value)
            if not 7 <= len(digits) <= 15:
                raise ValueError("phone must contain between 7 and 15 digits")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.lower()
        if value and not EMAIL_RE.fullmatch(value):
            raise ValueError("email must be a valid email address")
        return value

    @field_validator("website")
    @classmethod
    def validate_website(cls, value: str) -> str:
        if value and not re.fullmatch(r"https?://[^\s]+", value, flags=re.IGNORECASE):
            raise ValueError("website must be an absolute http or https URL")
        return value

    @field_validator("gstin")
    @classmethod
    def validate_gstin(cls, value: str) -> str:
        return _normalize_and_validate_gstin(value)

    @field_validator("pan")
    @classmethod
    def validate_pan(cls, value: str) -> str:
        value = value.upper()
        if value and not PAN_RE.fullmatch(value):
            raise ValueError("pan must be a valid 10-character PAN")
        return value

    @field_validator("invoice_prefix")
    @classmethod
    def validate_invoice_prefix(cls, value: str) -> str:
        value = value.upper()
        if not INVOICE_PREFIX_RE.fullmatch(value):
            raise ValueError("invoice_prefix may contain only A-Z, 0-9 and hyphens")
        return value

    @field_validator("upi_id")
    @classmethod
    def validate_upi(cls, value: str) -> str:
        if value and not UPI_RE.fullmatch(value):
            raise ValueError("upi_id must be a valid UPI identifier")
        return value

    @model_validator(mode="after")
    def validate_tax_identity_consistency(self) -> "BusinessSettingsInput":
        _validate_gstin_state_prefix(
            self.gstin,
            self.address.state_code,
            address_field="the business address state_code",
        )
        return self


class CustomerInput(APIModel):
    customer_type: Literal["business", "individual"]
    legal_name: str = Field(default="", max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    gstin: str = Field(default="", max_length=15)
    pan: str = Field(default="", max_length=10)
    contact_person: str = Field(default="", max_length=160)
    phone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=254)
    billing_address: AddressInput
    shipping_same_as_billing: bool = True
    shipping_address: AddressInput | None = None
    notes: str = Field(default="", max_length=5000)
    active: bool = True

    @field_validator("gstin")
    @classmethod
    def validate_gstin(cls, value: str) -> str:
        return _normalize_and_validate_gstin(value)

    @field_validator("pan")
    @classmethod
    def validate_pan(cls, value: str) -> str:
        value = value.upper()
        if value and not PAN_RE.fullmatch(value):
            raise ValueError("pan must be a valid 10-character PAN")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.lower()
        if value and not EMAIL_RE.fullmatch(value):
            raise ValueError("email must be a valid email address")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        if value:
            digits = re.sub(r"\D", "", value)
            if not 7 <= len(digits) <= 15:
                raise ValueError("phone must contain between 7 and 15 digits")
        return value

    @model_validator(mode="after")
    def validate_addresses(self) -> "CustomerInput":
        if not self.shipping_same_as_billing and self.shipping_address is None:
            raise ValueError("shipping_address is required when shipping_same_as_billing is false")
        _validate_gstin_state_prefix(
            self.gstin,
            self.billing_address.state_code,
            address_field="billing_address.state_code",
        )
        return self


class CatalogueItemInput(APIModel):
    item_type: Literal["goods", "service"]
    name: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=3000)
    hsn_sac: str = Field(default="", max_length=16)
    unit: str = Field(default="NOS", min_length=1, max_length=24)
    rate: Decimal = Field(ge=ZERO, le=MAX_MONEY, max_digits=14, decimal_places=4)
    gst_rate: Decimal = Field(ge=ZERO, le=Decimal("100"), max_digits=7, decimal_places=4)
    active: bool = True

    @field_validator("rate", "gst_rate")
    @classmethod
    def validate_decimal(cls, value: Decimal) -> Decimal:
        if not value.is_finite():
            raise ValueError("decimal values must be finite")
        return value

    @field_validator("hsn_sac")
    @classmethod
    def validate_hsn_sac(cls, value: str) -> str:
        value = value.upper().replace(" ", "")
        if value and not re.fullmatch(r"[A-Z0-9]{2,16}", value):
            raise ValueError("hsn_sac may contain only letters and digits")
        return value

    @field_validator("unit")
    @classmethod
    def normalize_unit(cls, value: str) -> str:
        return value.upper()


class InvoiceCustomerSnapshot(APIModel):
    customer_id: str | None = Field(default=None, max_length=24)
    customer_type: Literal["business", "individual"]
    legal_name: str = Field(default="", max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    gstin: str = Field(default="", max_length=15)
    pan: str = Field(default="", max_length=10)
    contact_person: str = Field(default="", max_length=160)
    phone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=254)
    billing_address: AddressInput
    shipping_same_as_billing: bool = True
    shipping_address: AddressInput | None = None

    @field_validator("customer_id")
    @classmethod
    def validate_customer_id(cls, value: str | None) -> str | None:
        if value is not None and not ObjectId.is_valid(value):
            raise ValueError("customer_id must be a valid ObjectId")
        return value

    @field_validator("gstin")
    @classmethod
    def validate_gstin(cls, value: str) -> str:
        return _normalize_and_validate_gstin(value)

    @field_validator("pan")
    @classmethod
    def validate_pan(cls, value: str) -> str:
        value = value.upper()
        if value and not PAN_RE.fullmatch(value):
            raise ValueError("pan must be a valid 10-character PAN")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.lower()
        if value and not EMAIL_RE.fullmatch(value):
            raise ValueError("email must be a valid email address")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        if value:
            digits = re.sub(r"\D", "", value)
            if not 7 <= len(digits) <= 15:
                raise ValueError("phone must contain between 7 and 15 digits")
        return value

    @model_validator(mode="after")
    def validate_shipping(self) -> "InvoiceCustomerSnapshot":
        if not self.shipping_same_as_billing and self.shipping_address is None:
            raise ValueError("shipping_address is required when shipping_same_as_billing is false")
        _validate_gstin_state_prefix(
            self.gstin,
            self.billing_address.state_code,
            address_field="billing_address.state_code",
        )
        return self


class StateReference(APIModel):
    state: str = Field(min_length=1, max_length=120)
    state_code: str = Field(min_length=2, max_length=2)

    @field_validator("state_code")
    @classmethod
    def validate_state_code(cls, value: str) -> str:
        if not re.fullmatch(r"\d{2}", value):
            raise ValueError("state_code must contain two digits")
        return value

    @model_validator(mode="after")
    def validate_state(self) -> "StateReference":
        _validate_state_pair(self.state, self.state_code, required=True)
        return self


class InvoiceLineInput(APIModel):
    item_id: str | None = Field(default=None, max_length=24)
    item_type: Literal["goods", "service"]
    name: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=3000)
    hsn_sac: str = Field(default="", max_length=16)
    unit: str = Field(default="NOS", min_length=1, max_length=24)
    quantity: Decimal = Field(gt=ZERO, le=Decimal("1000000"), max_digits=14, decimal_places=4)
    unit_rate: Decimal = Field(ge=ZERO, le=MAX_MONEY, max_digits=14, decimal_places=4)
    discount_type: Literal["none", "percent", "fixed"] = "none"
    discount_value: Decimal = Field(default=ZERO, ge=ZERO, le=MAX_MONEY, max_digits=14, decimal_places=4)
    gst_rate: Decimal = Field(default=ZERO, ge=ZERO, le=Decimal("100"), max_digits=7, decimal_places=4)

    @field_validator("item_id")
    @classmethod
    def validate_item_id(cls, value: str | None) -> str | None:
        if value is not None and not ObjectId.is_valid(value):
            raise ValueError("item_id must be a valid ObjectId")
        return value

    @field_validator("quantity", "unit_rate", "discount_value", "gst_rate")
    @classmethod
    def validate_decimal(cls, value: Decimal) -> Decimal:
        if not value.is_finite():
            raise ValueError("decimal values must be finite")
        return value

    @field_validator("hsn_sac")
    @classmethod
    def normalize_hsn_sac(cls, value: str) -> str:
        value = value.upper().replace(" ", "")
        if value and not re.fullmatch(r"[A-Z0-9]{2,16}", value):
            raise ValueError("hsn_sac may contain only letters and digits")
        return value

    @field_validator("unit")
    @classmethod
    def normalize_unit(cls, value: str) -> str:
        return value.upper()

    @model_validator(mode="after")
    def validate_discount(self) -> "InvoiceLineInput":
        if self.discount_type == "none" and self.discount_value != ZERO:
            raise ValueError("discount_value must be zero when discount_type is none")
        if self.discount_type == "percent" and self.discount_value > Decimal("100"):
            raise ValueError("percent discount cannot exceed 100")
        return self


class InvoiceDraftInput(APIModel):
    customer_snapshot: InvoiceCustomerSnapshot
    invoice_date: date
    due_date: date | None = None
    place_of_supply: StateReference
    lines: list[InvoiceLineInput] = Field(min_length=1, max_length=200)
    project_reference: str = Field(default="", max_length=240)
    po_reference: str = Field(default="", max_length=240)
    reverse_charge: bool = False
    tax_mode: Literal["auto", "no_tax"] = "auto"
    notes: str = Field(default="", max_length=5000)
    terms: str = Field(default="", max_length=5000)
    post_tax_adjustment_label: str = Field(default="", max_length=160)
    post_tax_adjustment_amount: Decimal = Field(default=ZERO, ge=-MAX_MONEY, le=MAX_MONEY, max_digits=14, decimal_places=2)

    @field_validator("post_tax_adjustment_amount")
    @classmethod
    def validate_adjustment(cls, value: Decimal) -> Decimal:
        if not value.is_finite():
            raise ValueError("post_tax_adjustment_amount must be finite")
        return value

    @model_validator(mode="after")
    def validate_dates_and_adjustment(self) -> "InvoiceDraftInput":
        if self.due_date is not None and self.due_date < self.invoice_date:
            raise ValueError("due_date cannot be earlier than invoice_date")
        if self.post_tax_adjustment_amount != ZERO and not self.post_tax_adjustment_label:
            raise ValueError("post_tax_adjustment_label is required for a non-zero adjustment")
        return self


class IssueInvoiceInput(APIModel):
    expected_revision: int = Field(ge=1, le=MAX_SAFE_INTEGER)


class DuplicateInvoiceInput(APIModel):
    invoice_date: date | None = None
    due_date: date | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "DuplicateInvoiceInput":
        if self.invoice_date and self.due_date and self.due_date < self.invoice_date:
            raise ValueError("due_date cannot be earlier than invoice_date")
        return self


class CancelInvoiceInput(APIModel):
    reason: str = Field(min_length=2, max_length=1000)


class PaymentInput(APIModel):
    amount: Decimal = Field(gt=ZERO, le=MAX_MONEY, max_digits=14, decimal_places=2)
    payment_date: date
    method: Literal["cash", "bank_transfer", "upi", "cheque", "card", "other"]
    reference: str = Field(default="", max_length=240)
    notes: str = Field(default="", max_length=2000)
    tds_withheld_amount: Decimal = Field(default=ZERO, ge=ZERO, le=MAX_MONEY, max_digits=14, decimal_places=2)

    @field_validator("amount", "tds_withheld_amount")
    @classmethod
    def validate_money(cls, value: Decimal) -> Decimal:
        if not value.is_finite():
            raise ValueError("payment amounts must be finite")
        return value


class EInvoiceMetadataInput(APIModel):
    irn: str = Field(default="", max_length=64)
    ack_number: str = Field(default="", max_length=30)
    ack_date: date | None = None
    signed_qr_data: str = Field(default="", max_length=4096)

    @field_validator("irn")
    @classmethod
    def validate_irn(cls, value: str) -> str:
        value = value.upper()
        if value and not re.fullmatch(r"[A-F0-9]{64}", value):
            raise ValueError("irn must be a 64-character hexadecimal value")
        return value

    @field_validator("ack_number")
    @classmethod
    def validate_ack_number(cls, value: str) -> str:
        if value and not re.fullmatch(r"[A-Za-z0-9/-]{1,30}", value):
            raise ValueError("ack_number contains unsupported characters")
        return value

    @field_validator("signed_qr_data")
    @classmethod
    def validate_signed_qr_data(cls, value: str) -> str:
        try:
            preflight_signed_qr_data(value)
        except SignedQrEncodingError as exc:
            raise ValueError("signed_qr_data exceeds the QR encoding capacity for invoice PDFs") from exc
        return value

    @model_validator(mode="after")
    def validate_metadata_set(self) -> "EInvoiceMetadataInput":
        supplied = bool(self.irn or self.ack_number or self.ack_date or self.signed_qr_data)
        if supplied and not (self.irn and self.ack_number and self.ack_date):
            raise ValueError("irn, ack_number and ack_date are required together")
        return self


@dataclass(frozen=True)
class AuthContext:
    user_id: ObjectId
    username: str
    role: str
    session_id: ObjectId
    session_token: str
    expires_at: datetime

    @property
    def csrf_token(self) -> str:
        return _csrf_for_session(self.session_token)


def set_database_provider(provider: DatabaseProvider) -> None:
    """Install a late-bound provider; callers may replace their db global before startup."""
    global _db_provider
    _db_provider = provider


def _database() -> Any:
    if _db_provider is None:
        raise HTTPException(
            status_code=503,
            detail={"code": "admin_database_unavailable", "message": "Invoice administration is not initialized"},
        )
    return _db_provider()


def _http_error(status_code: int, code: str, message: str, headers: dict[str, str] | None = None) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message}, headers=headers)


def _object_id(value: str, entity: str = "resource") -> ObjectId:
    if not ObjectId.is_valid(value):
        raise _http_error(400, "invalid_id", f"Invalid {entity} id")
    return ObjectId(value)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _at_utc_midnight(value: date) -> datetime:
    return datetime.combine(value, datetime_time.min, tzinfo=timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _business_date(value: datetime | None = None) -> date:
    return _as_utc(value or _now()).astimezone(BUSINESS_TIMEZONE).date()


def _iso_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _as_utc(value).isoformat().replace("+00:00", "Z")


def _date_string(value: datetime | date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _as_utc(value).date().isoformat()
    return value.isoformat()


def _quantize(value: Decimal) -> Decimal:
    if not value.is_finite():
        raise _http_error(400, "invalid_money", "Money values must be finite")
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def _to_paise(value: Decimal) -> int:
    quantized = _quantize(value)
    paise = int((quantized * 100).to_integral_value(rounding=ROUND_HALF_UP))
    _ensure_safe_paise(paise)
    return paise


def _from_paise(value: int) -> Decimal:
    return (Decimal(value) / 100).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def _display_paise(value: int) -> str:
    return format(_from_paise(value), ".2f")


def _decimal_string(value: Decimal) -> str:
    normalized = value.normalize()
    result = format(normalized, "f")
    return "0" if result in {"-0", ""} else result


def _money_pair(name: str, paise: int) -> dict[str, int | str]:
    _ensure_safe_paise(paise)
    return {f"{name}_paise": paise, f"{name}_display": _display_paise(paise)}


def _ensure_safe_paise(*values: int) -> None:
    if any(abs(value) > MAX_SAFE_INTEGER for value in values):
        raise _http_error(400, "invoice_amount_too_large", "Calculated invoice amount exceeds the supported monetary range")


def _ensure_safe_paise_fields(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key.endswith("_paise") and isinstance(item, int) and not isinstance(item, bool):
                _ensure_safe_paise(item)
            _ensure_safe_paise_fields(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _ensure_safe_paise_fields(item)


def _safe_detail(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return _iso_datetime(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return _decimal_string(value)
    if isinstance(value, dict):
        output = {}
        for key, item in value.items():
            lowered = key.lower()
            if any(secret in lowered for secret in ("password", "hash", "token", "signed_qr_data")):
                continue
            output[key] = _safe_detail(item)
        return output
    if isinstance(value, list):
        return [_safe_detail(item) for item in value[:100]]
    if isinstance(value, str):
        return value[:1000]
    return value


def _api_value(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return _iso_datetime(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return _decimal_string(value)
    if isinstance(value, list):
        return [_api_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _api_value(item) for key, item in value.items()}
    return value


def _calculation_review_projection(document: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    projection = _api_value({field: document.get(field) for field in fields})
    lines = projection.get("lines")
    if isinstance(lines, list):
        for line in lines:
            if isinstance(line, dict):
                line.pop("id", None)
    return projection


def _serialize_document(doc: dict[str, Any]) -> dict[str, Any]:
    _ensure_safe_paise_fields(doc)
    output = {key: _api_value(value) for key, value in doc.items() if key != "_id"}
    output["id"] = str(doc["_id"])
    return output


def _serialize_settings(doc: dict[str, Any]) -> dict[str, Any]:
    return _serialize_document(doc)


def _serialize_invoice(doc: dict[str, Any]) -> dict[str, Any]:
    _ensure_safe_paise_fields(doc)
    excluded = {"_id", "calculation_input"}
    output = {key: _api_value(value) for key, value in doc.items() if key not in excluded}
    output["id"] = str(doc["_id"])
    output.setdefault("invoice_number", None)

    calculation_input = doc.get("calculation_input")
    input_lines = calculation_input.get("lines") or [] if isinstance(calculation_input, dict) else []
    if not isinstance(input_lines, list):
        input_lines = []
    output_lines = output.get("lines") or []
    for index, line in enumerate(output_lines):
        if not isinstance(line, dict) or "input_gst_rate" in line or index >= len(input_lines):
            continue
        input_line = input_lines[index]
        if isinstance(input_line, dict) and "gst_rate" in input_line:
            line["input_gst_rate"] = _api_value(input_line["gst_rate"])

    if doc.get("status") in {"issued", "partially_paid", "overdue"}:
        output["status"] = _status_for_payment(doc)
    output["invoice_date"] = _date_string(doc.get("invoice_date"))
    output["due_date"] = _date_string(doc.get("due_date"))
    payments = []
    for payment in doc.get("payments", []):
        item = {key: _api_value(value) for key, value in payment.items() if key != "_id"}
        item["id"] = str(payment["_id"])
        item["payment_date"] = _date_string(payment.get("payment_date"))
        payments.append(item)
    output["payments"] = payments
    if output.get("e_invoice") and doc["e_invoice"].get("ack_date"):
        output["e_invoice"]["ack_date"] = _date_string(doc["e_invoice"]["ack_date"])
    return output


def _password_bytes(password: str) -> bytes:
    raw = password.encode("utf-8")
    if len(raw) <= 72:
        return raw
    return hashlib.sha256(raw).hexdigest().encode("ascii")


def _bcrypt_rounds() -> int:
    try:
        return min(14, max(10, int(os.environ.get("INVOICE_ADMIN_BCRYPT_ROUNDS", "12"))))
    except ValueError:
        return 12


def _session_hours() -> int:
    try:
        return min(24 * 30, max(1, int(os.environ.get("INVOICE_ADMIN_SESSION_HOURS", str(SESSION_HOURS_DEFAULT)))))
    except ValueError:
        return SESSION_HOURS_DEFAULT


def _cookie_secure() -> bool:
    return os.environ.get("INVOICE_ADMIN_COOKIE_SECURE", "true").strip().lower() != "false"


def _csrf_for_session(session_token: str) -> str:
    return hmac.new(session_token.encode("utf-8"), b"suvi-invoice-admin-csrf-v1", hashlib.sha256).hexdigest()


def _throttle_keys(request: Request, username: str) -> tuple[str, str]:
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}", f"identity:{host}:{username.casefold()}"


def _prune_login_failures(now: float) -> None:
    stale = []
    for key, attempts in _LOGIN_FAILURES.items():
        while attempts and now - attempts[0] >= LOGIN_WINDOW_SECONDS:
            attempts.popleft()
        if not attempts:
            stale.append(key)
    for key in stale:
        _LOGIN_FAILURES.pop(key, None)
    while len(_LOGIN_FAILURES) > MAX_LOGIN_THROTTLE_KEYS:
        oldest_key = min(_LOGIN_FAILURES, key=lambda item: _LOGIN_FAILURES[item][0])
        _LOGIN_FAILURES.pop(oldest_key, None)


def _check_login_throttle(keys: tuple[str, str]) -> int | None:
    now = time.monotonic()
    with _LOGIN_FAILURES_LOCK:
        _prune_login_failures(now)
        retry_after = 0
        for key in keys:
            attempts = _LOGIN_FAILURES.get(key)
            if attempts and len(attempts) >= LOGIN_MAX_FAILURES:
                retry_after = max(retry_after, max(1, int(LOGIN_WINDOW_SECONDS - (now - attempts[0]))))
        return retry_after or None


def _record_login_failure(keys: tuple[str, str]) -> None:
    now = time.monotonic()
    with _LOGIN_FAILURES_LOCK:
        _prune_login_failures(now)
        for key in keys:
            _LOGIN_FAILURES.setdefault(key, deque()).append(now)
        _prune_login_failures(now)


def _clear_login_failures(keys: tuple[str, str]) -> None:
    with _LOGIN_FAILURES_LOCK:
        for key in keys:
            _LOGIN_FAILURES.pop(key, None)


async def _audit(
    db: Any,
    auth: AuthContext,
    action: str,
    entity_type: str,
    entity_id: ObjectId | str,
    details: dict[str, Any] | None = None,
) -> None:
    safe_details = _safe_detail(details or {})
    _ensure_safe_paise_fields(safe_details)
    record = {
        "actor_user_id": auth.user_id,
        "actor_username": auth.username,
        "action": action,
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "details": safe_details,
        "created_at": _now(),
    }
    try:
        await db.invoice_audit.insert_one(record)
    except Exception:
        logger.exception("Unable to append invoice audit record for %s", action)


async def _create_index(collection: Any, keys: Any, *, required: bool = False, **kwargs: Any) -> None:
    try:
        result = collection.create_index(keys, **kwargs)
        if inspect.isawaitable(result):
            await result
    except (NotImplementedError, TypeError):
        adapter_name = f"{type(collection).__module__}.{type(collection).__name__}".lower()
        if not required and "mongomock" in adapter_name:
            logger.warning("Database adapter does not support optional invoice index %s", kwargs.get("name", keys))
            return
        logger.exception("Unable to create invoice index %s", kwargs.get("name", keys))
        raise
    except Exception:
        logger.exception("Unable to create invoice index %s", kwargs.get("name", keys))
        if required:
            raise


async def initialize_invoice_admin(provider: DatabaseProvider | None = None) -> None:
    """Create indexes/defaults against the database returned at startup time."""
    if provider is not None:
        set_database_provider(provider)
    db = _database()

    index_specs = [
        (db.invoice_admin_users, [("username_normalized", ASCENDING)], {"unique": True, "name": "admin_username_unique"}),
        (db.invoice_admin_sessions, [("session_hash", ASCENDING)], {"unique": True, "name": "admin_session_hash_unique"}),
        (db.invoice_admin_sessions, [("expires_at", ASCENDING)], {"expireAfterSeconds": 0, "name": "admin_session_expiry_ttl"}),
        (db.invoice_admin_sessions, [("user_id", ASCENDING)], {"name": "admin_session_user"}),
        (db.invoice_customers, [("active", ASCENDING), ("updated_at", DESCENDING)], {"name": "customer_active_updated"}),
        (db.invoice_customers, [("display_name", ASCENDING)], {"name": "customer_display_name"}),
        (db.invoice_catalogue, [("active", ASCENDING), ("updated_at", DESCENDING)], {"name": "catalogue_active_updated"}),
        (db.invoice_catalogue, [("name", ASCENDING)], {"name": "catalogue_name"}),
        (db.invoices, [("invoice_number", ASCENDING)], {"unique": True, "sparse": True, "name": "invoice_number_unique"}),
        (
            db.invoices,
            [("source_quotation_id", ASCENDING)],
            {"unique": True, "sparse": True, "name": "invoice_source_quotation_unique"},
        ),
        (db.invoices, [("status", ASCENDING), ("due_date", ASCENDING)], {"name": "invoice_status_due"}),
        (db.invoices, [("invoice_date", DESCENDING)], {"name": "invoice_date_desc"}),
        (db.invoices, [("customer_id", ASCENDING), ("created_at", DESCENDING)], {"name": "invoice_customer_created"}),
        (
            db.quotations,
            [("quotation_number", ASCENDING)],
            {"unique": True, "sparse": True, "name": "quotation_number_unique"},
        ),
        (
            db.quotations,
            [("duplicate_operation_id", ASCENDING)],
            {"unique": True, "sparse": True, "name": "quotation_duplicate_operation_unique"},
        ),
        (db.quotations, [("status", ASCENDING), ("valid_until", ASCENDING)], {"name": "quotation_status_validity"}),
        (db.quotations, [("quotation_date", DESCENDING)], {"name": "quotation_date_desc"}),
        (db.quotations, [("customer_id", ASCENDING), ("created_at", DESCENDING)], {"name": "quotation_customer_created"}),
        (db.invoice_audit, [("created_at", DESCENDING)], {"name": "audit_created_desc"}),
        (db.invoice_audit, [("entity_type", ASCENDING), ("entity_id", ASCENDING)], {"name": "audit_entity"}),
    ]
    for collection, keys, options in index_specs:
        await _create_index(collection, keys, required=bool(options.get("unique")), **options)

    now = _now()
    settings = {**DEFAULT_BUSINESS_SETTINGS, "created_at": now, "updated_at": now}
    await db.invoice_business_settings.update_one(
        {"_id": "business-settings"},
        {"$setOnInsert": settings},
        upsert=True,
    )

    username = os.environ.get("INVOICE_ADMIN_USERNAME", "admin").strip() or "admin"
    configured_password = os.environ.get("INVOICE_ADMIN_PASSWORD")
    password = configured_password
    if not password:
        password = os.environ.get("ADMIN_KEY")
        if password:
            logger.warning(
                "INVOICE_ADMIN_PASSWORD is not set; using legacy ADMIN_KEY only to preserve the current local startup. "
                "Set INVOICE_ADMIN_PASSWORD and rotate credentials before production use."
            )
    if not password:
        logger.error("Invoice admin owner was not bootstrapped because neither INVOICE_ADMIN_PASSWORD nor ADMIN_KEY is set")
        return

    normalized = username.casefold()
    existing = await db.invoice_admin_users.find_one({"username_normalized": normalized})
    if existing is None:
        password_hash = await run_in_threadpool(
            bcrypt.hashpw,
            _password_bytes(password),
            bcrypt.gensalt(rounds=_bcrypt_rounds()),
        )
        owner = {
            "username": username,
            "username_normalized": normalized,
            "password_hash": password_hash.decode("ascii"),
            "password_algorithm": "bcrypt" if len(password.encode("utf-8")) <= 72 else "bcrypt_sha256",
            "role": "owner",
            "active": True,
            "created_at": now,
            "updated_at": now,
        }
        try:
            await db.invoice_admin_users.insert_one(owner)
            logger.info("Bootstrapped invoice admin owner user %s", username)
        except DuplicateKeyError:
            pass
    elif configured_password:
        try:
            password_matches = await run_in_threadpool(
                bcrypt.checkpw,
                _password_bytes(configured_password),
                existing["password_hash"].encode("ascii"),
            )
        except (KeyError, TypeError, ValueError):
            password_matches = False
        if not password_matches:
            password_hash = await run_in_threadpool(
                bcrypt.hashpw,
                _password_bytes(configured_password),
                bcrypt.gensalt(rounds=_bcrypt_rounds()),
            )
            await db.invoice_admin_users.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "password_hash": password_hash.decode("ascii"),
                        "password_algorithm": "bcrypt" if len(configured_password.encode("utf-8")) <= 72 else "bcrypt_sha256",
                        "updated_at": now,
                    }
                },
            )
            await db.invoice_admin_sessions.delete_many({"user_id": existing["_id"]})
            logger.info("Rotated invoice admin owner password and revoked active sessions for %s", username)


async def require_auth(request: Request) -> AuthContext:
    token = request.cookies.get(SESSION_COOKIE)
    if not token or len(token) > 512:
        raise _http_error(401, "authentication_required", "Authentication required", {"WWW-Authenticate": "Session"})
    session_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    db = _database()
    session = await db.invoice_admin_sessions.find_one({"session_hash": session_hash})
    if not session:
        raise _http_error(401, "invalid_session", "Session is invalid or expired", {"WWW-Authenticate": "Session"})
    expires_at = _as_utc(session["expires_at"])
    if expires_at <= _now():
        await db.invoice_admin_sessions.delete_one({"_id": session["_id"]})
        raise _http_error(401, "invalid_session", "Session is invalid or expired", {"WWW-Authenticate": "Session"})
    user = await db.invoice_admin_users.find_one({"_id": session["user_id"], "active": True})
    if not user:
        raise _http_error(401, "invalid_session", "Session is invalid or expired", {"WWW-Authenticate": "Session"})
    return AuthContext(
        user_id=user["_id"],
        username=user["username"],
        role=user.get("role", "owner"),
        session_id=session["_id"],
        session_token=token,
        expires_at=expires_at,
    )


async def require_csrf(
    request: Request,
    auth: Annotated[AuthContext, Depends(require_auth)],
    x_csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> AuthContext:
    expected = auth.csrf_token
    if not x_csrf_token or not hmac.compare_digest(x_csrf_token, expected):
        raise _http_error(403, "csrf_failed", "A valid X-CSRF-Token header is required")
    return auth


async def _get_settings_doc(db: Any) -> dict[str, Any]:
    doc = await db.invoice_business_settings.find_one({"_id": "business-settings"})
    if doc is not None:
        return doc
    now = _now()
    await db.invoice_business_settings.update_one(
        {"_id": "business-settings"},
        {"$setOnInsert": {**DEFAULT_BUSINESS_SETTINGS, "created_at": now, "updated_at": now}},
        upsert=True,
    )
    return await db.invoice_business_settings.find_one({"_id": "business-settings"})


def _supplier_snapshot(settings: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "display_name",
        "trade_name",
        "legal_name",
        "address",
        "phone",
        "email",
        "website",
        "gstin",
        "pan",
        "gst_registration_mode",
        "bank",
        "upi_id",
        "authorised_signatory",
        "signature",
        "e_invoice_applicable",
    )
    snapshot = {key: _api_value(settings.get(key, "")) for key in keys}
    snapshot["gst_registration_mode"] = _normalize_gst_registration_mode(settings.get("gst_registration_mode"))
    return snapshot


def _tax_regime(payload: InvoiceDraftInput, supplier: dict[str, Any]) -> tuple[str, str]:
    mode = _normalize_gst_registration_mode(supplier.get("gst_registration_mode"))
    if payload.tax_mode == "no_tax" or mode != "regular":
        title = "BILL OF SUPPLY" if mode in {"regular", "composition"} else "INVOICE"
        return "no_tax", title
    supplier_address = supplier.get("address") or {}
    supplier_state = supplier_address.get("state_code", "")
    try:
        _validate_state_pair(supplier_address.get("state", ""), supplier_state, required=True)
    except ValueError as exc:
        raise _http_error(409, "business_state_required", f"Configure a valid business state and state code: {exc}")
    gstin = supplier.get("gstin", "")
    if gstin and gstin[:2] != supplier_state:
        raise _http_error(409, "business_gstin_state_mismatch", "Business GSTIN and address state code do not match")
    regime = "intra_state" if supplier_state == payload.place_of_supply.state_code else "inter_state"
    return regime, "TAX INVOICE"


def _missing_address_fields(address: dict[str, Any]) -> list[str]:
    required = ("line1", "city", "state", "state_code", "pincode")
    return [field for field in required if not str(address.get(field, "")).strip()]


def _validate_issue_compliance(
    payload: InvoiceDraftInput,
    settings: dict[str, Any],
    calculated: dict[str, Any],
) -> None:
    registration_mode = _normalize_gst_registration_mode(settings.get("gst_registration_mode"))
    if registration_mode not in {"regular", "composition"}:
        return

    supplier_address = settings.get("address") or {}
    supplier_missing = _missing_address_fields(supplier_address)
    if supplier_missing:
        raise _http_error(
            409,
            "business_address_incomplete",
            "Complete the business address before issuing a GST document: " + ", ".join(supplier_missing),
        )

    lines_without_codes = [str(index) for index, line in enumerate(payload.lines, start=1) if not line.hsn_sac]
    if lines_without_codes:
        raise _http_error(
            409,
            "hsn_sac_required",
            "Add an HSN/SAC code to invoice line(s): " + ", ".join(lines_without_codes),
        )

    customer = payload.customer_snapshot
    customer_address = customer.billing_address.model_dump(mode="json")
    address_required = bool(customer.gstin) or int(calculated["totals"]["taxable_paise"]) >= 5_000_000
    customer_missing = _missing_address_fields(customer_address) if address_required else []
    if customer_missing:
        raise _http_error(
            409,
            "customer_address_incomplete",
            "Complete the customer billing address before issue: " + ", ".join(customer_missing),
        )

    if not customer.shipping_same_as_billing and customer.shipping_address is not None:
        shipping_missing = _missing_address_fields(customer.shipping_address.model_dump(mode="json"))
        if shipping_missing:
            raise _http_error(
                409,
                "shipping_address_incomplete",
                "Complete the delivery address before issue: " + ", ".join(shipping_missing),
            )


def _calculate_invoice(payload: InvoiceDraftInput, settings: dict[str, Any]) -> dict[str, Any]:
    supplier = _supplier_snapshot(settings)
    regime, document_title = _tax_regime(payload, supplier)
    calculated_lines: list[dict[str, Any]] = []
    subtotal_paise = discount_paise = taxable_paise = 0
    cgst_paise = sgst_paise = igst_paise = total_tax_paise = 0

    for input_line in payload.lines:
        rate = input_line.unit_rate
        gross = _quantize(input_line.quantity * rate)
        if input_line.discount_type == "percent":
            discount = _quantize(gross * input_line.discount_value / Decimal("100"))
        elif input_line.discount_type == "fixed":
            discount = _quantize(input_line.discount_value)
        else:
            discount = ZERO
        if discount > gross:
            raise _http_error(400, "discount_exceeds_line", f"Discount exceeds gross amount for line '{input_line.name}'")
        taxable = _quantize(gross - discount)
        gst_rate = input_line.gst_rate if regime != "no_tax" else ZERO
        tax = _quantize(taxable * gst_rate / Decimal("100"))
        line_cgst = line_sgst = line_igst = ZERO
        cgst_rate = sgst_rate = igst_rate = ZERO
        if regime == "intra_state":
            cgst_rate = gst_rate / Decimal("2")
            sgst_rate = gst_rate - cgst_rate
            line_cgst = _quantize(tax / Decimal("2"))
            line_sgst = tax - line_cgst
        elif regime == "inter_state":
            igst_rate = gst_rate
            line_igst = tax
        line_total = taxable + tax

        gross_value = _to_paise(gross)
        discount_value = _to_paise(discount)
        taxable_value = _to_paise(taxable)
        cgst_value = _to_paise(line_cgst)
        sgst_value = _to_paise(line_sgst)
        igst_value = _to_paise(line_igst)
        tax_value = _to_paise(tax)
        line_total_value = _to_paise(line_total)
        line_doc: dict[str, Any] = {
            "id": str(ObjectId()),
            "item_id": input_line.item_id,
            "item_type": input_line.item_type,
            "name": input_line.name,
            "description": input_line.description,
            "hsn_sac": input_line.hsn_sac,
            "unit": input_line.unit,
            "quantity": _decimal_string(input_line.quantity),
            "unit_rate": _decimal_string(rate),
            "unit_rate_paise": _to_paise(rate),
            "unit_rate_display": _decimal_string(rate),
            "discount_type": input_line.discount_type,
            "discount_value": _decimal_string(input_line.discount_value),
            "input_gst_rate": _decimal_string(input_line.gst_rate),
            "gst_rate": _decimal_string(gst_rate),
            "cgst_rate": _decimal_string(cgst_rate),
            "sgst_rate": _decimal_string(sgst_rate),
            "igst_rate": _decimal_string(igst_rate),
        }
        line_doc.update(_money_pair("gross", gross_value))
        line_doc.update(_money_pair("discount", discount_value))
        line_doc.update(_money_pair("taxable", taxable_value))
        line_doc.update(_money_pair("cgst", cgst_value))
        line_doc.update(_money_pair("sgst", sgst_value))
        line_doc.update(_money_pair("igst", igst_value))
        line_doc.update(_money_pair("tax", tax_value))
        line_doc.update(_money_pair("line_total", line_total_value))
        calculated_lines.append(line_doc)

        subtotal_paise += gross_value
        discount_paise += discount_value
        taxable_paise += taxable_value
        cgst_paise += cgst_value
        sgst_paise += sgst_value
        igst_paise += igst_value
        total_tax_paise += tax_value
        _ensure_safe_paise(
            subtotal_paise,
            discount_paise,
            taxable_paise,
            cgst_paise,
            sgst_paise,
            igst_paise,
            total_tax_paise,
        )

    adjustment_paise = _to_paise(payload.post_tax_adjustment_amount)
    before_rounding_paise = taxable_paise + total_tax_paise + adjustment_paise
    if before_rounding_paise < 0:
        raise _http_error(400, "negative_invoice_total", "Post-tax adjustment cannot make the invoice total negative")
    round_off_paise = 0
    grand_total_paise = before_rounding_paise
    if settings.get("round_to_rupee", False):
        rounded = _from_paise(before_rounding_paise).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        grand_total_paise = _to_paise(rounded)
        round_off_paise = grand_total_paise - before_rounding_paise
    _ensure_safe_paise(before_rounding_paise, round_off_paise, grand_total_paise)

    totals: dict[str, Any] = {}
    for name, value in (
        ("subtotal", subtotal_paise),
        ("discount", discount_paise),
        ("taxable", taxable_paise),
        ("cgst", cgst_paise),
        ("sgst", sgst_paise),
        ("igst", igst_paise),
        ("total_tax", total_tax_paise),
        ("post_tax_adjustment", adjustment_paise),
        ("round_off", round_off_paise),
        ("grand_total", grand_total_paise),
        ("received", 0),
        ("tds_withheld", 0),
        ("settled", 0),
        ("paid", 0),
        ("balance", grand_total_paise),
    ):
        totals.update(_money_pair(name, value))

    customer_data = payload.customer_snapshot.model_dump(mode="json")
    return {
        "supplier_snapshot": supplier,
        "customer_snapshot": customer_data,
        "customer_id": ObjectId(payload.customer_snapshot.customer_id) if payload.customer_snapshot.customer_id else None,
        "invoice_date": _at_utc_midnight(payload.invoice_date),
        "due_date": _at_utc_midnight(payload.due_date) if payload.due_date is not None else None,
        "place_of_supply": payload.place_of_supply.model_dump(mode="json"),
        "lines": calculated_lines,
        "project_reference": payload.project_reference,
        "po_reference": payload.po_reference,
        "reverse_charge": payload.reverse_charge,
        "tax_mode": payload.tax_mode,
        "tax_regime": regime,
        "document_title": document_title,
        "notes": payload.notes,
        "terms": payload.terms,
        "post_tax_adjustment_label": payload.post_tax_adjustment_label,
        "totals": totals,
        "calculation_input": payload.model_dump(mode="json"),
    }


def _financial_year(value: date) -> tuple[str, str]:
    start_year = value.year if value.month >= 4 else value.year - 1
    label = f"{start_year % 100:02d}-{(start_year + 1) % 100:02d}"
    key = f"{start_year}-{start_year + 1}"
    return key, label


def _payment_status_values(balance: int, settled: int, due: datetime | None) -> str:
    if balance <= 0:
        return "paid"
    if isinstance(due, datetime) and _as_utc(due).date() < _business_date():
        return "overdue"
    if settled > 0:
        return "partially_paid"
    return "issued"


def _status_for_payment(doc: dict[str, Any]) -> str:
    totals = doc.get("totals", {})
    return _payment_status_values(
        int(totals.get("balance_paise", 0)),
        int(totals.get("settled_paise", 0)),
        doc.get("due_date"),
    )


async def _create_draft_document(db: Any, payload: InvoiceDraftInput, auth: AuthContext) -> dict[str, Any]:
    settings = await _get_settings_doc(db)
    now = _now()
    calculated = _calculate_invoice(payload, settings)
    document = {
        **calculated,
        "financial_year": None,
        "sequence_number": None,
        "status": "draft",
        "payments": [],
        "e_invoice": {"irn": "", "ack_number": "", "ack_date": None, "signed_qr_data": "", "source": "manual"},
        "cancel_reason": "",
        "cancelled_at": None,
        "cancelled_by": None,
        "issued_at": None,
        "issued_by": None,
        "created_at": now,
        "created_by": auth.user_id,
        "updated_at": now,
        "updated_by": auth.user_id,
        "revision": 1,
        "schema_version": 1,
    }
    result = await db.invoices.insert_one(document)
    document["_id"] = result.inserted_id
    return document


@router.post("/auth/login")
async def login(payload: LoginInput, request: Request, response: Response) -> dict[str, Any]:
    throttle_keys = _throttle_keys(request, payload.username)
    retry_after = _check_login_throttle(throttle_keys)
    if retry_after is not None:
        raise _http_error(
            429,
            "login_throttled",
            "Too many login attempts; try again later",
            {"Retry-After": str(retry_after)},
        )

    db = _database()
    user = await db.invoice_admin_users.find_one({"username_normalized": payload.username.casefold(), "active": True})
    if user:
        try:
            password_ok = await run_in_threadpool(
                bcrypt.checkpw,
                _password_bytes(payload.password),
                user["password_hash"].encode("ascii"),
            )
        except (ValueError, TypeError, KeyError):
            logger.exception("Stored password hash could not be verified")
            password_ok = False
    else:
        await run_in_threadpool(
            bcrypt.hashpw,
            _password_bytes(payload.password),
            bcrypt.gensalt(rounds=_bcrypt_rounds()),
        )
        password_ok = False

    if not password_ok or user is None:
        _record_login_failure(throttle_keys)
        raise _http_error(401, "invalid_credentials", "Invalid username or password", {"WWW-Authenticate": "Session"})

    _clear_login_failures(throttle_keys)
    token = secrets.token_urlsafe(48)
    now = _now()
    expires_at = now + timedelta(hours=_session_hours())
    result = await db.invoice_admin_sessions.insert_one(
        {
            "session_hash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
            "user_id": user["_id"],
            "created_at": now,
            "expires_at": expires_at,
        }
    )
    auth = AuthContext(
        user_id=user["_id"],
        username=user["username"],
        role=user.get("role", "owner"),
        session_id=result.inserted_id,
        session_token=token,
        expires_at=expires_at,
    )
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=_session_hours() * 3600,
        expires=expires_at,
        path="/api/v1/admin",
        secure=_cookie_secure(),
        httponly=True,
        samesite="lax",
    )
    await _audit(db, auth, "auth.login", "user", user["_id"])
    return {
        "user": {"id": str(user["_id"]), "username": user["username"], "role": user.get("role", "owner")},
        "csrf_token": auth.csrf_token,
        "expires_at": _iso_datetime(expires_at),
    }


@router.get("/auth/me")
async def auth_me(auth: Annotated[AuthContext, Depends(require_auth)]) -> dict[str, Any]:
    return {
        "user": {"id": str(auth.user_id), "username": auth.username, "role": auth.role},
        "csrf_token": auth.csrf_token,
        "expires_at": _iso_datetime(auth.expires_at),
    }


@router.post("/auth/logout")
async def logout(response: Response, auth: Annotated[AuthContext, Depends(require_csrf)]) -> dict[str, bool]:
    db = _database()
    await _audit(db, auth, "auth.logout", "user", auth.user_id)
    await db.invoice_admin_sessions.delete_one({"_id": auth.session_id})
    response.delete_cookie(
        SESSION_COOKIE,
        path="/api/v1/admin",
        secure=_cookie_secure(),
        httponly=True,
        samesite="lax",
    )
    return {"ok": True}


@router.get("/business-settings")
async def get_business_settings(auth: Annotated[AuthContext, Depends(require_auth)]) -> dict[str, Any]:
    del auth
    return _serialize_settings(await _get_settings_doc(_database()))


@router.put("/business-settings")
async def update_business_settings(
    payload: BusinessSettingsInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    db = _database()
    now = _now()
    update = payload.model_dump(mode="json")
    update.update({"updated_at": now, "updated_by": auth.user_id})
    result = await db.invoice_business_settings.update_one(
        {"_id": "business-settings"},
        {"$set": update, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    if not result.acknowledged:
        raise _http_error(409, "settings_not_saved", "Business settings could not be saved")
    doc = await _get_settings_doc(db)
    await _audit(db, auth, "business_settings.update", "business_settings", "business-settings")
    return _serialize_settings(doc)


@router.post("/customers", status_code=201)
async def create_customer(payload: CustomerInput, auth: Annotated[AuthContext, Depends(require_csrf)]) -> dict[str, Any]:
    db = _database()
    now = _now()
    doc = {
        **payload.model_dump(mode="json"),
        "created_at": now,
        "created_by": auth.user_id,
        "updated_at": now,
        "updated_by": auth.user_id,
    }
    result = await db.invoice_customers.insert_one(doc)
    doc["_id"] = result.inserted_id
    await _audit(db, auth, "customer.create", "customer", result.inserted_id, {"display_name": payload.display_name})
    return _serialize_document(doc)


@router.get("/customers")
async def list_customers(
    auth: Annotated[AuthContext, Depends(require_auth)],
    q: str = Query(default="", max_length=200),
    active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    del auth
    db = _database()
    query: dict[str, Any] = {}
    if active is not None:
        query["active"] = active
    if q:
        pattern = re.compile(re.escape(q), re.IGNORECASE)
        query["$or"] = [
            {"display_name": pattern},
            {"legal_name": pattern},
            {"contact_person": pattern},
            {"phone": pattern},
            {"email": pattern},
            {"gstin": pattern},
        ]
    total = await db.invoice_customers.count_documents(query)
    docs = await db.invoice_customers.find(query).sort("updated_at", DESCENDING).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [_serialize_document(doc) for doc in docs], "total": total, "page": page, "page_size": page_size}


@router.get("/customers/{customer_id}")
async def get_customer(customer_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict[str, Any]:
    del auth
    doc = await _database().invoice_customers.find_one({"_id": _object_id(customer_id, "customer")})
    if not doc:
        raise _http_error(404, "customer_not_found", "Customer not found")
    return _serialize_document(doc)


@router.put("/customers/{customer_id}")
async def update_customer(
    customer_id: str,
    payload: CustomerInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(customer_id, "customer")
    db = _database()
    update = payload.model_dump(mode="json")
    update.update({"updated_at": _now(), "updated_by": auth.user_id})
    result = await db.invoice_customers.update_one({"_id": oid}, {"$set": update})
    if result.matched_count == 0:
        raise _http_error(404, "customer_not_found", "Customer not found")
    doc = await db.invoice_customers.find_one({"_id": oid})
    await _audit(db, auth, "customer.update", "customer", oid, {"display_name": payload.display_name})
    return _serialize_document(doc)


@router.delete("/customers/{customer_id}")
async def deactivate_customer(customer_id: str, auth: Annotated[AuthContext, Depends(require_csrf)]) -> dict[str, Any]:
    oid = _object_id(customer_id, "customer")
    db = _database()
    result = await db.invoice_customers.update_one(
        {"_id": oid},
        {"$set": {"active": False, "updated_at": _now(), "updated_by": auth.user_id}},
    )
    if result.matched_count == 0:
        raise _http_error(404, "customer_not_found", "Customer not found")
    doc = await db.invoice_customers.find_one({"_id": oid})
    await _audit(db, auth, "customer.deactivate", "customer", oid)
    return _serialize_document(doc)


@router.post("/catalogue-items", status_code=201)
@router.post("/catalogue", status_code=201, include_in_schema=False)
async def create_catalogue_item(
    payload: CatalogueItemInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    db = _database()
    now = _now()
    rate_paise = _to_paise(payload.rate)
    doc = {
        **payload.model_dump(mode="json", exclude={"rate"}),
        "rate": _decimal_string(payload.rate),
        "rate_paise": rate_paise,
        "rate_display": _decimal_string(payload.rate),
        "gst_rate": _decimal_string(payload.gst_rate),
        "created_at": now,
        "created_by": auth.user_id,
        "updated_at": now,
        "updated_by": auth.user_id,
    }
    result = await db.invoice_catalogue.insert_one(doc)
    doc["_id"] = result.inserted_id
    await _audit(db, auth, "catalogue_item.create", "catalogue_item", result.inserted_id, {"name": payload.name})
    return _serialize_document(doc)


@router.get("/catalogue-items")
@router.get("/catalogue", include_in_schema=False)
async def list_catalogue_items(
    auth: Annotated[AuthContext, Depends(require_auth)],
    q: str = Query(default="", max_length=200),
    active: bool | None = Query(default=None),
    item_type: Literal["goods", "service"] | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    del auth
    db = _database()
    query: dict[str, Any] = {}
    if active is not None:
        query["active"] = active
    if item_type:
        query["item_type"] = item_type
    if q:
        pattern = re.compile(re.escape(q), re.IGNORECASE)
        query["$or"] = [{"name": pattern}, {"description": pattern}, {"hsn_sac": pattern}]
    total = await db.invoice_catalogue.count_documents(query)
    docs = await db.invoice_catalogue.find(query).sort("updated_at", DESCENDING).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [_serialize_document(doc) for doc in docs], "total": total, "page": page, "page_size": page_size}


@router.get("/catalogue-items/{item_id}")
@router.get("/catalogue/{item_id}", include_in_schema=False)
async def get_catalogue_item(item_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict[str, Any]:
    del auth
    doc = await _database().invoice_catalogue.find_one({"_id": _object_id(item_id, "catalogue item")})
    if not doc:
        raise _http_error(404, "catalogue_item_not_found", "Catalogue item not found")
    return _serialize_document(doc)


@router.put("/catalogue-items/{item_id}")
@router.put("/catalogue/{item_id}", include_in_schema=False)
async def update_catalogue_item(
    item_id: str,
    payload: CatalogueItemInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(item_id, "catalogue item")
    db = _database()
    update = {
        **payload.model_dump(mode="json", exclude={"rate"}),
        "rate": _decimal_string(payload.rate),
        "rate_paise": _to_paise(payload.rate),
        "rate_display": _decimal_string(payload.rate),
        "gst_rate": _decimal_string(payload.gst_rate),
        "updated_at": _now(),
        "updated_by": auth.user_id,
    }
    result = await db.invoice_catalogue.update_one({"_id": oid}, {"$set": update})
    if result.matched_count == 0:
        raise _http_error(404, "catalogue_item_not_found", "Catalogue item not found")
    doc = await db.invoice_catalogue.find_one({"_id": oid})
    await _audit(db, auth, "catalogue_item.update", "catalogue_item", oid, {"name": payload.name})
    return _serialize_document(doc)


@router.delete("/catalogue-items/{item_id}")
@router.delete("/catalogue/{item_id}", include_in_schema=False)
async def deactivate_catalogue_item(item_id: str, auth: Annotated[AuthContext, Depends(require_csrf)]) -> dict[str, Any]:
    oid = _object_id(item_id, "catalogue item")
    db = _database()
    result = await db.invoice_catalogue.update_one(
        {"_id": oid},
        {"$set": {"active": False, "updated_at": _now(), "updated_by": auth.user_id}},
    )
    if result.matched_count == 0:
        raise _http_error(404, "catalogue_item_not_found", "Catalogue item not found")
    doc = await db.invoice_catalogue.find_one({"_id": oid})
    await _audit(db, auth, "catalogue_item.deactivate", "catalogue_item", oid)
    return _serialize_document(doc)


@router.post("/invoices", status_code=201)
async def create_invoice(payload: InvoiceDraftInput, auth: Annotated[AuthContext, Depends(require_csrf)]) -> dict[str, Any]:
    db = _database()
    doc = await _create_draft_document(db, payload, auth)
    await _audit(db, auth, "invoice.create_draft", "invoice", doc["_id"], {"customer": payload.customer_snapshot.display_name})
    return _serialize_invoice(doc)


@router.get("/invoices")
async def list_invoices(
    auth: Annotated[AuthContext, Depends(require_auth)],
    q: str = Query(default="", max_length=200),
    status: Literal["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"] | None = Query(default=None),
    customer_id: str | None = Query(default=None, max_length=24),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
) -> dict[str, Any]:
    del auth
    db = _database()
    query: dict[str, Any] = {}
    and_conditions: list[dict[str, Any]] = []
    today_start = _at_utc_midnight(_business_date())
    if status == "overdue":
        query.update(
            {
                "status": {"$in": ["issued", "partially_paid", "overdue"]},
                "due_date": {"$type": "date", "$lt": today_start},
                "totals.balance_paise": {"$gt": 0},
            }
        )
    elif status in {"issued", "partially_paid"}:
        query["status"] = status
        and_conditions.append(
            {
                "$or": [
                    {"due_date": None},
                    {"due_date": {"$gte": today_start}},
                ]
            }
        )
    elif status:
        query["status"] = status
    if customer_id:
        query["customer_id"] = _object_id(customer_id, "customer")
    if date_from or date_to:
        date_query: dict[str, datetime] = {}
        if date_from:
            date_query["$gte"] = _at_utc_midnight(date_from)
        if date_to:
            date_query["$lte"] = _at_utc_midnight(date_to)
        query["invoice_date"] = date_query
    if q:
        pattern = re.compile(re.escape(q), re.IGNORECASE)
        and_conditions.append(
            {
                "$or": [
                    {"invoice_number": pattern},
                    {"customer_snapshot.display_name": pattern},
                    {"customer_snapshot.legal_name": pattern},
                    {"project_reference": pattern},
                    {"po_reference": pattern},
                ]
            }
        )
    if and_conditions:
        query["$and"] = and_conditions
    total = await db.invoices.count_documents(query)
    docs = await db.invoices.find(query).sort("created_at", DESCENDING).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [_serialize_invoice(doc) for doc in docs], "total": total, "page": page, "page_size": page_size}


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict[str, Any]:
    del auth
    oid = _object_id(invoice_id, "invoice")
    db = _database()
    doc = await db.invoices.find_one({"_id": oid})
    if not doc:
        raise _http_error(404, "invoice_not_found", "Invoice not found")
    return _serialize_invoice(doc)


@router.put("/invoices/{invoice_id}")
async def update_invoice_draft(
    invoice_id: str,
    payload: InvoiceDraftInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(invoice_id, "invoice")
    db = _database()
    existing = await db.invoices.find_one({"_id": oid})
    if not existing:
        raise _http_error(404, "invoice_not_found", "Invoice not found")
    if existing.get("status") != "draft":
        raise _http_error(409, "invoice_immutable", "Only draft invoices can be edited")
    calculated = _calculate_invoice(payload, await _get_settings_doc(db))
    calculated.update({"updated_at": _now(), "updated_by": auth.user_id})
    result = await db.invoices.update_one(
        {"_id": oid, "status": "draft"},
        {"$set": calculated, "$inc": {"revision": 1}},
    )
    if result.matched_count == 0:
        raise _http_error(409, "invoice_immutable", "Invoice is no longer editable")
    doc = await db.invoices.find_one({"_id": oid})
    await _audit(db, auth, "invoice.update_draft", "invoice", oid)
    return _serialize_invoice(doc)


@router.post("/invoices/{invoice_id}/issue")
async def issue_invoice(
    invoice_id: str,
    issue: IssueInvoiceInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(invoice_id, "invoice")
    db = _database()
    existing = await db.invoices.find_one({"_id": oid})
    if not existing:
        raise _http_error(404, "invoice_not_found", "Invoice not found")
    if existing.get("status") != "draft":
        raise _http_error(409, "invoice_already_issued", "Only a draft invoice can be issued")

    revision = int(existing.get("revision", 1))
    if issue.expected_revision != revision:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "invoice_revision_conflict",
                "message": "This draft changed since you reviewed it. Review the refreshed draft, then issue it again.",
                "invoice": _serialize_invoice(existing),
            },
        )

    settings = await _get_settings_doc(db)
    registration_mode = _normalize_gst_registration_mode(settings.get("gst_registration_mode"))
    if registration_mode not in ISSUABLE_GST_REGISTRATION_MODES:
        raise _http_error(
            409,
            "gst_registration_decision_required",
            "Choose an explicit GST registration mode (unregistered, regular, or composition) before issuing an invoice",
        )
    settings = {**settings, "gst_registration_mode": registration_mode}
    payload = InvoiceDraftInput.model_validate(existing["calculation_input"])
    if registration_mode in {"regular", "composition"}:
        stored_gstin = str(settings.get("gstin") or "").strip()
        if not stored_gstin:
            raise _http_error(409, "business_gstin_required", "Configure the business GSTIN before issuing a GST document")
        try:
            settings["gstin"] = _normalize_and_validate_gstin(stored_gstin)
        except ValueError as exc:
            raise _http_error(409, "business_gstin_invalid", f"Correct the business GSTIN before issuing: {exc}")
        business_address = settings.get("address") or {}
        try:
            _validate_state_pair(business_address.get("state", ""), business_address.get("state_code", ""), required=True)
        except ValueError as exc:
            raise _http_error(409, "business_state_required", f"Configure a valid business state and state code: {exc}")
        if settings["gstin"][:2] != business_address["state_code"]:
            raise _http_error(409, "business_gstin_state_mismatch", "Business GSTIN and address state code do not match")
    calculated = _calculate_invoice(payload, settings)
    _validate_issue_compliance(payload, settings, calculated)

    calculation_fields = tuple(calculated.keys())
    if _calculation_review_projection(existing, calculation_fields) != _calculation_review_projection(
        calculated,
        calculation_fields,
    ):
        now = _now()
        refreshed = await db.invoices.find_one_and_update(
            {"_id": oid, "status": "draft", "revision": revision},
            {
                "$set": {**calculated, "updated_at": now, "updated_by": auth.user_id},
                "$inc": {"revision": 1},
            },
            return_document=ReturnDocument.AFTER,
        )
        if not refreshed:
            latest = await db.invoices.find_one({"_id": oid})
            if latest and latest.get("status") != "draft":
                raise _http_error(409, "invoice_already_issued", "Invoice was issued by another request")
            if latest:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "invoice_revision_conflict",
                        "message": "This draft changed since you reviewed it. Review the refreshed draft, then issue it again.",
                        "invoice": _serialize_invoice(latest),
                    },
                )
            raise _http_error(409, "invoice_state_conflict", "Invoice changed concurrently; reload and review it before issuing")
        await _audit(
            db,
            auth,
            "invoice.recalculate_for_issue",
            "invoice",
            oid,
            {"previous_revision": revision, "revision": int(refreshed.get("revision", revision + 1))},
        )
        raise HTTPException(
            status_code=409,
            detail={
                "code": "invoice_recalculated",
                "message": "Current business settings changed this draft's calculation. Review the refreshed draft, then issue it again.",
                "invoice": _serialize_invoice(refreshed),
            },
        )

    reviewed_lines = existing.get("lines") or []
    for index, line in enumerate(calculated.get("lines") or []):
        if index < len(reviewed_lines) and isinstance(reviewed_lines[index], dict) and "id" in reviewed_lines[index]:
            line["id"] = reviewed_lines[index]["id"]

    invoice_date = payload.invoice_date
    fy_key, fy_label = _financial_year(invoice_date)
    prefix = settings.get("invoice_prefix", "INV")
    counter_id = f"{prefix}:{fy_key}"
    counter = await db.invoice_counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"sequence": 1}, "$setOnInsert": {"prefix": prefix, "financial_year": fy_key, "created_at": _now()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if not counter:
        counter = await db.invoice_counters.find_one({"_id": counter_id})
    if not counter or not counter.get("sequence"):
        raise _http_error(409, "invoice_sequence_failed", "Invoice number could not be allocated")
    sequence = int(counter["sequence"])
    invoice_number = f"{prefix}/{fy_label}/{sequence:04d}"
    now = _now()
    status = (
        "overdue"
        if payload.due_date is not None
        and payload.due_date < _business_date(now)
        and calculated["totals"]["balance_paise"] > 0
        else "issued"
    )
    issued_fields = {
        **calculated,
        "invoice_number": invoice_number,
        "financial_year": fy_key,
        "sequence_number": sequence,
        "status": status,
        "issued_at": now,
        "issued_by": auth.user_id,
        "updated_at": now,
        "updated_by": auth.user_id,
    }
    try:
        result = await db.invoices.update_one(
            {"_id": oid, "status": "draft", "revision": revision},
            {"$set": issued_fields, "$inc": {"revision": 1}},
        )
    except DuplicateKeyError:
        raise _http_error(409, "invoice_number_conflict", "Invoice number allocation conflicted; retry issuance")
    if result.matched_count == 0:
        latest = await db.invoices.find_one({"_id": oid})
        if latest and latest.get("status") != "draft":
            raise _http_error(409, "invoice_already_issued", "Invoice was issued by another request")
        if latest:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "invoice_revision_conflict",
                    "message": "This draft changed since you reviewed it. Review the refreshed draft, then issue it again.",
                    "invoice": _serialize_invoice(latest),
                },
            )
        raise _http_error(409, "invoice_state_conflict", "Invoice changed concurrently; reload and review it before issuing")
    doc = await db.invoices.find_one({"_id": oid})
    await _audit(db, auth, "invoice.issue", "invoice", oid, {"invoice_number": invoice_number})
    return _serialize_invoice(doc)


@router.post("/invoices/{invoice_id}/duplicate", status_code=201)
async def duplicate_invoice(
    invoice_id: str,
    auth: Annotated[AuthContext, Depends(require_csrf)],
    payload: DuplicateInvoiceInput | None = Body(default=None),
) -> dict[str, Any]:
    source_oid = _object_id(invoice_id, "invoice")
    db = _database()
    source = await db.invoices.find_one({"_id": source_oid})
    if not source:
        raise _http_error(404, "invoice_not_found", "Invoice not found")
    source_input = dict(source["calculation_input"])
    options = payload or DuplicateInvoiceInput()
    new_invoice_date = options.invoice_date or _business_date()
    new_due_date = options.due_date
    if new_due_date is not None and new_due_date < new_invoice_date:
        raise _http_error(
            400,
            "duplicate_due_date_before_invoice_date",
            "Due date cannot be earlier than the resolved invoice date",
        )
    source_input["invoice_date"] = new_invoice_date.isoformat()
    source_input["due_date"] = new_due_date.isoformat() if new_due_date is not None else None
    duplicated_payload = InvoiceDraftInput.model_validate(source_input)
    doc = await _create_draft_document(db, duplicated_payload, auth)
    await _audit(db, auth, "invoice.duplicate", "invoice", doc["_id"], {"source_invoice_id": source_oid})
    return _serialize_invoice(doc)


@router.post("/invoices/{invoice_id}/cancel")
async def cancel_invoice(
    invoice_id: str,
    payload: CancelInvoiceInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(invoice_id, "invoice")
    db = _database()
    existing = await db.invoices.find_one({"_id": oid})
    if not existing:
        raise _http_error(404, "invoice_not_found", "Invoice not found")
    if existing.get("status") == "draft":
        raise _http_error(409, "draft_cannot_be_cancelled", "Issue or edit the draft; only issued invoices can be cancelled")
    if existing.get("status") == "cancelled":
        raise _http_error(409, "invoice_already_cancelled", "Invoice is already cancelled")
    if int((existing.get("totals") or {}).get("settled_paise", 0) or 0) > 0:
        raise _http_error(
            409,
            "invoice_has_settlements",
            "Remove recorded payments and TDS, or use a credit-note workflow, before cancelling this invoice",
        )
    if str((existing.get("e_invoice") or {}).get("irn") or "").strip():
        raise _http_error(
            409,
            "invoice_has_irn",
            "Complete the applicable IRP cancellation workflow and clear the IRN metadata before cancelling locally",
        )
    now = _now()
    result = await db.invoices.update_one(
        {
            "_id": oid,
            "status": {"$in": ["issued", "partially_paid", "paid", "overdue"]},
            "totals.settled_paise": 0,
            "e_invoice.irn": {"$in": [None, ""]},
        },
        {
            "$set": {
                "status": "cancelled",
                "cancel_reason": payload.reason,
                "cancelled_at": now,
                "cancelled_by": auth.user_id,
                "updated_at": now,
                "updated_by": auth.user_id,
            },
            "$inc": {"revision": 1},
        },
    )
    if result.matched_count == 0:
        raise _http_error(409, "invoice_state_conflict", "Invoice state changed; reload and retry")
    doc = await db.invoices.find_one({"_id": oid})
    await _audit(db, auth, "invoice.cancel", "invoice", oid, {"reason": payload.reason})
    return _serialize_invoice(doc)


@router.put("/invoices/{invoice_id}/e-invoice")
async def update_e_invoice_metadata(
    invoice_id: str,
    payload: EInvoiceMetadataInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(invoice_id, "invoice")
    db = _database()
    existing = await db.invoices.find_one({"_id": oid})
    if not existing:
        raise _http_error(404, "invoice_not_found", "Invoice not found")
    if existing.get("status") == "draft":
        raise _http_error(409, "invoice_not_issued", "E-invoice metadata can only be attached after issue")
    if existing.get("status") == "cancelled":
        raise _http_error(409, "cancelled_invoice_immutable", "E-invoice metadata cannot be changed after local cancellation")
    now = _now()
    metadata = {
        "irn": payload.irn,
        "ack_number": payload.ack_number,
        "ack_date": _at_utc_midnight(payload.ack_date) if payload.ack_date else None,
        "signed_qr_data": payload.signed_qr_data,
        "source": "manual",
        "updated_at": now,
        "updated_by": auth.user_id,
    }
    result = await db.invoices.update_one(
        {"_id": oid, "status": {"$in": ["issued", "partially_paid", "paid", "overdue"]}},
        {"$set": {"e_invoice": metadata, "updated_at": now, "updated_by": auth.user_id}, "$inc": {"revision": 1}},
    )
    if result.matched_count == 0:
        raise _http_error(409, "invoice_state_conflict", "Invoice state changed; reload and retry")
    doc = await db.invoices.find_one({"_id": oid})
    await _audit(
        db,
        auth,
        "invoice.e_invoice_metadata_update",
        "invoice",
        oid,
        {"has_irn": bool(payload.irn), "has_ack": bool(payload.ack_number), "has_qr": bool(payload.signed_qr_data)},
    )
    return _serialize_invoice(doc)


@router.post("/invoices/{invoice_id}/payments", status_code=201)
async def add_payment(
    invoice_id: str,
    payload: PaymentInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(invoice_id, "invoice")
    db = _database()
    now = _now()
    if payload.payment_date > _business_date(now):
        raise _http_error(400, "payment_date_in_future", "Payment date cannot be later than the current business date")
    amount_paise = _to_paise(payload.amount)
    tds_paise = _to_paise(payload.tds_withheld_amount)
    settlement_paise = amount_paise + tds_paise
    _ensure_safe_paise(amount_paise, tds_paise, settlement_paise)
    payment_id = ObjectId()
    payment = {
        "_id": payment_id,
        **_money_pair("amount", amount_paise),
        **_money_pair("tds_withheld", tds_paise),
        **_money_pair("settlement", settlement_paise),
        "payment_date": _at_utc_midnight(payload.payment_date),
        "method": payload.method,
        "reference": payload.reference,
        "notes": payload.notes,
        "created_at": now,
        "created_by": auth.user_id,
    }
    doc = None
    for _ in range(3):
        existing = await db.invoices.find_one({"_id": oid})
        if not existing:
            raise _http_error(404, "invoice_not_found", "Invoice not found")
        if existing.get("status") == "draft":
            raise _http_error(409, "invoice_not_issued", "Payments can only be added to issued invoices")
        if existing.get("status") == "cancelled":
            raise _http_error(409, "invoice_cancelled", "Payments cannot be changed on a cancelled invoice")
        invoice_date_value = existing.get("invoice_date")
        stored_invoice_date = (
            _as_utc(invoice_date_value).date() if isinstance(invoice_date_value, datetime) else invoice_date_value
        )
        if isinstance(stored_invoice_date, date) and payload.payment_date < stored_invoice_date:
            raise _http_error(400, "payment_date_before_invoice", "Payment date cannot be earlier than the invoice date")
        totals = existing.get("totals", {})
        balance_paise = int(totals.get("balance_paise", 0))
        if settlement_paise > balance_paise:
            raise _http_error(409, "payment_exceeds_balance", "Payment plus TDS exceeds the outstanding balance")
        received_paise = int(totals.get("received_paise", 0)) + amount_paise
        withheld_paise = int(totals.get("tds_withheld_paise", 0)) + tds_paise
        settled_paise = int(totals.get("settled_paise", 0)) + settlement_paise
        new_balance_paise = balance_paise - settlement_paise
        _ensure_safe_paise(received_paise, withheld_paise, settled_paise, new_balance_paise)
        new_status = _payment_status_values(new_balance_paise, settled_paise, existing.get("due_date"))
        revision = int(existing.get("revision", 1))
        result = await db.invoices.update_one(
            {
                "_id": oid,
                "revision": revision,
                "status": existing.get("status"),
                "totals.balance_paise": balance_paise,
            },
            {
                "$push": {"payments": payment},
                "$set": {
                    "totals.received_paise": received_paise,
                    "totals.received_display": _display_paise(received_paise),
                    "totals.tds_withheld_paise": withheld_paise,
                    "totals.tds_withheld_display": _display_paise(withheld_paise),
                    "totals.settled_paise": settled_paise,
                    "totals.settled_display": _display_paise(settled_paise),
                    "totals.paid_paise": settled_paise,
                    "totals.paid_display": _display_paise(settled_paise),
                    "totals.balance_paise": new_balance_paise,
                    "totals.balance_display": _display_paise(new_balance_paise),
                    "status": new_status,
                    "updated_at": now,
                    "updated_by": auth.user_id,
                },
                "$inc": {"revision": 1},
            },
        )
        if result.matched_count:
            doc = await db.invoices.find_one({"_id": oid})
            break
    if doc is None:
        raise _http_error(409, "payment_state_conflict", "Invoice changed concurrently; reload and retry")
    await _audit(
        db,
        auth,
        "payment.add",
        "invoice",
        oid,
        {"payment_id": payment_id, "amount_paise": amount_paise, "tds_withheld_paise": tds_paise},
    )
    return _serialize_invoice(doc)


@router.delete("/invoices/{invoice_id}/payments/{payment_id}")
async def delete_payment(
    invoice_id: str,
    payment_id: str,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(invoice_id, "invoice")
    payment_oid = _object_id(payment_id, "payment")
    db = _database()
    doc = None
    for _ in range(3):
        existing = await db.invoices.find_one({"_id": oid})
        if not existing:
            raise _http_error(404, "invoice_not_found", "Invoice not found")
        if existing.get("status") == "cancelled":
            raise _http_error(409, "invoice_cancelled", "Payments cannot be changed on a cancelled invoice")
        if existing.get("status") == "draft":
            raise _http_error(409, "invoice_not_issued", "Draft invoices do not have payments")
        payment = next((item for item in existing.get("payments", []) if item.get("_id") == payment_oid), None)
        if not payment:
            raise _http_error(404, "payment_not_found", "Payment not found")
        amount_paise = int(payment.get("amount_paise", 0))
        tds_paise = int(payment.get("tds_withheld_paise", 0))
        settlement_paise = int(payment.get("settlement_paise", amount_paise + tds_paise))
        totals = existing.get("totals", {})
        received_paise = int(totals.get("received_paise", 0)) - amount_paise
        withheld_paise = int(totals.get("tds_withheld_paise", 0)) - tds_paise
        settled_paise = int(totals.get("settled_paise", 0)) - settlement_paise
        balance_paise = int(totals.get("balance_paise", 0)) + settlement_paise
        if min(received_paise, withheld_paise, settled_paise) < 0:
            raise _http_error(409, "payment_totals_invalid", "Stored payment totals are inconsistent")
        _ensure_safe_paise(received_paise, withheld_paise, settled_paise, balance_paise)
        new_status = _payment_status_values(balance_paise, settled_paise, existing.get("due_date"))
        revision = int(existing.get("revision", 1))
        result = await db.invoices.update_one(
            {
                "_id": oid,
                "revision": revision,
                "status": existing.get("status"),
                "payments._id": payment_oid,
            },
            {
                "$pull": {"payments": {"_id": payment_oid}},
                "$set": {
                    "totals.received_paise": received_paise,
                    "totals.received_display": _display_paise(received_paise),
                    "totals.tds_withheld_paise": withheld_paise,
                    "totals.tds_withheld_display": _display_paise(withheld_paise),
                    "totals.settled_paise": settled_paise,
                    "totals.settled_display": _display_paise(settled_paise),
                    "totals.paid_paise": settled_paise,
                    "totals.paid_display": _display_paise(settled_paise),
                    "totals.balance_paise": balance_paise,
                    "totals.balance_display": _display_paise(balance_paise),
                    "status": new_status,
                    "updated_at": _now(),
                    "updated_by": auth.user_id,
                },
                "$inc": {"revision": 1},
            },
        )
        if result.matched_count:
            doc = await db.invoices.find_one({"_id": oid})
            break
    if doc is None:
        raise _http_error(409, "payment_state_conflict", "Invoice changed concurrently; reload and retry")
    await _audit(db, auth, "payment.delete", "invoice", oid, {"payment_id": payment_oid})
    return _serialize_invoice(doc)


@router.get("/dashboard")
async def dashboard(auth: Annotated[AuthContext, Depends(require_auth)]) -> dict[str, Any]:
    del auth
    db = _database()
    receivable_paise = revenue_paise = overdue_paise = 0
    overdue_count = draft_count = 0
    ageing = {
        "current": {"label": "Not overdue", "count": 0, "amount_paise": 0},
        "1_30": {"label": "1–30 days", "count": 0, "amount_paise": 0},
        "31_60": {"label": "31–60 days", "count": 0, "amount_paise": 0},
        "61_90": {"label": "61–90 days", "count": 0, "amount_paise": 0},
        "over_90": {"label": "Over 90 days", "count": 0, "amount_paise": 0},
    }
    today = _business_date()
    cursor = db.invoices.find(
        {},
        {"status": 1, "totals.grand_total_paise": 1, "totals.balance_paise": 1, "due_date": 1},
    )
    async for doc in cursor:
        status = doc.get("status")
        totals = doc.get("totals", {})
        grand_total = int(totals.get("grand_total_paise", 0))
        balance = int(totals.get("balance_paise", 0))
        _ensure_safe_paise(grand_total, balance)
        if status == "draft":
            draft_count += 1
            continue
        if status == "cancelled":
            continue
        revenue_paise += grand_total
        receivable_paise += max(0, balance)
        due = doc.get("due_date")
        days_overdue = (today - _as_utc(due).date()).days if isinstance(due, datetime) else 0
        if balance <= 0 or days_overdue <= 0:
            bucket = "current"
        elif days_overdue <= 30:
            bucket = "1_30"
        elif days_overdue <= 60:
            bucket = "31_60"
        elif days_overdue <= 90:
            bucket = "61_90"
        else:
            bucket = "over_90"
        if balance > 0:
            ageing[bucket]["count"] += 1
            ageing[bucket]["amount_paise"] += balance
        if days_overdue > 0 and balance > 0:
            overdue_count += 1
            overdue_paise += balance

    aggregate_paise_values = [receivable_paise, revenue_paise, overdue_paise]
    aggregate_paise_values.extend(int(bucket["amount_paise"]) for bucket in ageing.values())
    _ensure_safe_paise(*aggregate_paise_values)
    for bucket in ageing.values():
        bucket["amount_display"] = _display_paise(bucket["amount_paise"])
    recent = await db.invoices.find({}).sort("created_at", DESCENDING).limit(10).to_list(10)
    return {
        "currency": "INR",
        **_money_pair("receivable", receivable_paise),
        **_money_pair("revenue", revenue_paise),
        **_money_pair("overdue", overdue_paise),
        "overdue_count": overdue_count,
        "draft_count": draft_count,
        "ageing_buckets": ageing,
        "recent_invoices": [_serialize_invoice(doc) for doc in recent],
        "generated_at": _iso_datetime(_now()),
    }


@router.get("/activity")
async def activity(
    auth: Annotated[AuthContext, Depends(require_auth)],
    entity_type: str | None = Query(default=None, max_length=80),
    entity_id: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> dict[str, Any]:
    del auth
    db = _database()
    query: dict[str, Any] = {}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    total = await db.invoice_audit.count_documents(query)
    docs = await db.invoice_audit.find(query).sort("created_at", DESCENDING).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [_serialize_document(doc) for doc in docs], "total": total, "page": page, "page_size": page_size}


@router.get("/metadata")
async def metadata(auth: Annotated[AuthContext, Depends(require_auth)]) -> dict[str, Any]:
    del auth
    return {
        "business_date": _business_date().isoformat(),
        "business_timezone": BUSINESS_TIMEZONE_NAME,
        "business_utc_offset": BUSINESS_UTC_OFFSET,
        "states": INDIAN_STATES,
        "units": COMMON_UNITS,
        "gst_rates": COMMON_GST_RATES,
        "payment_methods": PAYMENT_METHODS,
        "invoice_statuses": INVOICE_STATUSES,
        "quotation_statuses": QUOTATION_STATUSES,
        "customer_types": ["business", "individual"],
        "item_types": ["goods", "service"],
        "gst_registration_modes": list(GST_REGISTRATION_MODES),
        "gstin_validation": {
            "format": True,
            "checksum": "offline",
            "state_prefix": True,
            "portal_verification": False,
        },
        "capabilities": {
            "irp_connected": False,
            "e_invoice_metadata_entry": "manual",
            "pdf": True,
            "payments": True,
            "tds_withholding": True,
        },
    }


@router.get("/invoices/{invoice_id}/pdf")
async def invoice_pdf(
    invoice_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
    inline: bool = Query(default=False),
) -> Response:
    del auth
    oid = _object_id(invoice_id, "invoice")
    db = _database()
    doc = await db.invoices.find_one({"_id": oid})
    if not doc:
        raise _http_error(404, "invoice_not_found", "Invoice not found")
    invoice = _serialize_invoice(doc)
    try:
        pdf_bytes = await run_in_threadpool(render_invoice_pdf, invoice)
    except SignedQrEncodingError:
        raise _http_error(
            422,
            "invoice_pdf_signed_qr_unrenderable",
            "The saved signed QR payload exceeds the PDF QR encoding capacity. Update the e-invoice metadata and try again.",
        )
    identifier = invoice.get("invoice_number") or f"Draft-{invoice['id']}"
    safe_identifier = re.sub(r"[^A-Za-z0-9._-]+", "-", identifier).strip("-") or "Invoice"
    disposition = "inline" if inline else "attachment"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="Suvi-Interior-{safe_identifier}.pdf"',
            "Cache-Control": "private, no-store, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


# Quotations deliberately share validated party/line input and the authoritative
# calculation engine, but use separate persistence, numbering, lifecycle and PDFs.
QUOTATION_STATUSES = ["draft", "sent", "accepted", "declined", "expired", "converted"]
_QUOTATION_EDITABLE_FIELDS = (
    "customer_snapshot",
    "quotation_date",
    "valid_until",
    "place_of_supply",
    "lines",
    "project_reference",
    "po_reference",
    "reverse_charge",
    "tax_mode",
    "notes",
    "terms",
    "post_tax_adjustment_label",
    "post_tax_adjustment_amount",
)
_QUOTATION_SNAPSHOT_FIELDS = (
    "supplier_snapshot",
    "customer_snapshot",
    "customer_id",
    "quotation_date",
    "valid_until",
    "place_of_supply",
    "lines",
    "project_reference",
    "po_reference",
    "reverse_charge",
    "tax_mode",
    "tax_regime",
    "document_title",
    "notes",
    "terms",
    "post_tax_adjustment_label",
    "totals",
    "calculation_input",
)
_QUOTATION_TOTAL_NAMES = (
    "subtotal",
    "discount",
    "taxable",
    "cgst",
    "sgst",
    "igst",
    "total_tax",
    "post_tax_adjustment",
    "round_off",
    "grand_total",
)


class QuotationDraftInput(APIModel):
    customer_snapshot: InvoiceCustomerSnapshot
    quotation_date: date
    valid_until: date
    place_of_supply: StateReference
    lines: list[InvoiceLineInput] = Field(min_length=1, max_length=200)
    project_reference: str = Field(default="", max_length=240)
    po_reference: str = Field(default="", max_length=240)
    reverse_charge: bool = False
    tax_mode: Literal["auto", "no_tax"] = "auto"
    notes: str = Field(default="", max_length=5000)
    terms: str = Field(default="", max_length=5000)
    post_tax_adjustment_label: str = Field(default="", max_length=160)
    post_tax_adjustment_amount: Decimal = Field(
        default=ZERO,
        ge=-MAX_MONEY,
        le=MAX_MONEY,
        max_digits=14,
        decimal_places=2,
    )

    @field_validator("post_tax_adjustment_amount")
    @classmethod
    def validate_adjustment(cls, value: Decimal) -> Decimal:
        if not value.is_finite():
            raise ValueError("post_tax_adjustment_amount must be finite")
        return value

    @model_validator(mode="after")
    def validate_dates_and_adjustment(self) -> "QuotationDraftInput":
        if self.valid_until < self.quotation_date:
            raise ValueError("valid_until cannot be earlier than quotation_date")
        if self.post_tax_adjustment_amount != ZERO and not self.post_tax_adjustment_label:
            raise ValueError("post_tax_adjustment_label is required for a non-zero adjustment")
        return self


class QuotationUpdateInput(QuotationDraftInput):
    expected_revision: int = Field(ge=1, le=MAX_SAFE_INTEGER)


class QuotationRevisionInput(APIModel):
    expected_revision: int = Field(ge=1, le=MAX_SAFE_INTEGER)


class QuotationStatusInput(APIModel):
    expected_revision: int = Field(ge=1, le=MAX_SAFE_INTEGER)
    status: Literal["accepted", "declined", "expired"]


class DuplicateQuotationInput(APIModel):
    expected_revision: int = Field(ge=1, le=MAX_SAFE_INTEGER)
    quotation_date: date | None = None
    valid_until: date | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "DuplicateQuotationInput":
        if self.quotation_date and self.valid_until and self.valid_until < self.quotation_date:
            raise ValueError("valid_until cannot be earlier than quotation_date")
        return self


class ConvertQuotationInput(APIModel):
    expected_revision: int = Field(ge=1, le=MAX_SAFE_INTEGER)
    invoice_date: date
    due_date: date | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "ConvertQuotationInput":
        if self.due_date is not None and self.due_date < self.invoice_date:
            raise ValueError("due_date cannot be earlier than invoice_date")
        return self


def _quotation_draft_payload(payload: QuotationUpdateInput) -> QuotationDraftInput:
    return QuotationDraftInput.model_validate(payload.model_dump(mode="json", exclude={"expected_revision"}))


def _quotation_as_invoice_payload(payload: QuotationDraftInput) -> InvoiceDraftInput:
    data = payload.model_dump(mode="json")
    data["invoice_date"] = data.pop("quotation_date")
    data["due_date"] = data.pop("valid_until")
    return InvoiceDraftInput.model_validate(data)


def _invoice_input_from_quotation(
    payload: QuotationDraftInput,
    invoice_date: date,
    due_date: date | None,
) -> InvoiceDraftInput:
    data = payload.model_dump(mode="json")
    data.pop("quotation_date", None)
    data.pop("valid_until", None)
    data["invoice_date"] = invoice_date.isoformat()
    data["due_date"] = due_date.isoformat() if due_date is not None else None
    return InvoiceDraftInput.model_validate(data)


def _calculate_quotation(payload: QuotationDraftInput, settings: dict[str, Any]) -> dict[str, Any]:
    """Adapt the invoice calculator without persisting invoice lifecycle/payment semantics."""
    invoice_calculation = _calculate_invoice(_quotation_as_invoice_payload(payload), settings)
    invoice_totals = invoice_calculation["totals"]
    totals = {
        key: copy.deepcopy(invoice_totals[key])
        for name in _QUOTATION_TOTAL_NAMES
        for key in (f"{name}_paise", f"{name}_display")
    }
    return {
        "supplier_snapshot": copy.deepcopy(invoice_calculation["supplier_snapshot"]),
        "customer_snapshot": copy.deepcopy(invoice_calculation["customer_snapshot"]),
        "customer_id": invoice_calculation["customer_id"],
        "quotation_date": invoice_calculation["invoice_date"],
        "valid_until": invoice_calculation["due_date"],
        "place_of_supply": copy.deepcopy(invoice_calculation["place_of_supply"]),
        "lines": copy.deepcopy(invoice_calculation["lines"]),
        "project_reference": invoice_calculation["project_reference"],
        "po_reference": invoice_calculation["po_reference"],
        "reverse_charge": invoice_calculation["reverse_charge"],
        "tax_mode": invoice_calculation["tax_mode"],
        "tax_regime": invoice_calculation["tax_regime"],
        "document_title": "QUOTATION",
        "notes": invoice_calculation["notes"],
        "terms": invoice_calculation["terms"],
        "post_tax_adjustment_label": invoice_calculation["post_tax_adjustment_label"],
        "totals": totals,
        "calculation_input": payload.model_dump(mode="json"),
    }


def _quotation_draft_input_projection(doc: dict[str, Any]) -> dict[str, Any]:
    source = doc.get("calculation_input")
    if not isinstance(source, dict):
        return {}
    return {field: _api_value(source[field]) for field in _QUOTATION_EDITABLE_FIELDS if field in source}


def _serialize_quotation(doc: dict[str, Any]) -> dict[str, Any]:
    _ensure_safe_paise_fields(doc)
    excluded = {
        "_id",
        "calculation_input",
        "number_allocation",
        "send_operation",
        "duplicate_operation",
        "duplicate_operation_id",
    }
    output = {key: _api_value(value) for key, value in doc.items() if key not in excluded}
    output["id"] = str(doc["_id"])
    output["quotation_date"] = _date_string(doc.get("quotation_date"))
    output["valid_until"] = _date_string(doc.get("valid_until"))
    output["send_pending"] = doc.get("status") == "sent" and "number_allocation" in doc
    output["draft_input"] = _quotation_draft_input_projection(doc)

    calculation_input = doc.get("calculation_input")
    input_lines = calculation_input.get("lines") or [] if isinstance(calculation_input, dict) else []
    if not isinstance(input_lines, list):
        input_lines = []
    for index, line in enumerate(output.get("lines") or []):
        if not isinstance(line, dict) or "input_gst_rate" in line or index >= len(input_lines):
            continue
        input_line = input_lines[index]
        if isinstance(input_line, dict) and "gst_rate" in input_line:
            line["input_gst_rate"] = _api_value(input_line["gst_rate"])
    return output


def _quotation_conflict(code: str, message: str, quotation: dict[str, Any]) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": code, "message": message, "quotation": _serialize_quotation(quotation)},
    )


def _require_quotation_revision(quotation: dict[str, Any], expected_revision: int) -> int:
    revision = int(quotation.get("revision", 1))
    if expected_revision != revision:
        raise _quotation_conflict(
            "quotation_revision_conflict",
            "This quotation changed since you reviewed it. Reload the latest quotation and retry.",
            quotation,
        )
    return revision


def _stored_business_date(value: Any, field: str) -> date:
    if isinstance(value, datetime):
        return _as_utc(value).date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            pass
    raise _http_error(409, "quotation_snapshot_invalid", f"Stored quotation {field} is invalid")


def _prepare_quotation_send_settings(settings: dict[str, Any]) -> dict[str, Any]:
    registration_mode = _normalize_gst_registration_mode(settings.get("gst_registration_mode"))
    if registration_mode not in ISSUABLE_GST_REGISTRATION_MODES:
        raise _http_error(
            409,
            "quotation_gst_registration_decision_required",
            "Choose an explicit GST registration mode (unregistered, regular, or composition) before sending a quotation",
        )
    prepared = {**settings, "gst_registration_mode": registration_mode}
    if registration_mode not in {"regular", "composition"}:
        return prepared

    stored_gstin = str(prepared.get("gstin") or "").strip()
    if not stored_gstin:
        raise _http_error(
            409,
            "quotation_business_gstin_required",
            "Configure the business GSTIN before sending a GST quotation",
        )
    try:
        prepared["gstin"] = _normalize_and_validate_gstin(stored_gstin)
    except ValueError as exc:
        raise _http_error(
            409,
            "quotation_business_gstin_invalid",
            f"Correct the business GSTIN before sending: {exc}",
        )
    business_address = prepared.get("address") or {}
    try:
        _validate_state_pair(
            business_address.get("state", ""),
            business_address.get("state_code", ""),
            required=True,
        )
    except ValueError as exc:
        raise _http_error(
            409,
            "quotation_business_state_required",
            f"Configure a valid business state and state code: {exc}",
        )
    if prepared["gstin"][:2] != business_address["state_code"]:
        raise _http_error(
            409,
            "quotation_business_gstin_state_mismatch",
            "Business GSTIN and address state code do not match",
        )
    return prepared


def _validate_quotation_send_compliance(
    payload: QuotationDraftInput,
    settings: dict[str, Any],
    calculated: dict[str, Any],
) -> None:
    registration_mode = _normalize_gst_registration_mode(settings.get("gst_registration_mode"))
    if registration_mode not in {"regular", "composition"}:
        return

    supplier_missing = _missing_address_fields(settings.get("address") or {})
    if supplier_missing:
        raise _http_error(
            409,
            "quotation_business_address_incomplete",
            "Complete the business address before sending a GST quotation: " + ", ".join(supplier_missing),
        )
    lines_without_codes = [str(index) for index, line in enumerate(payload.lines, start=1) if not line.hsn_sac]
    if lines_without_codes:
        raise _http_error(
            409,
            "quotation_hsn_sac_required",
            "Add an HSN/SAC code to quotation line(s): " + ", ".join(lines_without_codes),
        )

    customer = payload.customer_snapshot
    customer_address = customer.billing_address.model_dump(mode="json")
    address_required = bool(customer.gstin) or int(calculated["totals"]["taxable_paise"]) >= 5_000_000
    customer_missing = _missing_address_fields(customer_address) if address_required else []
    if customer_missing:
        raise _http_error(
            409,
            "quotation_customer_address_incomplete",
            "Complete the customer billing address before sending: " + ", ".join(customer_missing),
        )
    if not customer.shipping_same_as_billing and customer.shipping_address is not None:
        shipping_missing = _missing_address_fields(customer.shipping_address.model_dump(mode="json"))
        if shipping_missing:
            raise _http_error(
                409,
                "quotation_shipping_address_incomplete",
                "Complete the delivery address before sending: " + ", ".join(shipping_missing),
            )


def _new_quotation_document(
    calculated: dict[str, Any],
    auth: AuthContext,
    now: datetime | None = None,
) -> dict[str, Any]:
    timestamp = now or _now()
    return {
        **calculated,
        "status": "draft",
        "created_at": timestamp,
        "created_by": auth.user_id,
        "updated_at": timestamp,
        "updated_by": auth.user_id,
        "revision": 1,
        "schema_version": 1,
    }


async def _create_quotation_draft_document(
    db: Any,
    payload: QuotationDraftInput,
    auth: AuthContext,
) -> dict[str, Any]:
    calculated = _calculate_quotation(payload, await _get_settings_doc(db))
    document = _new_quotation_document(calculated, auth)
    result = await db.quotations.insert_one(document)
    document["_id"] = result.inserted_id
    return document


def _quotation_snapshot(source: dict[str, Any]) -> dict[str, Any]:
    try:
        return {field: copy.deepcopy(source[field]) for field in _QUOTATION_SNAPSHOT_FIELDS}
    except KeyError as exc:
        raise _http_error(
            409,
            "quotation_snapshot_invalid",
            f"Stored quotation snapshot is missing {exc.args[0]}",
        ) from exc


def _invoice_document_title_from_quotation(quotation: dict[str, Any]) -> str:
    if quotation.get("tax_regime") in {"intra_state", "inter_state"}:
        return "TAX INVOICE"
    mode = _normalize_gst_registration_mode((quotation.get("supplier_snapshot") or {}).get("gst_registration_mode"))
    return "BILL OF SUPPLY" if mode in {"regular", "composition"} else "INVOICE"


def _invoice_draft_from_accepted_quotation(
    quotation: dict[str, Any],
    payload: ConvertQuotationInput,
    auth: AuthContext,
) -> dict[str, Any]:
    try:
        quotation_input = QuotationDraftInput.model_validate(quotation["calculation_input"])
    except (KeyError, TypeError, ValueError) as exc:
        raise _http_error(
            409,
            "quotation_snapshot_invalid",
            "The accepted quotation does not contain a valid conversion input snapshot",
        ) from exc
    invoice_input = _invoice_input_from_quotation(quotation_input, payload.invoice_date, payload.due_date)
    snapshot = _quotation_snapshot(quotation)
    lines = snapshot["lines"]
    if not isinstance(lines, list) or not lines:
        raise _http_error(409, "quotation_snapshot_invalid", "The accepted quotation has no line snapshot")
    for line in lines:
        if isinstance(line, dict):
            line["id"] = str(ObjectId())

    totals = copy.deepcopy(snapshot["totals"])
    grand_total_paise = int(totals.get("grand_total_paise", 0))
    _ensure_safe_paise(grand_total_paise)
    for name, value in (
        ("received", 0),
        ("tds_withheld", 0),
        ("settled", 0),
        ("paid", 0),
        ("balance", grand_total_paise),
    ):
        totals.update(_money_pair(name, value))

    now = _now()
    document = {
        "supplier_snapshot": snapshot["supplier_snapshot"],
        "customer_snapshot": snapshot["customer_snapshot"],
        "customer_id": snapshot["customer_id"],
        "invoice_date": _at_utc_midnight(payload.invoice_date),
        "due_date": _at_utc_midnight(payload.due_date) if payload.due_date is not None else None,
        "place_of_supply": snapshot["place_of_supply"],
        "lines": lines,
        "project_reference": snapshot["project_reference"],
        "po_reference": snapshot["po_reference"],
        "reverse_charge": snapshot["reverse_charge"],
        "tax_mode": snapshot["tax_mode"],
        "tax_regime": snapshot["tax_regime"],
        "document_title": _invoice_document_title_from_quotation(quotation),
        "notes": snapshot["notes"],
        "terms": snapshot["terms"],
        "post_tax_adjustment_label": snapshot["post_tax_adjustment_label"],
        "totals": totals,
        "calculation_input": invoice_input.model_dump(mode="json"),
        "source_quotation_id": quotation["_id"],
        "source_quotation_number": quotation.get("quotation_number", ""),
        "financial_year": None,
        "sequence_number": None,
        "status": "draft",
        "payments": [],
        "e_invoice": {"irn": "", "ack_number": "", "ack_date": None, "signed_qr_data": "", "source": "manual"},
        "cancel_reason": "",
        "cancelled_at": None,
        "cancelled_by": None,
        "issued_at": None,
        "issued_by": None,
        "created_at": now,
        "created_by": auth.user_id,
        "updated_at": now,
        "updated_by": auth.user_id,
        "revision": 1,
        "schema_version": 1,
    }
    return document


async def _reconcile_quotation_conversion(
    db: Any,
    quotation_id: ObjectId,
    invoice: dict[str, Any],
    auth: AuthContext,
    expected_revision: int,
) -> tuple[dict[str, Any], bool]:
    invoice_id = invoice["_id"]
    current = await db.quotations.find_one({"_id": quotation_id})
    if not current:
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    status = current.get("status")
    linked_invoice_id = current.get("converted_invoice_id")
    if linked_invoice_id is not None and str(linked_invoice_id) != str(invoice_id):
        raise _quotation_conflict(
            "quotation_conversion_conflict",
            "Quotation conversion points to a different invoice; manual reconciliation is required.",
            current,
        )
    if status == "converted" and linked_invoice_id is not None:
        return current, False
    if current.get("duplicate_operation"):
        raise _quotation_conflict(
            "quotation_operation_in_progress",
            "Finish the pending quotation duplication before converting it.",
            current,
        )
    revision = _require_quotation_revision(current, expected_revision)
    if status not in {"accepted", "converted"}:
        raise _quotation_conflict(
            "quotation_not_accepted",
            "Only an accepted quotation can be converted to an invoice draft.",
            current,
        )

    now = _now()
    updated = await db.quotations.find_one_and_update(
        {"_id": quotation_id, "status": status, "revision": revision},
        {
            "$set": {
                "status": "converted",
                "converted_invoice_id": invoice_id,
                "converted_at": now,
                "converted_by": auth.user_id,
                "updated_at": now,
                "updated_by": auth.user_id,
            },
            "$inc": {"revision": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if updated:
        return updated, True
    latest = await db.quotations.find_one({"_id": quotation_id})
    if not latest:
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    latest_link = latest.get("converted_invoice_id")
    if latest.get("status") == "converted" and latest_link is not None and str(latest_link) == str(invoice_id):
        return latest, False
    raise _quotation_conflict(
        "quotation_revision_conflict",
        "Quotation changed while its invoice conversion was being reconciled. Reload and retry.",
        latest,
    )


async def _allocate_quotation_sequence(
    db: Any,
    financial_year: str,
    operation_id: str,
) -> int:
    """Allocate exactly once for one durable send operation."""
    now = _now()
    update = [
        {
            "$set": {
                "prefix": {"$ifNull": ["$prefix", "QUO"]},
                "financial_year": {"$ifNull": ["$financial_year", financial_year]},
                "created_at": {"$ifNull": ["$created_at", now]},
                "sequence": {"$ifNull": ["$sequence", 0]},
                "allocations": {"$ifNull": ["$allocations", []]},
            }
        },
        {
            "$set": {
                "_allocation_exists": {
                    "$in": [
                        operation_id,
                        {
                            "$map": {
                                "input": "$allocations",
                                "as": "allocation",
                                "in": "$$allocation.operation_id",
                            }
                        },
                    ]
                }
            }
        },
        {
            "$set": {
                "_next_sequence": {
                    "$cond": [
                        "$_allocation_exists",
                        "$sequence",
                        {"$add": ["$sequence", 1]},
                    ]
                }
            }
        },
        {
            "$set": {
                "_pending_allocation": {
                    "operation_id": operation_id,
                    "sequence": "$_next_sequence",
                    "created_at": now,
                }
            }
        },
        {
            "$set": {
                "sequence": "$_next_sequence",
                "allocations": {
                    "$cond": [
                        "$_allocation_exists",
                        "$allocations",
                        {
                            "$concatArrays": [
                                "$allocations",
                                {
                                    "$map": {
                                        "input": [0],
                                        "as": "unused",
                                        "in": "$_pending_allocation",
                                    }
                                },
                            ]
                        },
                    ]
                },
                "updated_at": now,
            }
        },
    ]

    counter = None
    for attempt in range(2):
        try:
            counter = await db.quotation_counters.find_one_and_update(
                {"_id": financial_year},
                update,
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            break
        except DuplicateKeyError as exc:
            # Two unrelated first allocations can race to create the FY counter.
            # One bounded retry now targets the counter created by the winner.
            if attempt:
                raise _http_error(
                    409,
                    "quotation_sequence_failed",
                    "Quotation number could not be allocated; retry sending the quotation",
                ) from exc

    if not counter:
        counter = await db.quotation_counters.find_one({"_id": financial_year})
    allocation = next(
        (
            item.get("sequence")
            for item in (counter.get("allocations") or [])
            if isinstance(item, dict) and item.get("operation_id") == operation_id
        ),
        None,
    ) if counter else None
    if not isinstance(allocation, int) or isinstance(allocation, bool) or allocation < 1:
        raise _http_error(409, "quotation_sequence_failed", "Quotation number could not be allocated")
    return allocation


async def _mark_quotation_sequence_completed(
    db: Any,
    financial_year: str,
    operation_id: str,
) -> None:
    """Retain allocation evidence and record its first successful completion."""
    now = _now()
    try:
        await db.quotation_counters.update_one(
            {
                "_id": financial_year,
                "allocations": {
                    "$elemMatch": {
                        "operation_id": operation_id,
                        "completed_at": {"$exists": False},
                    }
                },
            },
            {
                "$set": {
                    "allocations.$.completed_at": now,
                    "updated_at": now,
                }
            },
        )
    except Exception:
        # The operation mapping itself remains durable even if annotating it fails.
        logger.exception("Unable to mark quotation number allocation %s completed", operation_id)


async def _complete_pending_quotation_send(
    db: Any,
    quotation: dict[str, Any],
    auth: AuthContext,
) -> dict[str, Any]:
    allocation = quotation.get("number_allocation")
    if "number_allocation" not in quotation:
        return quotation
    if not isinstance(allocation, dict):
        raise _quotation_conflict(
            "quotation_state_conflict",
            "Quotation number allocation metadata is invalid.",
            quotation,
        )
    if quotation.get("status") != "sent":
        raise _quotation_conflict(
            "quotation_state_conflict",
            "Quotation number allocation is attached to an invalid lifecycle state.",
            quotation,
        )
    operation_id = str(allocation.get("operation_id") or "")
    financial_year = str(allocation.get("financial_year") or "")
    financial_year_label = str(allocation.get("financial_year_label") or "")
    if not re.fullmatch(r"[0-9a-f]{24}", operation_id) or not re.fullmatch(r"\d{4}-\d{4}", financial_year):
        raise _quotation_conflict(
            "quotation_state_conflict",
            "Quotation number allocation metadata is invalid.",
            quotation,
        )
    if not re.fullmatch(r"\d{2}-\d{2}", financial_year_label):
        raise _quotation_conflict(
            "quotation_state_conflict",
            "Quotation financial-year label is invalid.",
            quotation,
        )

    revision_value = quotation.get("revision", 1)
    base_revision = allocation.get("base_revision")
    if (
        not isinstance(revision_value, int)
        or isinstance(revision_value, bool)
        or not isinstance(base_revision, int)
        or isinstance(base_revision, bool)
        or base_revision < 1
        or revision_value != base_revision + 1
    ):
        raise _quotation_conflict(
            "quotation_state_conflict",
            "Quotation send revision metadata is invalid.",
            quotation,
        )
    revision = revision_value
    sequence = await _allocate_quotation_sequence(db, financial_year, operation_id)
    quotation_number = f"QUO/{financial_year_label}/{sequence:04d}"
    now = _now()
    created_at = allocation.get("created_at")
    send_operation = {
        "operation_id": operation_id,
        "base_revision": base_revision,
        "financial_year": financial_year,
        "financial_year_label": financial_year_label,
        "sequence_number": sequence,
        "quotation_number": quotation_number,
        "created_at": created_at if isinstance(created_at, datetime) else now,
        "completed_at": now,
        "completed_revision": revision + 1,
    }
    try:
        completed = await db.quotations.find_one_and_update(
            {
                "_id": quotation["_id"],
                "status": "sent",
                "revision": revision,
                "number_allocation.operation_id": operation_id,
            },
            {
                "$set": {
                    "quotation_number": quotation_number,
                    "sequence_number": sequence,
                    "send_operation": send_operation,
                    "updated_at": now,
                    "updated_by": auth.user_id,
                },
                "$unset": {"number_allocation": ""},
                "$inc": {"revision": 1},
            },
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError as exc:
        raise _http_error(
            409,
            "quotation_number_conflict",
            "Quotation number allocation conflicted; retry sending the quotation",
        ) from exc
    if not completed:
        latest = await db.quotations.find_one({"_id": quotation["_id"]})
        latest_operation = latest.get("send_operation") if latest else None
        if (
            latest
            and latest.get("quotation_number")
            and isinstance(latest_operation, dict)
            and latest_operation.get("operation_id") == operation_id
            and latest_operation.get("quotation_number") == latest.get("quotation_number")
        ):
            await _mark_quotation_sequence_completed(db, financial_year, operation_id)
            return latest
        if latest:
            raise _quotation_conflict(
                "quotation_revision_conflict",
                "Quotation changed while its number was being finalized. Reload and retry.",
                latest,
            )
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    await _mark_quotation_sequence_completed(db, financial_year, operation_id)
    await _audit(
        db,
        auth,
        "quotation.send",
        "quotation",
        quotation["_id"],
        {"quotation_number": quotation_number, "revision": int(completed["revision"])},
    )
    return completed


async def _materialize_quotation_lifecycle(
    db: Any,
    quotation: dict[str, Any],
    auth: AuthContext,
) -> dict[str, Any]:
    current = quotation
    if current.get("duplicate_operation"):
        return current
    if "number_allocation" in current:
        current = await _complete_pending_quotation_send(db, current, auth)
    if current.get("status") != "sent":
        return current
    valid_until = _stored_business_date(current.get("valid_until"), "valid_until")
    if valid_until >= _business_date():
        return current

    revision = int(current.get("revision", 1))
    now = _now()
    expired = await db.quotations.find_one_and_update(
        {
            "_id": current["_id"],
            "status": "sent",
            "revision": revision,
            "valid_until": {"$lt": _at_utc_midnight(_business_date(now))},
        },
        {
            "$set": {
                "status": "expired",
                "status_changed_at": now,
                "status_changed_by": auth.user_id,
                "expired_at": now,
                "expired_by": auth.user_id,
                "updated_at": now,
                "updated_by": auth.user_id,
            },
            "$inc": {"revision": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not expired:
        return await db.quotations.find_one({"_id": current["_id"]}) or current
    await _audit(
        db,
        auth,
        "quotation.status",
        "quotation",
        current["_id"],
        {"from": "sent", "to": "expired", "automatic_expiry": True, "revision": int(expired["revision"])},
    )
    return expired


async def _materialize_due_quotation_lifecycle(db: Any, auth: AuthContext) -> None:
    cutoff = _at_utc_midnight(_business_date())
    query = {
        "status": "sent",
        "$or": [
            {"number_allocation": {"$exists": True}},
            {"valid_until": {"$lt": cutoff}},
        ],
    }
    async for quotation in db.quotations.find(query):
        try:
            await _materialize_quotation_lifecycle(db, quotation, auth)
        except Exception:
            logger.exception(
                "Unable to materialize quotation lifecycle for %s; continuing register read",
                quotation.get("_id"),
            )


@router.post("/quotations", status_code=201)
async def create_quotation(
    payload: QuotationDraftInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    db = _database()
    doc = await _create_quotation_draft_document(db, payload, auth)
    await _audit(
        db,
        auth,
        "quotation.create",
        "quotation",
        doc["_id"],
        {"customer": payload.customer_snapshot.display_name, "revision": 1},
    )
    return _serialize_quotation(doc)


@router.get("/quotations")
async def list_quotations(
    auth: Annotated[AuthContext, Depends(require_auth)],
    q: str = Query(default="", max_length=200),
    status: Literal["draft", "sent", "accepted", "declined", "expired", "converted"] | None = Query(default=None),
    customer_id: str | None = Query(default=None, max_length=24),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
) -> dict[str, Any]:
    db = _database()
    await _materialize_due_quotation_lifecycle(db, auth)
    query: dict[str, Any] = {}
    if status:
        query["status"] = status
    if customer_id:
        query["customer_id"] = _object_id(customer_id, "customer")
    if date_from or date_to:
        date_query: dict[str, datetime] = {}
        if date_from:
            date_query["$gte"] = _at_utc_midnight(date_from)
        if date_to:
            date_query["$lte"] = _at_utc_midnight(date_to)
        query["quotation_date"] = date_query
    if q:
        pattern = re.compile(re.escape(q), re.IGNORECASE)
        query["$or"] = [
            {"quotation_number": pattern},
            {"customer_snapshot.display_name": pattern},
            {"customer_snapshot.legal_name": pattern},
            {"project_reference": pattern},
            {"po_reference": pattern},
        ]
    total = await db.quotations.count_documents(query)
    docs = await (
        db.quotations.find(query)
        .sort("created_at", DESCENDING)
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list(page_size)
    )
    return {
        "items": [_serialize_quotation(doc) for doc in docs],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/quotation-dashboard")
async def quotation_dashboard(auth: Annotated[AuthContext, Depends(require_auth)]) -> dict[str, Any]:
    db = _database()
    await _materialize_due_quotation_lifecycle(db, auth)
    counts = {status: await db.quotations.count_documents({"status": status}) for status in QUOTATION_STATUSES}
    recent = await db.quotations.find({}).sort("created_at", DESCENDING).limit(10).to_list(10)
    return {
        "counts": counts,
        "total": sum(counts.values()),
        "recent_quotations": [_serialize_quotation(doc) for doc in recent],
        "generated_at": _iso_datetime(_now()),
    }


@router.get("/quotations/{quotation_id}")
async def get_quotation(
    quotation_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> dict[str, Any]:
    oid = _object_id(quotation_id, "quotation")
    db = _database()
    doc = await db.quotations.find_one({"_id": oid})
    if not doc:
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    doc = await _materialize_quotation_lifecycle(db, doc, auth)
    return _serialize_quotation(doc)


@router.put("/quotations/{quotation_id}")
async def update_quotation_draft(
    quotation_id: str,
    payload: QuotationUpdateInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(quotation_id, "quotation")
    db = _database()
    existing = await db.quotations.find_one({"_id": oid})
    if not existing:
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    revision = _require_quotation_revision(existing, payload.expected_revision)
    if existing.get("duplicate_operation"):
        raise _quotation_conflict(
            "quotation_operation_in_progress",
            "Finish the pending quotation duplication before editing it.",
            existing,
        )
    if existing.get("status") != "draft":
        raise _quotation_conflict(
            "quotation_immutable",
            "Only draft quotations can be edited.",
            existing,
        )

    draft_payload = _quotation_draft_payload(payload)
    calculated = _calculate_quotation(draft_payload, await _get_settings_doc(db))
    now = _now()
    updated = await db.quotations.find_one_and_update(
        {"_id": oid, "status": "draft", "revision": revision},
        {
            "$set": {**calculated, "updated_at": now, "updated_by": auth.user_id},
            "$inc": {"revision": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        latest = await db.quotations.find_one({"_id": oid})
        if latest:
            raise _quotation_conflict(
                "quotation_revision_conflict",
                "Quotation changed while it was being updated. Reload the latest quotation and retry.",
                latest,
            )
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    await _audit(
        db,
        auth,
        "quotation.update",
        "quotation",
        oid,
        {"previous_revision": revision, "revision": int(updated["revision"])},
    )
    return _serialize_quotation(updated)


@router.delete("/quotations/{quotation_id}")
async def delete_quotation_draft(
    quotation_id: str,
    auth: Annotated[AuthContext, Depends(require_csrf)],
    expected_revision: int = Query(ge=1, le=MAX_SAFE_INTEGER),
) -> dict[str, Any]:
    oid = _object_id(quotation_id, "quotation")
    db = _database()
    existing = await db.quotations.find_one({"_id": oid})
    if not existing:
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    revision = _require_quotation_revision(existing, expected_revision)
    if existing.get("duplicate_operation"):
        raise _quotation_conflict(
            "quotation_operation_in_progress",
            "Finish the pending quotation duplication before deleting it.",
            existing,
        )
    if existing.get("status") != "draft":
        raise _quotation_conflict(
            "quotation_immutable",
            "Only draft quotations can be deleted.",
            existing,
        )
    result = await db.quotations.delete_one({"_id": oid, "status": "draft", "revision": revision})
    if result.deleted_count == 0:
        latest = await db.quotations.find_one({"_id": oid})
        if latest:
            raise _quotation_conflict(
                "quotation_revision_conflict",
                "Quotation changed while it was being deleted. Reload the latest quotation and retry.",
                latest,
            )
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    await _audit(
        db,
        auth,
        "quotation.delete",
        "quotation",
        oid,
        {"deleted_revision": revision, "customer": (existing.get("customer_snapshot") or {}).get("display_name", "")},
    )
    return {"ok": True, "id": str(oid), "deleted_revision": revision}


@router.post("/quotations/{quotation_id}/send")
async def send_quotation(
    quotation_id: str,
    payload: QuotationRevisionInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(quotation_id, "quotation")
    db = _database()
    existing = await db.quotations.find_one({"_id": oid})
    if not existing:
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    expected_revision = payload.expected_revision
    current_revision = existing.get("revision", 1)
    pending_allocation = existing.get("number_allocation")
    if existing.get("status") == "sent" and isinstance(pending_allocation, dict):
        pending_base_revision = pending_allocation.get("base_revision")
        pending_retry_matches = (
            isinstance(current_revision, int)
            and not isinstance(current_revision, bool)
            and (
                expected_revision == current_revision
                or (
                    isinstance(pending_base_revision, int)
                    and not isinstance(pending_base_revision, bool)
                    and expected_revision == pending_base_revision
                )
            )
        )
        if pending_retry_matches:
            if existing.get("duplicate_operation"):
                raise _quotation_conflict(
                    "quotation_operation_in_progress",
                    "Finish the pending quotation duplication before sending it.",
                    existing,
                )
            completed = await _complete_pending_quotation_send(db, existing, auth)
            return _serialize_quotation(completed)

    completed_operation = existing.get("send_operation")
    if isinstance(completed_operation, dict):
        completed_base_revision = completed_operation.get("base_revision")
        completed_sequence = completed_operation.get("sequence_number")
        if (
            isinstance(completed_base_revision, int)
            and not isinstance(completed_base_revision, bool)
            and expected_revision == completed_base_revision
            and re.fullmatch(r"[0-9a-f]{24}", str(completed_operation.get("operation_id") or ""))
            and completed_operation.get("quotation_number") == existing.get("quotation_number")
            and isinstance(completed_sequence, int)
            and not isinstance(completed_sequence, bool)
            and completed_sequence == existing.get("sequence_number")
            and completed_operation.get("completed_revision") == completed_base_revision + 2
        ):
            return _serialize_quotation(existing)

    revision = _require_quotation_revision(existing, expected_revision)
    if existing.get("duplicate_operation"):
        raise _quotation_conflict(
            "quotation_operation_in_progress",
            "Finish the pending quotation duplication before sending it.",
            existing,
        )
    if existing.get("status") == "sent" and "number_allocation" in existing:
        completed = await _complete_pending_quotation_send(db, existing, auth)
        return _serialize_quotation(completed)
    if existing.get("status") != "draft":
        raise _quotation_conflict(
            "quotation_not_draft",
            "Only a draft quotation can be sent.",
            existing,
        )
    try:
        draft_payload = QuotationDraftInput.model_validate(existing["calculation_input"])
    except (KeyError, TypeError, ValueError) as exc:
        raise _http_error(
            409,
            "quotation_snapshot_invalid",
            "The draft quotation does not contain a valid calculation input snapshot",
        ) from exc
    if draft_payload.valid_until < _business_date():
        raise _quotation_conflict(
            "quotation_validity_elapsed",
            "The quotation validity date has passed. Update the draft before sending it.",
            existing,
        )

    settings = _prepare_quotation_send_settings(await _get_settings_doc(db))
    calculated = _calculate_quotation(draft_payload, settings)
    _validate_quotation_send_compliance(draft_payload, settings, calculated)
    calculation_fields = tuple(calculated.keys())
    if _calculation_review_projection(existing, calculation_fields) != _calculation_review_projection(
        calculated,
        calculation_fields,
    ):
        now = _now()
        refreshed = await db.quotations.find_one_and_update(
            {"_id": oid, "status": "draft", "revision": revision},
            {
                "$set": {**calculated, "updated_at": now, "updated_by": auth.user_id},
                "$inc": {"revision": 1},
            },
            return_document=ReturnDocument.AFTER,
        )
        if not refreshed:
            latest = await db.quotations.find_one({"_id": oid})
            if latest:
                raise _quotation_conflict(
                    "quotation_revision_conflict",
                    "Quotation changed while it was recalculated. Reload and review the latest quotation.",
                    latest,
                )
            raise _http_error(404, "quotation_not_found", "Quotation not found")
        await _audit(
            db,
            auth,
            "quotation.recalculate",
            "quotation",
            oid,
            {"previous_revision": revision, "revision": int(refreshed["revision"])},
        )
        raise HTTPException(
            status_code=409,
            detail={
                "code": "quotation_recalculated",
                "message": "Current business settings changed this quotation. Review the refreshed quotation, then send it again.",
                "quotation": _serialize_quotation(refreshed),
            },
        )

    reviewed_lines = existing.get("lines") or []
    for index, line in enumerate(calculated.get("lines") or []):
        if index < len(reviewed_lines) and isinstance(reviewed_lines[index], dict) and "id" in reviewed_lines[index]:
            line["id"] = reviewed_lines[index]["id"]

    financial_year, financial_year_label = _financial_year(draft_payload.quotation_date)
    operation_id = str(ObjectId())
    now = _now()
    pending = await db.quotations.find_one_and_update(
        {"_id": oid, "status": "draft", "revision": revision},
        {
            "$set": {
                **calculated,
                "financial_year": financial_year,
                "status": "sent",
                "sent_at": now,
                "sent_by": auth.user_id,
                "number_allocation": {
                    "operation_id": operation_id,
                    "base_revision": revision,
                    "financial_year": financial_year,
                    "financial_year_label": financial_year_label,
                    "created_at": now,
                },
                "updated_at": now,
                "updated_by": auth.user_id,
            },
            "$inc": {"revision": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not pending:
        latest = await db.quotations.find_one({"_id": oid})
        if latest:
            raise _quotation_conflict(
                "quotation_revision_conflict",
                "Quotation changed while it was being sent. Reload the latest quotation and retry.",
                latest,
            )
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    sent = await _complete_pending_quotation_send(db, pending, auth)
    return _serialize_quotation(sent)


@router.post("/quotations/{quotation_id}/status")
async def update_quotation_status(
    quotation_id: str,
    payload: QuotationStatusInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    oid = _object_id(quotation_id, "quotation")
    db = _database()
    existing = await db.quotations.find_one({"_id": oid})
    if not existing:
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    revision = _require_quotation_revision(existing, payload.expected_revision)
    if existing.get("duplicate_operation"):
        raise _quotation_conflict(
            "quotation_operation_in_progress",
            "Finish the pending quotation duplication before changing its lifecycle status.",
            existing,
        )
    if existing.get("number_allocation"):
        raise _quotation_conflict(
            "quotation_send_incomplete",
            "Finish the pending quotation send before changing its lifecycle status.",
            existing,
        )
    if existing.get("status") != "sent":
        raise _quotation_conflict(
            "quotation_transition_not_allowed",
            "Only a sent quotation can be accepted, declined, or marked expired.",
            existing,
        )

    valid_until = _stored_business_date(existing.get("valid_until"), "valid_until")
    is_past_validity = valid_until < _business_date()
    if payload.status == "expired" and not is_past_validity:
        raise _quotation_conflict(
            "quotation_not_expired",
            "A quotation can be marked expired only after its valid-until date has passed.",
            existing,
        )
    effective_status = "expired" if is_past_validity else payload.status
    now = _now()
    status_fields: dict[str, Any] = {
        "status": effective_status,
        "status_changed_at": now,
        "status_changed_by": auth.user_id,
        "updated_at": now,
        "updated_by": auth.user_id,
    }
    status_fields[f"{effective_status}_at"] = now
    status_fields[f"{effective_status}_by"] = auth.user_id
    updated = await db.quotations.find_one_and_update(
        {"_id": oid, "status": "sent", "revision": revision},
        {"$set": status_fields, "$inc": {"revision": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        latest = await db.quotations.find_one({"_id": oid})
        if latest:
            raise _quotation_conflict(
                "quotation_revision_conflict",
                "Quotation changed while its status was being updated. Reload and retry.",
                latest,
            )
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    await _audit(
        db,
        auth,
        "quotation.status",
        "quotation",
        oid,
        {
            "from": "sent",
            "to": effective_status,
            "requested_status": payload.status,
            "automatic_expiry": is_past_validity and payload.status != "expired",
            "revision": int(updated["revision"]),
        },
    )
    if effective_status == "expired" and payload.status != "expired":
        raise _quotation_conflict(
            "quotation_expired",
            "This quotation is past its valid-until date and has been marked expired; it cannot be accepted or declined.",
            updated,
        )
    return _serialize_quotation(updated)


@router.post("/quotations/{quotation_id}/duplicate", status_code=201)
async def duplicate_quotation(
    quotation_id: str,
    payload: DuplicateQuotationInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    source_id = _object_id(quotation_id, "quotation")
    db = _database()
    source = await db.quotations.find_one({"_id": source_id})
    if not source:
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    revision = _require_quotation_revision(source, payload.expected_revision)
    if source.get("number_allocation"):
        raise _quotation_conflict(
            "quotation_send_incomplete",
            "Finish the pending quotation send before duplicating it.",
            source,
        )

    operation = source.get("duplicate_operation")
    if operation is not None and not isinstance(operation, dict):
        raise _quotation_conflict(
            "quotation_state_conflict",
            "The pending quotation duplication metadata is invalid.",
            source,
        )
    if operation is None:
        try:
            source_input = copy.deepcopy(source["calculation_input"])
            if payload.quotation_date is not None:
                source_input["quotation_date"] = payload.quotation_date.isoformat()
            if payload.valid_until is not None:
                source_input["valid_until"] = payload.valid_until.isoformat()
            duplicated_input = QuotationDraftInput.model_validate(source_input)
            _quotation_snapshot(source)
        except (KeyError, TypeError, ValueError) as exc:
            raise _http_error(
                409,
                "quotation_snapshot_invalid",
                "The source quotation does not contain a valid duplicable snapshot",
            ) from exc
        now = _now()
        operation = {
            "operation_id": str(ObjectId()),
            "base_revision": revision,
            "quotation_date": duplicated_input.quotation_date.isoformat(),
            "valid_until": duplicated_input.valid_until.isoformat(),
            "created_at": now,
            "created_by": auth.user_id,
        }
        claimed_source = await db.quotations.find_one_and_update(
            {"_id": source_id, "revision": revision, "duplicate_operation": {"$exists": False}},
            {
                "$set": {
                    "duplicate_operation": operation,
                    "updated_at": now,
                    "updated_by": auth.user_id,
                },
                "$inc": {"revision": 1},
            },
            return_document=ReturnDocument.AFTER,
        )
        if not claimed_source:
            latest = await db.quotations.find_one({"_id": source_id})
            if latest:
                raise _quotation_conflict(
                    "quotation_revision_conflict",
                    "Quotation changed while it was being duplicated. Reload the latest quotation and retry.",
                    latest,
                )
            raise _http_error(404, "quotation_not_found", "Quotation not found")
    else:
        claimed_source = source

    operation_id = str(operation.get("operation_id") or "")
    if not re.fullmatch(r"[0-9a-f]{24}", operation_id):
        raise _quotation_conflict(
            "quotation_state_conflict",
            "The pending quotation duplication identifier is invalid.",
            claimed_source,
        )
    try:
        source_input = copy.deepcopy(claimed_source["calculation_input"])
        source_input["quotation_date"] = str(operation["quotation_date"])
        source_input["valid_until"] = str(operation["valid_until"])
        duplicated_input = QuotationDraftInput.model_validate(source_input)
        snapshot = _quotation_snapshot(claimed_source)
    except (KeyError, TypeError, ValueError) as exc:
        raise _http_error(
            409,
            "quotation_snapshot_invalid",
            "The pending quotation duplication does not contain a valid snapshot",
        ) from exc

    duplicated = await db.quotations.find_one({"duplicate_operation_id": operation_id})
    if not duplicated:
        snapshot["quotation_date"] = _at_utc_midnight(duplicated_input.quotation_date)
        snapshot["valid_until"] = _at_utc_midnight(duplicated_input.valid_until)
        snapshot["calculation_input"] = duplicated_input.model_dump(mode="json")
        for line in snapshot.get("lines") or []:
            if isinstance(line, dict):
                line["id"] = str(ObjectId())
        duplicated = _new_quotation_document(snapshot, auth)
        duplicated["duplicate_operation_id"] = operation_id
        try:
            result = await db.quotations.insert_one(duplicated)
            duplicated["_id"] = result.inserted_id
        except DuplicateKeyError:
            duplicated = await db.quotations.find_one({"duplicate_operation_id": operation_id})
            if not duplicated:
                raise _http_error(
                    409,
                    "quotation_duplication_conflict",
                    "Quotation duplication conflicted and could not be reconciled; reload and retry.",
                )

    claimed_revision = int(claimed_source.get("revision", 1))
    now = _now()
    finalized_source = await db.quotations.find_one_and_update(
        {
            "_id": source_id,
            "revision": claimed_revision,
            "duplicate_operation.operation_id": operation_id,
        },
        {
            "$set": {
                "last_duplicated_at": now,
                "last_duplicated_by": auth.user_id,
                "last_duplicated_quotation_id": duplicated["_id"],
                "updated_at": now,
                "updated_by": auth.user_id,
            },
            "$unset": {"duplicate_operation": ""},
            "$inc": {"revision": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not finalized_source:
        latest = await db.quotations.find_one({"_id": source_id})
        if not latest:
            raise _http_error(404, "quotation_not_found", "Quotation not found")
        if str(latest.get("last_duplicated_quotation_id") or "") != str(duplicated["_id"]):
            raise _quotation_conflict(
                "quotation_revision_conflict",
                "Quotation changed while duplication was being finalized. Reload and retry.",
                latest,
            )
    await _audit(
        db,
        auth,
        "quotation.duplicate",
        "quotation",
        duplicated["_id"],
        {
            "source_quotation_id": source_id,
            "source_previous_revision": operation.get("base_revision"),
            "source_revision": int((finalized_source or latest)["revision"]),
        },
    )
    return _serialize_quotation(duplicated)


@router.post("/quotations/{quotation_id}/convert")
async def convert_quotation_to_invoice(
    quotation_id: str,
    payload: ConvertQuotationInput,
    auth: Annotated[AuthContext, Depends(require_csrf)],
) -> dict[str, Any]:
    quotation_oid = _object_id(quotation_id, "quotation")
    db = _database()
    quotation = await db.quotations.find_one({"_id": quotation_oid})
    if not quotation:
        raise _http_error(404, "quotation_not_found", "Quotation not found")

    existing_invoice = await db.invoices.find_one({"source_quotation_id": quotation_oid})
    if existing_invoice:
        reconciled, transitioned = await _reconcile_quotation_conversion(
            db,
            quotation_oid,
            existing_invoice,
            auth,
            payload.expected_revision,
        )
        if transitioned:
            await _audit(
                db,
                auth,
                "quotation.convert",
                "quotation",
                quotation_oid,
                {"invoice_id": existing_invoice["_id"], "reconciled": True},
            )
        return {
            "quotation": _serialize_quotation(reconciled),
            "invoice": _serialize_invoice(existing_invoice),
            "idempotent": True,
        }

    _require_quotation_revision(quotation, payload.expected_revision)
    if quotation.get("duplicate_operation"):
        raise _quotation_conflict(
            "quotation_operation_in_progress",
            "Finish the pending quotation duplication before converting it.",
            quotation,
        )
    if quotation.get("status") != "accepted":
        raise _quotation_conflict(
            "quotation_not_accepted",
            "Only an accepted quotation can be converted to an invoice draft.",
            quotation,
        )

    invoice = _invoice_draft_from_accepted_quotation(quotation, payload, auth)
    created = False
    try:
        result = await db.invoices.insert_one(invoice)
        invoice["_id"] = result.inserted_id
        created = True
    except DuplicateKeyError:
        invoice = await db.invoices.find_one({"source_quotation_id": quotation_oid})
        if not invoice:
            raise _http_error(
                409,
                "quotation_conversion_conflict",
                "Invoice conversion conflicted and could not be reconciled; reload and retry.",
            )

    reconciled, transitioned = await _reconcile_quotation_conversion(
        db,
        quotation_oid,
        invoice,
        auth,
        payload.expected_revision,
    )
    if transitioned:
        await _audit(
            db,
            auth,
            "quotation.convert",
            "quotation",
            quotation_oid,
            {
                "invoice_id": invoice["_id"],
                "quotation_number": quotation.get("quotation_number", ""),
                "reconciled": not created,
            },
        )
    return {
        "quotation": _serialize_quotation(reconciled),
        "invoice": _serialize_invoice(invoice),
        "idempotent": not created,
    }


@router.get("/quotations/{quotation_id}/pdf")
async def quotation_pdf(
    quotation_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
    inline: bool = Query(default=False),
    expected_revision: int | None = Query(default=None, ge=1, le=MAX_SAFE_INTEGER),
) -> Response:
    oid = _object_id(quotation_id, "quotation")
    db = _database()
    doc = await db.quotations.find_one({"_id": oid})
    if not doc:
        raise _http_error(404, "quotation_not_found", "Quotation not found")
    if expected_revision is not None:
        _require_quotation_revision(doc, expected_revision)
    doc = await _materialize_quotation_lifecycle(db, doc, auth)
    if expected_revision is not None:
        _require_quotation_revision(doc, expected_revision)
    quotation = _serialize_quotation(doc)
    rendered_revision = int(doc.get("revision", 1))
    pdf_bytes = await run_in_threadpool(render_quotation_pdf, quotation)
    identifier = quotation.get("quotation_number") or f"Draft-Quotation-{quotation['id']}"
    safe_identifier = re.sub(r"[^A-Za-z0-9._-]+", "-", identifier).strip("-") or "Quotation"
    disposition = "inline" if inline else "attachment"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="Suvi-Interior-{safe_identifier}.pdf"',
            "Cache-Control": "private, no-store, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "X-Quotation-Revision": str(rendered_revision),
            "Access-Control-Expose-Headers": "Content-Disposition, X-Quotation-Revision",
        },
    )
