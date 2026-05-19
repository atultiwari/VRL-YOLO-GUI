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

**Status (v0.8.6, 2026-05-19):**
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
- ⏳ **P6 next** — Train on Colab: Cloudflare tunnel + Drive sync + companion notebooks for both tasks

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
