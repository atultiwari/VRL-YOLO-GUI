"""Shared helpers for the runtime scripts.

Cross-platform: macOS / Linux / Windows. Pure stdlib.
"""

from __future__ import annotations

import os
import platform
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent


def detect_os() -> str:
    """Return one of 'macos', 'windows', 'linux'."""
    p = platform.system().lower()
    if p == "darwin":
        return "macos"
    if p == "windows":
        return "windows"
    return "linux"


IS_WINDOWS = detect_os() == "windows"


def require_command(name: str, hint: str) -> str:
    path = shutil.which(name)
    if not path:
        sys.stderr.write(f"[error] '{name}' not found on PATH.\n  hint: {hint}\n")
        sys.exit(1)
    return path


def banner(msg: str) -> None:
    print(f"\n\033[1;36m▶ {msg}\033[0m", flush=True)


def info(msg: str) -> None:
    print(f"  {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"\033[1;33m[warn]\033[0m {msg}", flush=True)


def err(msg: str) -> None:
    print(f"\033[1;31m[error]\033[0m {msg}", flush=True)


def popen(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    label: str | None = None,
) -> subprocess.Popen:
    if label:
        info(f"spawn [{label}]: {' '.join(cmd)}  (cwd={cwd or ROOT})")
    kwargs: dict = {
        "cwd": str(cwd or ROOT),
        "env": {**os.environ, **(env or {})},
    }
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(cmd, **kwargs)


def terminate(proc: subprocess.Popen, label: str = "child") -> None:
    if proc.poll() is not None:
        return
    info(f"terminating [{label}] (pid {proc.pid})")
    try:
        if IS_WINDOWS:
            proc.send_signal(signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, OSError):
        return
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        warn(f"[{label}] did not exit cleanly; killing")
        try:
            if IS_WINDOWS:
                proc.kill()
            else:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass


def supervised(
    procs: Iterable[tuple[subprocess.Popen, str]],
) -> tuple[subprocess.Popen, str] | None:
    procs = list(procs)
    first_dead: list[tuple[subprocess.Popen, str]] = []
    interrupted = False

    def waiter(p: subprocess.Popen, label: str) -> None:
        p.wait()
        first_dead.append((p, label))

    threads = [
        threading.Thread(target=waiter, args=(p, label), daemon=True)
        for p, label in procs
    ]
    for t in threads:
        t.start()
    try:
        while not first_dead:
            for t in threads:
                t.join(timeout=0.25)
                if first_dead:
                    break
    except KeyboardInterrupt:
        info("interrupted by user")
        interrupted = True
    finally:
        for p, label in procs:
            terminate(p, label)

    if interrupted:
        return None
    return first_dead[0] if first_dead else None


def uv_run() -> list[str]:
    uv_path = shutil.which("uv")
    if uv_path:
        return [uv_path, "run"]
    return [sys.executable, "-m"]


def pnpm() -> str:
    return require_command(
        "pnpm",
        "install pnpm: `npm install -g pnpm` or see https://pnpm.io",
    )


def has_static_export() -> bool:
    return (ROOT / "apps" / "web" / "out" / "index.html").is_file()


def build_static_export() -> None:
    pnpm_cmd = pnpm()
    banner("Building Next.js static export (desktop bundle)")
    env = {"VRL_YOLO_GUI_BUILD": "desktop"}
    subprocess.run(
        [pnpm_cmd, "--filter", "./apps/web", "build"],
        cwd=str(ROOT),
        env={**os.environ, **env},
        check=True,
    )


def ensure_node_deps() -> None:
    if (ROOT / "apps" / "web" / "node_modules").is_dir() or (ROOT / "node_modules").is_dir():
        return
    pnpm_cmd = pnpm()
    banner("Installing frontend dependencies (one-time)")
    subprocess.run([pnpm_cmd, "install"], cwd=str(ROOT), check=True)


def ensure_python_deps(*, desktop: bool = False, ml: bool = False) -> None:
    uv_path = shutil.which("uv")
    if not uv_path:
        warn("uv not found — assuming the active venv already has the deps")
        return
    if (ROOT / ".venv").is_dir():
        return
    banner("Installing Python dependencies (one-time)")
    extras = ["--extra", "dev"]
    if desktop:
        extras += ["--extra", "desktop"]
    if ml:
        extras += ["--extra", "ml"]
    subprocess.run([uv_path, "sync", *extras], cwd=str(ROOT), check=True)


def desktop_storage_default() -> Path:
    """Per-OS storage root used by --clean. Mirrors server/vrl_yolo/paths.py."""
    home = Path.home()
    p = detect_os()
    if p == "macos":
        return home / "Library" / "Application Support" / "VRL-YOLO-GUI"
    if p == "windows":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / "VRL-YOLO-GUI"
        return home / "AppData" / "Roaming" / "VRL-YOLO-GUI"
    xdg = os.environ.get("XDG_DATA_HOME") or str(home / ".local" / "share")
    return Path(xdg) / "vrl-yolo-gui"


WEB_STORAGE_DEFAULT = ROOT / "data"
DESKTOP_STORAGE_DEFAULT = desktop_storage_default()


def wipe_storage(path: Path, *, label: str) -> None:
    path = path.expanduser()
    if path.is_dir():
        info(f"wiping {label}: {path}")
        shutil.rmtree(path)
    else:
        info(f"{label} already absent: {path}")
