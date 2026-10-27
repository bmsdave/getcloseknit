/**
 * My match on the map, best to least like this search. Per user only: the ramp, the bands and the
 * bottom list never appear on area pages, rankings or SEO pages (tests/match-map.test.ts guards the imports).
 *
 * Every scored area is coloured by its percentile among the scored areas (100 best … 0 least like the search),
 * in 7 bands: top 5 % deep blue … bottom 5 % deep red, the middle near white, so the map spreads with 2 criteria
 * or 15. ColorBrewer RdBu (safe for red–green colour blindness), the same in Day and Night. An area that fails a
 * Must is out: no colour of its own (grey) under a light hatch, never red (red = scored low, hatch = filtered).
 */
import type { GeographyId, MatchPack, MatchResult } from "./contracts";

/** RdBu, 7 classes, least like the search → best match (board V4-21e legend). */
export const MATCH_BANDS: readonly string[] = ["#b2182b", "#ef8a62", "#fddbc7", "#f2f2f2", "#d1e5f0", "#67a9cf", "#2166ac"];
/** The lowest percentile of bands 1…6 (band 0 is under 5): 5 % · 15 · 20 · 20 · 15 · 5 %. */
const BAND_FLOORS: readonly number[] = [5, 20, 40, 60, 80, 95];
/** The popup's score badge turns red for the bottom 10 % (percentile under this). */
export const BOTTOM_DECILE = 10;
/** How many pins the Bottom 10 list puts on the map. */
export const BOTTOM_PINS = 10;

/** Which ten the map pins: the best (1 … 10, ink) or the least like the search (−1 … −10, deep red). */
export type MatchList = "top" | "bottom";

/** The band (0 = least like the search … 6 = best match) of a percentile among the scored areas. */
export function matchBand(percentile: number): number {
  let band = 0;
  for (const floor of BAND_FLOORS) if (percentile >= floor) band += 1;
  return band;
}

/** Ranked and coloured: not out, and scored (isScored in match-model.ts). */
function scored(result: Pick<MatchResult, "excluded" | "score">): boolean {
  return !result.excluded && result.score !== null;
}

/**
 * Each scored area's percentile (100 best … 0 least like the search). A ranked pack (the API's, or one relaxed in
 * the panel) carries its own; a pack recoloured while a slider is dragged has no ranks yet, so they are taken
 * from the scores (the precise one first), ties by id.
 */
export function matchPercentiles(pack: MatchPack): Map<GeographyId, number> {
  const rows = pack.values.filter(scored);
  if (rows.every((result) => result.rank !== null && typeof result.percentile === "number")) {
    return new Map(rows.map((result) => [result.geographyId, result.percentile as number]));
  }
  const order = [...rows].sort((a, b) => (b.rankScore ?? b.score ?? 0) - (a.rankScore ?? a.score ?? 0)
    || (a.geographyId < b.geographyId ? -1 : a.geographyId > b.geographyId ? 1 : 0));
  const count = order.length;
  return new Map(order.map((result, index) => [result.geographyId,
    count === 1 ? 100 : Math.round((100 * (count - (index + 1))) / (count - 1))]));
}

/** The value the map paints for an area: its band, or null (grey) when it is out or has no score. */
export function matchMapValue(percentile: number | null | undefined): number | null {
  return percentile === null || percentile === undefined ? null : matchBand(percentile);
}

/** True for an area in the bottom 10 % of this search (the popup's red badge). */
export function inBottomDecile(percentile: number | null | undefined): boolean {
  return typeof percentile === "number" && percentile < BOTTOM_DECILE;
}

/** The ten scored areas least like the search, the least first: the pack's own list, else from the ranks. */
export function bottomAreas(pack: MatchPack | null): GeographyId[] {
  if (!pack) return [];
  if (pack.bottom) return pack.bottom.slice(0, BOTTOM_PINS).map((entry) => entry.geographyId);
  const percentiles = matchPercentiles(pack);
  return [...percentiles.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, BOTTOM_PINS).map(([id]) => id);
}

/** The areas that fail a Must (or a must-zone, or are ruled out): hatched on the map. */
export function outAreas(pack: MatchPack | null): GeographyId[] {
  return (pack?.values ?? []).filter((result) => result.excluded).map((result) => result.geographyId);
}

/**
 * Lines drawn over the match colours (zone outlines, the outlined page of ten, the draft corners): the theme's
 * ink, so they read on the snow basemap by day and on the navy one by night (tokens --ink).
 */
export function matchInk(theme: "day" | "night"): string {
  return theme === "night" ? "#f4f7fa" : "#22252c";
}

/** The dashed ring of the selected area's neighbours: a quieter line than the ink. */
export function matchRingInk(theme: "day" | "night"): string {
  return theme === "night" ? "#b8c3d6" : "#3d3a33";
}

/**
 * The hatch over an area that fails a Must (board V4-21e): thin grey stripes over a light veil, lighter than the
 * v3 over-budget hatch, which read as dirt over a third of London. RGBA, 0–255. At night the veil is
 * the navy basemap's and the stripes are muted, so filtered areas recede instead of glowing over the colours.
 */
export const MATCH_HATCH = { stripe: [91, 98, 112, 140], veil: [255, 255, 255, 89] } as const;
export const MATCH_HATCH_NIGHT = { stripe: [120, 134, 160, 170], veil: [22, 32, 58, 200] } as const;
/** The hatch's tile: 8 px, a 3 px stripe every 8 px on the diagonal. */
export const MATCH_HATCH_TILE = 8;
const STRIPE = 3;

function hatchFor(theme: "day" | "night") {
  return theme === "night" ? MATCH_HATCH_NIGHT : MATCH_HATCH;
}

/** The hatch tile's pixels (RGBA), drawn into the map's sprite (again when Day and Night switch). */
export function matchHatchPixels(theme: "day" | "night" = "day"): Uint8Array {
  const { stripe, veil } = hatchFor(theme);
  const size = MATCH_HATCH_TILE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Stripes run bottom-left to top-right (45°), as the legend's key draws them.
      data.set((x + y) % size < STRIPE ? stripe : veil, (y * size + x) * 4);
    }
  }
  return data;
}

/** The legend's key for the hatch: the same stripes as CSS, over the grey of an area with no colour. */
export function matchHatchSwatch(under: string, theme: "day" | "night" = "day"): string {
  const { stripe, veil } = hatchFor(theme);
  const css = ([red, green, blue, alpha]: readonly number[]) => `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(2)})`;
  return `repeating-linear-gradient(45deg, ${css(stripe)} 0 3px, ${css(veil)} 3px 8px), ${under}`;
}

/** ?list=bottom in the address; anything else is the top. */
export function parseMatchList(raw: string | null): MatchList {
  return raw === "bottom" ? "bottom" : "top";
}
