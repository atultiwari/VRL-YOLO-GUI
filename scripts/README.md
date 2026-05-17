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

- `--clean` — wipe local storage / build output before starting.
- `--rebuild` — force a fresh `pnpm --filter web build` (run-desktop / run-both).
- `--arch-suffix` — append `arm64` / `x64` to the artifact name (build-release).

## Naming convention

The user-facing display name is **VRL YOLO GUI** (with spaces). The
filesystem identifier — storage path, Pyloid single-instance lock, bundle
identifier — is **VRL-YOLO-GUI** (hyphenated). See CLAUDE.md §11.
