/**
 * Demo layers scorecard (?scope=overview) for the three preview neighbourhoods: made-up but plausible,
 * in the API's Overview order (api/area_api/layers.py OVERVIEW_LAYERS; tests/area-layers.test.ts keeps
 * the two lists equal).
 */
import type { AreaLayer, AreaLayersResponse } from "./area-layers";
import type { GeographyId } from "./contracts";

/** The Overview's layers under their short names, as the API sends them. */
export const DEMO_OVERVIEW_LAYERS: readonly (readonly [id: string, label: string])[] = [
  ["price-per-square-metre", "Price"], ["station-access", "Station walk"], ["crime", "Crime"],
  ["road-collisions", "Road collisions"], ["food-hygiene", "Food hygiene"], ["nature-score", "Green & trees"],
  ["noise", "Noise"], ["deprivation", "Deprivation"], ["income", "Income"], ["social-renting", "Social renting"],
];
// Neutral layers carry a London position, never a standing (as the API's).
const NEUTRAL = new Set(["price-per-square-metre", "income", "social-renting"]);

/** [display, standing (or London percentile when neutral), trend percent | null]; left out: no data. */
type Demo = Record<string, [string, number, number | null]>;
/** [criterion id, name as given, display, standing]. */
type Preset = [string, string, string, number];

const AREAS: Record<string, { layers: Demo; presets: Preset[]; chips: [string | null, string | null] }> = {
  "uk:lsoa:E01000001": {
    layers: {
      "price-per-square-metre": ["£12,400/m²", 96, 3.5], "station-access": ["3 min", 99, null], crime: ["130.1 per 1,000", 3, 6.2],
      "food-hygiene": ["90%", 78, null], "nature-score": ["58/100", 58, null], noise: ["71%", 4, null],
      deprivation: ["Decile 7", 66, null], income: ["£71,200 a year", 88, null], "social-renting": ["24.1%", 61, null],
    },
    presets: [["nightlife", "Bars, pubs and clubs", "2.6 per 1,000 residents", 99], ["culture", "Cinemas, theatres, museums and galleries", "1.1 per 1,000 residents", 98],
      ["good-coffee", "Specialty coffee shops", "0.6 per 1,000 residents", 95]],
    chips: ["Low", "100% gigabit"],
  },
  "uk:lsoa:E01000002": {
    layers: {
      "price-per-square-metre": ["£8,100/m²", 71, 1.2], "station-access": ["7 min", 70, null], crime: ["61.4 per 1,000", 62, -4.1],
      "food-hygiene": ["86%", 60, null], "nature-score": ["93/100", 93, null], noise: ["38%", 55, null],
      deprivation: ["Decile 5", 48, null], income: ["£52,300 a year", 55, null], "social-renting": ["31.7%", 74, null],
    },
    presets: [["family", "Nearest playground or nursery", "2 min walk", 94], ["markets", "Nearest market", "6 min walk", 88],
      ["dog-friendly", "Nearest dog park, vet or pet shop", "5 min walk", 83]],
    chips: ["Very low", "96% gigabit"],
  },
  "uk:lsoa:E01000003": {
    layers: {
      "price-per-square-metre": ["£10,200/m²", 89, -0.8], "station-access": ["4 min", 97, null], crime: ["98.0 per 1,000", 19, 2.0],
      "food-hygiene": ["84%", 52, null], "nature-score": ["24/100", 24, null], noise: ["66%", 7, null],
      deprivation: ["Decile 4", 37, null], income: ["£48,900 a year", 47, null],
    },
    presets: [["nightlife", "Bars, pubs and clubs", "2.1 per 1,000 residents", 97], ["universities", "Universities and colleges", "6 places", 95],
      ["culture", "Cinemas, theatres, museums and galleries", "0.8 per 1,000 residents", 93]],
    chips: ["Medium", "99% gigabit"],
  },
};

function tile(id: string, label: string, found: [string, number, number | null] | undefined): AreaLayer {
  const neutral = NEUTRAL.has(id);
  const position = found?.[1] ?? null;
  const standing = neutral ? null : position;
  const percent = found?.[2] ?? null;
  return {
    id, label, section: null, topic: null, available: !!found, value: null, display: found?.[0] ?? null,
    standing, regionPercentile: neutral ? position : null,
    extreme: standing === null ? null : standing >= 90 ? "pro" : standing <= 10 ? "con" : null,
    detail: null, period: null,
    trend: percent === null ? null : { direction: Math.abs(percent) < 0.5 ? "flat" : percent > 0 ? "up" : "down", percent, years: 1 },
  };
}

export function fixtureAreaLayers(id: GeographyId): AreaLayersResponse | null {
  const area = AREAS[id];
  if (!area) return null;
  return {
    schemaVersion: "area-layers.v1", productReleaseId: "preview-layers-2026-10", areaId: id, scope: "overview",
    layers: DEMO_OVERVIEW_LAYERS.map(([layerId, label]) => tile(layerId, label, area.layers[layerId])),
    presets: area.presets.map(([criterion, name, display, standing]) => ({
      // Counted inside the area (layers.preset_tile); a nearest-place walk needs no detail.
      ...tile(`custom:${criterion}`, name, [display, standing, null]), detail: display.endsWith("min walk") ? null : "in this area",
    })),
    chips: [{ id: "flood", label: "Flood", band: area.chips[0] }, { id: "air", label: "Air", band: null },
      { id: "broadband", label: "Broadband", band: area.chips[1] }],
    withheld: ["censusRanked", "laeiAir"],
  };
}
