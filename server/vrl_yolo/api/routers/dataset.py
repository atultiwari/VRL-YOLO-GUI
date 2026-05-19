from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from vrl_yolo.api.schemas import (
    DatasetInfoOut,
    DatasetSplitOut,
    RenameClassesRequest,
    SplitDatasetRequest,
)
from vrl_yolo.config import Settings
from vrl_yolo.engine.dataset import (
    inspect_dataset,
    rename_classes,
    split_dataset,
    split_imagefolder,
    write_uploaded_dataset,
)
from vrl_yolo.paths import resolve_storage_root

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _datasets_root(settings: Settings) -> Path:
    """Where the wizard plants every uploaded dataset."""
    storage = settings.storage_path or resolve_storage_root()
    return Path(storage) / "datasets"


def _to_out(info) -> DatasetInfoOut:  # noqa: ANN001 — engine.dataset.DatasetInfo
    return DatasetInfoOut(
        id=info.id,
        format=info.format,
        task=info.task,
        root_path=str(info.root_path),
        splits=[
            DatasetSplitOut(
                name=s.name, image_count=s.image_count, label_count=s.label_count
            )
            for s in info.splits
        ],
        classes=list(info.classes),
        class_counts=dict(info.class_counts),
        warnings=list(info.warnings),
        unassigned_image_count=info.unassigned_image_count,
    )


@router.post("/inspect", response_model=DatasetInfoOut)
async def inspect_uploaded_dataset(
    files: list[UploadFile] = File(..., description="Folder upload — every file in the dataset."),
    settings: Settings = Depends(_settings),
) -> DatasetInfoOut:
    """Accept a folder upload, write it to disk, return inspection results.

    Frontend appends each file with its `webkitRelativePath` as the
    filename so the backend can reconstruct the directory tree. We
    sanitise every path against traversal attempts before writing.
    """
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="no files uploaded"
        )

    storage_root = settings.storage_path or resolve_storage_root()
    Path(storage_root).mkdir(parents=True, exist_ok=True)

    try:
        dataset_root = await write_uploaded_dataset(
            uploads=files,
            storage_root=Path(storage_root),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=str(exc),
        ) from exc

    try:
        info = inspect_dataset(dataset_root)
    except FileNotFoundError as exc:
        # write_uploaded_dataset created the dir, so this shouldn't fire,
        # but guard anyway — better than a 500 stack trace.
        shutil.rmtree(dataset_root, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"dataset root not found after upload: {exc}",
        ) from exc

    return _to_out(info)


def _resolve_dataset_root(
    dataset_id: str, settings: Settings
) -> Path:
    """Look up a dataset's on-disk root, 404 if missing.

    Shared between the GET / split routes. Reject anything that doesn't
    look like our uuid hex up front — keeps shell-style filenames out
    of the path join.
    """
    if not (dataset_id.isalnum() and 8 <= len(dataset_id) <= 64):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="malformed dataset id"
        )
    root = _datasets_root(settings) / dataset_id
    if not root.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"dataset {dataset_id!r} not found on disk",
        )
    return root


@router.post("/{dataset_id}/split", response_model=DatasetInfoOut)
def split_dataset_endpoint(
    dataset_id: str,
    body: SplitDatasetRequest,
    settings: Settings = Depends(_settings),
) -> DatasetInfoOut:
    """Reorganise the on-disk dataset into train/valid/test splits.

    Destructive within the dataset's own directory. Dispatches on the
    detected task so the same endpoint handles both:

    - **Detect** (YOLO/Roboflow/COCO/VOC): re-stage image+label pairs
      into ``train/{images,labels}`` / ``valid/{images,labels}`` /
      ``test/{images,labels}``, rewrite ``data.yaml`` with the new
      split paths and the original class names.
    - **Classify** (ImageFolder): re-stage class subdirs into
      ``train/<class>/`` / ``val/<class>/`` / ``test/<class>/``
      (stratified per class). No ``data.yaml`` — Ultralytics' classify
      loader reads directly from the directory tree.

    Ratios must sum to 1.0 (±0.001). Test ratio may be 0 — neither
    splitter writes an empty test/ in that case. The dataset's UUID
    stays the same so the configure-page store doesn't lose track.
    """
    root = _resolve_dataset_root(dataset_id, settings)
    # Inspect first to know which splitter to use. Cheaper than running
    # the wrong one and catching the failure, and clearer 400 if the
    # caller targeted an unknown layout.
    current = inspect_dataset(root)
    try:
        if current.task == "classify":
            info = split_imagefolder(
                root,
                train_ratio=body.train_ratio,
                valid_ratio=body.valid_ratio,
                test_ratio=body.test_ratio,
                seed=body.seed,
                preserve_existing=body.preserve_existing,
            )
        else:
            info = split_dataset(
                root,
                train_ratio=body.train_ratio,
                valid_ratio=body.valid_ratio,
                test_ratio=body.test_ratio,
                seed=body.seed,
                preserve_existing=body.preserve_existing,
            )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return _to_out(info)


@router.patch("/{dataset_id}/classes", response_model=DatasetInfoOut)
def rename_dataset_classes(
    dataset_id: str,
    body: RenameClassesRequest,
    settings: Settings = Depends(_settings),
) -> DatasetInfoOut:
    """Rewrite `names:` on data.yaml in place.

    Length must match the dataset's current class count — adding /
    removing classes would require re-labelling, which is out of scope
    for v1. Empty / whitespace-only / duplicate names are rejected so
    the user can't accidentally collapse two classes into one.
    """
    root = _resolve_dataset_root(dataset_id, settings)
    current = inspect_dataset(root)
    expected = len(current.classes)
    incoming = [n.strip() for n in body.names]

    if expected > 0 and len(incoming) != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"expected {expected} class names, got {len(incoming)} — "
                "adding/removing classes requires re-labelling, not supported in v1"
            ),
        )
    for i, name in enumerate(incoming):
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"class {i} has an empty name",
            )
    if len(set(incoming)) != len(incoming):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="class names must be unique",
        )

    info = rename_classes(root, incoming)
    return _to_out(info)


@router.get("/{dataset_id}", response_model=DatasetInfoOut)
def get_dataset(dataset_id: str, settings: Settings = Depends(_settings)) -> DatasetInfoOut:
    """Re-fetch a previously-inspected dataset by id.

    The configure page calls this on mount so a page reload (or
    deep-linking from the changelog "open this run" flow in P4b)
    rehydrates from disk instead of forcing a re-upload.
    """
    root = _resolve_dataset_root(dataset_id, settings)
    info = inspect_dataset(root)
    return _to_out(info)
