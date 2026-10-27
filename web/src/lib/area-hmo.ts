import type { GeographyId } from "./contracts";

/** Mirrors api/area_api/hmo.py (area-hmo.v1): licensed HMOs per 1,000 homes and licensing schemes. */
export type RegisterStatus = "published" | "search-only" | "on-request" | "not-found" | "failed";

export interface HmoScheme {
  kind: "additional" | "selective";
  start: string | null;
  until: string | null;
  url: string;
  /** "part": only some of the area's postcodes are in the scheme's wards; "streets": a scheme on named streets. */
  coverage: "whole" | "part" | "streets";
  streets?: number | null;
}

export interface AreaHmoValue {
  geographyId: GeographyId;
  available: boolean;
  borough?: { id: GeographyId; name: string };
  register?: { status: RegisterStatus; url: string | null; page: string | null; updated: string | null; retrieved: string | null };
  /** null unless the borough published its register: "not published", never zero. */
  licensedHmos?: number | null;
  homes?: number | null;
  per1000Homes?: number | null;
  regionPer1000?: number | null;
  regionPercentile?: number | null;
  schemes: HmoScheme[];
  notes: string[];
  sourceVersions?: string[];
}

export interface AreaHmoResponse {
  schemaVersion: "area-hmo.v1";
  productReleaseId: string;
  dataMode: "release" | "demo";
  confidence: string;
  value: AreaHmoValue;
  evidence: unknown[];
  sources: { sourceId: string; sourceName: string; sourceUrl?: string; release?: string; licence?: string; attribution?: string }[];
  caveats: string[];
}

export function hmoPath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/hmo`;
}

/** The payload when it is an area-hmo.v1 envelope, else null. */
export function readAreaHmo(payload: unknown): AreaHmoResponse | null {
  const value = payload as AreaHmoResponse | null;
  return value?.schemaVersion === "area-hmo.v1" && value.value && Array.isArray(value.value.schemes) ? value : null;
}

/** Demo mode has no registers: an honest "not available" shaped like the real thing. */
export function demoAreaHmo(geographyId: GeographyId): AreaHmoResponse {
  return {
    schemaVersion: "area-hmo.v1", productReleaseId: "preview-release", dataMode: "demo", confidence: "none",
    value: { geographyId, available: false, schemes: [], notes: [] },
    evidence: [], sources: [], caveats: ["HMO registers are loaded in real mode only."],
  };
}

/** "2030-11-30" -> "30 Nov 2030". */
export function shortDate(value: string | null): string | null {
  if (!value) return null;
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(day.getTime()) ? null
    : day.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
