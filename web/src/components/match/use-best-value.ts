"use client";

import { useEffect, useState } from "react";

import { isMatchPack, type MatchPack, type PreferenceProfile } from "@/lib/contracts";
import { matchRequestPath, type DataMode } from "@/lib/map-state";
import { searchKey } from "@/lib/match-search";

/** The home type the value compares (the API's homeType): flat, a house type picked alone, else all homes. */
function homeType(profile: PreferenceProfile): string | null {
  if (profile.propertyType === "flat") return "flat";
  const types = profile.houseTypes ?? [];
  return types.length === 1 ? types[0] : null;
}

/**
 * "Best value": the same search with sort=best-value, asked only while that sort is shown.
 * `status` none: no area had 20+ sales to compare (the preview never has), so the sort stays on the match.
 */
export function useBestValue(profile: PreferenceProfile, mode: DataMode, release: string, on: boolean): { pack: MatchPack | null; status: "idle" | "loading" | "ready" | "none" } {
  const [state, setState] = useState<{ key: string; pack: MatchPack | null } | null>(null);
  const key = on ? `${mode}|${release}|${searchKey(profile)}` : null;
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const type = homeType(profile);
    const path = `${matchRequestPath(mode, release)}&sort=best-value${type ? `&homeType=${type}` : ""}`;
    void fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: searchKey(profile), signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: MatchPack | null) => { if (!controller.signal.aborted) setState({ key, pack: payload && isMatchPack(payload) ? payload : null }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, pack: null }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return { pack: null, status: "idle" };
  if (!state || state.key !== key) return { pack: null, status: "loading" };
  const valued = state.pack?.values.some((result) => result.value && !result.value.outlier) ?? false;
  return { pack: valued ? state.pack : null, status: valued ? "ready" : "none" };
}
