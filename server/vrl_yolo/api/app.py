from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from vrl_yolo import __version__
from vrl_yolo.api.lifespan import lifespan
from vrl_yolo.api.routers import (
    dataset,
    hardware,
    health,
    inference,
    models,
    presets,
    reports,
    training,
)
from vrl_yolo.config import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Application factory.

    Both `server/main.py` (web) and `src-pyloid/main.py` (desktop) call this
    with mode-specific settings — the rest of the module is mode-agnostic.
    """
    settings = settings or Settings()

    app = FastAPI(
        title="VRL YOLO GUI",
        version=__version__,
        description="Clinician-facing YOLO toolkit for histopathology and hematology.",
        lifespan=lifespan,
    )
    app.state.settings = settings

    if settings.mode == "web":
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    prefix = settings.api_prefix
    app.include_router(health.router, prefix=prefix)
    app.include_router(hardware.router, prefix=prefix)
    app.include_router(models.router, prefix=prefix)
    app.include_router(presets.router, prefix=prefix)
    app.include_router(dataset.router, prefix=prefix)
    app.include_router(inference.router, prefix=prefix)
    app.include_router(training.router, prefix=prefix)
    app.include_router(reports.router, prefix=prefix)

    _mount_frontend(app, settings.static_frontend_path)
    return app


def _mount_frontend(app: FastAPI, static_path: Path | None) -> None:
    """In desktop mode, serve the Next.js static export from the FastAPI app."""
    if static_path is None:
        return
    static_path = Path(static_path)
    if not static_path.is_dir():
        return
    app.mount("/", StaticFiles(directory=str(static_path), html=True), name="frontend")
