#!/usr/bin/env python3
"""Run VRL YOLO GUI as both web and desktop simultaneously.

Spawns three processes:
  - Web backend  : uvicorn on http://127.0.0.1:8000
  - Web frontend : Next.js dev server on http://localhost:3000
  - Desktop      : Pyloid window with its own embedded uvicorn

Useful for testing dual-mode parity. Press Ctrl+C to stop everything.
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
    wipe_storage,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run web + desktop in parallel")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild the static export first")
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Wipe BOTH local web data and the desktop storage directory before starting",
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

    if args.rebuild or not has_static_export():
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
