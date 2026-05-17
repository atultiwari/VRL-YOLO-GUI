"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  FolderOpen,
  Gauge,
  Image as ImageIcon,
  Microscope,
  Play,
  StopCircle,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BatchAggregatePanel,
  BatchTable,
} from "@/components/predict/batch-view";
import { PresetPicker } from "@/components/predict/preset-picker";
import {
  BoxOverlay,
  SingleClassificationPanel,
  SingleDetectionPanel,
} from "@/components/predict/single-view";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dropzone } from "@/components/ui/dropzone";
import { FolderDropzone } from "@/components/ui/folder-dropzone";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { fetchModels, fetchPresets, inferSingle } from "@/lib/api";
import {
  aggregate,
  runBatch,
  type BatchAggregate,
  type BatchResultItem,
} from "@/lib/batch";
import { cn, formatBytes } from "@/lib/utils";
import type {
  DetectionResponse,
  InferenceResponse,
  PresetInfo,
  Task,
} from "@/lib/types";

type Mode = "single" | "folder";

export default function PredictPage() {
  const [mode, setMode] = useState<Mode>("single");

  // Shared controls
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [activePresetId, setActivePresetId] = useState<string | undefined>(undefined);
  const [conf, setConf] = useState(0.25);
  const [iou, setIou] = useState(0.45);

  // Single-image state
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [singleResult, setSingleResult] = useState<InferenceResponse | null>(null);

  // Folder / batch state
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [recursive, setRecursive] = useState(true);
  const [items, setItems] = useState<BatchResultItem[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const { data: modelsData, isLoading: modelsLoading } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
  });
  const { data: presetsData } = useQuery({
    queryKey: ["presets"],
    queryFn: fetchPresets,
    staleTime: 5 * 60 * 1000,
  });

  const allModels = modelsData?.models ?? [];
  const presets = presetsData?.presets ?? [];

  const selectedTask: Task | undefined = useMemo(
    () => allModels.find((m) => m.name === selectedModel)?.task,
    [allModels, selectedModel],
  );
  const isClassify = selectedTask === "classify";

  // Default-model selection: prefer the registry's saved default; fall back
  // to the first detect (or any) model so a fresh install still works.
  useEffect(() => {
    if (selectedModel || allModels.length === 0) return;
    const def = modelsData?.defaults.detect ?? modelsData?.defaults.classify;
    setSelectedModel(def ?? allModels[0]?.name);
  }, [modelsData, allModels, selectedModel]);

  // Single-image preview URL lifecycle.
  useEffect(() => {
    if (!singleFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(singleFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [singleFile]);

  // Preset selection prefills model + slider knobs.
  const onPresetSelect = useCallback(
    (preset: PresetInfo | null) => {
      if (!preset) {
        setActivePresetId(undefined);
        return;
      }
      setActivePresetId(preset.id);
      const match = allModels.find((m) => m.name === preset.default_model);
      if (match) {
        setSelectedModel(match.name);
      } else {
        const fallback = modelsData?.defaults[preset.task];
        if (fallback) setSelectedModel(fallback);
      }
      setConf(preset.conf);
      if (preset.iou !== null) setIou(preset.iou);
    },
    [allModels, modelsData],
  );

  // Single-image inference.
  const single = useMutation({
    mutationFn: async () => {
      if (!singleFile || !selectedModel) throw new Error("file and model required");
      return inferSingle({ image: singleFile, model: selectedModel, conf, iou });
    },
    onSuccess: (data) => setSingleResult(data),
    onError: () => setSingleResult(null),
  });

  // Folder batch.
  const runFolderBatch = useCallback(async () => {
    if (!folderFiles.length || !selectedModel) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBatchRunning(true);
    setItems([]);
    setProgress({ current: 0, total: folderFiles.length });

    try {
      await runBatch({
        files: folderFiles,
        model: selectedModel,
        conf,
        iou,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === "done") {
            setProgress({ current: p.current, total: p.total });
          }
        },
        onItem: (item) => {
          setItems((prev) => [...prev, item]);
        },
      });
    } finally {
      setBatchRunning(false);
      abortRef.current = null;
    }
  }, [folderFiles, selectedModel, conf, iou]);

  const cancelBatch = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onSingleDrop = (next: File) => {
    setSingleFile(next);
    setSingleResult(null);
  };
  const onSingleClear = () => {
    setSingleFile(null);
    setSingleResult(null);
    single.reset();
  };
  const onFolderDrop = (files: File[]) => {
    setFolderFiles(files);
    setItems([]);
    setProgress(null);
  };
  const onFolderClear = () => {
    setFolderFiles([]);
    setItems([]);
    setProgress(null);
  };

  const modelOptions = allModels.map((m) => ({
    value: m.name,
    label: `${m.name}  ·  ${m.task}  ·  ${m.num_classes} cls  ·  ${formatBytes(m.size_mb)}`,
  }));

  const canRunSingle = !!singleFile && !!selectedModel && !single.isPending;
  const canRunBatch = folderFiles.length > 0 && !!selectedModel && !batchRunning;
  const showOverlay = singleResult?.task === "detect";
  const aggForBatch = useMemo(() => aggregate(items, conf), [items, conf]);

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Predict · single image &amp; folder batch
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            Run a model on slide patches.
          </h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Single mode: one patch, full overlay or top-5 chart. Folder mode:
            drop a folder, see a per-image table and aggregate roll-up.
            Workflow presets prefill model + thresholds for common clinical
            tasks. CSV / XLSX / PDF reports land in P3b.
          </p>
        </div>
        <ModeToggle mode={mode} onChange={setMode} />
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
        <aside className="flex flex-col gap-4">
          {presets.length ? (
            <PresetPicker
              presets={presets}
              selected={activePresetId}
              onSelect={onPresetSelect}
            />
          ) : null}

          <ControlCard
            isClassify={isClassify}
            selectedTask={selectedTask}
            selectedModel={selectedModel}
            modelOptions={modelOptions}
            modelsLoading={modelsLoading}
            onSelectModel={(v) => {
              setSelectedModel(v);
              setActivePresetId(undefined);
            }}
            conf={conf}
            onConfChange={(v) => {
              setConf(v);
              setActivePresetId(undefined);
            }}
            iou={iou}
            onIouChange={(v) => {
              setIou(v);
              setActivePresetId(undefined);
            }}
            mode={mode}
            recursive={recursive}
            onRecursiveChange={setRecursive}
            canRunSingle={canRunSingle}
            singlePending={single.isPending}
            singleError={single.isError ? single.error : null}
            onRunSingle={() => single.mutate()}
            onClearSingle={onSingleClear}
            singleFilePresent={!!singleFile}
            canRunBatch={canRunBatch}
            batchRunning={batchRunning}
            progress={progress}
            folderFileCount={folderFiles.length}
            onRunBatch={runFolderBatch}
            onCancelBatch={cancelBatch}
            onClearFolder={onFolderClear}
          />
        </aside>

        <div className="flex flex-col gap-4">
          {mode === "single" ? (
            <SingleColumn
              previewUrl={previewUrl}
              singleFile={singleFile}
              singleResult={singleResult}
              showOverlay={showOverlay}
              reviewThreshold={conf}
              onSingleDrop={onSingleDrop}
              onSingleClear={onSingleClear}
            />
          ) : (
            <FolderColumn
              folderFiles={folderFiles}
              recursive={recursive}
              items={items}
              progress={progress}
              batchRunning={batchRunning}
              reviewThreshold={conf}
              agg={aggForBatch}
              onFolderDrop={onFolderDrop}
              onFolderClear={onFolderClear}
            />
          )}
        </div>
      </div>
    </section>
  );
}

// --- Page-local sub-components -----------------------------------------

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (next: Mode) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-surface-muted bg-surface-subtle p-1">
      <button
        type="button"
        onClick={() => onChange("single")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition",
          mode === "single"
            ? "bg-surface text-ink shadow-xs"
            : "text-ink-muted hover:text-ink",
        )}
      >
        <ImageIcon className="size-4" /> Single
      </button>
      <button
        type="button"
        onClick={() => onChange("folder")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition",
          mode === "folder"
            ? "bg-surface text-ink shadow-xs"
            : "text-ink-muted hover:text-ink",
        )}
      >
        <FolderOpen className="size-4" /> Folder
      </button>
    </div>
  );
}

interface ControlCardProps {
  isClassify: boolean;
  selectedTask: Task | undefined;
  selectedModel: string | undefined;
  modelOptions: { value: string; label: string }[];
  modelsLoading: boolean;
  onSelectModel: (v: string) => void;
  conf: number;
  onConfChange: (v: number) => void;
  iou: number;
  onIouChange: (v: number) => void;
  mode: Mode;
  recursive: boolean;
  onRecursiveChange: (v: boolean) => void;
  canRunSingle: boolean;
  singlePending: boolean;
  singleError: unknown;
  onRunSingle: () => void;
  onClearSingle: () => void;
  singleFilePresent: boolean;
  canRunBatch: boolean;
  batchRunning: boolean;
  progress: { current: number; total: number } | null;
  folderFileCount: number;
  onRunBatch: () => void;
  onCancelBatch: () => void;
  onClearFolder: () => void;
}

function ControlCard(props: ControlCardProps) {
  const {
    isClassify,
    selectedTask,
    selectedModel,
    modelOptions,
    modelsLoading,
    onSelectModel,
    conf,
    onConfChange,
    iou,
    onIouChange,
    mode,
    recursive,
    onRecursiveChange,
    canRunSingle,
    singlePending,
    singleError,
    onRunSingle,
    onClearSingle,
    singleFilePresent,
    canRunBatch,
    batchRunning,
    progress,
    folderFileCount,
    onRunBatch,
    onCancelBatch,
    onClearFolder,
  } = props;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isClassify ? (
            <Brain className="size-4 text-accent" />
          ) : (
            <Microscope className="size-4 text-accent" />
          )}
          Model
        </CardTitle>
        <CardDescription>
          {isClassify
            ? "Classification — full top-5 returned. Slider sets the review threshold."
            : selectedTask === "detect"
            ? "Detection — boxes filtered by confidence; IoU drives NMS."
            : "Pick a detection or classification model to begin."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select
          label="Model"
          value={selectedModel}
          options={modelOptions}
          onChange={onSelectModel}
          placeholder={modelsLoading ? "Loading…" : "Pick a model"}
          emptyText="No models — run scripts/fetch-models.py"
        />
        <Slider
          label={isClassify ? "Review threshold" : "Confidence"}
          value={conf}
          min={0.05}
          max={0.95}
          step={0.01}
          onChange={onConfChange}
          hint={
            isClassify
              ? "Top-1 predictions below this score are flagged for manual review."
              : "Boxes below this score are hidden from results."
          }
        />
        {isClassify ? null : (
          <Slider
            label="IoU"
            value={iou}
            min={0.1}
            max={0.95}
            step={0.01}
            onChange={onIouChange}
            hint="Non-maximum-suppression threshold for overlapping boxes."
          />
        )}
        {mode === "single" ? (
          <div className="flex gap-2 pt-2">
            <Button className="flex-1" disabled={!canRunSingle} onClick={onRunSingle}>
              {singlePending ? (
                <>
                  <Spinner /> Running…
                </>
              ) : (
                <>
                  <Play className="size-4" /> Run inference
                </>
              )}
            </Button>
            <Button variant="ghost" disabled={!singleFilePresent} onClick={onClearSingle}>
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => onRecursiveChange(e.target.checked)}
                className="accent-accent"
              />
              Walk subfolders (recursive)
            </label>
            <div className="flex gap-2">
              {batchRunning ? (
                <Button className="flex-1" variant="destructive" onClick={onCancelBatch}>
                  <StopCircle className="size-4" /> Stop ({progress?.current ?? 0}/
                  {progress?.total ?? 0})
                </Button>
              ) : (
                <Button className="flex-1" disabled={!canRunBatch} onClick={onRunBatch}>
                  <Play className="size-4" /> Run on {folderFileCount} image
                  {folderFileCount === 1 ? "" : "s"}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={folderFileCount === 0 || batchRunning}
                onClick={onClearFolder}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        )}
        {mode === "single" && singleError ? (
          <p className="text-xs text-red-700">
            {singleError instanceof Error
              ? singleError.message
              : "Inference failed. Check the backend log."}
          </p>
        ) : null}
        <div className="flex items-center gap-2 border-t border-surface-muted pt-3 text-xs text-ink-muted">
          <Gauge className="size-3.5" />
          Sliders re-run on next click — live update lands in P3b polish.
        </div>
      </CardContent>
    </Card>
  );
}

function SingleColumn({
  previewUrl,
  singleFile,
  singleResult,
  showOverlay,
  reviewThreshold,
  onSingleDrop,
  onSingleClear,
}: {
  previewUrl: string | null;
  singleFile: File | null;
  singleResult: InferenceResponse | null;
  showOverlay: boolean;
  reviewThreshold: number;
  onSingleDrop: (next: File) => void;
  onSingleClear: () => void;
}) {
  const imageSize = singleResult?.image_size;
  return (
    <>
      {!previewUrl ? (
        <Dropzone onFile={onSingleDrop} />
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="truncate">{singleFile?.name}</CardTitle>
                <CardDescription>
                  {singleResult
                    ? `${singleResult.image_size[0]} × ${singleResult.image_size[1]} px · model ${singleResult.model}`
                    : "Click ‘Run inference’ when ready."}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={onSingleClear}>
                <X className="size-4" /> Replace
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative inline-block max-h-[70vh] max-w-full overflow-hidden rounded-lg border border-surface-muted bg-black/3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt={singleFile?.name ?? "Selected patch"}
                className="block max-h-[70vh] max-w-full object-contain"
              />
              {showOverlay && singleResult && imageSize ? (
                <BoxOverlay
                  boxes={(singleResult as DetectionResponse).boxes}
                  imageW={imageSize[0]}
                  imageH={imageSize[1]}
                />
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
      {singleResult?.task === "detect" ? <SingleDetectionPanel result={singleResult} /> : null}
      {singleResult?.task === "classify" ? (
        <SingleClassificationPanel result={singleResult} reviewThreshold={reviewThreshold} />
      ) : null}
      {!singleResult && previewUrl ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-ink-muted">
            Ready when you are — click{" "}
            <span className="font-medium text-ink">Run inference</span> to send the image
            to{" "}
            <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
              /api/inference/single
            </code>
            .
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function FolderColumn({
  folderFiles,
  recursive,
  items,
  progress,
  batchRunning,
  reviewThreshold,
  agg,
  onFolderDrop,
  onFolderClear,
}: {
  folderFiles: File[];
  recursive: boolean;
  items: BatchResultItem[];
  progress: { current: number; total: number } | null;
  batchRunning: boolean;
  reviewThreshold: number;
  agg: BatchAggregate | null;
  onFolderDrop: (files: File[]) => void;
  onFolderClear: () => void;
}) {
  if (!folderFiles.length) {
    return <FolderDropzone onFolder={onFolderDrop} recursive={recursive} />;
  }
  const pct = progress ? (progress.current / Math.max(progress.total, 1)) * 100 : 0;
  const successCount = items.filter((i) => i.result !== null).length;
  const failedCount = items.filter((i) => i.result === null).length;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="size-4 text-accent" />
                Folder
              </CardTitle>
              <CardDescription>
                {folderFiles.length} image{folderFiles.length === 1 ? "" : "s"} queued ·{" "}
                {recursive ? "recursive" : "top-level only"}.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" disabled={batchRunning} onClick={onFolderClear}>
              <X className="size-4" /> Reset
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {progress ? (
            <div>
              <div className="mb-1 flex justify-between text-xs text-ink-muted">
                <span>
                  {progress.current} / {progress.total}
                  {batchRunning ? " · running" : " · done"}
                </span>
                <span className="tabular-nums">{pct.toFixed(0)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={cn(
                    "h-full transition-[width] duration-200",
                    batchRunning ? "bg-accent" : "bg-clinical",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 flex gap-3 text-xs text-ink-muted">
                {successCount ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3 text-clinical" />
                    {successCount} ok
                  </span>
                ) : null}
                {failedCount ? (
                  <span className="inline-flex items-center gap-1 text-red-700">
                    <AlertTriangle className="size-3" />
                    {failedCount} failed
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Hit <span className="font-medium text-ink">Run</span> to process the queued
              images. Sequential on one accelerator — typical pace is ~10 imgs/s on MPS
              once weights are warm.
            </p>
          )}
        </CardContent>
      </Card>

      {agg ? <BatchAggregatePanel agg={agg} /> : null}
      <BatchTable items={items} reviewThreshold={reviewThreshold} />
    </>
  );
}
