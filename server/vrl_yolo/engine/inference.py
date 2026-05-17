"""Inference engine — thin wrapper around `ultralytics.YOLO.predict`.

P1 ships detection only. Classification (which doesn't have boxes and
needs a different result shape) lands in P2 — see the `_run_detect`
implementation below for the eventual `_run_classify` neighbour.

Result schema is what the frontend consumes — Ultralytics' `Results`
objects don't serialize well over JSON, so we map them to plain dicts.
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TYPE_CHECKING

from PIL import Image

from vrl_yolo.engine.hardware import Accelerator, detect_accelerator
from vrl_yolo.engine.registry import ModelRegistry, Task

if TYPE_CHECKING:
    from ultralytics import YOLO


@dataclass(frozen=True)
class DetectionBox:
    class_id: int
    class_name: str
    conf: float
    xyxy: tuple[float, float, float, float]  # absolute pixel coords
    xywhn: tuple[float, float, float, float]  # normalised cx, cy, w, h

    def to_json(self) -> dict:
        return {
            "class_id": self.class_id,
            "class_name": self.class_name,
            "conf": round(self.conf, 4),
            "xyxy": [round(v, 2) for v in self.xyxy],
            "xywhn": [round(v, 6) for v in self.xywhn],
        }


@dataclass(frozen=True)
class DetectionResult:
    task: Literal["detect"]
    model: str
    image_size: tuple[int, int]  # (width, height) in pixels
    accelerator: Accelerator
    inference_ms: float
    boxes: list[DetectionBox]
    counts_per_class: dict[str, int]

    def to_json(self) -> dict:
        return {
            "task": self.task,
            "model": self.model,
            "image_size": list(self.image_size),
            "accelerator": {"kind": self.accelerator.kind, "name": self.accelerator.name},
            "inference_ms": round(self.inference_ms, 2),
            "boxes": [b.to_json() for b in self.boxes],
            "counts_per_class": self.counts_per_class,
        }


class InferenceError(Exception):
    """Surfaced to the API layer as 4xx when the cause is user input."""


class InferenceEngine:
    """Stateless façade over the registry + Ultralytics.

    The accelerator is detected once at construction time. Reload the
    process to pick up a hot-plugged GPU (rare in clinical settings).
    """

    def __init__(self, registry: ModelRegistry) -> None:
        self._registry = registry
        self._accelerator = detect_accelerator()

    @property
    def accelerator(self) -> Accelerator:
        return self._accelerator

    def infer_single(
        self,
        *,
        image_bytes: bytes,
        model_name: str,
        conf: float = 0.25,
        iou: float = 0.45,
    ) -> DetectionResult:
        if not (0.0 < conf <= 1.0):
            raise InferenceError(f"conf must be in (0, 1]; got {conf!r}")
        if not (0.0 < iou <= 1.0):
            raise InferenceError(f"iou must be in (0, 1]; got {iou!r}")

        try:
            record = self._registry.get(model_name)
        except KeyError as exc:
            raise InferenceError(f"model {model_name!r} not in registry") from exc

        if record.task != "detect":
            # Classification reuses this surface in P2 via a sibling method;
            # routing the request here is a frontend bug worth flagging hard.
            raise InferenceError(
                f"{model_name!r} is a {record.task!r} model; "
                "POST /api/inference/single (classify) once P2 lands"
            )

        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.load()
        except Exception as exc:  # noqa: BLE001
            raise InferenceError(f"could not decode image: {exc}") from exc

        yolo = self._registry.load(model_name)
        return self._run_detect(yolo, image, model_name=model_name, conf=conf, iou=iou)

    def _run_detect(
        self,
        yolo: "YOLO",
        image: Image.Image,
        *,
        model_name: str,
        conf: float,
        iou: float,
    ) -> DetectionResult:
        start = time.perf_counter()
        # ultralytics accepts PIL.Image directly; passing device picks the
        # accelerator detected at construction.
        results = yolo.predict(
            source=image,
            conf=conf,
            iou=iou,
            device=self._accelerator.kind if self._accelerator.kind != "cpu" else None,
            verbose=False,
        )
        inference_ms = (time.perf_counter() - start) * 1000.0

        if not results:
            return DetectionResult(
                task="detect",
                model=model_name,
                image_size=image.size,
                accelerator=self._accelerator,
                inference_ms=inference_ms,
                boxes=[],
                counts_per_class={},
            )

        result = results[0]
        names = dict(getattr(result, "names", {}) or {})
        boxes_out: list[DetectionBox] = []
        counts: dict[str, int] = {}

        if result.boxes is not None and len(result.boxes) > 0:
            # Pull torch tensors to CPU once — repeated .cpu() in a loop is slow.
            xyxy = result.boxes.xyxy.cpu().numpy()
            xywhn = result.boxes.xywhn.cpu().numpy()
            confs = result.boxes.conf.cpu().numpy()
            cls = result.boxes.cls.cpu().numpy().astype(int)

            for i in range(len(cls)):
                class_id = int(cls[i])
                class_name = names.get(class_id, f"class_{class_id}")
                boxes_out.append(
                    DetectionBox(
                        class_id=class_id,
                        class_name=class_name,
                        conf=float(confs[i]),
                        xyxy=tuple(float(v) for v in xyxy[i]),  # type: ignore[arg-type]
                        xywhn=tuple(float(v) for v in xywhn[i]),  # type: ignore[arg-type]
                    )
                )
                counts[class_name] = counts.get(class_name, 0) + 1

        return DetectionResult(
            task="detect",
            model=model_name,
            image_size=image.size,
            accelerator=self._accelerator,
            inference_ms=inference_ms,
            boxes=boxes_out,
            counts_per_class=counts,
        )
