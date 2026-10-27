import type { GeographyId } from "./contracts";
import type { DataMode } from "./map-state";

/** The area profile's URL (lib/area-profile.ts reads it; the area page's server seed builds the same). */
export function areaProfilePath(query: { selected: GeographyId; period: string; mode: DataMode; release: string }): string {
  const parameters = new URLSearchParams({ period: query.period, mode: query.mode, release: query.release });
  return `/api/v1/areas/${encodeURIComponent(query.selected)}/profile?${parameters.toString()}`;
}
