"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchAreaNames, idsToResolve, mergeNames } from "@/lib/area-names";

/**
 * Stored area names with any code-like one ("Haringey 019A", or the bare id) replaced by today's name
 * (names are resolved when a link or a saved list is read). One request, only when a stored
 * name needs it; the stored names show until it answers, and stay if it fails.
 */
export function useResolvedNames(ids: readonly string[], stored: Record<string, string>): Record<string, string> {
  const pending = useMemo(() => idsToResolve(stored, ids), [stored, ids]);
  const key = pending.join(",");
  const [resolved, setResolved] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void fetchAreaNames(key.split(","), fetch, controller.signal).then((names) => {
      if (!controller.signal.aborted) setResolved((previous) => ({ ...previous, ...names }));
    });
    return () => controller.abort();
  }, [key]);
  return useMemo(() => mergeNames(stored, resolved), [stored, resolved]);
}
