# CLAUDE.md — VRL-YOLO-GUI

> **Read this first.** Then read `PLAN.md` for full scope. This file is the
> session entry guide; `PLAN.md` is the source of truth.

---

## 1. What this project is

A clinician-facing desktop toolkit demonstrating YOLO **detection** and
**classification** in **histopathology** and **hematology**. Ships as **one
desktop binary** with two modes — **Predict** and **Train** — plus a parallel
set of standalone Google Colab notebooks.

**Audience:** practising pathologists / hematologists with no terminal or ML
background. Success = doctor installs one binary, drops a folder of slide
patches, gets annotated images (detect) or a prediction table + PDF (classify)
in under 10 minutes.

**Status (v0.14.2, 2026-05-31):**
- ✅ Pre — `CLAUDE.md` entry guide (`9bd0b83`)
- ✅ **P0** — Scaffolding · `v0.1-p0-scaffolding` (`d06e9e2`)
- ✅ **P1** — Predict (Detection) · `v0.2-p1-predict-detect` (`2acd8f5`)
- ✅ P1.fix-1 — Cold-start race fix (`427093d`)
- ✅ **P2** — Predict (Classification) · `v0.3-p2-predict-classify` (`455efc8`)
- ✅ Topbar version fix (`e62d8d2`)
- ✅ **P3a** — Predict v1: batch + workflow presets · `v0.4-p3a-predict-batch` (`84dc3f8`)
- ✅ **P3b** — Predict v1: reports, import & settings · `v0.5-p3b-predict-reports` (`0d05150`)
- ✅ P3b.fix-1 — QtWebEngine downloads (`cd1a92b`)
- ✅ **P4a** — Train (Detection) wizard · `v0.6-p4a-train-detect-wizard`
- ✅ P4a.fix-1 — Roboflow upload + prepare-splits helper (`debf84b`)
- ✅ **P4b** — Train (Detection) local run · `v0.7-p4b-train-detect-run` (`2e42d9d`) — live charts, cancel, save-to-library, class-name editor
- ✅ P4b.fix-1 — Models download + rename + ml-import safety net (`2c0ced6`)
- ✅ **P5** — Train (Classification) · `v0.8-p5-train-classify` (`1d104f7`) — wizard + subprocess + top-1/top-5 metric streams, save-to-library routes per task
- ⚠️ P5.fix-1 — macOS Cmd+Q event-filter shutdown · `v0.8.1` (`543b40d`) — installed an app-wide `QEvent::Quit` filter that crashed startup before `pyloid.run()`. Superseded.
- ✅ P5.fix-2 — Window-scoped close filter · `v0.8.2` — scoped the filter to the Pyloid window's `QMainWindow` (catches `QEvent::Close`); both startup and close paths verified clean in dev with `VRL_YOLO_GUI_TEST_AUTO_QUIT_S=4 uv run python src-pyloid/main.py`.
- ✅ P5.fix-3 — Flat ImageFolder + classify splitter + layout examples · `v0.8.3` — inspector now accepts `<root>/<class>/*.jpg` (was train/<class>/ only); `split_imagefolder` stratifies per class into train/val/test for Ultralytics' classify mode; `/train/dataset` shows a collapsible card with 4 ASCII layout examples. Verified end-to-end against `/Users/atultiwari/Downloads/Projects/Datasets/lung_colon_image_set/lung_partial`.
- ✅ P5.fix-4 — Subprocess env-var dispatch · `v0.8.4` — frozen `.app` bootloader ignores `-m module`, so `[sys.executable, "-m", "vrl_yolo.engine.train_runner", ...]` was booting a second Pyloid window and leaving training stuck at epoch 0. Now `main.py::_maybe_dispatch_subprocess` reads `VRL_YOLO_GUI_SUBPROCESS=train_runner` after `freeze_support()` and dispatches to runner directly. Both detect and classify smoke-passed in dev via the same path the frozen binary uses.
- ✅ P5.fix-5 — Graceful job cancel on Cmd+Q · `v0.8.5` — the macOS hard-exit path (`os._exit(0)` to bypass the QSurface static-destructor crash) used to orphan in-flight training subprocesses to launchd. New `_cancel_active_jobs_best_effort(fastapi_app, timeout_s=3.0)` helper now SIGTERMs every running/queued job (via the existing `JobManager.cancel`) and polls for clean exit before hard-exiting; wired into both the `QEvent::Close` filter and the `aboutToQuit` fallback. Closes carry-forward item #1.
- ✅ P5.fix-6 — Preserve existing splits in the splitter · `v0.8.6` — Prepare splits used to always reshuffle every image, destroying hand-curated train/val/test assignments. New `preserve_existing` flag end-to-end (backend splitters → API → modal checkbox) lets images already in `train/`/`val|valid|validation/`/`test/` stay put; ratios then apply only to the flat / unassigned pool. Modal previews show `Train (X preserved + Y new = Z)` when preserve is on; greys out the Split button when there's nothing flat to redistribute. Inspector now reports `unassigned_image_count` so the modal can tell whether a mixed layout has anything to redistribute. Closes carry-forward item #3 — **all three carry-forwards now resolved**.
- ✅ P5.fix-7 — Bundle our own dist-info (version badge fix) · `v0.8.7` — top-right version badge was reporting `v0.0.0+source` on all PyInstaller-bundled releases from v0.8.5 onward because `--collect-submodules vrl_yolo` bundles source but not `dist-info` metadata, so `importlib.metadata.version("vrl-yolo-gui")` raised `PackageNotFoundError` and `_resolve_version()` returned the placeholder. Added `--copy-metadata vrl-yolo-gui` to the PyInstaller args in `scripts/build-release.py`. One-line build-script change; no Python source change. Info.plist's `CFBundleShortVersionString` was always correct; only the runtime API read was broken.
- ✅ **P6a** — Colab companion notebooks + runtime · `v0.8.8-p6a-colab-notebook` — five-cell `01_train_detect_colab.ipynb` + `02_train_classify_colab.ipynb` notebooks orchestrate Drive mount → repo clone → config edit → Cloudflare tunnel → training. Three runtime modules under `notebooks/_runtime/`: `colab_tunnel.py` (download + spawn cloudflared, parse trycloudflare URL), `colab_server.py` (FastAPI mini-server: token-authed `GET /status`, `WS /events` with replay-on-subscribe, `GET /best.pt`, `POST /cancel`), `colab_runner.py` (Ultralytics driver publishing events through the server). Shared wire-protocol module extracted to `server/vrl_yolo/engine/_runner_common.py` — both local + Colab runners import metric-key dicts + `extract_metrics` from it so version drift in Ultralytics lands one fix. End-to-end smoke verified via `tests/test_colab_server_smoke.py` (8 passing tests against a live uvicorn instance). Clinician guide at `docs/COLAB-GUIDE.md`.
- ✅ **P6b** — Desktop *Run on Colab* integration · `v0.8.9-p6b-colab-desktop` — *Run on Colab* yellow callout on `/train/configure` when the hardware probe returns `cpu`; *Connect to Colab* modal (task-aware, Copy + Open buttons for the GitHub-anchored Colab URL, tunnel-URL input, in-modal errors). `engine/colab.py` does the 3 s `GET /status` pre-flight + parses tunnel URLs + provides `request_cancel`/`fetch_best_pt`. `engine/colab_reader.py` is a daemon-thread WS reader that translates remote `_VRL_EVENT` payloads into `job.append_event` — same code path the local subprocess reader uses, so `/train/run` and `/api/training/{id}/stream` consume Colab events with zero changes. `JobManager.start_colab_job` is the parallel entry point; `cancel()` and `save_to_library()` branch on `_colab_session` (POST /cancel + `GET /best.pt` through the tunnel for Colab jobs). New route `POST /api/training/colab/connect` + frontend `connectColab()` helper. End-to-end verified via `tests/test_colab_integration_smoke.py` — 9 passing tests against a real localhost ColabServer treated as a tunnel.
- ✅ **P6c** — Resilience polish · `v0.9-p6-train-colab` — **P6 phase complete.** Reader's outer loop now wraps the WS read in exponential backoff (2/4/8/16/32/60 s, cap 20 attempts ≈ 18 min) with a pre-flight `GET /status` that classifies failures as auth (HTTP 401 — abandon, message clearly says the cell was restarted) or network (retry). Reader emits synthetic `connection` events; `/train/run` shows a `ColabConnectionBanner` (amber while reconnecting with attempt counter + back-off delay, green when reconnected — clears itself, red when abandoned). Cancel-mid-backoff is clean: `TrainingJob._reader_stop_event` flips the reader out of any sleep / read loop in <1 s. `fetch_best_pt` retries 3× with 2/4/8 s backoff on transient failures, fails fast on 401/409. Pilot test plan at `docs/PILOT-TEST.md` translates PLAN-P6.md §7 into a 9-step executable checklist for the clinician + dataset run that gates v1.0. 23/23 smoke tests passing.
- ✅ P6.fix-1 — Run on Colab callout visible on all hardware kinds · `v0.9.1` — caught by the user testing on MPS: the callout was gated by `hardware?.kind === "cpu"` since P6b, so MPS / CUDA machines couldn't reach the Colab feature at all. Now always visible when hardware data has loaded; copy adapts per `kind` (CPU loud + push, MPS *"Colab T4 often faster than MPS"*, CUDA quietest). One callout, three copy variants from a switch on `hardware.kind`.
- ✅ **F1** — Models library: delete + reveal on disk + path on every card · `v0.10-f1-models-polish` (`788dee3`) — first of the four post-v0.9 Future-Features items from `docs/FUTURE-FEATURES.md`, planned in `docs/PLAN-F1.md` (4 decisions signed off: hard-delete, 403 for bundled, path on every card, reveal on every card). User explicitly reordered the F-chain to land before P7. New `DELETE /api/models/{name}` (404/403/204) + `ModelRegistry.delete()` (clears `defaults.json` entry + LRU + tolerates file already gone). New `POST /api/models/{name}/reveal` (404/410/204) with per-OS dispatch — Darwin `open -R`, Windows `explorer /select,<path>`, Linux `xdg-open <parent>`; lives on the backend because the QtWebEngine renderer is sandboxed. New `path` field on every `ModelInfo` response. UI: "On disk · `<abs path>`" row + Reveal button on every card + Delete button on user/trained (disabled tooltip on bundled) + inline confirmation modal that quotes the file path. 12 backend tests in `tests/test_models_api.py` all green; 23 prior Colab smoke tests still green.
- ✅ **F2** — Training-run name + description + app-wide TZ setting · `v0.11-f2-run-naming` (`fd429fc`) — second of the F-chain, planned in `docs/PLAN-F2.md` (8 decisions across 2 rounds + wide-scope TZ setting). Optional Name + Description on `/train/configure` with live placeholder (`<Task> · <stub> · YYYY-MM-DD HH:MM` in user TZ, rebuilds on task/dataset/TZ change + ticks every 60 s). `TrainingJob.{name,description}` flow through `start()` + `start_colab_job()`, surfaced in `snapshot()` / `TrainingJobInfo`. New `PATCH /api/training/{id}` (gated to queued/running → 409 on terminal; un-gated in F3). `save_to_library()` now uses slugified `job.name` (Unicode-safe via `python-slugify>=8.0` with `allow_unicode=True`, `lowercase=False`, max 80 chars; collision-disambiguated with `-<stub>` suffix; falls back to `trained-<stub>.pt` on empty slug). `/train/run`: name as h1 + inline edit pencil; description italic + popover edit; `Started · Finished · Elapsed` row. New `apps/web/lib/format-date.ts` (formatDate / formatTrainingTimestamp / formatRelative / formatElapsed) + `usePreferredTimezone()` hook; new `/settings` Timezone section (system default + IANA combobox from `Intl.supportedValuesOf('timeZone')`). Also fixed F1 regression where `routers/training.py::_record_to_info` was a duplicate that hadn't been updated when F1 added `path` to `ModelInfo` — caused save-to-library to 500. 22 new backend tests + 1 regression test = 58 total all green.
- ✅ **F5** — Auto-save trained models + macOS first-launch helper in .dmg · `v0.13-f5-autosave` (`d64b8dd`) — fourth of the F-chain (user reordered to ship F5 before F4 since F3's history makes F5's UX immediately meaningful). New "Auto-save trained models" toggle in the Train section of /settings (default ON; next to F3's auto-purge); auto-save fires on `/train/run` completion via `useEffect` watching `status`/`bestPt`/`savedModel` (useRef guard so a re-render or WS replay can't double-fire), AND on `/train/history/view` mount for runs that completed while the user was elsewhere. Green clinical-tone toast says *"Auto-saved as 'X'. Open Models to use it for prediction."* Manual "Save to library" button stays available on both pages either way (covers users who flipped OFF + users whose auto-save failed). **Behaviour shift:** both manual and auto save now drop the implicit `setDefaultModel` call — saving to library and marking as default become two distinct actions (the "Set as default" button on /models is the only path now). Also ships **macOS install assets** (`assets/install/macos/install.command` + `README-MACOS-FIRST-RUN.txt`) bundled in the .dmg via `scripts/build-release.py::maybe_macos_dmg` (stages app + assets together in a temp dir + passes to create-dmg with second-row icon layout) — closes the unsigned-app Gatekeeper friction one of our test installs hit on v0.12.0. 89 backend tests + tsc still green; no new tests for F5 (pure frontend; manual verification covered the auto-save behaviour).
- ✅ **F3** — Persistent training history (SQLite + /train/history + edit-lock removed) · `v0.12-f3-history` (`9ca25b5`) — third of the F-chain, planned in `docs/PLAN-F3.md` (8 decisions across 2 rounds + new §9 for opt-in auto-purge>30d setting). New SQLite layer at `<storage_root>/training.db` (hand-rolled schema_version + ordered `_migrate_vN_to_vM` migrations; v1 ships) + per-run `events.jsonl(.gz)` sidecars (line-buffered writer; gzipped in a daemon thread on terminal status; replay auto-picks compressed-or-not). Every training run (local + Colab) writes a history row from the moment `JobManager.start()` fires; rows update through the lifecycle + gain `library_path` after save-to-library. **F2's PATCH edit-lock is removed** — completed runs are now editable via the history layer. New pages: `/train/history` (sortable + filterable table with task/status/dataset filters; manual + auto-purge cleanup; Re-run / Edit / Delete actions) + `/train/history/view?id=<job_id>` detail (replays events.jsonl into the same recharts components `/train/run` uses; URL is query-param-based — Next static export can't pre-render `[id]` dynamic routes without `generateStaticParams`; wrapped in `<Suspense>` per Next 15's `useSearchParams` static-export requirement). 6 new routes (list / detail / events stream / delete / rerun / purge) declared *before* the `/{job_id}` routes so the `/history` literals beat the path-parameter match. New opt-in auto-purge>30d setting (default OFF) in a new **Train** section of `/settings`; sidebar gets a "Training history" entry under the Train workspace nav. Re-run from any history row prefills the wizard at `/train/configure?from=<history_id>`. F5 added to `docs/FUTURE-FEATURES.md` for the upcoming auto-save toggle. 32 new backend tests + 22 F2 tests updated (the F2 409-on-completed cases now expect 404 when no history is wired) = 89 total all green.
- ✅ **F4** — Dataset library: naming + library tab + /datasets page + history cross-reference · `v0.14-f4-dataset-library` (`08e0828`) — **last item in the F-chain**, planned in `docs/PLAN-F4.md` (6 decisions signed off + inline rename pencil added mid-implementation after the user pointed out 45 backfilled rows would otherwise need 45 detail-page round-trips). New SQLite schema v2 with a `datasets` table parallel to F3's `training_runs`; v0→v1→v2 transparent on fresh installs, v1 installs auto-upgrade with a first-launch backfill that walks `<storage>/datasets/` and inserts default-named rows for every existing folder. New `HistoryDb` meta methods (get/list/upsert/delete_dataset_meta) + `dataset_stats()` aggregator. New `JobManager.list_active_jobs_for_dataset(id)` for the 409 delete guard. 3 new routes — `GET /api/datasets` (paginated list with cross-referenced last_used_at + run_count + a separate `partial: []` list for folders where inspect_dataset raises), `DELETE /api/datasets/{id}` (409 with run names if any active job uses it; preserves F3 history rows + library checkpoints), `PATCH /api/datasets/{id}` (F2-style name + description editing). `POST /api/datasets/inspect` extended with optional `?name=&description=` query params. New `/datasets` top-level page (sidebar entry under Train) + `/datasets/view?id=<id>` detail page (query-param URL + Suspense wrapper for static-export compat). New "Pick from library" tab on `/train/dataset` + "Name this dataset (optional)" card on the Drop-a-folder tab. Shared `components/datasets/library-table.tsx` rendered in both pages with picker / browse modes + sort dropdown + soft-mention delete modal + separate "Couldn't read" partial section + **inline rename pencil on every row** (hover-to-reveal, Save/Cancel + Enter/Escape, per-row state so editing one row doesn't re-render the table). `/train/history` dataset filter upgraded from raw UUID stubs to friendly names from `/api/datasets`, with `?dataset=<id>` URL prefill; page wrapped in Suspense. 27 new backend tests = 116 total all green.
- ✅ F4.fix-1 — macOS .dmg build fix · `v0.14.1` — both `v0.13-f5-autosave` and `v0.14-f4-dataset-library` CI release builds failed on the macos-arm64 runner in `scripts/build-release.py::maybe_macos_dmg` (introduced in F5). The post-build cleanup that removes PySide6 devtool `.app` bundles (Assistant, Designer, Linguist) was leaving dangling sibling symlinks behind, and the new `shutil.copytree(app, stage_dir / app.name)` then tried to follow them. Two surgical fixes: (1) `strip_nested_macos_bundles` now skips symlinks in its first pass and adds a second pass that unlinks any broken symlinks left behind; (2) `maybe_macos_dmg`'s `copytree` call passes `symlinks=True` so Qt framework `Versions/Current → A` symlinks are preserved as symlinks rather than followed. 14/14 checks pass on a synthetic bundle that reproduces the exact failing PySide6 layout (real devtool dirs with sibling symlinks, `QtWebEngineProcess.app` in Helpers/, `Versions/Current` symlink). Build-pipeline-only fix — no application code changes; backend test count stays at 116; Windows builds were never affected.
- ✅ P6.fix-2 — Colab progress visibility · `v0.14.2` — caught by the user testing the *Train on Colab* flow: pasting the tunnel URL after the cloudflared cell but **before** running the notebook's `Run training` cell left `/train/run` showing a *running* badge with empty charts and a 0/50 bar — indistinguishable from a stuck run. Root cause: `JobManager.start_colab_job` mapped the worker's `starting` status (server up, training **not** begun) to a local `running`. Fix in three layers: (1) **backend honesty** — Colab jobs now seed `queued`, and `TrainingJob.append_event` promotes `queued → running` on the first `start`/`epoch` event (same path for local + Colab) + mirrors that into the F3 history DB, so the recovery is automatic (run the cell, the desktop flips to live on its own); (2) **two `/train/run` lifecycle banners** distinct from the reconnect banner — a `waiting for Colab` badge + amber banner (*"now run the last cell, Run training"*) while `queued`, and a `preparing` banner with a live ticking elapsed timer for Ultralytics' multi-minute warm-up before epoch 1 (no events flow there, so the page ticks a 1 Hz clock); both clear on the first epoch; (3) **recurrence prevention** — the Connect modal copy now says *Runtime → Run all* + warns early connects show *waiting for Colab*, and both notebooks print a *"Next: run the cell below (Run training)"* line after the URL. 1 new backend test (connect-while-`queued` → `start` → `running`) = 117 total; `tsc` + production build green. Deferred: a server-side warm-up heartbeat (carry-forward #11) — the elapsed timer is local-only proof-of-life.
- ⏳ **P7 next** — Polish (per PLAN.md §14). UX pass + clinician-readable error states + in-app help + docs site (incl. two Roboflow walkthroughs). After P7: P8 (macOS packaging) → P9 (Windows packaging) → P10 (Pilot). **The F-chain is complete** — the project returns to the original PLAN.md §14 phase sequence. Phase tag at P7 completion: `v0.15-p7-polish`. Pilot test (`docs/PILOT-TEST.md`) remains the v1.0 gate and still hasn't been run with a clinician + dataset.

**P3b also shipped three user-requested extras:**
- Settings page (sidebar + localStorage hook)
- Folder-batch image preview on row click
- Workflow presets hidden by default — re-open tracked in
  [`project_presets_revisit`](file:///Users/atultiwari/.claude/projects/-Users-atultiwari-Downloads-Projects-YOLO-GUI/memory/project_presets_revisit.md)
  (memory). Remind the user when P10 begins.

Live status snapshot is in [`docs/PHASE-STATUS.md`](docs/PHASE-STATUS.md);
per-build feature list is in [`CHANGELOG.md`](CHANGELOG.md) (also surfaced
in the app at `/changelog`); the canonical roadmap stays in
[`PLAN.md`](PLAN.md); **deferred work / known limitations** with full
diagnoses live in [`docs/CARRY-FORWARDS.md`](docs/CARRY-FORWARDS.md). The
user works phase-by-phase and expects a commit + push at each phase
boundary; do **not** roll multiple phases into one commit.

**On every phase commit, also:**
1. Bump `pyproject.toml` `version` so `/api/health` advertises it.
2. Prepend an entry to `apps/web/lib/changelog.ts` with `status: "current"`;
   flip the previous current entry to `"shipped"`.
3. Mirror the entry into `CHANGELOG.md`.
4. Update the snapshot table in `docs/PHASE-STATUS.md`.
5. Push a follow-up `chore: backfill SHA` commit to wire the real
   commit hash into the changelog (you can't know your own SHA before
   committing).

---

## 2. Stack (locked in)

| Layer | Choice |
|---|---|
| Desktop wrapper | **Pyloid** (embedded QtWebEngine) |
| Backend | FastAPI + uvicorn (in-process under Pyloid) |
| Frontend | Next.js 15 + React 19 + TypeScript + shadcn/ui + Tailwind v4 |
| ML | `ultralytics` — **YOLO26 default**, YOLOv8 fallback |
| Python | 3.11 (pinned) |
| Workspace | `uv` (Python), `pnpm` (frontend) |
| Packager | PyInstaller 6.x (folder bundle on macOS, onefile on Windows) |
| Signing | **Ad-hoc only.** No Apple Developer enrolment, no EV cert. |
| License | **AGPL-3.0** + separate commercial license (matches Ultralytics) |

**Why not PySide6 + qfluentwidgets:** the user already shipped
`VRL-ML-Studio-Lite` on the Pyloid stack; the
`python-pyloid-desktop-packaging` skill captures every macOS gotcha already
solved there. Forking that template saves ~3 weeks. See `PLAN.md` §4.

---

## 3. Load-bearing rules (do not re-litigate without reason)

1. **One binary, two modes.** Not two apps. Sidebar switches `/predict` ↔
   `/train`; route groups keep the surfaces separate in code.
2. **No `packages/vrl_yolo_core/`.** Backend lives in `server/vrl_yolo/`.
   Notebooks are standalone (use `ultralytics` directly) — no second consumer
   exists for a shared Python package. Extracting one later is a 1-day refactor.
3. **Detection and classification are both first-class.** Same model library,
   same UI shell; the model's `task` field drives view-switching. Detection
   uses YOLO format + 640 px + mAP; classification uses ImageFolder + 224 px
   + top-1/top-5.
4. **YOLO26 is the default**, YOLOv8 is the fallback. Bundled starter
   weights: `yolo26{n,s}.pt`, `yolo26{n,s}-cls.pt`, `yolov8{n,s}.pt`,
   `yolov8{n,s}-cls.pt` (~80 MB total). m/l/x downloaded on demand.
5. **Annotation = Roboflow (external).** No in-app annotation editor in v1.
6. **Local + Colab training from day one.** Local enabled when accelerator
   is CUDA/MPS (or user opts in to CPU). Colab uses Cloudflare-tunnel +
   Drive sync from the `yolo-gui` reference project.
7. **Out of scope for v1:** WSI ingestion (`.svs`/`.ndpi`/`.mrxs`),
   segmentation/pose/OBB tasks, in-app annotation, multi-user workspaces,
   cloud-hosted inference, bundled demo dataset (→ v1.1).

If something here seems wrong, **flag it before deviating** — these were
each pivoted into during a five-revision planning iteration.

---

## 4. Template — fork, don't rewrite

The reference template is **`VRL-ML-Studio-Lite`** (a sibling VRL desktop
app, NOT a parent of this project):

- Local: `/Users/atultiwari/Downloads/Projects/VRL-ML-Studio/VRL-ML-Studio-Lite/`
- GitHub: `https://github.com/atultiwari/VRL-ML-Studio-Lite`

**Files to copy verbatim, then strip Studio-Lite logic:**

- `pyproject.toml`
- `pnpm-workspace.yaml`
- `src-pyloid/main.py` — has `multiprocessing.freeze_support()`,
  frozen-launch logging, TCC-safe storage path, single-instance Pyloid,
  `aboutToQuit → os._exit(0)` shutdown workaround.
- `scripts/build-release.py` — PyInstaller wrapper with macOS devtool-bundle
  strip + inside-out resign + `--arch-suffix`.
- `.github/workflows/release.yml` — multi-arch matrix (`macos-14`,
  `windows-latest`), `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env.
- `scripts/generate-splash.py`

---

## 5. Skills — check these before designing

**This is a hard rule.** Before proposing any architecture, packaging, or
build recipe, list `~/.claude/skills/` and load anything matching the task
domain. The user has called this out explicitly after a missed-skill
incident cost ~3 weeks of replanned scope.

Always-relevant for this project:

- **`python-pyloid-desktop-packaging`** — every macOS PyInstaller gotcha
  already solved for VRL-ML-Studio-Lite (TCC paths, Team-ID resign,
  devtool-bundle strip, `aboutToQuit os._exit`). The user's own template is
  cited as the reference implementation. Take its "When to Activate" list
  literally.
- **`clinical-decision-support`** / **`clinical-reports`** — relevant for
  PDF/Excel report design.
- **`scientific-visualization`** / **`pathml`** / **`histolab`** — relevant
  when working on histopathology preprocessing later.

If a skill points to a real reference repo, **read that repo** before
recommending a different approach.

---

## 6. How to collaborate with this user

Atul Tiwari (`atultiwari.in@gmail.com`, GitHub `@atultiwari`) is
engineering-fluent. He will challenge any abstraction that doesn't earn its
keep. Conventions observed across the planning sessions:

- **Plan first, code later.** Non-trivial work gets a `PLAN.md` revision and
  explicit sign-off before any file is written. "Don't write any code yet"
  is a literal constraint — including scaffolds and empty modules.
- **No premature abstraction.** Before introducing a `core/`, `shared/`,
  `lib/`, `wrapper/` layer, name the second concrete consumer that exists
  today. If you can't, collapse the layer. Surface the reasoning explicitly
  — he appreciates "I was reaching for X by reflex; here's the smaller
  version."
- **Honest tradeoffs over consensus answers.** When asked "what about Y?",
  pick a side with rationale rather than listing pros and cons of both.
- **Pushback is welcome.** The planning style is: open question → proposal
  → he pushes back on the weakest assumption → revise. Don't defend the
  first draft.
- **Use `AskUserQuestion`** for crisp architectural decisions that affect
  license, packaging, or distribution — don't guess.

License default for his Ultralytics-derived work is always **AGPL-3.0 +
separate commercial**. Don't suggest MIT/Apache.

---

## 7. Repo layout (target — not built yet)

See `PLAN.md` §3 for the full tree. Top-level shape:

```text
VRL-YOLO-GUI/
├── apps/web/                    # Next.js frontend (one app, two route groups)
├── server/vrl_yolo/             # FastAPI backend (importable module, NOT a package)
├── src-pyloid/main.py           # Pyloid desktop entry
├── notebooks/                   # 12 standalone notebooks (detect/classify pairs)
├── models/{detect,classify}/    # 8 bundled starter weights
├── scripts/                     # build-release.py, generate-splash.py, pre-flight.py
├── packaging/{macos,windows}/   # ONE PyInstaller spec each
├── .github/workflows/release.yml
├── pyproject.toml               # uv project (NOT a workspace)
├── pnpm-workspace.yaml          # frontend-only workspace
├── PLAN.md                      # source of truth
└── CLAUDE.md                    # this file
```

**Backend lives in `server/vrl_yolo/`**, not `packages/`. See rule §3.2.

---

## 8. Next concrete steps

**P0 → P5 shipped.** Next phase is **P6 — Train on Colab** — see
[`docs/PHASE-STATUS.md`](docs/PHASE-STATUS.md) for the running tracker
and per-phase verification proofs.

**P6 scope (estimated 1.5 weeks):**

1. `engine/colab.py` — Cloudflare-tunnel client + Drive sync, modelled
   on the `yolo-gui` reference project (PLAN.md §11).
2. `/train/configure` — surface a "Run on Colab" toggle when the
   accelerator probe returns `cpu`, instead of letting the user kick
   off an overnight CPU run by accident.
3. Companion notebooks under `notebooks/` (detect + classify pairs) —
   train on the user's own Drive, mount Cloudflare tunnel, hand the live
   metric stream back to the desktop app over the existing WebSocket
   protocol so `/train/run` works unchanged.
4. Save-to-library pulls `best.pt` from Drive into
   `<storage_root>/models/<task>/`.
5. End-of-phase tag: `v0.9-p6-train-colab`.

Do not begin P6 (or any subsequent phase) without the user's explicit
sign-off — the workflow is phase-by-phase with a confirm-then-start
check at each boundary.

---

## 9. Coding conventions (when code starts)

These extend the user's global rules at `~/.claude/rules/` — see especially
`common/coding-style.md`, `python/`, `web/`. Project-specific notes:

- **Python:** ruff + mypy. Files <800 lines (extract modules earlier — there
  are real anti-pattern examples in the surveyed reference projects, e.g.
  MediScreen-Brain's 6.5k-line monolith).
- **Frontend:** route groups `(predict)/` and `(train)/`, shared layout
  shell, Recharts for training curves and class distributions. No animating
  layout-bound CSS properties.
- **Storage paths:** Always use `paths.py::_resolve_storage_root()` from the
  Pyloid-packaging skill. Never `~/Documents` on macOS (TCC blocks unsigned
  apps).
- **Errors:** Clinician-readable text in UI; full traceback to
  `<app_data>/logs/launch.log`. Print `step:` at every boot phase so a
  silent-exit diagnosis is two-line.
- **Testing:** 80% target on `server/vrl_yolo/`. Playwright e2e for four
  critical paths: detect-single, classify-single, detect-train+save,
  classify-train+save.
- **Subprocess for training**, not in-thread — `ultralytics.train()` is sync
  and would freeze the UI. Stream stdout to a WebSocket; parse metric lines
  per task.

---

## 10. Anti-patterns to actively avoid

Carry-overs from the four reference projects surveyed (`MediScreen-Brain`,
`YOLOSHOW`, `YOLOv8-PySide6-GUI`, `yolo-gui`):

- **Monolithic single-file UI** (MediScreen-Brain has a 6.5k-line main).
- **Global mutable state modules** (YOLOSHOW's `glo.py`).
- **Mutating server-rendered DOM via inline `<script>`** — breaks React
  hydration (splash-screen gotcha from the Pyloid skill).
- **Unanchored `.gitignore` rules** — silently strip source dirs from CI
  builds. The skill ships a `pre-flight.py` script to catch this.
- **`~/Documents` for app data on macOS** — TCC blocks unsigned apps.

---

## 11. Quick reference

| Thing | Value |
|---|---|
| Project root | `/Users/atultiwari/Downloads/Projects/YOLO-GUI/VRL-YOLO-GUI/` |
| GitHub | `https://github.com/atultiwari/VRL-YOLO-GUI` |
| Default branch | `main` |
| Template | `/Users/atultiwari/Downloads/Projects/VRL-ML-Studio/VRL-ML-Studio-Lite/` |
| License | AGPL-3.0 (file not yet committed) + separate commercial |
| Bundle target | ~770 MB per binary (Chromium-class) |
| macOS app data | `~/Library/Application Support/VRL-YOLO-GUI/` |
| Windows app data | `%APPDATA%\VRL-YOLO-GUI\` |
| Source of truth | `PLAN.md` |
