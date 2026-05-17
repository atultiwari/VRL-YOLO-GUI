"use client";

import * as React from "react";
import { useDropzone, type Accept } from "react-dropzone";
import { FolderOpen, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".bmp",
  ".webp",
]);

const IMAGE_ACCEPT: Accept = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/tiff": [".tif", ".tiff"],
  "image/bmp": [".bmp"],
  "image/webp": [".webp"],
};

function isHiddenOrOsFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.startsWith(".") || name === "thumbs.db" || name === "desktop.ini";
}

function isImageFile(file: File): boolean {
  if (isHiddenOrOsFile(file)) return false;
  const dot = file.name.toLowerCase().lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(file.name.toLowerCase().slice(dot));
}

export type FolderDropzoneMode = "images" | "any";

export interface FolderDropzoneProps {
  onFolder: (files: File[]) => void;
  recursive: boolean;
  className?: string;
  /**
   * "images" (default) → MIME-filtered to JPG/PNG/TIFF/BMP/WebP. Right for
   *   Predict folder mode, where uploading a stray data.yaml is just noise.
   * "any" → no MIME filter; accepts every file in the dropped folder
   *   except hidden / OS-metadata. Right for the Train wizard, which needs
   *   to receive `data.yaml`, `*.txt` YOLO labels, `annotations.json`,
   *   `*.xml` VOC annotations etc. alongside images. Switching the
   *   dropzone away from this mode was the v0.6.0 regression that made
   *   Roboflow YOLO datasets show up as "Unknown layout" — the data.yaml
   *   was never uploaded because the MIME accept rejected it at the
   *   browser level.
   */
  mode?: FolderDropzoneMode;
}

export function FolderDropzone({
  onFolder,
  recursive,
  className,
  mode = "images",
}: FolderDropzoneProps) {
  const filterFile = React.useCallback(
    (f: File): boolean => {
      if (isHiddenOrOsFile(f)) return false;
      if (mode === "images" && !isImageFile(f)) return false;
      return true;
    },
    [mode],
  );

  // react-dropzone's useDropzone supports folders but its filtering is per-
  // file, not aware of directory depth — we get a flat File[] back. For
  // "recursive vs root only" we look at file.webkitRelativePath (set by both
  // <input webkitdirectory> AND by react-dropzone's drag-folder handling)
  // and reject any file that lives in a nested directory when recursive=false.
  const onDrop = React.useCallback(
    (acceptedFiles: File[]) => {
      const filtered = acceptedFiles.filter((f) => {
        if (!filterFile(f)) return false;
        if (recursive) return true;
        const rel = (f as File & { webkitRelativePath?: string })
          .webkitRelativePath;
        if (!rel) return true; // top-level files via direct drop have no rel path
        // Top of dropped folder: <rootFolder>/<file.ext>  → one slash
        // Nested:                <rootFolder>/<sub>/<file.ext> → two+ slashes
        return rel.split("/").length <= 2;
      });
      if (filtered.length) onFolder(filtered);
    },
    [onFolder, recursive, filterFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // For "any" mode we drop the accept filter entirely so the browser
    // surfaces every file in the directory. Even with `accept` set,
    // react-dropzone wouldn't *fail* a drop with mixed types, but the
    // browser's file picker would gray out everything that doesn't match
    // — which is exactly the wrong UX for a training-dataset upload.
    accept: mode === "images" ? IMAGE_ACCEPT : undefined,
    multiple: true,
    noClick: false,
    // Tells react-dropzone to ask the browser for directory contents
    // instead of treating a dropped folder as one mystery item.
    useFsAccessApi: false,
  });

  const inputProps = getInputProps();

  const hintLine =
    mode === "any"
      ? "Images, data.yaml, .txt labels, .json / .xml annotations — anything in the folder. Hidden + OS files skipped."
      : "JPEG · PNG · TIFF · BMP · WebP. Hidden + OS files skipped.";

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-surface-muted bg-surface-subtle p-10 transition",
        "hover:border-accent hover:bg-accent-subtle/40",
        isDragActive && "border-accent bg-accent-subtle/60",
        className,
      )}
    >
      <input
        {...inputProps}
        // @ts-expect-error — webkitdirectory is a Chromium-specific attribute
        // that the React type defs still don't cover. QtWebEngine supports it.
        webkitdirectory=""
        directory=""
      />
      <div className="flex size-12 items-center justify-center rounded-full bg-surface text-accent">
        {isDragActive ? (
          <FolderOpen className="size-6" />
        ) : (
          <Folder className="size-6" />
        )}
      </div>
      <p className="text-sm font-medium text-ink">
        {isDragActive
          ? mode === "any"
            ? "Drop the dataset folder"
            : "Drop the folder to scan its images"
          : "Drop a folder, or click to pick one"}
      </p>
      <p className="text-xs text-ink-muted">
        {hintLine} {recursive ? "Walks subfolders." : "Top level only."}
      </p>
    </div>
  );
}
