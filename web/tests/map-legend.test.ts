import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TYPICAL_PRICE_TYPES } from "../src/lib/typical-price";
import { legendCaption, legendCaptionParts, legendTitle, mapPeriodLabel, mapValueText, scaleDirectionNote, UNKNOWN_FILL_COLOR } from "../src/lib/map-legend";

test("unknown areas share one distinguishable colour", () => {
  assert.equal(UNKNOWN_FILL_COLOR, "#d1d5d3");
});

test("scale direction is explicit for every metric direction", () => {
  assert.equal(scaleDirectionNote("higher-is-better"), "Higher is better");
  assert.equal(scaleDirectionNote("higher-is-more"), "Higher means more");
  assert.equal(scaleDirectionNote("neutral"), "Neither end is better or worse");
});

test("the legend says what and when, in words", () => {
  assert.equal(legendCaption({ id: "price-per-square-metre", label: "Price per square metre" }, "2026-06"), "Price per m² · Jun 2026");
  assert.equal(legendCaption({ id: "crime", label: "Recorded crime" }, "2026-08"), "Crimes per 1,000 people a year · Aug 2026");
  assert.equal(legendCaption({ id: "food-hygiene", label: "Food hygiene nearby" }, "2026-10"), "% of food places rated 4–5 · Oct 2026");
  assert.equal(legendCaption({ id: "personal-match", label: "Personal match" }, "2026-09"), "My match");
  assert.equal(mapPeriodLabel("2026-06"), "Jun 2026");
  assert.equal(mapPeriodLabel("not a month"), "not a month");
});

test("an area's value reads in the shared formats, never with a doubled unit", () => {
  assert.equal(mapValueText(7646.45, { id: "price-per-square-metre", unit: "£/m²" }), "£7,650/m²");
  assert.equal(mapValueText(61.24, { id: "crime", unit: "per 1,000" }), "61.2 crimes per 1,000");
  assert.equal(mapValueText(null, { id: "crime", unit: "per 1,000" }), null);
});

test("My match's legend is 7 RdBu bands, least like your search to best match (v4 Task 21e)", async () => {
  const { PERSONAL_MATCH_DEFINITION, PERSONAL_MATCH_LEGEND } = await import("../src/lib/fixtures");
  const { matchMapValue } = await import("../src/lib/match-map");
  assert.equal(legendCaption(PERSONAL_MATCH_DEFINITION, null), "My match");
  assert.doesNotMatch(legendCaption(PERSONAL_MATCH_DEFINITION, "2026-09"), /top 50|matches|avoid|worst/i);
  // The style contract's ramp: band 0 deep red … band 6 deep blue, the middle near white, every stop painted.
  assert.deepEqual(PERSONAL_MATCH_LEGEND.map((stop) => [stop.value, stop.colour]), [
    [0, "#b2182b"], [1, "#ef8a62"], [2, "#fddbc7"], [3, "#f2f2f2"], [4, "#d1e5f0"], [5, "#67a9cf"], [6, "#2166ac"],
  ]);
  const contract = JSON.parse(readFileSync(new URL("../../contracts/style-contract.json", import.meta.url), "utf8"));
  assert.deepEqual(contract.personalMatchLegend, PERSONAL_MATCH_LEGEND.map(({ value, colour }) => ({ value, colour })));
  assert.deepEqual([PERSONAL_MATCH_LEGEND[0].label, PERSONAL_MATCH_LEGEND[6].label], ["Least like your search", "Best match"]);
  // A scored area paints its band; one that is out (or unscored) has none, so the map paints it grey.
  assert.equal(matchMapValue(97), 6);
  assert.equal(matchMapValue(3), 0);
  assert.equal(matchMapValue(null), null);
});

test("the whole-home price layer is the Typical home price, with a view per type of home", () => {
  assert.deepEqual(TYPICAL_PRICE_TYPES.map((type) => type.label), ["All homes", "Flats", "Terraced", "Semi", "Detached"]);
  assert.equal(legendTitle({ id: "typical-price", label: "x" }), "Typical home price, all homes");
  assert.equal(legendTitle({ id: "typical-price-semi", label: "x" }), "Typical home price, semi-detached");
  for (const type of TYPICAL_PRICE_TYPES) assert.doesNotMatch(legendTitle({ id: type.id, label: "x" }), /today/i);
});

// v4 Task 2, round 2: the desktop legend read only "% of homes at 55 dB or more · Dec 2022" for Noise.
test("the legend's title names the layer first when its own words do not", () => {
  const noise = legendCaption({ id: "noise", label: "Road and rail noise" }, "2022-12");
  assert.deepEqual(legendCaptionParts(noise, legendTitle({ id: "noise", label: "x" }), "Noise"),
    { name: "Noise", rest: " · % of homes at 55 dB or more · Dec 2022" });
  const price = legendCaption({ id: "price-per-square-metre", label: "x" }, "2026-06");
  assert.deepEqual(legendCaptionParts(price, "Price per m²", "Price per m²"), { name: "Price per m²", rest: " · Jun 2026" });
  const crime = legendCaption({ id: "crime", label: "x" }, "2026-06");
  assert.deepEqual(legendCaptionParts(crime, legendTitle({ id: "crime", label: "x" }), "Crime"),
    { name: "Crimes per 1,000 people a year", rest: " · Jun 2026" }, "already named");
  assert.deepEqual(legendCaptionParts("My match", "My match", null), { name: "My match", rest: "" });
});
