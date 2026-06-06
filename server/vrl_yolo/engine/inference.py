"""Inference engine — thin wrapper around `ultralytics.YOLO.predict`.

Two task families share one entry point (`infer_single`) and dispatch
internally on `record.task`:

- **Detect** → `DetectionResult` (boxes + counts).
- **Classify** → `ClassificationResult` (top-1 + top-5).

Ultralytics' `Results` objects don't serialize cleanly over JSON, so we
map them to plain dataclasses + `to_json()` helpers shaped for the
frontend.
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass
from typing import Literal, TYPE_CHECKING, Union

from PIL import Image

from vrl_yolo.engine.hardware import Accelerator, detect_accelerator
from vrl_yolo.engine.registry import ModelRegistry

if TYPE_CHECKING:
    from ultralytics import YOLO


# --- Detection ---------------------------------------------------------


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


# --- Classification ----------------------------------------------------


@dataclass(frozen=True)
class ClassificationPrediction:
    class_id: int
    class_name: str
    conf: float  # 0..1, softmax probability over the model's class list

    def to_json(self) -> dict:
        return {
            "class_id": self.class_id,
            "class_name": self.class_name,
            "conf": round(self.conf, 4),
        }


@dataclass(frozen=True)
class ClassificationResult:
    task: Literal["classify"]
    model: str
    image_size: tuple[int, int]
    accelerator: Accelerator
    inference_ms: float
    top1: ClassificationPrediction
    top5: list[ClassificationPrediction]

    def to_json(self) -> dict:
        return {
            "task": self.task,
            "model": self.model,
            "image_size": list(self.image_size),
            "accelerator": {"kind": self.accelerator.kind, "name": self.accelerator.name},
            "inference_ms": round(self.inference_ms, 2),
            "top1": self.top1.to_json(),
            "top5": [p.to_json() for p in self.top5],
        }


InferenceResult = Union[DetectionResult, ClassificationResult]


# --- Engine ------------------------------------------------------------


class InferenceError(Exception):
    """Surfaced to the API layer as 4xx when the cause is user input."""


class InferenceEngine:
    """Stateless façade over the registry + Ultralytics.

    The accelerator is detected lazily on first access (cached afterwards).
    Eager detection at construction time imports torch (~2 s cold), which
    blocked uvicorn's startup and raced the Pyloid window's `load_url`;
    deferring it keeps backend boot under half a second. Reload the
    process to pick up a hot-plugged GPU (rare in clinical settings).
    """

    def __init__(self, registry: ModelRegistry) -> None:
        self._registry = registry
        self._accelerator: Accelerator | None = None

    @property
    def accelerator(self) -> Accelerator:
        if self._accelerator is None:
            self._accelerator = detect_accelerator()
        return self._accelerator

    def infer_single(
        self,
        *,
        image_bytes: bytes,
        model_name: str,
        conf: float = 0.25,
        iou: float = 0.45,
    ) -> InferenceResult:
        """Run a single image through whichever task the model declares.

        For detect: `conf` and `iou` are passed through to NMS, so the
        boxes returned are already filtered.
        For classify: the server always returns the full top-5; the
        `conf` value is a *review threshold* the frontend applies
        client-side ("flag predictions below X for review"). We accept
        it here for symmetry but don't use it during inference.
        """
        if not (0.0 < conf <= 1.0):
            raise InferenceError(f"conf must be in (0, 1]; got {conf!r}")
        if not (0.0 < iou <= 1.0):
            raise InferenceError(f"iou must be in (0, 1]; got {iou!r}")

        try:
            record = self._registry.get(model_name)
        except KeyError as exc:
            raise InferenceError(f"model {model_name!r} not in registry") from exc

        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.load()
        except Exception as exc:  # noqa: BLE001
            raise InferenceError(f"could not decode image: {exc}") from exc

        yolo = self._registry.load(model_name)
        if record.task == "detect":
            return self._run_detect(yolo, image, model_name=model_name, conf=conf, iou=iou)
        if record.task == "classify":
            return self._run_classify(yolo, image, model_name=model_name)
        # Registry only admits detect+classify (see _SUPPORTED_TASKS); a
        # mismatch here means somebody bypassed the registry.
        raise InferenceError(f"unsupported task: {record.task!r}")

    # ---- explain (F6a) -----------------------------------------------

    def explain_single(
        self,
        *,
        image_bytes: bytes,
        model_name: str,
        mode: str = "image",
        box_index: int | None = None,
        conf: float = 0.25,
        iou: float = 0.45,
    ):
        """Eigen-CAM heatmap for one image (see `engine/explain.py`).

        Mirrors `infer_single`'s validation + dispatch. `box` mode is
        detection-only and needs a `box_index`. Returns an
        `ExplanationResult`; `ExplainError` is normalised to
        `InferenceError` so the API layer maps every user-input failure
        to a 4xx the same way single inference does.
        """
        # Imported lazily — pulls cv2 + the explain module only when the
        # user actually asks "why?", keeping the cold inference path lean.
        from vrl_yolo.engine.explain import ExplainError, explain

        if mode not in ("image", "box"):
            raise InferenceError(f"mode must be 'image' or 'box'; got {mode!r}")

        try:
            record = self._registry.get(model_name)
        except KeyError as exc:
            raise InferenceError(f"model {model_name!r} not in registry") from exc

        if record.task == "classify" and mode == "box":
            raise InferenceError("box-mode explanation is detection-only")

        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.load()
        except Exception as exc:  # noqa: BLE001
            raise InferenceError(f"could not decode image: {exc}") from exc

        yolo = self._registry.load(model_name)
        try:
            return explain(
                yolo=yolo,
                image=image,
                model_name=model_name,
                task=record.task,
                mode=mode,  # type: ignore[arg-type]
                box_index=box_index,
                conf=conf,
                iou=iou,
                accelerator_kind=self.accelerator.kind,
            )
        except ExplainError as exc:
            raise InferenceError(str(exc)) from exc

    # ---- detect ------------------------------------------------------

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
        # accelerator. Touching `.accelerator` here is what triggers the
        # one-shot torch import on the first call.
        accelerator = self.accelerator
        results = yolo.predict(
            source=image,
            conf=conf,
            iou=iou,
            device=accelerator.kind if accelerator.kind != "cpu" else None,
            verbose=False,
        )
        inference_ms = (time.perf_counter() - start) * 1000.0

        if not results:
            return DetectionResult(
                task="detect",
                model=model_name,
                image_size=image.size,
                accelerator=accelerator,
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
            accelerator=accelerator,
            inference_ms=inference_ms,
            boxes=boxes_out,
            counts_per_class=counts,
        )

    # ---- classify ----------------------------------------------------

    def _run_classify(
        self,
        yolo: "YOLO",
        image: Image.Image,
        *,
        model_name: str,
    ) -> ClassificationResult:
        """Top-1 / top-5 over the model's class list.

        Ultralytics' classify head produces a `Probs` object on
        `results[0].probs`. Always returns the top-5 — review threshold
        is a client concern (PLAN.md §10).
        """
        start = time.perf_counter()
        accelerator = self.accelerator
        results = yolo.predict(
            source=image,
            device=accelerator.kind if accelerator.kind != "cpu" else None,
            verbose=False,
        )
        inference_ms = (time.perf_counter() - start) * 1000.0

        if not results:
            raise InferenceError("classify inference returned no Results object")

        result = results[0]
        probs = getattr(result, "probs", None)
        if probs is None:
            raise InferenceError(
                f"{model_name!r} returned no probs — checkpoint mis-tagged as classify?"
            )

        names = dict(getattr(result, "names", {}) or {})

        # Ultralytics' Probs API:
        #   .top1        -> int (class index)
        #   .top1conf    -> tensor scalar
        #   .top5        -> list[int] (indices, sorted high→low)
        #   .top5conf    -> tensor of length 5
        top5_ids = list(probs.top5)
        top5_confs = probs.top5conf.cpu().numpy().tolist()
        top5 = [
            ClassificationPrediction(
                class_id=int(cid),
                class_name=names.get(int(cid), f"class_{int(cid)}"),
                conf=float(c),
            )
            for cid, c in zip(top5_ids, top5_confs)
        ]
        # top1 is always top5[0] — Ultralytics guarantees descending order.
        top1 = top5[0] if top5 else ClassificationPrediction(0, "unknown", 0.0)

        return ClassificationResult(
            task="classify",
            model=model_name,
            image_size=image.size,
            accelerator=accelerator,
            inference_ms=inference_ms,
            top1=top1,
            top5=top5,
        )
