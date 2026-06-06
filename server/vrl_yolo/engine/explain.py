"""Eigen-CAM explainability for YOLO detection + classification.

Eigen-CAM (Muhammad & Yeasin, 2020, arXiv:2008.00299) is a *gradient-free*
class-activation map: the heatmap is the first principal component of a
target layer's activations, so there is no backward pass and no per-class
target function. That is the whole reason it's cheap enough to own
in-house rather than take a dependency.

**Key design choice (from `rigvedrs/YOLO-26-CAM`):** we register a forward
hook on an inner layer and run inference through the *ultralytics `YOLO`
object*, so Ultralytics performs its own letterbox / normalize
preprocessing. We never build the input tensor by hand — the same predict
call yields both the activations (via the hook) and the boxes / probs.

A direct consequence of Eigen-CAM being class-agnostic: classification
gets ONE image-level heatmap, not a per-class map (the projection ignores
the predicted class entirely). The UI copy must say "the model responded
most strongly here", not "the model saw class X here".

The three numeric helpers (`_eigen_projection`, `_scale_cam`,
`_heatmap_rgba`) mirror the standard functions in
`jacobgil/pytorch-grad-cam` (MIT) as adapted in `rigvedrs/YOLO-26-CAM`
(MIT, © 2023 Rigved Shirvalkar). See `NOTICE`.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

import cv2
import numpy as np
from PIL import Image

if TYPE_CHECKING:
    from ultralytics import YOLO

ExplainMode = Literal["image", "box"]
ExplainTask = Literal["detect", "classify"]

# Eigen-CAM is the only method in F6a. The field is carried through the
# API so a future gradient method (Grad-CAM, for per-class maps) can slot
# in behind the same response shape without a rewrite.
METHOD = "eigen-cam"


class ExplainError(Exception):
    """User-facing 4xx from the explain path (bad box index, no usable layer)."""


@dataclass(frozen=True)
class ExplanationResult:
    """Output of :func:`explain` — a colorized heatmap + honest stats.

    `heatmap_png` is an **RGBA** PNG sized to the original image: the JET
    colorization of the normalized CAM, with the alpha channel masking
    where the heatmap is active (everything in `image` mode; only the
    selected box in `box` mode). The frontend overlays it on the source
    `<img>` and controls strength with a CSS-opacity slider — so opacity
    is a pure client concern and never round-trips.

    `peak` / `mean` are computed on the **globally-normalized** CAM over
    the active region (so in `box` mode `peak` reads as "how hot is this
    box relative to the image's hottest point" — the number that tells a
    confident-and-focused detection apart from a guess-in-the-noise one).
    """

    task: ExplainTask
    model: str
    mode: ExplainMode
    box_index: int | None
    method: str
    layer_used: str
    degraded: bool
    width: int
    height: int
    heatmap_png: bytes
    peak: float
    mean: float


# --- numeric core (mirrors pytorch-grad-cam; see module docstring) -----


def _eigen_projection(activation: np.ndarray) -> np.ndarray:
    """First principal component of a `[C, H, W]` activation → `[H, W]`.

    Centering before the SVD matters — without it the projection can come
    out sign-flipped (dark where it should be hot). Mirrors
    pytorch-grad-cam's `get_2d_projection` for a single map.
    """
    activation = np.nan_to_num(activation, nan=0.0).astype(np.float32)
    channels = activation.shape[0]
    flat = activation.reshape(channels, -1)  # [C, H*W]
    reshaped = flat.transpose()  # [H*W, C]
    reshaped = reshaped - reshaped.mean(axis=0)
    # full_matrices=False is enough: we only need the first right-singular
    # vector. The array is tiny (e.g. 400×256 at stride 32) so this is
    # sub-millisecond and runs on CPU (the hook already moved it off-GPU).
    _u, _s, vt = np.linalg.svd(reshaped, full_matrices=False)
    projection = reshaped @ vt[0, :]  # [H*W]
    # Resolve the SVD sign ambiguity deterministically. A singular vector's
    # sign is arbitrary, so the projection can come out inverted — and then
    # the ReLU in _scale_cam zeroes the *salient* region instead of the
    # background. Orient the map to correlate positively with per-location
    # activation energy (hot where the layer fired hardest), which is what
    # an explanation should show. (The reference get_2d_projection omits
    # this and silently relies on luck.)
    energy = (flat**2).sum(axis=0)  # [H*W]
    if float(np.dot(projection - projection.mean(), energy - energy.mean())) < 0:
        projection = -projection
    return projection.reshape(activation.shape[1:])  # [H, W]


def _scale_cam(cam: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """ReLU → min-max normalize to [0,1] → resize to `(W, H)`.

    Mirrors `scale_cam_image`. Resizing the small map straight to the
    original size ignores Ultralytics' letterbox padding, so for very
    non-square images the heatmap is slightly stretched — negligible for
    the square 224/640 patches that dominate histopathology.
    """
    cam = np.maximum(cam, 0)
    cam = cam - cam.min()
    cam = cam / (cam.max() + 1e-7)
    return cv2.resize(cam.astype(np.float32), size)  # cv2 size is (W, H)


def _heatmap_rgba(cam01: np.ndarray, alpha_mask: np.ndarray) -> np.ndarray:
    """JET colorization of a `[0,1]` map with a per-pixel alpha mask → RGBA."""
    jet_bgr = cv2.applyColorMap(np.uint8(255 * cam01), cv2.COLORMAP_JET)
    rgb = cv2.cvtColor(jet_bgr, cv2.COLOR_BGR2RGB)
    return np.dstack([rgb, alpha_mask]).astype(np.uint8)


def _png_bytes(rgba: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


# --- target layer selection --------------------------------------------


def _pick_target_layer(yolo: YOLO) -> tuple[object, str, bool]:
    """Return `(layer, label, degraded)` for the hook.

    Default is `model.model.model[-2]` — the last conv-bearing block
    before the head, the universal pick the reference repo + its test use
    for both detect and classify. Falls back to the last `nn.Conv2d` in
    the tree (flagged `degraded`) for odd / older user imports where the
    `[-2]` slice isn't available.
    """
    import torch.nn as nn

    inner = getattr(yolo, "model", None)
    seq = getattr(inner, "model", None)
    if seq is not None:
        try:
            layer = seq[-2]
            return layer, f"model.model.model[-2] ({type(layer).__name__})", False
        except (IndexError, TypeError, KeyError):
            pass

    last_conv: object | None = None
    if inner is not None and hasattr(inner, "modules"):
        for module in inner.modules():
            if isinstance(module, nn.Conv2d):
                last_conv = module
    if last_conv is None:
        raise ExplainError(
            "could not locate a convolutional layer to explain in this model"
        )
    return last_conv, f"last Conv2d ({type(last_conv).__name__})", True


# --- main entry point --------------------------------------------------


def explain(
    *,
    yolo: YOLO,
    image: Image.Image,
    model_name: str,
    task: ExplainTask,
    mode: ExplainMode = "image",
    box_index: int | None = None,
    conf: float = 0.25,
    iou: float = 0.45,
    accelerator_kind: str | None = None,
) -> ExplanationResult:
    """Compute an Eigen-CAM heatmap for one image.

    Pure over the registry: takes a warm `YOLO` + a PIL image, returns an
    :class:`ExplanationResult`. `box` mode is detection-only and
    renormalizes the CAM inside the selected box so the overlay reads as
    "what drove *this* detection".
    """
    image = image.convert("RGB")
    width, height = image.size

    layer, layer_label, degraded = _pick_target_layer(yolo)

    captured: list[np.ndarray] = []

    def _hook(_module: object, _inp: object, output: object) -> None:
        tensor = output[0] if isinstance(output, (list, tuple)) else output
        try:
            captured.append(tensor.detach().cpu().float().numpy())
        except AttributeError:
            pass  # non-tensor output (rare) — validated after predict

    handle = layer.register_forward_hook(_hook)  # type: ignore[attr-defined]
    try:
        predict_kwargs: dict[str, object] = {"source": image, "verbose": False}
        if accelerator_kind and accelerator_kind != "cpu":
            predict_kwargs["device"] = accelerator_kind
        if task == "detect":
            predict_kwargs["conf"] = conf
            predict_kwargs["iou"] = iou
        results = yolo.predict(**predict_kwargs)
    finally:
        handle.remove()

    feature_maps = [a for a in captured if a.ndim == 4 and a.shape[0] >= 1]
    if not feature_maps:
        raise ExplainError(
            f"explanation layer {layer_label} produced no 2-D feature map"
        )

    cam = _eigen_projection(feature_maps[-1][0])  # [h, w]
    cam01 = _scale_cam(cam, (width, height))  # [H, W] in [0,1]

    if mode == "box":
        if task != "detect":
            raise ExplainError("box-mode explanation is detection-only")
        x1, y1, x2, y2 = _box_pixels(results, box_index, width, height)
        region = cam01[y1:y2, x1:x2]
        if region.size == 0:
            raise ExplainError(f"box {box_index} is degenerate (zero area)")
        peak = float(region.max())  # global-relative — matches color scale below
        mean = float(region.mean())
        # Renormalize within the box for visual contrast (jacobgil's
        # renormalize-in-box technique); zero + transparent outside.
        local = region - region.min()
        local = local / (local.max() + 1e-7)
        box_cam = np.zeros_like(cam01)
        box_cam[y1:y2, x1:x2] = local
        alpha = np.zeros(cam01.shape, dtype=np.uint8)
        alpha[y1:y2, x1:x2] = 255
        rgba = _heatmap_rgba(box_cam, alpha)
    else:
        peak = float(cam01.max())
        mean = float(cam01.mean())
        alpha = np.full(cam01.shape, 255, dtype=np.uint8)
        rgba = _heatmap_rgba(cam01, alpha)

    return ExplanationResult(
        task=task,
        model=model_name,
        mode=mode,
        box_index=box_index if mode == "box" else None,
        method=METHOD,
        layer_used=layer_label,
        degraded=degraded,
        width=width,
        height=height,
        heatmap_png=_png_bytes(rgba),
        peak=round(peak, 4),
        mean=round(mean, 4),
    )


def _box_pixels(
    results: object, box_index: int | None, width: int, height: int
) -> tuple[int, int, int, int]:
    """Clamp the selected detection box to image pixels, or raise."""
    first = results[0] if results else None  # type: ignore[index]
    boxes = getattr(first, "boxes", None)
    if boxes is None or len(boxes) == 0:
        raise ExplainError("no detections to explain on this image")
    xyxy = boxes.xyxy.cpu().numpy()
    count = len(xyxy)
    if box_index is None or not (0 <= box_index < count):
        raise ExplainError(
            f"box_index {box_index} out of range (image has {count} box"
            f"{'es' if count != 1 else ''})"
        )
    x1, y1, x2, y2 = (int(round(v)) for v in xyxy[box_index])
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(width, x2), min(height, y2)
    if x2 <= x1 or y2 <= y1:
        raise ExplainError(f"box {box_index} is degenerate after clamping")
    return x1, y1, x2, y2
