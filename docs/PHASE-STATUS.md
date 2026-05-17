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
| **P2 — Predict (Classification)** | ✅ done | `v0.3-p2-predict-classify` | TBD |
| P3a — Predict v1: batch + presets | ⏳ next | — | — |
| P3b — Predict v1: reports + import | ⏳ pending | — | — |
| P4a — Train (Detection) wizard | ⏳ pending | — | — |
| P4b — Train (Detection) local run | ⏳ pending | — | — |
| P5 — Train (Classification) | ⏳ pending | — | — |
| P6 — Train on Colab | ⏳ pending | — | — |
| P7 — Polish | ⏳ pending | — | — |
| P8 — Packaging macOS | ⏳ pending | — | — |
| P9 — Packaging Windows | ⏳ pending | — | — |
| P10 — Pilot | ⏳ pending | — | — |

**Current head:** `main` at the P2 commit (`v0.3-p2-predict-classify`). **Next phase:** P3a — folder batch + histopathology / hematology workflow presets.

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

---

## Up next: P3a — Predict v1 — batch + presets

**Estimated 1 week** per PLAN.md §14. Scope:

- `/api/inference/batch` — accept a folder path (desktop mode) or zipped upload (web mode), stream progress via WS.
- Histopathology + hematology workflow presets per task (PLAN.md §10) — one-click run that wires conf / IoU / class subset together.
- Predict UI: folder drop, results table per image, aggregate panel.
- Recursive option for nested folder structures (Roboflow exports often nest by class).

**Phase tag at completion:** `v0.4-p3a-predict-batch`.

---

## Update protocol (for future Claude sessions)

When a phase boundary is reached:

1. Run the verification proof for the phase. Capture the relevant lines into the phase's section.
2. Flip the row in the **Snapshot** table from ⏳ → ✅ with the commit short SHA and tag name.
3. Append a new section under "Completed phases" with sub-phases table, verification block, and **known limitations carried into the next phase**.
4. Update the **Up next** section to point at the next phase's scope (copy from PLAN.md §14, refine where the plan has slipped).
5. Commit alongside the phase commit, or as a `docs:` follow-up if the phase commit is already pushed.

When a phase slips or its scope shifts, update PLAN.md first (the source of truth) and reflect the change here second.
