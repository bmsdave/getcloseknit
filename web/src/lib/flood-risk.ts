// Track I: flood risk bands for an area and one home (area-flood.v1).
//
// Two Environment Agency sources (NaFRA2), never merged into one score:
// rivers and sea, and surface water. Each uses four bands, the chance of
// flooding in any one year. Area figures are shares of the area's land, not
// of its buildings. Missing data is "unknown", never "very low".
import type { GeographyId } from "./contracts";
import { isFixtureSourceVersion } from "./fixtures";
import type { DataMode } from "./map-state";

export const FLOOD_BANDS = ["very-low", "low", "medium", "high"] as const;
export type FloodBand = (typeof FLOOD_BANDS)[number];
export type FloodSourceKey = "riversSea" | "surfaceWater";

export interface FloodAreaBands {
  /** Share of the area's land in each band; the four add up to 1. */
  shares: Record<FloodBand, number>;
  /** Highest band covering at least 1% of the land. */
  highestBand: FloodBand;
}

export interface AreaFloodResponse {
  schemaVersion: "area-flood.v1";
  productReleaseId: string;
  geographyId: GeographyId;
  available: boolean;
  riversSea: FloodAreaBands | null;
  surfaceWater: FloodAreaBands | null;
  dwelling: { uprn: string; riversSea: FloodBand | null; surfaceWater: FloodBand | null } | null;
  sourceVersion: string | null;
  attribution: string | null;
  caveats: string[];
}

/** One home's own bands (dwelling_flood), as a profile and a postcode's home list carry them. */
export interface HomeFloodBands {
  riversSea: FloodBand | null;
  surfaceWater: FloodBand | null;
}

/** The worst bands among a postcode's homes that have their own. */
export interface HomesFlood {
  /** Homes with bands, out of all the homes listed. */
  counted: number;
  total: number;
  riversSea: FloodBand;
  surfaceWater: FloodBand | null;
}

/** What a home page knows besides its area's land: the home's own bands and its postcode's homes'. */
export interface HomeFloodContext {
  own: HomeFloodBands | null;
  postcode: string | null;
  homes: HomesFlood | null;
}

/** Whose band a figure is: the home's own, the worst of its postcode's homes, or its area's land. */
export type FloodScope = "home" | "postcode" | "area";

export interface FloodFigure {
  key: FloodSourceKey;
  band: FloodBand;
  scope: FloodScope;
}

export const FLOOD_SOURCES: { key: FloodSourceKey; label: string }[] = [
  { key: "riversSea", label: "Rivers and sea" },
  { key: "surfaceWater", label: "Surface water" },
];

export const FLOOD_BAND_LABEL: Record<FloodBand, string> = {
  "very-low": "Very low",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** The Environment Agency's meaning of each band: chance of flooding in any one year. */
export const FLOOD_BAND_CHANCE: Record<FloodBand, string> = {
  "very-low": "less than 1 in 1,000",
  low: "1 in 1,000 to 1 in 100",
  medium: "1 in 100 to 1 in 30",
  high: "more than 1 in 30",
};

export const UNKNOWN = "unknown";

export function floodPath(geographyId: GeographyId, uprn: string | null): string {
  const query = uprn ? `?uprn=${encodeURIComponent(uprn)}` : "";
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/flood${query}`;
}

/** Accept only an area-flood.v1 payload with data; real mode never accepts fixture numbers. */
export function readAreaFlood(payload: unknown, mode: DataMode): AreaFloodResponse | null {
  const flood = payload as Partial<AreaFloodResponse> | null;
  if (!flood || flood.schemaVersion !== "area-flood.v1" || !flood.available) return null;
  if (mode === "real" && flood.sourceVersion && isFixtureSourceVersion(flood.sourceVersion)) return null;
  return flood as AreaFloodResponse;
}

/** Whole percent; a small non-zero share reads "under 1%" rather than 0%. */
export function formatShare(share: number | null | undefined): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return UNKNOWN;
  if (share > 0 && share < 0.005) return "under 1%";
  return `${Math.round(share * 100)}%`;
}

export function bandLabel(band: FloodBand | null | undefined): string {
  return band ? FLOOD_BAND_LABEL[band] : UNKNOWN;
}

/** "Medium: 1 in 100 to 1 in 30 chance each year" for one home or one band. */
export function bandMeaning(band: FloodBand | null | undefined): string {
  return band ? `${FLOOD_BAND_LABEL[band]}: ${FLOOD_BAND_CHANCE[band]} chance each year` : UNKNOWN;
}

/** Share of the land at medium or high risk. */
export function mediumOrHighShare(bands: FloodAreaBands | null): number | null {
  return bands ? bands.shares.medium + bands.shares.high : null;
}

export interface FloodBadge {
  /** The worse of the two sources' highest bands, or null when rivers and sea is unknown. */
  band: FloodBand | null;
  /** Short headline: "Very low", "Very low, some surface-water risk" … or "unknown". */
  label: string;
  /** One plain sentence under the badge. */
  detail: string;
}

const RANK: Record<FloodBand, number> = { "very-low": 0, low: 1, medium: 2, high: 3 };

/**
 * The flood headline from the worse of the two sources. Rivers and sea lead
 * (the risk most people mean by flooding); when surface water is medium or
 * high and worse, it is named: "Very low, some surface-water risk" (the
 * band covers part of the land, so never "high" for the whole area). Surface
 * water alone reads "Surface water: medium". Unknown stays unknown.
 */
export function floodHeadline(flood: Pick<AreaFloodResponse, "riversSea" | "surfaceWater"> | null): string {
  const rivers = flood?.riversSea?.highestBand ?? null;
  const surface = flood?.surfaceWater?.highestBand ?? null;
  if (!rivers) return surface ? `Surface water: ${bandLabel(surface).toLowerCase()}` : UNKNOWN;
  const label = bandLabel(rivers);
  if (!surface || RANK[surface] <= RANK[rivers] || RANK[surface] < RANK.medium) return label;
  return `${label}, some surface-water risk`;
}

/** The worse of the two sources' highest bands; null when both are unknown. */
export function worseFloodBand(flood: Pick<AreaFloodResponse, "riversSea" | "surfaceWater"> | null): FloodBand | null {
  const bands = [flood?.riversSea?.highestBand, flood?.surfaceWater?.highestBand]
    .filter((band): band is FloodBand => Boolean(band));
  return bands.length === 0 ? null : bands.reduce((worst, band) => (RANK[band] > RANK[worst] ? band : worst));
}

const worst = (bands: readonly (FloodBand | null | undefined)[]) => bands.reduce<FloodBand | null>(
  (top, band) => (band && (!top || RANK[band] > RANK[top]) ? band : top), null);

/**
 * The postcode's own homes, not the area's land: an area can hold a river's
 * floodplain (a park) while every home sits at very low. The worst band among
 * the homes with bands; null when none has them.
 */
export function homesFlood(homes: readonly { flood?: HomeFloodBands | null }[]): HomesFlood | null {
  const banded = homes.flatMap((home) => (home.flood?.riversSea ? [home.flood] : []));
  if (banded.length === 0) return null;
  return {
    counted: banded.length, total: homes.length,
    riversSea: worst(banded.map((home) => home.riversSea))!,
    surfaceWater: worst(banded.map((home) => home.surfaceWater)),
  };
}

/**
 * A home page's flood figures, each source on its own: the home's own band, else the worst
 * of its postcode's homes, else its area's highest band (said as the area's, never the home's).
 */
export function homeFloodFigures(context: HomeFloodContext | null,
  area: Pick<AreaFloodResponse, "riversSea" | "surfaceWater"> | null): FloodFigure[] {
  return FLOOD_SOURCES.flatMap(({ key }): FloodFigure[] => {
    const own = context?.own?.[key] ?? null;
    if (own) return [{ key, band: own, scope: "home" }];
    const homes = context?.homes?.[key] ?? null;
    if (homes) return [{ key, band: homes, scope: "postcode" }];
    const land = area?.[key]?.highestBand ?? null;
    return land ? [{ key, band: land, scope: "area" }] : [];
  });
}

const SCOPE_TERM: Record<FloodScope, (postcode: string | null) => string> = {
  home: () => "Flood, this home",
  postcode: (postcode) => `Flood, highest of the homes in ${postcode ?? "its postcode"}`,
  area: () => "Flood, this area's highest band",
};

/**
 * A home page's one flood row: whose band it is in the term, each source in the value
 * ("rivers and sea: very low · surface water: very low"). Were the sources to come from
 * different places, each says whose it is. Null with no figure at all.
 */
export function homeFloodRow(context: HomeFloodContext | null,
  area: Pick<AreaFloodResponse, "riversSea" | "surfaceWater"> | null): { term: string; value: string; scope: FloodScope } | null {
  const figures = homeFloodFigures(context, area);
  if (figures.length === 0) return null;
  const postcode = context?.postcode ?? null;
  const scope = figures[0].scope;
  const mixed = figures.some((figure) => figure.scope !== scope);
  const label = (key: FloodSourceKey) => FLOOD_SOURCES.find((source) => source.key === key)!.label.toLowerCase();
  return {
    term: mixed ? "Flood" : SCOPE_TERM[scope](postcode),
    value: figures.map(({ key, band, scope: own }) => `${label(key)}: ${bandLabel(band).toLowerCase()}`
      + (mixed ? ` (${SCOPE_TERM[own](postcode).replace(/^Flood, /, "")})` : "")).join(" · "),
    scope,
  };
}

/**
 * A home page's Overview flood chip, the same choice as its flood row: the worse of the home's own bands,
 * else of its postcode's homes'; with neither, the area's chip band as the API gave it (the worse of its
 * land's highest bands). `title` says whose band it is, in the row's words.
 */
export function homeFloodChip(context: HomeFloodContext | null, areaBand: string | null): { band: string | null; scope: FloodScope; title: string } {
  const figures = homeFloodFigures(context, null);
  const postcode = context?.postcode ?? null;
  if (figures.length === 0) return { band: areaBand, scope: "area", title: SCOPE_TERM.area(postcode) };
  const scopes = [...new Set(figures.map((figure) => figure.scope))];
  return {
    band: bandLabel(worst(figures.map((figure) => figure.band))),
    scope: scopes[0],
    title: `Flood, ${scopes.map((scope) => SCOPE_TERM[scope](postcode).replace(/^Flood, /, "")).join(" and ")}`,
  };
}

/**
 * Overview badge: the headline from the worse of rivers and sea and surface
 * water (floodHeadline), with the land share at medium or high and the
 * surface water band beside it. Unknown stays unknown.
 */
export function floodOverviewValue(flood: AreaFloodResponse | null): FloodBadge {
  const rivers = flood?.riversSea ?? null;
  const surface = flood?.surfaceWater ?? null;
  if (!rivers) {
    return {
      band: null,
      label: UNKNOWN,
      detail: surface ? `Rivers and sea unknown; surface water ${bandLabel(surface.highestBand).toLowerCase()}.` : "No flood data for this area.",
    };
  }
  const rivered = `Rivers and sea: ${formatShare(mediumOrHighShare(rivers))} of the land at medium or high risk`;
  const surfaced = surface ? `surface water ${bandLabel(surface.highestBand).toLowerCase()}` : "surface water unknown";
  return { band: worseFloodBand(flood), label: floodHeadline(flood), detail: `${rivered}; ${surfaced}.` };
}
