import assert from "node:assert/strict";
import test from "node:test";

import type { ValuePackEntry } from "../src/lib/contracts";
import type { AreaBox } from "../src/lib/area-boxes";
import { hairlineLayer, LAD_EDGE_LAYER, ladEdgeLayer } from "../src/lib/area-edges";
import { LAD_ZOOM, type MapCoverage } from "../src/lib/map-coverage";
import { areaRegion, NO_DATA_COLOUR, noDataEntries, viewCoverage, withNoDataColour } from "../src/lib/no-data";

// Board #10 "the map at any zoom" (DESIGN.md §6, England map).

const entry = (id: string, value: number | null): ValuePackEntry => ({
  geographyId: id, name: "", metricId: "crime", period: "2026-06", value, regionPercentile: null, countryPercentile: null,
  sampleCount: null, quality: value === null ? "suppressed" : "observed", sourceVersion: "", carrier: "lsoa",
} as ValuePackEntry);
const box = (id: string, region: string | null, bbox: [number, number, number, number] = [0, 0, 1, 1]): AreaBox =>
  ({ id: id as AreaBox["id"], bbox, region });

test("inside the layer's coverage an area without a value is grey; outside it (no value in its region) it stays clear", () => {
  const areas = [box("uk:lsoa:E01000001", "E12000007"), box("uk:lsoa:E01000002", "E12000007"),
    box("uk:lsoa:E01000003", "E12000002"), box("uk:msoa:E02000001", "E12000007")];
  const missing = noDataEntries([entry("uk:lsoa:E01000001", 5)], areas, "lsoa", (area) => area.region ?? null);
  assert.deepEqual(missing.map((value) => [value.geographyId, value.value, value.quality]), [["uk:lsoa:E01000002", null, "suppressed"]]);
  assert.deepEqual(noDataEntries([], areas, "lsoa", () => null), [], "nothing painted: nothing to grey");
});

test("a LAD of England's one piece is in its chunk's region; London's boroughs in London", () => {
  const coverage = { chunks: [{ id: "E08000003", region: "E12000002", bbox: [0, 0, 1, 1] }] } as unknown as MapCoverage;
  assert.equal(areaRegion(box("uk:lad:E08000003", null), coverage), "E12000002");
  assert.equal(areaRegion(box("uk:lad:E09000001", null), coverage), "E12000007");
  assert.equal(areaRegion(box("uk:lsoa:E01000001", "E12000009"), coverage), "E12000009");
});

test("what a view holds: a grey area for the legend's key, and any value at all for the coverage message", () => {
  const boxes = new Map([["uk:lsoa:E01000001", [0, 0, 1, 1] as [number, number, number, number]],
    ["uk:lsoa:E01000002", [5, 5, 6, 6] as [number, number, number, number]]]);
  const values = [entry("uk:lsoa:E01000001", 3), entry("uk:lsoa:E01000002", null)];
  assert.deepEqual(viewCoverage(values, boxes, [0, 0, 2, 2]), { noData: false, values: true });
  assert.deepEqual(viewCoverage(values, boxes, [4, 4, 7, 7]), { noData: true, values: false });
  assert.deepEqual(viewCoverage(values, boxes, [20, 20, 21, 21]), { noData: false, values: false });
});

test("the no-data grey follows Day and Night inside the fill's colour", () => {
  const expression = ["case", ["==", 1, 1], NO_DATA_COLOUR.day, ["interpolate", ["linear"], 1, 0, "#000", 1, "#fff"]] as never;
  assert.equal((withNoDataColour(expression, NO_DATA_COLOUR.night) as unknown as unknown[])[2], NO_DATA_COLOUR.night);
  assert.notEqual(NO_DATA_COLOUR.day, NO_DATA_COLOUR.night);
});

test("borders: hairlines of the level in the ground's colour, the LADs' ink thin while they are the level", () => {
  const lsoa = hairlineLayer("lsoa", "area-tiles-lsoa", "day");
  assert.equal(lsoa.paint?.["line-color"], "#ffffff");
  assert.deepEqual(lsoa.paint?.["line-width"], ["step", ["zoom"], 0.5, 12, 0.75]);
  assert.equal(hairlineLayer("msoa", "area-tiles-msoa", "night").paint?.["line-color"], "#16203a");
  const lad = ladEdgeLayer("area-tiles-borough", "day");
  assert.equal(lad.id, LAD_EDGE_LAYER);
  assert.equal(lad["source-layer"], "borough");
  assert.deepEqual(lad.paint?.["line-width"], ["step", ["zoom"], 0.5, LAD_ZOOM, 1, 12, 1.5]);
  assert.equal(lad.paint?.["line-opacity"], 0.35);
});
