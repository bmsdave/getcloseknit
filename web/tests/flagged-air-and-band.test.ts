import assert from "node:assert/strict";
import test from "node:test";

import { registerHooks } from "node:module";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { healthRatings, type AreaHealthResponse } from "../src/lib/area-health";
import { fixtureAreaCivic } from "../src/lib/civic-fixture";
import { fixtureStandouts } from "../src/lib/standouts-fixture";
import { visibleTiles } from "../src/lib/standouts";

// The page components import stylesheets, which node cannot load: stub them before importing the components.
registerHooks({
  load(url, context, nextLoad) {
    return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context);
  },
});
const { AreaTiles } = await import("../src/components/area-standouts");
const { healthRows, LivingCosts } = await import("../src/components/area-full-page");
const { CouncilTaxTable } = await import("../src/components/civic-section");

const HEALTH: AreaHealthResponse = {
  schemaVersion: "area-health.v1", productReleaseId: "r1", geographyId: "uk:lsoa:E01002718", available: true,
  air: null, heat: { value: 32.1, unit: "°C", year: 2018, regionPercentile: 85 },
  gp: { patientsPerGp: 2141, practices: 3, nearestMetres: 310, month: "2026-09-01", regionPercentile: 64, withinMetres: 1000 },
  notes: [], sources: [], caveats: [],
};

test("the air row and rating are left out, not 'no data', while laeiAir is withheld", () => {
  const terms = (health: AreaHealthResponse) => healthRows(health).map((row) => row.term);
  assert.deepEqual(terms({ ...HEALTH, withheld: ["laeiAir"] }), ["Summer nights", "GP"]);
  assert.ok(terms({ ...HEALTH, withheld: [] }).includes("Air NO₂ / PM2.5"));
  assert.ok(terms(HEALTH).includes("Air NO₂ / PM2.5"), "an old payload withholds nothing");
  assert.equal(healthRatings({ ...HEALTH, withheld: ["laeiAir"] }).some((rating) => rating.label === "Clean air"), false);
  assert.equal(healthRatings(HEALTH).some((rating) => rating.label === "Clean air"), true);
});

test("the Air tile is left out of the tiles while laeiAir is withheld", () => {
  const standouts = fixtureStandouts("uk:lsoa:E01000001") ?? fixtureStandouts("uk:lsoa:E01000002") ?? fixtureStandouts("uk:lsoa:E01000003");
  assert.ok(standouts);
  assert.equal(visibleTiles(standouts.tiles, ["laeiAir"]).length, standouts.tiles.length - 1);
  assert.equal(visibleTiles(standouts.tiles, []).length, standouts.tiles.length);
  const html = (withheld: string[]) => renderToStaticMarkup(createElement(AreaTiles, { standouts: { tiles: standouts.tiles, withheld } }));
  assert.doesNotMatch(html(["laeiAir"]), /area-tile-air/);
  assert.match(html([]), /area-tile-air/);
});

const civicWithBand = (band: string | null, withheld: string[]) => {
  const civic = fixtureAreaCivic("uk:lsoa:E01000001") ?? fixtureAreaCivic("uk:lsoa:E01000002") ?? fixtureAreaCivic("uk:lsoa:E01000003");
  assert.ok(civic);
  return { ...civic, councilTaxBand: band, withheld: withheld as never[] };
};

test("the council tax band shows in the civic table only when not withheld and present", () => {
  const html = (band: string | null, withheld: string[]) =>
    renderToStaticMarkup(createElement(CouncilTaxTable, { civic: civicWithBand(band, withheld) }));
  assert.match(html("D", []), /This home: Band D\./);
  assert.doesNotMatch(html("D", ["councilTaxBand"]), /This home/);
  assert.doesNotMatch(html(null, []), /This home/);
});

test("Living costs: the band row is 'This home' on a home page and 'Council tax band' elsewhere", () => {
  const html = (band: string | null, withheld: string[], homePage: boolean) => renderToStaticMarkup(
    createElement(LivingCosts, { civic: civicWithBand(band, withheld), areaId: "uk:lsoa:E01000001", rows: [], homePage }));
  assert.match(html("D", [], true), /This home[\s\S]*Band D/);
  assert.match(html("D", [], false), /Council tax band[\s\S]*Band D/);
  assert.doesNotMatch(html("D", [], false), /This home/);
  assert.doesNotMatch(html("D", ["councilTaxBand"], true), /living-tax-band/);
  assert.doesNotMatch(html(null, [], true), /living-tax-band/);
});
