"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Cloud,
  Cpu,
  Database,
  FileText,
  Gauge,
  Play,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { ClassNamesEditor } from "@/components/train/class-names-editor";
import { ConnectColabModal } from "@/components/train/connect-colab-modal";
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
  rerunTrainingHistoryRow,
  startTraining,
} from "@/lib/api";
import { usePreferredTimezone } from "@/lib/format-date";
import { useTrainStore, type TrainPreset } from "@/lib/train-store";
import { defaultRunName } from "@/lib/training-defaults";
import type { DatasetInfo, HardwareInfo } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

// Detect uses YOLO's 640px-centred ladder; classify is anchored at 224 (the
// distillation size for `yolo*-cls.pt`) with neighbouring power-of-two-ish
// sizes for users who want to push smaller / larger.
const IMAGE_SIZES_BY_TASK: Record<"detect" | "classify", number[]> = {
  detect: [320, 416, 512, 608, 640, 768, 896, 1024, 1280],
  classify: [96, 128, 160, 192, 224, 256, 288, 320, 384],
};

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
  // useSearchParams requires a Suspense boundary in Next.js static
  // export mode (the ?from=<history_id> prefill path was added in F3).
  return (
    <Suspense
      fallback={
        <section className="flex h-full items-center justify-center p-12">
          <Spinner /> Loading…
        </section>
      }
    >
      <_ConfigureInner />
    </Suspense>
  );
}

function _ConfigureInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromHistoryId = searchParams.get("from");
  const {
    selectedTask,
    dataset,
    hyperparams,
    setTask,
    setDataset,
    patchHyperparams,
    applyPreset,
    setActiveJob,
  } = useTrainStore();
  const [startError, setStartError] = useState<string | null>(null);
  const [colabModalOpen, setColabModalOpen] = useState(false);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  // F2: run metadata. Empty `name` = "use the placeholder" (defaultRunName).
  // Empty `description` = "no description set" (server clears).
  const [runName, setRunName] = useState("");
  const [runDescription, setRunDescription] = useState("");

  // F3: Re-run prefill. When the user clicks Re-run on
  // /train/history?, we navigate here with `?from=<history_id>`.
  // Fetch the prefill payload + the dataset, then write through to
  // the train store + local state so the wizard lands on the same
  // settings the original run used.
  const prefillFired = useRef(false);
  useEffect(() => {
    if (!fromHistoryId || prefillFired.current) return;
    prefillFired.current = true;
    (async () => {
      try {
        const prefill = await rerunTrainingHistoryRow(fromHistoryId);
        if (prefill.dataset_missing) {
          setPrefillNotice(
            `Re-run requires dataset ${prefill.dataset_id.slice(0, 12)}, which has been deleted. Re-upload it from /train.`,
          );
          router.replace("/train");
          return;
        }
        const ds = await fetchDataset(prefill.dataset_id);
        setTask(prefill.task);
        setDataset(ds);
        patchHyperparams({
          model: prefill.model,
          epochs: prefill.epochs,
          image_size: prefill.imgsz,
          batch_size: prefill.batch,
        });
        setRunName(prefill.name);
        setRunDescription(prefill.description);
        setPrefillNotice(
          `Prefilled from run "${prefill.name}". Tweak any field before clicking Start.`,
        );
      } catch (err) {
        setPrefillNotice(
          err instanceof ApiError
            ? `Couldn't load run for re-run: ${err.message}`
            : "Couldn't load run for re-run.",
        );
      }
    })();
    // setTask/setDataset/patchHyperparams are zustand selectors — stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromHistoryId]);

  // Live placeholder: rebuild every minute so the auto-generated
  // <Task> · <stub> · YYYY-MM-DD HH:MM stays current. Also subscribes
  // to the TZ setting via usePreferredTimezone() so changing TZ in
  // Settings re-renders the placeholder.
  const tz = usePreferredTimezone();
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // If we got here without a dataset (e.g. fresh tab, store hydrated but
  // dataset was cleared by a "Reset desktop storage"), redirect back.
  // The store's persist middleware kicks in on mount, so wait a tick.
  // EXCEPT: when ?from=<history_id> is set, the F3 prefill effect above
  // will populate state shortly; don't bounce mid-prefill.
  useEffect(() => {
    if (fromHistoryId && !prefillFired.current) return;
    if (fromHistoryId && (!selectedTask || !dataset)) return;
    if (!selectedTask) {
      router.replace("/train");
    } else if (!dataset) {
      router.replace("/train/dataset");
    }
  }, [selectedTask, dataset, router, fromHistoryId]);

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

  // Default to detect when nothing is picked yet — selectedTask is non-null
  // by the time we render (the redirect above bounces back to /train).
  const taskForUi: "detect" | "classify" = selectedTask ?? "detect";

  const { data: hardware, isLoading: hwLoading } = useQuery({
    queryKey: ["hardware", taskForUi, hyperparams.image_size],
    queryFn: () =>
      fetchHardware({ task: taskForUi, imgsz: hyperparams.image_size }),
    staleTime: 60_000,
  });

  const { data: modelsData, isLoading: modelsLoading } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
  });
  const taskModels = useMemo(
    () => modelsData?.models.filter((m) => m.task === taskForUi) ?? [],
    [modelsData, taskForUi],
  );

  // Pick a default model the first time we land — prefer the saved
  // per-task default, else the first model in the registry for that task.
  useEffect(() => {
    if (hyperparams.model || taskModels.length === 0) return;
    const def = modelsData?.defaults[taskForUi] ?? taskModels[0]?.name;
    if (def) patchHyperparams({ model: def });
  }, [hyperparams.model, taskModels, modelsData, taskForUi, patchHyperparams]);

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

  const modelOptions = taskModels.map((m) => ({
    value: m.name,
    label: `${m.name}  ·  ${m.num_classes} cls  ·  ${formatBytes(m.size_mb)}`,
  }));

  // What name actually ships: the typed value when present, else the
  // current placeholder (so the server stores the exact string the user
  // saw in the field). Recomputed at submit time so the timestamp is
  // accurate to the click.
  const effectiveName = (): string => {
    const trimmed = runName.trim();
    if (trimmed) return trimmed;
    if (!dataset) return "";
    return defaultRunName(taskForUi, dataset.id, new Date(), { timeZone: tz });
  };

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
        name: effectiveName(),
        description: runDescription.trim(),
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

      {prefillNotice ? (
        <div className="rounded-md border border-accent/40 bg-accent-subtle px-3 py-2 text-sm text-ink">
          {prefillNotice}
        </div>
      ) : null}

      <DatasetSummary dataset={dataset} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {taskForUi === "detect" ? (
            <ClassNamesEditor dataset={dataset} onDatasetChanged={setDataset} />
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-accent" />
                Name this run <span className="text-xs font-normal text-ink-muted">(optional)</span>
              </CardTitle>
              <CardDescription>
                Helps you find this run later in Models. Leave blank to
                use the auto-generated default.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="run-name"
                  className="text-xs font-medium uppercase tracking-wide text-ink-muted"
                >
                  Name
                </label>
                <input
                  id="run-name"
                  type="text"
                  value={runName}
                  onChange={(e) => setRunName(e.target.value)}
                  maxLength={200}
                  placeholder={defaultRunName(
                    taskForUi,
                    dataset.id,
                    new Date(),
                    { timeZone: tz },
                  )}
                  className="h-9 w-full rounded-md border border-surface-muted bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="run-description"
                  className="text-xs font-medium uppercase tracking-wide text-ink-muted"
                >
                  Description
                </label>
                <textarea
                  id="run-description"
                  value={runDescription}
                  onChange={(e) => setRunDescription(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="What's this run for? e.g. 'Try imgsz=320 on the partial lung dataset.'"
                  className="w-full resize-y rounded-md border border-surface-muted bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </div>
            </CardContent>
          </Card>
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
                emptyText={
                  taskForUi === "classify"
                    ? "No classification models — run scripts/fetch-models.py --task classify"
                    : "No detection models — run scripts/fetch-models.py --task detect"
                }
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
                task={taskForUi}
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

      {hardware ? (
        <RunOnColabCallout
          kind={hardware.kind}
          onClick={() => setColabModalOpen(true)}
        />
      ) : null}

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

      {colabModalOpen ? (
        <ConnectColabModal
          task={taskForUi}
          runName={effectiveName()}
          runDescription={runDescription.trim()}
          onClose={() => setColabModalOpen(false)}
          onConnected={(jobId) => {
            setColabModalOpen(false);
            setActiveJob(jobId);
            router.push("/train/run");
          }}
        />
      ) : null}
    </section>
  );
}

function RunOnColabCallout({
  kind,
  onClick,
}: {
  kind: HardwareInfo["kind"];
  onClick: () => void;
}) {
  // Three copy variants so the callout adapts to detected hardware:
  //   - cpu: loud — local will be slow, push the user to Colab.
  //   - mps: gentle — MPS works but a Colab T4 is often faster for YOLO.
  //   - cuda: quietest — only mention if the user might prefer not to
  //     pin their local GPU during training.
  const copy =
    kind === "cpu"
      ? {
          headline: "This machine has no GPU — local training will be slow.",
          body:
            "Train on a free Google Colab GPU instead. Live charts, save to library, and predict afterwards all work the same way.",
        }
      : kind === "mps"
        ? {
            headline:
              "Want a faster GPU? Train on a free Colab T4 instead.",
            body:
              "A Colab T4 is often faster than Apple Silicon MPS for YOLO training. Live charts, save to library, and predict afterwards all work the same way.",
          }
        : {
            headline: "Train on a free Google Colab GPU instead.",
            body:
              "Useful if you'd rather not pin this machine's GPU during training. Live charts, save to library, and predict afterwards all work the same way.",
          };

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardContent className="flex items-start justify-between gap-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
            <Cloud className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-ink">{copy.headline}</p>
            <p className="mt-1 text-xs text-ink-muted">{copy.body}</p>
          </div>
        </div>
        <Button onClick={onClick} className="shrink-0">
          <Cloud className="size-4" />
          Run on Colab
        </Button>
      </CardContent>
    </Card>
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
  task,
  value,
  onChange,
}: {
  task: "detect" | "classify";
  value: number;
  onChange: (next: number) => void;
}) {
  const sizes = IMAGE_SIZES_BY_TASK[task];
  const hint =
    task === "classify"
      ? "Patches are resized to this on every side. 224 matches the size yolo*-cls.pt was distilled at; larger sizes can help when the diagnostic features are very fine."
      : "Patches are resized to this on every side. 640 is YOLO's default; higher = more memory, slightly slower, marginally better small-object recall.";
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        Image size
      </label>
      <div className="flex flex-wrap gap-1.5">
        {sizes.map((sz) => {
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
      <span className="text-xs text-ink-muted">{hint}</span>
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
