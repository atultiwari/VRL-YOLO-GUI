"use client";

import { Brain, Microscope, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTrainStore } from "@/lib/train-store";
import { cn } from "@/lib/utils";

interface TaskOption {
  key: "detect" | "classify";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  disabled: boolean;
  badge?: string;
}

const TASKS: TaskOption[] = [
  {
    key: "detect",
    label: "Object detection",
    icon: Microscope,
    description:
      "Count, classify, and localise objects in patches. Choose this for WBC differential, mitosis detection, malaria screen.",
    disabled: false,
  },
  {
    key: "classify",
    label: "Image classification",
    icon: Brain,
    description:
      "Per-image label (top-1 + top-5). Tumour subtype, Gleason grade, smear-pathology, marrow pattern.",
    disabled: false,
  },
];

export default function TrainPage() {
  const router = useRouter();
  const { setTask, reset } = useTrainStore();

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
          Train · pick a task
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Fine-tune YOLO on your own dataset.
        </h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          The next steps detect your dataset&apos;s format (Roboflow YOLO,
          plain YOLO, COCO, VOC), suggest sensible hyperparameters from
          your local GPU/MPS, and run the training locally — or on Colab
          if your machine has no accelerator (P6).
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 max-w-3xl">
        {TASKS.map((task) => {
          const card = (
            <Card
              className={cn(
                "h-full transition",
                !task.disabled && "cursor-pointer hover:border-accent",
                task.disabled && "opacity-60",
              )}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-12 items-center justify-center rounded-lg bg-accent-subtle text-accent">
                    <task.icon className="size-6" />
                  </div>
                  {task.badge ? (
                    <Badge tone="subtle" className="shrink-0">
                      {task.badge}
                    </Badge>
                  ) : null}
                </div>
                <CardTitle className="mt-2">{task.label}</CardTitle>
                <CardDescription>{task.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-accent">
                  <Sparkles className="mr-1 inline-block size-3" />
                  {task.key === "classify"
                    ? "Continue → drop your ImageFolder dataset (train/<class>/*)."
                    : "Continue → drop your dataset folder next."}
                </p>
              </CardContent>
            </Card>
          );

          if (task.disabled) {
            return <div key={task.key}>{card}</div>;
          }
          return (
            <button
              key={task.key}
              type="button"
              onClick={() => {
                reset();
                setTask(task.key);
                router.push("/train/dataset");
              }}
              className="text-left"
            >
              {card}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-ink-muted">
        Already in the middle of a run?{" "}
        <Link
          href="/train/dataset"
          className="font-medium text-accent hover:underline"
        >
          Pick up where you left off
        </Link>{" "}
        — your dataset and configure choices are remembered locally.
      </p>
    </section>
  );
}
