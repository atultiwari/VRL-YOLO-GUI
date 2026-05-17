from __future__ import annotations

import platform
import sys

from fastapi import APIRouter

from vrl_yolo import __version__

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Smoke-test endpoint — returns version + runtime info for diagnostics."""
    return {
        "status": "ok",
        "version": __version__,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
    }
