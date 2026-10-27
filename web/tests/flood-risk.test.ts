import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOOD_BANDS,
  FLOOD_BAND_CHANCE,
  type AreaFloodResponse,
  bandMeaning,
  floodHeadline,
  floodOverviewValue,
  floodPath,
  formatShare,
  readAreaFlood,
} from "../src/lib/flood-risk";
import { fixtureAreaFlood } from "../src/lib/flood-risk-fixture";
import { HELP } from "../src/lib/help-texts";

test("every band carries its plain chance each year", () => {
  assert.deepEqual(Object.keys(FLOOD_BAND_CHANCE).sort(), [...FLOOD_BANDS].sort());
  assert.equal(bandMeaning("high"), "High: more than 1 in 30 chance each year");
  assert.equal(bandMeaning(null), "unknown");
});

test("shares read as whole percents; small is never rounded to nothing; missing is unknown", () => {
  assert.equal(formatShare(0.83), "83%");
  assert.equal(formatShare(0), "0%");
  assert.equal(formatShare(0.002), "under 1%");
  assert.equal(formatShare(null), "unknown");
  assert.equal(formatShare(undefined), "unknown");
});

test("demo areas add up, previews share their LSOA numbers, unknown areas have none", () => {
  for (const id of ["uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003"] as const) {
    const flood = fixtureAreaFlood(id, null);
    assert.ok(flood, id);
    for (const source of [flood.riversSea, flood.surfaceWater]) {
      assert.ok(source);
      const total = FLOOD_BANDS.reduce((sum, band) => sum + source.shares[band], 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `${id} adds to ${total}`);
    }
  }
  assert.deepEqual(fixtureAreaFlood("uk:lad:E09000003", null)?.riversSea, fixtureAreaFlood("uk:lsoa:E01000003", null)?.riversSea);
  assert.equal(fixtureAreaFlood("uk:lsoa:E01009999", null), null);
});

test("a home's band only comes back for a home in that area", () => {
  assert.deepEqual(fixtureAreaFlood("uk:lsoa:E01000001", "100000000001")?.dwelling,
    { uprn: "100000000001", riversSea: "low", surfaceWater: "very-low" });
  assert.equal(fixtureAreaFlood("uk:lsoa:E01000003", "100000000001")?.dwelling, null);
  assert.equal(fixtureAreaFlood("uk:lsoa:E01000001", "42")?.dwelling, null);
});

test("real mode rejects fixture numbers, empty and malformed payloads", () => {
  const demo = fixtureAreaFlood("uk:lsoa:E01000001", null);
  assert.ok(readAreaFlood(demo, "demo"));
  assert.equal(readAreaFlood(demo, "real"), null);
  assert.equal(readAreaFlood({ ...demo, sourceVersion: "src-ea-nafra2-flood-2026-07" }, "real")?.geographyId, "uk:lsoa:E01000001");
  assert.equal(readAreaFlood({ ...demo, available: false }, "demo"), null);
  assert.equal(readAreaFlood({ schemaVersion: "area-noise.v1" }, "demo"), null);
  assert.equal(readAreaFlood(null, "demo"), null);
});

test("overview badge is the rivers and sea band, unknown when missing", () => {
  const riverside = floodOverviewValue(fixtureAreaFlood("uk:lsoa:E01000003", null));
  assert.equal(riverside.band, "high");
  assert.equal(riverside.label, "High");
  assert.equal(riverside.detail, "Rivers and sea: 17% of the land at medium or high risk; surface water medium.");

  const hill = floodOverviewValue(fixtureAreaFlood("uk:lsoa:E01000002", null));
  assert.equal(hill.label, "Very low");
  assert.match(hill.detail, /^Rivers and sea: 0% of the land/);

  const none = floodOverviewValue(null);
  assert.deepEqual(none, { band: null, label: "unknown", detail: "No flood data for this area." });

  const partial = { ...fixtureAreaFlood("uk:lsoa:E01000001", null), riversSea: null } as AreaFloodResponse;
  assert.equal(floodOverviewValue(partial).label, "unknown");
  assert.equal(floodOverviewValue(partial).detail, "Rivers and sea unknown; surface water high.");
});

test("flood path encodes the area and optional home", () => {
  assert.equal(floodPath("uk:lsoa:E01000001", null), "/api/v1/areas/uk%3Alsoa%3AE01000001/flood");
  assert.equal(floodPath("uk:lsoa:E01000001", "100000000001"), "/api/v1/areas/uk%3Alsoa%3AE01000001/flood?uprn=100000000001");
});

test("flood help texts point at the flood guide", () => {
  for (const id of ["flood-bands", "flood-home", "flood-badge", "flood-area"] as const) assert.equal(HELP[id].guide, "flood");
});

test("the flood headline takes the worse of rivers and sea and surface water", () => {
  const bands = (highestBand: "very-low" | "low" | "medium" | "high") =>
    ({ shares: { "very-low": 1, low: 0, medium: 0, high: 0 }, highestBand });
  // Osidge: rivers very low, surface water medium on part of the land.
  assert.equal(floodHeadline({ riversSea: bands("very-low"), surfaceWater: bands("medium") }), "Very low, some surface-water risk");
  assert.equal(floodHeadline({ riversSea: bands("low"), surfaceWater: bands("high") }), "Low, some surface-water risk");
  assert.equal(floodHeadline({ riversSea: bands("high"), surfaceWater: bands("medium") }), "High");
  assert.equal(floodHeadline({ riversSea: bands("very-low"), surfaceWater: bands("low") }), "Very low");
  assert.equal(floodHeadline({ riversSea: null, surfaceWater: bands("medium") }), "Surface water: medium");
  assert.equal(floodHeadline(null), "unknown");
});

test("home flood row: the home's own band, then its postcode's homes', then the area's, said as such (W5 1LR)", async () => {
  const { homeFloodRow, homesFlood } = await import("../src/lib/flood-risk");
  // The LSOA's land is high (Pitshanger Park's floodplain); every home in W5 1LR is very low.
  const high = { shares: { "very-low": 0.8, low: 0.02, medium: 0.01, high: 0.17 }, highestBand: "high" } as const;
  const area = { riversSea: high, surfaceWater: high };
  const veryLow = { riversSea: "very-low", surfaceWater: "very-low" } as const;
  const homes = homesFlood([{ flood: veryLow }, { flood: veryLow }, { flood: null }]);
  assert.deepEqual(homes, { counted: 2, total: 3, riversSea: "very-low", surfaceWater: "very-low" });

  const own = homeFloodRow({ own: veryLow, postcode: "W5 1LR", homes }, area);
  assert.deepEqual(own, { term: "Flood, this home", value: "rivers and sea: very low · surface water: very low", scope: "home" });
  // A street home or one known from its certificate: no band of its own, its postcode's homes' worst.
  const postcode = homeFloodRow({ own: null, postcode: "W5 1LR", homes }, area);
  assert.deepEqual(postcode, {
    term: "Flood, highest of the homes in W5 1LR", value: "rivers and sea: very low · surface water: very low", scope: "postcode",
  });
  // Neither: the area's land, never called the home's.
  const land = homeFloodRow({ own: null, postcode: "W5 1LR", homes: null }, area);
  assert.deepEqual(land, { term: "Flood, this area's highest band", value: "rivers and sea: high · surface water: high", scope: "area" });
  // Surface water is its own figure: with no home band for it, it says whose it is.
  const split = homeFloodRow({ own: { riversSea: "low", surfaceWater: null }, postcode: null, homes: null }, area)!;
  assert.equal(split.term, "Flood");
  assert.equal(split.value, "rivers and sea: low (this home) · surface water: high (this area's highest band)");
  assert.equal(homeFloodRow(null, null), null);
});

test("home Overview flood chip: the row's choice, not the area's land (W5 1LR: area high, home very low)", async () => {
  const { homeFloodChip, homesFlood } = await import("../src/lib/flood-risk");
  const veryLow = { riversSea: "very-low", surfaceWater: "very-low" } as const;
  const homes = homesFlood([{ flood: veryLow }, { flood: { riversSea: "very-low", surfaceWater: "low" } }, { flood: null }]);
  // The API's chip for LSOA E01001209 reads "High" (Pitshanger Park's floodplain).
  assert.deepEqual(homeFloodChip({ own: veryLow, postcode: "W5 1LR", homes }, "High"),
    { band: "Very low", scope: "home", title: "Flood, this home" });
  // A street or certificate-only home: the worse of its postcode's homes' bands.
  assert.deepEqual(homeFloodChip({ own: null, postcode: "W5 1LR", homes }, "High"),
    { band: "Low", scope: "postcode", title: "Flood, highest of the homes in W5 1LR" });
  // Neither: the area's band as the API gave it, said as the area's.
  assert.deepEqual(homeFloodChip({ own: null, postcode: "W5 1LR", homes: null }, "High"),
    { band: "High", scope: "area", title: "Flood, this area's highest band" });
  assert.deepEqual(homeFloodChip(null, null), { band: null, scope: "area", title: "Flood, this area's highest band" });
  // Own rivers and sea, surface water only from the postcode's homes: the worse, both named.
  assert.deepEqual(homeFloodChip({ own: { riversSea: "very-low", surfaceWater: null }, postcode: "W5 1LR", homes }, "High"),
    { band: "Low", scope: "home", title: "Flood, this home and highest of the homes in W5 1LR" });
});
