"use client";

import { useEffect, useState } from "react";

import { isMatchPack, type MatchJob, type MatchPack } from "@/lib/contracts";
import { matchRequestPath, type DataMode } from "@/lib/map-state";
import { namedPack } from "@/lib/match-brief";

/**
 * A search scored as the map scores it, off the map (the shared brief, /compare, Saved): one POST of `body` (the
 * profile JSON); a routed job's first, partial pack is enough. Null while waiting or with no body; "failed" when the
 * API refuses. Areas come by the names people use ("Highbury East · N5"), never the code.
 */
export function useSearchPack(body: string | null, mode: DataMode, release: string): MatchPack | "failed" | null {
  const [pack, setPack] = useState<MatchPack | "failed" | null>(null);
  useEffect(() => {
    if (!body) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(matchRequestPath(mode, release), {
          method: "POST", headers: { "content-type": "application/json" }, body, signal: controller.signal,
        });
        if (!response.ok) {
          setPack("failed");
          return;
        }
        const payload = await response.json() as MatchPack | MatchJob;
        setPack(namedPack(isMatchPack(payload) ? payload : payload.partial));
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) setPack("failed");
      }
    })();
    return () => controller.abort();
  }, [body, mode, release]);
  return pack;
}
