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

[0.5.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.5-p3b-predict-reports
[0.4.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.4-p3a-predict-batch
[0.3.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.3-p2-predict-classify
[0.2.1]: https://github.com/atultiwari/VRL-YOLO-GUI/commit/427093d
[0.2.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.2-p1-predict-detect
[0.1.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.1-p0-scaffolding
