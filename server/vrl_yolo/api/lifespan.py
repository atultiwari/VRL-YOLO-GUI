from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from vrl_yolo.config import Settings
from vrl_yolo.engine.inference import InferenceEngine
from vrl_yolo.engine.registry import ModelRegistry
from vrl_yolo.paths import resolve_bundled_models_dir, user_models_dir


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Build the model registry + inference engine once at startup.

    Settings already lives on app.state; we hang the registry and engine
    off it so route handlers can resolve them via Depends().
    """
    settings: Settings = app.state.settings

    bundled = settings.bundled_models_path or resolve_bundled_models_dir()
    user = user_models_dir(settings.storage_path)
    user.mkdir(parents=True, exist_ok=True)

    registry = ModelRegistry(bundled_dir=bundled, user_dir=user)
    registry.scan()

    app.state.registry = registry
    app.state.engine = InferenceEngine(registry)
    yield
