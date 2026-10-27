import type { GeographyId } from "./contracts";

/** Mirrors api/area_api/pipeline.py (area-pipeline.v1): new homes on the way and growth areas. */
export interface PipelineValue {
  notStarted: number;
  underConstruction: number;
  completed5y: number;
  homes: number | null;
  per1000: number | null;
  regionPercentile: number | null;
  within1km: { radiusMetres: number; total: number; notStarted: number; underConstruction: number };
  growthAreas: { name: string; kind: "opportunity-area" | "housing-zone"; url: string; share: number; presence: "inside" | "partly" }[];
  /** Short card lines, written by the API so the site, the brief and Claude say the same thing. */
  notes: string[];
}

export interface AreaPipelineResponse {
  schemaVersion: "area-pipeline.v1";
  productReleaseId: string;
  dataMode: "release" | "demo";
  /** null before the layers are loaded. */
  value: PipelineValue | null;
  confidence: "high" | "medium" | "low" | "none";
  evidence: Record<string, unknown>[];
  sources: { release: string; sourceUrl: string; licence: string; attribution: string }[];
  caveats: string[];
}

export function pipelinePath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/pipeline`;
}

/** The payload when it is an area-pipeline.v1 envelope, else null. */
export function readAreaPipeline(payload: unknown): AreaPipelineResponse | null {
  const value = payload as AreaPipelineResponse | null;
  return value?.schemaVersion === "area-pipeline.v1" && Array.isArray(value.caveats) ? value : null;
}

/** Demo mode has no pipeline layers: an honest empty envelope shaped like the real thing. */
export function demoAreaPipeline(): AreaPipelineResponse {
  return {
    schemaVersion: "area-pipeline.v1", productReleaseId: "preview-release", dataMode: "demo", value: null,
    confidence: "none", evidence: [], sources: [],
    caveats: ["New homes permitted or being built are loaded in real mode only."],
  };
}
