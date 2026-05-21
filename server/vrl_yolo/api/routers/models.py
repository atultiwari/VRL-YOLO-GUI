from __future__ import annotations

import platform
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from vrl_yolo.api.deps import get_registry
from vrl_yolo.api.schemas import (
    ModelInfo,
    ModelsListResponse,
    RenameModelRequest,
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
        path=str(record.path),
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


@router.get("/{name}/download")
def download_model(
    name: str, registry: ModelRegistry = Depends(get_registry)
) -> FileResponse:
    """Stream the model's `.pt` file with a download Content-Disposition.

    Works for every source (bundled / user / trained). The clinician
    wants a way to back up a freshly-trained checkpoint without spelunking
    into `<storage_root>` themselves.
    """
    try:
        record = registry.get(name)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"model {name!r} not found"
        ) from exc
    if not record.path.is_file():
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=f"checkpoint file missing on disk: {record.path}",
        )
    return FileResponse(
        path=str(record.path),
        media_type="application/octet-stream",
        filename=record.name,
    )


@router.post("/{name}/rename", response_model=ModelInfo)
def rename_model(
    name: str,
    body: RenameModelRequest,
    registry: ModelRegistry = Depends(get_registry),
) -> ModelInfo:
    """Rename a user-imported or locally-trained checkpoint.

    Bundled weights are rejected — they live in the install tree and
    would be re-fetched by `scripts/fetch-models.py` anyway. The new
    name is sanitised with the same rules as `/import` (basename only,
    must end with `.pt`, control characters stripped).
    """
    new_name = _sanitised_basename(body.new_name)
    if new_name == name:
        # No-op — return the current record so the caller doesn't have
        # to refetch.
        try:
            return _record_to_info(registry.get(name))
        except KeyError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"model {name!r} not found",
            ) from exc

    try:
        record = registry.rename(name, new_name)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"model {name!r} not found"
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return _record_to_info(record)


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(
    name: str, registry: ModelRegistry = Depends(get_registry)
) -> None:
    """Hard-delete a user-imported or locally-trained checkpoint.

    Bundled weights are rejected with 403 — they live in the install
    tree and are re-fetchable by `scripts/fetch-models.py`. Per-task
    defaults pointing at the deleted name are cleared from
    `defaults.json`; `get_defaults()` then falls back to any remaining
    model of the right task on the next read.
    """
    try:
        registry.delete(name)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"model {name!r} not found"
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
        ) from exc


@router.post("/{name}/reveal", status_code=status.HTTP_204_NO_CONTENT)
def reveal_model(
    name: str, registry: ModelRegistry = Depends(get_registry)
) -> None:
    """Open the OS file manager scoped to this checkpoint.

    Reveal-on-disk has to live on the backend because the QtWebEngine
    renderer is sandboxed — it can't spawn `open` / `explorer` /
    `xdg-open` directly.

    The path comes from a registry record (anchored at `_bundled_dir`
    / `_user_dir`), never user-controlled — no path-traversal surface.
    """
    try:
        record = registry.get(name)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"model {name!r} not found"
        ) from exc
    if not record.path.is_file():
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=f"checkpoint file missing on disk: {record.path}",
        )

    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(["open", "-R", str(record.path)], check=False)
        elif system == "Windows":
            # `/select,<path>` — note: no space after the comma.
            subprocess.run(["explorer", f"/select,{record.path}"], check=False)
        else:
            # Linux + fallbacks: open the containing folder. xdg-open
            # doesn't have an equivalent of /select.
            subprocess.run(["xdg-open", str(record.path.parent)], check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"could not open file manager: {exc}",
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
