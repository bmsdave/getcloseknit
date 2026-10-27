import type { GeographyId } from "./contracts";
import type { AreaFloodResponse, FloodAreaBands, FloodBand } from "./flood-risk";

// Demo flood bands for the preview areas (made up, shaped like area-flood.v1).
const bands = (low: number, medium: number, high: number, highestBand: FloodBand): FloodAreaBands => ({
  shares: { "very-low": Math.round((1 - low - medium - high) * 10000) / 10000, low, medium, high },
  highestBand,
});

const AREAS: Record<string, { riversSea: FloodAreaBands; surfaceWater: FloodAreaBands }> = {
  // Westminster preview: Thames-side, defended.
  E01000001: { riversSea: bands(0.18, 0.04, 0, "medium"), surfaceWater: bands(0.06, 0.02, 0.01, "high") },
  // North London preview: high ground.
  E01000002: { riversSea: bands(0, 0, 0, "very-low"), surfaceWater: bands(0.03, 0.004, 0.002, "low") },
  // South Bank preview: riverside.
  E01000003: { riversSea: bands(0.31, 0.12, 0.05, "high"), surfaceWater: bands(0.05, 0.015, 0.006, "medium") },
};
// MSOA and borough previews reuse the numbers of their preview LSOA.
const PREVIEW_LSOA: Record<string, string> = {
  E02000001: "E01000001", E09000001: "E01000001",
  E02000002: "E01000002", E09000002: "E01000002",
  E02000003: "E01000003", E09000003: "E01000003",
};
const HOMES: Record<string, { area: string; riversSea: FloodBand; surfaceWater: FloodBand }> = {
  "100000000001": { area: "E01000001", riversSea: "low", surfaceWater: "very-low" },
  "100000000012": { area: "E01000001", riversSea: "very-low", surfaceWater: "very-low" },
};

/** The demo area's flood bands, or null for an area the demo does not know. */
export function fixtureAreaFlood(id: GeographyId, uprn: string | null): AreaFloodResponse | null {
  const code = id.split(":").at(-1) ?? "";
  const key = code in AREAS ? code : PREVIEW_LSOA[code];
  const area = key ? AREAS[key] : undefined;
  if (!area) return null;
  const home = uprn ? HOMES[uprn] : undefined;
  return {
    schemaVersion: "area-flood.v1",
    productReleaseId: "preview-release",
    geographyId: id,
    available: true,
    ...area,
    dwelling: home && home.area === key ? { uprn: uprn as string, riversSea: home.riversSea, surfaceWater: home.surfaceWater } : null,
    sourceVersion: "preview-ea-flood",
    attribution: "Demo numbers shaped like Environment Agency flood risk data.",
    caveats: ["Demo data: not real flood risk."],
  };
}
