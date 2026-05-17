#!/usr/bin/env python3
"""Download the 8 starter weights into models/{detect,classify}/.

Per PLAN.md §7 the v1 binary ships with 8 starter weights — YOLO26 nano +
small for both detection and classification, with YOLOv8 nano + small as
fallback. Total ~80 MB. These are downloaded on demand (NOT committed to
git) and bundled into the PyInstaller binary at packaging time.

Usage:
    uv run python scripts/fetch-models.py            # all 8
    uv run python scripts/fetch-models.py --task detect
    uv run python scripts/fetch-models.py --family yolo26
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import ROOT, banner, err, info  # noqa: E402

MODELS = [
    ("detect", "yolo26n.pt"),
    ("detect", "yolo26s.pt"),
    ("detect", "yolov8n.pt"),
    ("detect", "yolov8s.pt"),
    ("classify", "yolo26n-cls.pt"),
    ("classify", "yolo26s-cls.pt"),
    ("classify", "yolov8n-cls.pt"),
    ("classify", "yolov8s-cls.pt"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch starter YOLO weights")
    parser.add_argument(
        "--task",
        choices=["detect", "classify"],
        help="Only fetch weights for one task",
    )
    parser.add_argument(
        "--family",
        choices=["yolo26", "yolov8"],
        help="Only fetch weights for one model family",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download even if the file already exists",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        err("ultralytics is not installed — run `uv sync --extra ml` first")
        return 1

    targets = [
        (task, name)
        for task, name in MODELS
        if (args.task is None or task == args.task)
        and (args.family is None or name.startswith(args.family))
    ]
    if not targets:
        err("no models matched the filters")
        return 1

    banner(f"Fetching {len(targets)} weight file(s)")

    for task, name in targets:
        dest_dir = ROOT / "models" / task
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / name
        if dest.exists() and not args.force:
            info(f"{dest.relative_to(ROOT)} already present — skipping")
            continue
        info(f"downloading {name} → {dest.relative_to(ROOT)}")
        try:
            # YOLO(...) downloads weights to the current working directory by
            # default. We pass an explicit name; Ultralytics resolves it to
            # the CDN URL and downloads alongside the running script. Move
            # the result into the expected location.
            YOLO(name)  # triggers download into CWD
            downloaded = Path(name)
            if downloaded.exists() and downloaded != dest:
                downloaded.replace(dest)
        except Exception as exc:  # noqa: BLE001
            err(f"failed to download {name}: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
