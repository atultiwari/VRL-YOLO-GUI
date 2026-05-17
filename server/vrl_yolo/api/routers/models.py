from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from vrl_yolo.api.deps import get_registry
from vrl_yolo.api.schemas import (
    ModelInfo,
    ModelsListResponse,
    SetDefaultRequest,
)
from vrl_yolo.engine.registry import ModelLoadError, ModelRegistry

router = APIRouter(prefix="/models", tags=["models"])

# 500 MB ceiling on user-imported .pt files. The largest bundled YOLO26
# detect weight is ~120 MB; a trained checkpoint with optimizer state
# can be 2-3× that, so 500 MB gives comfortable headroom while still
# rejecting obvious mis-uploads (e.g. a wrong .zip rename).
MAX_IMPORT_BYTES = 500 * 1024 * 1024


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


def _sanitised_basename(raw: str | None) -> str:
    """Reject path-traversal nonsense and force a `.pt` extension.

    Whatever the browser hands us in the filename field is treated as
    untrusted: we keep only the basename and verify the extension. The
    caller is responsible for further uniqueness if needed (registry
    overwrite semantics handle the common case).
    """
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="upload had no filename",
        )
    # Strip any directory parts the browser might leak (rare, but
    # webkitRelativePath does pass them through in some edge cases).
    name = Path(raw).name
    if not name.lower().endswith(".pt"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="only .pt checkpoints are accepted in v1",
        )
    # Strip control characters that would break path operations down the
    # line. Underscore the rest for predictable filenames in the user dir.
    safe = "".join(c if c.isprintable() and c not in '<>:"/\\|?*' else "_" for c in name)
    if not safe or safe in {".", ".."}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="filename rejected after sanitisation",
        )
    return safe


@router.post("/import", response_model=ModelInfo)
async def import_model(
    file: UploadFile = File(...),
    registry: ModelRegistry = Depends(get_registry),
) -> ModelInfo:
    """Accept a user-provided `.pt` checkpoint.

    Pipeline:
        1. Stream the upload to a temp file (so we never load >500 MB into
           memory at once).
        2. Inspect via Ultralytics — reject anything whose `task` field is
           outside the v1 supported set (detect / classify).
        3. Copy the validated file into
           `<storage_root>/models/<task>/<basename>` and re-scan the
           registry so subsequent GET /api/models picks it up.
    """
    safe_name = _sanitised_basename(file.filename)

    tmp_dir = Path(tempfile.mkdtemp(prefix="vrl-yolo-import-"))
    tmp_path = tmp_dir / safe_name
    try:
        size = 0
        with open(tmp_path, "wb") as out_fp:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_IMPORT_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            f"file exceeds {MAX_IMPORT_BYTES // (1024 * 1024)} MB cap"
                        ),
                    )
                out_fp.write(chunk)
        if size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="empty upload",
            )

        # Probe the checkpoint via the same code path the startup scan
        # uses so we don't accidentally accept files the registry will
        # later reject (e.g. segment-task checkpoints).
        try:
            probe = registry._inspect(tmp_path, source="user")
        except ModelLoadError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        dest_dir = registry._user_dir / probe.task  # type: ignore[attr-defined]
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / safe_name
        shutil.move(str(tmp_path), str(dest))

        # Refresh the in-memory registry so /api/models reflects the new file.
        registry.scan()
        # Re-inspect from the final location so the record carries the
        # real path (the registry caches what scan() saw).
        record = registry.get(safe_name)
        return _record_to_info(record)
    finally:
        # Best-effort cleanup of the temp directory; ignore failures so
        # the user-visible error is always the meaningful one.
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except OSError:
            pass
