import assert from "node:assert/strict";
import test from "node:test";

import type { MapDefinition } from "../src/lib/contracts";
import { cappedLegend, displayMapValue, effectiveScaleMode, linearRampPosition, niceCeiling, percentileStops, quantileBreaks, rescaledStops, scaledMapValue } from "../src/lib/legend-scale";

const LEGEND: MapDefinition["legend"] = [
  { value: 5, colour: "#3a7d44", label: "5" },
  { value: 20, colour: "#f4d35e", label: "20" },
  { value: 80, colour: "#b23a48", label: "80+" },
];

test("linear mode keeps the measured value for colouring", () => {
  assert.equal(scaledMapValue({ value: 42, regionPercentile: 90 }, "linear"), 42);
});

test("percentile mode colours by London percentile instead of the raw value", () => {
  assert.equal(scaledMapValue({ value: 619, regionPercentile: 100 }, "percentile"), 100);
  assert.equal(scaledMapValue({ value: 7, regionPercentile: 50 }, "percentile"), 50);
});

test("percentile mode without a percentile suppresses the colour", () => {
  assert.equal(scaledMapValue({ value: 7, regionPercentile: null }, "percentile"), null);
});

test("null values stay null in both modes", () => {
  assert.equal(scaledMapValue({ value: null, regionPercentile: 10 }, "linear"), null);
  assert.equal(scaledMapValue({ value: null, regionPercentile: null }, "percentile"), null);
});

test("an active crime filter pins the map to the linear scale", () => {
  assert.equal(effectiveScaleMode("crime", "percentile", true), "linear");
  assert.equal(effectiveScaleMode("crime", "percentile", false), "percentile");
  assert.equal(effectiveScaleMode("crime", "linear", true), "linear");
  assert.equal(effectiveScaleMode("income", "percentile", true), "percentile");
});

test("percentile stops reuse legend colours across an even 0-100 spread", () => {  assert.deepEqual(percentileStops(LEGEND), [
    { value: 0, colour: "#3a7d44" },
    { value: 50, colour: "#f4d35e" },
    { value: 100, colour: "#b23a48" },
  ]);
});

test("map values follow the effective mode and the crime selection", () => {
  const entry = { value: 20, regionPercentile: 70, breakdown: { Burglary: 5, Shoplifting: 15 } };
  assert.equal(displayMapValue(entry, "crime", "linear", ["Shoplifting"], true), 15);
  assert.equal(displayMapValue(entry, "crime", "percentile", ["Shoplifting"], false), 70);
  assert.equal(displayMapValue(entry, "income", "linear", [], false), 20);
  assert.equal(displayMapValue(entry, "crime", "linear", ["Burglary", "Shoplifting"], false), 20);
});

test("a view across regions colours percentiles by rank in England, one region's view by its own", () => {
  const surrey = { value: 6200, regionPercentile: 90, countryPercentile: 95 };
  assert.equal(displayMapValue(surrey, "price-per-square-metre", "percentile", [], false), 90);
  assert.equal(displayMapValue(surrey, "price-per-square-metre", "percentile", [], false, true), 95);
  assert.equal(displayMapValue({ value: 1, regionPercentile: 40, countryPercentile: null }, "crime", "percentile", [], false, true), null,
    "an area unranked in England is unknown, never a regional rank on England's scale");
  assert.equal(displayMapValue(surrey, "price-per-square-metre", "linear", [], false, true), 6200, "values are values on any scale");
});

test("the change scale applies to price per square metre only", () => {
  assert.equal(effectiveScaleMode("price-per-square-metre", "change", false), "change");
  assert.equal(effectiveScaleMode("crime", "change", false), "linear");
  assert.equal(effectiveScaleMode("stock-value-per-square-metre", "change", false), "linear");
  assert.equal(effectiveScaleMode("personal-match", "change", false), "linear");
});

test("change mode paints the precomputed percent, not the percentile", () => {
  // The value already holds the percent change (lib/map-trend.ts changeValues).
  assert.equal(displayMapValue({ value: 16.5, regionPercentile: 92 }, "price-per-square-metre", "change", [], false), 16.5);
  assert.equal(displayMapValue({ value: null, regionPercentile: 92 }, "price-per-square-metre", "change", [], false), null);
  assert.equal(scaledMapValue({ value: -4.2, regionPercentile: 10 }, "change"), -4.2);
});

test("nice ceilings step through 1/2/5", () => {
  assert.equal(niceCeiling(87.4), 100);
  assert.equal(niceCeiling(42.1), 50);
  assert.equal(niceCeiling(7.27), 10);
  assert.equal(niceCeiling(200), 200);
  assert.equal(niceCeiling(0), 0);
  assert.equal(niceCeiling(-3), 0);
});

test("rescaling spreads legend colours from 0 to the exact subset maximum", () => {
  const stops = rescaledStops(LEGEND, [42.1, 87.4, 59.3, null]);
  assert.ok(stops !== null && stops.length >= 2);
  assert.deepEqual(stops[0], { value: 0, colour: "#3a7d44", label: "0" });
  assert.deepEqual(stops.at(-1), { value: 87.4, colour: "#b23a48", label: "87.4+" });
  const values = stops.map((stop) => stop.value);
  assert.deepEqual([...values].sort((a, b) => a - b), values);
});

test("quantiles give each band a similar share of areas on skewed data", () => {
  const values = [0, 0, 0, 0, 0, 1, 2, 4, 8, 20];
  const stops = rescaledStops(
    [
      { value: 0, colour: "#00" },
      { value: 1, colour: "#11" },
      { value: 2, colour: "#22" },
      { value: 3, colour: "#33" },
    ],
    values,
  );
  assert.ok(stops !== null);
  assert.equal(stops[0].value, 0);
  assert.equal(stops.at(-1)?.value, 20);
  assert.ok((stops[1]?.value ?? 20) < 5, "middle bands sit with the bulk, not the outlier");
});

test("quantile breaks interpolate between closest ranks", () => {
  assert.deepEqual(quantileBreaks([0, 10, 20, 30], 3), [0, 15, 30]);
  assert.deepEqual(quantileBreaks([], 3), []);
  assert.deepEqual(quantileBreaks([5], 1), [5]);
});

test("rescaling returns null when there is nothing visible", () => {
  assert.equal(rescaledStops(LEGEND, [null, null]), null);
  assert.equal(rescaledStops([], [42.1]), null);
  assert.equal(rescaledStops(LEGEND, [0, 0]), null);
});

test("an outlier top stop is capped at a round number past the class below, its label keeping the unit", () => {
  const crime = [
    { value: 40, colour: "#1", label: "40" }, { value: 56, colour: "#2", label: "56" }, { value: 76, colour: "#3", label: "76" },
    { value: 113, colour: "#4", label: "113" }, { value: 4459, colour: "#5", label: "4459+" },
  ];
  const capped = cappedLegend(crime);
  assert.equal(capped.at(-1)?.value, 200);
  assert.equal(capped.at(-1)?.label, "200+");
  assert.deepEqual(capped.slice(0, 4), crime.slice(0, 4));
  const walk = [{ value: 12, colour: "#1", label: "12 min" }, { value: 17, colour: "#2", label: "17 min" }, { value: 83, colour: "#3", label: "83+ min" }];
  assert.equal(cappedLegend(walk).at(-1)?.label, "50+ min");
  const near = [{ value: 5, colour: "#1", label: "5" }, { value: 20, colour: "#2", label: "20" }, { value: 50, colour: "#3", label: "50+" }];
  assert.deepEqual(cappedLegend(near), near, "a top stop within 3x of the one below stays");
});

test("the London tick sits linearly within its class on an evenly drawn legend", () => {
  assert.equal(linearRampPosition(40, [40, 56, 76, 113, 200]), 0);
  assert.equal(linearRampPosition(66, [40, 56, 76, 113, 200]), 0.375);
  assert.equal(linearRampPosition(500, [40, 56, 76, 113, 200]), 1);
});
