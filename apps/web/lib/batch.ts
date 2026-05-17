/**
 * Frontend batch runner — orchestrates folder inference by calling the
 * existing `/api/inference/single` endpoint once per file.
 *
 * Why client-side iteration instead of a server `/api/inference/batch`?
 * - Single-user desktop app: there's no multi-tenant queue to share.
 * - The registry already LRU-caches the loaded YOLO instance, so back-
 *   to-back single-image calls hit warm weights (~50–100 ms each on MPS).
 * - We get cancel + progress for free via AbortController + a callback.
 * A proper streaming batch endpoint lands when Train mode (P4) needs
 * the same WebSocket machinery anyway.
 */

import { inferSingle } from "./api";
import type { InferenceResponse } from "./types";

export interface BatchProgress {
  /** 0-indexed position of the file just finished (or just started, on `phase:"start"`). */
  current: number;
  total: number;
  filename: string;
  /** "start" fires before inferSingle; "done" fires after it returns. */
  phase: "start" | "done";
}

export interface BatchResultItem {
  /** Original filename as it appeared in the dropped folder. */
  filename: string;
  /** Index in the input File[]. */
  index: number;
  /** Inference response, or null if the file failed. */
  result: InferenceResponse | null;
  /** Error message when result is null. */
  error?: string;
  /** Wall-clock duration including network round-trip, in ms. */
  duration_ms: number;
}

export interface RunBatchArgs {
  files: File[];
  model: string;
  conf: number;
  iou: number;
  signal?: AbortSignal;
  onProgress?: (p: BatchProgress) => void;
  onItem?: (r: BatchResultItem) => void;
}

/**
 * Sequentially run inference over `files`, emitting per-file progress and
 * results via callbacks. Returns the full result list once done, or as far
 * as it got if `signal` was aborted (no exception in that case).
 *
 * Concurrency cap = 1 on purpose. Ultralytics inference is GPU/MPS-bound;
 * fanning out 4 parallel requests just queues them at the model lock and
 * makes the UI lie about progress. Re-evaluate if we ever serve from a
 * multi-GPU host.
 */
export async function runBatch({
  files,
  model,
  conf,
  iou,
  signal,
  onProgress,
  onItem,
}: RunBatchArgs): Promise<BatchResultItem[]> {
  const out: BatchResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) break;
    const file = files[i];
    onProgress?.({ current: i, total: files.length, filename: file.name, phase: "start" });

    const start = performance.now();
    try {
      const result = await inferSingle({ image: file, model, conf, iou });
      const item: BatchResultItem = {
        filename: file.name,
        index: i,
        result,
        duration_ms: performance.now() - start,
      };
      out.push(item);
      onItem?.(item);
    } catch (err) {
      const item: BatchResultItem = {
        filename: file.name,
        index: i,
        result: null,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: performance.now() - start,
      };
      out.push(item);
      onItem?.(item);
    }

    onProgress?.({ current: i + 1, total: files.length, filename: file.name, phase: "done" });
  }

  return out;
}

// --- aggregate helpers --------------------------------------------------

export interface DetectAggregate {
  task: "detect";
  totalImages: number;
  totalBoxes: number;
  perClass: { class_name: string; count: number; maxConf: number }[];
  failed: number;
}

export interface ClassifyAggregate {
  task: "classify";
  totalImages: number;
  perClass: { class_name: string; count: number; meanConf: number }[];
  flaggedCount: number;
  failed: number;
}

export type BatchAggregate = DetectAggregate | ClassifyAggregate;

/**
 * Roll up per-image results into a single panel-friendly summary.
 * Task is inferred from the first non-null result; mixed-task batches
 * are impossible because the model is fixed across the run.
 */
export function aggregate(
  items: BatchResultItem[],
  reviewThreshold: number,
): BatchAggregate | null {
  const successes = items.filter((i) => i.result !== null);
  const failed = items.length - successes.length;
  if (!successes.length) return null;

  const firstTask = successes[0].result!.task;

  if (firstTask === "detect") {
    const counts = new Map<string, { count: number; maxConf: number }>();
    let totalBoxes = 0;
    for (const item of successes) {
      const r = item.result!;
      if (r.task !== "detect") continue;
      for (const b of r.boxes) {
        totalBoxes++;
        const prior = counts.get(b.class_name);
        if (!prior) {
          counts.set(b.class_name, { count: 1, maxConf: b.conf });
        } else {
          prior.count += 1;
          if (b.conf > prior.maxConf) prior.maxConf = b.conf;
        }
      }
    }
    return {
      task: "detect",
      totalImages: successes.length,
      totalBoxes,
      perClass: [...counts.entries()]
        .map(([class_name, v]) => ({ class_name, ...v }))
        .sort((a, b) => b.count - a.count),
      failed,
    };
  }

  // classify branch
  const acc = new Map<string, { count: number; sumConf: number }>();
  let flagged = 0;
  for (const item of successes) {
    const r = item.result!;
    if (r.task !== "classify") continue;
    const top1 = r.top1;
    if (top1.conf < reviewThreshold) flagged++;
    const prior = acc.get(top1.class_name);
    if (!prior) {
      acc.set(top1.class_name, { count: 1, sumConf: top1.conf });
    } else {
      prior.count += 1;
      prior.sumConf += top1.conf;
    }
  }
  return {
    task: "classify",
    totalImages: successes.length,
    perClass: [...acc.entries()]
      .map(([class_name, v]) => ({
        class_name,
        count: v.count,
        meanConf: v.sumConf / v.count,
      }))
      .sort((a, b) => b.count - a.count),
    flaggedCount: flagged,
    failed,
  };
}
