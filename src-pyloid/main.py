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
import time
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


# Module-level reference so the event filter survives garbage collection
# after `_install_macos_shutdown_workaround` returns. Qt holds a raw
# pointer via `installEventFilter`, and CPython will free the QObject the
# moment the local goes out of scope — installing a dangling filter
# crashes the next event delivery.
_quit_event_filter = None


def _macos_hard_exit(reason: str) -> None:
    """Flush stdio, log why we're exiting, then bypass static destructors.

    Direct call to `os._exit` instead of `sys.exit` so we skip both
    Python's atexit handlers AND C++ static destructors — the latter
    is the whole point of the macOS shutdown workaround.
    """
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass
    print(f"step: {reason} — bypassing static-destructor crash via os._exit")
    os._exit(0)


def _install_macos_shutdown_workaround(window) -> None:  # noqa: ANN001 — pyloid window
    """Skip the Qt 6 + QtWebEngine static-destructor crash on macOS quit.

    Symptom: `EXC_BAD_ACCESS (SIGSEGV) / KERN_INVALID_ADDRESS at 0x0` when
    the user closes the app, in `QSurface::~QSurface` ->
    `QOpenGLContext::currentContext` -> `QThreadStorageData::get`, deep
    inside `__cxa_finalize_ranges` triggered by `-[NSApplication terminate:]`.

    Root cause (refined on macOS 26.x with PySide6 6.9 + Pyloid 0.27):
    AppKit's `-[NSApplication terminate:]` from the menu Cmd+Q routes
    through Qt's Cocoa platform plugin, which sends a `QEvent::Quit` to
    QApplication. That triggers `tryCloseAllWidgetWindows`, which fires
    `closeEvent` on every top-level widget. Pyloid's BrowserWindow
    closeEvent calls `QCoreApplication.quit()` — which on macOS routes
    BACK through `libqcocoa` and re-enters `[NSApplication terminate:]`
    recursively. That second terminate proceeds straight to libc
    `exit()` without unwinding back to `QCoreApplication::exec()`'s
    cleanup pass — which is where `aboutToQuit` is actually emitted.
    `exit()` then runs `__cxa_finalize_ranges`, the deferred WebView
    delete from Pyloid's closeEvent fires, `QSurface::~` queries
    `QThreadStorage` whose static destructor has already run, and the
    process aborts on a null deref.

    Fix: install a `QEvent::Close` event filter scoped to the Pyloid
    window's underlying QMainWindow (NOT the QApplication). That close
    event fires immediately before Pyloid's `closeEvent` runs — same
    moment in the cascade, but the filter never sees the unrelated
    events that QWebEngineView / QQuickWidget exchange during
    construction. Catching it here and `os._exit(0)`-ing means we
    never run Pyloid's closeEvent, never call `QCoreApplication.quit()`,
    never re-enter terminate, never reach `__cxa_finalize_ranges`.

    We also keep an `aboutToQuit` fallback for code paths that DO
    unwind through `exec()` (e.g. a SIGTERM signal handler that calls
    `app.quit()` from a normal context) — that hook costs nothing
    extra when the event-filter intercept fires first.

    NB: an earlier attempt installed the filter on `QApplication` to
    catch `QEvent::Quit` instead. That filter sees every event for
    every object, and broke Pyloid's QWebEngineView construction
    (window never finished initialising; process exited silently
    between create_window and pyloid.run). Window-scoped filtering
    sidesteps that entirely.

    NB2: the parent `python-pyloid-desktop-packaging` skill historically
    documented `aboutToQuit` alone as sufficient. That hook doesn't fire
    on the Cmd+Q path because of the re-entrant terminate described
    above. The skill should be updated separately to reflect both that
    finding and the QApplication-event-filter trap.
    """
    if sys.platform != "darwin":
        return
    try:
        from PySide6.QtCore import QEvent, QObject, Qt
        from PySide6.QtWidgets import QApplication, QMainWindow
    except ImportError:
        return

    app = QApplication.instance()
    if app is None:
        print("step: macOS shutdown workaround skipped — no QApplication instance")
        return

    # Resolve `QEvent::Close` once at install time. Use both the explicit
    # enum and the legacy attribute so we don't fail per-event if a
    # future PySide6 reorganises these.
    close_type = getattr(getattr(QEvent, "Type", QEvent), "Close", None)
    if close_type is None:
        print("step: macOS shutdown workaround skipped — QEvent.Close not resolvable")
        return

    # Pyloid wraps the underlying QMainWindow at `window._window._window`
    # on 0.27: the outer object is a `BrowserWindow` Python wrapper, the
    # inner `_window` is a `_BrowserWindow` Python facade, and ITS
    # `_window` is the actual QMainWindow. Walk up to three nested
    # `_window` attributes looking for one that is_a QMainWindow — that
    # tolerates the wrapper shifting one level deeper or shallower across
    # Pyloid releases without us guessing field names.
    qmain = None
    candidate = window
    for _ in range(4):
        if isinstance(candidate, QMainWindow):
            qmain = candidate
            break
        candidate = getattr(candidate, "_window", None)
        if candidate is None:
            break
    if qmain is None:
        print(
            "step: macOS shutdown workaround skipped — could not locate underlying "
            f"QMainWindow on {type(window).__name__!r}"
        )
        return

    class _CloseEventFilter(QObject):
        def __init__(self) -> None:
            super().__init__()

        def eventFilter(self, _obj, event) -> bool:  # noqa: ANN001 — Qt signature
            try:
                if event.type() == close_type:
                    _macos_hard_exit("QEvent.Close intercepted")
            except Exception as exc:  # noqa: BLE001 — never crash event dispatch
                print(f"step: closeEvent filter error (non-fatal): {exc}")
            return False

    global _quit_event_filter
    _quit_event_filter = _CloseEventFilter()
    qmain.installEventFilter(_quit_event_filter)
    print(
        "step: macOS shutdown workaround installed "
        f"(QEvent::Close filter on {type(qmain).__name__} + aboutToQuit fallback)"
    )

    app.aboutToQuit.connect(
        lambda: _macos_hard_exit("aboutToQuit fallback"),
        type=Qt.ConnectionType.DirectConnection,
    )


def _maybe_install_auto_quit_for_test() -> None:
    """Test-only: trigger a graceful Cmd+Q-equivalent after N seconds.

    Set `VRL_YOLO_GUI_TEST_AUTO_QUIT_S=3` in the environment to schedule
    a `QApplication.quit()` call N seconds after the main loop starts —
    useful for verifying the macOS shutdown workaround on a headless dev
    machine where you can't actually hit Cmd+Q. Unset / removed in
    production runs.
    """
    raw = os.environ.get("VRL_YOLO_GUI_TEST_AUTO_QUIT_S")
    if not raw:
        return
    try:
        delay_s = float(raw)
    except ValueError:
        return
    try:
        from PySide6.QtCore import QTimer
        from PySide6.QtWidgets import QApplication
    except ImportError:
        return
    app = QApplication.instance()
    if app is None:
        return
    delay_ms = max(0, int(delay_s * 1000))
    print(f"step: TEST auto-quit scheduled in {delay_s}s via QApplication.quit()")
    # Use a fresh QTimer (not singleShot static) so we keep a Python
    # reference and Qt doesn't GC the connection mid-flight.
    timer = QTimer()
    timer.setSingleShot(True)
    timer.timeout.connect(lambda: (print("step: TEST timer fired — calling QApplication.quit()"), app.quit()))
    timer.start(delay_ms)
    global _test_auto_quit_timer
    _test_auto_quit_timer = timer


_test_auto_quit_timer = None


def _install_download_handler() -> None:
    """Auto-accept QtWebEngine downloads into ~/Downloads.

    QtWebEngine **silently drops** downloads (anchor with `download=`,
    `window.location = blob:...`, server-side `Content-Disposition:
    attachment`) unless something connects to the profile's
    `downloadRequested` signal and calls `.accept()`. A regular browser
    has Chrome's download manager on the other end of that signal; the
    Pyloid window doesn't, so clicking the CSV / XLSX / PDF export
    buttons in /predict appeared to do nothing.

    This hook makes the buttons actually deliver a file:

    1. Resolve the destination directory (`~/Downloads`, creating it
       if missing — usually present on macOS / Windows but not always
       on Linux).
    2. Pick a unique filename — if `vrl-yolo-detect-...csv` already
       exists, fall through to `vrl-yolo-detect-... (1).csv`, etc.
    3. Call `download.accept()`.
    4. Log the destination via `step:` print so launch.log shows where
       the file went.

    Native save dialog is out of scope here — the goal is "files
    actually appear", not "files appear at the user's chosen path".
    Switching to a native QFileDialog is a P7 polish item.
    """
    try:
        from PySide6.QtWebEngineCore import QWebEngineProfile
    except ImportError:
        return

    profile = QWebEngineProfile.defaultProfile()
    if profile is None:
        return

    downloads_dir = Path.home() / "Downloads"

    def _on_download_requested(download) -> None:  # noqa: ANN001 — PySide6 typing varies
        try:
            downloads_dir.mkdir(parents=True, exist_ok=True)
            suggested = download.suggestedFileName() or "vrl-yolo-download"
            base = Path(suggested)
            dest = downloads_dir / base.name
            counter = 1
            stem, ext = dest.stem, dest.suffix
            while dest.exists():
                dest = downloads_dir / f"{stem} ({counter}){ext}"
                counter += 1
            download.setDownloadDirectory(str(dest.parent))
            download.setDownloadFileName(dest.name)
            download.accept()
            print(f"step: download accepted -> {dest}")
        except Exception as exc:  # noqa: BLE001 — never let a download crash the app
            print(f"step: download handler error: {exc}")

    profile.downloadRequested.connect(_on_download_requested)
    print("step: download handler installed (Downloads dir: {})".format(downloads_dir))


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


def _start_backend(app, port: int):
    """Spawn uvicorn on a daemon thread and return (thread, server).

    The `server` handle is what we wait on — uvicorn flips
    `server.started` to True only after the lifespan startup completes
    AND the listener socket is bound, which is the exact signal we need
    before calling `window.load_url`.
    """
    import uvicorn  # noqa: E402

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    return thread, server


def _wait_for_backend(server, *, timeout_s: float = 10.0) -> bool:
    """Block until `uvicorn.Server.started` flips True, or `timeout_s` elapses.

    Required because the main thread (which constructs the Pyloid window
    and calls `load_url`) races uvicorn's startup on the daemon thread.
    Loading the URL before uvicorn binds the socket produces Chromium's
    ERR_CONNECTION_REFUSED page — the symptom that motivated this poll
    loop in the first place.

    Returns True if the server became ready, False on timeout. Polling
    interval is intentionally short (50 ms): once startup work was
    moved out of the lifespan, the typical wait is < 500 ms.
    """
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if server.started:
            return True
        time.sleep(0.05)
    return False


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
    _, backend_server = _start_backend(app, port)

    splash.update("Waiting for backend…")
    print(f"step: wait for backend on 127.0.0.1:{port}")
    wait_start = time.monotonic()
    if _wait_for_backend(backend_server, timeout_s=10.0):
        print(f"  backend ready in {(time.monotonic() - wait_start) * 1000:.0f} ms")
    else:
        # Don't bail — load the URL anyway so the user sees the
        # Chromium error page and can hit Reload after the backend
        # belatedly comes up. The launch.log still has the timeline.
        print("  WARNING: backend not ready after 10 s; loading URL anyway")

    splash.update("Opening window…")
    print("step: construct Pyloid window")
    pyloid = Pyloid(app_name="VRL-YOLO-GUI", single_instance=True)

    _install_download_handler()

    window = pyloid.create_window(
        title="VRL YOLO GUI — Histopathology and Hematology",
        width=1400,
        height=900,
    )
    window.load_url(f"http://127.0.0.1:{port}")

    # MUST run after create_window: the filter is scoped to the window's
    # underlying QMainWindow, which doesn't exist until create_window
    # returns. An earlier attempt installed an app-wide QEvent::Quit
    # filter before the window was built; it broke QWebEngineView
    # construction and the app exited silently before pyloid.run().
    _install_macos_shutdown_workaround(window)
    _maybe_install_auto_quit_for_test()

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


def _maybe_dispatch_subprocess() -> None:
    """Re-route subprocess invocations to the right entry point.

    PyInstaller's bootloader ALWAYS runs the script that was bundled as
    the entry point. `[sys.executable, "-m", "vrl_yolo.engine.train_runner"]`
    works in dev (where `sys.executable` is a real Python) but in a
    frozen `.app` bundle the bootloader ignores `-m module` and just
    re-runs `main.py` — which boots a second Pyloid window and leaves
    the parent's JobManager waiting forever for training events that
    never arrive. v0.8.3 had exactly that bug.

    Fix: JobManager sets `VRL_YOLO_GUI_SUBPROCESS=train_runner` in the
    child env; we read it here at boot and dispatch to the runner's
    `main()` directly, skipping the entire Pyloid / uvicorn boot.
    Identical behaviour in dev and frozen — the subprocess only ever
    runs training code, never Pyloid.

    Must run AFTER `multiprocessing.freeze_support()`: if we're a
    multiprocessing-spawn worker (Ultralytics DataLoader, torch dist,
    etc.) `freeze_support()` handles dispatch internally and never
    returns. Belt-and-braces: also bail out if multiprocessing protocol
    args appear in argv, in case a future Python release changes when
    `freeze_support()` actually intercepts them.
    """
    if any(a.startswith("--multiprocessing-fork") for a in sys.argv):
        return
    role = os.environ.get("VRL_YOLO_GUI_SUBPROCESS")
    if role == "train_runner":
        from vrl_yolo.engine.train_runner import main as runner_main
        raise SystemExit(runner_main())


if __name__ == "__main__":
    # CRITICAL: must be the first thing executed in a frozen PyInstaller
    # bundle. Ultralytics / torch DataLoader workers spawn via multiprocessing,
    # which on macOS uses the "spawn" start method — that re-executes
    # `sys.executable`, which in a `.app` bundle is the bundle's main binary.
    # Without freeze_support() each worker boots a full second copy of the
    # app (uvicorn, Pyloid window, the lot) before the single-instance lock
    # has a chance to refuse it.
    multiprocessing.freeze_support()
    _maybe_dispatch_subprocess()
    raise SystemExit(_wrapped_main())
