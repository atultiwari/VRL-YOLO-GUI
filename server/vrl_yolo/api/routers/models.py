from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from vrl_yolo.api.deps import get_registry
from vrl_yolo.api.schemas import (
    ModelInfo,
    ModelsListResponse,
    SetDefaultRequest,
)
from vrl_yolo.engine.registry import ModelRegistry

router = APIRouter(prefix="/models", tags=["models"])


def _record_to_info(record) -> ModelInfo:
    return ModelInfo(
        name=record.name,
        task=record.task,
        source=record.source,
        num_classes=record.num_classes,
        classes=record.classes,
        params=record.params,
        size_mb=round(record.size_mb, 2),
    )


@router.get("", response_model=ModelsListResponse)
def list_models(registry: ModelRegistry = Depends(get_registry)) -> ModelsListResponse:
    records = registry.list()
    return ModelsListResponse(
        models=[_record_to_info(r) for r in records],
        defaults=registry.get_defaults(),
    )


@router.get("/{name}", response_model=ModelInfo)
def get_model(name: str, registry: ModelRegistry = Depends(get_registry)) -> ModelInfo:
    try:
        record = registry.get(name)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"model {name!r} not found"
        ) from exc
    return _record_to_info(record)


@router.post("/default", status_code=status.HTTP_204_NO_CONTENT)
def set_default(
    body: SetDefaultRequest, registry: ModelRegistry = Depends(get_registry)
) -> None:
    try:
        registry.set_default(body.task, body.name)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"model {body.name!r} not found"
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


@router.post("/import")
def import_model(file: UploadFile) -> dict[str, str]:
    """Upload a .pt file; backend reads its task attribute. Implemented in P3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="user model import lands in P3",
    )
