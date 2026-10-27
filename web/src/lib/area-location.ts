import type { GeographyId } from "./contracts";

/** Mirrors api/area_api/location.py (area-location.v1): rules on the land and planning activity. */
export type LocationPresence = "inside" | "partly" | "outside";

export interface AreaLocationResponse {
  schemaVersion: "area-location.v1";
  productReleaseId: string;
  geographyId: GeographyId;
  available: boolean;
  /** null: the council has published no conservation areas (unknown). */
  conservation?: { share: number; presence: LocationPresence; areas: { name: string; borough: string | null; share: number }[] } | null;
  /** London only: null elsewhere (so are congestionCharge and planning). */
  ulez?: { share: number; presence: LocationPresence } | null;
  congestionCharge?: { share: number; presence: LocationPresence } | null;
  planning?: {
    applications: number; householder: number; full: number; priorApproval: number;
    windowStart: string; windowEnd: string; regionMedian: number | null;
  } | null;
  /** Short card lines, written by the API so the site, the brief and Claude say the same thing. */
  notes: string[];
  sources: { release: string; sourceUrl: string; licence: string; attribution: string }[];
  caveats: string[];
}

export function locationPath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/location`;
}

/** The payload when it is an area-location.v1 document, else null. */
export function readAreaLocation(payload: unknown): AreaLocationResponse | null {
  const value = payload as AreaLocationResponse | null;
  return value?.schemaVersion === "area-location.v1" && Array.isArray(value.notes) ? value : null;
}

/** Demo mode has no location layers: an honest "not available" shaped like the real thing. */
export function demoAreaLocation(geographyId: GeographyId): AreaLocationResponse {
  return {
    schemaVersion: "area-location.v1", productReleaseId: "preview-release", geographyId, available: false,
    notes: [], sources: [],
    caveats: ["Conservation areas, charging zones and planning applications are loaded in real mode only."],
  };
}
