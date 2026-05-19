# Phase Status

> Living tracker for the 11-phase build plan in [PLAN.md §14](../PLAN.md#14-phases--milestones).
> Updated at the end of each phase boundary. **Last edit: 2026-05-20 (P6b — desktop Run on Colab callout + Connect modal + Colab-backed jobs).**
>
> **Known limitations and deferred work** live in
> [`docs/CARRY-FORWARDS.md`](CARRY-FORWARDS.md) — full diagnoses + fix
> options for each item, organised for cold-pickup in a future session.

## Snapshot

| Phase | Status | Tag | Commit |
|---|---|---|---|
| Pre — CLAUDE.md entry guide | ✅ done | — | `9bd0b83` |
| **P0 — Scaffolding** | ✅ done | `v0.1-p0-scaffolding` | `d06e9e2` |
| **P1 — Predict (Detection)** | ✅ done | `v0.2-p1-predict-detect` | `2acd8f5` |
| P1.fix-1 — Cold-start race fix | ✅ done | — | `427093d` |
| **P2 — Predict (Classification)** | ✅ done | `v0.3-p2-predict-classify` | `455efc8` |
| Topbar fix — live version | ✅ done | — | `e62d8d2` |
| **P3a — Predict v1: batch + presets** | ✅ done | `v0.4-p3a-predict-batch` | `84dc3f8` |
| **P3b — Predict v1: reports, import & settings** | ✅ done | `v0.5-p3b-predict-reports` | `0d05150` |
| P3b.fix-1 — QtWebEngine downloads | ✅ done | — | `cd1a92b` |
| **P4a — Train (Detection) wizard** | ✅ done | `v0.6-p4a-train-detect-wizard` | `08d5f46` |
| P4a.fix-1 — Dataset upload + split helper | ✅ done | — | `debf84b` |
| **P4b — Train (Detection) local run** | ✅ done | `v0.7-p4b-train-detect-run` | `2e42d9d` |
| P4b.fix-1 — Models download + rename + ml-import safety net | ✅ done | — | `2c0ced6` |
| **P5 — Train (Classification)** | ✅ done | `v0.8-p5-train-classify` | `1d104f7` |
| P5.fix-1 — macOS Cmd+Q event-filter shutdown (regressed startup; superseded by P5.fix-2) | ⚠️ superseded | `v0.8.1` | `543b40d` |
| P5.fix-2 — Window-scoped close filter | ✅ done | `v0.8.2` | `5bc93cc` |
| P5.fix-3 — Flat ImageFolder + classify splitter + layout examples | ✅ done | `v0.8.3` | `72dc1db` |
| P5.fix-4 — Subprocess env-var dispatch (frozen `-m` bug) | ✅ done | `v0.8.4` | `a86da1b` |
| P5.fix-5 — Graceful job cancel on Cmd+Q | ✅ done | `v0.8.5` | `9159d0e` |
| P5.fix-6 — Preserve existing splits in the splitter | ✅ done | `v0.8.6` | `c5ae06e` |
| P5.fix-7 — Bundle our own dist-info (version badge fix) | ✅ done | `v0.8.7` | `400ba79` |
| **P6a — Colab companion notebooks + runtime** | ✅ done | `v0.8.8-p6a-colab-notebook` | `8e3f08d` |
| **P6b — Desktop *Run on Colab* integration** | ✅ done | `v0.8.9-p6b-colab-desktop` | `6ca2f73` |
| P6c — Polish + end-to-end pilot test | ⏳ next | — | — |
| P7 — Polish | ⏳ pending | — | — |
| P8 — Packaging macOS | ⏳ pending | — | — |
| P9 — Packaging Windows | ⏳ pending | — | — |
| P10 — Pilot | ⏳ pending | — | — |

**Current head:** `main` at the P6b commit (`v0.8.9-p6b-colab-desktop`). **Next sub-phase:** P6c — polish + error states + the 9-step end-to-end pilot test against a real Colab session and a clinical dataset. Adds reconnect-with-backoff on WebSocket drops, best.pt download resumability, and Colab-session-timeout detection on the desktop side. Spec: [`docs/PLAN-P6.md`](PLAN-P6.md) §3, pilot plan in §7. Target tag `v0.9-p6-train-colab`.

---

## Completed phases

### ✅ Pre — `9bd0b83`

Added `CLAUDE.md` — the session entry guide. Captures locked-in stack, the 7 load-bearing decisions from the planning iterations, the template fork path, skills-first reminder, and collaboration conventions. Future Claude sessions read this before touching anything else.

### ✅ P0 — Scaffolding · `v0.1-p0-scaffolding` · `d06e9e2`

**Phase deliverable (PLAN.md §14):** the Pyloid window opens and the FastAPI backend responds at `/api/health`.

**Sub-phases:**

| # | Subject | Outcome |
|---|---|---|
| P0.1 | Scan VRL-ML-Studio-Lite template | Identified 8 files worth copying verbatim |
| P0.2 | Author `pyproject.toml` + `uv.lock` | AGPL-3.0, optional `ml` extra |
| P0.3 | `pnpm-workspace.yaml` + `.gitignore` | Anchored rules; load-bearing storage comment kept |
| P0.4 | Backend module skeleton | `server/vrl_yolo/` flat module (no `packages/core/`) |
| P0.5 | Desktop entry (`src-pyloid/main.py`) | `freeze_support`, TCC-safe path, `aboutToQuit → os._exit` |
| P0.6 | Next.js shell (`apps/web/`) | Tailwind v4 `@theme`, route groups, inline-CSS splash |
| P0.7 | `scripts/` + `packaging/` adapted | macOS devtool-strip + Team-ID resign preserved |
| P0.8 | GitHub Actions release workflow | macos-14 + windows-latest matrix |
| P0.9 | License + NOTICE | AGPL-3.0 full text + commercial template |
| P0.10 | README + empty dirs | `.gitkeep`s preserve the target tree |
| P0.11 | Verify Pyloid window opens | All step prints fired; `/api/health` 200 |
| P0.12 | Commit + push + tag | `d06e9e2` + `v0.1-p0-scaffolding` |

**Verification:**

```
step: import pyloid
step: import vrl_yolo.api.create_app
step: build settings
  storage_path:  ~/Library/Application Support/VRL-YOLO-GUI
  static path:   apps/web/out  (exists: True)
step: create_app + lifespan startup
step: start uvicorn on 127.0.0.1:<port>
step: construct Pyloid window
step: pyloid.run() — entering main loop
```

Six router stubs returned 501 with the phase they land in.

**Known limitations carried into P1+:** No icon (`Icon is not set.` printed). Splash is still the generic VRL pattern — a brand pass is open (PLAN.md §13.6).

### ✅ P1 — Predict (Detection) · `v0.2-p1-predict-detect` · `2acd8f5`

**Phase deliverable:** drop a single image into `/predict`, pick a bundled YOLO detection model, see boxes overlay and per-class counts.

**Sub-phases:**

| # | Subject | Outcome |
|---|---|---|
| P1.1 | Sync `ml` extra + fetch weights | torch 2.12, ultralytics 8.4.51; yolo26/v8 nano + small downloaded (~53 MB) |
| P1.2 | Pin Python to 3.11 | `.python-version` tracked; dev & CI now match |
| P1.3 | Model registry | `engine/registry.py` — discovery + LRU cache + per-task defaults persisted to `defaults.json` |
| P1.4 | Inference engine | `engine/inference.py` — Ultralytics wrap, MPS auto-detect, JSON-safe result map |
| P1.5 | Wire endpoints | `/api/models`, `/api/models/{name}`, `/api/models/default`, `/api/inference/single` |
| P1.6 | Frontend lib + UI primitives | `lib/{api,types,utils}.ts` + `components/ui/{button,card,badge,slider,select,dropzone,spinner}.tsx` |
| P1.7 | `/models` page | Cards grouped by task, "Set as default" mutation |
| P1.8 | `/predict` page | Drop zone, task-filtered model picker, conf+IoU sliders, SVG box overlay, counts table |
| P1.9 | Verify end-to-end | `/api/inference/single` on `bus.jpg` → 1 bus + 3 persons on MPS |
| P1.10 | Commit + push + tag | `2acd8f5` + `v0.2-p1-predict-detect` |
| P1.fix-1 | Lazy lifespan + wait-for-backend | Pyloid window was racing uvicorn (ERR_CONNECTION_REFUSED on first launch). Moved registry scan + torch import out of FastAPI lifespan startup, added `_wait_for_backend` polling `uvicorn.Server.started` before `load_url`. Backend now ready in ~55 ms; first `/api/models` triggers the lazy scan and runs in ~1.7 s. |

**Verification:**

```
GET  /api/health           → 200 {status:ok, version:0.1.0, ...}
GET  /api/models           → 4 detection records, defaults={detect: yolo26n.pt}
POST /api/inference/single → 1 bus (0.92) + 3 persons (0.91 / 0.90 / 0.87) on MPS in 3.6 s cold
pnpm type-check            → clean
pnpm build (desktop)       → /predict 22.4 kB · /models 4.1 kB
```

**Known limitations carried into P2+:**
- Classification branch of `/api/inference/single` still returns 400 ("model is a classify model"). P2 lands it.
- Sliders don't live-update inference; user has to click "Run inference" again (live-update planned for P3 polish).
- No user-imported `.pt` flow yet — registry would pick it up if dropped into `~/Library/Application Support/VRL-YOLO-GUI/models/detect/`, but the UI import button still 501s (lands in P3).
- First inference of a fresh process is ~3-4 s while torch JITs the MPS graph; subsequent calls drop to 50-100 ms.

### ✅ P2 — Predict (Classification) · `v0.3-p2-predict-classify`

**Phase deliverable:** /predict task-switches based on the selected
model. Classification renders top-1 + top-5 with a review-threshold flag;
detection still works exactly as before.

**Sub-phases:**

| # | Subject | Outcome |
|---|---|---|
| P2.1 | Fetch classify weights | `scripts/fetch-models.py --task classify` pulled yolo26n/s-cls + yolov8n/s-cls (~37 MB) |
| P2.2 | Engine classify branch | `_run_classify` reads `result.probs.top5conf`; returns `ClassificationResult` dataclass |
| P2.3 | Schemas + router Union | `/api/inference/single` returns `DetectionResponse | ClassificationResponse` (discriminated union in OpenAPI) |
| P2.4 | Dynamic version | `vrl_yolo.__version__` reads `importlib.metadata.version("vrl-yolo-gui")`; bumped pyproject to 0.3.0 |
| P2.5 | Frontend types + api | Added `ClassificationResponse` + `InferenceResponse` union; `inferSingle` returns the union |
| P2.6 | /predict task-switch | View switches on `selectedTask`: classify hides IoU slider, shows top-1 banner + top-5 Recharts bar chart, surfaces "needs review" pill |
| CL.1 | Changelog source | `apps/web/lib/changelog.ts` — typed `RELEASES[]` with version / phase / tag / commit / features / fixes / known limitations |
| CL.2 | /changelog page + sidebar | Renders RELEASES; reads `/api/health` for the running version and highlights the matching card with "Running here" badge |
| CL.3 | CHANGELOG.md | Keep-a-Changelog format at repo root mirrors the TS data |

**Verification:**

```
step: start uvicorn on 127.0.0.1:52479
step: wait for backend on 127.0.0.1:52479
  backend ready in 114 ms

GET  /api/health              → 200 {status:ok, version:0.3.0, ...}
GET  /api/models              → 8 records (4 detect + 4 classify),
                                  defaults={detect: yolo26n.pt, classify: yolo26n-cls.pt}
POST /api/inference/single    → with yolo26n-cls.pt on bus.jpg:
                                  task=classify, top1=minibus (0.52),
                                  top5=[minibus, police_van, trolleybus, minivan, ambulance]
POST /api/inference/single    → with yolo26n.pt (regression):
                                  task=detect, 5 boxes, {bus:1, person:4}
GET  /changelog/              → 200
pnpm type-check               → clean
pnpm build (desktop)          → /changelog 4.86 kB · /predict 126 kB (Recharts)
```

**Known limitations carried into P3:**
- /predict still single-image. Folder batch is P3a.
- Sliders rerun on click only (live-update is P3 polish).
- User .pt import via UI still returns 501; `/api/models/import` (P3) will read `model.task` from the uploaded checkpoint and place it in `<storage_root>/models/<task>/`.
- No CSV / XLSX / PDF reports yet — P3b ships the task-aware report templates.

### ✅ P3a — Predict v1: batch + presets · `v0.4-p3a-predict-batch`

**Phase deliverable:** doctor drops a folder of slide patches, sees a
live progress bar, a per-image table, and an aggregate roll-up. Picking
a clinical preset prefills the right model + thresholds.

**Sub-phases:**

| # | Subject | Outcome |
|---|---|---|
| P3a.0 | Topbar version fix | `useLiveVersion()` reads `/api/health`; topbar shows `v0.4.0 · predict — batch & workflow presets` instead of hardcoded P0 string |
| P3a.1 | Backend presets | `engine/presets.py` — 9 typed `Preset` dataclasses across histopathology + hematology, detect + classify. `/api/presets` exposes them via Pydantic schema. |
| P3a.2 | Folder dropzone | `components/ui/folder-dropzone.tsx` — supports HTML5 directory drag + `<input webkitdirectory>`. Filters by extension, skips hidden + OS-metadata files; respects the `recursive` checkbox. |
| P3a.3 | Batch runner + hooks | `lib/batch.ts` runs `inferSingle` sequentially over the File list with cancel + per-file callbacks; concurrency=1 by design. `lib/hooks.ts` exposes the shared `useLiveVersion()`. |
| P3a.4 | /predict UI | Mode toggle (single / folder), preset picker grouped by domain, progress bar, per-image table (task-aware rows + "review" pill for classify), aggregate panel for both tasks, cancel button via `AbortController`. |

**Deliberate deviation from PLAN.md §6:**
The plan listed `/api/inference/batch` (POST + WS streaming) as the
backend surface. P3a runs the batch entirely client-side by calling
`/api/inference/single` N times — simpler, gives us cancel + progress
for free, and the registry's LRU cache means back-to-back single
requests hit warm weights anyway (~50 ms each on MPS once the model is
loaded). A proper streaming batch endpoint will land in P4 when Train
mode needs the same WebSocket plumbing.

**Verification:**

```
step: backend ready in 55 ms
GET  /api/health      → version 0.4.0
GET  /api/presets     → 9 records (5 hematology + 4 histopathology),
                        5 detect + 4 classify
GET  /predict/        → 200 (Pyloid + static export)
pnpm type-check       → clean
pnpm build (desktop)  → /predict 130 kB (+4 kB vs P2)
```

**Known limitations carried into P3b:**
- No CSV / XLSX / PDF report exports yet — P3b ships the templates.
- `/api/models/import` still 501; UI button stays disabled.
- Sliders rerun on click only; live-update is in P3b polish.
- Presets ship sensible defaults but assume the bundled COCO/ImageNet weights — point them at fine-tuned checkpoints for real clinical use.

### ✅ P3b — Predict v1: reports, import & settings · `v0.5-p3b-predict-reports`

**Phase deliverable:** doctor finishes a folder batch, clicks any row
to preview its predictions, exports CSV / XLSX / PDF, and can import
their own fine-tuned `.pt` checkpoint into the model library — all
without touching a terminal.

**Sub-phases (P3b plus the three user-requested extras):**

| # | Subject | Outcome |
|---|---|---|
| S.1 | Settings infrastructure | `lib/settings.ts` — typed `AppSettings` + `useSettings()` hook backed by `localStorage`. Cross-tab + cross-component sync via a custom event. SSR-safe default fallback. |
| S.2 | Sidebar Settings link + preset gating | New "Preferences" section in the sidebar with a Settings entry. `/predict` reads `show_presets` from `useSettings()` and only renders the `PresetPicker` when truthy. **Default: hidden** (user-requested; see memory `project_presets_revisit` for the re-open plan). |
| P3b.F1 | Folder image preview | `components/predict/batch-preview.tsx` — renders the selected file's image with detection boxes (detect) or top-5 mini-chart (classify). `BatchTable` accepts `selectedIndex` + `onSelect` and highlights the active row. Auto-selects the first successful result so the preview never sits empty. |
| P3b.R1 | Backend reports engine | `server/vrl_yolo/engine/reports.py` — task-aware CSV (per-image table), XLSX (per-image + aggregate sheets, with review-flag yellow highlight for classify rows below threshold), PDF (cover + summary + 3-col thumbnail grid + per-image table). ReportLab + OpenPyXL, both already in deps. |
| P3b.R2 | Report routes + schemas | `ReportRequest` / `ReportItemIn` + `routers/reports.py`. `POST /api/reports/{csv,xlsx,pdf}` return streaming responses with `Content-Disposition: attachment; filename=...`. PDF decodes optional base64 thumbnails. |
| P3b.R3 | Frontend export toolbar | `lib/report-export.ts` builds the request body (resizes thumbnails to 480 px JPEG for PDF, max 12 samples) and triggers a Blob download. Buttons live in `BatchTable`'s new `toolbar` slot. |
| P3b.M1 | User .pt import backend | `POST /api/models/import` — streams the upload to a temp file (500 MB cap), inspects via Ultralytics, rejects unsupported tasks, moves to `<storage_root>/models/<task>/`, re-scans the registry. Path traversal + filename sanitisation enforced. |
| P3b.M2 | Frontend Import button | `/models` page header now has an Import button (hidden file input + mutation). Success shows "Imported `<name>`"; backend errors surface verbatim. `['models']` query invalidates so the new card appears immediately. |

**Verification:**

```
step: backend ready in 55 ms
GET  /api/health           → version 0.5.0
GET  /api/presets          → 9 records (still shipped; hidden in UI by setting)
POST /api/reports/csv      → 200 · 175 bytes (proper headers + per-image rows)
POST /api/reports/xlsx     → 200 · 5.8 KB (Microsoft Excel 2007+; per-image + Aggregate sheet)
POST /api/reports/pdf      → 200 · 3.1 KB (PDF 1.4, 2 pages: cover/summary + per-image table)
POST /api/models/import    → 200 · ModelInfo for a copied yolo26n.pt (task=detect, 80 classes, source=user)
GET  /settings/            → 200 (new static route)
pnpm type-check            → clean
pnpm build (desktop)       → /settings 3.29 kB · /predict 133 kB · /models 7.39 kB
```

**Known limitations carried into P4:**
- Sliders still re-run on click only (live-update deferred again; lower priority than reports + import per user feedback).
- Workflow presets hidden by default. Revisit in P10 once a clinical demo checkpoint is bundled.
- PDF thumbnail grid caps at 12 samples per report (first 12 successful results). Curated selection will land alongside per-image flag annotations.
- No streaming batch WS endpoint yet — client-side iteration continues. Will be revisited when Train (P4) needs WS plumbing for live training metrics.

### ✅ P4a — Train (Detection) wizard · `v0.6-p4a-train-detect-wizard`

**Phase deliverable:** the user lands on `/train`, picks Object detection,
drops a dataset folder, sees split + class + warning stats, and tunes a
configure form pre-populated with the hardware's suggested batch size —
all without writing a single line of CLI.

**Sub-phases:**

| # | Subject | Outcome |
|---|---|---|
| P4a.1 | Backend dataset inspector | `server/vrl_yolo/engine/dataset.py` — `inspect_dataset()` auto-detects Roboflow YOLO / plain YOLO / COCO / Pascal VOC / ImageFolder; `write_uploaded_dataset()` streams uploads into `<storage_root>/datasets/<uuid>/` with path-traversal protection + 4 GB cap. |
| P4a.2 | Pydantic schemas | `DatasetSplitOut`, `DatasetInfoOut`, `HardwareInfo` added to `api/schemas.py`. |
| P4a.3 | Endpoints | `POST /api/datasets/inspect` (multipart with `webkitRelativePath`-shaped filenames), `GET /api/datasets/{id}` (rehydrate), `GET /api/hardware?task=&imgsz=` (returns kind/name/vram_gb/suggested_batch_size — heuristic in `engine/hardware.suggest_batch_size`). |
| P4a.4 | Train store (Zustand) | `apps/web/lib/train-store.ts` — typed `TrainState` (`selectedTask`, `dataset`, `hyperparams`) + `applyPreset()` + persist to `localStorage` so wizard state survives a reload. |
| P4a.5 | `/train` task picker | Two cards: Detection (active) and Classification (P5-gated). Resets the store on pick so a half-finished run can't leak into a new one. |
| P4a.6 | `/train/dataset` wizard | `FolderDropzone` (reused from Predict) → XHR upload with real progress bar + Cancel via `AbortController` → DatasetSummary card with per-split table + class chips + warnings. Continue button gated on detect task + known format. |
| P4a.7 | `/train/configure` form | Model picker (detect-only), preset chips (Quick/Standard/Best/Custom), image-size chips, batch-size slider tied to `/api/hardware`. HardwareCard sidebar + RunSummary card (steps/epoch + total steps). Auto-rehydrates the dataset on mount via `GET /api/datasets/{id}` so a refresh doesn't lose state. |

**Verification:**

```
step: backend ready in 53 ms
GET  /api/health                       → version 0.6.0
GET  /api/hardware                     → MPS, suggested_batch_size=8 (detect@640)
GET  /api/hardware?task=classify&imgsz=224  → suggested_batch_size=16
POST /api/datasets/inspect (Roboflow YOLO multipart)
                                       → format=roboflow_yolo, task=detect,
                                          classes=[positive,negative],
                                          splits=[train, valid]
GET  /api/datasets/{id}                → same payload (rehydrate)
GET  /train/                           → 200
GET  /train/dataset/                   → 200
GET  /train/configure/                 → 200
GET  /train/run/                       → 200 (P4b preview)
pnpm type-check                        → clean
pnpm build (desktop)                   → /train 3.15 kB · /train/configure 6.86 kB
                                          /train/dataset 6.19 kB · /train/run 2.9 kB
```

**Known limitations carried into P4b:**
- Training itself doesn't run yet — `/train/run` is a preview that shows the configured payload. P4b ships the subprocess + live metric WebSocket + results page with confusion matrix + "Save to library".
- Classification training is detected (ImageFolder summary shows up correctly) but the configure page is detection-only. P5 adds the classify branch.
- Plain YOLO datasets (no `data.yaml`) require manual class-naming on the configure page — currently we warn but there's no inline editor (lands with the run page in P4b).
- Multipart upload is the only way to ship a dataset right now. Native folder-picker bridge for desktop mode lands in P7.

### ✅ P4b — Train (Detection) local run · `v0.7-p4b-train-detect-run`

**Phase deliverable:** the doctor presses **Start training**, watches an
Ultralytics subprocess train against their dataset with live per-epoch
loss + mAP charts, can cancel mid-run, and on completion saves the best
checkpoint straight into the model library so `/predict` can use it on
the next slide patch.

**Sub-phases (P4b plus the user-requested class-name editor extra):**

| # | Subject | Outcome |
|---|---|---|
| P4b.E1 | Class-name editor (backend + UI) | `PATCH /api/datasets/{id}/classes` rewrites the dataset's `data.yaml` (preserving key order, embedding the new list, refusing length-mismatched / empty / duplicate names). New `components/train/class-names-editor.tsx` renders one input per class, highlights `class_<N>` placeholders in amber, validates client-side before submit, fires a single Apply call. Wired into `/train/configure` above the model + preset card. |
| P4b.1 | Training engine | `engine/train_runner.py` — subprocess entry script invoked as `python -m vrl_yolo.engine.train_runner ...`. Registers `on_fit_epoch_end` callback that emits JSON-line events (`{_VRL_EVENT: true, type, ...}`) to stdout. Cross-version metric-key probes for `train/{box,cls,dfl}_loss` + `metrics/mAP50(B)` / `metrics/mAP_0.5` so the same UI works across Ultralytics 8.3 / 8.4. `exist_ok=True` on `model.train()` so the JobManager-precreated output directory is reused (Ultralytics would otherwise auto-suffix to `<name>-2/`). |
| P4b.2 | Job manager | `engine/training.py` — `JobManager` singleton with `TrainingJob` dataclass tracking events / status / metrics. `start()` spawns `subprocess.Popen` with `start_new_session=True` (POSIX) or `CREATE_NEW_PROCESS_GROUP` (Windows). Reader thread tails stdout, classifying lines as JSON events vs raw log via `_classify_line()`. `cancel()` sends SIGTERM to the process group. `save_to_library()` copies `best.pt` to `registry._user_dir/detect/trained-<short_id>.pt` and triggers `registry.scan()`. Lifespan + deps wire it on `app.state.job_manager`. |
| P4b.3 | Routes | `POST /api/training/start` (202 + job_id), `GET /api/training/{id}` (snapshot), `POST /api/training/{id}/cancel` (204), `POST /api/training/{id}/save-to-library` (returns the registered ModelInfo), `WS /api/training/{id}/stream` (replays events + polls every 300 ms until terminal). |
| P4b.4 | Frontend types + state + actions | New `TrainingStatus` / `TrainingMetrics` / `TrainingJobInfo` / `StartTrainingBody` / `TrainingEvent` (discriminated union) in `lib/types.ts`. `startTraining`, `getTrainingJob`, `cancelTraining`, `saveTrainingToLibrary`, `trainingStreamUrl`, `renameDatasetClasses` in `lib/api.ts`. `activeJobId` + `setActiveJob` added to the Train store (persisted, so a refresh on `/train/run` picks up the live stream). |
| P4b.5 | /train/configure start mutation | "Continue → Run training" became "Start training": calls `startTraining`, stores `job_id` in the store, navigates to `/train/run`. Errors surface inline above the button. |
| P4b.6 | /train/run live page | Replaced the P4a preview placeholder with the full live UI: status badge with WebSocket connection indicator, epoch progress bar, two Recharts `LineChart`s side-by-side (loss curves vs mAP curves, with `connectNulls` so per-version key gaps don't break the line), scrolling 200-line log tail, action bar that swaps between Cancel (running) → Save to library (completed) → Open in Predict (after save) + Train another (terminal). |

**Verification:**

```
step: backend ready in 64 ms
GET  /api/health                          → version 0.7.0
PATCH /api/datasets/{id}/classes          → 200 (renames in data.yaml only;
                                              label files reference IDs, not names)
POST /api/training/start                  → 202 {job_id: "<uuid>"}
GET  /api/training/{job_id}               → TrainingJobInfo (running, epoch_current ticks up)
WS   /api/training/{job_id}/stream        → hello → start → epoch×N → complete → closed
POST /api/training/{job_id}/save-to-library
                                          → 200 ModelInfo {name: "trained-<short>.pt",
                                                            source: "user", task: "detect"}
GET  /api/models                          → trained checkpoint listed alongside bundled weights
pnpm type-check                           → clean
pnpm build (desktop)                      → /train 3.18 kB · /train/configure 10.6 kB
                                              /train/dataset 5.55 kB · /train/run 11.6 kB
```

End-to-end smoke: 4-image dataset, 1 epoch, YOLO26n on Apple Silicon MPS, 30 s wall-clock from Start to Save-to-library.

**Known limitations carried into P5:**
- Loss metrics (box / cls / dfl) come through as `null` on some Ultralytics builds where they live under different keys than the validation mAPs. Chart connects across nulls; the dropped keys are silent rather than crashing the stream.
- Training jobs are in-memory only — restarting uvicorn (e.g. `run-desktop --clean`) loses the snapshot. The on-disk `<storage_root>/training/<job_id>/` run artefacts survive, so `best.pt` is reachable manually.
- Classification training is still detection-only at the UI level; P5 adds the classify branch (`task=classify` ImageFolder + top-1 / top-5 metric streams).
- Colab tunnel handoff (PLAN.md §11) lands in P4c — when no accelerator is detected, the wizard currently still lets you start a CPU run instead of suggesting Colab.

### ✅ P5 — Train (Classification) · `v0.8-p5-train-classify`

**Phase deliverable:** the same wizard the doctor used in P4a/P4b for detection now runs end-to-end for classification — drop an ImageFolder, watch live top-1 / top-5 accuracy curves alongside training loss, save the trained `.pt` into the model library, and run it on slide patches in `/predict`. Detection still works exactly as before.

**Sub-phases:**

| # | Subject | Outcome |
|---|---|---|
| P5.1 | Plan + survey | Read P4a/P4b code paths (`train_runner`, `training`, `train-store`, `/train`, `/train/configure`, `/train/run`, `save_to_library`); locked in additive shape (no detect regressions) and per-task UI branching. |
| P5.2 | `engine/train_runner.py` classify branch | Added `--task` arg (default detect). Classify probes `metrics/accuracy_top1`, `metrics/accuracy_top5`, and `train/loss` (with `train/cls_loss` fallback for 8.4+). `_resolve_data_arg()` returns the dataset root for classify (Ultralytics' ImageFolder convention) instead of `data.yaml`. Existing detect path unchanged. |
| P5.3 | `engine/training.py` + `routers/training.py` + `api/schemas.py` | `JobMetrics` gained nullable `loss` / `top1` / `top5`; `TrainingJob` gained `task`. `start()` accepts `task`, validates the dataset shape per task (data.yaml vs ImageFolder), and pre-creates `<output_dir>/<job_id>/`. `save_to_library()` routes by `job.task` (was hard-coded detect). The router dropped the "classify lands in P5" 400 gate, threads `task` from the registry, and `_job_to_info()` mirrors the snapshot's task. `TrainingMetrics` + `TrainingJobInfo` schemas mirror the new fields. |
| P5.4 | Frontend types + train-store | `TrainingMetrics` gains classify fields; `TrainingJobInfo` carries `task`; `TrainingEvent.start` carries `task`. `PRESET_DEFAULTS` becomes `Record<Task, Record<Preset, …>>` so classify uses 224px instead of 640. `setTask()` re-seeds epochs + imgsz when the user switches detect ↔ classify. |
| P5.5 | `/train` + `/train/dataset` | Classification card on `/train` is no longer disabled. The dataset summary's "P5 / detection-only" amber footer is gone; instead, Continue is blocked only on `selectedTask ≠ dataset.task` (with copy explaining the mismatch). ImageFolder inspector warnings rewritten to surface useful issues (missing val/, single-class). |
| P5.6 | `/train/configure` | Model picker filters by `selectedTask`. ClassNamesEditor is detect-only (ImageFolder dir names ARE the classes). Image-size chips swap to classify ladder (96/128/160/192/224/256/288/320/384). Hardware probe re-fetches with `task=classify`. |
| P5.7 | `/train/run` charts | Renders `ClassifyLossChart` + `ClassifyAccuracyChart` (top-1/top-5 on a 0..1 axis) when `snapshot.task === "classify"`; detection still shows the existing Loss + mAP charts. `formatMetrics()` extended to log classify keys. Save-to-library uses the model's reported task to set the right per-task default. |
| P5.8 | End-to-end smoke | Built a 2-class (bus / zidane) × 8-image ImageFolder + matching val/ split. JobManager → train_runner → save_to_library completed in ~12 s on MPS; `top1=0.25 / top5=1.0` after 1 epoch; saved checkpoint landed at `<storage_root>/models/classify/trained-<short>.pt`; registry rescan recognised it as `task=classify` with the right class names. |

**Verification:**

```
step: backend ready in ≈55 ms
GET  /api/health                         → version 0.8.0
POST /api/datasets/inspect (ImageFolder) → format=imagefolder, task=classify,
                                            classes=[bus, zidane],
                                            splits=[train(16), val(16)],
                                            warnings=[]
GET  /api/hardware?task=classify&imgsz=224
                                         → MPS, suggested_batch_size=16
POST /api/training/start (classify)      → 202 {job_id: "<uuid>"}
GET  /api/training/{job_id}              → TrainingJobInfo with task=classify,
                                            metrics{loss, top1, top5}
WS   /api/training/{job_id}/stream       → hello → start(task=classify) →
                                            epoch(top1=0.25, top5=1.0) →
                                            complete → closed
POST /api/training/{job_id}/save-to-library
                                         → 200 ModelInfo {name: "trained-<short>.pt",
                                                            source: "user",
                                                            task: "classify"}
GET  /api/models                         → trained classify checkpoint listed alongside
                                            bundled yolo*-cls.pt weights
pnpm type-check                          → clean
pnpm build (desktop)                     → /train 3.23 kB · /train/configure 8.05 kB
                                            /train/dataset 6.03 kB · /train/run 11.9 kB
```

End-to-end smoke: 16-image + 16-val ImageFolder, 1 epoch, YOLO26n-cls on Apple Silicon MPS, ~12 s wall-clock Start → Save-to-library.

**Known limitations carried into P6:**
- Classification training reports `train/loss` as `null` on some Ultralytics 8.4+ builds where the value sits under `train/cls_loss` only after the validation pass. The chart connects across nulls; the dropped points are silent rather than crashing the stream.
- Confusion matrix + per-class precision/recall reports for classify are P7-polish — the run page shows live top-1/top-5 but doesn't yet render a confusion grid at completion.
- Multi-tenant training is still out of scope; one in-flight job per JobManager.
- Colab tunnel handoff for classify (PLAN.md §11) lands in P6 alongside detect.

### ⚠️ P5.fix-1 — macOS Cmd+Q event-filter shutdown · `v0.8.1` · `543b40d` (superseded by P5.fix-2)

**Trigger:** v0.7.1 (and v0.8.0) crashed on Cmd+Q with `EXC_BAD_ACCESS / KERN_INVALID_ADDRESS at 0x0` in `QSurface::~QSurface` → `QOpenGLContext::currentContext()` → `QThreadStorageData::get()`, deep inside `__cxa_finalize_ranges` triggered by `-[NSApplication terminate:]`. Frame-for-frame identical to the documented crash in [`python-pyloid-desktop-packaging` skill §macOS quit-time crash](file:///Users/atultiwari/.claude/skills/python-pyloid-desktop-packaging/SKILL.md).

**Why the existing workaround was insufficient on macOS 26.x:** v0.7.1 already shipped the skill's prescribed `aboutToQuit → os._exit(0)` hook (`src-pyloid/main.py:121-164`), but the crash trace showed the hook never ran. Reading the actual stack:

1. Menu Cmd+Q → `-[NSApplication terminate:]` (frame 74).
2. Qt's Cocoa platform sends `QEvent::Quit` to `QApplication` → `tryCloseAllWidgetWindows` (frames 60-59).
3. Pyloid's `BrowserWindow.closeEvent` fires (frame 41) and calls `QCoreApplication.quit()` from Python (frame 35).
4. On macOS, `quit()` routes back through `libqcocoa` and **re-enters `[NSApplication terminate:]` recursively** (frame 33).
5. The second terminate proceeds straight to libc `exit()` (frame 30) — never unwinding back to `QCoreApplication::exec()`'s cleanup pass, which is the only place that emits `aboutToQuit`.
6. `__cxa_finalize_ranges` runs deferred `deleteLater` from Pyloid's closeEvent → WebView destructor → `QSurface::~` → null deref.

**Fix:** intercept one level earlier. Install a `QApplication`-level event filter that catches `QEvent::Quit` before `QApplication::event` hands it to `tryCloseAllWidgetWindows`, and `os._exit(0)` immediately. We never run any closeEvent, never re-enter terminate, never reach `__cxa_finalize_ranges`. Kept the `aboutToQuit` connection as a fallback for paths that DO unwind through `exec()` (e.g. SIGTERM signal handlers calling `app.quit()` from a normal context). Module-level reference (`_quit_event_filter`) keeps the `QObject` alive past the install function's stack frame — Qt holds a raw pointer via `installEventFilter`, and CPython would otherwise free it on return.

**Sub-phases:**

| # | Subject | Outcome |
|---|---|---|
| P5.fix-1.1 | Event-filter intercept | Replaced `aboutToQuit`-only hook in `src-pyloid/main.py` with a `_QuitEventFilter(QObject)` + `aboutToQuit` fallback. Filter handler `os._exit(0)`s on `QEvent.Type.Quit` after flushing stdio. |
| P5.fix-1.2 | Version bump + docs | Bumped pyproject to 0.8.1, prepended changelog.ts entry (current), flipped 0.8.0 to shipped, mirrored CHANGELOG.md, updated PHASE-STATUS.md + CLAUDE.md ticklist. |
| P5.fix-1.3 | Commit + push + backfill | `fix(p5.fix-1)` commit + push; release workflow auto-rebuilds mac-arm64 + win-x64 binaries; `chore: backfill SHA` follow-up. |

**Carried-forward:**
- In-flight training subprocess does not receive a SIGTERM before the parent exits via `os._exit(0)` — the child is reparented to launchd and runs to completion or is reaped by the OS. Plumbing a graceful job-group shutdown before the hard exit lands in a follow-up.
- The upstream `python-pyloid-desktop-packaging` skill should be updated to reflect the re-entrant-terminate path observed here so other Pyloid projects don't repeat the same incomplete workaround.

**Regression:** the binary built from this fix booted (download handler ran, Pyloid logged "Icon is not set."), then exited silently before reaching `pyloid.run()`. Diagnosed and replaced in P5.fix-2 below.

### ✅ P5.fix-2 — Window-scoped close filter · `v0.8.2` · `5bc93cc`

**Trigger:** v0.8.1 (P5.fix-1) made the app worse — it stopped reaching `pyloid.run()` at all on macOS, exiting silently between `pyloid.create_window` and the main loop.

**Diagnosis (local repro, no GitHub Actions needed):**

1. Tail of `~/Library/Application Support/VRL-YOLO-GUI/logs/launch.log` from the v0.8.1 binary showed three back-to-back launches all ending at the same point — after `step: download handler installed (...)` and Pyloid's `Icon is not set.` print, but BEFORE `step: pyloid.run() — entering main loop`. The v0.7.1 launch on the same machine printed the next two lines. Code-diff between the two builds was scoped to the new `_install_macos_shutdown_workaround()`.
2. Reproduced the silent exit in dev with `PYTHONUNBUFFERED=1 uv run --extra ml --extra desktop python -u src-pyloid/main.py`. Same launch.log tail. Crash was not in the bundling layer.
3. Bisected by commenting out the single `app.installEventFilter(...)` line while keeping every other change. Startup recovered immediately. The QApplication-wide event filter was the cause.
4. A `python3.11-*.ips` crash report from the pre-bisect run pinpointed the actual fault: `PySide::typeName(QObject const*) + 36` deref'd null inside `QObjectWrapper::eventFilter` → `sendThroughApplicationEventFilters`. PySide6 6.9 can't always resolve the Python wrapper for events flowing through app-wide filters during QWebEngineView construction, and a missing wrapper segfaults inside Shiboken.

**Fix:** scope the filter to the actual `QMainWindow` instead of the QApplication.

| # | Subject | Outcome |
|---|---|---|
| P5.fix-2.1 | Replace app-wide `QEvent::Quit` filter with window-scoped `QEvent::Close` filter | `_install_macos_shutdown_workaround(window)` now takes the Pyloid window, walks `window._window._window` up to four nested `_window` attributes looking for the real `QMainWindow`, and installs a `QObject` event filter on THAT object. Catches `QEvent::Close` (arrives at the QMainWindow during `tryCloseAllWidgetWindows`, before Pyloid's `closeEvent` runs) and `os._exit(0)`s — same close-cascade interception as fix-1, without app-wide event flow. Keeps the `aboutToQuit` fallback. Added defensive launch.log prints at every step so a future Pyloid version that reshapes the wrapper is one log-tail away. |
| P5.fix-2.2 | Env-gated auto-quit test hook | Added `_maybe_install_auto_quit_for_test()` — when `VRL_YOLO_GUI_TEST_AUTO_QUIT_S=N` is set, schedules a `QApplication.quit()` N seconds after the main loop starts. Lets the close path be exercised in dev without sending real Cmd+Q. No-op when env var unset; ships in the binary so clinicians filing a close bug can be asked to run with it set. |

**Verification (local dev):**

```
$ PYTHONUNBUFFERED=1 VRL_YOLO_GUI_TEST_AUTO_QUIT_S=4 uv run --extra ml --extra desktop python -u src-pyloid/main.py
step: import pyloid
...
step: construct Pyloid window
step: download handler installed (Downloads dir: /Users/atultiwari/Downloads)
Icon is not set.
step: macOS shutdown workaround installed (QEvent::Close filter on QMainWindow + aboutToQuit fallback)
step: TEST auto-quit scheduled in 4.0s via QApplication.quit()
step: pyloid.run() — entering main loop
step: TEST timer fired — calling QApplication.quit()
step: QEvent.Close intercepted — bypassing static-destructor crash via os._exit
# process exits cleanly; no new crash report in ~/Library/Logs/DiagnosticReports/
```

**Carried-forward:**
- Same as P5.fix-1: in-flight training subprocess does not receive a SIGTERM before `os._exit(0)`. Follow-up.
- The 4-deep `_window` walk is a band-aid for Pyloid's internal nesting depth. If a future Pyloid release changes that, the launch.log prints `macOS shutdown workaround skipped — could not locate underlying QMainWindow on 'BrowserWindow'` and the old crash returns. Worth a heads-up before any Pyloid bump.
- Upstream `python-pyloid-desktop-packaging` skill now needs TWO updates: (a) `aboutToQuit` alone is insufficient on macOS 26.x with Pyloid 0.27, (b) NEVER install an event filter on QApplication when QWebEngineView is in play — use a window-scoped filter instead.

### ✅ P5.fix-3 — Flat ImageFolder + classify splitter + layout examples · `v0.8.3` · `72dc1db`

**Trigger:** the first real classification dataset (a 3-class lung-pathology subset at `/Users/atultiwari/Downloads/Projects/Datasets/lung_colon_image_set/lung_partial`) failed to import. The folder structure was `lung_partial/{lung_aca,lung_n,lung_scc}/*.jpeg` — class subfolders directly under the root, no `train/` wrapper. v0.8.0–v0.8.2's inspector required the `train/<class>/*` layout exclusively, so the flat layout fell through to "Unknown layout" and the Continue button was permanently gated off.

**Two-pronged fix** (the gap was both code and UX):

| # | Subject | Outcome |
|---|---|---|
| P5.fix-3.1 | Backend: recognise flat ImageFolder + add classify splitter | `engine/dataset.py::_try_imagefolder` split into two helpers — `_imagefolder_split_layout` (existing `train/<class>/`) and `_imagefolder_flat_layout` (new: `<class>/*` direct under root). Flat layout returns a single "all" pseudo-split + warning saying training needs the splitter to run first. Added `split_imagefolder(root, train_ratio, valid_ratio, test_ratio, seed)` that stratifies per class and stages into `train/<class>/`, `val/<class>/`, optionally `test/<class>/` — same staging-dir safety as `split_dataset`. `POST /api/datasets/{id}/split` now dispatches on `dataset.task` so the same endpoint handles both flavours. |
| P5.fix-3.2 | Frontend: layout examples + classify-aware split modal | New `LayoutExamplesCard` on `/train/dataset` — collapsible, default-open, persists state via `localStorage`. Shows 4 concrete ASCII trees (Roboflow YOLO, plain YOLO, flat ImageFolder, split ImageFolder) with per-layout descriptions and "what to do next" hints. `needsSplitting()` extended to flag flat ImageFolder (single "all" split) and classify split-layouts missing val/. `SplitModal` copy switches per task: detect users see `data.yaml` rewrite copy, classify users see `train/<class>/` / `val/<class>/` paths and the warning that classify mode refuses to start without val. Fixed `totalPairs` collapsing to 0 for classify (was using `Math.min(image_count, label_count)`; ImageFolder splits have `label_count: 0`). |
| P5.fix-3.3 | End-to-end test against lung_partial | Copied the user's actual dataset to a temp dir, ran inspect → split → re-inspect → real 1-epoch YOLO26n-cls training via in-process `JobManager`. All four steps passed: inspector correctly tagged flat ImageFolder with 3 classes × 10 images each, splitter stratified into train=8+val=1+test=1 per class (24/3/3 total), Ultralytics consumed the rearranged layout and emitted `top1=0.33 / top5=1.00`. |

**Verification (against `/Users/atultiwari/Downloads/Projects/Datasets/lung_colon_image_set/lung_partial`):**

```
=== Inspect (flat) ===
format = imagefolder
task   = classify
classes = ('lung_aca', 'lung_n', 'lung_scc')
class_counts = {'lung_aca': 10, 'lung_n': 10, 'lung_scc': 10}
splits = [('all', 30)]
warnings:
  - Flat ImageFolder layout — class folders at the root. Use Prepare
    splits to stage into train/val/test before training ...

=== split_imagefolder 80/10/10 ===
splits = [('train', 24), ('val', 3), ('test', 3)]
on-disk:
  train/: {'lung_aca': 8, 'lung_n': 8, 'lung_scc': 8}
  val/:   {'lung_aca': 1, 'lung_n': 1, 'lung_scc': 1}
  test/:  {'lung_aca': 1, 'lung_n': 1, 'lung_scc': 1}

=== classify training (YOLO26n-cls @ 64px, 1 epoch, MPS) ===
status: completed
metrics: top1=0.333, top5=1.000
best_pt: <storage>/training/<job>/weights/best.pt
```

**Carried-forward:**
- Layout examples are static ASCII trees. A future polish pass could swap for SVG or render real previews of the user's dropped folder.
- Splitter is all-or-nothing: it merges ALL source images (flat + any pre-existing splits) and re-shuffles. If a user wants to PRESERVE a hand-curated train/val and just generate a missing test, they can't. Acceptable for v1; revisit if pilot feedback asks.

### ✅ P5.fix-4 — Subprocess env-var dispatch · `v0.8.4` · `a86da1b`

**Trigger:** v0.8.3 binary shipped a working classify dataset wizard, but pressing **Start training** in the `.app` produced two symptoms:

1. A second Pyloid window opened on the screen (sometimes briefly, sometimes lingering).
2. The training page showed `Epoch 0 / 5 · 0.0%` indefinitely with "Waiting for first epoch…" under both charts. WebSocket said `running ws · live` but no events ever arrived.

**Root cause:** `JobManager.start()` spawned the training subprocess with:

```python
cmd = [sys.executable, "-m", "vrl_yolo.engine.train_runner", ...]
```

In dev mode `sys.executable` is `python3.11` and `-m vrl_yolo.engine.train_runner` works. **In the frozen `.app`, `sys.executable` is the bundle's main binary, and PyInstaller's bootloader does not honour `-m module` — it always runs the originally-bundled entry script.** So the subprocess re-launched `main.py` → Pyloid window #2 (visible bug 1). The runner never ran, no JSON events were emitted on stdout, the parent JobManager's reader thread waited forever (visible bug 2). Both v0.7.x detect training and v0.8.x classify training had this bug; the user just hadn't exercised training inside the `.app` until now.

**Fix:** env-var sentinel + frozen-aware cmd shape.

| # | Subject | Outcome |
|---|---|---|
| P5.fix-4.1 | `_maybe_dispatch_subprocess()` in main.py | Reads `VRL_YOLO_GUI_SUBPROCESS` after `multiprocessing.freeze_support()`. When set to `"train_runner"`, imports `train_runner.main` lazily and `raise SystemExit(runner_main())` — never reaches Pyloid boot. Defensive `--multiprocessing-fork` argv check to avoid mis-dispatching real mp workers if a future CPython changes freeze_support timing. |
| P5.fix-4.2 | JobManager spawn rewrite | Cmd is now `[sys.executable, *entry_args, --dataset, ...]` where `entry_args = [str(_MAIN_PY)]` in dev and `[]` in frozen. `_child_env()` sets `VRL_YOLO_GUI_SUBPROCESS=train_runner` unconditionally. `_MAIN_PY` resolved once at module load from `Path(__file__).resolve().parents[3] / "src-pyloid" / "main.py"`. |
| P5.fix-4.3 | End-to-end repro | Two smokes in dev, both passing. Classify against `lung_partial`: spawn → start/epoch/complete events streamed → `top1=0.333, top5=1.000`. Detect regression against a tiny synthetic dataset: same — start/epoch/complete events → `mAP50=0.0` (1 fake box, 1 epoch, expected) → status=completed. The dev path now exercises the SAME dispatch the frozen `.app` will hit, so a regression in either mode is caught locally before binary build. |

**Carried-forward:**
- Same training-subprocess-orphan-on-Cmd+Q gap as P5.fix-1 through P5.fix-3. **Closed in P5.fix-5 below.**
- The `parents[3]` walk in dev mode is fragile if the repo layout ever shifts. We raise a clear `RuntimeError("src-pyloid/main.py not found at ...")` at training-start time if the path is wrong, but the better long-term fix is to plumb the entry path through Settings at app startup so JobManager doesn't have to guess.

### ✅ P5.fix-5 — Graceful job cancel on Cmd+Q · `v0.8.5` · `9159d0e`

**Trigger:** the macOS Cmd+Q workaround shipped in P5.fix-2 (`QEvent::Close` filter → `os._exit(0)`) is intentionally abrupt — it has to be, to dodge the QSurface / QThreadStorage static-destructor crash. But `os._exit` skips Python's atexit chain, which means an in-flight training subprocess (spawned with its own session/process group, per P4b) gets reparented to `launchd` and keeps running. CPU/RAM/MPS stay pinned for the rest of the run, `best.pt` writes silently, and the user — who thought Cmd+Q cancelled training — gets no save-to-library prompt and no UI thread to see the orphan from. Flagged as "carried-forward" in every release from v0.8.1 onward; this fix closes it on macOS.

**Fix:** plumb the FastAPI app through to the close-event filter, walk active jobs, SIGTERM each, wait briefly, then hard-exit.

| # | Subject | Outcome |
|---|---|---|
| P5.fix-5.1 | New `_cancel_active_jobs_best_effort(fastapi_app, timeout_s=3.0)` helper in `src-pyloid/main.py` | Pulls `app.state.job_manager`, filters to `status in {queued, running}`, calls `job_manager.cancel(job_id)` on each (which already does the right thing per-OS — `os.killpg(SIGTERM)` on POSIX, `CTRL_BREAK_EVENT` on Windows). Polls every 100 ms until all jobs leave running/queued, capped at `timeout_s`. All errors are swallowed and step-logged because this runs inside the close-event filter and an unhandled exception would re-enter the close cascade. |
| P5.fix-5.2 | `_install_macos_shutdown_workaround(window)` → `(window, fastapi_app)` | Signature grew a second parameter so the close filter can reach the JobManager. Renamed parameter to `fastapi_app` so it doesn't shadow the existing `app = QApplication.instance()` local. Both the `QEvent::Close` filter and the `aboutToQuit` fallback now call `_cancel_active_jobs_best_effort(fastapi_app)` immediately before `_macos_hard_exit(...)`. |
| P5.fix-5.3 | Smoke verified | `PYTHONUNBUFFERED=1 VRL_YOLO_GUI_TEST_AUTO_QUIT_S=4 uv run --extra ml python src-pyloid/main.py` → `step: TEST timer fired — calling QApplication.quit()` → `step: QEvent.Close intercepted — bypassing static-destructor crash via os._exit`. No active jobs → cancel helper is a no-op → exit code 0. The install + intercept chain is unregressed; the full cancel-then-exit path with real jobs requires a training run, planned as part of tomorrow's thorough test. |

**Carried-forward:**
- Linux / Windows still orphan the training subprocess on app quit. Pilot is macOS-only; revisit when we ship for those platforms.
- Skill `python-pyloid-desktop-packaging` still doesn't document this pattern — tracked separately as carry-forward item #2. **Closed 2026-05-19 — skill updated in place.**

### ✅ P5.fix-6 — Preserve existing splits in the splitter · `v0.8.6` · `c5ae06e`

**Trigger:** carry-forward item #3. Up to v0.8.5, `split_dataset` (detect) and `split_imagefolder` (classify) gathered every image from anywhere under the dataset root, shuffled by seed, and redistributed — destroying any hand-curated train/val/test assignments. A user with a Roboflow export who just wanted to add a test split couldn't, and a clinical-research user who placed the hardest cases in `val/` on purpose lost that curation as soon as Prepare splits ran. Flagged in v0.8.3 docs as Option A's "Preserve existing splits" toggle; deferred at the time because pilot exposure was unclear.

**Fix:** add a `preserve_existing` flag end-to-end (backend splitter → API schema → frontend lib → modal UI), plus a typed `unassigned_image_count` on `DatasetInfoOut` so the frontend can tell whether Preserve has anything flat to redistribute in a mixed layout.

| # | Subject | Outcome |
|---|---|---|
| P5.fix-6.1 | Splitter internals tag each image with its current split | `_find_image_label_pairs` returns `(img, lbl, current_split)` tuples; `_collect_imagefolder_images` returns `dict[class, list[(path, current_split)]]`. Both share `_existing_split_for(img, root, val_output_name=...)` which walks path components looking for `train` / `valid|val|validation` / `test`. The `val_output_name` parameter lets the detect splitter normalise to `valid` and the classify splitter to `val`, matching each task's output convention. |
| P5.fix-6.2 | `split_dataset` and `split_imagefolder` take `preserve_existing: bool = False` | When True: partition pairs into preserved (current_split in {train, valid/val, test}) vs flat (None); the flat pool gets shuffled + distributed per ratios; preserved pairs keep their original split. Classify keeps per-class stratification but applies it to each class's flat pool, with the same `max(1, ...)` train-minimum guarantee per class. If `total_flat == 0` after partitioning, raise `ValueError("preserve_existing=True but every image is already in a split — nothing to redistribute. Uncheck Preserve to reshuffle from scratch.")` so the API can 400 cleanly. |
| P5.fix-6.3 | API surface: `SplitDatasetRequest.preserve_existing` + DatasetInfoOut `unassigned_image_count` | The schema field forwards through the route to the splitter. The new `unassigned_image_count` is populated by `_imagefolder_split_layout` (scans non-reserved sibling dirs) and `_inspect_roboflow_yolo` (scans `<root>/images/`) so a mixed layout reports correctly. Default 0 means "either pure-flat" or "pure-split"; both inspector paths that don't hit a mixed case leave it at the default. |
| P5.fix-6.4 | Frontend SplitModal | New checkbox above sliders. Default ON when the dataset has any recognised split, OFF for a flat layout. When ON: slider labels show `Train (X preserved + Y new = Z images)`; Split button disabled with hint if `flatCount === 0` (computed from `unassigned_image_count` + any non-standard splits). When OFF: behaviour identical to v0.8.5. Test row gets the same preserved-vs-new breakdown. Type added to `lib/types.ts::DatasetInfo` as optional so older API responses don't fail validation. |
| P5.fix-6.5 | End-to-end smoke | 7-case battery in dev: classify (pure flat / pure split / mixed preserve / pure-split preserve raises), detect (pure flat / mixed preserve / pure-split preserve raises). All pass. FastAPI TestClient verified `unassigned_image_count=6` on both detect and classify mixed layouts, and that preserve=True with no flat returns a 400 with the helpful detail string. Frontend `tsc --noEmit` is clean. |

**Carried-forward:**
- The splits view on `/train/dataset` still doesn't surface the unassigned image count outside the Prepare-splits modal. A user with a mixed layout sees `train: 10 · val: 4` on the page and might not realise 6 flat images exist. Not blocking pilot; small follow-up if pilot feedback flags it.
- Preserve doesn't carve a test split out of an existing train+val pair (a different semantic operation entirely; out of scope here).

### ✅ P5.fix-7 — Bundle our own dist-info (version badge fix) · `v0.8.7` · `400ba79`

**Trigger:** the top-right version badge in the bundled `.app` displayed `v0.0.0+source` instead of the real shipped version (`v0.8.6` at the time of the report). User caught it while clicking through the dataset wizard on the freshly-installed v0.8.6 build at 2026-05-19 ~22:20 IST.

**Root cause:** `_resolve_version()` in `server/vrl_yolo/__init__.py` reads the live version via `importlib.metadata.version("vrl-yolo-gui")` and falls back to `"0.0.0+source"` on `PackageNotFoundError`. In a PyInstaller-bundled `.app`, our package's source is bundled (via `--collect-submodules vrl_yolo`) but **the `dist-info` metadata isn't** — PyInstaller's submodule collection doesn't carry it. So at runtime, `importlib.metadata.version` raised `PackageNotFoundError` and the badge fell back to the placeholder. Confirmed on the user's installed v0.8.6 build by checking `Contents/Frameworks/` — every third-party dep had a `*.dist-info` directory; ours didn't. `Info.plist`'s `CFBundleShortVersionString` was always correct (PyInstaller writes it from the build-time read of `pyproject.toml`); the gap was only at the FastAPI / topbar runtime read.

**Fix:** add `--copy-metadata vrl-yolo-gui` to the PyInstaller invocation in `scripts/build-release.py`. The flag explicitly bundles the named distribution's metadata even when the package was installed via `--collect-submodules` rather than from a normal dist-info-shipping wheel. One-line build-script change. Dev mode (`uv run python src-pyloid/main.py`) was already correct because uv installs the package editably with full dist-info — only frozen builds were affected.

| # | Subject | Outcome |
|---|---|---|
| P5.fix-7.1 | Add `--copy-metadata vrl-yolo-gui` to `pyinstaller_args()` | Inserted right after `--collect-submodules vrl_yolo` with an inline comment explaining the gap. No other build-script changes. |

**Carried-forward:** none. The earlier v0.8.5 / v0.8.6 binaries on existing installs will still show the wrong badge — there's no in-app remediation, the user has to reinstall from v0.8.7 onward to see the fix.

---

## Up next: P6 — Train on Colab

**Estimated 1.5 weeks** per PLAN.md §14. Scope:

- New `engine/colab.py` — Cloudflare-tunnel client + Drive sync, modelled on the `yolo-gui` reference project.
- `/train/configure` gains a "Run on Colab" toggle when no local accelerator is detected (instead of letting the user kick off an overnight CPU run by accident).
- Companion notebooks under `notebooks/` (detect + classify pairs) train on the user's own Drive, mount Cloudflare tunnel, hand the live metric stream back to the desktop app over the existing WebSocket protocol so `/train/run` works unchanged.
- Save-to-library pulls `best.pt` from Drive into `<storage_root>/models/<task>/`.

**Phase tag at completion:** `v0.9-p6-train-colab`.

---

## Update protocol (for future Claude sessions)

When a phase boundary is reached:

1. Run the verification proof for the phase. Capture the relevant lines into the phase's section.
2. Flip the row in the **Snapshot** table from ⏳ → ✅ with the commit short SHA and tag name.
3. Append a new section under "Completed phases" with sub-phases table, verification block, and **known limitations carried into the next phase**.
4. Update the **Up next** section to point at the next phase's scope (copy from PLAN.md §14, refine where the plan has slipped).
5. Commit alongside the phase commit, or as a `docs:` follow-up if the phase commit is already pushed.

When a phase slips or its scope shifts, update PLAN.md first (the source of truth) and reflect the change here second.
