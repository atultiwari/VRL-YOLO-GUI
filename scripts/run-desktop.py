#!/usr/bin/env python3
"""Run VRL YOLO GUI as a native desktop app.

Auto-detects the current OS (macOS / Windows / Linux), ensures the
Next.js static export and Pyloid are present, then launches
`src-pyloid/main.py` which opens the Qt WebView window.

Usage:
    python scripts/run-desktop.py                  # use existing static export
    python scripts/run-desktop.py --rebuild        # rebuild static export first
    python scripts/run-desktop.py --clean-build    # wipe .next + out, then rebuild
    python scripts/run-desktop.py --clean          # wipe local desktop storage
    python scripts/run-desktop.py --clean --clean-build  # both — fresh start

Flag cheat sheet:
    --clean        wipes the user data dir (Application Support / AppData /
                   ~/.local/share). Use when you want to reset settings,
                   imported models, or trained-run outputs.
    --clean-build  wipes apps/web/.next + apps/web/out. Use after a code
                   change the dev server is stubbornly caching, or to test
                   the cold-build path the release pipeline takes.
    --rebuild      forces a rebuild without first wiping caches. Faster
                   than --clean-build when the cache is fine but you want
                   to re-run the build step explicitly.
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
    wipe_build_artifacts,
    wipe_storage,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch VRL YOLO GUI desktop app")
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Force a fresh `pnpm --filter web build` before launching.",
    )
    parser.add_argument(
        "--clean-build",
        action="store_true",
        help=(
            "Wipe apps/web/.next and apps/web/out before launching — "
            "the next build runs from a cold cache. Implies --rebuild."
        ),
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Wipe the desktop user-data directory (Application Support / AppData).",
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

    if args.clean_build:
        banner("Cleaning frontend build cache")
        wipe_build_artifacts(web=True)

    # --clean-build always implies a rebuild (we just nuked the static export);
    # --rebuild stays as an explicit knob for the cache-is-fine-but-rerun case.
    if args.clean_build or args.rebuild or not has_static_export():
        build_static_export()
    else:
        info("Using existing static export at apps/web/out/")

    info("Launching Pyloid window…")
    cmd = [*uv_run(), "python", str(ROOT / "src-pyloid" / "main.py")]
    return subprocess.call(cmd, cwd=str(ROOT))


if __name__ == "__main__":
    raise SystemExit(main())
