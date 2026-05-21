#!/usr/bin/env bash
#
# VRL YOLO GUI — macOS first-launch helper
# ----------------------------------------
#
# Double-click this file in Finder. It removes the macOS quarantine
# attribute from the installed app so Gatekeeper allows it to launch.
#
# Why this is needed: VRL YOLO GUI is unsigned (no Apple Developer
# certificate). When you download the .dmg from GitHub Releases,
# macOS tags every file inside with `com.apple.quarantine`. On first
# launch from /Applications, Gatekeeper sees the unsigned app +
# quarantine tag and refuses to open it. This script removes the
# quarantine tag so future launches work.
#
# Read README-MACOS-FIRST-RUN.txt (in the same folder) for the full
# explanation and the manual alternative.
#

set -e

APP_NAME="VRL YOLO GUI"
APP_PATH="/Applications/${APP_NAME}.app"

# Open a Terminal window with this script's output. The .command
# extension already triggers that on double-click; nothing else
# needed here, but we set the title for clarity.
printf '\033]0;%s\007' "${APP_NAME} — first-launch helper"

cat <<'BANNER'
+--------------------------------------------+
|  VRL YOLO GUI — macOS first-launch helper  |
+--------------------------------------------+

This script removes the macOS quarantine attribute from the
installed app so Gatekeeper allows it to launch.

BANNER

if [ ! -d "${APP_PATH}" ]; then
  cat <<NOT_FOUND
Couldn't find the app at:

    ${APP_PATH}

Drag '${APP_NAME}.app' from this DMG into the /Applications folder
shortcut shown here, then run this script again.

NOT_FOUND
  read -n1 -s -r -p "Press any key to close…"
  echo
  exit 1
fi

echo "Removing quarantine attribute from:"
echo "    ${APP_PATH}"
echo

# `-d` removes a named attribute; `-r` recurses into the bundle so
# every nested file (Python, Qt frameworks, the dist-info we ship
# in v0.8.7+) is cleared too. Quarantine flags on nested binaries
# are what Gatekeeper actually rejects with "nested code is
# modified or invalid".
xattr -dr com.apple.quarantine "${APP_PATH}" || {
  cat <<XATTR_FAIL

Couldn't remove the quarantine attribute. This usually means
you don't have permission to modify the file at:

    ${APP_PATH}

Try:
  1. Move the .app out of /Applications and back in (this clears
     the attribute on some macOS versions).
  2. Or run this in Terminal manually:
     sudo xattr -dr com.apple.quarantine "${APP_PATH}"

XATTR_FAIL
  read -n1 -s -r -p "Press any key to close…"
  echo
  exit 1
}

cat <<DONE

Done. You can now launch '${APP_NAME}' from /Applications or
Launchpad. The first launch may still take 5–10 seconds while
macOS finishes registering the app — that's normal.

DONE

read -n1 -s -r -p "Press any key to close…"
echo
