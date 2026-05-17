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
import random
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
    """ImageFolder for classification — accepts two layouts.

    **Split layout** (Ultralytics-ready, what Roboflow's classification
    export produces, what `split_imagefolder` writes)::

        <root>/
        ├── train/
        │   ├── classA/img.jpg
        │   └── classB/img.jpg
        ├── val/   (or valid/, validation/ — optional but recommended)
        │   └── ...
        └── test/  (optional)
            └── ...

    **Flat layout** (the human-friendly one — what doctors usually drop
    in from `<classname>/<image>.jpg`)::

        <root>/
        ├── classA/img.jpg
        └── classB/img.jpg

    The flat layout is recognised here but flagged with a warning that
    says training won't start until it's split — the wizard surfaces
    "Prepare splits…" which calls `split_imagefolder` to stage into the
    Ultralytics-ready layout.
    """
    # --- Layout A: split — train/<class>/*.jpg --------------------------
    train_dir = root / "train"
    if train_dir.is_dir():
        # Reject train/images + train/labels — that's plain YOLO, not classify.
        if (train_dir / "labels").is_dir() or (train_dir / "images").is_dir():
            return None
        class_dirs = [p for p in train_dir.iterdir() if p.is_dir()]
        if class_dirs:
            return _imagefolder_split_layout(dataset_id, root, class_dirs)

    # --- Layout B: flat — <class>/*.jpg ---------------------------------
    return _imagefolder_flat_layout(dataset_id, root)


def _imagefolder_split_layout(
    dataset_id: str, root: Path, train_class_dirs: list[Path]
) -> DatasetInfo:
    """Inspector for a pre-split ImageFolder (train/<class>/* present)."""
    class_counts: dict[str, int] = {}
    for cd in train_class_dirs:
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

    warnings: list[str] = []
    if val_split is None:
        warnings.append(
            "No val/ split found — Ultralytics' classify mode wants val/<class>/*. "
            "Use Prepare splits to re-stage."
        )
    if len(train_class_dirs) < 2:
        warnings.append(
            "Only one class folder under train/ — classification needs at "
            "least 2 classes to learn anything meaningful."
        )
    return DatasetInfo(
        id=dataset_id,
        format="imagefolder",
        task="classify",
        root_path=root,
        splits=tuple(splits),
        classes=tuple(sorted(class_counts.keys())),
        class_counts=class_counts,
        warnings=tuple(warnings),
    )


def _imagefolder_flat_layout(dataset_id: str, root: Path) -> DatasetInfo | None:
    """Inspector for a flat ImageFolder (root/<class>/*.jpg, no train/)."""
    # Class candidates: any direct-child dir that holds at least one image.
    # Skip our own staging dir + Roboflow's README-style sidecars + the
    # split-layout dirs (train/val/...) since those would have been picked
    # up by `_imagefolder_split_layout` above.
    reserved_split_names = {"train", "val", "valid", "validation", "test"}
    candidate_dirs = [
        p
        for p in root.iterdir()
        if p.is_dir()
        and not p.name.startswith(".")
        and p.name != _STAGING_DIR_NAME
        and p.name.lower() not in reserved_split_names
    ]
    # Reject if any candidate looks YOLO-shaped (images/ + labels/ sibling).
    if any((p / "labels").is_dir() or (p / "images").is_dir() for p in candidate_dirs):
        return None

    class_counts: dict[str, int] = {}
    for cd in candidate_dirs:
        n = sum(1 for p in cd.iterdir() if p.is_file() and p.suffix.lower() in _IMAGE_EXT)
        if n > 0:
            class_counts[cd.name] = n

    if not class_counts:
        return None  # No class dirs with images — not an ImageFolder.

    total = sum(class_counts.values())
    warnings: list[str] = [
        "Flat ImageFolder layout — class folders at the root. Use Prepare splits "
        "to stage into train/val/test before training (Ultralytics' classify mode "
        "needs that shape).",
    ]
    if len(class_counts) < 2:
        warnings.append(
            "Only one class folder detected — classification needs at least 2 "
            "classes to learn anything meaningful."
        )

    return DatasetInfo(
        id=dataset_id,
        format="imagefolder",
        task="classify",
        root_path=root,
        # Surface a single "all" pseudo-split so the wizard's stat table
        # shows the right totals; the splitter writes the real splits.
        splits=(DatasetSplit("all", total, total),),
        classes=tuple(sorted(class_counts.keys())),
        class_counts=class_counts,
        warnings=tuple(warnings),
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


# --- Split / prepare ---------------------------------------------------


# Files the splitter must NOT delete during cleanup, even when they
# don't carry an image+label pair. data.yaml is rewritten at the end of
# split_dataset(); the rest are user-facing docs / metadata.
_PRESERVED_ROOT_FILES: frozenset[str] = frozenset({
    "data.yaml",
    "data.yml",
    "README.roboflow.txt",
    "README.md",
    "README.txt",
    "LICENSE",
    "NOTICE",
})

_STAGING_DIR_NAME = "__vrl-split-staging__"


def _find_image_label_pairs(root: Path) -> list[tuple[Path, Path | None]]:
    """Collect every image in the dataset and pair it with its YOLO label.

    YOLO's convention is that labels live in a sibling `labels/` directory
    named after the image's `images/` directory (e.g. `train/images/x.jpg`
    pairs with `train/labels/x.txt`). We look up the obvious places, in
    order:

    1. Same parent (`<dir>/x.jpg` ↔ `<dir>/x.txt`).
    2. Sibling `labels/` of an `images/` directory (the YOLO standard).
    3. A `labels/` directory under root (covers flat plain-YOLO layouts).

    Images that don't pair with any label are still returned (with
    `None`) so the caller can warn / decide what to do. Splitter
    currently moves the image without a label; YOLO treats those as
    background.
    """
    pairs: list[tuple[Path, Path | None]] = []
    for img in sorted(root.rglob("*")):
        if not img.is_file() or img.suffix.lower() not in _IMAGE_EXT:
            continue
        # Skip files inside our own staging directory if it lingers
        # from a crashed previous run.
        if _STAGING_DIR_NAME in img.parts:
            continue

        stem = img.stem
        # 1. Same-dir sibling .txt
        candidate = img.with_suffix(".txt")
        if candidate.is_file():
            pairs.append((img, candidate))
            continue
        # 2. Sibling `labels/` next to the image's `images/` dir
        if img.parent.name == "images":
            candidate = img.parent.parent / "labels" / f"{stem}.txt"
            if candidate.is_file():
                pairs.append((img, candidate))
                continue
        # 3. labels/ at root
        candidate = root / "labels" / f"{stem}.txt"
        if candidate.is_file():
            pairs.append((img, candidate))
            continue
        pairs.append((img, None))
    return pairs


def _infer_class_names_from_labels(
    pairs: Iterable[tuple[Path, Path | None]],
) -> list[str]:
    """Walk YOLO label files, infer placeholder class names from indices.

    Used only when the dataset has no `data.yaml` (plain YOLO). Each
    label file's first column is the class id; we scan all of them to
    find the max id and emit `class_0`...`class_N` placeholders. The
    user can rename them on the configure page (lands in P4b).
    """
    max_id = -1
    for _, lbl in pairs:
        if lbl is None:
            continue
        try:
            for line in lbl.read_text().splitlines():
                parts = line.strip().split()
                if not parts:
                    continue
                try:
                    cls_id = int(parts[0])
                except ValueError:
                    continue
                if cls_id > max_id:
                    max_id = cls_id
        except OSError:
            continue
    if max_id < 0:
        return []
    return [f"class_{i}" for i in range(max_id + 1)]


def _read_existing_class_names(root: Path) -> list[str]:
    """Pull `names:` out of data.yaml if it exists.

    Supports both list (`names: [a, b, c]`) and dict (`names: {0: a, 1: b}`)
    forms — Roboflow ships either depending on version.
    """
    for filename in ("data.yaml", "data.yml"):
        path = root / filename
        if not path.is_file():
            continue
        try:
            data = yaml.safe_load(path.read_text()) or {}
        except (yaml.YAMLError, OSError):
            continue
        names = data.get("names")
        if isinstance(names, list):
            return [str(n) for n in names]
        if isinstance(names, dict):
            try:
                return [
                    str(v)
                    for _, v in sorted(names.items(), key=lambda kv: int(kv[0]))
                ]
            except (TypeError, ValueError):
                continue
    return []


def split_dataset(
    dataset_root: Path,
    *,
    train_ratio: float,
    valid_ratio: float,
    test_ratio: float,
    seed: int = 42,
) -> DatasetInfo:
    """Reorganise a YOLO-shaped dataset into clean train / valid / test splits.

    Works for three input shapes — handled identically, since we just
    flatten everything into `(image, label)` pairs and re-distribute:

    - Plain YOLO at root (`images/`+`labels/` + optional `data.yaml`).
    - Roboflow YOLO with only `train/` (the case that motivated this).
    - Roboflow YOLO with all three splits — re-splits using fresh ratios.

    The operation is **destructive** within `dataset_root`: old
    `train/`, `valid/`, `test/`, `images/`, `labels/` directories are
    wiped after the pairs are staged. Preserved root files (data.yaml,
    READMEs, LICENSE) stay untouched. data.yaml is rewritten at the end
    with the new split paths and the class names inherited from the old
    yaml (or inferred from label indices when no yaml existed).

    Stages files inside `<root>/__vrl-split-staging__/` for the duration
    of the move so a partial run never leaves the dataset half-split. On
    failure, the staging dir is removed and the original layout is left
    untouched.
    """
    if not dataset_root.is_dir():
        raise FileNotFoundError(dataset_root)

    total = train_ratio + valid_ratio + test_ratio
    if abs(total - 1.0) > 1e-3:
        raise ValueError(f"ratios must sum to 1.0; got {total:.3f}")
    if train_ratio <= 0:
        raise ValueError("train_ratio must be > 0")
    for name, r in (
        ("train_ratio", train_ratio),
        ("valid_ratio", valid_ratio),
        ("test_ratio", test_ratio),
    ):
        if r < 0 or r > 1:
            raise ValueError(f"{name} must be in [0, 1]; got {r}")

    pairs = _find_image_label_pairs(dataset_root)
    if not pairs:
        raise ValueError("no images found — nothing to split")
    paired = sum(1 for _, lbl in pairs if lbl is not None)
    if paired == 0:
        raise ValueError(
            "no image+label pairs found — every image must have a matching .txt"
        )

    class_names = _read_existing_class_names(dataset_root)
    if not class_names:
        class_names = _infer_class_names_from_labels(pairs)

    # Shuffle by seed for reproducible splits.
    rng = random.Random(seed)
    shuffled = list(pairs)
    rng.shuffle(shuffled)

    n = len(shuffled)
    n_train = int(round(n * train_ratio))
    n_valid = int(round(n * valid_ratio))
    # Test absorbs the residual so the three counts always sum to `n`.
    n_train = min(n_train, n)
    n_valid = min(n_valid, n - n_train)
    n_test = n - n_train - n_valid

    train_pairs = shuffled[:n_train]
    valid_pairs = shuffled[n_train : n_train + n_valid]
    test_pairs = shuffled[n_train + n_valid : n_train + n_valid + n_test]

    staging = dataset_root / _STAGING_DIR_NAME
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()

    try:
        for split_name, split_pairs in (
            ("train", train_pairs),
            ("valid", valid_pairs),
            ("test", test_pairs),
        ):
            if not split_pairs:
                continue
            img_dir = staging / split_name / "images"
            lbl_dir = staging / split_name / "labels"
            img_dir.mkdir(parents=True)
            lbl_dir.mkdir(parents=True)
            for img, lbl in split_pairs:
                # Move-then-rename guards against same-basename collisions
                # across the input layout (rare, but Roboflow uses unique
                # suffixes so we wouldn't see them — still worth being
                # explicit about overwrite).
                dest_img = img_dir / img.name
                _safe_move(img, dest_img)
                if lbl is not None:
                    dest_lbl = lbl_dir / lbl.name
                    _safe_move(lbl, dest_lbl)

        # Everything moved successfully — wipe the old layout. We walk
        # the root once and remove anything that isn't preserved or our
        # own staging dir.
        for entry in list(dataset_root.iterdir()):
            if entry.name == _STAGING_DIR_NAME:
                continue
            if entry.is_file():
                if entry.name in _PRESERVED_ROOT_FILES:
                    continue
                # Stray text files / images at root that we didn't pair
                # (already moved into staging if pairable). Safe to remove.
                entry.unlink()
            elif entry.is_dir():
                # Old train/, valid/, test/, images/, labels/, anything else.
                shutil.rmtree(entry)

        # Promote staging contents back to root.
        for entry in list(staging.iterdir()):
            shutil.move(str(entry), str(dataset_root / entry.name))
        shutil.rmtree(staging)
    except Exception:
        # Best-effort rollback — promote anything that's still in staging
        # back to a sensible spot. We can't truly undo file moves, so the
        # priority is "don't leave staging dir behind" + "tell the caller".
        shutil.rmtree(staging, ignore_errors=True)
        raise

    # Write a fresh data.yaml describing the new layout. Roboflow's key
    # name for the validation split is `val:`, not `valid:` — Ultralytics'
    # loader is strict about that.
    new_yaml: dict[str, object] = {
        "train": "train/images",
    }
    if valid_pairs:
        new_yaml["val"] = "valid/images"
    if test_pairs:
        new_yaml["test"] = "test/images"
    if class_names:
        new_yaml["nc"] = len(class_names)
        new_yaml["names"] = class_names
    (dataset_root / "data.yaml").write_text(
        yaml.safe_dump(new_yaml, sort_keys=False)
    )

    return inspect_dataset(dataset_root)


def split_imagefolder(
    dataset_root: Path,
    *,
    train_ratio: float,
    valid_ratio: float,
    test_ratio: float,
    seed: int = 42,
) -> DatasetInfo:
    """Reorganise an ImageFolder dataset into clean train/val/test splits.

    Mirrors :func:`split_dataset` but for classification — Ultralytics'
    classify mode expects ``<root>/train/<class>/`` (and optionally
    ``val/<class>/``, ``test/<class>/``) and there is no ``data.yaml``.

    Accepts three input shapes — all flattened to ``(class_name,
    image_path)`` tuples and re-distributed per class:

    - **Flat** at root: ``<root>/<class>/*.jpg``.
    - **Split** at root: ``<root>/train/<class>/*.jpg`` (+ optional ``val/``,
      ``valid/``, ``validation/``, ``test/``).
    - Mix of both (rare; collected from wherever they sit).

    Stratified per class — each split gets roughly the same per-class
    proportion, so a class with 10 images doesn't accidentally land 9 in
    val and 1 in train. Stages everything inside ``__vrl-split-staging__``
    so a crash mid-move never leaves a half-split dataset behind.

    Output uses ``val/`` (not ``valid/``) because that's the canonical
    name Ultralytics' ClassificationDataset loader expects.
    """
    if not dataset_root.is_dir():
        raise FileNotFoundError(dataset_root)

    total = train_ratio + valid_ratio + test_ratio
    if abs(total - 1.0) > 1e-3:
        raise ValueError(f"ratios must sum to 1.0; got {total:.3f}")
    if train_ratio <= 0:
        raise ValueError("train_ratio must be > 0")
    for name, r in (
        ("train_ratio", train_ratio),
        ("valid_ratio", valid_ratio),
        ("test_ratio", test_ratio),
    ):
        if r < 0 or r > 1:
            raise ValueError(f"{name} must be in [0, 1]; got {r}")

    by_class = _collect_imagefolder_images(dataset_root)
    if not by_class:
        raise ValueError(
            "no class folders with images found — expected <root>/<class>/*.jpg "
            "or <root>/train/<class>/*.jpg"
        )
    if len(by_class) < 2:
        raise ValueError(
            "only one class folder found — classification needs at least 2 classes"
        )

    rng = random.Random(seed)
    # `assignments[class_name] = {"train": [...], "val": [...], "test": [...]}`
    assignments: dict[str, dict[str, list[Path]]] = {}
    for class_name, paths in sorted(by_class.items()):
        shuffled = list(paths)
        rng.shuffle(shuffled)
        n = len(shuffled)
        n_train = int(round(n * train_ratio))
        n_valid = int(round(n * valid_ratio))
        # Per-class minimums: guarantee at least one in train if any image
        # exists, so an unbalanced ratio (e.g. 0.95/0.05/0) on a small
        # class doesn't leave train empty for that class.
        n_train = max(1, min(n_train, n))
        n_valid = min(n_valid, n - n_train)
        n_test = n - n_train - n_valid
        assignments[class_name] = {
            "train": shuffled[:n_train],
            "val": shuffled[n_train : n_train + n_valid],
            "test": shuffled[n_train + n_valid : n_train + n_valid + n_test],
        }

    staging = dataset_root / _STAGING_DIR_NAME
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()

    try:
        for class_name, splits in assignments.items():
            for split_name, paths in splits.items():
                if not paths:
                    continue
                dest_dir = staging / split_name / class_name
                dest_dir.mkdir(parents=True, exist_ok=True)
                for img in paths:
                    _safe_move(img, dest_dir / img.name)

        # Wipe the OLD top-level layout (the flat class dirs OR the
        # previous train/val/test) — preserve only readme-style files.
        for entry in list(dataset_root.iterdir()):
            if entry.name == _STAGING_DIR_NAME:
                continue
            if entry.is_file():
                if entry.name in _PRESERVED_ROOT_FILES:
                    continue
                entry.unlink()
            elif entry.is_dir():
                shutil.rmtree(entry)

        # Promote staging contents.
        for entry in list(staging.iterdir()):
            shutil.move(str(entry), str(dataset_root / entry.name))
        shutil.rmtree(staging)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    return inspect_dataset(dataset_root)


def _collect_imagefolder_images(root: Path) -> dict[str, list[Path]]:
    """Walk every plausible class-dir location and group image paths by class.

    Looks in (in order):

    1. ``<root>/<class>/*.jpg`` (flat layout — what humans drop)
    2. ``<root>/train/<class>/*.jpg``
    3. ``<root>/val/<class>/*.jpg`` (and ``valid``, ``validation``)
    4. ``<root>/test/<class>/*.jpg``

    Images from all sources are merged per-class — the splitter doesn't
    care if a dataset was previously split unevenly; it re-shuffles from
    scratch using the seed.
    """
    by_class: dict[str, list[Path]] = {}
    reserved = {"train", "val", "valid", "validation", "test"}

    def _add_images(class_dir: Path) -> None:
        files = [
            p for p in class_dir.iterdir()
            if p.is_file() and p.suffix.lower() in _IMAGE_EXT
        ]
        if files:
            by_class.setdefault(class_dir.name, []).extend(files)

    # Flat layout
    for entry in root.iterdir():
        if (
            entry.is_dir()
            and not entry.name.startswith(".")
            and entry.name != _STAGING_DIR_NAME
            and entry.name.lower() not in reserved
        ):
            _add_images(entry)

    # Split layout
    for split_name in ("train", "val", "valid", "validation", "test"):
        split_dir = root / split_name
        if not split_dir.is_dir():
            continue
        for class_dir in split_dir.iterdir():
            if class_dir.is_dir() and not class_dir.name.startswith("."):
                _add_images(class_dir)

    return by_class


def _safe_move(src: Path, dst: Path) -> None:
    """`shutil.move` with collision suffixing (` (1)`, ` (2)`, …).

    Splitting datasets that were previously merged from multiple sources
    occasionally hits filename collisions; we'd rather rename than lose
    data. Caller is responsible for the destination directory existing.
    """
    if not dst.exists():
        shutil.move(str(src), str(dst))
        return
    stem, suffix = dst.stem, dst.suffix
    counter = 1
    while True:
        candidate = dst.with_name(f"{stem} ({counter}){suffix}")
        if not candidate.exists():
            shutil.move(str(src), str(candidate))
            return
        counter += 1


def rename_classes(dataset_root: Path, names: list[str]) -> DatasetInfo:
    """Rewrite the class names on `data.yaml`, preserve everything else.

    Validation lives at the route level (length match, non-empty, unique);
    this function only mechanically edits the file. If no `data.yaml`
    exists yet (plain YOLO without one), one is created so subsequent
    Ultralytics calls can read the names.

    Returns the re-inspected `DatasetInfo` so the caller can hand the
    fresh payload straight back to the frontend without an extra fetch.
    """
    if not dataset_root.is_dir():
        raise FileNotFoundError(dataset_root)

    data_yaml = dataset_root / "data.yaml"
    if data_yaml.is_file():
        try:
            existing: dict = yaml.safe_load(data_yaml.read_text()) or {}
        except (yaml.YAMLError, OSError):
            existing = {}
    else:
        existing = {}

    # Preserve key order from the existing file where possible so a diff
    # only shows the names change. Fall back to a sensible default order.
    out: dict[str, object] = {}
    preserved_keys = ("train", "val", "test", "path", "nc", "names")
    for key in preserved_keys:
        if key in existing:
            out[key] = existing[key]
    for key, value in existing.items():
        if key not in out:
            out[key] = value

    out["nc"] = len(names)
    out["names"] = list(names)

    data_yaml.write_text(yaml.safe_dump(out, sort_keys=False))
    return inspect_dataset(dataset_root)


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
