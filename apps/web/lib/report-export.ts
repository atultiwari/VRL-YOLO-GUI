"use client";

import { downloadReport, type ReportFormat } from "./api";
import type { BatchResultItem } from "./batch";
import type { ReportRequestBody, Task } from "./types";

/**
 * Cap on how many sample images we ship to the PDF endpoint. ReportLab
 * is fast on a handful of JPEGs but inlining 100+ blows up the payload
 * and the PDF rendering time. 12 is the largest grid that still fits
 * sensibly on A4 with readable thumbnails.
 */
const PDF_SAMPLE_LIMIT = 12;

/**
 * Resize an image File to a max edge (default 480 px) and return base64
 * JPEG bytes (no data: prefix). Keeps the PDF payload bounded even
 * when the user drops 4K tissue scans into folder mode.
 */
async function imageToCappedBase64(file: File, maxEdge = 480): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/jpeg",
      0.82,
    ),
  );
  const buf = await blob.arrayBuffer();
  return _arrayBufferToBase64(buf);
}

function _arrayBufferToBase64(buffer: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/**
 * Build the JSON payload for /api/reports/<format>. When `format === "pdf"`,
 * resize + base64-encode up to PDF_SAMPLE_LIMIT representative images so
 * the report has a thumbnail grid. CSV and XLSX skip this step.
 */
async function buildReportBody(
  task: Task,
  model: string,
  items: BatchResultItem[],
  files: File[],
  reviewThreshold: number,
  format: ReportFormat,
): Promise<ReportRequestBody> {
  const successful = items.filter((i) => i.result !== null);
  // Pick representative samples for the PDF — first N completed images
  // is the safest default; nothing clever to bias toward "interesting"
  // patches without re-running inference, which is out of scope here.
  const sampleIndices = new Set<number>(
    format === "pdf"
      ? successful.slice(0, PDF_SAMPLE_LIMIT).map((i) => i.index)
      : [],
  );

  const reportItems = await Promise.all(
    items.map(async (item) => {
      const r = item.result;
      const base = {
        filename: item.filename,
        inference_ms: r?.inference_ms ?? 0,
      };
      let image_b64: string | undefined;
      if (sampleIndices.has(item.index)) {
        try {
          image_b64 = await imageToCappedBase64(files[item.index]);
        } catch {
          /* corrupt or unreadable file — skip the thumbnail, keep the row */
        }
      }

      if (!r) {
        return { ...base, image_b64 };
      }

      if (r.task === "detect") {
        return {
          ...base,
          boxes: r.boxes.map((b) => ({ class_name: b.class_name, conf: b.conf })),
          counts_per_class: r.counts_per_class,
          image_b64,
        };
      }
      // classify
      return {
        ...base,
        top1: r.top1
          ? { class_name: r.top1.class_name, conf: r.top1.conf }
          : null,
        top5: r.top5.map((p) => ({ class_name: p.class_name, conf: p.conf })),
        image_b64,
      };
    }),
  );

  return {
    task,
    model,
    items: reportItems,
    review_threshold: reviewThreshold,
  };
}

export async function exportBatchReport(args: {
  format: ReportFormat;
  task: Task;
  model: string;
  items: BatchResultItem[];
  files: File[];
  reviewThreshold: number;
}): Promise<string> {
  const body = await buildReportBody(
    args.task,
    args.model,
    args.items,
    args.files,
    args.reviewThreshold,
    args.format,
  );
  return downloadReport(args.format, body);
}
