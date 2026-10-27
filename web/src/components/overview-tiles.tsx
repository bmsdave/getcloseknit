"use client";

import { useMemo } from "react";

import { ChartIcon } from "@/components/charts";
import type { AreaSummary, GeographyId, MetricId } from "@/lib/contracts";
import { mediumOrHighShare, worseFloodBand, type AreaFloodResponse, type FloodBand } from "@/lib/flood-risk";
import { formatMonth } from "@/lib/market";
import type { DataMode } from "@/lib/map-state";
import { versusLondon } from "@/lib/overview-text";
import { placesPath, readAreaPlaces, type AreaPlacesState } from "@/lib/places";
import { periodYearsBefore } from "@/lib/price-change";
import type { RatingTrend } from "@/lib/rating";
import { useSectionJson } from "./section-seed";

/*
 * What the area view still shares from the old overview: the places read, the section heads' icon,
 * the year trend, the worse flood band and the London comparison in words. The old x/10 tiles
 * (OverviewTiles, "Details ›", the London cards) are gone: the map sheet, the side panel and the area
 * page show the v3 tiles (area-standouts.tsx) at every height.
 */

/** The Transport section's places payload, shared through the section cache (no second fetch). */
export function useOverviewPlaces(geographyId: GeographyId, uprn: string | null, mode: DataMode, release: string): AreaPlacesState | null {
  const payload = useSectionJson(placesPath({ selected: geographyId, uprn, mode, release }));
  return useMemo(() => payload === undefined ? null
    : payload === null ? { status: "unavailable", reason: "places-unreachable" } : readAreaPlaces(payload, mode), [payload, mode]);
}

/** A section head's knitted glyph (the chart kit's set plus trend, crime, income, flood, noise, people, planning, key). */
export function HeadIcon({ name }: { name: string }) {
  return <ChartIcon name={name} />;
}

/** "+4% vs Aug 2025": the newest point against the same month a year before (or the oldest point at least 11 months back). */
export function yearTrend(timeline: readonly AreaSummary[], goodWhenUp: boolean | null): RatingTrend | null {
  const to = timeline.at(-1);
  const start = to ? periodYearsBefore(to.period, 1) : null;
  if (!to || to.value === null || !start) return null;
  const from = timeline.find((point) => point.period >= start && point.value !== null && point.value > 0);
  if (!from || from.value === null || monthsBetween(from.period, to.period) < 11) return null;
  return { pct: (to.value / from.value - 1) * 100, period: formatMonth(from.period), goodWhenUp, n: to.sampleCount ?? 0 };
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** The worse of the rivers & sea and surface-water bands (worseFloodBand), which source it is, and that source's
 * share of land at medium or high risk; a band only ever covers part of an area. */
export function floodWorst(flood: AreaFloodResponse | null): { band: FloodBand; source: string; share: number | null } | null {
  const band = worseFloodBand(flood);
  if (!band) return null;
  const rivers = flood?.riversSea ?? null;
  const surface = flood?.surfaceWater ?? null;
  const both = rivers?.highestBand === band && surface?.highestBand === band;
  const bands = rivers?.highestBand === band ? rivers : surface;
  const source = both ? "Rivers & sea, surface water" : bands === rivers ? "Rivers & sea" : "Surface water";
  return { band, source, share: bands?.shares ? mediumOrHighShare(bands) : null };
}

/** How each map metric reads against London: [higher percentile, lower percentile]. Census layers have no rank. */
const VERSUS: Partial<Record<MetricId, [string, string]>> = {
  "price-per-square-metre": ["pricier than", "cheaper than"],
  "stock-value-per-square-metre": ["pricier than", "cheaper than"],
  crime: ["more crime than", "less crime than"],
  // A higher deprivation percentile means less deprived.
  deprivation: ["less deprived than", "more deprived than"],
  income: ["higher than", "lower than"],
  "social-renting": ["more social renting than", "less social renting than"],
  // More minutes sit at a higher percentile.
  "station-access": ["a longer walk to a station than", "a shorter walk to a station than"],
  // Share of nearby rated food places rated 4 or 5: about places, never residents.
  "food-hygiene": ["more well-rated food places nearby than", "fewer well-rated food places nearby than"],
  "typical-price": ["pricier than", "cheaper than"],
  "typical-price-flat": ["pricier than", "cheaper than"],
  "typical-price-terraced": ["pricier than", "cheaper than"],
  "typical-price-semi": ["pricier than", "cheaper than"],
  "typical-price-detached": ["pricier than", "cheaper than"],
};

const capitalise = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

/** "Pricier than 92% of London areas" / "About average for London" / unknown. */
export function versusLondonWords(metricId: MetricId, percentile: number | null): string {
  const pair = VERSUS[metricId];
  const words = pair ? versusLondon(percentile, pair[0], pair[1]) : null;
  return words ? capitalise(words) : "London comparison unknown";
}
