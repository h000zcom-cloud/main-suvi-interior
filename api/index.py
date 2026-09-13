"""Vercel serverless entrypoint.

Vercel's Python runtime imports the module-level ``app`` object and serves it as an
ASGI function. The application code lives in ``backend/`` as top-level modules, so we
add that directory to ``sys.path`` before importing the FastAPI app.

All backend files (source, fonts, and the brochure image cache) are bundled into the
function through the ``includeFiles`` setting in ``vercel.json``.
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from server import app  # noqa: E402  (import must follow sys.path setup)

# Exposed for the Vercel Python runtime.
__all__ = ["app"]
