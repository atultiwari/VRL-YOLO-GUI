"""Pydantic response/request schemas exposed at /api/*."""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

Task = Literal["detect", "classify"]


class ModelInfo(BaseModel):
    name: str
    task: Task
    source: Literal["bundled", "user", "trained"]
    num_classes: int
    classes: dict[int, str]
    params: int
    size_mb: float


class ModelsListResponse(BaseModel):
    models: list[ModelInfo]
    # Per-task default model name. Tasks with no loaded model are omitted —
    # see ModelRegistry.get_defaults().
    defaults: dict[Task, str] = Field(default_factory=dict)


class SetDefaultRequest(BaseModel):
    task: Task
    name: str


class RenameModelRequest(BaseModel):
    """Body for `POST /api/models/{name}/rename`.

    `new_name` is sanitised by the router (basename only, must end with
    `.pt`, control characters stripped). Bundled models are rejected at
    the registry level.
    """

    new_name: str = Field(..., min_length=1, max_length=200)


class AcceleratorOut(BaseModel):
    kind: Literal["cuda", "mps", "cpu"]
    name: str


# --- Detection response ---


class DetectionBoxOut(BaseModel):
    class_id: int
    class_name: str
    conf: float
    xyxy: list[float] = Field(..., min_length=4, max_length=4)
    xywhn: list[float] = Field(..., min_length=4, max_length=4)


class DetectionResponse(BaseModel):
    task: Literal["detect"]
    model: str
    image_size: list[int] = Field(..., min_length=2, max_length=2)
    accelerator: AcceleratorOut
    inference_ms: float
    boxes: list[DetectionBoxOut]
    counts_per_class: dict[str, int]


# --- Classification response ---


class ClassificationPredictionOut(BaseModel):
    class_id: int
    class_name: str
    conf: float


class ClassificationResponse(BaseModel):
    task: Literal["classify"]
    model: str
    image_size: list[int] = Field(..., min_length=2, max_length=2)
    accelerator: AcceleratorOut
    inference_ms: float
    top1: ClassificationPredictionOut
    top5: list[ClassificationPredictionOut]


# Discriminated union — FastAPI uses the `task` field to pick the right shape
# when validating outgoing responses and when generating the OpenAPI schema.
InferenceResponse = Annotated[
    Union[DetectionResponse, ClassificationResponse],
    Field(discriminator="task"),
]


# --- Presets ---


Domain = Literal["histopathology", "hematology"]


class PresetInfo(BaseModel):
    id: str
    domain: Domain
    task: Task
    label: str
    description: str
    default_model: str
    conf: float
    iou: float | None = None
    class_filter: list[str] | None = None


class PresetsListResponse(BaseModel):
    presets: list[PresetInfo]


# --- Report request ---


class ReportBoxIn(BaseModel):
    class_name: str
    conf: float


class ReportPredictionIn(BaseModel):
    class_name: str
    conf: float


class ReportItemIn(BaseModel):
    """One per-image row included in a CSV / XLSX / PDF report.

    Mirrors what the frontend already has in memory after a batch run —
    we just forward it to the report engine instead of re-running
    inference. `image_b64` is optional and used only for the PDF
    thumbnail grid; PDF stays usable without it (just no images).
    """

    filename: str
    inference_ms: float = 0.0
    # detect-only
    boxes: list[ReportBoxIn] = Field(default_factory=list)
    counts_per_class: dict[str, int] = Field(default_factory=dict)
    # classify-only
    top1: ReportPredictionIn | None = None
    top5: list[ReportPredictionIn] = Field(default_factory=list)
    # PDF-only inline thumbnail (base64, no data: prefix).
    image_b64: str | None = None


class ReportRequest(BaseModel):
    task: Task
    model: str
    items: list[ReportItemIn]
    review_threshold: float = 0.5
    detect_per_class: dict[str, int] | None = None
    classify_per_class: dict[str, int] | None = None
    classify_flagged_count: int | None = None


# --- Train wizard: dataset + hardware ---


DatasetFormatLit = Literal[
    "roboflow_yolo", "yolo", "coco", "voc", "imagefolder", "unknown"
]


class DatasetSplitOut(BaseModel):
    name: str  # "train" / "valid" / "test" / "all"
    image_count: int
    label_count: int


class DatasetInfoOut(BaseModel):
    """What the wizard knows about an uploaded dataset.

    `root_path` is the absolute path under `<storage_root>/datasets/<id>/`
    on the machine the backend is running on. Useful for the user as a
    diagnostic; the frontend doesn't read from it directly — it always
    goes through /api/datasets/{id}.
    """

    id: str
    format: DatasetFormatLit
    task: Task
    root_path: str
    splits: list[DatasetSplitOut]
    classes: list[str]
    class_counts: dict[str, int] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    # Images at the root that aren't in any train/val/test subtree.
    # Frontend uses this to decide whether "preserve existing splits"
    # has anything flat to redistribute (avoids a backend round-trip
    # just to learn there's nothing to do). Zero for both pure-flat
    # layouts and pure-split layouts.
    unassigned_image_count: int = 0


class HardwareInfo(BaseModel):
    kind: Literal["cuda", "mps", "cpu"]
    name: str
    vram_gb: float | None = None
    # Heuristic batch-size suggestion for YOLOv8/YOLO26 detection at the
    # default image size (640). Classification can usually go 2-3× higher
    # at the same VRAM — see `engine/hardware.py`.
    suggested_batch_size: int = 8


class SplitDatasetRequest(BaseModel):
    """Body for `POST /api/datasets/{id}/split`.

    Defaults match the Roboflow recommendation (80 / 10 / 10). The
    backend tolerates ±0.001 drift in the sum to forgive frontend
    rounding (sliders multiplied by 100 + division by 100, etc.).

    `preserve_existing=True` keeps images already in `train/`, `val|valid|
    validation/`, or `test/` subtrees in their current split; ratios then
    apply only to the flat / unassigned pool. Defaults to False so the
    historical reshuffle-everything behaviour is unchanged for callers
    that don't opt in.
    """

    train_ratio: float = Field(0.8, ge=0.0, le=1.0)
    valid_ratio: float = Field(0.1, ge=0.0, le=1.0)
    test_ratio: float = Field(0.1, ge=0.0, le=1.0)
    seed: int = 42
    preserve_existing: bool = False


class RenameClassesRequest(BaseModel):
    """Body for `PATCH /api/datasets/{id}/classes`.

    Length must match the dataset's existing class count — adding or
    removing classes is out of scope for v1 (would require re-labelling).
    Empty strings and duplicates are rejected at the route layer.
    """

    names: list[str] = Field(..., min_length=1)


# --- Training job ---


TrainingStatus = Literal[
    "queued", "running", "completed", "failed", "cancelled"
]


class StartTrainingRequest(BaseModel):
    """Body for `POST /api/training/start`."""

    dataset_id: str
    model: str
    epochs: int = Field(50, ge=1, le=2000)
    imgsz: int = Field(640, ge=64, le=2048)
    batch: int = Field(8, ge=1, le=128)


class TrainingMetrics(BaseModel):
    """Last-seen metrics from the training subprocess.

    Fields default to None until at least one epoch finishes. The
    detect-only fields (box/cls/dfl loss, mAP) and classify-only fields
    (loss, top1, top5) coexist on the same model — the frontend reads
    whichever subset matches `TrainingJobInfo.task`. Keeping them flat
    avoids a discriminated-union schema and lets the snapshot layer
    forward `to_json()` unchanged.
    """

    # detect-only
    box_loss: float | None = None
    cls_loss: float | None = None
    dfl_loss: float | None = None
    mAP50: float | None = None
    mAP50_95: float | None = None
    # classify-only
    loss: float | None = None
    top1: float | None = None
    top5: float | None = None


class TrainingJobInfo(BaseModel):
    job_id: str
    status: TrainingStatus
    dataset_id: str
    model: str
    task: Task
    epochs_total: int
    epoch_current: int = 0
    started_at: str  # ISO 8601 UTC
    finished_at: str | None = None
    # "colab" marks a Colab-backed job (training happens on a remote
    # Colab worker; the desktop streams events through a Cloudflare
    # tunnel). All other kinds are local subprocess jobs.
    accelerator_kind: Literal["cuda", "mps", "cpu", "colab"]
    output_dir: str
    metrics: TrainingMetrics = Field(default_factory=TrainingMetrics)
    error_message: str | None = None


class StartTrainingResponse(BaseModel):
    job_id: str


class ColabConnectRequest(BaseModel):
    """Body for `POST /api/training/colab/connect`.

    The user pastes the URL their Colab notebook cell printed; it has
    the shape `https://<random>.trycloudflare.com?token=<rand>`. The
    backend splits the base from the token, does a 3-second pre-flight
    `GET /status?token=...` to validate the session is live, and seeds
    a TrainingJob whose event stream comes from the tunnel's
    WebSocket.
    """

    tunnel_url: str = Field(..., min_length=10, max_length=2048)


class ColabConnectResponse(BaseModel):
    job_id: str
