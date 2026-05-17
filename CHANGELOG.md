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

## [0.8.3] — 2026-05-18 · P5.fix-3: Flat ImageFolder support + Prepare splits for classify + layout examples

**Tag:** `v0.8.3`

### Added
- **Flat ImageFolder layout is now recognised.** v0.8.0–v0.8.2 only detected the Ultralytics-ready split layout (`<root>/train/<class>/*.jpg`). The human-friendly flat layout (`<root>/<class>/*.jpg` — what doctors actually drop in when one folder per class is the natural way to organise lab images) was tagged "Unknown layout" and Continue was gated off. The inspector now accepts both shapes. Flat layouts are flagged with a clear warning saying training needs the splitter to run first.
- **Prepare splits now works for classification.** The same `POST /api/datasets/{id}/split` endpoint dispatches on detected task: detect routes to the existing YOLO splitter (image+label pairs, rewrites `data.yaml`); classify routes to the new `split_imagefolder` which stratifies per class and stages into `train/<class>/`, `val/<class>/`, and optionally `test/<class>/` — the exact shape Ultralytics' classify mode expects. Per-class stratification means a 10-image class doesn't accidentally land 9 in val and 1 in train.
- **Layout examples card on the dataset upload page.** A collapsible "What does my dataset need to look like?" card sits below the dropzone, showing 4 concrete ASCII trees: Roboflow YOLO, plain YOLO, flat ImageFolder, split ImageFolder. Open by default the first time; the collapsed state persists across visits via `localStorage` so frequent users aren't yelled at.
- **Prepare splits modal is task-aware.** Title, copy, slider label (Valid vs Val), and the validation-set warning all switch based on `dataset.task`. Detect users see Roboflow-shaped paths; classify users see `train/<class>/` / `val/<class>/` and the warning that Ultralytics' classify mode refuses to start without a val split.

### Fixed
- `SplitModal`'s `totalPairs` used `Math.min(image_count, label_count)` everywhere — fine for detect, but collapsed classify totals to 0 because ImageFolder splits have `label_count: 0`. Classify branch now counts images directly.
- `needsSplitting()` now also surfaces the splitter for flat ImageFolder (single "all" pseudo-split) and for classify split-layouts missing val/. Previously classify always returned false, so the Prepare splits button never appeared even when training would fail without it.

### Known limitations (deferred)
- Same as v0.8.2: in-flight training subprocess is reparented to launchd rather than receiving a SIGTERM on Cmd+Q. Graceful job-group shutdown before the hard exit is still a follow-up.
- Layout examples card uses fixed ASCII trees; a future polish pass could swap them for SVG or render real previews of the user's dropped folder.
- Classify splitter merges images from all source locations (flat + any pre-existing train/val/test) and re-shuffles. If the user wanted to PRESERVE a hand-curated train/val/test split and just generate a missing test, they can't — Prepare splits is all-or-nothing. Acceptable for v1; might revisit if pilot feedback asks for it.

---

## [0.8.2] — 2026-05-17 · P5.fix-2: Window-scoped close filter (P5.fix-1 startup regression)

**Tag:** `v0.8.2`

### Fixed
- **Startup regression introduced by v0.8.1 is fixed.** v0.8.1 installed a `QApplication`-level `QEvent::Quit` event filter to bypass the macOS Cmd+Q crash. That filter ran for every event for every `QObject` in the app — including the events `QWebEngineView` / `QQuickWidget` exchange during construction. Some of those events arrive from internal C++ objects whose Python wrappers PySide6 6.9 can't resolve, so `PySide::typeName(QObject const*)` deref'd null inside `sendThroughApplicationEventFilters` (confirmed via a `python3.11-*.ips` crash report from the local repro) and the process exited silently between `pyloid.create_window` and `pyloid.run()`. Bisecting by disabling just the `installEventFilter` line restored startup, confirming the filter was the killer.
- Replaced the app-wide `QEvent::Quit` filter with a **window-scoped `QEvent::Close` filter** installed AFTER `pyloid.create_window` returns. The filter is attached to the real `QMainWindow` reached by walking `window._window._window` (with a defensive 4-deep walk so future Pyloid releases that shift the field name don't silently no-op us). Scoping to one specific `QObject` means the filter only sees events delivered to that `QObject` — the PySide6 wrapper-resolution crash never gets a chance to fire. Catching `QEvent::Close` instead of `QEvent::Quit` puts us at the same place in the close cascade: it arrives at the `QMainWindow` before Pyloid's `closeEvent` runs, so we still pre-empt the `QCoreApplication.quit()` → re-entrant `[NSApplication terminate:]` path that was the original v0.7.1 / v0.8.0 crash.
- Kept the `aboutToQuit` fallback (for non-Cmd+Q paths that DO unwind through `exec()`), plus added per-step launch.log breadcrumbs (`step: macOS shutdown workaround installed …` / `step: QEvent.Close intercepted …`) so the next failure mode is one log-tail away from a diagnosis.
- Added a new env-gated test helper `_maybe_install_auto_quit_for_test()`: setting `VRL_YOLO_GUI_TEST_AUTO_QUIT_S=N` schedules a `QApplication.quit()` N seconds after `pyloid.run()` starts, so the close path can be exercised on a headless dev machine without sending real Cmd+Q. No-op when the env var is unset; ships in the binary so a clinician filing a bug can be asked to run with it set.

### Known limitations (deferred)
- Same as v0.8.1: in-flight training subprocess is reparented to launchd rather than receiving a SIGTERM. Graceful job-group shutdown before the hard exit is still a follow-up.
- Window-scoped filter assumes Pyloid's `BrowserWindow` exposes its `QMainWindow` within four `_window` hops. If a future Pyloid release reshapes that, the launch.log will print `macOS shutdown workaround skipped — could not locate underlying QMainWindow on 'BrowserWindow'` and the old crash returns. Worth a heads-up if you ever bump Pyloid.
- Upstream `python-pyloid-desktop-packaging` skill still documents the `aboutToQuit`-only fix AND doesn't warn against app-wide event filters — both should be updated.

---

## [0.8.1] — 2026-05-17 · P5.fix-1: macOS Cmd+Q event-filter shutdown (regressed startup; superseded by v0.8.2)

**Tag:** `v0.8.1`

### Fixed
- **Cmd+Q on macOS no longer crashes the binary.** v0.8.0 (and every prior macOS build) inherited the `python-pyloid-desktop-packaging` skill's `aboutToQuit → os._exit(0)` workaround for the long-standing Qt6+QtWebEngine static-destructor race (`QSurface::~QSurface` → `QOpenGLContext::currentContext()` → `QThreadStorageData::get()` dereferences a null pointer deep inside `__cxa_finalize_ranges`). On macOS 26.x with PySide6 6.9 + Pyloid 0.27 that hook turned out to be **insufficient on the menu Cmd+Q path**: AppKit's `[NSApplication terminate:]` sends a `QEvent::Quit` to `QApplication`, Pyloid's `BrowserWindow.closeEvent` calls `QCoreApplication.quit()` from inside the close cascade, and `quit()` on macOS routes back through the Cocoa platform plugin and **re-enters `[NSApplication terminate:]` recursively** — proceeding straight to `libc exit()` without unwinding back to `QCoreApplication::exec()`'s cleanup, which is where `aboutToQuit` is actually emitted. The fallback hook never fired; the destructor chain ran; the process aborted.
- Replaced the single `aboutToQuit` connection with a `QApplication`-level event filter that catches `QEvent::Quit` **before** it reaches `tryCloseAllWidgetWindows`, and `os._exit(0)`s right there. We never run any closeEvent, never re-enter terminate, never reach `__cxa_finalize_ranges`. The `aboutToQuit` hook is kept as a fallback for code paths that DO unwind through `exec()` (e.g. a SIGTERM signal handler calling `app.quit()` from a normal context).
- Module-level reference (`_quit_event_filter`) keeps the `QObject` alive past the function's stack frame — Qt holds a raw pointer via `installEventFilter`, and CPython would otherwise free it the moment the local went out of scope, crashing the next event delivery.

### Known limitations (deferred)
- In-flight training subprocess does not receive a SIGTERM before the parent exits via `os._exit(0)` — the child is reparented to launchd and runs to completion or is reaped by the OS. Plumbing a graceful job-group shutdown before the hard exit lands in a follow-up; this fix is scoped to stopping the crash.
- The upstream `python-pyloid-desktop-packaging` skill at `~/.claude/skills/python-pyloid-desktop-packaging/SKILL.md` still documents `aboutToQuit` alone as the fix. That should be updated to reflect the re-entrant-terminate path observed here so other Pyloid projects don't repeat the same incomplete workaround.

---

## [0.8.0] — 2026-05-17 · P5: Train — Classification local run

**Tag:** `v0.8-p5-train-classify`

### Added
- **Classification training is live.** The `/train` task picker no longer gates the Classification card behind "P5" — pick it, drop an ImageFolder (`train/<class>/*.jpg`, optionally with `val/<class>/*.jpg`), tune, hit Start, watch live top-1/top-5 accuracy curves alongside training loss, save the trained checkpoint into the model library, and run it on slide patches in `/predict`.
- **Dataset wizard accepts ImageFolder for training.** The inspector already recognised it (warning copy aside); P5 wires Continue past the dataset page and adds a friendly warning when the user's selected task on `/train` doesn't match the layout they dropped (e.g. classify task + Roboflow YOLO folder).
- **Configure page branches per task.** Classification filters the model picker to `*-cls` weights, swaps the image-size chip ladder to 96–384 (anchored at 224 — the size `yolo*-cls.pt` was distilled at), hides the YOLO class-name editor (ImageFolder dir names ARE the class names), and re-probes `/api/hardware` with `task=classify` for batch-size suggestions (classify head fits ~2× detect at the same VRAM).
- **Live charts switch on the job's task.** Detection still draws box/cls/dfl loss + mAP50/mAP50-95; classification draws `train/loss` + validation top-1/top-5 accuracy on a 0..1 axis. `TrainingJobInfo.task` is the source of truth, so the chart re-renders correctly even after a refresh.
- **Save-to-library routes per task.** A classify run's `best.pt` lands in `<storage_root>/models/classify/trained-<short_id>.pt`, the registry rescan picks it up, and the run page sets it as the new classify default so `/predict` is one click away.
- Backend: `engine/train_runner.py` gained a `--task` arg + classify metric-key probes (`metrics/accuracy_top1`, `metrics/accuracy_top5`, `train/loss` with `train/cls_loss` fallback) and routes `data=` to the ImageFolder root for classify vs `data.yaml` for detect. `engine/training.py::JobManager.start()` now takes `task`, validates the dataset shape per task, persists `task` on `TrainingJob`, and `save_to_library()` routes by `job.task` instead of hard-coded detect. `TrainingMetrics` schema gains nullable `loss` / `top1` / `top5` fields that coexist with the detect-only fields.

### Fixed
- The dataset inspector's ImageFolder warning no longer parrots "classification is P5 — configure page is detection-only for now"; it now surfaces the actually-useful warnings (missing `val/` split, single-class dataset) and stays silent when the layout is clean.
- The `/train` task picker's `disabled` flag and the configure page's hard-coded `task: "detect"` in the hardware-probe query key are both gone — selecting classify on `/train` now actually drives every downstream surface.
- `/train/configure` re-seeds epochs + image_size from the new task's preset when the user switches detect ↔ classify, so 640px doesn't linger from a previous detect session into a classify run.

### Known limitations (deferred)
- Classification training reports `train/loss` as `null` on some Ultralytics 8.4+ builds where the value sits under `train/cls_loss` only after the validation pass. The chart connects across nulls; the dropped points are silent rather than crashing the stream.
- Confusion matrix + per-class precision/recall reports for classify are P7-polish — the run page shows live top-1/top-5 but doesn't yet render a confusion grid at completion.
- Multi-tenant training is still out of scope; one in-flight job per JobManager. A queued status flips straight to running on submit.
- Colab tunnel handoff for classify (PLAN.md §11) lands in P6 alongside detect.

---

## [0.7.1] — 2026-05-17 · P4b.fix-1: Models — Download + rename + ml-import safety net

No tag — between-phase patch.

### Added
- **Download** button on every model card in `/models`. Streams the `.pt` via `GET /api/models/{name}/download` with `Content-Disposition: attachment` so QtWebEngine's `downloadRequested` handler (P3b.fix-1) lands it in `~/Downloads/`. Works for bundled, imported, and locally-trained models alike — clinicians wanted a one-click backup of a freshly-trained checkpoint without spelunking into `<storage_root>`.
- **Rename** button on imported + trained checkpoints. Inline edit on the card title; Enter saves, Esc cancels. `.pt` extension auto-appended if missing. Empty / colliding / unsanitised names are rejected on both client and backend (`POST /api/models/{name}/rename`). The rename also updates `defaults.json` so a renamed default stays the default.
- Bundled weights are read-only (the install tree gets re-fetched by `scripts/fetch-models.py`), so the Rename button doesn't show on bundled cards — only Download.

### Fixed
- **`/api/models` no longer 500s when the `ml` extra is missing.** `registry._inspect()` had the `from ultralytics import YOLO` outside its `try` block, so a `ModuleNotFoundError` (typical after a `uv sync --extra dev --extra desktop` without `--extra ml`) bubbled up uncaught. The import is now inside the try and `ImportError` becomes a clean `ModelLoadError`; the scan loop drops the failing entry, `/api/models` returns an empty list with 200, and the frontend renders the friendly "No detection models — run scripts/fetch-models.py --task detect" message instead of a generic error page.

---

## [0.7.0] — 2026-05-17 · P4b: Train — Detection local run

**Tag:** `v0.7-p4b-train-detect-run`

### Added
- **Local training actually runs.** Press **Start training** on `/train/configure` and the backend spawns an Ultralytics subprocess against your dataset. Per-epoch metrics stream live to `/train/run` via WebSocket with two Recharts curves (box/cls/dfl loss + mAP50 / mAP50-95), a progress bar, and a scrolling log tail.
- **Class-name editor** on `/train/configure` — rename each class in place before training. Names are written into the dataset's `data.yaml` and embedded in the trained checkpoint so `/predict` shows them automatically. Empty / duplicate names are rejected on both client and backend (`PATCH /api/datasets/{id}/classes`).
- **Placeholder-name detection**: plain-YOLO datasets that come without a `data.yaml` get `class_0…class_N` placeholders that the editor highlights in amber, with a callout reminding you to rename them before training.
- **Cancel in-flight training** via a SIGTERM to the subprocess group (`start_new_session=True` on POSIX, `CREATE_NEW_PROCESS_GROUP` on Windows). The `/train/run` page shows a Cancel button while the run is queued/running.
- **Save-to-library** copies the run's `best.pt` into `<storage_root>/models/detect/trained-<short_id>.pt`, refreshes the registry, sets it as the new detection default, and surfaces an **Open in Predict** button so the doctor lands one click away from running their fresh model on slide patches.
- Backend subprocess wrapper (`engine/training.py` + `engine/train_runner.py`): job manager keeps an in-memory event log; a reader thread tails subprocess stdout; JSON-line events (`{_VRL_EVENT: true, type, …}`) are interleaved with raw log lines; the WebSocket handler replays every event on connect so a refresh lands a coherent snapshot.
- New routes: `POST /api/training/start` (returns 202 + `job_id`), `GET /api/training/{id}`, `WS /api/training/{id}/stream`, `POST /api/training/{id}/cancel`, `POST /api/training/{id}/save-to-library`.
- Hardware-aware: training inherits the configure-page accelerator probe (CUDA / MPS / CPU). Cross-version metric-key probes (`metrics/mAP50(B)` vs `metrics/mAP_0.5`) so the same UI works across Ultralytics 8.3 / 8.4.

### Fixed
- **Ultralytics auto-suffixed run names**: the job manager pre-creates `<output_dir>/<job_id>/` so we know where to find `best.pt`, but Ultralytics would write to `<job_id>-2/` because `exist_ok` defaulted to `False`. Now passing `exist_ok=True` to `model.train()` so the run lands exactly where the manager expects it.

### Known limitations (deferred)
- Some loss metrics (box / cls / dfl) come through as `null` on certain Ultralytics versions where they live under different keys than the validation mAPs. The chart connects across nulls; the failing keys are dropped silently rather than crashing the stream.
- Training jobs are kept in-memory only — restarting uvicorn (e.g. via `run-desktop --clean`) loses the job snapshot. The on-disk `<storage_root>/training/<job_id>/` run artefacts survive, so you can still grab `best.pt` manually.
- Classification training is still detection-only at the UI level; P5 ships the classify branch (`task=classify` ImageFolder + top-1/top-5 metrics).
- Colab tunnel handoff (PLAN.md §11) lands in P4c — when no accelerator is detected, the wizard currently still lets you start a CPU run instead of suggesting Colab.

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
