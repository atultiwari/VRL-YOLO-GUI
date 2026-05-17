"""Dataset inspection + safe upload writing for the Train wizard.

Two responsibilities:

1. **`write_uploaded_dataset()`** — stream a list of `UploadFile`-style
   objects (filename + read()) into `<storage_root>/datasets/<uuid>/`,
   preserving relative paths from the browser's `webkitRelativePath` while
   refusing anything that escapes the dataset root. The handler returns
   the destination directory so the inspector can read it back.

2. **`inspect_dataset()`** — auto-detect what format the user dropped:
   - **Roboflow YOLO**: `data.yaml` at root + `train/images/`+`train/labels/`,
     optional `valid/` and `test/`. Classes come from `data.yaml::names`.
   - **Plain YOLO**: `images/`+`labels/` siblings under root (no
     `data.yaml`). Classes are unknown until the user fills them in.
   - **COCO**: an `annotations.json` with `images`+`annotations`+`categories`.
   - **Pascal VOC**: `*.xml` files alongside `*.jpg`.
   - **ImageFolder (classification)**: `train/<classname>/*.jpg`.
     Flagged as classify-task — actual training lands in P5.

   For each, we collect split counts (`train`, `valid`, `test`), class
   names, and any warnings. The wizard renders warnings prominently — they
   include things like "valid/ has 0 labels" that would otherwise bite
   the user 5 minutes into training.

P4a only enables detection task downstream; classification is detected
and displayed but the configure page disables it.
"""

from __future__ import annotations

import json
import shutil
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Literal, Protocol

import yaml

DatasetFormat = Literal[
    "roboflow_yolo",
    "yolo",
    "coco",
    "voc",
    "imagefolder",
    "unknown",
]
DatasetTask = Literal["detect", "classify"]

# Anything we'd consider a YOLO/COCO image. Lower-cased extensions only.
_IMAGE_EXT = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"})

# Common subdirs to probe inside a YOLO-style dataset. "validation" + "val"
# show up in older exports, "valid" is Roboflow's canonical name.
_VAL_DIR_CANDIDATES = ("valid", "val", "validation")


# --- Public records ---------------------------------------------------


@dataclass(frozen=True)
class DatasetSplit:
    name: str  # "train" / "valid" / "test"
    image_count: int
    label_count: int

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "image_count": self.image_count,
            "label_count": self.label_count,
        }


@dataclass(frozen=True)
class DatasetInfo:
    id: str
    format: DatasetFormat
    task: DatasetTask
    root_path: Path
    splits: tuple[DatasetSplit, ...]
    classes: tuple[str, ...]
    # Per-class image count (classify) or detection count (detect).
    # Empty when not derivable yet (plain YOLO without data.yaml).
    class_counts: dict[str, int] = field(default_factory=dict)
    warnings: tuple[str, ...] = ()

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "format": self.format,
            "task": self.task,
            "root_path": str(self.root_path),
            "splits": [s.to_json() for s in self.splits],
            "classes": list(self.classes),
            "class_counts": dict(self.class_counts),
            "warnings": list(self.warnings),
        }


# --- Upload writing ---------------------------------------------------


class UploadLike(Protocol):
    """Mimics FastAPI's UploadFile so this module doesn't import FastAPI.

    FastAPI's UploadFile uses an async `read()`; we accept either an async
    or sync coroutine here and let the caller `await` it. In practice the
    only caller is the route handler which is already async.
    """

    filename: str | None

    async def read(self, size: int = -1) -> bytes: ...  # pragma: no cover


def _sanitise_relative_path(raw: str | None, *, strip_root: bool) -> Path | None:
    """Coerce `raw` into a safe relative path inside the dataset dir.

    The browser passes `webkitRelativePath` of the form `<root>/sub/file.jpg`.
    By default we strip the leading `<root>/` so the dataset dir doesn't
    inherit an extra layer of nesting (`datasets/<uuid>/my-dataset/...`).
    Set `strip_root=False` when the caller knows the input has no root
    prefix (e.g. raw filename only).

    Returns None for clearly hostile inputs:
      - absolute paths
      - any `..` segment after normalising
      - control characters or null bytes
      - empty filename after stripping
    """
    if not raw:
        return None
    # Reject anything with a leading slash or drive letter — those are
    # browser bugs at best and traversal attempts at worst.
    if raw.startswith(("/", "\\")) or (len(raw) > 1 and raw[1] == ":"):
        return None
    if "\x00" in raw:
        return None

    parts = [p for p in raw.replace("\\", "/").split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        return None
    if not parts:
        return None
    if strip_root and len(parts) > 1:
        parts = parts[1:]

    # Final sanitiser: strip Windows-reserved characters per file segment
    # so the on-disk file is creatable on every supported OS.
    forbidden = '<>:"|?*'
    safe_parts = [
        "".join(c if c.isprintable() and c not in forbidden else "_" for c in p)
        for p in parts
    ]
    return Path(*safe_parts)


async def write_uploaded_dataset(
    *,
    uploads: Iterable[UploadLike],
    storage_root: Path,
    chunk_size: int = 1024 * 1024,
    max_total_bytes: int = 4 * 1024 * 1024 * 1024,  # 4 GiB hard cap
) -> Path:
    """Stream upload files into `<storage_root>/datasets/<uuid>/`.

    Refuses path-escape attempts, enforces a total-size cap (rough; counts
    written bytes after sanitisation), and skips files that fail to map to
    a safe relative path (e.g. browser quirks that drop the filename).
    Returns the dataset root directory.
    """
    dataset_id = uuid.uuid4().hex
    dataset_root = storage_root / "datasets" / dataset_id
    dataset_root.mkdir(parents=True, exist_ok=True)

    # First pass: figure out whether the upload uses webkitRelativePath
    # ("dir/sub/file.jpg") or just filenames ("file.jpg"). Strip-root only
    # makes sense for the former — otherwise we'd eat the only path part.
    sample_paths = []
    uploads_list = list(uploads)
    for u in uploads_list[:8]:
        if u.filename:
            sample_paths.append(u.filename.replace("\\", "/"))
    has_nesting = any("/" in p for p in sample_paths)
    strip_root = has_nesting

    total_bytes = 0
    for upload in uploads_list:
        rel = _sanitise_relative_path(upload.filename, strip_root=strip_root)
        if rel is None:
            continue
        target = dataset_root / rel
        target.parent.mkdir(parents=True, exist_ok=True)

        with target.open("wb") as fp:
            while True:
                chunk = await upload.read(chunk_size)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > max_total_bytes:
                    # Roll back: nuke the partial dataset dir so we don't
                    # leave 4 GB of garbage behind for the user to clean up.
                    shutil.rmtree(dataset_root, ignore_errors=True)
                    raise ValueError(
                        f"dataset exceeds {max_total_bytes // (1024 * 1024)} MB cap"
                    )
                fp.write(chunk)

    return dataset_root


# --- Inspection -------------------------------------------------------


def inspect_dataset(dataset_root: Path) -> DatasetInfo:
    """Probe `dataset_root` and return a typed `DatasetInfo`.

    Order matters — we check Roboflow YOLO first (it's the canonical
    format we want to support best), then plain YOLO, then COCO, then
    VOC, finally ImageFolder. If nothing matches we still return a
    DatasetInfo with `format="unknown"` and a warning explaining the
    expected layouts.
    """
    if not dataset_root.is_dir():
        raise FileNotFoundError(dataset_root)

    dataset_id = dataset_root.name

    # 1. Roboflow YOLO (data.yaml at root)
    data_yaml = dataset_root / "data.yaml"
    if data_yaml.is_file():
        return _inspect_roboflow_yolo(dataset_id, dataset_root, data_yaml)

    # 2. COCO (annotations.json anywhere shallow)
    coco_json = _find_coco_annotations(dataset_root)
    if coco_json is not None:
        return _inspect_coco(dataset_id, dataset_root, coco_json)

    # 3. Plain YOLO (images/+labels/ siblings, or train/images+labels)
    yolo_info = _try_plain_yolo(dataset_id, dataset_root)
    if yolo_info is not None:
        return yolo_info

    # 4. Pascal VOC (any *.xml + matching *.jpg)
    voc_info = _try_voc(dataset_id, dataset_root)
    if voc_info is not None:
        return voc_info

    # 5. ImageFolder (classification — train/<class>/*.jpg)
    if_info = _try_imagefolder(dataset_id, dataset_root)
    if if_info is not None:
        return if_info

    return DatasetInfo(
        id=dataset_id,
        format="unknown",
        task="detect",  # default; UI will show warnings prominently
        root_path=dataset_root,
        splits=(),
        classes=(),
        warnings=(
            "Could not detect a known dataset layout. Supported formats: "
            "Roboflow YOLO (data.yaml + train/images/+labels/), plain YOLO "
            "(images/+labels/), COCO (annotations.json), Pascal VOC (.xml), "
            "ImageFolder (train/<classname>/*.jpg).",
        ),
    )


# --- Format detectors -------------------------------------------------


def _inspect_roboflow_yolo(
    dataset_id: str, root: Path, data_yaml_path: Path
) -> DatasetInfo:
    classes: tuple[str, ...] = ()
    warnings: list[str] = []
    try:
        data = yaml.safe_load(data_yaml_path.read_text()) or {}
        if isinstance(data.get("names"), list):
            classes = tuple(str(n) for n in data["names"])
        elif isinstance(data.get("names"), dict):
            # Some exports use {0: 'cat', 1: 'dog'}
            classes = tuple(
                v for _, v in sorted(data["names"].items(), key=lambda kv: int(kv[0]))
            )
    except (yaml.YAMLError, OSError) as exc:
        warnings.append(f"data.yaml unreadable: {exc}")

    splits = _yolo_splits(root)
    if not any(s.image_count for s in splits):
        warnings.append("No images found under train/ — Roboflow exports normally ship at least train/images/.")
    if classes and any(s.image_count > 0 for s in splits) and not any(
        s.label_count > 0 for s in splits
    ):
        warnings.append("Classes are declared in data.yaml but no .txt labels were found.")

    return DatasetInfo(
        id=dataset_id,
        format="roboflow_yolo",
        task="detect",
        root_path=root,
        splits=splits,
        classes=classes,
        warnings=tuple(warnings),
    )


def _try_plain_yolo(dataset_id: str, root: Path) -> DatasetInfo | None:
    """Plain YOLO: `images/` + `labels/` siblings under root, no data.yaml."""
    images = root / "images"
    labels = root / "labels"
    if not (images.is_dir() and labels.is_dir()):
        return None
    image_count = sum(1 for p in images.rglob("*") if p.suffix.lower() in _IMAGE_EXT)
    label_count = sum(1 for p in labels.rglob("*") if p.suffix.lower() == ".txt")
    warnings: list[str] = []
    if image_count == 0:
        warnings.append("No images found under images/.")
    if label_count == 0:
        warnings.append("No .txt labels under labels/ — was the export wrong-flavoured?")
    if image_count and label_count and abs(image_count - label_count) > image_count * 0.1:
        warnings.append(
            f"Image / label count mismatch (images={image_count}, labels={label_count}) — "
            "more than 10% drift; check for unlabelled patches."
        )
    return DatasetInfo(
        id=dataset_id,
        format="yolo",
        task="detect",
        root_path=root,
        splits=(DatasetSplit("all", image_count, label_count),),
        classes=(),
        warnings=(*warnings, "Class names not embedded in plain-YOLO layout — fill them in on the configure page."),
    )


def _find_coco_annotations(root: Path) -> Path | None:
    """Find a likely COCO annotations file, checking common locations."""
    candidates = [
        root / "annotations.json",
        root / "_annotations.coco.json",  # Roboflow COCO export name
        root / "annotations" / "instances_train.json",
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None


def _inspect_coco(dataset_id: str, root: Path, anno_path: Path) -> DatasetInfo:
    warnings: list[str] = []
    classes: tuple[str, ...] = ()
    image_count = 0
    try:
        data = json.loads(anno_path.read_text())
        if "categories" in data and isinstance(data["categories"], list):
            classes = tuple(c["name"] for c in data["categories"])
        if "images" in data and isinstance(data["images"], list):
            image_count = len(data["images"])
    except (json.JSONDecodeError, OSError, KeyError) as exc:
        warnings.append(f"annotations.json unreadable: {exc}")

    return DatasetInfo(
        id=dataset_id,
        format="coco",
        task="detect",
        root_path=root,
        splits=(DatasetSplit("all", image_count, image_count),),
        classes=classes,
        warnings=(
            *warnings,
            "COCO datasets are converted to YOLO format at training time.",
        ),
    )


def _try_voc(dataset_id: str, root: Path) -> DatasetInfo | None:
    """Pascal VOC: enough *.xml files to consider this a VOC tree."""
    xmls = list(root.rglob("*.xml"))
    if len(xmls) < 4:  # arbitrary floor — accidental .xml doesn't trigger this
        return None
    imgs = [p for p in root.rglob("*") if p.suffix.lower() in _IMAGE_EXT]
    return DatasetInfo(
        id=dataset_id,
        format="voc",
        task="detect",
        root_path=root,
        splits=(DatasetSplit("all", len(imgs), len(xmls)),),
        classes=(),
        warnings=(
            "Pascal VOC layout detected. VOC XML is converted to YOLO at training time.",
            "Class names will be derived from <object><name>… during conversion.",
        ),
    )


def _try_imagefolder(dataset_id: str, root: Path) -> DatasetInfo | None:
    """ImageFolder: train/<classname>/*.jpg with no labels/."""
    train_dir = root / "train"
    if not train_dir.is_dir():
        return None
    class_dirs = [p for p in train_dir.iterdir() if p.is_dir()]
    if not class_dirs:
        return None
    # If there's a labels/ alongside images/, this is YOLO, not ImageFolder.
    if (train_dir / "labels").is_dir() or (train_dir / "images").is_dir():
        return None

    class_counts: dict[str, int] = {}
    for cd in class_dirs:
        class_counts[cd.name] = sum(
            1 for p in cd.iterdir() if p.suffix.lower() in _IMAGE_EXT
        )
    total_train = sum(class_counts.values())

    val_split = _imagefolder_split(root, *_VAL_DIR_CANDIDATES)
    test_split = _imagefolder_split(root, "test")
    splits = [DatasetSplit("train", total_train, total_train)]
    if val_split is not None:
        splits.append(val_split)
    if test_split is not None:
        splits.append(test_split)

    return DatasetInfo(
        id=dataset_id,
        format="imagefolder",
        task="classify",
        root_path=root,
        splits=tuple(splits),
        classes=tuple(sorted(class_counts.keys())),
        class_counts=class_counts,
        warnings=(
            "Classification training (Image Folder format) is implemented in P5 — "
            "the dataset wizard recognises this layout but the configure page is "
            "detection-only for now.",
        ),
    )


def _imagefolder_split(root: Path, *candidates: str) -> DatasetSplit | None:
    """Match `valid/` / `val/` / `validation/` etc. for an ImageFolder split."""
    for c in candidates:
        d = root / c
        if d.is_dir():
            count = sum(
                1 for p in d.rglob("*") if p.suffix.lower() in _IMAGE_EXT
            )
            return DatasetSplit(c, count, count)
    return None


def _yolo_splits(root: Path) -> tuple[DatasetSplit, ...]:
    """Count train/valid/test splits in a Roboflow YOLO layout."""
    out: list[DatasetSplit] = []
    for name in ("train",) + _VAL_DIR_CANDIDATES + ("test",):
        split_dir = root / name
        if not split_dir.is_dir():
            continue
        images_dir = split_dir / "images"
        labels_dir = split_dir / "labels"
        # Skip ImageFolder-style layouts (no images/ subfolder)
        if not images_dir.is_dir():
            continue
        image_count = sum(
            1 for p in images_dir.rglob("*") if p.suffix.lower() in _IMAGE_EXT
        )
        label_count = (
            sum(1 for p in labels_dir.rglob("*") if p.suffix.lower() == ".txt")
            if labels_dir.is_dir()
            else 0
        )
        out.append(DatasetSplit(name, image_count, label_count))
    return tuple(out)


def class_counts_from_yolo_labels(root: Path) -> Counter[str]:
    """Walk a YOLO labels/ tree and return per-class instance counts.

    Used by the configure page to display class balance without needing
    to load a full COCO conversion. Class IDs are returned as strings so
    the frontend can mix them with named classes seamlessly.
    """
    counts: Counter[str] = Counter()
    for txt in root.rglob("*.txt"):
        try:
            for line in txt.read_text().splitlines():
                parts = line.strip().split()
                if not parts:
                    continue
                counts[parts[0]] += 1
        except OSError:
            continue
    return counts
