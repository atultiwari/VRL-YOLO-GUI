#!/usr/bin/env python3
"""Run VRL YOLO GUI in web mode (backend + frontend).

  Backend  → http://127.0.0.1:8000  (FastAPI, --reload)
  Frontend → http://localhost:3000  (Next.js dev server)

Usage:
    python scripts/run-web.py
    python scripts/run-web.py --clean   # wipe ./data first
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    WEB_STORAGE_DEFAULT,
    banner,
    ensure_node_deps,
    ensure_python_deps,
    info,
    pnpm,
    popen,
    supervised,
    uv_run,
    wipe_storage,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch VRL YOLO GUI in web mode")
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Wipe ./data before starting",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ensure_python_deps(desktop=False)
    ensure_node_deps()

    if args.clean:
        banner("Cleaning local web storage")
        wipe_storage(WEB_STORAGE_DEFAULT, label="web storage")

    banner("Starting VRL YOLO GUI (web mode)")
    info("Backend:  http://127.0.0.1:8000")
    info("Frontend: http://localhost:3000")
    info("Press Ctrl+C to stop both processes")

    backend = popen(
        [*uv_run(), "uvicorn", "server.main:app", "--reload", "--port", "8000"],
        label="backend",
    )
    frontend = popen(
        [pnpm(), "--filter", "./apps/web", "dev"],
        label="frontend",
    )

    result = supervised([(backend, "backend"), (frontend, "frontend")])
    if result is not None:
        proc, label = result
        info(f"[{label}] exited with code {proc.returncode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
