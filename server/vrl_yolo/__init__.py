"""VRL YOLO GUI — clinician-facing YOLO toolkit for histopathology and hematology."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version as _pkg_version


def _resolve_version() -> str:
    """Read the live version from pyproject.toml's installed metadata.

    Falls back to a placeholder when the package isn't installed at all
    (rare — usually means someone is running unit tests against the
    source tree without `uv sync`).
    """
    try:
        return _pkg_version("vrl-yolo-gui")
    except PackageNotFoundError:
        return "0.0.0+source"


__version__ = _resolve_version()
