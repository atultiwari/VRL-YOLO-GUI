# VRL YOLO GUI

> **Status:** Phase 0 — Scaffolding (2026-05-17). The Pyloid window opens
> and the FastAPI backend responds at `/api/health`; everything else is
> stubbed. See [PLAN.md](PLAN.md) for the full roadmap and
> [CLAUDE.md](CLAUDE.md) for the session entry guide.

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
uv sync --extra dev --extra desktop          # later: also `--extra ml`
pnpm install

# 2. Run the FastAPI backend + Next.js dev server side-by-side
python scripts/run-web.py
# Backend  → http://127.0.0.1:8000/api/health
# Frontend → http://localhost:3000

# 3. Or launch the Pyloid desktop window (auto-builds the static export)
python scripts/run-desktop.py

# 4. Build an unsigned release binary for the current OS
python scripts/build-release.py --clean
# Artifact: dist/VRL YOLO GUI.app  (macOS)
#        or dist/VRL YOLO GUI.exe  (Windows)
```

## License

VRL YOLO GUI is dual-licensed:

- **[AGPL-3.0-or-later](LICENSE)** — default, free for AGPL-compatible use.
- **[Commercial license](COMMERCIAL-LICENSE.md)** — for closed-source or
  SaaS use. Buyers must procure their own Ultralytics Enterprise license
  separately.

See [NOTICE](NOTICE) for upstream component licenses.

## Author

Atul Tiwari — <atultiwari.in@gmail.com> — [@atultiwari](https://github.com/atultiwari)
