/**
 * Nature map layers (deploy/tools/etl_nature.py `layers`). "Green & trees" is a London rank built from
 * green land (Sentinel-2), street trees per hectare and the nearest nature reserve or SSSI, all
 * measured the same way everywhere. "Wildlife seen" has one metric per species: a 0-3 band (No
 * record, Rarely, Sometimes, Often) from that species' share of the open-licence GBIF records within
 * 1 km, ranked against the other areas where it was recorded. Using a share keeps areas with many
 * observers and areas with few on the same footing; the band shades smoothly between thresholds.
 *
 * Areas with fewer than 200 records are left without a value, so they paint grey ("few records").
 * They never read as "not seen". Points are never drawn, and sensitive species are never listed.
 */

import { regionShare } from "./evidence-format";

export const WILDLIFE_SPECIES = [
  { id: "wildlife-hedgehog", label: "Hedgehog" },
  { id: "wildlife-bats", label: "Bats" },
  { id: "wildlife-fox", label: "Fox" },
  { id: "wildlife-deer", label: "Deer" },
  { id: "wildlife-kingfisher", label: "Kingfisher" },
  { id: "wildlife-woodpecker", label: "Woodpecker" },
  { id: "wildlife-owl", label: "Owl" },
  { id: "wildlife-heron", label: "Heron" },
  { id: "wildlife-swift", label: "Swift" },
  { id: "wildlife-house-sparrow", label: "House sparrow" },
  { id: "wildlife-frog", label: "Frog" },
  { id: "wildlife-newt", label: "Newt" },
] as const;

export const NATURE_METRIC_IDS = [
  "nature-score",
  "wildlife-hedgehog", "wildlife-bats", "wildlife-fox", "wildlife-deer", "wildlife-kingfisher", "wildlife-woodpecker",
  "wildlife-owl", "wildlife-heron", "wildlife-swift", "wildlife-house-sparrow", "wildlife-frog", "wildlife-newt",
] as const;

export type NatureMetricId = (typeof NATURE_METRIC_IDS)[number];
export type WildlifeMetricId = (typeof WILDLIFE_SPECIES)[number]["id"];

export function isWildlifeMetric(id: string): id is WildlifeMetricId {
  return WILDLIFE_SPECIES.some((species) => species.id === id);
}

/** The legend's title: "Green & trees · Area score (rank in London)" (its line says what), "Wildlife seen: Hedgehog, records within 1 km". */
export function natureLegendTitle(id: string): string | null {
  if (id === "nature-score") return "Green & trees · Area score (rank in London)";
  const species = WILDLIFE_SPECIES.find((entry) => entry.id === id);
  return species ? `Wildlife seen: ${species.label}, records within 1 km` : null;
}

/** One area's value in words: "Greener than 72% of London", "Seen often". */
export function natureValueText(id: string, value: number): string | null {
  if (id === "nature-score") return `Greener than ${regionShare(value)}% of London`;
  if (isWildlifeMetric(id)) return value <= 0 ? "Not in the records" : value < 1.5 ? "Seen rarely" : value < 2.5 ? "Seen sometimes" : "Seen often";
  return null;
}

/**
 * Layers drawn finer than an area (lib/map-street-trees.ts): Green streets colours each road link by its
 * street trees per 100 m; Canopy shades every 10 m cell green from the satellite. The areas of Green & trees
 * stay underneath, clear, so a tap still opens an area and the panel reads Green & trees.
 */
export const DETAIL_LAYER_IDS = ["green-streets", "canopy"] as const;
export type DetailLayerId = (typeof DETAIL_LAYER_IDS)[number];
export const DETAIL_AREA_LAYER = "nature-score" as const satisfies NatureMetricId;

export function isDetailLayer(id: string | null | undefined): id is DetailLayerId {
  return (DETAIL_LAYER_IDS as readonly string[]).includes(id ?? "");
}

/** The layer whose areas lie under a detail layer (Green & trees); any other layer is its own. */
export function detailAreaLayer<T extends string>(id: T): Exclude<T, DetailLayerId> | typeof DETAIL_AREA_LAYER {
  return (isDetailLayer(id) ? DETAIL_AREA_LAYER : id) as Exclude<T, DetailLayerId>;
}
