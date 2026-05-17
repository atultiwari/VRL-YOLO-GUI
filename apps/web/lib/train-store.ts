"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { DatasetInfo, Task } from "./types";

/**
 * Train-wizard preset → hyperparam defaults. PLAN.md §9 calls these out
 * by name; the configure page picks one and lets the user override
 * individual fields (slipping into "custom" mode in the process).
 */
export type TrainPreset = "quick" | "standard" | "best" | "custom";

export interface TrainHyperparams {
  model: string | null;
  preset: TrainPreset;
  epochs: number;
  image_size: number;
  batch_size: number;
}

/**
 * Per-task preset defaults. Detect uses 640px (YOLO's standard input
 * size for COCO-shaped data); classify uses 224px (matches ImageNet
 * pretraining and what `yolo*-cls.pt` was distilled at). Epochs are the
 * same across tasks — classification typically converges faster, but
 * we'd rather let the user notice that and shorten the run themselves
 * than risk under-training.
 */
export const PRESET_DEFAULTS: Record<
  Task,
  Record<Exclude<TrainPreset, "custom">, { epochs: number; image_size: number }>
> = {
  detect: {
    quick: { epochs: 5, image_size: 640 },
    standard: { epochs: 50, image_size: 640 },
    best: { epochs: 200, image_size: 640 },
  },
  classify: {
    quick: { epochs: 5, image_size: 224 },
    standard: { epochs: 50, image_size: 224 },
    best: { epochs: 200, image_size: 224 },
  },
};

interface TrainState {
  selectedTask: Task | null;
  dataset: DatasetInfo | null;
  hyperparams: TrainHyperparams;
  /**
   * Currently-streaming job. We persist this so a refresh on /train/run
   * picks up the stream right where it left off — the WebSocket replays
   * past events on reconnect so the chart redraws fully.
   */
  activeJobId: string | null;

  setTask: (task: Task | null) => void;
  setDataset: (info: DatasetInfo | null) => void;
  patchHyperparams: (patch: Partial<TrainHyperparams>) => void;
  applyPreset: (preset: TrainPreset) => void;
  setActiveJob: (jobId: string | null) => void;
  reset: () => void;
}

const DEFAULT_HYPERPARAMS: TrainHyperparams = {
  model: null,
  preset: "standard",
  // Detect-default seed values. setTask() rewrites these for the
  // chosen task before the user lands on /train/configure.
  epochs: PRESET_DEFAULTS.detect.standard.epochs,
  image_size: PRESET_DEFAULTS.detect.standard.image_size,
  // Filled in from /api/hardware on the configure page. 8 is a sane
  // localStorage-rehydration fallback (matches MPS default).
  batch_size: 8,
};

/**
 * Zustand store for the Train wizard state.
 *
 * Persisted to localStorage so a refresh / accidental close → reopen
 * doesn't force the doctor to re-upload a multi-hundred-MB dataset.
 * If the dataset has since been deleted from `<storage_root>/datasets/`
 * (e.g. via a "Reset desktop storage" run), the configure page will
 * detect that via a 404 on `/api/datasets/{id}` and offer to re-upload.
 */
export const useTrainStore = create<TrainState>()(
  persist(
    (set) => ({
      selectedTask: null,
      dataset: null,
      hyperparams: { ...DEFAULT_HYPERPARAMS },
      activeJobId: null,

      setTask: (task) =>
        set((state) => {
          // Re-seed epochs + imgsz from the new task's "standard" preset so
          // switching detect → classify doesn't leave 640px from the old task
          // staring at the user on the configure page.
          if (task && state.selectedTask !== task) {
            const presetForTask =
              state.hyperparams.preset === "custom"
                ? "standard"
                : state.hyperparams.preset;
            const defaults = PRESET_DEFAULTS[task][presetForTask];
            return {
              selectedTask: task,
              hyperparams: {
                ...state.hyperparams,
                model: null,
                preset: presetForTask,
                epochs: defaults.epochs,
                image_size: defaults.image_size,
              },
            };
          }
          return { selectedTask: task };
        }),
      setDataset: (info) => set({ dataset: info }),
      patchHyperparams: (patch) =>
        set((state) => {
          const next = { ...state.hyperparams, ...patch };
          // Touching anything other than `preset` drops us into "custom".
          if (!("preset" in patch)) {
            const keysOtherThanPreset = Object.keys(patch).filter(
              (k) => k !== "preset",
            );
            if (keysOtherThanPreset.length > 0) {
              next.preset = "custom";
            }
          }
          return { hyperparams: next };
        }),
      applyPreset: (preset) =>
        set((state) => {
          if (preset === "custom") {
            return { hyperparams: { ...state.hyperparams, preset } };
          }
          // Per-task preset defaults — classify uses 224px not 640.
          const task: Task = state.selectedTask ?? "detect";
          const defaults = PRESET_DEFAULTS[task][preset];
          return {
            hyperparams: {
              ...state.hyperparams,
              preset,
              epochs: defaults.epochs,
              image_size: defaults.image_size,
            },
          };
        }),
      setActiveJob: (jobId) => set({ activeJobId: jobId }),
      reset: () =>
        set({
          selectedTask: null,
          dataset: null,
          hyperparams: { ...DEFAULT_HYPERPARAMS },
          activeJobId: null,
        }),
    }),
    {
      name: "vrl-yolo-gui.train.v1",
      // We never store File objects (those go to backend); only metadata.
      version: 1,
    },
  ),
);
