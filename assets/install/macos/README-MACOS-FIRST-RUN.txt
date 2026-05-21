VRL YOLO GUI — First-Launch Instructions for macOS
====================================================

Two steps to get the app running. Total time: ~30 seconds.

Step 1. Install the app
-----------------------

Drag "VRL YOLO GUI.app" into the Applications folder shortcut
shown in this DMG window. Wait for the copy to finish.

Step 2. Clear the macOS quarantine flag
---------------------------------------

Double-click "install.command" (also in this DMG window). A
Terminal window opens and runs a one-line cleanup. Press any
key to close it when it's done.

That's it — launch "VRL YOLO GUI" from Launchpad or
/Applications. The first launch takes ~5-10 seconds while macOS
finishes registering the app. Subsequent launches are instant.

---

Why this extra step is needed (the short version)
-------------------------------------------------

VRL YOLO GUI is an open-source clinical tool, distributed under
AGPL-3.0 from a public GitHub repository. We don't sign the .app
with an Apple Developer certificate (signing costs $99/year and
adds review friction for a tool that's meant to be inspectable
end-to-end).

When you download an unsigned app from the internet, macOS adds a
"quarantine" attribute to every file inside the bundle. On first
launch, Gatekeeper sees the unsigned nested binaries (Python,
Qt, etc.) and refuses to open the app — usually with a dialog
that says something like:

    "VRL YOLO GUI" cannot be opened because Apple cannot
    check it for malicious software.

The install.command script removes the quarantine attribute so
Gatekeeper allows the launch. The app's behaviour and source code
are unchanged — we're only telling macOS "I trust this download."

---

If you'd rather not run the script
----------------------------------

You can do the same thing manually three different ways:

Option A. Right-click → Open (one-time)
  1. Open /Applications in Finder.
  2. Right-click (or Ctrl-click) "VRL YOLO GUI".
  3. Pick "Open" from the menu.
  4. Click "Open" in the confirmation dialog.

  macOS records an exception for this exact .app, so future
  double-clicks work normally. (If you re-download the .dmg
  later, you'll need to repeat this for the new copy.)

Option B. System Settings → Privacy & Security
  1. Double-click the .app first — macOS will refuse to open it.
  2. Open System Settings → Privacy & Security.
  3. Scroll down to the message about "VRL YOLO GUI" being
     blocked.
  4. Click "Open Anyway".
  5. Confirm in the dialog that follows.

Option C. Terminal command (what install.command runs)
  Open Terminal.app and paste:

      xattr -dr com.apple.quarantine "/Applications/VRL YOLO GUI.app"

  Press Enter. No output = success. Launch the app normally.

---

If the install.command script fails
-----------------------------------

The script needs permission to modify files under /Applications.
If it errors with "Operation not permitted":

  1. Move "VRL YOLO GUI.app" out of /Applications (drag it to
     the Desktop, then drag it back). Some macOS versions clear
     the quarantine attribute as a side effect of the move.
  2. Or open Terminal.app and run the script's command with
     sudo:

         sudo xattr -dr com.apple.quarantine "/Applications/VRL YOLO GUI.app"

     You'll be asked for your login password.

---

About the app
-------------

VRL YOLO GUI is a clinician-facing desktop toolkit for YOLO
detection and classification in histopathology and hematology.
Drop a folder of slide patches, get annotated images or a
prediction table + PDF. Train your own models locally or on a
free Google Colab GPU.

  - Source code: https://github.com/atultiwari/VRL-YOLO-GUI
  - Issues:      https://github.com/atultiwari/VRL-YOLO-GUI/issues
  - License:     AGPL-3.0-or-later (LICENSE file in repo)

If anything goes wrong on first launch, check:

  ~/Library/Application Support/VRL-YOLO-GUI/logs/launch.log

That file captures every launch attempt that got past Gatekeeper.
Attach it to any GitHub issue you file.
