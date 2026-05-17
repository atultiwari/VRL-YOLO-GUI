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

const ACCEPT: Accept = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/tiff": [".tif", ".tiff"],
  "image/bmp": [".bmp"],
  "image/webp": [".webp"],
};

function isImageFile(file: File): boolean {
  const name = file.name.toLowerCase();
  // Skip hidden / OS-metadata files that Finder + Explorer sprinkle around.
  if (name.startsWith(".") || name === "thumbs.db" || name === "desktop.ini") {
    return false;
  }
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot));
}

export interface FolderDropzoneProps {
  onFolder: (files: File[]) => void;
  recursive: boolean;
  className?: string;
}

export function FolderDropzone({
  onFolder,
  recursive,
  className,
}: FolderDropzoneProps) {
  // react-dropzone's useDropzone supports folders but its filtering is per-
  // file, not aware of directory depth — we get a flat File[] back. For
  // "recursive vs root only" we look at file.webkitRelativePath (set by both
  // <input webkitdirectory> AND by react-dropzone's drag-folder handling)
  // and reject any file that lives in a nested directory when recursive=false.
  const onDrop = React.useCallback(
    (acceptedFiles: File[]) => {
      const filtered = acceptedFiles.filter((f) => {
        if (!isImageFile(f)) return false;
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
    [onFolder, recursive],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: true,
    noClick: false,
    // Critical: tells react-dropzone to ask the browser for directory
    // contents instead of treating a dropped folder as one mystery item.
    useFsAccessApi: false,
  });

  const inputProps = getInputProps();

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
      {/* webkitdirectory makes the file picker browse-folder rather than
          file-picker. react-dropzone's getInputProps gives us the rest. */}
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
          ? "Drop the folder to scan its images"
          : "Drop a folder, or click to pick one"}
      </p>
      <p className="text-xs text-ink-muted">
        JPEG · PNG · TIFF · BMP · WebP. Hidden + OS files skipped.{" "}
        {recursive ? "Walks subfolders." : "Top level only."}
      </p>
    </div>
  );
}
