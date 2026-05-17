"""FastAPI dependency helpers — pull registry/engine off app.state."""

from __future__ import annotations

from fastapi import Request

from vrl_yolo.engine.inference import InferenceEngine
from vrl_yolo.engine.registry import ModelRegistry


def get_registry(request: Request) -> ModelRegistry:
    return request.app.state.registry


def get_engine(request: Request) -> InferenceEngine:
    return request.app.state.engine
