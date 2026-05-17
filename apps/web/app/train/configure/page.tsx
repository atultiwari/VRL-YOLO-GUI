"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Cpu,
  Database,
  Gauge,
  Play,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ClassNamesEditor } from "@/components/train/class-names-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import {
  ApiError,
  fetchDataset,
  fetchHardware,
  fetchModels,
  startTraining,
} from "@/lib/api";
import { useTrainStore, type TrainPreset } from "@/lib/train-store";
import type { DatasetInfo, HardwareInfo } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

const IMAGE_SIZES = [320, 416, 512, 608, 640, 768, 896, 1024, 1280];

const PRESET_CHOICES: { value: TrainPreset; label: string; description: string }[] = [
  {
    value: "quick",
    label: "Quick",
    description: "5 epochs · sanity check before a longer run",
  },
  {
    value: "standard",
    label: "Standard",
    description: "50 epochs · most clinical datasets converge here",
  },
  {
    value: "best",
    label: "Best",
    description: "200 epochs · expect 1-3 hours on a GPU / overnight on CPU",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Drive every knob yourself",
  },
];

export default function TrainConfigurePage() {
  const router = useRouter();
  const {
    selectedTask,
    dataset,
    hyperparams,
    setDataset,
    patchHyperparams,
    applyPreset,
    setActiveJob,
  } = useTrainStore();
  const [startError, setStartError] = useState<string | null>(null);

  // If we got here without a dataset (e.g. fresh tab, store hydrated but
  // dataset was cleared by a "Reset desktop storage"), redirect back.
  // The store's persist middleware kicks in on mount, so wait a tick.
  useEffect(() => {
    if (!selectedTask) {
      router.replace("/train");
    } else if (!dataset) {
      router.replace("/train/dataset");
    }
  }, [selectedTask, dataset, router]);

  // Re-fetch the dataset from disk on mount so the user can see if the
  // backend has the dataset they think they have. If the backend says
  // 404 (e.g. storage was wiped), drop the stale store entry and bounce.
  useQuery({
    queryKey: ["dataset", dataset?.id],
    queryFn: () => fetchDataset(dataset!.id),
    enabled: !!dataset,
    retry: 1,
    staleTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const { data: hardware, isLoading: hwLoading } = useQuery({
    queryKey: ["hardware", "detect", hyperparams.image_size],
    queryFn: () => fetchHardware({ task: "detect", imgsz: hyperparams.image_size }),
    staleTime: 60_000,
  });

  const { data: modelsData, isLoading: modelsLoading } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
  });
  const detectModels = useMemo(
    () => modelsData?.models.filter((m) => m.task === "detect") ?? [],
    [modelsData],
  );

  // Pick a default model the first time we land — prefer the saved
  // detect default, else the first detect model in the registry.
  useEffect(() => {
    if (hyperparams.model || detectModels.length === 0) return;
    const def = modelsData?.defaults.detect ?? detectModels[0]?.name;
    if (def) patchHyperparams({ model: def });
  }, [hyperparams.model, detectModels, modelsData, patchHyperparams]);

  // Adopt the hardware suggestion the FIRST time we have one. Once the
  // user moves the slider, the store flips preset to "custom" and we
  // stop overwriting their choice.
  useEffect(() => {
    if (!hardware) return;
    if (hyperparams.preset === "custom") return;
    // Only apply if it actually changed — avoid an infinite state loop.
    if (hyperparams.batch_size === hardware.suggested_batch_size) return;
    patchHyperparams({ batch_size: hardware.suggested_batch_size, preset: hyperparams.preset });
  }, [hardware, hyperparams.preset, hyperparams.batch_size, patchHyperparams]);

  const modelOptions = detectModels.map((m) => ({
    value: m.name,
    label: `${m.name}  ·  ${m.num_classes} cls  ·  ${formatBytes(m.size_mb)}`,
  }));

  const start = useMutation({
    mutationFn: async () => {
      if (!dataset) throw new Error("no dataset");
      if (!hyperparams.model) throw new Error("pick a model first");
      return startTraining({
        dataset_id: dataset.id,
        model: hyperparams.model,
        epochs: hyperparams.epochs,
        imgsz: hyperparams.image_size,
        batch: hyperparams.batch_size,
      });
    },
    onSuccess: (res) => {
      setStartError(null);
      setActiveJob(res.job_id);
      router.push("/train/run");
    },
    onError: (err) => {
      setStartError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to start training",
      );
    },
  });

  if (!dataset) return null;

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Train · step 3 of 3 · configure
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            Pick a model and a budget.
          </h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Preset picks a sensible epochs + image size combo for common
            workflows. Touch any individual slider to drop into Custom.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/train/dataset")}>
          <ArrowLeft className="size-4" /> Change dataset
        </Button>
      </header>

      <DatasetSummary dataset={dataset} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <ClassNamesEditor dataset={dataset} onDatasetChanged={setDataset} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-accent" />
                Model &amp; preset
              </CardTitle>
              <CardDescription>
                Starting weights and the rough length of the run.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                label="Starting weights"
                value={hyperparams.model ?? undefined}
                options={modelOptions}
                onChange={(v) => patchHyperparams({ model: v })}
                placeholder={modelsLoading ? "Loading…" : "Pick a model"}
                emptyText="No detection models — run scripts/fetch-models.py --task detect"
              />
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Preset
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PRESET_CHOICES.map((p) => {
                    const isActive = hyperparams.preset === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => applyPreset(p.value)}
                        className={cn(
                          "flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-sm transition",
                          isActive
                            ? "border-accent bg-accent-subtle"
                            : "border-surface-muted bg-surface hover:border-accent",
                        )}
                      >
                        <span className="font-medium text-ink">{p.label}</span>
                        <span className="text-xs text-ink-muted">{p.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="size-4 text-accent" />
                Hyperparameters
              </CardTitle>
              <CardDescription>
                Override anything to enter Custom mode.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Slider
                label="Epochs"
                value={hyperparams.epochs}
                min={1}
                max={500}
                step={1}
                format={(v) => v.toFixed(0)}
                onChange={(v) => patchHyperparams({ epochs: Math.round(v) })}
                hint="Single pass over the training set per epoch."
              />
              <ImageSizeSelect
                value={hyperparams.image_size}
                onChange={(v) => patchHyperparams({ image_size: v })}
              />
              <Slider
                label="Batch size"
                value={hyperparams.batch_size}
                min={1}
                max={64}
                step={1}
                format={(v) => v.toFixed(0)}
                onChange={(v) => patchHyperparams({ batch_size: Math.round(v) })}
                hint={
                  hardware
                    ? `Suggested ${hardware.suggested_batch_size} for ${hardware.kind.toUpperCase()} at ${hyperparams.image_size}px.`
                    : "Hardware probe pending."
                }
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <HardwareCard hardware={hardware} loading={hwLoading} />
          <SummaryCard />
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        {startError ? (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-800">
            <AlertTriangle className="size-4" />
            {startError}
          </div>
        ) : null}
        <Button
          size="lg"
          disabled={
            !hyperparams.model ||
            dataset.format === "unknown" ||
            start.isPending
          }
          onClick={() => start.mutate()}
        >
          {start.isPending ? (
            <>
              <Spinner /> Starting…
            </>
          ) : (
            <>
              <Play className="size-4" /> Start training{" "}
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

function DatasetSummary({ dataset }: { dataset: DatasetInfo }) {
  const totalImages = dataset.splits.reduce((acc, s) => acc + s.image_count, 0);
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-accent-subtle text-accent">
            <Database className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-ink">
              {dataset.format.replace("_", " ").toUpperCase()} · {totalImages.toLocaleString()} images
              {dataset.classes.length ? ` · ${dataset.classes.length} classes` : ""}
            </p>
            <p className="text-xs text-ink-muted">
              <code className="rounded bg-surface-muted px-1 py-0.5">{dataset.id}</code>
            </p>
          </div>
        </div>
        {dataset.warnings.length ? (
          <Badge tone="warning">
            <AlertTriangle className="mr-1 size-3" />
            {dataset.warnings.length} warning{dataset.warnings.length === 1 ? "" : "s"}
          </Badge>
        ) : (
          <Badge tone="clinical">looks good</Badge>
        )}
      </CardContent>
    </Card>
  );
}

function ImageSizeSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        Image size
      </label>
      <div className="flex flex-wrap gap-1.5">
        {IMAGE_SIZES.map((sz) => {
          const isActive = sz === value;
          return (
            <button
              key={sz}
              type="button"
              onClick={() => onChange(sz)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums transition",
                isActive
                  ? "border-accent bg-accent-subtle text-accent"
                  : "border-surface-muted bg-surface text-ink hover:border-accent",
              )}
            >
              {sz}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-ink-muted">
        Patches are resized to this on every side. 640 is YOLO&apos;s default;
        higher = more memory, slightly slower, marginally better small-object recall.
      </span>
    </div>
  );
}

function HardwareCard({
  hardware,
  loading,
}: {
  hardware: HardwareInfo | undefined;
  loading: boolean;
}) {
  const kindLabel: Record<HardwareInfo["kind"], string> = {
    cuda: "NVIDIA GPU",
    mps: "Apple Silicon",
    cpu: "CPU",
  };
  const kindTone = (k: HardwareInfo["kind"]) =>
    k === "cpu" ? "warning" : "clinical";
  const hw = hardware;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="size-4 text-accent" />
          Hardware
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {loading || !hw ? (
          <span className="inline-flex items-center gap-2 text-ink-muted">
            <Spinner /> probing accelerator…
          </span>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Backend</span>
              <Badge tone={kindTone(hw.kind)}>
                <Zap className="mr-1 size-3" />
                {kindLabel[hw.kind]}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Device</span>
              <span className="max-w-[200px] truncate font-medium text-ink">{hw.name}</span>
            </div>
            {hw.vram_gb !== null ? (
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">VRAM</span>
                <span className="font-medium text-ink tabular-nums">{hw.vram_gb} GB</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Suggested batch</span>
              <span className="font-medium text-ink tabular-nums">{hw.suggested_batch_size}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCard() {
  const { dataset, hyperparams } = useTrainStore();
  if (!dataset) return null;
  const totalImages = dataset.splits.reduce((acc, s) => acc + s.image_count, 0);
  const stepsPerEpoch = Math.max(1, Math.ceil(totalImages / Math.max(1, hyperparams.batch_size)));
  const totalSteps = stepsPerEpoch * hyperparams.epochs;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run summary</CardTitle>
        <CardDescription>What the training loop will do.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <Row label="Model" value={hyperparams.model ?? "—"} />
        <Row label="Preset" value={hyperparams.preset} />
        <Row label="Epochs" value={hyperparams.epochs.toLocaleString()} />
        <Row label="Image size" value={`${hyperparams.image_size} px`} />
        <Row label="Batch size" value={hyperparams.batch_size.toLocaleString()} />
        <Row label="Steps / epoch" value={stepsPerEpoch.toLocaleString()} />
        <Row label="Total steps" value={totalSteps.toLocaleString()} />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
