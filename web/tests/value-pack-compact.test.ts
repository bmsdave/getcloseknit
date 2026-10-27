import assert from "node:assert/strict";
import test from "node:test";

import { COMPACT_PACK_SCHEMA, readValuePack } from "../src/lib/value-pack-compact";

test("a compact pack reads back as the full pack the map paints", () => {
  const pack = readValuePack({
    schemaVersion: COMPACT_PACK_SCHEMA, metricId: "crime", period: "2026-06", sourceVersion: "src-1", productReleaseId: "rel-1",
    carrier: "lsoa", direction: "higher-is-worse",
    fields: ["geographyId", "value", "regionPercentile", "countryPercentile", "quality", "areaCount", "breakdown"],
    values: [
      ["uk:lsoa:E01000001", 12.5, 80, 91, "observed", null, { Burglary: 3 }],
      ["uk:lsoa:E01000002", null, null, null, "suppressed", null, null],
    ],
  });
  assert.ok(pack);
  assert.equal(pack.schemaVersion, "area-value-pack.v1");
  assert.equal(pack.productReleaseId, "rel-1");
  assert.deepEqual(pack.values[0], {
    geographyId: "uk:lsoa:E01000001", name: "", metricId: "crime", period: "2026-06", value: 12.5, regionPercentile: 80,
    countryPercentile: 91, sampleCount: null, quality: "observed", sourceVersion: "src-1", carrier: "lsoa",
    direction: "higher-is-worse", breakdown: { Burglary: 3 },
  });
  assert.equal(pack.values[1].value, null);
  assert.equal("breakdown" in pack.values[1], false);
});

test("a roll-up keeps its area count; a full pack is read as it is; anything else is no pack", () => {
  const rolled = readValuePack({
    schemaVersion: COMPACT_PACK_SCHEMA, metricId: "price-per-square-metre", period: "2026-06", sourceVersion: "s", carrier: "msoa",
    values: [["uk:msoa:E02000001", 9000, 70, 96, "fallback", 5, null]],
  });
  assert.equal((rolled?.values[0] as unknown as { areaCount: number }).areaCount, 5);
  assert.equal(rolled?.values[0].carrier, "msoa");
  const full = { schemaVersion: "area-value-pack.v1", metricId: "crime", period: "2026-06", sourceVersion: "s", values: [] };
  assert.equal(readValuePack(full), full);
  assert.equal(readValuePack(null), null);
  assert.equal(readValuePack({ error: "metric-not-found" }), null);
});
