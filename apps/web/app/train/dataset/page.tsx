"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  FolderOpen,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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
import { Spinner } from "@/components/ui/spinner";
import { ApiError, uploadDataset } from "@/lib/api";
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
            COCO JSON, Pascal VOC.
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
          onReset={onReset}
          onContinue={() => router.push("/train/configure")}
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
    return <FolderDropzone onFolder={onFolder} recursive />;
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

function DatasetSummary({
  dataset,
  onReset,
  onContinue,
}: {
  dataset: DatasetInfo;
  onReset: () => void;
  onContinue: () => void;
}) {
  const totalImages = dataset.splits.reduce((acc, s) => acc + s.image_count, 0);
  const totalLabels = dataset.splits.reduce((acc, s) => acc + s.label_count, 0);
  const isClassify = dataset.task === "classify";
  const formatTone = dataset.format === "unknown" ? "danger" : "clinical";

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

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={onReset}>
            <X className="size-4" /> Pick another folder
          </Button>
          <Button
            className="flex-1"
            disabled={isClassify || dataset.format === "unknown"}
            onClick={onContinue}
          >
            Continue → Configure <ArrowRight className="size-4" />
          </Button>
        </div>
        {isClassify ? (
          <p className="text-xs text-amber-900">
            Classification training is P5. The wizard accepts ImageFolder
            datasets so you can preview them, but the configure page is
            detection-only for now.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-surface-muted bg-surface-subtle p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
