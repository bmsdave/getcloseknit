import assert from "node:assert/strict";
import test from "node:test";

import { NEARBY_SALES, getNearbySales } from "../src/lib/fixtures";
import { NEARBY_MEDIAN_MIN, nearbyCountText, nearbyMedianText, nearbySaleLabel } from "../src/lib/nearby-sales";

const PREVIEW = getNearbySales("uk:addr:a1b2c3d4e5f6");

test("preview nearby sales mirror the API whitelist: no per-sale floor area or £/m²", () => {
  assert.ok(PREVIEW);
  for (const entry of NEARBY_SALES) {
    for (const group of [entry.building, entry.street]) {
      for (const sale of group?.sales ?? []) {
        assert.deepEqual(Object.keys(sale).sort(), ["date", "newBuild", "nominalPrice", "propertyType", "tenure"]);
      }
      if (group && group.medianSampleSize < NEARBY_MEDIAN_MIN) assert.equal(group.medianPricePerSquareMetre, null);
    }
  }
});

test("the median shows from five sales and converts to square feet", () => {
  assert.match(nearbyMedianText(PREVIEW!.street!, "sqm"), /£10,500\/m² across 6 standard sales/);
  assert.match(nearbyMedianText(PREVIEW!.street!, "sqft"), /£975\/sqft/);
  assert.match(nearbyMedianText(PREVIEW!.building!, "sqm"), /not shown: it needs at least 5 .*\(2 here\)/);
});

test("a median under the minimum is withheld even if one arrives", () => {
  const group = { saleCount: 4, sales: [], medianPricePerSquareMetre: 9_000, medianSampleSize: 4 };
  assert.match(nearbyMedianText(group, "sqm"), /not shown/);
});

test("labels and counts read plainly", () => {
  assert.equal(nearbySaleLabel({ date: "2024-01-01", nominalPrice: 1, propertyType: "flat", tenure: "leasehold", newBuild: true }),
    "Flat · leasehold · new build");
  assert.equal(nearbySaleLabel({ date: "2024-01-01", nominalPrice: 1, propertyType: "terraced", tenure: "unknown", newBuild: false }),
    "Terraced house · tenure not recorded");
  assert.equal(nearbyCountText(PREVIEW!.building!, 10), "2 sales in the last 10 years.");
  assert.equal(nearbyCountText({ ...PREVIEW!.building!, saleCount: 63 }, 10), "Newest 2 of 63 sales in the last 10 years.");
});
