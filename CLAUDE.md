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

**Status (2026-05-17):** `PLAN.md` v0.5 committed. **No implementation code
exists yet.** Do not scaffold, do not write `__init__.py`, do not "just start
the structure" without explicit sign-off — see §6.

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

## 8. Next concrete steps (when implementation resumes)

From `PLAN.md` §18 — P0 deliverable is "a working `.app` window opens":

1. Fork `VRL-ML-Studio-Lite`'s `pyproject.toml`, `pnpm-workspace.yaml`,
   `src-pyloid/main.py`, `scripts/build-release.py`,
   `.github/workflows/release.yml`. Strip Studio-Lite logic, rename
   identifiers.
2. Stand up empty `server/vrl_yolo/` + empty Next.js shell at `/`,
   `/predict`, `/train`, `/models`.
3. Verify P0: `.app` window opens on macOS via `python -m server` and via
   packaged `.app`.
4. Brand pass — logo, palette, splash (see open question in `PLAN.md` §13.6).
5. AGPL headers + `NOTICE` + `COMMERCIAL-LICENSE.md` template.

Do not start any of the above without confirming the user wants
implementation to begin in this session.

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
