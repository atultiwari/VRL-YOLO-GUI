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

export const PRESET_DEFAULTS: Record<
  Exclude<TrainPreset, "custom">,
  { epochs: number; image_size: number }
> = {
  quick: { epochs: 5, image_size: 640 },
  standard: { epochs: 50, image_size: 640 },
  best: { epochs: 200, image_size: 640 },
};

interface TrainState {
  selectedTask: Task | null;
  dataset: DatasetInfo | null;
  hyperparams: TrainHyperparams;

  setTask: (task: Task | null) => void;
  setDataset: (info: DatasetInfo | null) => void;
  patchHyperparams: (patch: Partial<TrainHyperparams>) => void;
  applyPreset: (preset: TrainPreset) => void;
  reset: () => void;
}

const DEFAULT_HYPERPARAMS: TrainHyperparams = {
  model: null,
  preset: "standard",
  epochs: PRESET_DEFAULTS.standard.epochs,
  image_size: PRESET_DEFAULTS.standard.image_size,
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

      setTask: (task) => set({ selectedTask: task }),
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
          const defaults = PRESET_DEFAULTS[preset];
          return {
            hyperparams: {
              ...state.hyperparams,
              preset,
              epochs: defaults.epochs,
              image_size: defaults.image_size,
            },
          };
        }),
      reset: () =>
        set({
          selectedTask: null,
          dataset: null,
          hyperparams: { ...DEFAULT_HYPERPARAMS },
        }),
    }),
    {
      name: "vrl-yolo-gui.train.v1",
      // We never store File objects (those go to backend); only metadata.
      version: 1,
    },
  ),
);
