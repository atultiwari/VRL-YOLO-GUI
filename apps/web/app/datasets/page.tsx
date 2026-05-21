"use client";

import { Database, Upload } from "lucide-react";
import Link from "next/link";

import { LibraryTable } from "@/components/datasets/library-table";
import { Button } from "@/components/ui/button";

export default function DatasetsPage() {
  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Datasets · library
          </p>
          <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold tracking-tight">
            <Database className="size-7 text-accent" />
            Dataset library
          </h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Every dataset you&apos;ve uploaded lives here. Click a row to
            open its detail page (rename, see splits, replay runs).
            Re-use any dataset by going to{" "}
            <Link
              href="/train/dataset"
              className="text-accent hover:underline"
            >
              Train
            </Link>{" "}
            and switching to <em>Pick from library</em>.
          </p>
        </div>
        <Link href="/train/dataset">
          <Button size="sm">
            <Upload className="size-4" /> Upload new dataset
          </Button>
        </Link>
      </header>

      <LibraryTable mode="browse" />
    </section>
  );
}
