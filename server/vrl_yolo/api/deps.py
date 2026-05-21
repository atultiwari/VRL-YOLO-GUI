"""FastAPI dependency helpers — pull registry/engine/job-manager off app.state."""

from __future__ import annotations

from fastapi import Request

from vrl_yolo.engine.history_db import HistoryDb
from vrl_yolo.engine.inference import InferenceEngine
from vrl_yolo.engine.registry import ModelRegistry
from vrl_yolo.engine.training import JobManager


def get_registry(request: Request) -> ModelRegistry:
    return request.app.state.registry


def get_engine(request: Request) -> InferenceEngine:
    return request.app.state.engine


def get_job_manager(request: Request) -> JobManager:
    return request.app.state.job_manager


def get_history(request: Request) -> HistoryDb | None:
    # Returns None when no history is wired (some tests don't bother).
    # The PATCH + history routes all handle the None case explicitly.
    return getattr(request.app.state, "history", None)
