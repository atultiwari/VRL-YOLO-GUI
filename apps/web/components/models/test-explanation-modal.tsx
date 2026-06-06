"use client";

import { useMutation } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { WhyModal } from "@/components/predict/why-modal";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dropzone } from "@/components/ui/dropzone";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, inferSingle } from "@/lib/api";
import type { ModelInfo } from "@/lib/types";

export interface TestExplanationModalProps {
  model: ModelInfo;
  onClose: () => void;
}

/**
 * Models → "Test explanation" (F6b). Pick any image, run it through this
 * library model, and see the Eigen-CAM overlay — a way to sanity-check
 * that a freshly-trained model looks at the right features *before*
 * trusting it on real cases. Read-only: nothing is saved. Reuses
 * F6a's `WhyModal` once inference produces a result.
 */
export function TestExplanationModal({ model, onClose }: TestExplanationModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const infer = useMutation({
    mutationFn: (f: File) =>
      inferSingle({ image: f, model: model.name, conf: 0.25, iou: 0.45 }),
  });

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFile = (f: File) => {
    setFile(f);
    infer.mutate(f);
  };

  // Back to the picker (lets the user try another image without reopening).
  const reset = () => {
    setFile(null);
    infer.reset();
  };

  // Once inference succeeds, hand off to the shared Why? overlay.
  if (file && previewUrl && infer.data) {
    return (
      <WhyModal
        file={file}
        previewUrl={previewUrl}
        result={infer.data}
        onClose={reset}
      />
    );
  }

  const errorMessage =
    infer.error instanceof ApiError
      ? infer.error.message
      : infer.error instanceof Error
        ? infer.error.message
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-accent" />
                Test explanation
              </CardTitle>
              <CardDescription>
                Drop a sample image to see where{" "}
                <span className="font-medium text-ink">{model.name}</span>{" "}
                looks when it runs. Read-only — nothing is saved.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {previewUrl ? (
            <div className="overflow-hidden rounded-lg border border-surface-muted bg-black/3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Sample"
                className="mx-auto block max-h-[40vh] max-w-full object-contain"
              />
            </div>
          ) : (
            <Dropzone onFile={handleFile} />
          )}

          {infer.isPending ? (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-muted">
              <Spinner /> Running {model.name}…
            </p>
          ) : null}

          {errorMessage ? (
            <div className="space-y-2">
              <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                Couldn’t run this model on that image: {errorMessage}
              </p>
              <Button variant="secondary" size="sm" onClick={reset}>
                Try another image
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
