"use client";

import { ArrowLeft, Brain, Construction } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTrainStore } from "@/lib/train-store";

export default function TrainRunPage() {
  const router = useRouter();
  const { dataset, hyperparams } = useTrainStore();

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
          Train · run
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Ready when P4b lands.
        </h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          Dataset uploaded, hyperparameters set. The actual training subprocess
          (`engine/training.py`), live metric streaming via WebSocket, and the
          results / save-to-library page arrive in P4b.
        </p>
      </header>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="size-4 text-amber-600" />
            Configured run (preview)
          </CardTitle>
          <CardDescription>
            Pressing &ldquo;Start training&rdquo; in the final build will run
            this configuration locally; on Colab when accelerator=CPU.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <Row label="Dataset" value={dataset?.id ?? "—"} />
          <Row label="Format" value={dataset?.format ?? "—"} />
          <Row label="Images" value={String(dataset?.splits.reduce((a, s) => a + s.image_count, 0) ?? 0)} />
          <Row label="Model" value={hyperparams.model ?? "—"} />
          <Row label="Preset" value={hyperparams.preset} />
          <Row label="Epochs" value={hyperparams.epochs.toLocaleString()} />
          <Row label="Image size" value={`${hyperparams.image_size} px`} />
          <Row label="Batch size" value={hyperparams.batch_size.toLocaleString()} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => router.push("/train/configure")}>
          <ArrowLeft className="size-4" /> Tune again
        </Button>
        <Button disabled className="cursor-not-allowed">
          <Brain className="size-4" /> Start training (P4b)
        </Button>
      </div>
    </section>
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
