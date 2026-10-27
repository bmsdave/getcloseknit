"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { fetchAreaNames } from "@/lib/area-names";
import { briefApiPath, type AreaBrief } from "@/lib/brief-model";
import type { GeographyId, PreferenceProfile, SimilarAreasResponse } from "@/lib/contracts";
import { applyLikeSeed, likeSeed, likeSummary, type LikeSeed } from "@/lib/find-like";
import type { DataMode } from "@/lib/map-state";
import { friendlyName } from "@/lib/match-brief";
import { MATCH_CHIPS } from "@/lib/match-ranges";
import { addCriterion, normaliseSearch } from "@/lib/match-search";
import { parseFindBudget, parseFindLike } from "@/lib/profile-state";

export interface FindLike {
  /** /?find=like or /?find=budget asked for My match (it opens on the list, the budget prefilled). */
  open: boolean;
  /** The area a "Like this" link starts from, by name; null for a tool's budget or while loading. */
  name: string | null;
  /** "Like Highbury: budget up to £730k, …" once the area's evidence is in. */
  summary: string | null;
  /** The budget to start from: the area's price band, or the tool's price (a draft until the household confirms it). */
  ballpark: number | null;
  /** A tool's "Areas this buys in →" price (/?find=budget&price=…): applied at once as the typed maximum. */
  carried: number | null;
  /** The area's criteria into the search with the household's first budget; later edits keep their own changes. */
  seedInto: (profile: PreferenceProfile) => PreferenceProfile;
  dismiss: () => void;
}

/**
 * "Like this" (/?find=like&area=lsoa:E…) and a tool's "Find areas at this budget" (/?find=budget&price=…) open My match
 * (no wizard): the area's name, price band and schools come from the brief and names lookups, its place
 * criteria from the similar-areas endpoint (lib/find-like). Nothing is stored until the household confirms a budget.
 */
export function useFindLike(profile: PreferenceProfile, mode: DataMode): FindLike {
  const [area, setArea] = useState<GeographyId | null>(null);
  const [found, setFound] = useState<{ name: string | null; brief: AreaBrief | null } | null>(null);
  const [similar, setSimilar] = useState<SimilarAreasResponse | null>(null);
  const seeded = useRef(false);
  const [open, setOpen] = useState(false);
  // Read from the live address: on the map, "Like this" links to this same page, which stays mounted (bug 13).
  const search = useSearchParams()?.toString() ?? "";
  const requested = parseFindLike(search);
  const [budget, setBudget] = useState<number | null | undefined>(undefined);
  const askedBudget = parseFindBudget(search);
  useEffect(() => {
    if (!requested) return;
    setArea(requested);
    setOpen(true);
  }, [requested]);
  useEffect(() => {
    if (askedBudget === undefined) return;
    setBudget(askedBudget);
    setOpen(true);
  }, [askedBudget]);
  useEffect(() => {
    if (!area) return;
    const controller = new AbortController();
    const get = (path: string) => fetch(path, { signal: controller.signal, headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null)).catch(() => null);
    const brief = briefApiPath({ areas: [area], budget: [null, null], market: profile.market, bedrooms: profile.bedrooms,
      propertyType: profile.propertyType ?? "any", criteria: [], destinations: [] });
    // The name from the names lookup: the area summary needs a metric and a month (a bare call is a 422).
    void Promise.all([get(`${brief}&mode=${mode}`) as Promise<AreaBrief | null>, fetchAreaNames([area], fetch, controller.signal)])
      .then(([answer, names]) => {
        if (controller.signal.aborted) return;
        const place = answer?.areas?.[0] ?? null;
        setFound({ name: names[area] ?? (place ? friendlyName(place) : null), brief: answer });
      });
    return () => controller.abort();
  }, [area, profile.market, profile.bedrooms, profile.propertyType, mode]);
  useEffect(() => {
    if (!area) return;
    const controller = new AbortController();
    void fetch(`/api/v1/areas/${encodeURIComponent(area)}/similar`, { signal: controller.signal, headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() as Promise<SimilarAreasResponse> : null)).catch(() => null)
      .then((answer) => { if (!controller.signal.aborted) setSimilar(answer); });
    return () => controller.abort();
  }, [area]);
  const seed: LikeSeed | null = found ? likeSeed({ market: profile.market, area: found.brief?.areas?.[0] ?? null, schools: found.brief?.schools ?? [], similar }) : null;
  const name = found?.name ?? null;
  return {
    open, name,
    summary: seed && name ? likeSummary(name, seed) : null,
    ballpark: seed?.budget ?? budget ?? null,
    carried: open && !area && typeof budget === "number" ? budget : null,
    seedInto: (next) => {
      if (!seed || seeded.current) return next;
      seeded.current = true;
      // The area's limits as range criteria (Musts on its own percentiles), then Good schools when it has them.
      const withArea = normaliseSearch(applyLikeSeed(next, seed));
      return seed.schools ? addCriterion(withArea, MATCH_CHIPS.find((chip) => chip.id === "good-schools")!.criterion) : withArea;
    },
    dismiss: () => { setOpen(false); setArea(null); setBudget(undefined); setFound(null); setSimilar(null); seeded.current = false; dropFindLike(); },
  };
}

/** Forgets the find-like or find-budget address, so following the link again opens it afresh. */
function dropFindLike() {
  const url = new URL(window.location.href);
  const find = url.searchParams.get("find");
  if (find !== "like" && find !== "budget") return;
  url.searchParams.delete("find");
  url.searchParams.delete("area");
  url.searchParams.delete("price");
  window.history.replaceState(null, "", url);
}
