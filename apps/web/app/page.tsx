import Link from "next/link";
import { Microscope, Brain, Layers } from "lucide-react";

const MODES = [
  {
    href: "/predict",
    icon: Microscope,
    label: "Predict",
    description:
      "Run a fine-tuned or bundled YOLO model on slide patches. Detection counts cells; classification tags subtypes.",
    cta: "Open Predict",
  },
  {
    href: "/train",
    icon: Brain,
    label: "Train",
    description:
      "Fine-tune a YOLO26 or YOLOv8 model on your own annotated dataset. Local accelerator or Colab.",
    cta: "Open Train",
  },
  {
    href: "/models",
    icon: Layers,
    label: "Models",
    description:
      "Bundled starter weights plus any models you've imported or trained locally.",
    cta: "Browse Models",
  },
];

export default function HomePage() {
  return (
    <section className="flex h-full flex-col items-start px-12 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
        Phase 0 · Scaffolding
      </p>
      <h1 className="mt-3 max-w-3xl text-5xl font-semibold leading-tight tracking-tight">
        Bringing YOLO into the histopathology and hematology workflow.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-ink-muted">
        VRL YOLO GUI demonstrates two clinical YOLO tasks — object detection
        (cell counts, mitosis) and image classification (tumour subtype,
        smear pattern) — in one desktop app. Predict runs models on patch
        folders; Train fine-tunes on Roboflow exports.
      </p>

      <div className="mt-12 grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
        {MODES.map((mode) => (
          <Link
            key={mode.href}
            href={mode.href}
            className="group flex flex-col gap-3 rounded-xl border border-surface-muted bg-surface p-6 transition hover:border-accent hover:shadow-sm"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-accent-subtle text-accent">
              <mode.icon className="size-5" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">{mode.label}</h2>
            <p className="text-sm text-ink-muted">{mode.description}</p>
            <span className="mt-2 text-sm font-medium text-accent group-hover:underline">
              {mode.cta} →
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-14 flex items-center gap-3 rounded-lg border border-surface-muted bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
        <span className="inline-block size-2 rounded-full bg-clinical" />
        <span>
          Backend health:{" "}
          <a
            href="/api/health"
            className="font-medium text-ink underline decoration-dotted underline-offset-4 hover:text-accent"
          >
            /api/health
          </a>
        </span>
      </div>
    </section>
  );
}
