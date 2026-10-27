"use client";

import { useMemo } from "react";

import type { AreaResponse, AreaSummary, GeographyId, MetricDefinition } from "@/lib/contracts";
import { foodHygienePath, METRICS_PATH } from "@/lib/section-seed";
import { useSectionJson } from "./section-seed";

const METRIC = "food-hygiene";
const GOOD = "rated-4-or-5";

/** "112 of 126 rated places", or null when the counts are not published. */
export function ratedPlacesWords(summary: AreaSummary): string | null {
  const good = summary.breakdown?.[GOOD];
  const rated = summary.sampleCount;
  if (good === undefined || !rated) return null;
  return `${good.toLocaleString("en-GB")} of ${rated.toLocaleString("en-GB")} rated food places`;
}

/** The food hygiene method, for the Local places ⓘ. */
export const FOOD_HYGIENE_METHOD = "Food hygiene: cafés, restaurants, takeaways and pubs within 800 m with a published rating; exempt places and "
  + "those awaiting inspection are left out. Food Standards Agency, Open Government Licence v3.0.";

/**
 * The share of rated cafés, restaurants, takeaways and pubs within 800 m rated
 * 4 or 5 (FSA Food Hygiene Rating Scheme), read through the ordinary area
 * endpoint for the `food-hygiene` metric: about nearby food places, never the
 * people who live in the area. Null while loading; "unavailable" when the
 * metric is not served or the area is suppressed (fewer than 5 rated places).
 */
export function useFoodHygiene(geographyId: GeographyId): AreaSummary | null | "unavailable" {
  const metrics = useSectionJson<{ metrics: MetricDefinition[] }>(METRICS_PATH);
  const period = metrics?.metrics.find((metric) => metric.id === METRIC)?.defaultPeriod;
  const area = useSectionJson<AreaResponse>(period ? foodHygienePath(geographyId, period) : null);
  return useMemo(() => {
    if (metrics === undefined || (period && area === undefined)) return null;
    const found = area?.summary;
    return found && found.value !== null ? found : "unavailable";
  }, [metrics, period, area]);
}
