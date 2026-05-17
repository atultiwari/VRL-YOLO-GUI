from __future__ import annotations

from fastapi import APIRouter

from vrl_yolo.api.schemas import PresetInfo, PresetsListResponse
from vrl_yolo.engine.presets import list_presets

router = APIRouter(prefix="/presets", tags=["presets"])


@router.get("", response_model=PresetsListResponse)
def list_presets_endpoint() -> PresetsListResponse:
    """Return all clinical workflow presets, grouped client-side by domain."""
    return PresetsListResponse(
        presets=[PresetInfo(**p.to_json()) for p in list_presets()]
    )
