# Phase Status

> Living tracker for the 11-phase build plan in [PLAN.md §14](../PLAN.md#14-phases--milestones).
> Updated at the end of each phase boundary. **Last edit: 2026-05-17.**

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
| P4b — Train (Detection) local run | ⏳ next | — | — |
| P5 — Train (Classification) | ⏳ pending | — | — |
| P6 — Train on Colab | ⏳ pending | — | — |
| P7 — Polish | ⏳ pending | — | — |
| P8 — Packaging macOS | ⏳ pending | — | — |
| P9 — Packaging Windows | ⏳ pending | — | — |
| P10 — Pilot | ⏳ pending | — | — |

**Current head:** `main` at the P4a commit (`v0.6-p4a-train-detect-wizard`). **Next phase:** P4b — Train (Detection) local run: subprocess wrapper around `ultralytics.train()`, live metric WebSocket, results page with confusion matrix + "Save to library".

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

---

## Up next: P4b — Train (Detection) local run

**Estimated 1 week** per PLAN.md §14. Scope:

- `engine/training.py` — subprocess wrapper around `model.train(...)`; parses Ultralytics' stdout into structured metric events.
- `POST /api/training/start` returns a job id; `WS /api/training/{job_id}/stream` pushes per-epoch loss / mAP50 / mAP50-95 + accuracy.
- `/train/run` becomes a live page: start, cancel, progress, live Recharts curves for loss + mAP, last-epoch sample predictions.
- Results page: confusion matrix, per-class AP, sample val predictions, **Save to model library** (writes `best.pt` into `<storage_root>/models/<task>/<run-name>/best.pt` so `/models` picks it up via `source: trained`).

**Phase tag at completion:** `v0.7-p4b-train-detect-run`.

---

## Update protocol (for future Claude sessions)

When a phase boundary is reached:

1. Run the verification proof for the phase. Capture the relevant lines into the phase's section.
2. Flip the row in the **Snapshot** table from ⏳ → ✅ with the commit short SHA and tag name.
3. Append a new section under "Completed phases" with sub-phases table, verification block, and **known limitations carried into the next phase**.
4. Update the **Up next** section to point at the next phase's scope (copy from PLAN.md §14, refine where the plan has slipped).
5. Commit alongside the phase commit, or as a `docs:` follow-up if the phase commit is already pushed.

When a phase slips or its scope shifts, update PLAN.md first (the source of truth) and reflect the change here second.
