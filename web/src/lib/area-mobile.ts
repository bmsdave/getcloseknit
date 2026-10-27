import type { GeographyId } from "./contracts";
import { regionShare } from "./evidence-format";

interface Ranked { share: number | null; regionPercentile: number | null; regionShare: number | null }

/** Mirrors api/area_api/mobile.py (area-mobile.v1): Ofcom's predicted coverage, per borough. */
export interface AreaMobileResponse {
  schemaVersion: "area-mobile.v1";
  productReleaseId: string;
  geographyId: GeographyId;
  available: boolean;
  /** Ofcom publishes local authorities only: an LSOA or MSOA reads its borough's figure. */
  grain: "borough";
  confidence: "medium" | null;
  value: {
    borough: { id: GeographyId; name: string };
    premises: number;
    /** 4G indoors from all four networks; 5G outdoors from at least one. Shares 0-1. */
    indoor4gAll: Ranked;
    outdoor5gAny: Ranked;
    outdoor4gAll: number | null;
    outdoor5gAll: number | null;
    notes: string[];
    sourceVersions: string[];
  } | null;
  evidence: { metricId: string; geographyId: GeographyId; value: number; regionPercentile: number | null }[];
  notes: string[];
  sources: { release: string; sourceUrl: string; licence: string; attribution: string }[];
  caveats: string[];
}

export function mobilePath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/mobile`;
}

/** The payload when it is an area-mobile.v1 document, else null. */
export function readAreaMobile(payload: unknown): AreaMobileResponse | null {
  const value = payload as AreaMobileResponse | null;
  return value?.schemaVersion === "area-mobile.v1" && Array.isArray(value.notes) ? value : null;
}

/** "99.9%", "100%": London is near full, so one decimal keeps boroughs apart. */
export function mobilePercent(share: number | null | undefined): string | null {
  if (share === null || share === undefined || !Number.isFinite(share)) return null;
  const percent = Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10;
  return `${percent === 100 ? 100 : percent.toFixed(1)}%`;
}

/**
 * The Homes row beside broadband; null before the layer is loaded. Only 4G indoors carries its place in
 * London: 5G outdoors is near 100% in every borough, so its rank says nothing.
 */
export function mobileRow(mobile: AreaMobileResponse | null, scope = "London"): { term: string; value: string } | null {
  const value = mobile?.available ? mobile.value : null;
  if (!value) return null;
  const indoor = mobilePercent(value.indoor4gAll.share) ?? "unknown";
  const outdoor = mobilePercent(value.outdoor5gAny.share) ?? "unknown";
  const rank = value.indoor4gAll.regionPercentile;
  return {
    term: `Mobile (${value.borough.name})`,
    value: `4G indoors ${indoor}${rank !== null ? ` (above ${regionShare(rank)}% of ${scope === "London" ? "boroughs" : `local authorities in ${scope}`})` : ""} · 5G outdoors ${outdoor}`,
  };
}
