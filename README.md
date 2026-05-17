# VRL YOLO GUI

> **Status (v0.5.0, 2026-05-17):** Phases P0–P3b complete. Predict mode is
> feature-complete for v1: **single-image** and **folder-batch** inference
> for **detection** and **classification**, click any row in the batch
> table to preview that image with predictions, export **CSV / XLSX / PDF**
> reports, import your own fine-tuned `.pt` checkpoints, and a Settings
> page for per-device preferences. Train modes (P4–P6) and Polish /
> Packaging / Pilot (P7–P10) are next.
>
> See [`CHANGELOG.md`](CHANGELOG.md) for the per-release feature list,
> [`docs/PHASE-STATUS.md`](docs/PHASE-STATUS.md) for the phase tracker,
> [`PLAN.md`](PLAN.md) for the full roadmap, and [`CLAUDE.md`](CLAUDE.md)
> for the session entry guide.

A clinician-facing desktop toolkit demonstrating two YOLO tasks in
**histopathology** and **hematology**:

- **Object detection** — count and classify cells in blood smears, mark
  mitotic figures in tissue patches, screen for malaria parasites.
- **Image classification** — predict tumour subtype (IDC / DCIS / Normal),
  Gleason grade, blood-smear pathology, bone-marrow pattern.

Both tasks are first-class. The same desktop app handles both, the same
notebooks train both, and the same model library stores both — each model
declares its `task` in its filename (`-cls` for classification, plain for
detection) and the UI adapts.

## Audience

Practising pathologists and hematologists with no terminal or ML
background. Success = doctor installs one binary, drops a folder of slide
patches, gets annotated images (detection) or a per-image prediction
table + PDF (classification) in under 10 minutes from download.

## Stack

| Layer | Choice |
|---|---|
| Desktop wrapper | [Pyloid](https://github.com/pyloid/pyloid) (embedded QtWebEngine) |
| Backend | FastAPI + uvicorn (in-process under Pyloid) |
| Frontend | Next.js 15 + React 19 + TypeScript + Tailwind v4 |
| ML | [Ultralytics](https://docs.ultralytics.com/) — YOLO26 default, YOLOv8 fallback |
| Python | 3.11 |
| Workspaces | `uv` (Python) + `pnpm` (frontend) |
| Packager | PyInstaller 6.x — folder bundle on macOS, onefile on Windows |
| Distribution | Ad-hoc signing only (no Apple Developer / Windows EV) |

## Layout

See [PLAN.md §3](PLAN.md#3-repository-layout-single-binary-no-separate-core-package)
for the canonical tree. Top level:

```text
VRL-YOLO-GUI/
├── apps/web/                # Next.js frontend (one app, two route groups)
├── server/vrl_yolo/         # FastAPI backend (importable module)
├── src-pyloid/              # Pyloid desktop entry + splash + icons
├── scripts/                 # build-release.py, run-*.py, fetch-models.py
├── packaging/{macos,windows}# PyInstaller spec + Inno Setup (P8/P9)
├── notebooks/               # 12 standalone Colab notebooks (P6)
├── models/{detect,classify} # 8 starter weights (downloaded, not committed)
├── .github/workflows/       # multi-arch release pipeline
├── pyproject.toml           # uv project (single package: vrl_yolo)
├── pnpm-workspace.yaml      # frontend workspace
├── CLAUDE.md                # session entry guide
├── PLAN.md                  # source of truth
└── README.md                # this file
```

## Quick start (developers)

```bash
# 1. Install Python + Node dependencies
uv sync --extra dev --extra desktop --extra ml   # `ml` pulls torch + ultralytics (~2 GB)
pnpm install

# 2. Fetch the bundled detection starter weights (~53 MB)
python scripts/fetch-models.py --task detect

# 3. Run the FastAPI backend + Next.js dev server side-by-side
python scripts/run-web.py
# Backend  → http://127.0.0.1:8000/api/health
# Frontend → http://localhost:3000

# 4. Or launch the Pyloid desktop window (auto-builds the static export)
python scripts/run-desktop.py

# 5. Build an unsigned release binary for the current OS
python scripts/build-release.py --clean-build
# Artifact: dist/VRL YOLO GUI.app  (macOS)
#        or dist/VRL YOLO GUI.exe  (Windows)
```

### Common run-script flags

| Flag | Wipes | Use when |
|---|---|---|
| `--clean` | The user-data dir (`Application Support` / `AppData` / XDG) | Resetting settings, imported models, or trained-run outputs. |
| `--clean-build` | `apps/web/.next` + `apps/web/out` | Frontend cache is stale, or you want to verify the cold-build path. |
| `--rebuild` | _(nothing)_ — just re-runs `pnpm --filter web build` | Cache is fine but you want a fresh build step. |

`build-release.py --clean` also wipes `dist/` + `build/` + stale top-level `*.spec`; `build-release.py --clean-build` does that **and** the frontend cache.

## License

VRL YOLO GUI is dual-licensed:

- **[AGPL-3.0-or-later](LICENSE)** — default, free for AGPL-compatible use.
- **[Commercial license](COMMERCIAL-LICENSE.md)** — for closed-source or
  SaaS use. Buyers must procure their own Ultralytics Enterprise license
  separately.

See [NOTICE](NOTICE) for upstream component licenses.

## Author

Atul Tiwari — <atultiwari.in@gmail.com> — [@atultiwari](https://github.com/atultiwari)
