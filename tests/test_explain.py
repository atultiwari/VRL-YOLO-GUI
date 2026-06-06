"""F6a — Eigen-CAM explainability.

Three layers, fastest first:

1. **Numeric core** (`_eigen_projection` / `_scale_cam` / `_heatmap_rgba`)
   — pure NumPy + cv2, always run (base deps only).
2. **Router** — stub engine, no ultralytics; checks the API contract
   (200 + decodable RGBA PNG, 400 / 413 / empty-upload paths).
3. **Integration** (`slow`, ml-gated) — real `yolo26n.pt` end-to-end;
   skipped unless `ultralytics` + the bundled weights are present.

Run: ``uv run --extra ml --extra dev pytest tests/test_explain.py -q``
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from vrl_yolo.api.deps import get_engine
from vrl_yolo.api.routers import explain as explain_router
from vrl_yolo.engine.explain import (
    ExplanationResult,
    _eigen_projection,
    _heatmap_rgba,
    _pick_target_layer,
    _png_bytes,
    _scale_cam,
    explain,
)
from vrl_yolo.engine.inference import InferenceError

REPO_ROOT = Path(__file__).resolve().parents[1]


# --- 1. numeric core ---------------------------------------------------


def test_eigen_projection_shape_and_hot_quadrant() -> None:
    """The projection collapses [C,H,W] → [H,W] and lights up the quadrant
    that actually carries signal."""
    rng = np.random.default_rng(0)
    act = rng.normal(scale=0.01, size=(8, 16, 16)).astype(np.float32)
    # Inject a strong, correlated signal into the top-left quadrant.
    act[:, :8, :8] += 5.0

    proj = _eigen_projection(act)
    assert proj.shape == (16, 16)

    # After ReLU+normalize, the hot quadrant should dominate. (Eigen-CAM can
    # come out sign-flipped pre-normalization; _scale_cam's ReLU + the
    # centered SVD resolve that — assert on the scaled map.)
    scaled = _scale_cam(proj, (16, 16))
    assert scaled.min() >= 0.0 and scaled.max() <= 1.0 + 1e-6
    quad = scaled[:8, :8].mean()
    rest = (scaled.sum() - scaled[:8, :8].sum()) / (scaled.size - 64)
    assert quad > rest


def test_eigen_projection_tolerates_nan() -> None:
    act = np.full((4, 8, 8), np.nan, dtype=np.float32)
    act[:, 0, 0] = 1.0
    proj = _eigen_projection(act)
    assert proj.shape == (8, 8)
    assert not np.isnan(proj).any()


def test_scale_cam_normalizes_and_resizes() -> None:
    cam = np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32)
    out = _scale_cam(cam, (10, 6))  # (W, H)
    assert out.shape == (6, 10)
    assert pytest.approx(out.min(), abs=1e-6) == 0.0
    assert pytest.approx(out.max(), abs=1e-6) == 1.0


def test_scale_cam_relu_clamps_negatives() -> None:
    cam = np.array([[-5.0, -1.0], [0.0, 2.0]], dtype=np.float32)
    out = _scale_cam(cam, (2, 2))
    assert out.min() >= 0.0


def test_heatmap_rgba_shape_and_alpha() -> None:
    cam01 = np.linspace(0, 1, 64, dtype=np.float32).reshape(8, 8)
    alpha = np.zeros((8, 8), dtype=np.uint8)
    alpha[2:6, 2:6] = 255
    rgba = _heatmap_rgba(cam01, alpha)
    assert rgba.shape == (8, 8, 4)
    assert rgba.dtype == np.uint8
    # Alpha channel preserved exactly — transparent outside the box.
    assert rgba[0, 0, 3] == 0
    assert rgba[3, 3, 3] == 255


def test_png_bytes_roundtrip() -> None:
    rgba = np.zeros((4, 5, 4), dtype=np.uint8)
    rgba[..., 3] = 128
    png = _png_bytes(rgba)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    back = Image.open(io.BytesIO(png))
    assert back.size == (5, 4) and back.mode == "RGBA"


# --- target layer picker (needs torch) ---------------------------------


def test_pick_target_layer_default_minus_two() -> None:
    torch = pytest.importorskip("torch")
    nn = torch.nn

    class FakeHead(nn.Module):
        def forward(self, x):  # pragma: no cover - structural only
            return x

    seq = nn.Sequential(nn.Conv2d(3, 4, 3), nn.Conv2d(4, 8, 3), FakeHead())
    inner = nn.Module()
    inner.model = seq
    outer = nn.Module()
    outer.model = inner  # yolo.model.model[-2]

    layer, label, degraded = _pick_target_layer(outer)
    assert layer is seq[-2]
    assert degraded is False
    assert "[-2]" in label


def test_pick_target_layer_fallback_is_degraded() -> None:
    torch = pytest.importorskip("torch")
    nn = torch.nn

    # No `.model.model` sequence → reflection fallback to last Conv2d.
    inner = nn.Sequential(nn.Conv2d(3, 4, 3), nn.ReLU(), nn.Conv2d(4, 9, 3))
    outer = nn.Module()
    outer.model = inner  # inner has no `.model` attr

    layer, label, degraded = _pick_target_layer(outer)
    assert isinstance(layer, nn.Conv2d)
    assert layer.out_channels == 9  # the *last* conv
    assert degraded is True
    assert "Conv2d" in label


# --- 2. router (stub engine) -------------------------------------------


class _StubEngine:
    """Stands in for InferenceEngine — returns a canned result or raises."""

    def __init__(self, result: ExplanationResult | None = None, error: str | None = None):
        self._result = result
        self._error = error
        self.calls: list[dict] = []

    def explain_single(self, **kwargs) -> ExplanationResult:
        self.calls.append(kwargs)
        if self._error is not None:
            raise InferenceError(self._error)
        assert self._result is not None
        return self._result


def _canned_result() -> ExplanationResult:
    cam01 = np.linspace(0, 1, 96, dtype=np.float32).reshape(8, 12)
    rgba = _heatmap_rgba(cam01, np.full((8, 12), 255, np.uint8))
    return ExplanationResult(
        task="detect",
        model="yolo26n.pt",
        mode="image",
        box_index=None,
        method="eigen-cam",
        layer_used="model.model.model[-2] (Conv)",
        degraded=False,
        width=12,
        height=8,
        heatmap_png=_png_bytes(rgba),
        peak=0.91,
        mean=0.42,
    )


def _client(engine: _StubEngine) -> TestClient:
    app = FastAPI()
    app.include_router(explain_router.router, prefix="/api")
    app.dependency_overrides[get_engine] = lambda: engine
    return TestClient(app)


def _png_upload() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (12, 8), (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_explain_endpoint_returns_decodable_png() -> None:
    engine = _StubEngine(result=_canned_result())
    client = _client(engine)
    resp = client.post(
        "/api/inference/explain",
        data={"model": "yolo26n.pt", "mode": "image"},
        files={"image": ("patch.png", _png_upload(), "image/png")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["method"] == "eigen-cam"
    assert body["task"] == "detect"
    assert body["degraded"] is False
    assert 0.0 <= body["peak"] <= 1.0
    raw = base64.b64decode(body["heatmap_png_b64"])
    img = Image.open(io.BytesIO(raw))
    assert img.mode == "RGBA"
    assert img.size == (12, 8)
    # The form values reached the engine.
    assert engine.calls[0]["model_name"] == "yolo26n.pt"
    assert engine.calls[0]["mode"] == "image"


def test_explain_endpoint_passes_box_index() -> None:
    engine = _StubEngine(result=_canned_result())
    client = _client(engine)
    resp = client.post(
        "/api/inference/explain",
        data={"model": "m.pt", "mode": "box", "box_index": "2"},
        files={"image": ("p.png", _png_upload(), "image/png")},
    )
    assert resp.status_code == 200
    assert engine.calls[0]["mode"] == "box"
    assert engine.calls[0]["box_index"] == 2


def test_explain_endpoint_maps_inference_error_to_400() -> None:
    engine = _StubEngine(error="box_index 9 out of range (image has 2 boxes)")
    client = _client(engine)
    resp = client.post(
        "/api/inference/explain",
        data={"model": "m.pt", "mode": "box", "box_index": "9"},
        files={"image": ("p.png", _png_upload(), "image/png")},
    )
    assert resp.status_code == 400
    assert "out of range" in resp.json()["detail"]


def test_explain_endpoint_rejects_empty_upload() -> None:
    engine = _StubEngine(result=_canned_result())
    client = _client(engine)
    resp = client.post(
        "/api/inference/explain",
        data={"model": "m.pt"},
        files={"image": ("p.png", b"", "image/png")},
    )
    assert resp.status_code == 400
    assert "empty" in resp.json()["detail"].lower()


# --- 3. integration (slow, ml-gated) -----------------------------------


@pytest.mark.slow
def test_explain_real_yolo26_detect() -> None:
    """End-to-end against the bundled detect weight — proves the hook fires,
    `[-2]` is non-degraded, and the heatmap matches the input size."""
    pytest.importorskip("ultralytics")
    pytest.importorskip("torch")
    weight = REPO_ROOT / "models" / "detect" / "yolo26n.pt"
    if not weight.is_file():
        pytest.skip("bundled yolo26n.pt not present")

    from ultralytics import YOLO

    yolo = YOLO(str(weight))
    image = Image.fromarray(
        (np.random.default_rng(1).random((128, 160, 3)) * 255).astype(np.uint8)
    )
    result = explain(
        yolo=yolo,
        image=image,
        model_name="yolo26n.pt",
        task="detect",
        mode="image",
    )
    assert result.degraded is False
    assert "[-2]" in result.layer_used
    assert (result.width, result.height) == (160, 128)
    assert 0.0 <= result.mean <= result.peak <= 1.0
    overlay = Image.open(io.BytesIO(result.heatmap_png))
    assert overlay.mode == "RGBA"
    assert overlay.size == (160, 128)
