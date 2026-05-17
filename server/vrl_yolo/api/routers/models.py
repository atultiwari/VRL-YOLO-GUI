from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, status

router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
def list_models() -> dict[str, list]:
    """List bundled + user-imported models. Implemented in P1."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="model registry lands in P1",
    )


@router.post("/import")
def import_model(file: UploadFile) -> dict[str, str]:
    """Upload a .pt file; backend reads its task attribute. Implemented in P3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="user model import lands in P3",
    )
