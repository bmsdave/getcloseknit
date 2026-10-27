"use client";

import { useEffect, useState } from "react";

import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { MAX_SINCE_AREAS } from "@/lib/saved-since";
import { fetchSectionJson } from "@/lib/section-fetch";
import { readStandouts, standoutsPath } from "@/lib/standouts";

/**
 * Each saved area's Price tile words ("£12,300/m²"), read from the same standouts answer the area view and Compare
 * use (cached per page, so an area already open costs nothing). The newest MAX_SINCE_AREAS; an area without the
 * tile shows no price, never another series.
 */
export function useSavedPrices(ids: readonly GeographyId[], mode: DataMode): Record<string, string> {
  const all = ids.join(",");
  const [prices, setPrices] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!all) return;
    let current = true;
    const saved = (all.split(",") as GeographyId[]).filter((id) => /^uk:(lsoa|msoa|lad):/.test(id)).slice(0, MAX_SINCE_AREAS);
    void Promise.all(saved.map(async (id) => {
      // The page's mode, as Compare reads it: a real page never shows a preview release's price.
      const tile = readStandouts(await fetchSectionJson<unknown>(standoutsPath(id)), mode)?.tiles.find((entry) => entry.id === "price");
      return tile?.available && tile.display ? [id, tile.display] as const : null;
    })).then((found) => {
      if (current) setPrices(Object.fromEntries(found.filter((entry) => entry !== null)));
    });
    return () => { current = false; };
  }, [all, mode]);
  return prices;
}
