/**
 * What stands out about a neighbourhood or borough: the contract of GET /api/v1/areas/{id}/standouts
 * (api/area_api/standouts.py). The area page shows the verdict line, the tags (≤ 3 pros, ≤ 2 cons from
 * London's best and worst 10%) and the 12 fixed tiles, in the same order on every area. Deprivation (the
 * official index of the area) is no tile but makes a tag in London's least or most deprived 10%, leading
 * to People where its decile is (owner decision). People, income and social housing never
 * make a tile or a tag.
 */
import type { GeographyId } from "./contracts";
import type { DataMode } from "./map-state";
import { regionShare } from "./evidence-format";
import type { RankScope } from "./scope-name";

export const STANDOUT_TILE_IDS = [
  "price", "safety", "schools", "station-walk", "cycling", "noise", "nature", "air", "gp", "food-hygiene", "nightlife", "families",
] as const;

export type StandoutTileId = (typeof STANDOUT_TILE_IDS)[number];

/** A section of the area page a tile or tag leads to (People: the deprivation tag only). */
export type StandoutSection = "price" | "safety" | "schools" | "getting-around" | "environment" | "health" | "local-places" | "people";

export interface StandoutTile {
  id: StandoutTileId;
  label: string;
  section: StandoutSection;
  topic: string;
  /** false: no value here; the tile stays in place and says "No data here". */
  available: boolean;
  value: number | null;
  display: string | null;
  /** 0-100 among London neighbourhoods, 100 the better end; null for neutral tiles (price, nightlife). */
  standing: number | null;
  /** Neutral tiles only: the raw London percentile (0 = the lowest value). */
  regionPercentile: number | null;
  /** In London's best (pro) or worst (con) 10%. */
  extreme: "pro" | "con" | null;
  detail: string | null;
  trend: { percent: number; years: number } | null;
  period: string | null;
}

/** What AreaTiles draws: a standouts tile, or any tile of its shape (the area layers', lib/area-layers.ts). */
export type TileView = Omit<StandoutTile, "id" | "section" | "topic" | "trend"> & {
  id: string;
  section: string | null;
  topic: string | null;
  /** percent null: a change from zero, said by its direction alone. */
  trend: { percent: number | null; years: number; direction?: "up" | "down" | "flat" } | null;
};

/** A tag comes from a tile, or from deprivation, which is no tile. */
export type StandoutTagId = StandoutTileId | "deprivation";

export interface StandoutTag {
  id: StandoutTagId;
  kind: "pro" | "con";
  text: string;
  section: StandoutSection;
}

/**
 * A borough's neighbourhood, for the borough page's Areas list: its price, crime and best
 * nearby primary as London positions (0-100); null when unknown, never 0.
 */
export interface NeighbourhoodStrip {
  geographyId: GeographyId;
  price: number | null;
  /** Neutral: the raw London percentile, higher is dearer. */
  priceLondonPercentile: number | null;
  crime: number | null;
  /** 100 = safer than all of London. */
  safetyStanding: number | null;
  /** The best state primary within 1 km among London's primaries, 100 = the best. */
  schoolStanding: number | null;
}

export interface AreaStandouts {
  schemaVersion: "area-standouts.v1";
  productReleaseId?: string;
  geographyId: GeographyId;
  /**
   * "lad": the tiles are the middle of its neighbourhoods, standing among London's boroughs;
   * "msoa": the same among London's MSOAs, tags in "of London" words (the map's one area view).
   */
  carrier?: "lad" | "msoa";
  verdict: string;
  tags: StandoutTag[];
  tiles: StandoutTile[];
  /** A borough's neighbourhoods with their strips; absent for a neighbourhood. */
  neighbourhoods?: NeighbourhoodStrip[];
  /** Features the API withholds ("laeiAir": the Air tile is left out, not shown as "No data here"); absent in an old payload. */
  withheld?: string[];
  /** The region the tiles' standings are within (London for a London area); absent from older APIs (London). */
  rankScope?: RankScope | null;
  caveats: string[];
}

/** The tiles to draw: Air is the LAEI grid, left out while `laeiAir` is withheld. */
export function visibleTiles<T extends { id: string }>(tiles: readonly T[], withheld?: readonly string[]): readonly T[] {
  return withheld?.includes("laeiAir") ? tiles.filter((tile) => tile.id !== "air") : tiles;
}

/**
 * Where every £/m² beside an area comes from: its Price tile, i.e. the map's Price per m² layer. Saved, the
 * area view and Compare show this one series and say so on hover.
 */
export const PRICE_TILE_SOURCE = "Price per m² layer: 12-month median sold price ÷ EPC floor area, as on the area page";

export function standoutsPath(id: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/standouts`;
}

/** The payload when it has the 12 tiles in their order; real mode never takes the demo's. */
export function readStandouts(payload: unknown, mode: DataMode): AreaStandouts | null {
  const value = payload as Partial<AreaStandouts> | null;
  if (!value || value.schemaVersion !== "area-standouts.v1" || !Array.isArray(value.tiles) || !Array.isArray(value.tags)) return null;
  if (value.tiles.length !== STANDOUT_TILE_IDS.length || value.tiles.some((tile, index) => tile?.id !== STANDOUT_TILE_IDS[index])) return null;
  if (mode === "real" && value.productReleaseId?.startsWith("preview-")) return null;
  return value as AreaStandouts;
}

/** Where a tile's dot sits on its London strip (0-100, right = better or higher); null without a rank. */
export function stripPosition(tile: TileView): number | null {
  const position = tile.standing ?? tile.regionPercentile;
  return position === null ? null : Math.max(0, Math.min(100, position));
}

/** The strip's words for screen readers and the tooltip, against `scope` (the area's region). */
export function stripWords(tile: TileView, scope = "London"): string {
  if (tile.standing !== null) return `Better than ${regionShare(tile.standing)}% of ${scope}`;
  if (tile.regionPercentile !== null) return `Higher than ${regionShare(tile.regionPercentile)}% of ${scope}`;
  return `No ${scope} rank`;
}
