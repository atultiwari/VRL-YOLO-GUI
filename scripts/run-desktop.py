#!/usr/bin/env python3
"""Run VRL YOLO GUI as a native desktop app.

Auto-detects the current OS (macOS / Windows / Linux), ensures the
Next.js static export and Pyloid are present, then launches
`src-pyloid/main.py` which opens the Qt WebView window.

Usage:
    python scripts/run-desktop.py            # use existing static export
    python scripts/run-desktop.py --rebuild  # rebuild static export first
    python scripts/run-desktop.py --clean    # wipe local desktop storage first
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    DESKTOP_STORAGE_DEFAULT,
    ROOT,
    banner,
    build_static_export,
    detect_os,
    ensure_node_deps,
    ensure_python_deps,
    has_static_export,
    info,
    uv_run,
    wipe_storage,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch VRL YOLO GUI desktop app")
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Force a fresh `pnpm --filter web build` before launching",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Wipe the desktop storage directory before launching",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    os_name = detect_os()
    banner(f"VRL YOLO GUI (desktop, {os_name})")

    ensure_python_deps(desktop=True)
    ensure_node_deps()

    if args.clean:
        banner("Cleaning local desktop storage")
        wipe_storage(DESKTOP_STORAGE_DEFAULT, label="desktop storage")

    if args.rebuild or not has_static_export():
        build_static_export()
    else:
        info("Using existing static export at apps/web/out/")

    info("Launching Pyloid window…")
    cmd = [*uv_run(), "python", str(ROOT / "src-pyloid" / "main.py")]
    return subprocess.call(cmd, cwd=str(ROOT))


if __name__ == "__main__":
    raise SystemExit(main())
