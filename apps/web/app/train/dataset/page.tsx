"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FolderOpen,
  HelpCircle,
  Scissors,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FolderDropzone } from "@/components/ui/folder-dropzone";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, splitDataset, uploadDataset } from "@/lib/api";
import { useTrainStore } from "@/lib/train-store";
import type { DatasetFormat, DatasetInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

const FORMAT_LABELS: Record<DatasetFormat, string> = {
  roboflow_yolo: "Roboflow YOLO",
  yolo: "Plain YOLO",
  coco: "COCO",
  voc: "Pascal VOC",
  imagefolder: "ImageFolder (classification)",
  unknown: "Unknown layout",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

export default function DatasetWizardPage() {
  const router = useRouter();
  const { selectedTask, dataset, setDataset } = useTrainStore();

  const [files, setFiles] = useState<File[]>([]);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadBytes, setUploadBytes] = useState<{ loaded: number; total: number } | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // No task picked? Bounce back to /train so the user goes through the
  // proper entry point. The store auto-restores from localStorage, so
  // most reload cases will already have selectedTask set.
  useEffect(() => {
    if (!selectedTask) {
      router.replace("/train");
    }
  }, [selectedTask, router]);

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  const onFolder = useCallback((next: File[]) => {
    setFiles(next);
    setError(null);
  }, []);

  const onUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    setUploadPct(0);
    setUploadBytes({ loaded: 0, total: totalBytes });
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const info: DatasetInfo = await uploadDataset(
        files,
        (p) => {
          setUploadPct(p.pct);
          setUploadBytes({ loaded: p.loaded, total: p.total });
        },
        ctrl.signal,
      );
      setDataset(info);
      setFiles([]);
      setUploadPct(100);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  };

  const onCancelUpload = () => abortRef.current?.abort();

  const onReset = () => {
    setFiles([]);
    setUploadPct(null);
    setUploadBytes(null);
    setError(null);
    setDataset(null);
  };

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Train · step 2 of 3 · dataset
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            Drop your training dataset.
          </h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            We&apos;ll auto-detect the format and report split counts, class
            list, and any warnings. Supported: Roboflow YOLO, plain YOLO,
            COCO JSON, Pascal VOC, and ImageFolder
            (<code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
              train/&lt;class&gt;/*.jpg
            </code>) for classification.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/train")}>
          <ArrowLeft className="size-4" /> Pick a different task
        </Button>
      </header>

      {!dataset ? (
        <UploadStage
          files={files}
          totalBytes={totalBytes}
          uploadPct={uploadPct}
          uploadBytes={uploadBytes}
          uploading={uploading}
          error={error}
          onFolder={onFolder}
          onUpload={onUpload}
          onCancelUpload={onCancelUpload}
          onClear={() => setFiles([])}
        />
      ) : (
        <DatasetSummary
          dataset={dataset}
          selectedTask={selectedTask}
          onReset={onReset}
          onContinue={() => router.push("/train/configure")}
          onDatasetChanged={setDataset}
        />
      )}
    </section>
  );
}

function UploadStage({
  files,
  totalBytes,
  uploadPct,
  uploadBytes,
  uploading,
  error,
  onFolder,
  onUpload,
  onCancelUpload,
  onClear,
}: {
  files: File[];
  totalBytes: number;
  uploadPct: number | null;
  uploadBytes: { loaded: number; total: number } | null;
  uploading: boolean;
  error: string | null;
  onFolder: (files: File[]) => void;
  onUpload: () => void;
  onCancelUpload: () => void;
  onClear: () => void;
}) {
  if (!files.length) {
    // mode="any" — training datasets carry yaml/txt/json/xml alongside
    // images; "images" mode would silently drop data.yaml + the label
    // files, which is the v0.6.0 regression that made every Roboflow
    // dataset show up as "Unknown layout".
    return (
      <div className="space-y-4">
        <FolderDropzone onFolder={onFolder} recursive mode="any" />
        <LayoutExamplesCard />
      </div>
    );
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4 text-accent" />
              Ready to upload
            </CardTitle>
            <CardDescription>
              {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalBytes)} ·
              will land at <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">~/Library/Application Support/VRL-YOLO-GUI/datasets/&lt;id&gt;</code>
              {" "}(macOS) or the equivalent storage dir.
            </CardDescription>
          </div>
          {!uploading ? (
            <Button variant="ghost" size="sm" onClick={onClear}>
              <X className="size-4" /> Pick a different folder
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {uploadPct !== null ? (
          <div>
            <div className="mb-1 flex justify-between text-xs text-ink-muted">
              <span>
                {uploadBytes
                  ? `${formatBytes(uploadBytes.loaded)} / ${formatBytes(uploadBytes.total)}`
                  : ""}
                {uploading ? " · uploading" : " · inspecting"}
              </span>
              <span className="tabular-nums">{uploadPct.toFixed(0)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn(
                  "h-full transition-[width] duration-200",
                  uploading ? "bg-accent" : "bg-clinical",
                )}
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <AlertTriangle className="mr-2 inline-block size-4 align-text-bottom" />
            {error}
          </div>
        ) : null}
        <div className="flex gap-2">
          {uploading ? (
            <Button className="flex-1" variant="destructive" onClick={onCancelUpload}>
              <X className="size-4" /> Cancel upload
            </Button>
          ) : (
            <Button className="flex-1" disabled={!files.length} onClick={onUpload}>
              Upload &amp; inspect <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function hasValidationSplit(dataset: DatasetInfo): boolean {
  return dataset.splits.some(
    (s) => s.name === "valid" || s.name === "val" || s.name === "validation",
  );
}

function needsSplitting(dataset: DatasetInfo): boolean {
  // Surface the splitter when training would fail without restructuring:
  //
  //   - Detect, no val/ split: Ultralytics won't compute mAP.
  //   - Classify ImageFolder, flat layout (single "all" split): no
  //     train/val/test subdirs at all → Ultralytics' classify mode
  //     refuses to start. The backend tags this case with a single
  //     pseudo-split named "all"; treat its presence as the signal.
  //   - Classify ImageFolder, split layout but missing val: same as
  //     detect — surface the splitter so the user can re-stage.
  if (dataset.format === "unknown") return false;
  if (dataset.task === "detect") {
    return !hasValidationSplit(dataset);
  }
  if (dataset.task === "classify") {
    const isFlat = dataset.splits.some((s) => s.name === "all");
    return isFlat || !hasValidationSplit(dataset);
  }
  return false;
}

function DatasetSummary({
  dataset,
  selectedTask,
  onReset,
  onContinue,
  onDatasetChanged,
}: {
  dataset: DatasetInfo;
  selectedTask: "detect" | "classify" | null;
  onReset: () => void;
  onContinue: () => void;
  onDatasetChanged: (next: DatasetInfo) => void;
}) {
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const totalImages = dataset.splits.reduce((acc, s) => acc + s.image_count, 0);
  const totalLabels = dataset.splits.reduce((acc, s) => acc + s.label_count, 0);
  const isClassify = dataset.task === "classify";
  const formatTone = dataset.format === "unknown" ? "danger" : "clinical";
  const wantsSplit = needsSplitting(dataset);
  const taskMismatch = selectedTask !== null && selectedTask !== dataset.task;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-clinical" />
              Dataset ready
            </CardTitle>
            <CardDescription className="break-all">
              ID <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">{dataset.id}</code>
            </CardDescription>
          </div>
          <Badge tone={formatTone}>
            <FolderOpen className="mr-1 size-3" />
            {FORMAT_LABELS[dataset.format]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Images" value={totalImages.toLocaleString()} />
          <Stat label="Labels" value={totalLabels.toLocaleString()} />
          <Stat label="Classes" value={String(dataset.classes.length || "—")} />
          <Stat label="Splits" value={String(dataset.splits.length || 0)} />
        </div>

        {dataset.splits.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                <th className="pb-2">Split</th>
                <th className="pb-2 text-right">Images</th>
                <th className="pb-2 text-right">Labels</th>
              </tr>
            </thead>
            <tbody>
              {dataset.splits.map((s) => (
                <tr key={s.name} className="border-t border-surface-muted text-ink">
                  <td className="py-2 capitalize">{s.name}</td>
                  <td className="py-2 text-right tabular-nums">{s.image_count.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{s.label_count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {dataset.classes.length ? (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
              Classes
            </p>
            <div className="flex flex-wrap gap-1">
              {dataset.classes.slice(0, 24).map((c) => (
                <Badge key={c} tone="subtle">
                  {c}
                </Badge>
              ))}
              {dataset.classes.length > 24 ? (
                <Badge tone="subtle">+{dataset.classes.length - 24} more</Badge>
              ) : null}
            </div>
          </div>
        ) : null}

        {dataset.warnings.length ? (
          <div className="space-y-1">
            {dataset.warnings.map((w, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                  isClassify
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-surface-muted bg-surface-subtle text-ink",
                )}
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {w}
              </div>
            ))}
          </div>
        ) : null}

        {wantsSplit ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <Scissors className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">
                No validation split detected.
              </p>
              <p className="mt-0.5 text-amber-900/80">
                Ultralytics needs a <code className="rounded bg-amber-100 px-1">val:</code>{" "}
                split to compute mAP during training. Reshuffle into train /
                valid / test now, or continue and skip validation metrics.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => setSplitModalOpen(true)}
              >
                <Scissors className="size-4" /> Prepare splits…
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button variant="secondary" onClick={onReset}>
            <X className="size-4" /> Pick another folder
          </Button>
          {!wantsSplit && !isClassify && dataset.format !== "unknown" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSplitModalOpen(true)}
              title="Re-split this dataset with different ratios."
            >
              <Scissors className="size-4" /> Re-split
            </Button>
          ) : null}
          <Button
            className="flex-1"
            disabled={taskMismatch || dataset.format === "unknown"}
            onClick={onContinue}
          >
            Continue → Configure <ArrowRight className="size-4" />
          </Button>
        </div>
        {taskMismatch ? (
          <p className="text-xs text-amber-900">
            You picked <b>{selectedTask}</b> on the previous step, but this
            folder looks like a <b>{dataset.task}</b> dataset
            ({FORMAT_LABELS[dataset.format]}). Go back and pick the matching
            task — or upload a different folder.
          </p>
        ) : null}
      </CardContent>

      {splitModalOpen ? (
        <SplitModal
          dataset={dataset}
          onClose={() => setSplitModalOpen(false)}
          onSplit={(next) => {
            onDatasetChanged(next);
            setSplitModalOpen(false);
          }}
        />
      ) : null}
    </Card>
  );
}

function SplitModal({
  dataset,
  onClose,
  onSplit,
}: {
  dataset: DatasetInfo;
  onClose: () => void;
  onSplit: (next: DatasetInfo) => void;
}) {
  // Default 80 / 10 / 10. Track integer percentages internally so the
  // sliders don't drift into floating-point garbage; we divide by 100
  // before sending. Sum is *forced* to 100 — when the user nudges train,
  // valid and test absorb the residual proportionally.
  const [train, setTrain] = useState(80);
  const [valid, setValid] = useState(10);
  const [test, setTest] = useState(10);
  const [seed, setSeed] = useState(42);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For detect we count image+label pairs (whichever side is smaller);
  // for classify we just count images (no labels — the dirname is the
  // class). Using min() everywhere would have collapsed classify totals
  // to 0 because label_count = 0 for ImageFolder splits.
  const isClassify = dataset.task === "classify";
  const splitSize = (s: { image_count: number; label_count: number }) =>
    isClassify ? s.image_count : Math.min(s.image_count, s.label_count);
  const totalPairs = useMemo(
    () =>
      dataset.splits.reduce((acc, s) => acc + splitSize(s), 0) +
      (dataset.unassigned_image_count ?? 0),
    // splitSize is stable across renders (depends only on isClassify)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset, isClassify],
  );

  // Partition the inspector's reported splits into "preserved" (named
  // train / val / valid / validation / test) and "flat" (the "all"
  // pseudo-split, or anything else the inspector emits). This is what
  // the backend's _existing_split_for sees on its side; keeping the two
  // models in lockstep means the preview the user sees here matches
  // what split_dataset/split_imagefolder actually does.
  const SPLIT_NAMES = ["train", "val", "valid", "validation", "test"];
  const preservedCounts = useMemo(() => {
    const out = { train: 0, valid: 0, test: 0 };
    for (const s of dataset.splits) {
      const name = s.name.toLowerCase();
      const size = splitSize(s);
      if (name === "train") out.train += size;
      else if (name === "val" || name === "valid" || name === "validation")
        out.valid += size;
      else if (name === "test") out.test += size;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, isClassify]);
  const flatCount = useMemo(() => {
    // Prefer the backend's authoritative `unassigned_image_count` —
    // covers the mixed-layout case where `dataset.splits` only reports
    // the recognised split shape and hides flat siblings. Fall back to
    // counting "all" / non-standard splits for backward compatibility
    // and the pure-flat case (where splits = [{name: "all", ...}] and
    // the backend reports unassigned_image_count = 0 because every
    // image IS the dataset, not an extra-on-top-of-splits pool).
    const fromSplits = dataset.splits.reduce(
      (acc, s) =>
        SPLIT_NAMES.includes(s.name.toLowerCase()) ? acc : acc + splitSize(s),
      0,
    );
    return fromSplits + (dataset.unassigned_image_count ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, isClassify]);
  const hasExistingSplits =
    preservedCounts.train + preservedCounts.valid + preservedCounts.test > 0;

  // Default checkbox state: ON when the dataset already has at least
  // one recognised split, OFF on a pure flat-layout drop. Smart-default
  // chosen per the design discussion — power user with a curated
  // Roboflow export shouldn't have to remember to tick the box.
  const [preserveExisting, setPreserveExisting] = useState(hasExistingSplits);

  const onTrainChange = (v: number) => {
    const next = Math.max(1, Math.min(99, Math.round(v)));
    const remaining = 100 - next;
    // Preserve the valid/test *ratio* between themselves so a user who
    // wanted 80/10/10 and bumps train to 85 ends up at 85/7.5/7.5 instead
    // of 85/10/5 (we'd rather erode both than zero one out).
    const sumOther = Math.max(1, valid + test);
    const newValid = Math.round((valid / sumOther) * remaining);
    const newTest = remaining - newValid;
    setTrain(next);
    setValid(newValid);
    setTest(newTest);
  };

  const onValidChange = (v: number) => {
    const next = Math.max(0, Math.min(100 - train, Math.round(v)));
    setValid(next);
    setTest(100 - train - next);
  };

  const submit = async () => {
    setRunning(true);
    setError(null);
    try {
      const updated = await splitDataset(dataset.id, {
        trainRatio: train / 100,
        validRatio: valid / 100,
        testRatio: test / 100,
        seed,
        preserveExisting,
      });
      onSplit(updated);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : String(err);
      setError(msg);
    } finally {
      setRunning(false);
    }
  };

  // When preserve is ON, ratios apply to the flat pool only; the
  // preserved counts pass through unchanged. When OFF, the ratios apply
  // to the whole dataset as before.
  const distributionPool = preserveExisting ? flatCount : totalPairs;
  const newTrain = Math.round((train / 100) * distributionPool);
  const newValid = Math.round((valid / 100) * distributionPool);
  const newTest = distributionPool - newTrain - newValid;
  const previewTrain = preserveExisting ? preservedCounts.train + newTrain : newTrain;
  const previewValid = preserveExisting ? preservedCounts.valid + newValid : newValid;
  const previewTest = preserveExisting ? preservedCounts.test + newTest : newTest;

  const noFlatToRedistribute = preserveExisting && flatCount === 0;
  const cantSubmit =
    running || train + valid + test !== 100 || noFlatToRedistribute;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Scissors className="size-4 text-accent" />
                {isClassify
                  ? "Prepare train / val / test splits"
                  : "Prepare train / valid / test splits"}
              </CardTitle>
              <CardDescription>
                {isClassify ? (
                  <>
                    Re-stages every image into <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">train/&lt;class&gt;/</code>,{" "}
                    <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">val/&lt;class&gt;/</code>, and{" "}
                    <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">test/&lt;class&gt;/</code>{" "}
                    (stratified per class so each split keeps a balanced ratio).
                    The operation is destructive within the dataset&apos;s
                    upload directory — re-upload if you want the original back.
                  </>
                ) : (
                  <>
                    Reshuffles every image+label pair into a fresh Roboflow-shaped
                    layout and rewrites <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">data.yaml</code>.
                    The operation is destructive within the dataset&apos;s upload
                    directory — re-upload if you want the original back.
                  </>
                )}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={running}>
              <X className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasExistingSplits ? (
            <label className="flex items-start gap-2 rounded-md border border-surface-muted bg-surface-subtle px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={preserveExisting}
                onChange={(e) => setPreserveExisting(e.target.checked)}
                className="mt-0.5"
                disabled={running}
              />
              <span>
                <span className="font-medium text-ink">
                  Preserve existing train / {isClassify ? "val" : "valid"} / test assignments
                </span>
                <span className="ml-1 text-ink-muted">
                  — only redistribute flat / unassigned images per the ratios below.
                  Useful when you&apos;ve hand-curated splits and just want to add
                  newly-uploaded images.
                </span>
              </span>
            </label>
          ) : null}
          {noFlatToRedistribute ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mr-2 inline-block size-4 align-text-bottom" />
              Every image is already in a split — nothing to redistribute.
              Uncheck Preserve to reshuffle from scratch.
            </div>
          ) : null}
          <Slider
            label={renderSplitLabel({
              name: "Train",
              preserved: preserveExisting ? preservedCounts.train : 0,
              added: newTrain,
              showSplit: preserveExisting,
            })}
            value={train}
            min={1}
            max={99}
            step={1}
            format={(v) => `${v.toFixed(0)}%`}
            onChange={onTrainChange}
          />
          <Slider
            label={renderSplitLabel({
              name: isClassify ? "Val" : "Valid",
              preserved: preserveExisting ? preservedCounts.valid : 0,
              added: newValid,
              showSplit: preserveExisting,
            })}
            value={valid}
            min={0}
            max={100 - train}
            step={1}
            format={(v) => `${v.toFixed(0)}%`}
            onChange={onValidChange}
            hint={
              isClassify
                ? "Set to 0 to skip the validation split — but Ultralytics' classify mode WILL refuse to start without it."
                : "Set to 0 to skip validation (training still runs but no mAP)."
            }
          />
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-ink">Test</span>
            <span className="tabular-nums font-medium text-ink">
              {test}% &nbsp;&middot;&nbsp;{" "}
              {preserveExisting && preservedCounts.test > 0
                ? `${preservedCounts.test} preserved + ${newTest} new = ${previewTest} images`
                : `${previewTest} images`}
            </span>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted">
              Random seed
            </label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="h-9 w-32 rounded-md border border-surface-muted bg-surface px-3 text-sm tabular-nums"
            />
            <span className="ml-2 text-xs text-ink-muted">
              Same seed = same partition; useful for reproducible runs.
            </span>
          </div>
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="mr-2 inline-block size-4 align-text-bottom" />
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" disabled={running} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={cantSubmit} onClick={submit}>
              {running ? (
                <>
                  <Spinner /> Splitting…
                </>
              ) : (
                <>
                  <Scissors className="size-4" /> Split &amp; re-inspect
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function renderSplitLabel(opts: {
  name: string;
  preserved: number;
  added: number;
  showSplit: boolean;
}): string {
  // When preserve is ON AND there's something to preserve in this split,
  // show the breakdown so the user sees what the ratio is actually doing.
  // Otherwise fall back to the simple "Train (95 images)" form.
  if (opts.showSplit && opts.preserved > 0) {
    const total = opts.preserved + opts.added;
    return `${opts.name} (${opts.preserved} preserved + ${opts.added} new = ${total} images)`;
  }
  if (opts.showSplit) {
    return `${opts.name} (${opts.added} new images)`;
  }
  return `${opts.name} (${opts.added} images)`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-surface-muted bg-surface-subtle p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

interface LayoutExample {
  title: string;
  task: "Detection" | "Classification";
  badge: string;
  description: string;
  tree: string;
  note?: string;
}

const LAYOUT_EXAMPLES: LayoutExample[] = [
  {
    title: "Roboflow YOLO",
    task: "Detection",
    badge: "data.yaml + train/valid/test",
    description:
      "Most common — what Roboflow's YOLO export ships. We read class names from data.yaml and use the splits as-is.",
    tree: `my-dataset/
├── data.yaml          ← class names + split paths
├── train/
│   ├── images/        ← *.jpg, *.png, ...
│   └── labels/        ← matching *.txt (YOLO format)
├── valid/
│   ├── images/
│   └── labels/
└── test/              ← optional
    ├── images/
    └── labels/`,
  },
  {
    title: "Plain YOLO",
    task: "Detection",
    badge: "images/ + labels/ (no splits)",
    description:
      "Flat layout — one images/ + labels/ pair at the root. The wizard will offer Prepare splits to re-stage into Roboflow shape.",
    tree: `my-dataset/
├── images/
│   ├── img001.jpg
│   └── img002.jpg
└── labels/
    ├── img001.txt
    └── img002.txt`,
    note: "Class names aren't embedded — you'll rename them on the next page.",
  },
  {
    title: "ImageFolder (flat)",
    task: "Classification",
    badge: "<class>/*.jpg at root",
    description:
      "The friendliest layout for classification — one folder per class, images directly inside. The wizard will offer Prepare splits to re-stage into the Ultralytics-ready train/val/test layout.",
    tree: `my-dataset/
├── lung_aca/
│   ├── img001.jpeg
│   └── img002.jpeg
├── lung_n/
│   └── ...
└── lung_scc/
    └── ...`,
    note: "Folder name = class name. Use Prepare splits to stage train/val/test.",
  },
  {
    title: "ImageFolder (split)",
    task: "Classification",
    badge: "train/val/test of <class>/",
    description:
      "Already Ultralytics-ready. Classification training runs directly against this layout — train/, val/, and optionally test/, each containing one folder per class.",
    tree: `my-dataset/
├── train/
│   ├── lung_aca/
│   ├── lung_n/
│   └── lung_scc/
├── val/
│   ├── lung_aca/
│   └── ...
└── test/              ← optional
    └── ...`,
  },
];

function LayoutExamplesCard() {
  // Default open the first time the user lands — once they've collapsed it
  // we don't reopen, so frequent users aren't yelled at every visit. The
  // localStorage key is intentional (not a per-tab Zustand store) so the
  // collapsed state persists across sessions.
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("vrl-yolo-gui.layout-examples-open") !== "0";
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        "vrl-yolo-gui.layout-examples-open",
        next ? "1" : "0",
      );
    }
  };
  return (
    <Card>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <HelpCircle className="size-4 text-accent" />
          <span className="text-sm font-medium text-ink">
            What does my dataset need to look like?
          </span>
        </div>
        <div className="text-ink-muted">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </div>
      </button>
      {open ? (
        <CardContent className="grid grid-cols-1 gap-4 border-t border-surface-muted pt-4 md:grid-cols-2">
          {LAYOUT_EXAMPLES.map((ex) => (
            <div
              key={ex.title}
              className="flex flex-col gap-2 rounded-md border border-surface-muted bg-surface-subtle p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{ex.title}</p>
                  <p className="text-xs text-ink-muted">{ex.badge}</p>
                </div>
                <Badge tone={ex.task === "Classification" ? "subtle" : "clinical"}>
                  {ex.task}
                </Badge>
              </div>
              <p className="text-xs text-ink-muted">{ex.description}</p>
              <pre className="overflow-x-auto rounded bg-surface px-2 py-2 font-mono text-[11px] leading-relaxed text-ink">
                {ex.tree}
              </pre>
              {ex.note ? (
                <p className="text-[11px] italic text-ink-muted">{ex.note}</p>
              ) : null}
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}
