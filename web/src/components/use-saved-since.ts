"use client";

import { useEffect, useState } from "react";

import type { GeographyId } from "@/lib/contracts";
import {
  baselineFor, localDay, MAX_SINCE_AREAS, readSinceStore, recordVisit, sinceLine, sincePath, sinceQueryDate, writeSinceStore,
  type AreaSinceResponse, type SinceLine,
} from "@/lib/saved-since";

/** Per saved area: its "since" line. Its £/m² is the area view's Price tile (use-saved-prices.ts). */
export interface SavedSince {
  lines: Record<string, SinceLine>;
}

/**
 * Each saved area's "since your last visit" line and £/m² (lib/saved-since.ts): one request per area
 * (the newest MAX_SINCE_AREAS), then today's visit is recorded on this device. An area that fails keeps
 * its record and shows no line; areas no longer saved are forgotten.
 */
export function useSavedSince(ids: readonly GeographyId[]): SavedSince {
  const all = ids.join(",");
  const [lines, setLines] = useState<SavedSince>({ lines: {} });
  useEffect(() => {
    if (!all) return;
    const saved = all.split(",") as GeographyId[];
    const controller = new AbortController();
    const today = localDay();
    const store = readSinceStore();
    void Promise.all(saved.slice(0, MAX_SINCE_AREAS).map(async (id) => {
      const baseline = baselineFor(store[id], today);
      try {
        const response = await fetch(sincePath(id, sinceQueryDate(baseline, today)), { signal: controller.signal });
        if (!response.ok) return null;
        const answer = (await response.json()) as AreaSinceResponse;
        return answer.schemaVersion === "area-since.v1" ? { id, baseline, answer } : null;
      } catch {
        return null;
      }
    })).then((results) => {
      if (controller.signal.aborted) return;
      const next = Object.fromEntries(Object.entries(readSinceStore()).filter(([id]) => saved.includes(id as GeographyId)));
      const shown: Record<string, SinceLine> = {};
      for (const result of results) {
        if (!result) continue;
        const line = sinceLine(result.baseline, result.answer);
        if (line) shown[result.id] = line;
        next[result.id] = recordVisit(next[result.id], result.answer, today);
      }
      writeSinceStore(next);
      setLines({ lines: shown });
    });
    return () => controller.abort();
  }, [all]);
  return lines;
}
