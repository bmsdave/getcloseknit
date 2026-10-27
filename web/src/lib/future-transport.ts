import type { GeographyId } from "./contracts";

/** Mirrors api/area_api/future_transport.py (area-future-transport.v1): the nearest new station. */
export type FutureStatus = "under construction" | "consented" | "funded" | "proposed";

export interface FutureStation {
  station: string;
  scheme: string;
  mode: string;
  distanceM: number;
  status: FutureStatus;
  expectedYear: number | null;
  /** The TfL, GLA or DfT page the status comes from. */
  sourceUrl: string;
  withinReach: boolean;
}

export interface AreaFutureTransport {
  schemaVersion: "area-future-transport.v1";
  productReleaseId: string;
  value: { available: boolean; nearest: FutureStation | null; note: string | null };
  confidence: string;
  sources: { sourceId: string; sourceName: string; sourceUrl: string }[];
  caveats: string[];
}

export function futureTransportPath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/future-transport`;
}

/** The payload when it is an area-future-transport.v1 envelope, else null. */
export function readAreaFutureTransport(payload: unknown): AreaFutureTransport | null {
  const value = payload as AreaFutureTransport | null;
  return value?.schemaVersion === "area-future-transport.v1" && typeof value.value === "object" && value.value !== null
    ? value : null;
}
