"""Cloudflare quick-tunnel wrapper for the Colab training notebooks.

Downloads the `cloudflared` binary on first use (Linux x86_64 only —
Colab's runtime), spawns it pointed at a local FastAPI server, and
returns the public `*.trycloudflare.com` URL parsed from its stdout.

Pattern borrowed from the `yolo-gui` reference project's `start_colab.py`
(`ensure_cloudflared` + `start_tunnel`), but trimmed to the subset
VRL-YOLO-GUI needs: no log files to disk, no `is_colab_runtime` check
(the import already gates that), no IPython display widget.

Quick-tunnels are anonymous (no Cloudflare account / DNS / TLS cert
required). The URL stops resolving as soon as the cell stops, which is
acceptable for the v1 pilot — see `docs/PLAN-P6.md` §4.5 for the
named-tunnel-vs-quick-tunnel tradeoff.
"""

from __future__ import annotations

import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path


CLOUDFLARED_DOWNLOAD_URL = (
    "https://github.com/cloudflare/cloudflared/releases/latest/"
    "download/cloudflared-linux-amd64"
)
TUNNEL_URL_PATTERN = re.compile(r"https://[-a-zA-Z0-9.]+\.trycloudflare\.com")
TUNNEL_READY_TIMEOUT_S = 90.0


@dataclass(frozen=True)
class TunnelHandle:
    """Live tunnel — keep the cell running to keep the URL alive."""

    url: str
    process: subprocess.Popen

    def alive(self) -> bool:
        return self.process.poll() is None

    def terminate(self) -> None:
        """Best-effort shutdown; the process gets a SIGTERM, then SIGKILL."""
        if self.process.poll() is not None:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()


def ensure_cloudflared(install_dir: Path) -> Path:
    """Locate or download the cloudflared binary, return its path."""
    existing = shutil.which("cloudflared")
    if existing:
        return Path(existing)

    install_dir.mkdir(parents=True, exist_ok=True)
    binary = install_dir / "cloudflared"
    if binary.is_file():
        binary.chmod(0o755)
        return binary

    system = platform.system().lower()
    machine = platform.machine().lower()
    if system != "linux" or machine not in {"x86_64", "amd64"}:
        raise RuntimeError(
            "Auto-download of cloudflared is Colab-only "
            "(Linux x86_64). Found "
            f"{system}/{machine}. Install cloudflared manually and "
            "ensure it is on PATH."
        )

    print(
        "[VRL-YOLO-GUI] Downloading cloudflared "
        f"({CLOUDFLARED_DOWNLOAD_URL})...",
        file=sys.stderr,
        flush=True,
    )
    urllib.request.urlretrieve(CLOUDFLARED_DOWNLOAD_URL, binary)
    binary.chmod(0o755)
    return binary


def start_tunnel(
    *,
    cloudflared: Path,
    local_port: int,
    timeout_s: float = TUNNEL_READY_TIMEOUT_S,
) -> TunnelHandle:
    """Spawn `cloudflared tunnel --url http://127.0.0.1:<port>` and parse the URL.

    Blocks until the `*.trycloudflare.com` URL appears in cloudflared's
    stdout, or raises on timeout / early exit. The returned handle holds
    a live subprocess — callers must keep it referenced (and the Colab
    cell running) so the tunnel doesn't die.
    """
    parsed_url: dict[str, str] = {}
    ready = threading.Event()

    cmd = [
        str(cloudflared),
        "tunnel",
        "--no-autoupdate",
        "--url",
        f"http://127.0.0.1:{local_port}",
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    def _drain_stdout() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            # Always stream to the notebook cell so a stuck tunnel is
            # diagnosable from the cell output.
            print(line, end="", flush=True)
            if "url" not in parsed_url:
                match = TUNNEL_URL_PATTERN.search(line)
                if match:
                    parsed_url["url"] = match.group(0)
                    ready.set()
        # If stdout closes before we saw a URL, unblock the waiter so
        # the caller can raise a meaningful error.
        ready.set()

    threading.Thread(target=_drain_stdout, daemon=True).start()

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if ready.wait(timeout=1):
            break
        if proc.poll() is not None:
            raise RuntimeError(
                "cloudflared exited before printing a tunnel URL "
                f"(exit code {proc.returncode}). Check the cell output."
            )

    if "url" not in parsed_url:
        if proc.poll() is None:
            proc.terminate()
        raise TimeoutError(
            f"No tunnel URL after {timeout_s:.0f}s. Re-run the cell "
            "or check Cloudflare status."
        )

    return TunnelHandle(url=parsed_url["url"], process=proc)
