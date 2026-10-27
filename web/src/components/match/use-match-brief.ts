"use client";

import { useEffect, useMemo, useState } from "react";

import { type AreaBrief, briefApiPath } from "@/lib/brief-model";
import type { GeographyId, MatchPack, PreferenceProfile } from "@/lib/contracts";
import { bottomBriefAreasFor, briefAreasFor, briefRequestFor, refitBrief } from "@/lib/match-brief";
import type { MatchList } from "@/lib/match-map";
import { isUnsetProfile } from "@/lib/profile-state";
import type { DataMode } from "@/lib/map-state";

/**
 * The search brief behind My match: prices against the budget, the ring of neighbours, graded
 * schools and the nearest station for the selected area, liked areas and the best ranked —
 * refetched (debounced) when any of them or the budget changes.
 */
export function useMatchBrief(profile: PreferenceProfile, pack: MatchPack | null, selected: GeographyId | null,
  mode: DataMode, enabled: boolean, page = 0, list: MatchList = "top"): AreaBrief | null {
  const [brief, setBrief] = useState<AreaBrief | null>(null);
  const liked = profile.marks?.liked ?? [];
  // The list's own ten (matchRows): the map pins and numbers the rows shown; Bottom 10 pins those ten.
  const areas = useMemo(() => (list === "bottom" ? bottomBriefAreasFor(pack, selected, profile) : briefAreasFor(pack, selected, liked, page, profile)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pack, profile, selected, list, page, liked.join(",")]);
  // Nothing asked yet: no brief for the untouched default (the panel shows its call to action).
  const unset = isUnsetProfile(profile);
  const path = useMemo(() => {
    if (!enabled || unset || areas.length === 0) return null;
    return `${briefApiPath(briefRequestFor(profile, areas))}&mode=${mode}`;
    // The path depends only on these fields of the profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, unset, areas.join(","), profile.targetBudget, profile.maximumBudget, profile.bedrooms, profile.market, profile.propertyType, profile.houseTypes?.length, mode]);
  useEffect(() => {
    if (!path) {
      setBrief(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(path, { signal: controller.signal, headers: { accept: "application/json" } })
        .then(async (response) => (response.ok ? (await response.json()) as AreaBrief : null))
        .then((body) => { if (!controller.signal.aborted) setBrief(body); })
        .catch(() => undefined);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [path]);
  // Prices against the budget as the chip says it: ≤ target within, up to the maximum a stretch, beyond it over.
  const { targetBudget, maximumBudget } = profile;
  return useMemo(() => (brief ? refitBrief(brief, { targetBudget, maximumBudget }) : null), [brief, targetBudget, maximumBudget]);
}
