#!/usr/bin/env python3
"""Generate `src-pyloid/splash.png`.

The PNG is committed so the build doesn't depend on this being re-run, but
keep this script around so the splash can be regenerated when branding
changes (just edit the constants below and rerun).

Uses PySide6 — already a desktop dependency — so no extra build-time
toolchain is needed.

Usage:
    uv run python scripts/generate-splash.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QFont, QPainter, QPixmap
from PySide6.QtWidgets import QApplication

OUTPUT = Path(__file__).resolve().parent.parent / "src-pyloid" / "splash.png"

WIDTH, HEIGHT = 600, 400
BG = QColor("#0a2540")
FG = QColor("#ffffff")
ACCENT = QColor("#7dd3fc")
DIM = QColor("#94a3b8")


def main() -> int:
    app = QApplication.instance() or QApplication(sys.argv)  # noqa: F841

    pix = QPixmap(WIDTH, HEIGHT)
    pix.fill(BG)

    painter = QPainter(pix)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setRenderHint(QPainter.RenderHint.TextAntialiasing)

    painter.fillRect(WIDTH // 2 - 30, 110, 60, 2, ACCENT)

    painter.setPen(FG)
    painter.setFont(QFont("Helvetica", 32, QFont.Weight.Bold))
    painter.drawText(
        0, 130, WIDTH, 60,
        Qt.AlignmentFlag.AlignCenter,
        "VRL YOLO GUI",
    )

    painter.setPen(ACCENT)
    painter.setFont(QFont("Helvetica", 13))
    painter.drawText(
        0, 198, WIDTH, 24,
        Qt.AlignmentFlag.AlignCenter,
        "Histopathology · Hematology",
    )

    painter.setPen(DIM)
    painter.setFont(QFont("Helvetica", 11))
    painter.drawText(
        0, HEIGHT - 60, WIDTH, 20,
        Qt.AlignmentFlag.AlignCenter,
        "Starting…",
    )

    painter.end()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(OUTPUT), "PNG")
    print(f"wrote: {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
