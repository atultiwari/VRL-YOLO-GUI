/**
 * In-app changelog source of truth.
 *
 * Each entry maps a shipped version to a phase, git tag, commit short SHA,
 * and the features / fixes that became functional in that build. The
 * /changelog page renders these; CHANGELOG.md at the repo root mirrors
 * the same data for GitHub viewers.
 *
 * Update protocol (on every phase commit):
 *   1. Bump `pyproject.toml` `version` so `/api/health` reports the new value.
 *   2. Add a new entry at the TOP of `RELEASES` with status: "current".
 *   3. Flip the previously-current entry to status: "shipped".
 *   4. Mirror the entry into CHANGELOG.md.
 *   5. Tag the commit (e.g. v0.3-p2-predict-classify) and push.
 */

export type ReleaseStatus = "current" | "shipped";

export interface ReleaseEntry {
  /** Semver string that matches pyproject.toml at this commit. */
  version: string;
  /** PLAN.md phase identifier — "P0", "P1", "P1.fix-1", "P2", … */
  phase: string;
  /** Short human title for the phase. */
  title: string;
  /** Annotated git tag, or null for between-phase fix commits. */
  tag: string | null;
  /** Short commit SHA (7 chars) the entry was cut from. */
  commit: string;
  /** ISO date — usually the day of the commit. */
  date: string;
  /** Latest shipped release flips to "current" until the next entry lands. */
  status: ReleaseStatus;
  /** What's functional in the binary as of this version. */
  features: string[];
  /** Bugs squashed in this version. */
  fixes: string[];
  /** Carried-forward gaps that the next phase will close. */
  knownLimitations?: string[];
}

export const RELEASES: ReleaseEntry[] = [
  {
    version: "0.8.0",
    phase: "P5",
    title: "Train — Classification local run",
    tag: "v0.8-p5-train-classify",
    commit: "1d104f7",
    date: "2026-05-17",
    status: "current",
    features: [
      "**Classification training is live.** The /train task picker no longer gates the Classification card behind \"P5\" — pick it, drop an ImageFolder (`train/<class>/*.jpg`, optionally with `val/<class>/*.jpg`), tune, hit Start, watch live top-1/top-5 accuracy curves alongside training loss, save the trained checkpoint into the model library, and run it on slide patches in /predict.",
      "**Dataset wizard accepts ImageFolder for training.** The inspector already recognised it (warning copy aside); P5 wires Continue past the dataset page and adds a friendly warning when the user's selected task on /train doesn't match the layout they dropped (e.g. classify task + Roboflow YOLO folder).",
      "**Configure page branches per task.** Classification filters the model picker to `*-cls` weights, swaps the image-size chip ladder to 96–384 (anchored at 224 — the size yolo*-cls.pt was distilled at), hides the YOLO class-name editor (ImageFolder dir names ARE the class names), and re-probes /api/hardware with `task=classify` for batch-size suggestions (classify head fits ~2× detect at the same VRAM).",
      "**Live charts switch on the job's task.** Detection still draws box/cls/dfl loss + mAP50/mAP50-95; classification draws train/loss + validation top-1/top-5 accuracy on a 0..1 axis. `TrainingJobInfo.task` is the source of truth, so the chart re-renders correctly even after a refresh.",
      "**Save-to-library routes per task.** A classify run's `best.pt` lands in `<storage_root>/models/classify/trained-<short_id>.pt`, the registry rescan picks it up, and the run page sets it as the new classify default so /predict is one click away.",
      "Backend: `engine/train_runner.py` gained a `--task` arg + classify metric-key probes (`metrics/accuracy_top1`, `metrics/accuracy_top5`, `train/loss` with `train/cls_loss` fallback) and routes `data=` to the ImageFolder root for classify vs `data.yaml` for detect. `engine/training.py` `JobManager.start()` now takes `task`, validates the dataset shape per task, persists `task` on `TrainingJob`, and `save_to_library()` routes by job.task instead of hard-coded detect. `TrainingMetrics` schema gains nullable `loss` / `top1` / `top5` fields that coexist with the detect-only fields.",
    ],
    fixes: [
      "The dataset inspector's ImageFolder warning no longer parrots \"classification is P5 — configure page is detection-only for now\"; it now surfaces the actually-useful warnings (missing val/ split, single-class dataset) and stays silent when the layout is clean.",
      "The /train task picker's `disabled` flag and the configure page's hard-coded `task: \"detect\"` in the hardware-probe query key are both gone — selecting classify on /train now actually drives every downstream surface.",
      "`/train/configure` re-seeds epochs + image_size from the new task's preset when the user switches detect ↔ classify, so 640px doesn't linger from a previous detect session into a classify run.",
    ],
    knownLimitations: [
      "Classification training reports `train/loss` as `null` on some Ultralytics 8.4+ builds where the value sits under `train/cls_loss` only after the validation pass. The chart connects across nulls; the dropped points are silent rather than crashing the stream.",
      "Confusion matrix + per-class precision/recall reports for classify are P7-polish — the run page shows live top-1/top-5 but doesn't yet render a confusion grid at completion.",
      "Multi-tenant training is still out of scope; one in-flight job per JobManager. A queued status flips straight to running on submit.",
      "Colab tunnel handoff for classify (PLAN.md §11) lands in P6 alongside detect.",
    ],
  },
  {
    version: "0.7.1",
    phase: "P4b.fix-1",
    title: "Models — Download + rename + ml-import safety net",
    tag: null,
    commit: "2c0ced6",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "**Download** button on every model card in /models. Streams the `.pt` file via `GET /api/models/{name}/download` with `Content-Disposition: attachment` so QtWebEngine's downloadRequested handler (P3b.fix-1) lands it in ~/Downloads/. Works for bundled, imported, and locally-trained models alike — clinicians wanted a one-click backup of a freshly-trained checkpoint without spelunking into `<storage_root>`.",
      "**Rename** button on imported + trained checkpoints. Inline edit on the card title; Enter saves, Esc cancels. `.pt` extension auto-appended if missing. Empty / colliding / unsanitised names are rejected on both client and backend (`POST /api/models/{name}/rename`). The rename also updates `defaults.json` so a renamed default stays the default.",
      "Bundled weights are read-only (the install tree gets re-fetched by `scripts/fetch-models.py` anyway), so the Rename button doesn't show on bundled cards — only Download.",
    ],
    fixes: [
      "When the venv is built without the `ml` extra, `/api/models` used to return 500 because the `from ultralytics import YOLO` inside `registry._inspect()` raised an uncaught `ModuleNotFoundError`. Now the import lives inside the try block and `ImportError` becomes a clean `ModelLoadError`; the scan loop drops the failing entry and `/api/models` returns an empty list with 200, so the frontend renders the friendly \"No detection models — run scripts/fetch-models.py --task detect\" message instead of a generic error page.",
    ],
  },
  {
    version: "0.7.0",
    phase: "P4b",
    title: "Train — Detection local run",
    tag: "v0.7-p4b-train-detect-run",
    commit: "2e42d9d",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "**Local training actually runs.** Press \"Start training\" on /train/configure and the backend spawns an Ultralytics subprocess against your dataset. Per-epoch metrics stream live to /train/run via WebSocket with two Recharts curves (box/cls/dfl loss + mAP50 / mAP50-95), a progress bar, and a scrolling log tail.",
      "**Class-name editor** on /train/configure — rename each class in place before training. Names are written into the dataset's `data.yaml` and embedded in the trained checkpoint so /predict shows them automatically. Empty / duplicate names are rejected on both client and backend.",
      "Placeholder-name detection: plain-YOLO datasets that come without a `data.yaml` get `class_0…class_N` placeholders that the editor highlights in amber, with a callout reminding you to rename before training.",
      "**Cancel in-flight training** via a SIGTERM to the subprocess group (`start_new_session=True` on POSIX, `CREATE_NEW_PROCESS_GROUP` on Windows). The /train/run page shows a Cancel button while the run is queued/running.",
      "**Save-to-library** copies the run's `best.pt` into `<storage_root>/models/detect/trained-<short_id>.pt`, refreshes the registry, sets it as the new detection default, and surfaces an \"Open in Predict\" button so the doctor lands one click away from running their fresh model on slide patches.",
      "Backend subprocess wrapper (`engine/training.py` + `engine/train_runner.py`): job manager keeps an in-memory event log, a reader thread tails subprocess stdout, JSON-line events (`{_VRL_EVENT: true, type, ...}`) are interleaved with raw log lines, the WebSocket handler replays every event so a refresh lands a coherent snapshot.",
      "New routes: `POST /api/training/start` (returns 202 + job_id), `GET /api/training/{id}`, `WS /api/training/{id}/stream`, `POST /api/training/{id}/cancel`, `POST /api/training/{id}/save-to-library`, plus `PATCH /api/datasets/{id}/classes` for the rename editor.",
      "Hardware-aware: training inherits the configure-page accelerator probe (CUDA / MPS / CPU). Cross-version metric-key probes (`metrics/mAP50(B)` vs `metrics/mAP_0.5`) so the same UI works across Ultralytics 8.3 / 8.4.",
    ],
    fixes: [
      "Ultralytics auto-suffixed run names: the job manager pre-creates `<output_dir>/<job_id>/` so we know where to find `best.pt`, but Ultralytics would write to `<job_id>-2/` because `exist_ok` defaulted to `False`. Now passing `exist_ok=True` to `model.train()` so the run lands exactly where the manager expects it.",
    ],
    knownLimitations: [
      "Some loss metrics (box / cls / dfl) come through as `null` on certain Ultralytics versions where they live under different keys than the validation mAPs. The chart connects across nulls; the failing keys are dropped silently rather than crashing the stream.",
      "Training jobs are kept in-memory only — restarting uvicorn (e.g. via `run-desktop --clean`) loses the job snapshot. The on-disk `<storage_root>/training/<job_id>/` run artefacts survive, so you can still grab `best.pt` manually.",
      "Classification training is still detection-only at the UI level; P5 ships the classify branch (`task=classify` ImageFolder + top-1/top-5 metrics).",
      "Colab tunnel handoff (PLAN.md §11) lands in P4c — when no accelerator is detected, the wizard currently still lets you start a CPU run instead of suggesting Colab.",
    ],
  },
  {
    version: "0.6.1",
    phase: "P4a.fix-1",
    title: "Train — Dataset upload fix + split helper",
    tag: null,
    commit: "debf84b",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "**Prepare splits** tool — for plain-YOLO datasets (images/+labels/ at root) and Roboflow exports that only ship a train split, click \"Prepare splits…\" to reshuffle into a clean train / valid / test layout with sliders for the ratios + a random seed.",
      "Backend `POST /api/datasets/{id}/split`: collects every image+label pair across the existing layout (any of plain YOLO, train-only Roboflow, or fully-split Roboflow), shuffles by seed, redistributes, wipes the old tree, and rewrites data.yaml. Preserves the dataset's UUID so the wizard store doesn't lose track.",
      "Class names are preserved from existing data.yaml when present; for plain YOLO without a yaml, the splitter walks label files to find the max class id and emits `class_0..N` placeholders (rename them later in P4b).",
      "Yellow callout on /train/dataset when no validation split is detected — clicking \"Prepare splits…\" opens the modal. After a successful split, a smaller \"Re-split\" button stays available for tweaking ratios.",
      "Backend tolerates ratios summing to 1.0 ± 0.001 (frontend rounds via integer percentages → divide by 100, so the sum sometimes drifts by a hair).",
    ],
    fixes: [
      "Roboflow YOLO datasets like `data.yaml + train/images + train/labels` were detected as \"Unknown layout\" in v0.6.0 — the FolderDropzone we built for Predict was MIME-filtered to images, so `data.yaml` and all the `.txt` label files were dropped at the browser level before they ever reached the backend. FolderDropzone now takes a `mode: 'images' | 'any'` prop; the Train wizard passes `mode=\"any\"` so the full dataset (yaml + labels + images) makes it through.",
    ],
  },
  {
    version: "0.6.0",
    phase: "P4a",
    title: "Train — Detection wizard",
    tag: "v0.6-p4a-train-detect-wizard",
    commit: "08d5f46",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "New three-step training wizard at /train → /train/dataset → /train/configure (with /train/run as a P4b preview placeholder).",
      "/train task picker: Detection card opens the dataset wizard; Classification is gated behind a 'P5' badge so the doctor knows it's coming.",
      "Dataset upload + auto-inspect: drop a folder, see the format (Roboflow YOLO / plain YOLO / COCO / Pascal VOC / ImageFolder), per-split image + label counts, class list, and any warnings before committing to a run.",
      "Real upload progress bar via XMLHttpRequest (fetch still doesn't expose upload-progress events), with an in-flight Cancel button backed by AbortController.",
      "Backend dataset inspector (`server/vrl_yolo/engine/dataset.py`): path-traversal-safe upload writer, format auto-detection, class-balance counters; 4 GB total-size cap.",
      "Hardware probe at `/api/hardware`: returns kind/name/vram_gb/suggested_batch_size; the configure page reads it on mount and pre-fills the batch slider with a sensible default.",
      "Configure page: model picker (detect models only), preset radio (Quick=5ep / Standard=50ep / Best=200ep / Custom), image-size chip selector, batch-size slider with live hardware hint, summary card showing steps/epoch + total steps.",
      "Train state persisted to localStorage (Zustand) so reload / close-reopen during the wizard doesn't blow up the 200-image upload.",
      "Dataset rehydrate endpoint `GET /api/datasets/{id}` — configure page re-fetches on mount; if the dataset was wiped from disk (e.g. via a Reset desktop storage run), the user bounces back to /train/dataset.",
    ],
    fixes: [],
    knownLimitations: [
      "Training itself doesn't run yet — /train/run is a preview that shows the configured payload. P4b lands the actual subprocess + live metric WebSocket + results page.",
      "Classification training is detected (ImageFolder layouts get a friendly summary) but the configure page is detection-only. P5 ships the classify branch.",
      "Plain YOLO datasets (no data.yaml) require you to fill in class names — currently we surface a warning, but the configure page doesn't yet have a class-naming editor. Plan to add this in P4b alongside the run page.",
      "Datasets are uploaded over multipart — fast on a local Pyloid window but awkward on slow networks. A native folder-picker bridge for desktop mode lands in P7.",
    ],
  },
  {
    version: "0.5.1",
    phase: "P3b.fix-1",
    title: "Predict — Downloads fix",
    tag: null,
    commit: "cd1a92b",
    date: "2026-05-17",
    status: "shipped",
    features: [],
    fixes: [
      "CSV / XLSX / PDF export buttons in /predict folder mode now actually deliver a file — the v0.5.0 build had them silently dropping the download because QtWebEngine blocks downloads until something connects to the profile's `downloadRequested` signal. Pyloid's window doesn't ship a download manager, so the export request reached the backend, returned 200 with the right `Content-Disposition`, then the blob URL click went nowhere.",
      "Added `_install_download_handler()` in src-pyloid/main.py: auto-accepts every download, drops it in `~/Downloads/` with a unique-name suffix (e.g. `vrl-yolo-detect-...csv` → `vrl-yolo-detect-... (1).csv` if a file with the same name already exists), and logs the destination path via the `step:` prefix so the user can see where the file went in launch.log.",
    ],
  },
  {
    version: "0.5.0",
    phase: "P3b",
    title: "Predict — Reports, Import & Settings",
    tag: "v0.5-p3b-predict-reports",
    commit: "0d05150",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Settings page (new /settings route, sidebar entry under 'Preferences') with localStorage-backed preferences. First toggle: show / hide clinical workflow presets in /predict (default: hidden — the bundled COCO/ImageNet weights don't have clinical class names yet).",
      "Folder-batch image preview: click any row in the per-image table to see that file's image with detection boxes or the classify top-5 chart in a preview pane above the aggregate.",
      "Auto-select the first successful result so the preview pane never sits empty.",
      "Backend report generators: GET-then-download CSV, XLSX (per-image + aggregate sheets), and PDF (cover + summary + thumbnail grid + per-image table). ReportLab + OpenPyXL — no new dependencies.",
      "Frontend export toolbar (CSV / XLSX / PDF buttons) in the batch table card; PDF embeds up to 12 sample thumbnails resized to 480 px JPEG to keep payload size sane.",
      "/api/models/import: upload a .pt checkpoint, backend reads `model.task` + class names via Ultralytics, places it in `<storage_root>/models/<task>/`, refreshes the registry; user-imported models show up immediately with a `source: 'user'` card.",
      "/models page Import button: hidden file picker + mutation + query invalidation; shows backend errors verbatim (e.g. 'task=segment not supported in v1').",
      "Topbar pill now reads `v0.5.0 · predict — reports, import & settings` via the shared `useLiveVersion()` hook.",
    ],
    fixes: [],
    knownLimitations: [
      "Sliders still re-run on click only (live-update is deferred to a future polish pass — feedback was that it was lower priority than reports + import).",
      "Workflow presets hidden by default — clinical class names aren't in the bundled weights yet. Tracked to re-open in P10 (memory: project_presets_revisit).",
      "PDF thumbnail grid caps at 12 samples per report; the first 12 successful items by default. Curated selection lands when we add per-image flag annotations.",
      "No streaming batch WS endpoint yet — client-side iteration continues. Will be revisited when Train (P4) needs WS plumbing for live metrics.",
    ],
  },
  {
    version: "0.4.0",
    phase: "P3a",
    title: "Predict — Batch & Workflow Presets",
    tag: "v0.4-p3a-predict-batch",
    commit: "84dc3f8",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Folder mode: drop a folder of slide patches; the UI runs inference image-by-image with a live progress bar.",
      "Per-image results table — file, top class / box count, conf or count, inference ms — works for both detection and classification.",
      "Aggregate panel: detection rolls up per-class totals + max conf across the batch; classification rolls up the class distribution + flagged-count (top-1 below the review threshold).",
      "Recursive checkbox controls whether the dropzone walks subfolders or only the top level.",
      "Cancel button (`StopCircle`) aborts the in-flight batch — backed by `AbortController` plumbed through `runBatch()`.",
      "Workflow presets sidebar: 9 clinical workflows (histopathology mitosis / nuclei / tumour-subtype / Gleason; hematology WBC-diff / bone-marrow / malaria / smear-pathology / marrow-pattern). Picking one prefills model + conf + iou.",
      "`/api/presets` exposes the preset catalog from `engine/presets.py` (typed `Preset` dataclasses).",
      "Top-bar badge now reads from `/api/health` via a shared `useLiveVersion()` hook — no more hardcoded version strings.",
    ],
    fixes: [
      "Top-bar version pill was stuck at 'v0.1.0 · scaffolding' since P0; now reflects the running build (e.g. 'v0.4.0 · predict — batch & workflow presets').",
    ],
    knownLimitations: [
      "Sliders still re-run on click only — live updates land in P3b polish.",
      "User .pt import via the UI still returns 501 (lands in P3b).",
      "CSV / XLSX / PDF reports not yet implemented — P3b ships the task-aware report templates.",
      "Batch runs are sequential (concurrency = 1) on purpose; multi-GPU parallelism is a P10 problem.",
    ],
  },
  {
    version: "0.3.0",
    phase: "P2",
    title: "Predict — Classification",
    tag: "v0.3-p2-predict-classify",
    commit: "455efc8",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Single-image classification via Ultralytics' classify head — top-1 + top-5 returned for the full softmax distribution.",
      "/predict view task-switches based on the selected model: no SVG overlay, top-1 banner, top-5 bar chart (Recharts).",
      "Confidence slider repurposes as a review threshold — top-1 below the threshold renders a 'needs review' badge.",
      "Four new bundled classification weights: yolo26n-cls.pt, yolo26s-cls.pt, yolov8n-cls.pt, yolov8s-cls.pt (~37 MB).",
      "/api/inference/single now returns a discriminated union (detect | classify); FastAPI documents both shapes in OpenAPI.",
      "In-app /changelog page lists per-build features, fixes, and known limitations.",
    ],
    fixes: [],
    knownLimitations: [
      "Sliders don't live-update inference — still click-to-rerun (live updates planned for P3).",
      "User .pt import via the UI still returns 501 (lands in P3).",
      "Folder batch + CSV/XLSX/PDF reports not yet implemented (P3).",
    ],
  },
  {
    version: "0.2.1",
    phase: "P1.fix-1",
    title: "Cold-start race fix",
    tag: null,
    commit: "427093d",
    date: "2026-05-17",
    status: "shipped",
    features: [],
    fixes: [
      "Pyloid window no longer races uvicorn's lifespan startup — `window.load_url` waits for `Server.started`; backend ready in ~55 ms instead of ~12 s.",
      "Registry scan + torch import deferred out of FastAPI lifespan; first /api/models call does a lazy scan (~1.7 s) and caches.",
    ],
  },
  {
    version: "0.2.0",
    phase: "P1",
    title: "Predict — Detection",
    tag: "v0.2-p1-predict-detect",
    commit: "2acd8f5",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Single-image detection via Ultralytics YOLO — boxes (xyxy + xywhn), per-class counts, accelerator + inference timing in the response.",
      "Apple Silicon MPS auto-detected; first inference cold-loads ~3.6 s, subsequent calls ~50–100 ms.",
      "/predict view: drop zone, model picker, confidence + IoU sliders, SVG box overlay with stable per-class colours, counts table.",
      "/models page lists bundled + user models grouped by task with a 'Set as default' mutation that persists to disk.",
      "Four bundled detection weights: yolo26n.pt, yolo26s.pt, yolov8n.pt, yolov8s.pt (~53 MB).",
      "Model registry persists per-task defaults to <storage_root>/models/defaults.json.",
      "Python pinned to 3.11 via `.python-version`; dev + CI converge.",
    ],
    fixes: [],
  },
  {
    version: "0.1.0",
    phase: "P0",
    title: "Scaffolding",
    tag: "v0.1-p0-scaffolding",
    commit: "d06e9e2",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Pyloid desktop window opens, embedded uvicorn serves /api/health (200).",
      "Repo layout finalised: server/vrl_yolo/ (flat module), apps/web/ (Next.js 15 + Tailwind v4), src-pyloid/, scripts/, packaging/, models/.",
      "Six router stubs return 501 with the phase they land in — discoverable from /openapi.json.",
      "AGPL-3.0 LICENSE + COMMERCIAL-LICENSE.md template + NOTICE for upstream component licenses.",
      "GitHub Actions release workflow: macos-14 (arm64) + windows-latest (x64) matrix.",
      "macOS-specific packaging recipe in scripts/build-release.py: devtool-bundle strip, Team-ID inside-out resign, Info.plist version stamp, .dmg wrap, aboutToQuit → os._exit shutdown workaround.",
    ],
    fixes: [],
  },
];

/** Convenience accessor — UI uses this for the "you're on" indicator. */
export function currentRelease(): ReleaseEntry {
  return RELEASES.find((r) => r.status === "current") ?? RELEASES[0];
}
