# F6a Plan — Explainable AI: Eigen-CAM engine + "Why?" on `/predict`

> Concrete plan for the **first half of Future Feature #6** (Explainable
> AI) from `docs/FUTURE-FEATURES.md §6`. **Not yet committed to
> implementation** — this doc captures the design + open decisions for
> sign-off before any code lands.
>
> F6 re-opens the Future-Features chain *after* it was declared complete
> at F4 — the user requested XAI as the next feature ahead of P7. F6 is
> split into two phases:
>
> - **F6a (this doc)** — backend Eigen-CAM engine + single-image **Why?**
>   modal on `/predict` (detect per-box, classify image-level). The core
>   clinical value, one reviewable commit.
> - **F6b (outlined in §9)** — reports (PDF/XLSX "include explanations"),
>   `/models` "Test explanation" CTA, and a `/settings` Explanations
>   section.
>
> Once signed off, this becomes the F6a section in `docs/PHASE-STATUS.md`
> at phase boundary, plus the matching `CHANGELOG.md` /
> `apps/web/lib/changelog.ts` entries.

---

## 0. Decisions already taken (2026-06-06)

Settled with the user before this plan was written:

1. **Pure in-house Eigen-CAM** — no new dependency. Not vendoring
   `rigvedrs/YOLO-26-CAM`, not depending on `jacobgil/pytorch-grad-cam`.
   We already ship `torch`, `numpy`, `opencv-python` (`pyproject.toml`
   `ml` extra + base deps) — Eigen-CAM needs nothing more.
2. **Split F6a + F6b.** This doc is F6a only.

**Why Eigen-CAM specifically is cheap to own:** it is *gradient-free*.
It is the first principal component of the target layer's activation
map — a forward hook + an SVD, no backward pass, no per-class target
function. That is ~80 lines and the reason it's worth building rather
than importing.

---

## 1. The load-bearing consequence of choosing Eigen-CAM (read first)

**Eigen-CAM is class-agnostic.** It explains *"which region dominated
the model's activations for this image"*, not *"why class X."* It takes
no class label as input. Two direct consequences that revise the
`FUTURE-FEATURES §6` sketch:

- **Classification gets ONE image-level heatmap, not a per-class
  (Top-1…Top-5) switcher.** The §6 sketch proposed a per-class radio so
  the user could compare "dog (0.7) vs wolf (0.2) — what did it look at
  for each?" **That is not achievable with Eigen-CAM** — the heatmap is
  identical regardless of class because no class gradient is involved.
  Per-class explanations would require Grad-CAM/Grad-CAM++ (gradient
  methods), which the user explicitly declined for v1.1.
- **Clinical wording must not imply class causation.** The modal says
  *"The model's response was strongest in the highlighted region"* —
  **not** *"the model saw [class] here."* (§6 open-question 7.)

This is the honest trade for "minimal, zero-dependency, fully owned."
**Decision D1 below asks you to confirm it.** If per-class classify
explanations turn out to matter at pilot, that's a later phase that adds
Grad-CAM as a *second* method behind the same modal — the F6a API is
designed to accept that without a rewrite (see §5, `method` is fixed to
`"eigen-cam"` now but the response carries the field).

---

## 2. Scope summary (F6a)

A **Why?** affordance on the existing `/predict` single-image view that
overlays an Eigen-CAM heatmap onto the source image.

- **Detection view:** per-box heatmap. Eigen-CAM is computed once for
  the whole image, then **renormalized inside each box** (jacobgil's
  `renormalize_cam_in_bounding_boxes` technique) so the overlay reads as
  "what drove *this* detection." Modal steps through boxes (prev/next),
  highlighting the active box.
- **Classification view:** one image-level heatmap (per §1).
- **Modal controls:** opacity slider (0–100%, default ~50%), a
  **peak-activation** stat beside the overlay (so a focused-and-confident
  map is visually distinguishable from a guess-in-the-noise map — §6
  open-question 6), and for detect the box stepper.
- **Default method:** Eigen-CAM (the only method in F6a).

**Explicitly out of F6a** (→ F6b or later): folder-batch explanations,
PDF/XLSX report embedding, `/models` "Test explanation" CTA, `/settings`
Explanations section, any second CAM method.

---

## 3. Backend — `server/vrl_yolo/engine/explain.py` (new module)

### 3.1 Public surface

```text
@dataclass(frozen=True)
class ExplanationResult:
    task: "detect" | "classify"
    model: str
    mode: "image" | "box"
    box_index: int | None
    layer_used: str            # qualified name of the hooked layer, for transparency
    width: int, height: int    # original image px
    overlay_png: bytes         # JET overlay pre-blended at the requested opacity
    heatmap_png: bytes         # raw grayscale CAM, same HxW (for report/debug use)
    stats: { peak: float, mean: float }   # over the [0,1]-normalized CAM

def explain(*, yolo, image, task, mode, box_index=None, opacity=0.5,
            boxes=None) -> ExplanationResult
```

`boxes` (the already-computed detection boxes from `infer_single`) are
passed in for the per-box renormalization so we don't re-run NMS.

### 3.2 Algorithm (Eigen-CAM, gradient-free)

**Key simplification learned from the reference source (`rigvedrs/
YOLO-26-CAM`):** do **not** build the input tensor by hand. Register the
hook on the inner target layer, then call **`yolo.predict(image)` on the
ultralytics `YOLO` object** — Ultralytics does its own
letterbox/normalize preprocessing and the forward hook fires during that
pass. This is the same single predict call that yields the detection
boxes / classify probs, so explanation + prediction share one forward.
(Their `ActivationsAndGradients.__call__` is literally `self.model(x)`
where `self.model` is the YOLO object; the test feeds a raw `123×456`
uint8 frame and gets a `123×456` CAM back.) This removes the entire
manual-`LetterBox` step that was the original R1.

1. **Pick the target layer** (§3.3).
2. **Register a forward hook** on it capturing the activation tensor `A`
   of shape `[1, C, h, w]` (guard: if `output` is a tuple/list, take
   `output[0]`); `.detach().cpu()` it in the hook.
3. **Forward once via the YOLO object.** Run `yolo.predict(source=image,
   device=…, verbose=False)` (reuse the engine accelerator + conf/iou for
   detect). The hook fills `A`; the `Results` give boxes/probs. Always
   remove the hook in a `finally`.
4. **Eigen-CAM** (`get_2d_projection`): reshape `A[0]` → `[C, h*w]`,
   transpose → `[h*w, C]`, subtract per-column mean, SVD, project onto
   the first right-singular vector (`VT[0]`) → `[h*w]` → reshape
   `[h, w]`. NaN→0. Clip negatives (`np.maximum(·,0)`).
5. **Normalize + resize to original** (`scale_cam_image`): per-map
   `(x−min)/(max+1e-7)` then `cv2.resize` straight to original `(W,H)`.
   (See §7 R1 for the non-square letterbox caveat this glosses over.)
6. **Per-box mode** (detect): copy the full CAM, and for the selected
   box re-scale that box's sub-region to its own `[0,1]`; zero (or dim)
   everything outside the box. `stats.peak/mean` computed over the box
   region in this mode.
7. **Colorize + blend** (`show_cam_on_image`): `cv2.applyColorMap(JET)`
   → blend with source at `opacity`. Encode overlay + raw heatmap to PNG
   bytes. (D3: server bakes a default-opacity overlay; the modal blends
   client-side for live drag.)

**Attribution.** `get_2d_projection`, `scale_cam_image`, and
`show_cam_on_image` are the standard functions from
`jacobgil/pytorch-grad-cam` (MIT) as adapted in `rigvedrs/YOLO-26-CAM`
(MIT, © 2023 Rigved Shirvalkar). Our in-house versions mirror them
closely — **add a credit line to `NOTICE`** + a module-docstring
reference even though no file is copied verbatim.

### 3.3 Target-layer selection

The reference repo + its test use **`model.model.model[-2]`** as the
universal target for *all* tasks (the test uses it for `cls`; the
notebooks for `od`/`seg`). `yolo.model` is the Ultralytics
`DetectionModel`/`ClassificationModel`, `.model` is its `Sequential`,
`[-1]` is the head (`Detect`/`Classify`), so `[-2]` is the last
conv-bearing block before the head — for both tasks.

- **Default:** `yolo.model.model[-2]`. Set `layer_used =
  f"model.model.model[-2] ({type(layer).__name__})"`.
- **Fallback (user imports):** if `[-2]` isn't a usable module / its hook
  yields no 4-D activation (odd/older checkpoint), walk
  `yolo.model.modules()` for the **last `nn.Conv2d`**, use that, and set
  `degraded: true` → the modal surfaces *"explanation layer
  auto-detected — interpret with care."* (D5.)
- No per-architecture override dict in F6a — `[-2]` is the blessed pick
  for our entire bundled set (`yolo26{n,s}` + `yolov8{n,s}`,
  detect+classify); add a registry only if a real checkpoint needs it.

### 3.4 Caching

Session-lifetime LRU keyed by `(model_name, image_sha256, mode,
box_index)`, small cap (~32). Recompute is cheap (one forward + a tiny
SVD), so this only de-dupes the opacity-slider / box-stepper churn
within a single modal session. Lives in `InferenceEngine` (it already
owns the registry + accelerator). No disk persistence (§6 open-q 5 —
don't store overlays).

### 3.5 Performance

One forward pass + an SVD on `[h*w, C]` (e.g. `6400×256` at the 80×80
detect stride — sub-millisecond SVD). Expect **sub-200 ms after warm**
on MPS/CUDA, ~0.3–1 s on CPU. Acceptable for the per-case review use
case. No batch path in F6a.

---

## 4. Where it plugs into the engine

`InferenceEngine` (`engine/inference.py`) gains one method
`explain_single(...)` that mirrors `infer_single`'s signature
(image_bytes, model_name, mode, box_index, opacity), loads the warm YOLO
via the registry, and delegates to `explain.py`. Keeps `explain.py` pure
(takes a model + PIL image, returns a result) and testable without the
registry. For detect per-box it first runs `infer_single` (or accepts
caller-supplied boxes) to know the box coords.

---

## 5. API — `server/vrl_yolo/api/routers/explain.py` (new router)

New router (not bolted onto `inference.py`) per the small-files rule.

```text
POST /api/inference/explain        (multipart, mirrors /inference/single)
  form: image: file, model: str, mode: "image"|"box" = "image",
        box_index: int | null, opacity: float = 0.5
  200 → {
    task, model, mode, box_index, method: "eigen-cam", layer_used,
    degraded: bool, width, height,
    overlay_png_b64: str, stats: { peak, mean }
  }
  400 InferenceError (bad model/image/box_index out of range)
  413 over MAX_BYTES (reuse inference.py's 200 MB cap)
```

- **Stateless, re-uploads the image** (matches `/inference/single`; no
  server-side "last result" coupling). Simplest + consistent. (D4.)
- `method` is hard-fixed `"eigen-cam"` server-side in F6a but present in
  the response so the frontend + a future Grad-CAM phase need no shape
  change.
- `degraded` is the §3.3 reflection-fallback flag.
- New Pydantic `ExplainResponse` in `api/schemas.py`.

---

## 6. Frontend

- **`lib/api.ts`** — `explainInference({ image, model, mode, boxIndex,
  opacity })` → `ExplainResponse`; `lib/types.ts` gets `ExplainResponse`.
- **`components/predict/why-modal.tsx`** (new) — the modal. Reuses the
  **existing in-repo modal pattern** (the Connect-to-Colab / delete
  modals — *not* a new `components/ui/dialog` primitive; confirm which
  pattern during impl). Contents:
  - Overlay `<img>` (base64 PNG), source image beneath / side-by-side.
  - Opacity `<Slider>` (reuse `components/ui/slider.tsx`) — re-requests
    on release (cache makes this cheap) **or** client-side alpha-composite
    for live drag (decide in impl; client-side is smoother — D3).
  - **Detect:** box stepper (prev/next) + active-box label + `peak`
    stat. Image-level toggle ("show whole-image heatmap").
  - **Classify:** single heatmap + `peak` stat + the clinical caption
    from §1.
  - `degraded` → an amber inline note.
- **`app/predict/page.tsx`** (840 lines — keep the modal *out* of it):
  add a **Why?** button to the single-result view — per box on detect,
  one on the classify result. Button opens the modal with the right
  scope. No other change to the page's data flow.

No `/settings` or report changes in F6a.

---

## 7. Risks

- **R1 — Non-square letterbox stretch (was: preprocessing fidelity).**
  *Downgraded* now that we let Ultralytics preprocess (§3.2). The
  remaining issue: `scale_cam_image` resizes the small activation map
  straight to the original `(W,H)`, ignoring that the conv map
  corresponds to Ultralytics' *padded square*. For non-square inputs the
  heatmap is slightly stretched / offset. Negligible for the square
  224/640 patches that dominate histopath; **note it in the modal copy
  only if it proves visible.** Still do the manual overlay-alignment
  spot-check on a bundled image before commit
  ([[feedback-check-ui-reachability]] — a green test won't prove the
  heatmap is visually right; eyeball it).
- **R2 — `[-2]` wrong on an odd checkpoint.** Mitigated by the
  last-`Conv2d` reflection fallback + `degraded` flag (§3.3). Our
  bundled set all use `[-2]` per the reference test.
- **R3 — SVD on MPS.** `np.linalg.svd` runs on CPU (activations are
  `.cpu()`'d in the hook), so MPS SVD gaps don't apply — the projection
  math is pure NumPy on a tiny `[h*w, C]` array. No special-casing
  needed.
- **R4 — Hook fires zero or >1 times.** A warmup/odd predict path could
  leave `A` empty or stale. Guard: clear the capture list before
  `predict`, assert exactly one 4-D activation after, raise
  `InferenceError` otherwise (→ fallback layer / clear error).

---

## 8. Tests (F6a) — synthetic-first, per the project pattern

`tests/test_explain.py`:

- **Target-layer picker** — synthetic `nn.Module` (a couple of
  `nn.Conv2d` + a fake head class named `Detect`/`Classify`); assert the
  picker returns the last conv before the head, and the reflection
  fallback fires (with `degraded`) when no head is present.
- **Eigen-CAM math** — feed a known activation through the CAM core;
  assert output shape == image HxW, values in `[0,1]`, deterministic,
  and that a synthetic activation with a hot quadrant peaks in that
  quadrant.
- **Per-box renormalization** — assert the in-box region scales to its
  own `[0,1]` and out-of-box is zeroed/dimmed; `box_index` out of range
  → `InferenceError`.
- **Stats** — `peak`/`mean` computed over the right region per mode.
- **API** — `POST /api/inference/explain` against a stub engine returns
  200 + a valid base64 PNG (decode + assert PNG magic + dims); 400 on
  bad model; 413 over cap.
- **Integration (gated on `ml` extra)** — one test runs the real engine
  against bundled `yolo26n.pt` (detect) + `yolo26n-cls.pt` (classify):
  asserts a non-degraded `layer_used` and a sane heatmap. Skipped when
  ultralytics absent, matching the registry's graceful-degrade pattern.

Target: keep the suite green (**117 → ~127 backend tests**), `tsc`
clean, static export still builds.

---

## 9. F6b outline (next phase — not for sign-off here)

- **`/settings` Explanations section** — default opacity, "include in
  reports by default."
- **PDF/XLSX reports** — opt-in "Include explanations"; PDF gets a
  side-by-side source/overlay per prediction page (the trickiest UI per
  §6 — re-flows two-up layouts; reuse `clinical-reports` skill
  patterns); XLSX gets an overlay-thumbnail column.
- **`/models` "Test explanation" CTA** — run Eigen-CAM on a bundled or
  user-picked sample so a freshly-trained model can be sanity-checked
  ("is it looking at the right features?") before clinical use.
- **Folder-batch explanations** — `?explain=true` on the batch path,
  default OFF, with the "+~Ns to the batch — proceed?" estimate (§6
  open-q 3).

---

## 10. Open decisions — please sign off before implementation

- **D1 — Confirm Eigen-CAM's class-agnostic consequence (§1).**
  Classify shows a single image-level heatmap; **no per-class Top-1…5
  switcher.** Recommend: **accept** for v1.1; revisit Grad-CAM as a
  second method only if pilot users ask "why *this* class."
- **D2 — Detection default view: per-box renormalized (recommended) vs
  whole-image.** Recommend **per-box default**, with a "whole-image"
  toggle in the modal.
- **D3 — Opacity slider: client-side alpha-composite (smoother live
  drag) vs server re-request.** Recommend **client-side composite** —
  return overlay + let the browser blend; avoids round-trips. (Server
  still bakes a default-opacity overlay for reports later.)
- **D4 — Endpoint is stateless (re-uploads the image), matching
  `/inference/single`.** Recommend **yes** (no "last result" server
  coupling).
- **D5 — User-import fallback behavior:** when no head module is found,
  use last `nn.Conv2d` + surface a `degraded` "auto-detected layer,
  interpret with care" note. Recommend **yes**.
- **D6 — Version/tag + ordering.** F6a lands as **`v0.15-f6a-explain`**,
  pushing P7 Polish to `v0.16`. Confirm F6 goes *before* P7 (you already
  asked for XAI next, so this is a heads-up, not a question).

---

## 11. Complexity estimate

**Small–medium (~2–4 days for F6a).** The engine is ~80 lines of
Eigen-CAM + ~60 of target-layer picking/preprocessing; the router +
schema are boilerplate; the modal is the bulk of the frontend. The real
time sink is R1 (preprocessing fidelity) and the manual visual
verification that the overlay actually lines up — not raw LOC.
