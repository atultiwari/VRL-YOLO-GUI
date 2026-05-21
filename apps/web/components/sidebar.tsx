import Link from "next/link";
import {
  Activity,
  Brain,
  Database,
  History,
  Layers,
  Microscope,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { currentRelease } from "@/lib/changelog";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const WORKSPACE: NavItem[] = [
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
    href: "/train/history",
    label: "Training history",
    description: "Past runs, replay, re-run",
    icon: History,
  },
  {
    href: "/datasets",
    label: "Datasets",
    description: "Uploaded library + reuse",
    icon: Database,
  },
  {
    href: "/models",
    label: "Models",
    description: "Bundled + imported library",
    icon: Layers,
  },
];

const PREFERENCES: NavItem[] = [
  {
    href: "/settings",
    label: "Settings",
    description: "Preferences for this device",
    icon: SettingsIcon,
  },
];

const RELEASE_NOTES: NavItem = {
  href: "/changelog",
  label: "Changelog",
  description: "What works in which build",
  icon: Sparkles,
};

function NavLink({ item }: { item: NavItem }) {
  return (
    <Link
      href={item.href}
      className="group flex items-start gap-3 rounded-md px-3 py-2 text-sm transition hover:bg-accent-subtle"
    >
      <item.icon className="mt-0.5 size-4 text-ink-muted group-hover:text-accent" />
      <span className="flex flex-col">
        <span className="font-medium text-ink">{item.label}</span>
        <span className="text-xs text-ink-muted">{item.description}</span>
      </span>
    </Link>
  );
}

export function Sidebar() {
  const current = currentRelease();
  return (
    <nav
      aria-label="Main navigation"
      className="flex h-full flex-col gap-1 p-4"
    >
      <p className="px-3 pb-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Workspace
      </p>
      {WORKSPACE.map((item) => (
        <NavLink key={item.href} item={item} />
      ))}

      <p className="mt-6 px-3 pb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Preferences
      </p>
      {PREFERENCES.map((item) => (
        <NavLink key={item.href} item={item} />
      ))}

      <p className="mt-6 px-3 pb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
        About
      </p>
      <Link
        href={RELEASE_NOTES.href}
        className="group flex items-start justify-between gap-3 rounded-md px-3 py-2 text-sm transition hover:bg-accent-subtle"
      >
        <span className="flex items-start gap-3">
          <RELEASE_NOTES.icon className="mt-0.5 size-4 text-ink-muted group-hover:text-accent" />
          <span className="flex flex-col">
            <span className="font-medium text-ink">{RELEASE_NOTES.label}</span>
            <span className="text-xs text-ink-muted">{RELEASE_NOTES.description}</span>
          </span>
        </span>
        <Badge tone="accent" className="shrink-0">
          v{current.version}
        </Badge>
      </Link>
    </nav>
  );
}
