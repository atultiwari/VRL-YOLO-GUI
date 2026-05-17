from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from vrl_yolo.config import Settings
from vrl_yolo.engine.inference import InferenceEngine
from vrl_yolo.engine.registry import ModelRegistry
from vrl_yolo.engine.training import JobManager
from vrl_yolo.paths import resolve_bundled_models_dir, resolve_storage_root, user_models_dir


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Build the model registry + inference engine once at startup.

    Settings already lives on app.state; we hang the registry and engine
    off it so route handlers can resolve them via Depends().

    **Deliberately fast**: we do NOT scan the model library or detect the
    accelerator here. Both are deferred to first request (the registry
    lazy-scans via `.list()`, and `InferenceEngine.accelerator` is a lazy
    property). Eager startup work was blocking uvicorn's socket bind for
    ~12 s on a cold cache (torch import + four Ultralytics checkpoint
    inspections), which lost a race with the Pyloid window's `load_url`
    and produced an ERR_CONNECTION_REFUSED page on first launch.
    """
    settings: Settings = app.state.settings

    bundled = settings.bundled_models_path or resolve_bundled_models_dir()
    user = user_models_dir(settings.storage_path)
    user.mkdir(parents=True, exist_ok=True)

    registry = ModelRegistry(bundled_dir=bundled, user_dir=user)

    storage_root = settings.storage_path or resolve_storage_root()
    job_manager = JobManager(storage_root=storage_root)

    app.state.registry = registry
    app.state.engine = InferenceEngine(registry)
    app.state.job_manager = job_manager
    yield
