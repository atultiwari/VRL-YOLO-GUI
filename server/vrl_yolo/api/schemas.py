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
