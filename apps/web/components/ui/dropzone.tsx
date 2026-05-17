"use client";

import * as React from "react";
import { useDropzone, type Accept } from "react-dropzone";
import { ImageUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DropzoneProps {
  onFile: (file: File) => void;
  accept?: Accept;
  maxSizeMb?: number;
  className?: string;
  hint?: string;
}

const DEFAULT_ACCEPT: Accept = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/tiff": [".tif", ".tiff"],
  "image/bmp": [".bmp"],
  "image/webp": [".webp"],
};

export function Dropzone({
  onFile,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = 50,
  className,
  hint = "JPEG, PNG, TIFF, BMP, WebP — up to 50 MB.",
}: DropzoneProps) {
  const onDrop = React.useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles[0]) onFile(acceptedFiles[0]);
    },
    [onFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxSize: maxSizeMb * 1024 * 1024,
    multiple: false,
  });

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
      <input {...getInputProps()} />
      <div className="flex size-12 items-center justify-center rounded-full bg-surface text-accent">
        <ImageUp className="size-6" />
      </div>
      <p className="text-sm font-medium text-ink">
        {isDragActive ? "Drop the image to load it" : "Drop a slide patch, or click to browse"}
      </p>
      <p className="text-xs text-ink-muted">{hint}</p>
    </div>
  );
}
