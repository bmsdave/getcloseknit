import type { GeographyId } from "./contracts";

/** Mirrors api/area_api/ownership.py (area-ownership.v1): land titles held by companies per home. */
interface Share { titles: number; share: number | null; regionPercentile: number | null; regionShare: number | null }

type OwnershipValue =
  | { available: false; reason: "flag-off" | "not-loaded" }
  | {
    available: true;
    company: Share;
    overseas: Share;
    homes: number;
    /** Boroughs only: titles with no usable postcode, counted for the borough alone. */
    unmatched: number | null;
    words: "High company ownership" | "Mostly owner/tenant homes" | null;
    notes: string[];
    sourceVersions: string[];
  };

export interface AreaOwnershipResponse {
  schemaVersion: "area-ownership.v1";
  productReleaseId: string;
  dataMode: "release" | "demo";
  value: OwnershipValue;
  confidence: "high" | "medium" | "low" | "none";
  evidence: unknown[];
  sources: { sourceId: string; sourceName: string; release: string; sourceUrl: string; licence: string; attribution: string }[];
  caveats: string[];
}

export function ownershipPath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/ownership`;
}

/** The payload when it is an area-ownership.v1 envelope, else null. */
export function readAreaOwnership(payload: unknown): AreaOwnershipResponse | null {
  const value = payload as AreaOwnershipResponse | null;
  return value?.schemaVersion === "area-ownership.v1" && typeof value.value?.available === "boolean" ? value : null;
}

/** Titles per 100 homes: "15", "0.4" under one. */
export function per100(share: number): string {
  const value = share * 100;
  return value < 1 ? value.toFixed(1) : `${Math.round(value)}`;
}

export interface OwnershipRow { id: "company" | "overseas"; label: string; value: number; marker: number | null; display: string; regionPercentile: number | null }

/** One bar per kind of owner, titles per 100 homes with London's as the tick; none when unavailable. */
export function ownershipRows(ownership: AreaOwnershipResponse | null): OwnershipRow[] {
  const value = ownership?.value;
  if (!value?.available) return [];
  return ([["company", "UK companies"], ["overseas", "Overseas"]] as const).flatMap(([id, label]) => {
    const share = value[id];
    if (share.share === null) return [];
    return [{
      id, label, value: Math.round(share.share * 10_000) / 100,
      marker: share.regionShare === null ? null : Math.round(share.regionShare * 1_000) / 10,
      display: `${per100(share.share)} per 100 homes`, regionPercentile: share.regionPercentile,
    }];
  });
}
