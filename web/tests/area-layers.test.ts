import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AreaTiles, tileTrend } from "../src/components/area-standouts";
import {
  layerHref, overviewChips, overviewLayersPath, overviewSummary, overviewTiles, readAreaLayers,
  type AreaLayer, type AreaLayersResponse,
} from "../src/lib/area-layers";
import { DEMO_OVERVIEW_LAYERS, fixtureAreaLayers } from "../src/lib/area-layers-fixture";
import { areaSeedPaths } from "../src/lib/section-seed";

const AREA = "uk:lsoa:E01001209" as const;
const layer = (id: string, extra: Partial<AreaLayer> = {}): AreaLayer => ({
  id, label: id, section: null, topic: null, available: true, value: 80.2, display: "80.2 per 1,000", standing: 10,
  regionPercentile: null, extreme: "con", detail: null, trend: { direction: "up", percent: 14.6, years: 1 }, period: "2026-08", ...extra,
});
const RESPONSE: AreaLayersResponse = {
  schemaVersion: "area-layers.v1", areaId: AREA, scope: "overview",
  layers: [
    layer("price-per-square-metre", { label: "Price", display: "£6,500/m²", standing: null, regionPercentile: 45, extreme: null }),
    layer("crime", { label: "Crime" }),
    layer("noise", { label: "Noise", available: false, value: null, display: null, standing: null, extreme: null, trend: null }),
    layer("road-collisions", { label: "Road collisions", available: false, value: null, display: null, standing: null, extreme: null, trend: null }),
  ],
  presets: [layer("custom:nightlife", { label: "Bars, pubs and clubs", display: "41 places", standing: 99, extreme: "pro", trend: null })],
  chips: [{ id: "flood", label: "Flood", band: "Low" }, { id: "air", label: "Air", band: null }, { id: "broadband", label: "Broadband", band: "100% gigabit" }],
  withheld: ["censusRanked", "laeiAir"],
};

test("layerHref opens the map on the area with that layer", () => {
  assert.equal(layerHref("E01001209", "noise"), "/?selected=E01001209&layer=noise");
});

test("the Overview reads the overview scope, seeded on home pages only", () => {
  assert.equal(overviewLayersPath(AREA), "/api/v1/areas/uk%3Alsoa%3AE01001209/layers?scope=overview");
  const query = { geographyId: AREA, areaId: AREA, mode: "real" as const, release: "r", period: "2026-06", uprn: null };
  assert.ok(!areaSeedPaths(query).includes(overviewLayersPath(AREA)));
  assert.ok(areaSeedPaths({ ...query, layers: true }).includes(overviewLayersPath(AREA)));
  assert.ok(areaSeedPaths({ ...query, mode: "demo", layers: true }).includes(overviewLayersPath(AREA)));
});

test("readAreaLayers takes only an area-layers.v1 document, and never the demo's in real mode", () => {
  assert.deepEqual(readAreaLayers(RESPONSE), RESPONSE);
  assert.equal(readAreaLayers({ schemaVersion: "area-standouts.v1" }), null);
  assert.equal(readAreaLayers(null), null);
  const demo = fixtureAreaLayers("uk:lsoa:E01000001");
  assert.equal(readAreaLayers(demo, "real"), null);
  assert.ok(readAreaLayers(demo, "demo"));
});

test("the Overview keeps the API's order, then the presets, with section and theme from the map topics", () => {
  const tiles = overviewTiles(RESPONSE);
  assert.deepEqual(tiles.map((tile) => tile.id), ["price-per-square-metre", "crime", "noise", "road-collisions", "custom:nightlife"]);
  const crime = tiles.find((tile) => tile.id === "crime")!;
  assert.equal(crime.section, "safety");
  assert.equal(crime.topic, "safety");
  assert.equal(tiles.find((tile) => tile.id === "noise")!.section, "homes");
  const nightlife = tiles.find((tile) => tile.id === "custom:nightlife")!;
  assert.equal(nightlife.section, "local-places");
  assert.equal(nightlife.topic, "going-out");
  assert.equal(nightlife.label, "Nightlife"); // the map's short name, never a brand
});

test("an Overview tile for an unavailable layer reads No data and links to its map layer", () => {
  const html = renderToStaticMarkup(createElement(AreaTiles, {
    standouts: { tiles: overviewTiles(RESPONSE) }, prefix: "layers-", href: (tile) => layerHref(AREA, tile.id),
  }));
  const noise = /<a[^>]*data-testid="area-tile-noise"[^>]*>.*?<\/a>/.exec(html)?.[0] ?? "";
  assert.match(noise, /No data/);
  assert.match(noise, /data-empty=""/);
  assert.match(noise, /href="\/\?selected=uk%3Alsoa%3AE01001209&amp;layer=noise"/);
  assert.match(/<a[^>]*data-testid="area-tile-road-collisions"[^>]*>.*?<\/a>/.exec(html)?.[0] ?? "", /No data/);
  assert.match(html, /href="\/\?selected=uk%3Alsoa%3AE01001209&amp;layer=custom%3Anightlife"/);
});

test("the air chip waits on its flag, decided from withheld and never from a null band", () => {
  assert.deepEqual(overviewChips(RESPONSE).map((chip) => chip.id), ["flood", "broadband"]);
  const on = overviewChips({ ...RESPONSE, withheld: ["censusRanked"] });
  assert.deepEqual(on.map((chip) => chip.id), ["flood", "air", "broadband"]);
});

test("a trend from zero keeps its arrow without a percent; flat and missing draw none", () => {
  assert.deepEqual(tileTrend({ trend: { direction: "up", percent: null, years: 1 } }), { up: true, title: "Up in 1 year", spoken: "up in a year" });
  assert.equal(tileTrend({ trend: { direction: "flat", percent: null, years: 1 } }), null);
  assert.equal(tileTrend({ trend: { percent: 0.3, years: 1 } }), null);
  assert.equal(tileTrend({ trend: { percent: -6, years: 1 } })?.up, false);
  assert.equal(tileTrend({ trend: null }), null);
});

const SUMMARY_LAYERS: AreaLayer[] = [
  layer("price-per-square-metre", { display: "£12,400/m²", standing: null, regionPercentile: 96 }),
  layer("crime", { display: "130.1 per 1,000", standing: 3 }),
  layer("station-access", { display: "3 min", standing: 99 }),
  layer("nature-score", { display: "58/100", standing: 58 }),
  layer("deprivation", { display: "Decile 7", standing: 66 }),
];

test("the summary is one fixed-template paragraph from the layers", () => {
  assert.equal(overviewSummary({ ...RESPONSE, layers: SUMMARY_LAYERS }),
    "Prices are higher than most of London (£12,400/m²). Crime is higher than most of London (130.1 per 1,000). "
    + "The walk to a station is 3 min, rated 10/10 for London. Green & trees rate 6/10. It is less deprived than most of London.");
  const text = overviewSummary(fixtureAreaLayers("uk:lsoa:E01000002")!)!;
  assert.doesNotMatch(text, /best|worst/i);
});

test("the summary leaves out a clause without data, and is null with none", () => {
  const some = SUMMARY_LAYERS.map((entry) => entry.id === "crime" ? { ...entry, available: false, standing: null, display: null }
    : entry.id === "station-access" ? { ...entry, standing: null } : entry);
  assert.equal(overviewSummary({ ...RESPONSE, layers: some.filter((entry) => entry.id !== "deprivation") }),
    "Prices are higher than most of London (£12,400/m²). Green & trees rate 6/10.");
  assert.equal(overviewSummary({ ...RESPONSE, layers: [layer("crime", { standing: 50 }), layer("deprivation", { standing: 50 })] }),
    "Crime is about average for London (80.2 per 1,000). It is about average for London on deprivation.");
  assert.equal(overviewSummary({ ...RESPONSE, layers: [] }), null);
});

test("the demo's Overview layers are the API's, in its order", () => {
  const source = readFileSync(join(import.meta.dirname, "../../api/area_api/layers.py"), "utf8");
  const block = /OVERVIEW_LAYERS = \(([\s\S]*?)\n\)/.exec(source)?.[1] ?? "";
  const api = [...block.matchAll(/\("([a-z-]+)", "([^"]+)"\)/g)].map((match) => [match[1], match[2]]);
  assert.ok(api.length >= 10);
  assert.deepEqual(DEMO_OVERVIEW_LAYERS.map(([id, label]) => [id, label]), api);
  const demo = fixtureAreaLayers("uk:lsoa:E01000001")!;
  assert.deepEqual(demo.layers.map((entry) => entry.id), api.map(([id]) => id));
  assert.equal(demo.presets.length, 3);
});
