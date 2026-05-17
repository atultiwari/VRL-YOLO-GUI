"""Web-mode entry point.

Run with:
    uv run uvicorn server.main:app --reload --port 8000

Or via the helper:
    python scripts/run-web.py
"""

from __future__ import annotations

from vrl_yolo.api import create_app
from vrl_yolo.config import Settings

settings = Settings(mode="web")
app = create_app(settings)
