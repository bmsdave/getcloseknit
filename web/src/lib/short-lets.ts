import type { BarRow } from "@/components/charts";

import type { GeographyId } from "./contracts";
import { regionShare } from "./evidence-format";

/** Mirrors api/area_api/short_lets.py (area-short-lets.v1): Airbnb listings per 1,000 homes against London. */
export interface ShortLetsValue {
  available: true;
  listings: number;
  entireHome: number;
  active12m: number;
  /** Census 2021 households. */
  homes: number;
  /** null without Census homes to compare with. */
  per1000Homes: number | null;
  regionPercentile: number | null;
  regionPer1000Homes: number | null;
  entireHomeShare: number | null;
  regionEntireHomeShare: number | null;
  activeShare: number | null;
  regionActiveShare: number | null;
  /** The snapshot day, YYYY-MM-DD. */
  snapshot: string;
  sourceVersion: string;
  /** Short card lines, written by the API so the site and Claude say the same thing. */
  notes: string[];
}

export interface AreaShortLetsResponse {
  schemaVersion: "area-short-lets.v1";
  productReleaseId: string;
  value: ShortLetsValue | { available: false; notes: string[] };
  confidence: string;
  sources: { release: string; sourceUrl: string; licence: string; attribution: string }[];
  caveats: string[];
}

export const SHORT_LETS_ATTRIBUTION = "Inside Airbnb, insideairbnb.com, CC BY 4.0.";

export function shortLetsPath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/short-lets`;
}

/** The payload when it is an area-short-lets.v1 envelope, else null. */
export function readAreaShortLets(payload: unknown): AreaShortLetsResponse | null {
  const value = payload as AreaShortLetsResponse | null;
  return value?.schemaVersion === "area-short-lets.v1" && typeof value.value?.available === "boolean" ? value : null;
}

/** The loaded value, or null (not loaded, not served, or still loading). */
export function shortLetsValue(response: AreaShortLetsResponse | null | undefined): ShortLetsValue | null {
  return response?.value.available ? response.value : null;
}

/** Demo mode has no short lets: an honest "not available" shaped like the real thing. */
export function demoAreaShortLets(): AreaShortLetsResponse {
  return {
    schemaVersion: "area-short-lets.v1", productReleaseId: "preview-release", confidence: "none",
    value: { available: false, notes: [] }, sources: [],
    caveats: ["Short lets are loaded in real mode only."],
  };
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** "27 per 1,000 homes"; null without a rate. */
export function rateWords(rate: number | null): string | null {
  return rate === null ? null : `${Math.round(rate).toLocaleString("en-GB")} per 1,000 homes`;
}

/** Entire homes and activity as shares, each with London's tick. */
export function shortLetBars(value: ShortLetsValue): BarRow[] {
  const rows: BarRow[] = [];
  if (value.entireHomeShare !== null) {
    rows.push({ id: "entire", label: "Entire homes", value: value.entireHomeShare * 100, display: percent(value.entireHomeShare),
      marker: value.regionEntireHomeShare === null ? null : value.regionEntireHomeShare * 100 });
  }
  if (value.activeShare !== null) {
    rows.push({ id: "active", label: "Active (12 mo)", value: value.activeShare * 100, display: percent(value.activeShare),
      marker: value.regionActiveShare === null ? null : value.regionActiveShare * 100 });
  }
  return rows;
}

/** The scale's accessible sentence: the numbers, since a dot's position alone is not readable. */
export function shortLetScaleLabel(value: ShortLetsValue): string {
  const rate = rateWords(value.per1000Homes) ?? "No rate";
  const london = rateWords(value.regionPer1000Homes);
  return `${rate}${london ? `; London ${london}` : ""}${value.regionPercentile === null ? "" : `; more than ${regionShare(value.regionPercentile)}% of London areas`}`;
}
