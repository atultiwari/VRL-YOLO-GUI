"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchHealth } from "./api";
import { RELEASES, type ReleaseEntry } from "./changelog";

/**
 * Live binary version from `/api/health` plus the matching release card
 * (when one exists). Used in the topbar, the changelog page, and any
 * future "About" dialog — TanStack Query dedupes the underlying request
 * automatically so multiple components share one fetch per minute.
 */
export function useLiveVersion(): {
  version: string | undefined;
  release: ReleaseEntry | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    staleTime: 60_000,
    // Don't retry forever — the backend can take ~15 s on cold launch
    // (Pyloid lifespan + lazy model registry); a single retry covers that
    // without spinning forever if the server's genuinely gone.
    retry: 1,
  });

  const release = data
    ? RELEASES.find((r) => r.version === data.version)
    : undefined;

  return {
    version: data?.version,
    release,
    isLoading,
    isError,
  };
}
