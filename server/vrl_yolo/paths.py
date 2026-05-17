from __future__ import annotations

import os
import sys
from pathlib import Path


def resolve_storage_root() -> Path:
    """Per-OS data root that doesn't trip a TCC permission prompt.

    `~/Documents` is protected on macOS — unsigned/unnotarized apps that
    launch from Finder can't trigger the permission prompt cleanly, so
    `mkdir` fails and the app dies before the window appears. Use the
    OS-conventional Application Support / AppData / XDG location instead.

    Override with the env var resolved by `Settings(storage_path=...)`.
    """
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "VRL-YOLO-GUI"
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / "VRL-YOLO-GUI"
        return home / "AppData" / "Roaming" / "VRL-YOLO-GUI"
    xdg = os.environ.get("XDG_DATA_HOME") or str(home / ".local" / "share")
    return Path(xdg) / "vrl-yolo-gui"


def user_models_dir(storage_root: Path | None = None) -> Path:
    """Directory holding user-imported and locally-trained .pt files."""
    root = storage_root or resolve_storage_root()
    return root / "models"


def training_runs_dir(storage_root: Path | None = None) -> Path:
    """Directory Ultralytics writes training runs into."""
    root = storage_root or resolve_storage_root()
    return root / "runs"


def logs_dir(storage_root: Path | None = None) -> Path:
    root = storage_root or resolve_storage_root()
    return root / "logs"
