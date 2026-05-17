"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  GitCommit,
  Tag,
  Wrench,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { fetchHealth } from "@/lib/api";
import { RELEASES, type ReleaseEntry } from "@/lib/changelog";
import { cn } from "@/lib/utils";

function ReleaseHeader({
  release,
  isLive,
}: {
  release: ReleaseEntry;
  isLive: boolean;
}) {
  return (
    <CardHeader className="gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="accent">{release.phase}</Badge>
            <CardTitle className="text-lg">{release.title}</CardTitle>
          </div>
          <CardDescription className="mt-1">
            {release.date} · v{release.version}
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isLive ? (
            <Badge tone="clinical">
              <CircleDot className="mr-1 size-3" />
              Running here
            </Badge>
          ) : release.status === "current" ? (
            <Badge tone="accent">Latest tag</Badge>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        {release.tag ? (
          <span className="inline-flex items-center gap-1">
            <Tag className="size-3" />
            <a
              href={`https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/${release.tag}`}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {release.tag}
            </a>
          </span>
        ) : null}
        {release.commit && release.commit !== "TBD" ? (
          <span className="inline-flex items-center gap-1">
            <GitCommit className="size-3" />
            <a
              href={`https://github.com/atultiwari/VRL-YOLO-GUI/commit/${release.commit}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:underline"
            >
              {release.commit}
            </a>
          </span>
        ) : null}
      </div>
    </CardHeader>
  );
}

function BulletList({
  items,
  icon: Icon,
  iconClass,
}: {
  items: string[];
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
}) {
  return (
    <ul className="space-y-2">
      {items.map((entry, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-ink">
          <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} />
          <span>{entry}</span>
        </li>
      ))}
    </ul>
  );
}

function ReleaseCard({
  release,
  liveVersion,
}: {
  release: ReleaseEntry;
  liveVersion: string | undefined;
}) {
  const isLive = liveVersion === release.version;
  return (
    <Card
      className={cn(
        isLive && "border-clinical ring-1 ring-clinical/30",
        release.status === "current" && !isLive && "border-accent",
      )}
    >
      <ReleaseHeader release={release} isLive={isLive} />
      <CardContent className="space-y-5">
        {release.features.length ? (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Features
            </h4>
            <BulletList
              items={release.features}
              icon={CheckCircle2}
              iconClass="text-clinical"
            />
          </section>
        ) : null}
        {release.fixes.length ? (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Fixes
            </h4>
            <BulletList items={release.fixes} icon={Wrench} iconClass="text-accent" />
          </section>
        ) : null}
        {release.knownLimitations?.length ? (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Known limitations
            </h4>
            <BulletList
              items={release.knownLimitations}
              icon={AlertTriangle}
              iconClass="text-amber-600"
            />
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function ChangelogPage() {
  const { data: health, isLoading, error } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    staleTime: 60_000,
  });

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Changelog · what works in which build
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            Features &amp; fixes per release.
          </h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Each entry covers one phase of the{" "}
            <Link href="https://github.com/atultiwari/VRL-YOLO-GUI/blob/main/PLAN.md" className="underline decoration-dotted hover:text-accent">
              build plan
            </Link>
            . Items marked &ldquo;features&rdquo; are wired up end-to-end and exposed in
            the UI; &ldquo;known limitations&rdquo; are deferred to the next phase.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-ink-muted">
          {isLoading ? (
            <span className="inline-flex items-center gap-2">
              <Spinner /> Checking running build…
            </span>
          ) : error || !health ? (
            <span className="text-red-700">Backend unreachable</span>
          ) : (
            <>
              <span>
                Running:{" "}
                <span className="font-semibold text-ink tabular-nums">
                  v{health.version}
                </span>
              </span>
              <span className="text-ink-muted/80">
                Python {health.python}
              </span>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-4">
        {RELEASES.map((r) => (
          <ReleaseCard key={r.version} release={r} liveVersion={health?.version} />
        ))}
      </div>
    </section>
  );
}
