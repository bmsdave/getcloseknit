/**
 * The Cycle lanes overlay ("Show on map"): TfL Cycling Infrastructure Database
 * lanes and tracks and the open TfL Cycleways (GET /api/v1/tiles/cycle-lanes),
 * from zoom 11; painted lanes from zoom 13. Cycle is sky (the Show swatch; tangerine is
 * reserved for road collisions), always dashed on a cream casing, so the pattern tells it from the
 * Victoria line's solid sky: protected track wide dashes, Cycleways ply dashes, painted lanes a thin dash.
 */
import type { ExpressionSpecification, FilterSpecification, LayerSpecification, VectorSourceSpecification } from "maplibre-gl";
import { withRelease } from "./release-url";

export const CYCLE_SOURCE_ID = "cycle-lanes";
export const CYCLE_LAYERS = ["cycle-casing", "cycle-lane-casing", "cycle-lane", "cycle-cycleway", "cycle-protected"] as const;
export const CYCLE_MIN_ZOOM = 11;
const CYCLE_TILE_MAX_ZOOM = 16;
const SKY = "#4aa3df";
const CASING = "#fffaf3";

export const CYCLE_ATTRIBUTION = "Cycle lanes: Powered by TfL Open Data (Cycling Infrastructure Database 2017–19, Cycleways 2026)";

/** The overlay's key: what each line means. */
export const CYCLE_KEY = [
  { kind: "protected", label: "Protected track" },
  { kind: "cycleway", label: "Cycleway" },
  { kind: "lane", label: "Painted lane" },
] as const;

/** A lane's peek (Map controls PR 4): its type, then its name when it has one ("Cycleway", "C3"). */
export function cycleLanePeekLines(properties: Record<string, unknown>): string[] {
  const type = CYCLE_KEY.find((entry) => entry.kind === properties.kind)?.label;
  if (!type) return [];
  const name = typeof properties.name === "string" ? properties.name.trim() : "";
  return name && name !== type ? [type, name] : [type];
}

export function cycleSource(origin: string, release?: string | null): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [withRelease(`${origin}/api/v1/tiles/cycle-lanes/{z}/{x}/{y}.pbf`, release)],
    minzoom: CYCLE_MIN_ZOOM,
    maxzoom: CYCLE_TILE_MAX_ZOOM,
    attribution: CYCLE_ATTRIBUTION,
  };
}

const kind = (value: string): FilterSpecification => ["==", ["get", "kind"], value];
const width = (base: number): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 11, base * 0.6, 16, base * 1.8];

export function cycleLayers(): LayerSpecification[] {
  const common = { source: CYCLE_SOURCE_ID, "source-layer": "cycle_lanes", layout: { "line-cap": "round" as const, "line-join": "round" as const } };
  return [
    { ...common, id: "cycle-casing", type: "line", filter: ["!=", ["get", "kind"], "lane"],
      paint: { "line-color": CASING, "line-width": width(4.5), "line-opacity": 0.85 } },
    { ...common, id: "cycle-lane-casing", type: "line", filter: kind("lane"), minzoom: 13,
      paint: { "line-color": CASING, "line-width": width(2.6), "line-opacity": 0.85 } },
    { ...common, id: "cycle-lane", type: "line", filter: kind("lane"), minzoom: 13,
      paint: { "line-color": SKY, "line-width": width(1.2), "line-dasharray": [1.5, 1.5] } },
    { ...common, id: "cycle-cycleway", type: "line", filter: kind("cycleway"),
      paint: { "line-color": SKY, "line-width": width(2.5), "line-dasharray": [2, 1.2] } },
    { ...common, id: "cycle-protected", type: "line", filter: kind("protected"),
      paint: { "line-color": SKY, "line-width": width(3), "line-dasharray": [3, 1] } },
  ];
}
