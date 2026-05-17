# Changelog

All notable changes to **VRL YOLO GUI** are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the same data
drives the in-app `/changelog` view (source at
[`apps/web/lib/changelog.ts`](apps/web/lib/changelog.ts)).

The project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Per-phase tags (e.g. `v0.3-p2-predict-classify`) annotate each phase
boundary in [`PLAN.md`](PLAN.md); see [`docs/PHASE-STATUS.md`](docs/PHASE-STATUS.md)
for the running tracker.

---

## [0.6.1] — 2026-05-17 · P4a.fix-1: Train — Dataset upload fix + split helper

No tag — between-phase patch.

### Fixed
- **Roboflow YOLO datasets ship `data.yaml` + `train/images/` + `train/labels/`** and were being detected as "Unknown layout" in v0.6.0. The `FolderDropzone` we'd built for Predict was MIME-filtered to images, so `data.yaml` and all the `.txt` label files were dropped at the browser level before they ever reached the backend. `FolderDropzone` now takes a `mode: "images" | "any"` prop; the Train wizard passes `mode="any"` so the full dataset (yaml + labels + images) makes it through.

### Added
- **Prepare splits** tool — for plain-YOLO datasets (`images/` + `labels/` at root) and Roboflow exports that only ship a `train/` split, click "Prepare splits…" to reshuffle into a clean train / valid / test layout with sliders for the ratios + a random seed.
- Backend `POST /api/datasets/{id}/split`: collects every image+label pair across the existing layout (any of plain YOLO, train-only Roboflow, or fully-split Roboflow), shuffles by seed, redistributes, wipes the old tree, and rewrites `data.yaml`. Preserves the dataset's UUID so the wizard store doesn't lose track.
- Class names are preserved from existing `data.yaml` when present; for plain YOLO without a yaml, the splitter walks label files to find the max class id and emits `class_0..N` placeholders (rename them later in P4b).
- Yellow callout on `/train/dataset` when no validation split is detected — clicking **Prepare splits…** opens the modal. After a successful split, a smaller **Re-split** button stays available for tweaking ratios.
- Backend tolerates ratios summing to `1.0 ± 0.001` (frontend rounds via integer percentages → divide by 100, so the sum sometimes drifts by a hair).

---

## [0.6.0] — 2026-05-17 · P4a: Train — Detection wizard

**Tag:** `v0.6-p4a-train-detect-wizard`

### Added
- **Three-step training wizard**: `/train` (task picker) → `/train/dataset` (upload + inspect) → `/train/configure` (model + hyperparams). `/train/run` is a P4b preview placeholder.
- **Task picker** with Detection / Classification cards; Classification gated behind a "P5" badge.
- **Dataset upload + auto-inspect**: drop a folder, backend writes it to `<storage_root>/datasets/<uuid>/` and returns format / splits / classes / warnings. Supported formats: Roboflow YOLO (`data.yaml` + `train/images/+labels/`), plain YOLO (`images/`+`labels/`), COCO (`annotations.json`), Pascal VOC (`.xml`), ImageFolder (classify-only summary).
- **Real upload progress bar** via XHR with an in-flight Cancel button backed by `AbortController` — fetch still doesn't expose upload-progress events.
- **Path-traversal-safe upload writer** in `engine/dataset.py`: 4 GB total cap, hostile-path rejection, Windows-reserved character sanitisation per segment.
- **Hardware probe** at `GET /api/hardware?task=&imgsz=`: returns kind / name / vram_gb / suggested_batch_size, with a heuristic that scales by accelerator + VRAM + task (classify doubles the suggestion).
- **Configure page**: model picker (detect models), preset radio (Quick/Standard/Best/Custom), image-size chip selector, batch-size slider with a live hardware hint, summary card with steps/epoch + total steps.
- **Train state persisted to localStorage** (Zustand `vrl-yolo-gui.train.v1`) so a reload mid-wizard doesn't blow up the 200-image upload.
- **Dataset rehydrate** endpoint `GET /api/datasets/{id}` — the configure page re-fetches on mount; if the dataset is gone (e.g. storage was wiped), the user is bounced back to `/train/dataset`.

### Known limitations (deferred)
- Training itself doesn't run yet — `/train/run` is a preview. P4b ships the subprocess + live metric WebSocket + results page.
- Classification training is detected (ImageFolder summary) but the configure page is detection-only. P5 adds the classify branch.
- Plain YOLO datasets (no `data.yaml`) require you to fill in class names — currently a warning, no editor yet (P4b).
- Multipart upload is fast on a Pyloid window but awkward over slow networks. Native folder-picker bridge lands in P7.

---

## [0.5.1] — 2026-05-17 · P3b.fix-1: Predict — Downloads fix

No tag — between-phase patch.

### Fixed
- **Export buttons in `/predict` folder mode now actually deliver a file.** The v0.5.0 build had CSV / XLSX / PDF buttons silently dropping the download because QtWebEngine blocks downloads until something connects to the profile's `downloadRequested` signal. Pyloid's window doesn't ship a download manager, so the export request reached the backend, returned 200 with the right `Content-Disposition`, then the blob URL click went nowhere.
- Added `_install_download_handler()` in `src-pyloid/main.py`: auto-accepts every download, drops it in `~/Downloads/` with a unique-name suffix (e.g. `vrl-yolo-detect-...csv` → `vrl-yolo-detect-... (1).csv` if a file with the same name already exists), and logs the destination via the `step:` prefix so the user can see where the file went in `launch.log`.

---

## [0.5.0] — 2026-05-17 · P3b: Predict — Reports, Import & Settings

**Tag:** `v0.5-p3b-predict-reports`

### Added
- **Settings page** (new `/settings` route, sidebar entry under "Preferences") with localStorage-backed preferences via the `useSettings()` hook. First toggle: show / hide clinical workflow presets in `/predict`.
- **Workflow presets hidden by default** — the bundled COCO/ImageNet weights don't have clinical class names yet, so the presets prefilled sensible thresholds but produced misleading detections. Tracked to re-open in P10 once we ship fine-tuned demo weights (memory: `project_presets_revisit`).
- **Folder-batch image preview** — click any row in the per-image table to see that file's image with detection boxes or the classify top-5 chart in a preview pane above the aggregate. Auto-selects the first successful result so the preview is never empty after a run.
- **Report generators** (`server/vrl_yolo/engine/reports.py`): task-aware CSV (per-image table), XLSX (per-image + aggregate sheets), and PDF (cover + summary + thumbnail grid + per-image table). ReportLab + OpenPyXL — no new dependencies.
- **`/api/reports/{csv,xlsx,pdf}`** endpoints accept the batch results as JSON and stream the rendered file with the right `Content-Disposition` so the browser downloads directly.
- **Export toolbar** (CSV / XLSX / PDF buttons) in the batch table card. The PDF button resizes up to 12 representative images to 480 px JPEG client-side and base64-embeds them so the report has a thumbnail grid.
- **User model import** — `POST /api/models/import` accepts a `.pt` checkpoint, reads `model.task` + class names via Ultralytics, places it in `<storage_root>/models/<task>/`, refreshes the registry. Frontend Import button on `/models` triggers the upload and invalidates the `['models']` query so the new card appears.
- **Topbar pill** now reads `v0.5.0 · predict — reports, import & settings` via the shared `useLiveVersion()` hook.

### Known limitations (deferred)
- Sliders still re-run on click only — live update deferred to a future polish pass.
- PDF thumbnail grid caps at 12 samples per report. Curated selection arrives with per-image flag annotations.
- No streaming batch WS endpoint yet — client-side iteration continues. Will land when Train (P4) needs WS plumbing.

---

## [0.4.0] — 2026-05-17 · P3a: Predict — Batch & Workflow Presets

**Tag:** `v0.4-p3a-predict-batch`

### Added
- **Folder mode** in `/predict` — drop a folder of slide patches; the UI runs inference image-by-image with a live progress bar.
- **Per-image results table** — filename, top class / box count, conf or count, inference time. Task-aware: detection rows show boxes + top class, classification rows show top-1 + a "review" pill when below threshold.
- **Aggregate panel** — detection rolls up per-class totals + max conf across the batch; classification rolls up the class distribution + flagged-count (top-1 below the review threshold).
- **Recursive** checkbox controls whether the dropzone walks subfolders or sticks to the top level.
- **Cancel** button (`StopCircle`) aborts the in-flight batch — backed by `AbortController` plumbed through `runBatch()` in `apps/web/lib/batch.ts`.
- **Workflow presets** sidebar in `/predict`: 9 clinical workflows (histopathology mitosis / nuclei / tumour-subtype / Gleason; hematology WBC-diff / bone-marrow / malaria / smear-pathology / marrow-pattern). Picking one prefills model + conf + iou.
- `/api/presets` endpoint exposes the catalog from `server/vrl_yolo/engine/presets.py` (typed `Preset` dataclasses).

### Fixed
- Topbar version pill was stuck at "v0.1.0 · scaffolding" since P0; now reflects the running build via a shared `useLiveVersion()` hook (TanStack Query, deduped with the changelog page).

### Known limitations (deferred)
- Sliders still re-run on click only — live updates land in P3b polish.
- User `.pt` import via the UI still returns 501 (lands in P3b).
- CSV / XLSX / PDF reports not yet implemented — P3b ships the task-aware report templates.
- Batch runs are sequential (concurrency = 1) on purpose; multi-GPU parallelism is a P10 problem.

---

## [0.3.0] — 2026-05-17 · P2: Predict — Classification

**Tag:** `v0.3-p2-predict-classify`

### Added
- Single-image classification via Ultralytics' classify head — top-1 + top-5 returned for the full softmax distribution.
- `/predict` view task-switches based on the selected model: no SVG overlay, top-1 banner, top-5 bar chart (Recharts).
- Confidence slider repurposes as a **review threshold** — top-1 predictions below the threshold render a "needs review" badge.
- Four bundled classification weights: `yolo26n-cls.pt`, `yolo26s-cls.pt`, `yolov8n-cls.pt`, `yolov8s-cls.pt` (~37 MB).
- `/api/inference/single` now returns a discriminated union (`detect | classify`); FastAPI documents both shapes in OpenAPI.
- In-app `/changelog` page lists per-build features, fixes, and known limitations. Sidebar link with current-version badge.
- `pyproject.toml` is the single source of truth for version; `vrl_yolo.__version__` reads it via `importlib.metadata`.

### Known limitations (deferred)
- Sliders still re-run on click — live updates planned for P3.
- User `.pt` import via the UI still returns 501 (lands in P3).
- Folder batch + CSV / XLSX / PDF reports not yet implemented (P3).

---

## [0.2.1] — 2026-05-17 · P1.fix-1: Cold-start race fix

**Commit:** `427093d` (no tag — between-phase fix)

### Fixed
- Pyloid window no longer races uvicorn's lifespan startup — `window.load_url` waits for `uvicorn.Server.started`; backend ready in ~55 ms instead of ~12 s.
- Registry scan + torch import deferred out of FastAPI lifespan; first `/api/models` call does a lazy scan (~1.7 s) and caches.

---

## [0.2.0] — 2026-05-17 · P1: Predict — Detection

**Tag:** `v0.2-p1-predict-detect`

### Added
- Single-image detection via Ultralytics YOLO — boxes (xyxy + xywhn), per-class counts, accelerator + inference timing in the response.
- Apple Silicon MPS auto-detected; first inference cold-loads ~3.6 s, subsequent calls ~50–100 ms.
- `/predict` view: drop zone, model picker, confidence + IoU sliders, SVG box overlay with stable per-class colours, counts table.
- `/models` page lists bundled + user models grouped by task with a "Set as default" mutation that persists to disk.
- Four bundled detection weights: `yolo26n.pt`, `yolo26s.pt`, `yolov8n.pt`, `yolov8s.pt` (~53 MB).
- Model registry persists per-task defaults to `<storage_root>/models/defaults.json`.
- Python pinned to 3.11 via `.python-version`; dev + CI converge.

---

## [0.1.0] — 2026-05-17 · P0: Scaffolding

**Tag:** `v0.1-p0-scaffolding`

### Added
- Pyloid desktop window opens, embedded uvicorn serves `/api/health` (200).
- Repo layout finalised: `server/vrl_yolo/` (flat module), `apps/web/` (Next.js 15 + Tailwind v4), `src-pyloid/`, `scripts/`, `packaging/`, `models/`.
- Six router stubs return `501` with the phase they land in — discoverable from `/openapi.json`.
- AGPL-3.0 `LICENSE` + `COMMERCIAL-LICENSE.md` template + `NOTICE` for upstream component licenses.
- GitHub Actions release workflow: `macos-14` (arm64) + `windows-latest` (x64) matrix.
- macOS-specific packaging recipe in `scripts/build-release.py`: devtool-bundle strip, Team-ID inside-out resign, `Info.plist` version stamp, `.dmg` wrap, `aboutToQuit → os._exit` shutdown workaround.

---

[0.6.1]: https://github.com/atultiwari/VRL-YOLO-GUI/commits/main
[0.6.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.6-p4a-train-detect-wizard
[0.5.1]: https://github.com/atultiwari/VRL-YOLO-GUI/commits/main
[0.5.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.5-p3b-predict-reports
[0.4.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.4-p3a-predict-batch
[0.3.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.3-p2-predict-classify
[0.2.1]: https://github.com/atultiwari/VRL-YOLO-GUI/commit/427093d
[0.2.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.2-p1-predict-detect
[0.1.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.1-p0-scaffolding
