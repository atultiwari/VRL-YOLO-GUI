#!/usr/bin/env python3
"""Run VRL YOLO GUI as both web and desktop simultaneously.

Spawns three processes:
  - Web backend  : uvicorn on http://127.0.0.1:8000
  - Web frontend : Next.js dev server on http://localhost:3000
  - Desktop      : Pyloid window with its own embedded uvicorn

Useful for testing dual-mode parity. Press Ctrl+C to stop everything.

Usage:
    python scripts/run-both.py
    python scripts/run-both.py --rebuild       # rebuild static export first
    python scripts/run-both.py --clean-build   # wipe .next + out, then rebuild
    python scripts/run-both.py --clean         # wipe BOTH storage dirs
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    DESKTOP_STORAGE_DEFAULT,
    ROOT,
    WEB_STORAGE_DEFAULT,
    banner,
    build_static_export,
    ensure_node_deps,
    ensure_python_deps,
    has_static_export,
    info,
    pnpm,
    popen,
    supervised,
    uv_run,
    wipe_build_artifacts,
    wipe_storage,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run web + desktop in parallel")
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Force a fresh `pnpm --filter web build` before starting.",
    )
    parser.add_argument(
        "--clean-build",
        action="store_true",
        help=(
            "Wipe apps/web/.next + apps/web/out before starting — both the "
            "Next.js dev server and the embedded Pyloid backend get a "
            "freshly-rebuilt static export. Implies --rebuild."
        ),
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Wipe BOTH the local web data dir and the desktop storage dir.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ensure_python_deps(desktop=True)
    ensure_node_deps()

    if args.clean:
        banner("Cleaning local storage (web + desktop)")
        wipe_storage(WEB_STORAGE_DEFAULT, label="web storage")
        wipe_storage(DESKTOP_STORAGE_DEFAULT, label="desktop storage")

    if args.clean_build:
        banner("Cleaning frontend build cache")
        wipe_build_artifacts(web=True)

    if args.clean_build or args.rebuild or not has_static_export():
        build_static_export()

    banner("Starting web (backend+frontend) and desktop in parallel")
    info("Web backend  : http://127.0.0.1:8000")
    info("Web frontend : http://localhost:3000")
    info("Desktop      : Pyloid window")
    info("Press Ctrl+C to stop all three")

    backend = popen(
        [*uv_run(), "uvicorn", "server.main:app", "--port", "8000"],
        label="web-backend",
    )
    frontend = popen(
        [pnpm(), "--filter", "./apps/web", "dev"],
        label="web-frontend",
    )
    desktop = popen(
        [*uv_run(), "python", str(ROOT / "src-pyloid" / "main.py")],
        label="desktop",
    )

    result = supervised(
        [
            (backend, "web-backend"),
            (frontend, "web-frontend"),
            (desktop, "desktop"),
        ]
    )
    if result is not None:
        proc, label = result
        info(f"[{label}] exited with code {proc.returncode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
