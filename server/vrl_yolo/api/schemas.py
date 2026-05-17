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


class HardwareInfo(BaseModel):
    kind: Literal["cuda", "mps", "cpu"]
    name: str
    vram_gb: float | None = None
    # Heuristic batch-size suggestion for YOLOv8/YOLO26 detection at the
    # default image size (640). Classification can usually go 2-3× higher
    # at the same VRAM — see `engine/hardware.py`.
    suggested_batch_size: int = 8
