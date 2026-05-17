import Link from "next/link";
import { Activity, Layers, Microscope, Brain } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Home",
    description: "Overview & quick start",
    icon: Activity,
  },
  {
    href: "/predict",
    label: "Predict",
    description: "Run detection or classification",
    icon: Microscope,
  },
  {
    href: "/train",
    label: "Train",
    description: "Fine-tune on your dataset",
    icon: Brain,
  },
  {
    href: "/models",
    label: "Models",
    description: "Bundled + imported library",
    icon: Layers,
  },
];

export function Sidebar() {
  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col gap-1 p-4">
      <p className="px-3 pb-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Workspace
      </p>
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="group flex items-start gap-3 rounded-md px-3 py-2 text-sm transition hover:bg-accent-subtle"
        >
          <item.icon className="mt-0.5 size-4 text-ink-muted group-hover:text-accent" />
          <span className="flex flex-col">
            <span className="font-medium text-ink">{item.label}</span>
            <span className="text-xs text-ink-muted">{item.description}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
