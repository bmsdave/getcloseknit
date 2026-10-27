/**
 * Demo standouts for the three preview neighbourhoods: made-up but plausible tiles, with tags picked
 * the API's way (London's best and worst 10%, one per topic, ≤ 3 pros then ≤ 2 cons in topic order).
 */
import type { GeographyId } from "./contracts";
import { getAreaSummary, parentGeographyId } from "./fixtures";
import { regionShare } from "./evidence-format";
import { formatPricePerSquareMetre } from "./overview-scorecard";
import { STANDOUT_TILE_IDS, type AreaStandouts, type StandoutSection, type StandoutTag, type StandoutTile, type StandoutTileId } from "./standouts";

const META: Record<StandoutTileId, { label: string; section: StandoutSection; topic: string }> = {
  price: { label: "Price", section: "price", topic: "price" },
  safety: { label: "Safety", section: "safety", topic: "safety" },
  schools: { label: "Schools", section: "schools", topic: "schools" },
  "station-walk": { label: "Station walk", section: "getting-around", topic: "transport" },
  cycling: { label: "Cycling", section: "getting-around", topic: "transport" },
  noise: { label: "Noise", section: "environment", topic: "quiet" },
  nature: { label: "Nature", section: "environment", topic: "green" },
  air: { label: "Air", section: "health", topic: "health" },
  gp: { label: "GP", section: "health", topic: "health" },
  "food-hygiene": { label: "Food hygiene", section: "local-places", topic: "local" },
  nightlife: { label: "Nightlife", section: "local-places", topic: "local" },
  families: { label: "Families", section: "local-places", topic: "local" },
};
// Deprivation is last, as in the API; the demo areas make no deprivation tag.
const TOPICS = ["price", "safety", "schools", "transport", "green", "quiet", "health", "local", "deprivation"];
const topicOf = (tag: StandoutTag) => (tag.id === "deprivation" ? "deprivation" : META[tag.id].topic);
const NEUTRAL: readonly StandoutTileId[] = ["price", "nightlife"];

/** [display, standing (or London percentile for neutral tiles), detail, tag text when extreme]. */
type Demo = Partial<Record<StandoutTileId, [string, number, string | null, string | null]>>;

const AREAS: Record<string, { verdict: string; tiles: Demo }> = {
  "uk:lsoa:E01000001": {
    verdict: "Close to a station and a GP close by; more crime than most of London and noisy.",
    tiles: {
      price: ["£12,400/m²", 96, null, null], safety: ["More crime than 97%", 3, "per 1,000 residents a year", "More crime than 97% of London"],
      schools: ["6 within 1.5 km", 74, "2 Outstanding", null], "station-walk": ["3 min", 99, "Green Park, zone 1", "3 min walk to Green Park"],
      cycling: ["7.8 km lanes", 96, "within 1 km", null], noise: ["71% over 55 dB", 4, "Road median 67.1 dB", "Noisier than 96% of London"],
      nature: ["Reserve 6 min", 58, "St James's Park", null], gp: ["240 m", 93, "3 within 1 km", "GP surgery 240 m"],
      "food-hygiene": ["90% rated 4–5", 78, null, null], nightlife: ["41 places", 99, "in this area", null], families: ["9 min walk", 38, "nearest playground or nursery", null],
    },
  },
  "uk:lsoa:E01000002": {
    verdict: "Green and a playground or nursery close by.",
    tiles: {
      price: ["£8,100/m²", 71, null, null], safety: ["Safer than 62%", 62, "per 1,000 residents a year", null],
      schools: ["14 within 1.5 km", 88, "4 Outstanding", null], "station-walk": ["7 min", 70, "Highbury & Islington, zone 2", null],
      cycling: ["3.1 km lanes", 74, "within 1 km", null], noise: ["38% over 55 dB", 55, "Road median 55.2 dB", null],
      nature: ["Reserve 4 min", 93, "Gillespie Park", "Nature reserve 4 min"], air: ["NO₂ 28 µg/m³", 42, null, null],
      gp: ["410 m", 64, "2 within 1 km", null], "food-hygiene": ["86% rated 4–5", 60, null, null],
      nightlife: ["12 places", 81, "in this area", null], families: ["2 min walk", 94, "nearest playground or nursery", "Playground or nursery 2 min walk"],
    },
  },
  "uk:lsoa:E01000003": {
    verdict: "Close to a station; noisy.",
    tiles: {
      price: ["£10,200/m²", 89, null, null], safety: ["More crime than 81%", 19, "per 1,000 residents a year", null],
      schools: ["9 within 1.5 km", 61, "1 Outstanding", null], "station-walk": ["4 min", 97, "Waterloo, zone 1", "4 min walk to Waterloo"],
      cycling: ["6.2 km lanes", 92, "within 1 km", null], noise: ["66% over 55 dB", 7, "Road median 64.0 dB", "Noisier than 93% of London"],
      nature: ["21% green", 24, null, null], gp: ["520 m", 55, "1 within 1 km", null],
      "food-hygiene": ["84% rated 4–5", 52, null, null], nightlife: ["33 places", 97, "in this area", null], families: ["7 min walk", 46, "nearest playground or nursery", null],
    },
  },
};

/** The month the demo price tile reads (the fixtures' newest period). */
const PRICE_PERIOD = "2026-06";

export function fixtureStandouts(id: GeographyId): AreaStandouts | null {
  if (id.startsWith("uk:lad:")) return fixtureBoroughStandouts(id);
  if (id.startsWith("uk:msoa:")) return fixtureMsoaStandouts(id);
  const area = AREAS[id];
  if (!area) return null;
  // Price and safety say what the page's own demo price and crime evidence say.
  const price = getAreaSummary(id, "price-per-square-metre", PRICE_PERIOD)?.value ?? null;
  const crime = getAreaSummary(id, "crime", "2026-06")?.regionPercentile ?? null;
  const own: Demo = {
    ...(price !== null && area.tiles.price ? { price: [formatPricePerSquareMetre(price), area.tiles.price[1], null, null] } : {}),
    ...(crime !== null ? { safety: [crime > 50 ? `More crime than ${regionShare(crime)}%` : `Safer than ${regionShare(100 - crime)}%`, 100 - crime, "per 1,000 residents a year",
      crime >= 90 ? `More crime than ${regionShare(crime)}% of London` : crime <= 10 ? `Safer than ${regionShare(100 - crime)}% of London` : null] } : {}),
  };
  const tiles: StandoutTile[] = STANDOUT_TILE_IDS.map((tileId) => {
    const found = own[tileId] ?? area.tiles[tileId];
    const neutral = NEUTRAL.includes(tileId);
    const standing = found ? found[1] : null;
    // The price tile carries its figure and month, as the API's does (Saved's "since" move reads them).
    const priced = tileId === "price" && own.price !== undefined;
    return {
      id: tileId, ...META[tileId], available: !!found, value: priced ? price : null, display: found?.[0] ?? null,
      standing: neutral ? null : standing, regionPercentile: neutral ? standing : null,
      extreme: neutral || standing === null ? null : standing >= 90 ? "pro" : standing <= 10 ? "con" : null,
      detail: found?.[2] ?? null, trend: tileId === "price" && found ? { percent: 3.5, years: 1 } : null, period: priced ? PRICE_PERIOD : null,
    };
  });
  return {
    schemaVersion: "area-standouts.v1", productReleaseId: "preview-standouts-2026-10", geographyId: id,
    verdict: area.verdict, tags: demoTags(tiles, { ...area.tiles, ...own }), tiles,
    caveats: ["Demo figures: made up for the preview areas."],
  };
}

function demoTags(tiles: StandoutTile[], demo: Demo): StandoutTag[] {
  const picked = new Map<string, StandoutTag>();
  for (const tile of tiles) {
    const text = demo[tile.id]?.[3];
    if (!tile.extreme || !text || picked.has(`${tile.extreme}:${tile.topic}`)) continue;
    picked.set(`${tile.extreme}:${tile.topic}`, { id: tile.id, kind: tile.extreme, text, section: tile.section });
  }
  const ordered = [...picked.values()].sort((a, b) => TOPICS.indexOf(topicOf(a)) - TOPICS.indexOf(topicOf(b)));
  return [...ordered.filter((tag) => tag.kind === "pro").slice(0, 3), ...ordered.filter((tag) => tag.kind === "con").slice(0, 2)];
}

/**
 * A demo wider neighbourhood (MSOA): each preview MSOA holds one preview neighbourhood, so its tiles,
 * tags (still "of London") and verdict are that neighbourhood's, its price the middle of its neighbourhoods.
 */
function fixtureMsoaStandouts(id: GeographyId): AreaStandouts | null {
  return groupStandouts(id, "msoa", (lsoa) => parentGeographyId(lsoa) === id);
}

/**
 * A demo borough: each preview borough holds one preview neighbourhood, so its tiles are
 * that neighbourhood's, its tags say "of boroughs", and its one Areas row carries that neighbourhood's strips.
 */
function fixtureBoroughStandouts(id: GeographyId): AreaStandouts | null {
  return groupStandouts(id, "lad", (lsoa) => {
    const msoa = parentGeographyId(lsoa);
    return msoa !== null && parentGeographyId(msoa) === id;
  });
}

function groupStandouts(id: GeographyId, carrier: "lad" | "msoa", inside: (lsoa: GeographyId) => boolean): AreaStandouts | null {
  const children = (Object.keys(AREAS) as GeographyId[]).filter(inside);
  const own = children.map((lsoa) => fixtureStandouts(lsoa)).filter((value): value is AreaStandouts => value !== null);
  if (own.length === 0) return null;
  const first = own[0];
  const borough = carrier === "lad";
  const tile = (standouts: AreaStandouts, tileId: StandoutTileId) => standouts.tiles.find((entry) => entry.id === tileId) ?? null;
  return {
    ...first, geographyId: id, carrier, verdict: borough ? first.verdict.replace(/ most of London\b/g, " most boroughs") : first.verdict,
    tiles: first.tiles.map((entry) => (entry.id === "price" && entry.available ? { ...entry, detail: "middle of its neighbourhoods" } : entry)),
    tags: borough ? first.tags.map((tag) => ({ ...tag, text: tag.text.replace(/ of London$/, " of boroughs") })) : first.tags,
    neighbourhoods: own.map((standouts) => ({
      geographyId: standouts.geographyId,
      price: getAreaSummary(standouts.geographyId, "price-per-square-metre", "2026-06")?.value ?? null,
      priceLondonPercentile: tile(standouts, "price")?.regionPercentile ?? null,
      crime: getAreaSummary(standouts.geographyId, "crime", "2026-06")?.value ?? null,
      safetyStanding: tile(standouts, "safety")?.standing ?? null,
      schoolStanding: tile(standouts, "schools")?.standing ?? null,
    })),
    caveats: ["Demo figures: made up for the preview areas.", `A ${borough ? "borough" : "wider neighbourhood"}'s figure is the middle of its neighbourhoods' figures.`],
  };
}
