# VRL-YOLO-GUI — Project Plan

> **Status:** Draft v0.5 — 2026-05-17 (YOLO26 set as the default model family for both tasks; YOLOv8 retained as fallback)
> **Owner:** Atul Tiwari (`atultiwari.in@gmail.com`)
> **Repo:** `/Users/atultiwari/Downloads/Projects/YOLO-GUI/VRL-YOLO-GUI`

---

## 1. Vision

A clinician-friendly toolkit demonstrating two YOLO tasks in
**histopathology** and **hematology**:

- **Image classification** — whole-patch prediction. E.g. "this
  histopathology patch shows IDC / DCIS / Normal." Top-1 class +
  confidence + top-K alternatives.
- **Object detection** — per-object localisation. E.g. "count and
  classify WBCs in this peripheral blood smear" — bounding boxes per cell.

Both tasks are first-class. The same desktop app handles both, the same
notebooks train both, and the same model library stores both — each model
declares its `task` in its filename (`-cls` for classification, plain for
detection) and the UI adapts.

Ships as:

1. **One desktop app** with two modes — **Train** (fine-tune a YOLO
   classification *or* detection model on the doctor's own dataset) and
   **Predict** (run a fine-tuned or bundled model on single patches or
   whole folders).
2. **Google Colab notebooks** — pure-Python, **standalone**, train-on-free-GPU
   reproductions of the same training task. Notebooks use Ultralytics
   directly; they do NOT depend on our backend.

**Primary user:** practising pathologists / hematologists with no terminal
or ML background. Success means a doctor installs one binary, drops a folder
of slide patches, and receives — for classification, a per-image
prediction table + PDF; for detection, annotated images + Excel.

**Out of scope for v1:** whole-slide image (WSI) ingestion (`.svs`, `.ndpi`,
`.mrxs`), instance segmentation / pose / OBB tasks, in-app annotation
editing, multi-user team workspaces, cloud-hosted inference, bundled demo
dataset (deferred to v1.1).

---

## 2. Reference projects — what we borrow

| Source | Why it matters |
|---|---|
| **VRL-ML-Studio-Lite** (your own existing project) | **Primary template.** Same Pyloid + FastAPI + Next.js architecture, working `scripts/build-release.py`, `src-pyloid/main.py`, GitHub Actions multi-arch CI. Copy + adapt instead of writing from scratch. |
| **`python-pyloid-desktop-packaging` skill** (~/.claude) | Captures every macOS PyInstaller gotcha already solved for VRL-ML-Studio-Lite — TCC paths, Team-ID resign, devtool-bundle strip, `aboutToQuit os._exit` shutdown fix. |
| **yolo-gui** | Best training UX of the four surveyed: dataset wizard, Colab + Cloudflare tunnel, training presets. FastAPI backend pattern aligns with Pyloid stack. |
| **MediScreen-Brain** | PDF / Excel clinical report templates, structured medical-style output, batch detection patterns. |
| **YOLOSHOW** | Drag-drop UX, real-time model switching, parameter sync patterns — translate from Qt signals to React state. |
| **YOLOv8-PySide6-GUI** | (Skip — discontinued, monolithic, GPL.) |

**Anti-patterns to avoid** (carry over from previous draft):
- Monolithic single-file UI.
- Mutating server-rendered DOM via inline `<script>` (breaks React hydration —
  see splash-screen section in skill).
- Unanchored `.gitignore` rules — silently strip source dirs from CI builds.
- `~/Documents` for app data on macOS — TCC blocks unsigned apps.

---

## 3. Repository layout (single binary, no separate core package)

```text
VRL-YOLO-GUI/
├── apps/
│   └── web/                              # Next.js frontend (single app, two modes)
│       ├── app/
│       │   ├── page.tsx                  # landing / mode picker
│       │   ├── predict/                  # /predict/* routes  (inference mode)
│       │   ├── train/                    # /train/*   routes  (fine-tune mode)
│       │   ├── models/                   # /models    shared model library
│       │   ├── layout.tsx                # shared shell, sidebar, splash overlay
│       │   └── globals.css
│       ├── components/                   # shadcn/ui + custom
│       ├── lib/
│       └── package.json
├── server/
│   ├── vrl_yolo/                         # importable backend module
│   │   ├── api/
│   │   │   ├── app.py                    # create_app() — FastAPI factory
│   │   │   ├── routers/
│   │   │   │   ├── models.py             # bundled + user-imported registry
│   │   │   │   ├── inference.py
│   │   │   │   ├── training.py
│   │   │   │   ├── dataset.py
│   │   │   │   └── reports.py
│   │   │   └── lifespan.py
│   │   ├── engine/
│   │   │   ├── inference.py              # thin wrapper: ultralytics.YOLO + result mapping
│   │   │   ├── training.py               # subprocess wrapper, WS streaming, cancellation
│   │   │   ├── colab.py                  # Cloudflare-tunnel client, Drive sync
│   │   │   ├── dataset.py                # detect+convert Roboflow/YOLO/COCO/VOC/LabelMe
│   │   │   ├── reports.py                # PDF (ReportLab) + XLSX (OpenPyXL) + CSV
│   │   │   ├── presets.py                # histopathology + hematology dicts
│   │   │   └── hardware.py               # detect_accelerator (cuda/mps/cpu)
│   │   ├── config.py                     # pydantic Settings; mode='web'|'desktop'
│   │   └── paths.py                      # _resolve_storage_root() per skill
│   └── main.py                           # uvicorn entry for web mode
├── src-pyloid/
│   └── main.py                           # Desktop entry — embeds uvicorn + Pyloid window
├── notebooks/                            # standalone — use ultralytics directly
│   ├── 01_setup.ipynb
│   ├── 02a_dataset_prep_detect.ipynb
│   ├── 02b_dataset_prep_classify.ipynb
│   ├── 03a_train_yolov8_detect.ipynb
│   ├── 03b_train_yolov8_classify.ipynb
│   ├── 04a_train_yolo26_detect.ipynb
│   ├── 04b_train_yolo26_classify.ipynb
│   ├── 05a_evaluate_detect.ipynb
│   ├── 05b_evaluate_classify.ipynb
│   ├── 06_export.ipynb
│   ├── 07a_inference_demo_detect.ipynb
│   └── 07b_inference_demo_classify.ipynb
├── models/                               # bundled starter weights (see §7)
│   ├── detect/
│   │   ├── yolov8n.pt
│   │   ├── yolov8s.pt
│   │   ├── yolo26n.pt
│   │   └── yolo26s.pt
│   └── classify/
│       ├── yolov8n-cls.pt
│       ├── yolov8s-cls.pt
│       ├── yolo26n-cls.pt
│       └── yolo26s-cls.pt
├── scripts/
│   ├── build-release.py                  # ported from VRL-ML-Studio-Lite
│   ├── generate-splash.py
│   └── pre-flight.py                     # gitignore-untracked-source check
├── packaging/
│   ├── macos/
│   │   ├── app.spec                      # ONE PyInstaller spec
│   │   └── dmg_settings.py
│   └── windows/
│       └── app.iss                       # ONE Inno Setup script
├── .github/
│   └── workflows/
│       └── release.yml                   # multi-arch matrix (macos-14, windows-latest)
├── docs/
│   ├── user/
│   ├── dev/
│   └── architecture/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── pyproject.toml                        # uv project (not a workspace — single pkg)
├── pnpm-workspace.yaml                   # frontend-only workspace
├── LICENSE                               # AGPL-3.0
├── COMMERCIAL-LICENSE.md
└── README.md
```

**Single binary, single Next.js app, single backend.** The user gets one
icon, `VRL YOLO GUI.app` / `.exe`, with a sidebar that switches between
**Predict** and **Train**. Frontend route groups (`/predict/*`, `/train/*`)
keep the two modes cleanly separated in the code without splitting the
bundle.

**Why no `packages/vrl_yolo_core/`:** notebooks are standalone (Ultralytics
directly), so there's no second consumer for shared Python code. Backend
just lives in `server/vrl_yolo/` next to the FastAPI routes. If we ever
need to share code with notebooks, extracting a package is a 1-day
refactor — defer until we actually have the need.

---

## 4. Tech stack

| Layer | Choice | Note |
|---|---|---|
| Python | 3.11 (pinned in CI) | Skill-tested; broad wheel coverage. |
| Workspace | uv | Same as VRL-ML-Studio-Lite. |
| Backend | FastAPI + uvicorn | Hosted in-process by Pyloid in desktop mode. |
| ML | `ultralytics` (latest stable, pinned) | YOLOv8 + YOLO26 (released 2026-01-14); detection + classification only in v1. AGPL — see §5. |
| Torch | 2.4+ auto-pick CUDA / MPS / CPU | `vrl_yolo_core.engine.hardware`. |
| Frontend | **Next.js 15 + React 19 + TypeScript** | Static export → bundled into `.app`. |
| Package manager | pnpm | Same as VRL-ML-Studio-Lite. |
| UI kit | shadcn/ui + Tailwind v4 | Doctor-friendly, polished, fast iteration. |
| Charts | Recharts (training curves, confusion matrices) | Pure JS, no Qt-side charting needed. |
| Desktop wrapper | **Pyloid** | Embedded QtWebEngine + single-instance. |
| Packager | PyInstaller 6.x (folder bundle on macOS, onefile on Windows) | Skill-tested invocation. |
| macOS distribution | `create-dmg` + **ad-hoc signing only** | No Apple Developer enrolment needed. |
| Windows distribution | Inno Setup, **unsigned** | SmartScreen "More info → Run anyway" on first launch. |
| Reports | ReportLab (PDF), OpenPyXL (XLSX) | Borrowed from MediScreen-Brain. |
| Imaging | OpenCV, Pillow, tifffile, scikit-image | TIFF + PNG patches. |
| Testing | pytest, pytest-qt (light), Playwright (web) | 80% target per global rules. |
| Lint/type | ruff, mypy, eslint, prettier | Pre-commit + CI. |
| CI | GitHub Actions, multi-arch matrix | `macos-14`, `windows-latest`. |

**Why not PySide6 + qfluentwidgets (the YOLOSHOW route):**
- You already have a working Pyloid template (VRL-ML-Studio-Lite).
- React/Next.js gives more UI flexibility for doctors (charts, tables,
  drag-drop, animations) than Qt widgets.
- Same FastAPI backend can serve a web deployment later with zero work.
- `qfluentwidgets` is GPL-3.0; Pyloid + Next.js avoids that dependency.
- Same engine code runs in Colab notebooks via `pip install vrl_yolo_core`.

---

## 5. License model

- **Toolkit source:** AGPL-3.0 (matches Ultralytics — required when
  redistributing Ultralytics code in a network-served app, which Pyloid
  effectively is).
- **Commercial:** separate `COMMERCIAL-LICENSE.md` for organisations that
  don't want AGPL obligations. Buyer responsible for their own Ultralytics
  Enterprise license — we don't sublicense Ultralytics.
- AGPL-3.0 SPDX header on every source file.
- `NOTICE` lists upstream licenses: Ultralytics AGPL-3.0, PyTorch BSD,
  PySide6 LGPL-3.0, Pyloid LGPL/Apache check, Next.js MIT, shadcn/ui MIT,
  OpenCV Apache-2.0, ReportLab BSD.

---

## 6. Backend — `server/vrl_yolo/`

Plain Python module (not a separate package). Imported by both the
uvicorn web entry (`server/main.py`) and the Pyloid desktop entry
(`src-pyloid/main.py`). The notebooks do **not** import this code — they
use `ultralytics` directly.

### What's actually in it (and why)

Task-aware throughout — every entry point takes (or infers from filename)
`task: Literal["detect", "classify"]` and branches on it.

| Module | Why it exists (vs calling ultralytics directly) |
|---|---|
| `engine/inference.py` | Maps `model.predict(...)` results to a frontend-friendly dict. **For detect:** boxes + class names + counts + µm² (if calibrated). **For classify:** top-1, top-5, full probabilities. Branches on `model.task`. |
| `engine/training.py` | Runs `model.train(...)` in a subprocess so we can stream live loss/metric to a WebSocket and support cancel. Ultralytics' `train()` is sync — useless to a UI. Streams `mAP50-95` for detect, `top1` for classify. |
| `engine/dataset.py` | Detects dataset structure: `train/images/+labels/` + `data.yaml` → detect; `train/<classname>/*.jpg` → classify. Also Roboflow YOLO export (both task flavours), COCO, VOC, LabelMe. Converts where needed. |
| `engine/reports.py` | PDF (ReportLab) + Excel (OpenPyXL) + CSV. Two report templates: detection-style (boxes table + per-class counts) and classification-style (per-image prediction + top-K + class distribution). |
| `engine/presets.py` | Dicts of clinical workflows per (domain, task). E.g. `HISTOPATHOLOGY["classify"]["tumour_subtype"]`, `HEMATOLOGY["detect"]["wbc_differential"]`. |
| `engine/colab.py` | Cloudflare tunnel + Drive sync for the "Train on Colab" button. Outside Ultralytics' scope. |
| `engine/hardware.py` | Detects CUDA / MPS / CPU + VRAM so the UI can suggest sensible batch sizes. Classification can use larger batches than detection at the same VRAM. |
| `api/` | FastAPI routes — HTTP/WS surface for the frontend. |
| `paths.py` | `~/Library/Application Support/...` (macOS) vs `%APPDATA%\...` (Windows) for user-imported models. |

**Total estimated size:** ~2,000–3,000 lines of Python (+~500 for the
classification task path on top of detection). We do not re-implement YOLO
inference, training, NMS, augmentation, or model loading — `ultralytics`
does all of that and we call it directly.

### FastAPI routes

The route surface is unified across tasks — the model's `task` field tells
the backend which branch to use, the frontend reads `task` off each
response to pick the right view.

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Smoke test |
| `/api/models` | GET | List bundled + user models. Each model carries `{name, task, version, classes, source}`. |
| `/api/models/import` | POST (file) | Upload a `.pt` file. Backend reads its `task` attribute from the checkpoint. |
| `/api/datasets/inspect` | POST (folder path) | Validate + report. Detects classification vs detection from folder structure. |
| `/api/inference/single` | POST | Single image. Response shape depends on model task: `{task:"detect", boxes:[...]}` or `{task:"classify", top1:..., top5:[...], probs:[...]}`. |
| `/api/inference/batch` | POST | Folder → job ID + streamed progress. |
| `/api/training/start` | POST | Body includes `task`, `model`, `dataset`, `preset`. |
| `/api/training/{job_id}/stream` | WS | Live metrics. Detect: loss + mAP50/mAP50-95 + per-class AP. Classify: loss + top1 + top5. |
| `/api/reports/pdf` | POST | Body includes `task`; backend picks template. |
| `/api/reports/xlsx` | POST | Same. |

---

## 7. Bundled starter models + user model import

### Bundled models (ship inside the binary)

Eight models — four detection (COCO-pretrained), four classification
(ImageNet-pretrained). **YOLO26 is the default for both tasks**; YOLOv8
is retained as a stable fallback. These are **demo / starting-point**
weights, not clinical. README and in-app banners make that explicit.

| File | Task | Backbone | Approx size | Default |
|---|---|---|---|---|
| `yolo26n.pt` | detect | YOLO26 nano | ~5 MB (2.4M params) | ★ default detect |
| `yolo26s.pt` | detect | YOLO26 small | ~19 MB (9.5M params) | |
| `yolov8n.pt` | detect | YOLOv8 nano | ~6 MB | (fallback) |
| `yolov8s.pt` | detect | YOLOv8 small | ~22 MB | (fallback) |
| `yolo26n-cls.pt` | classify | YOLO26 nano | ~3 MB | ★ default classify |
| `yolo26s-cls.pt` | classify | YOLO26 small | ~12 MB | |
| `yolov8n-cls.pt` | classify | YOLOv8 nano | ~3 MB | (fallback) |
| `yolov8s-cls.pt` | classify | YOLOv8 small | ~12 MB | (fallback) |

Total starter-model footprint: **~80 MB**. On a fresh install, Predict
mode auto-selects `yolo26n.pt` for detection and `yolo26n-cls.pt` for
classification; Train mode pre-selects the same in the configure page.
Users can change the default per task via the Models page.

Medium / large / xlarge weights (`m`, `l`, `x` variants of both versions
and both tasks) are not bundled — downloaded from Ultralytics' CDN on
demand when picked in the Train configure page.

### User model import

The shared **Models** page (used by both Predict and Train):
- Card list grouped by task: **Detection models** and **Classification models**.
- "**Import model**" button → file picker → `.pt` file copied to
  `user_models_dir()`. Backend reads `model.task` from the checkpoint to
  classify it correctly. Rejects files where `task` is anything other than
  `detect` or `classify` in v1.
- Per-model card shows: name, task badge, source (bundled / imported /
  trained on…), classes, parameter count, last used.
- "**Set default**" per task — Predict mode remembers the last-used model
  for each task family separately.
- "**Delete**" only for imported / trained models (bundled ones are
  read-only).

Train mode writes its output `best.pt` into the same `user_models_dir/`
under `models/<task>/<run-name>/best.pt` so Predict mode picks it up
automatically.

---

## 8. Annotation workflow — Roboflow (external)

V1 ships **no in-app annotation tool**. Doctors prepare datasets in
**Roboflow** (free for small projects, easy UI, supports clinical
imagery). Roboflow exports both task formats; the Train dataset wizard
auto-detects which one was dropped.

### Detection export (Roboflow "YOLOv8 detect")

```
roboflow-detect-export/
├── data.yaml
├── train/images/*.jpg, train/labels/*.txt
├── valid/images/*.jpg, valid/labels/*.txt
└── test/images/*.jpg,  test/labels/*.txt
```

Backend `engine/dataset.py` returns `task="detect", format="roboflow_yolo"`
and feeds it straight to `model.train(data="data.yaml", ...)`.

### Classification export (Roboflow "Folder structure" / "Classification")

```
roboflow-classify-export/
├── train/IDC/*.jpg
├── train/DCIS/*.jpg
├── train/Normal/*.jpg
├── valid/IDC/*.jpg
├── ...
└── test/...
```

No `data.yaml`, no `labels.txt` — the folder name **is** the label.
Backend returns `task="classify", format="imagefolder"` and feeds the root
folder to `model.train(data="/path/to/root", ...)`.

### Other formats (auto-converted)

- Plain YOLO (`images/` + `labels/` flat) → detect.
- ImageNet-style flat ImageFolder → classify.
- COCO JSON, Pascal VOC XML, LabelMe JSON → detect (converted on the fly).

Docs include two 5-step walkthroughs — one for **"Annotate detection in
Roboflow → train"**, one for **"Label classification folders in Roboflow
→ train"** — with screenshots, so doctors know exactly what to click.

---

## 9. Train mode (`/train/*` routes)

### Pages

1. `/train` — short explainer + **task picker**: "Train an **object
   detection** model" or "Train an **image classification** model". This
   is the only place the user picks the task explicitly; the dataset
   structure later confirms it.
2. `/train/dataset` — drop folder. Auto-detects format and **derived
   task** from structure:
   - `train/<classname>/*.jpg` → classification
   - `train/images/+labels/` + `data.yaml` → detection
   - Roboflow export → either, format-detected
   If the derived task disagrees with the picker, the page asks the user
   to confirm. Shows totals, splits, class balance, sample thumbnails per
   class, warnings.
3. `/train/configure`
   - Domain preset: Histopathology / Hematology / Custom.
   - **Model picker is task-filtered, defaults to YOLO26 nano:**
     - Detection: **`yolo26{n,s,m,l,x}.pt`** (default `yolo26n.pt`),
       plus `yolov8{n,s,m,l,x}.pt` as fallback options.
     - Classification: **`yolo26{n,s,m,l,x}-cls.pt`** (default
       `yolo26n-cls.pt`), plus `yolov8{n,s,m,l,x}-cls.pt` as fallback.
     n/s pre-bundled; m/l/x downloaded on demand from Ultralytics' CDN.
   - Training preset: `Quick (5 epochs)`, `Standard (50)`, `Best (200)`.
     Augmentation + LR + warmup hidden behind "Advanced".
   - **Image size default differs by task:** 640 px for detection, 224 px
     for classification. Editable in "Advanced".
   - Batch size auto-suggested from accelerator + dataset size +
     task (classification fits ~2-3× the batch of detection at same VRAM).
4. `/train/run`
   - **This computer** — enabled when `detect_accelerator()` is CUDA or MPS,
     or user opts in to CPU.
   - **Google Colab** — opens the matching notebook with config pre-filled,
     watches a Drive folder for results.
   - Live charts (Recharts): for detection — loss + mAP50 + mAP50-95;
     for classification — loss + top1 + top5. ETA, log pane, cancel button.
5. `/train/results` —
   - **Detection:** best epoch, **confusion matrix**, per-class AP, sample
     val predictions with boxes.
   - **Classification:** best epoch, confusion matrix (computed via
     `model.val()` + a small sklearn helper since Ultralytics' built-in
     classify metrics don't include it), per-class precision/recall,
     sample val predictions with top-1 label.
   - "**Save to model library**" copies `best.pt` into
     `user_models_dir/models/<task>/<run-name>/best.pt`. Predict mode
     picks it up immediately.
   - "**Export ONNX / CoreML**" optional (both tasks supported).

### Backend internals

- `engine/training.py` runs YOLO in a subprocess; streams stdout to the
  WS. Parses metric lines per task — `metrics/mAP50` etc. for detect,
  `metrics/accuracy_top1` etc. for classify.
- `engine/colab.py` uses the yolo-gui Cloudflare-tunnel pattern + Drive.
  Picks the right notebook (`03_train_yolov8_detect.ipynb` vs
  `03_train_yolov8_classify.ipynb`) based on task.
- All training state lives in a YAML `ProjectFile` so a crash mid-run
  reloads cleanly.

---

## 10. Predict mode (`/predict/*` + `/models` routes)

### Pages

1. `/models` (shared with Train mode) — model library grouped by task
   (Detection / Classification), import button, default-per-task selector.
   Defaults out of the box: **`yolo26n.pt`** (detect) and
   **`yolo26n-cls.pt`** (classify).
2. `/predict` — single page that **reads `model.task` and switches view
   accordingly**:

   **For a detection model:**
   - Drop single image or folder. Recursive option.
   - Thumbnail strip + main canvas with overlay toggle (boxes / labels /
     confidence).
   - Confidence + IOU sliders with instant overlay update.
   - **Domain workflows** (one click):
     - *Histopathology — Mitosis detect* (flag positive patches).
     - *Histopathology — Nuclei count* (density per mm² with calibration).
     - *Hematology — WBC differential* (per-class % across image).
     - *Hematology — Bone marrow cell count* (per-class counts + ratios).
     - *Hematology — Malaria screen* (positive-patch flag).

   **For a classification model:**
   - Drop single image or folder. Recursive option.
   - Thumbnail strip + main canvas — **no overlays**; the image is shown
     as-is with the predicted class + confidence overlaid below.
   - **Top-5 bar chart** (Recharts) shows alternative classes.
   - Confidence slider acts as a "review threshold" — predictions below
     it get flagged for manual review in the results table.
   - **Domain workflows** (one click):
     - *Histopathology — Tumour subtype* (e.g. IDC / DCIS / Normal).
     - *Histopathology — Gleason grade* (when model supports it).
     - *Hematology — Blood smear pathology* (Normal / Anaemia / Leukemia /…).
     - *Hematology — Bone marrow pattern* (Normocellular / Hypercellular /…).

3. `/predict/results`

   **For detection:**
   - Per-image table: filename, total detections, per-class counts, max conf.
   - Aggregate panel: totals, mean conf, class balance.
   - Exports:
     - Annotated images → folder.
     - Detections CSV (one row per detection).
     - Aggregate XLSX.
     - **Detection PDF report** (cover, sample annotated images, per-class
       breakdown, footer).

   **For classification:**
   - Per-image table: filename, predicted class, confidence, **top-3
     alternatives**, "needs review" flag (below threshold).
   - Aggregate panel: class distribution, mean confidence per class, count
     of flagged items.
   - Exports:
     - **Classification CSV** (one row per image, columns: file, top1,
       top1_conf, top2, top2_conf, top3, top3_conf).
     - Aggregate XLSX (class distribution sheet + flagged-items sheet).
     - **Classification PDF report** (cover, class distribution chart,
       table of confident predictions, table of flagged predictions,
       sample image grid per class, footer).

### Optional micron calibration (detection only)

User supplies `pixel_size_um` per project (e.g. 0.25 µm/px at 40× Aperio).
Detection reports include µm and µm² alongside pixel values. Classification
reports do not use calibration.

---

## 11. Notebooks (`notebooks/`)

Pure Python, **standalone** — each notebook does `pip install ultralytics`
directly, not our backend. One "edit this cell" block at the top (Drive
path, dataset name, model, epochs).

Two task families, two parallel sets:

| Notebook | Task | Purpose |
|---|---|---|
| `01_setup.ipynb` | both | Mount Drive, set workspace, install deps. |
| `02a_dataset_prep_detect.ipynb` | detect | Validate / convert Roboflow / YOLO / COCO / VOC; emit `data.yaml`. |
| `02b_dataset_prep_classify.ipynb` | classify | Validate ImageFolder; create splits if absent; report class balance. |
| `03a_train_yolov8_detect.ipynb` | detect | YOLOv8 detection, n/s/m/l/x parameterised. |
| `03b_train_yolov8_classify.ipynb` | classify | YOLOv8 `-cls` classification. |
| `04a_train_yolo26_detect.ipynb` | detect | YOLO26 detection. |
| `04b_train_yolo26_classify.ipynb` | classify | YOLO26 `-cls` classification. |
| `05a_evaluate_detect.ipynb` | detect | mAP50, mAP50-95, per-class AP, confusion matrix, sample predictions. |
| `05b_evaluate_classify.ipynb` | classify | Top-1, top-5, confusion matrix (sklearn helper), per-class precision/recall. |
| `06_export.ipynb` | both | Export to ONNX + CoreML; sanity-check. |
| `07a_inference_demo_detect.ipynb` | detect | Inference on sample patch folder; inline annotated previews. |
| `07b_inference_demo_classify.ipynb` | classify | Inference; inline top-1 + top-5 previews. |

---

## 12. Packaging — ad-hoc only (no Apple Dev, no Windows EV)

### 12.1 macOS

- PyInstaller **folder bundle** (`onedir`), wrapped in `.app`. Skill warns
  `onefile` on macOS = silent bounce-and-die.
- `--codesign-identity -` (ad-hoc) explicitly.
- Post-build steps from the skill (all already implemented in
  `VRL-ML-Studio-Lite/scripts/build-release.py`):
  1. `strip_devtool_bundles()` — removes Qt Assistant / Designer / Linguist
     (preserves `*.framework/Helpers/`).
  2. `resign_macos_bundle()` — inside-out re-sign every Mach-O (fixes
     Team-ID mismatch on uv-managed `libpython3.X.dylib`).
  3. `_install_macos_shutdown_workaround()` — `aboutToQuit` → `os._exit(0)`
     to skip the Qt6 + WebEngine static-destructor crash on Cmd+Q.
- `create-dmg` wraps the `.app` in a `.dmg` for distribution.

**Doctor's first-launch step (documented in README and on the download page):**

```bash
xattr -dr com.apple.quarantine "/Applications/VRL Inference.app"
xattr -dr com.apple.quarantine "/Applications/VRL Finetune.app"
```

OR — right-click → Open the first time → "Open anyway" in the dialog.
After that, Gatekeeper remembers the choice. One-time friction; no
recurring cost; no $99/yr Apple Developer fee.

App data path: `~/Library/Application Support/VRL-YOLO-GUI/{inference,finetune}/`.

### 12.2 Windows

- PyInstaller `--onefile` (extraction is fast on Windows).
- Inno Setup wraps the `.exe` into an installer that creates a Start menu
  entry, an uninstaller, and a desktop shortcut.
- **Unsigned.** First launch shows SmartScreen "Windows protected your PC"
  → user clicks **More info** → **Run anyway**. Documented in the readme.
  Standard-paid cert no longer suppresses this warning (changed 2023); only
  an EV cert (~$300/yr) does — not worth it for v1.
- Windows-on-ARM: explicitly skip until `pyarrow` ships Windows ARM64
  wheels (skill flag). x64 binary runs under Windows-on-ARM emulation as a
  fallback.

App data path: `%APPDATA%\VRL-YOLO-GUI\{inference,finetune}\`.

### 12.3 Expected bundle sizes

| Component | Size |
|---|---|
| QtWebEngineCore (Chromium) | ~270 MB |
| Other Qt frameworks | ~150 MB |
| Python + numpy + torch + ultralytics + opencv | ~280 MB |
| Next.js static export | ~10 MB |
| Bundled starter models (4 × .pt) | ~56 MB |
| **One app, total** | **~770 MB** |
| Two apps installed side by side | ~1.5 GB |

This is normal for any Chromium-embedding desktop app (Electron sits in
the same range). See §13.2 for the "merge to one app" tradeoff.

---

## 13. Open architectural decisions

### 13.1 What runs on Colab vs locally

Already decided: **local + Colab from day one** (user choice). Local
training enabled only when accelerator is CUDA or MPS (or user opts in to
CPU). Colab is one-click for users without a GPU.

### 13.2 One binary (locked in)

**Decided: one binary, two modes** (Predict + Train) in a single sidebar.
Halves disk footprint, halves CI matrix cells, and gives doctors one icon
to launch. The Predict mode is the daily-use surface; Train mode is the
occasional surface accessed from the same sidebar.

### 13.3 Bundled vs downloaded weights

Decided: ship **8 starter weights** inside the binary (4 detection + 4
classification, ~80 MB total — see §7), plus an in-app **"Import model"**
flow for custom `.pt` files. Medium / large / xlarge variants of both
versions and both tasks are downloaded on demand from Ultralytics' CDN
when the user picks them in the Train configure page.

### 13.4 Annotation

Decided: **Roboflow (external)**. No in-app annotation editor in v1.
Dataset wizard treats Roboflow YOLOv8 export as first-class input. Docs
ship a step-by-step "Annotate in Roboflow → import here" walkthrough.

### 13.5 Deferred to v1.1

- **Bundled demo dataset** — ship anonymised sample patches per domain so
  a doctor can try Predict before training their own model.
- **Auto-update** (Sparkle / WinSparkle).
- **Patient identifiers in reports** — read from filename convention or
  sidecar JSON.

### 13.6 Open questions for v1

1. **VRL branding** — logo, palette, splash image. Need an asset pass
   before P5. Currently using "VRL" plain text + a placeholder colour.
2. **Patient privacy in PDF / Excel reports** — should reports include a
   "anonymised" / "for research only" footer by default? Recommended.

---

## 14. Phases & milestones

Single binary, no separate package — compressed further. Estimates assume
one full-time engineer; halve productivity if part-time.

| Phase | Scope | Duration |
|---|---|---|
| **P0 — Scaffolding** | Fork VRL-ML-Studio-Lite layout; rip out Studio-Lite logic; standup empty `server/vrl_yolo/`, empty Next.js shell at `/predict` + `/train` + `/models`. **Working `.app` window opens** on macOS by end of P0 (skill rule: phase-zero deliverable). | 3 days |
| **P1 — Predict (detection)** | `/api/models`, `/api/inference/single` for detect, `/models` page, `/predict` detection view, single-image flow. Bundled detect models load. | 1 week |
| **P2 — Predict (classification)** | Add classification branch to `/api/inference/single`, task-switched `/predict` view (top-1 / top-5 / no boxes), bundled classify models load. | 4 days |
| **P3 — Predict v1** | Folder batch (both tasks), histopathology + hematology workflow presets (both tasks), CSV / XLSX / **PDF reports** with task-specific templates, model import (auto-detect task from checkpoint). | 2 weeks |
| **P4 — Train (detection) local** | Dataset wizard with detect format detection (Roboflow YOLO / COCO / VOC), configure page, local detection training (CUDA / MPS / CPU), results page. | 2 weeks |
| **P5 — Train (classification) local** | Add classification branch to wizard (ImageFolder detection), classify training in same flow, classify results (top1/top5/confusion). | 1 week |
| **P6 — Train on Colab** | Notebooks (both task families) + Colab engine + Drive sync + monitor page. | 1.5 weeks |
| **P7 — Polish** | UX pass, error states, in-app help, docs site (incl. two Roboflow walkthroughs). | 1 week |
| **P8 — Packaging mac** | Adapt VRL-ML-Studio-Lite's `build-release.py`, run on macos-14 runner, `.dmg` artifact, document `xattr` workaround. | 3 days |
| **P9 — Packaging win** | `.spec`, Inno Setup, document SmartScreen workaround, run on windows-latest runner. | 3 days |
| **P10 — Pilot** | Hand to 2–3 doctors, gather feedback, fix top issues. | 1 week |

**Total:** ~11 weeks for v1.0 (added ~2 weeks vs detection-only for the
classification branch — much of it is UI variation, not new ML code).

---

## 15. Cross-cutting concerns

### Telemetry

Off by default. Sentry self-hosted with explicit opt-in if we ever add
crash reports (clinical data sensitivity).

### Privacy

No images leave the doctor's machine unless they pick Colab training, in
which case the upload goes to **their own** Google Drive (not ours).
Document in README.

### Errors

Clinician-readable text ("This folder doesn't look like a YOLO dataset —
we expected `data.yaml` plus `train/`, `valid/` subfolders. [Open docs]").
Full traceback saved to `launch.log` for support.

### Logging

Per the skill: `_setup_frozen_logging()` redirects stdout/stderr to
`<app_data>/logs/launch.log` when `sys.frozen`. `step:` prints at every
phase boundary so a silent-exit diagnosis is two-line.

### i18n

English only in v1. Strings routed through React i18n primitive so we can
add languages later without a rewrite.

### Accessibility

Keyboard navigation end-to-end. Focus rings visible. Font scale slider in
Settings.

---

## 16. Risks (Pyloid-stack specific)

1. **Bundle size** ~770 MB per app — same as Electron, but worth flagging
   if you ever distribute over slow connections. Mitigate with §13.2 (one
   binary) or post-build framework stripping (saves 50–100 MB).
2. **macOS unsigned distribution** — needs the `xattr` step the first
   time. Some institutional Macs lock that command down. Workaround:
   right-click → Open → "Open anyway".
3. **Windows SmartScreen** — first-launch warning. Unavoidable without an
   EV cert. Document clearly so doctors don't think it's broken.
4. **Pyloid + WebEngine quit crash on macOS** — solved (skill's
   `aboutToQuit os._exit` hook).
5. **Multiprocessing duplicate-app spawn** — solved (skill's
   `freeze_support()` first line).
6. **`.gitignore` unanchored matches stripping source from CI** — solved
   (skill's pre-flight script).
7. **Ultralytics AGPL** — every contributor / fork inherits AGPL. Be clear
   in README.
8. **Pyloid macOS-26 / Qt 6.9** — still actively maintained, confirmed
   working in the skill as of May 2026, but the stack is younger than
   pure PySide6. Pin versions firmly; track upstream.

---

## 17. Success criteria for v1

- A pathologist with no terminal experience can: install one binary, drop
  a folder of slide patches, get annotated images (detection) **or** a
  per-image prediction table (classification) plus a clinical PDF. Both
  task flows reach **time-to-first-result under 10 minutes from download.**
- The same doctor can: drop a Roboflow export (detection **or**
  classification folder structure), click "Train", and produce a
  fine-tuned `.pt` — local if GPU/MPS, else Colab — for the matching task.
- Running the corresponding training notebook (`03a` / `03b` / `04a` /
  `04b`) on Colab with the same dataset produces the same `best.pt` and
  metrics within evaluation tolerance.
- 80% test coverage on `server/vrl_yolo/`. Playwright e2e covers four
  critical paths: detect single-image predict, classify single-image
  predict, detect train + save, classify train + save.
- App launches and quits cleanly on macOS 14+ and Windows 11; no crash
  reports in `~/Library/Logs/DiagnosticReports/` after a quit cycle.

---

## 18. Next concrete steps (after plan approval)

1. **Fork the template:** copy VRL-ML-Studio-Lite's `pyproject.toml`,
   `pnpm-workspace.yaml`, `src-pyloid/main.py`, `scripts/build-release.py`,
   `.github/workflows/release.yml` into VRL-YOLO-GUI; rip out Studio-Lite
   logic; rename identifiers.
2. **Verify P0 deliverable:** empty Next.js shell + Pyloid window opens
   on macOS via `python -m server` and via packaged `.app`.
3. **Brand pass** — logo, palette, splash image (`scripts/generate-splash.py`).
4. **AGPL headers** + `NOTICE` file + `COMMERCIAL-LICENSE.md` template.

No code will be written until you sign off on this revised plan.
