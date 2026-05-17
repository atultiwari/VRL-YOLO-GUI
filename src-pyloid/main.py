"""Desktop-mode entry point.

Boots an embedded uvicorn server in a background thread and opens a Pyloid
window pointed at it. The first deliverable of Phase 0 is that running
`python src-pyloid/main.py` opens a working desktop window — even if the
frontend is an empty Next.js shell.

Run with:
    uv run python src-pyloid/main.py

The Next.js static export must have been built first:
    VRL_YOLO_GUI_BUILD=desktop pnpm --filter web build
"""

from __future__ import annotations

import multiprocessing
import os
import socket
import sys
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))


def _pick_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _resolve_storage_root() -> Path:
    """Per-OS data root that doesn't trip a TCC permission prompt.

    `~/Documents` is protected on macOS — unsigned/unnotarized apps that
    launch from Finder can't trigger the permission prompt cleanly, so
    `mkdir` fails and the app dies before the window appears. Use the
    OS-conventional Application Support / AppData / XDG location instead.

    Override with `VRL_YOLO_GUI_STORAGE_PATH` if you want a custom location.
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


def _resolve_static_frontend() -> Path:
    """Locate apps/web/out — either in source layout (dev) or PyInstaller bundle."""
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        candidate = Path(bundled) / "apps" / "web" / "out"
        if candidate.is_dir():
            return candidate
    return ROOT / "apps" / "web" / "out"


def _resolve_splash_path() -> Path:
    """Locate splash.png in either the PyInstaller bundle or the source tree."""
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        candidate = Path(bundled) / "splash.png"
        if candidate.is_file():
            return candidate
    return ROOT / "src-pyloid" / "splash.png"


class _NullSplash:
    """No-op splash, used outside PyInstaller bundles (dev runs are fast)."""

    def update(self, msg: str) -> None: ...
    def close_after(self, window=None) -> None: ...


class _PyiSplash:
    """Thin wrapper around PyInstaller's `pyi_splash` (Windows / Linux).

    PyInstaller's bootloader puts the splash image on screen before the
    Python interpreter is even initialised, so this module is only
    importable inside a `--splash`-bundled binary — hence the ImportError
    fallback below.
    """

    def __init__(self) -> None:
        try:
            import pyi_splash  # type: ignore[import-not-found]
            self._mod = pyi_splash
        except ImportError:
            self._mod = None

    def update(self, msg: str) -> None:
        if self._mod is None:
            return
        try:
            self._mod.update_text(msg)
        except Exception:  # noqa: BLE001 — splash failure must never kill the app
            pass

    def close_after(self, window=None) -> None:
        if self._mod is None:
            return
        try:
            self._mod.close()
        except Exception:  # noqa: BLE001
            pass


def _install_macos_shutdown_workaround() -> None:
    """Skip the Qt 6 + QtWebEngine static-destructor crash on macOS quit.

    Symptom: `EXC_BAD_ACCESS (SIGSEGV) / KERN_INVALID_ADDRESS at 0x0` when
    the user closes the app, in `QSurface::~QSurface` ->
    `QOpenGLContext::currentContext` -> `QThreadStorageData::get`.

    Root cause: AppKit's `-[NSApplication terminate:]` (menu Cmd+Q or red
    close) calls libc `exit()` after the last QWindow closes. `exit()`
    runs `__cxa_finalize_ranges` over the dyld image graph, which
    eventually drops the deleteLater'd `QWebEngineView` from Pyloid's
    `closeEvent` handler. That destruction chain calls `QSurface::~` ->
    `QOpenGLContext::currentContext()`, which queries `QThreadStorage`
    — but `QThreadStorage`'s own static destructor has already run by
    then. The read deref's a null pointer and the process aborts.

    Fix: hook `QCoreApplication::aboutToQuit`, which is emitted
    synchronously *inside* `QCoreApplication::quit()` before AppKit's
    `exit()` actually fires, and call `os._exit(0)` to skip the entire
    Python/Qt static-destructor chain. The line-buffered launch.log
    captures any final step prints before the process is reaped.
    """
    if sys.platform != "darwin":
        return
    try:
        from PySide6.QtCore import Qt
        from PySide6.QtWidgets import QApplication
    except ImportError:
        return

    app = QApplication.instance()
    if app is None:
        return

    def _hard_exit() -> None:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:  # noqa: BLE001
            pass
        print("step: aboutToQuit — bypassing static-destructor crash via os._exit")
        os._exit(0)

    app.aboutToQuit.connect(_hard_exit, type=Qt.ConnectionType.DirectConnection)


def _setup_splash():
    """Construct the right splash for the current runtime.

    - Dev (unfrozen): no-op — startup is fast enough that a splash would
      just flicker and annoy.
    - Frozen on Windows / Linux: hand off to PyInstaller's pre-Python
      bootloader splash via `pyi_splash`.
    - Frozen on macOS: no native splash. The macOS Dock-bouncing icon plus
      the inline HTML loader in `apps/web/app/layout.tsx` (visible the
      moment the Pyloid window paints) together cover the gap.
    """
    if not getattr(sys, "frozen", False):
        return _NullSplash()
    if sys.platform == "win32" or sys.platform.startswith("linux"):
        return _PyiSplash()
    return _NullSplash()


def _setup_frozen_logging() -> Path | None:
    """When the binary is PyInstaller-frozen and launched from Finder/Dock,
    there is no controlling terminal — any traceback otherwise goes to
    /dev/null and the app appears to die silently. Redirect stdout + stderr
    to a log file under the storage root so silent crashes leave a trail.
    """
    if not getattr(sys, "frozen", False):
        return None
    try:
        log_dir = _resolve_storage_root() / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / "launch.log"
        fp = open(log_file, "a", buffering=1)  # line-buffered
        sys.stdout = fp
        sys.stderr = fp
        print()
        print(f"=== launch {datetime.now(timezone.utc).isoformat()} ===")
        print(f"sys.executable: {sys.executable}")
        print(f"sys._MEIPASS:   {getattr(sys, '_MEIPASS', None)}")
        print(f"platform:       {sys.platform}")
        print(f"cwd:            {os.getcwd()}")
        return log_file
    except Exception:  # noqa: BLE001
        return None


def _resolve_bundled_models() -> Path:
    """Locate the bundled `models/` directory — source layout (dev) or
    PyInstaller bundle.
    """
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        candidate = Path(bundled) / "models"
        if candidate.is_dir():
            return candidate
    return ROOT / "models"


def _build_settings():
    from vrl_yolo.config import Settings  # noqa: E402

    storage_root = _resolve_storage_root()
    storage_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        mode="desktop",
        storage_path=storage_root,
        static_frontend_path=_resolve_static_frontend(),
        bundled_models_path=_resolve_bundled_models(),
        max_upload_mb=500,
    )


def _start_backend(app, port: int) -> threading.Thread:
    import uvicorn  # noqa: E402

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    return thread


def main() -> int:
    """Build settings, boot uvicorn, open the Pyloid window."""
    splash = _setup_splash()

    splash.update("Loading runtime…")
    print("step: import pyloid")
    try:
        from pyloid import Pyloid
    except ImportError as exc:
        splash.close_after()
        print(f"pyloid import failed: {exc}")
        sys.stderr.write(
            "Pyloid is not installed. Install desktop extras:\n"
            "    uv sync --extra desktop\n"
        )
        return 1

    splash.update("Loading API…")
    print("step: import vrl_yolo.api.create_app")
    from vrl_yolo.api import create_app  # noqa: E402

    splash.update("Preparing storage…")
    print("step: build settings")
    settings = _build_settings()
    print(f"  storage_path:  {settings.storage_path}")
    print(f"  static path:   {settings.static_frontend_path}")
    static_exists = Path(str(settings.static_frontend_path)).is_dir() if settings.static_frontend_path else False
    print(f"  static exists: {static_exists}")

    splash.update("Starting backend…")
    print("step: create_app + lifespan startup")
    app = create_app(settings)

    port = _pick_port()
    print(f"step: start uvicorn on 127.0.0.1:{port}")
    _start_backend(app, port)

    splash.update("Opening window…")
    print("step: construct Pyloid window")
    pyloid = Pyloid(app_name="VRL-YOLO-GUI", single_instance=True)

    _install_macos_shutdown_workaround()

    window = pyloid.create_window(
        title="VRL YOLO GUI — Histopathology and Hematology",
        width=1400,
        height=900,
    )
    window.load_url(f"http://127.0.0.1:{port}")

    splash.close_after(window)
    window.show_and_focus()
    print("step: pyloid.run() — entering main loop")
    pyloid.run()
    print("step: pyloid.run() returned — exiting cleanly")
    return 0


def _wrapped_main() -> int:
    log_file = _setup_frozen_logging()
    try:
        return main()
    except SystemExit:
        raise
    except BaseException:  # noqa: BLE001
        traceback.print_exc()
        if log_file:
            sys.stderr.write(f"\nfatal — full traceback at {log_file}\n")
        return 1


if __name__ == "__main__":
    # CRITICAL: must be the first thing executed in a frozen PyInstaller
    # bundle. Ultralytics / torch DataLoader workers spawn via multiprocessing,
    # which on macOS uses the "spawn" start method — that re-executes
    # `sys.executable`, which in a `.app` bundle is the bundle's main binary.
    # Without freeze_support() each worker boots a full second copy of the
    # app (uvicorn, Pyloid window, the lot) before the single-instance lock
    # has a chance to refuse it.
    multiprocessing.freeze_support()
    raise SystemExit(_wrapped_main())
