/**
 * Every map layer for one area in one call: the contract of GET /api/v1/areas/{id}/layers
 * (api/area_api/layers.py, area-layers.v1). Each layer has the standouts tile shape, so AreaTiles draws
 * it; the API leaves section and theme empty and the site fills them from its layer catalogue
 * (lib/map-topics.ts). The home page asks for ?scope=overview: the Overview's layers in the API's order
 * (its OVERVIEW_LAYERS is the one list), the three ready-made criteria the area rates highest on, and
 * flood, air and broadband as band chips (no map metric).
 */
import type { GeographyId } from "./contracts";
import type { DataMode } from "./map-state";
import { findTopic, topicOfLayer } from "./map-topics";
import { ratingScore } from "./rating";
import { scopeName, type RankScope } from "./scope-name";
import type { TileView } from "./standouts";

export interface AreaLayer extends TileView {
  /** Compared with the same month a year before; null with only one period. percent is null from zero. */
  trend: { direction: "up" | "down" | "flat"; percent: number | null; years: number } | null;
}

export interface AreaLayerChip {
  id: "flood" | "air" | "broadband";
  label: string;
  /** "Low", "100% gigabit"; null without data or while withheld. */
  band: string | null;
}

export interface AreaLayersResponse {
  schemaVersion: "area-layers.v1";
  productReleaseId?: string;
  areaId: GeographyId;
  scope: "all" | "overview";
  /** The region the layers' percentiles are within (API rankScope); absent = London. */
  rankScope?: RankScope | null;
  layers: AreaLayer[];
  /** The ready-made criteria rated highest here; each id is its map layer (custom:{criterion}). */
  presets: AreaLayer[];
  chips: AreaLayerChip[];
  /** Flags that are off ("censusRanked", "laeiAir"): what the API kept back. */
  withheld: string[];
}

/** The Overview's read: its layers only, never every Census table. */
export function overviewLayersPath(id: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/layers?scope=overview`;
}

/** The payload when it is an area-layers.v1 document, else null; real mode never takes the demo's. */
export function readAreaLayers(payload: unknown, mode: DataMode = "real"): AreaLayersResponse | null {
  const value = payload as Partial<AreaLayersResponse> | null;
  if (value?.schemaVersion !== "area-layers.v1" || !Array.isArray(value.layers) || !Array.isArray(value.chips)) return null;
  if (mode === "real" && value.productReleaseId?.startsWith("preview-")) return null;
  return { ...value, presets: Array.isArray(value.presets) ? value.presets : [] } as AreaLayersResponse;
}

/** The map, on this area, coloured by that layer. */
export function layerHref(id: string, metric: string): string {
  return `/?${new URLSearchParams({ selected: id, layer: metric }).toString()}`;
}

/** The Overview's tiles: its layers in the API's order, then the top ready-made criteria, each with its
 *  section and theme from the map's catalogue; a criterion takes the map's short name ("Culture"). */
export function overviewTiles(response: AreaLayersResponse): AreaLayer[] {
  const presets = response.presets.map((preset) => ({ ...preset, label: findTopic(preset.id)?.label ?? preset.label }));
  return [...response.layers, ...presets].map((layer) => {
    const place = topicOfLayer(layer.id);
    return { ...layer, section: place?.topic ?? null, topic: place?.group ?? null };
  });
}

/** The chips to show: air is the LAEI grid, left out (not "No data") while `laeiAir` is withheld. */
export function overviewChips(response: AreaLayersResponse): AreaLayerChip[] {
  const withheld = new Set(response.withheld);
  return response.chips.filter((chip) => !(chip.id === "air" && withheld.has("laeiAir")));
}

/** "higher than most of London" at or above 60, "lower than most" at or below 40, else about average. */
function compared(percentile: number, scope = "London"): string {
  if (percentile >= 60) return `higher than most of ${scope}`;
  if (percentile <= 40) return `lower than most of ${scope}`;
  return `about average for ${scope}`;
}

/**
 * The Overview's opening paragraph, from the layers alone (a fixed template, no generated text): price
 * level, crime against London, the station walk and green & trees out of 10, deprivation. A clause
 * whose layer has no data is left out; null when none has.
 */
export function overviewSummary(response: AreaLayersResponse): string | null {
  const find = (id: string) => response.layers.find((layer) => layer.id === id && layer.available) ?? null;
  const parts: string[] = [];
  const scope = scopeName(response);
  const price = find("price-per-square-metre");
  if (price?.regionPercentile != null) parts.push(`Prices are ${compared(price.regionPercentile, scope)} (${price.display}).`);
  const crime = find("crime");
  // Crime's standing is the safer end; its raw London position is the other way round.
  if (crime?.standing != null) parts.push(`Crime is ${compared(100 - crime.standing, scope)} (${crime.display}).`);
  const walk = find("station-access");
  if (walk?.standing != null) parts.push(`The walk to a station is ${walk.display}, rated ${ratingScore(walk.standing, true)}/10 for ${scope}.`);
  const green = find("nature-score");
  if (green?.standing != null) parts.push(`Green & trees rate ${ratingScore(green.standing, true)}/10.`);
  const deprivation = find("deprivation");
  if (deprivation?.standing != null) {
    // A higher standing is less deprived.
    const words = deprivation.standing >= 60 ? `less deprived than most of ${scope}`
      : deprivation.standing <= 40 ? `more deprived than most of ${scope}` : `about average for ${scope} on deprivation`;
    parts.push(`It is ${words}.`);
  }
  return parts.length ? parts.join(" ") : null;
}
