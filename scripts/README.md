# scripts/

Cross-platform Python entry points for development and release builds.
All scripts share helpers from `_common.py` and target Python 3.11+.

| Script | Purpose |
|---|---|
| `run-desktop.py` | Build the Next.js static export (if missing) and launch the Pyloid window via `src-pyloid/main.py`. |
| `run-web.py` | Launch the FastAPI backend (`server.main:app`) and the Next.js dev server side-by-side. |
| `run-both.py` | Run web mode and desktop mode in parallel — useful for parity testing. |
| `fetch-models.py` | Download the 8 starter weights into `models/{detect,classify}/`. Requires the `ml` extra (`uv sync --extra ml`). |
| `generate-splash.py` | Regenerate `src-pyloid/splash.png`. Run after brand changes. |
| `build-release.py` | Produce an unsigned `.app` (macOS) or `.exe` (Windows) via PyInstaller. Includes the macOS post-build cleanup (devtool strip, Team-ID resign, Info.plist version stamp) from the `python-pyloid-desktop-packaging` skill. |

## Common flags

| Flag | Scripts | What it wipes / does |
|---|---|---|
| `--clean` | `run-desktop`, `run-web`, `run-both` | User-data dir (Application Support / AppData / XDG). |
| `--clean` | `build-release` | `dist/` + `build/` + stale top-level `*.spec`. |
| `--clean-build` | `run-desktop`, `run-web`, `run-both` | `apps/web/.next` + `apps/web/out`. Implies a rebuild (the static export is gone). |
| `--clean-build` | `build-release` | Everything `--clean` wipes **plus** the frontend cache — use before tagging a release. |
| `--rebuild` | `run-desktop`, `run-both` | Re-runs `pnpm --filter web build` without wiping caches first. |
| `--arch-suffix` | `build-release` | Append `arm64` / `x64` / `x86` to the artifact name. |

## Naming convention

The user-facing display name is **VRL YOLO GUI** (with spaces). The
filesystem identifier — storage path, Pyloid single-instance lock, bundle
identifier — is **VRL-YOLO-GUI** (hyphenated). See CLAUDE.md §11.
