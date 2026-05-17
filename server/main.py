"""Web-mode entry point.

Run with:
    uv run uvicorn server.main:app --reload --port 8000

Or via the helper:
    python scripts/run-web.py
"""

from __future__ import annotations

from vrl_yolo.api import create_app
from vrl_yolo.config import Settings
from vrl_yolo.paths import resolve_bundled_models_dir, resolve_storage_root

_storage = resolve_storage_root()
_storage.mkdir(parents=True, exist_ok=True)

settings = Settings(
    mode="web",
    storage_path=_storage,
    bundled_models_path=resolve_bundled_models_dir(),
)
app = create_app(settings)
