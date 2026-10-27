import assert from "node:assert/strict";
import test from "node:test";

import { readableCustomLegend } from "../src/lib/custom-criteria";
import {
  AUTO_SCALE, bootLegendScales, clampRange, committedLegendScale, handleLabel, histogram, histogramDomain, LEGEND_SCALE_STORAGE_KEY,
  legendScaleDragging, legendScaleFor, legendScaleFromQuery, legendScaleKey, parseRange, rangeBreaks, rangePosition, rankIn,
  readStoredScales, servedScope, servedScopes, setLegendScale, sliderStep, subscribeLegendScale, withLegendScaleQuery, writeStoredScale,
} from "../src/lib/legend-range";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    items,
  };
}

test("a custom range spreads the colours in equal steps; below low is the first, above high the last", () => {
  assert.deepEqual(rangeBreaks([3000, 9000], 5), [3000, 4500, 6000, 7500, 9000]);
  assert.equal(rangePosition(6000, [3000, 9000]), 50);
  assert.equal(rangePosition(1000, [3000, 9000]), 0);
  assert.equal(rangePosition(3000, [3000, 9000]), 0);
  assert.equal(rangePosition(25_000, [3000, 9000]), 100);
  assert.equal(rangePosition(4500, [3000, 9000]), 25);
  // A negative range (the change scale) works the same.
  assert.equal(rangePosition(0, [-20, 20]), 50);
});

test("handles are clamped: in order, inside the slider, one step apart", () => {
  assert.deepEqual(clampRange(9000, 3000, [0, 20_000]), [3000, 9000]);
  assert.deepEqual(clampRange(-500, 30_000, [0, 20_000]), [0, 20_000]);
  assert.deepEqual(clampRange(5000, 5000, [0, 20_000], 200), [5000, 5200]);
  // At the top there is no room above: the low one moves down instead.
  assert.deepEqual(clampRange(20_000, 20_000, [0, 20_000], 200), [19_800, 20_000]);
  assert.equal(clampRange(Number.NaN, 1, [0, 1]), null);
});

test("each handle's name says the layer, its end and the unit", () => {
  assert.equal(handleLabel("Price per m²", "low", "£/m²"), "Price per m², colours from, in £/m²");
  assert.equal(handleLabel("Crime", "high", "per-1000-residents-per-year"), "Crime, colours to, in per 1000 residents per year");
  assert.equal(handleLabel("Deprivation", "low", ""), "Deprivation, colours from");
});

test("the slider step reads cleanly and the domain drops the extreme hundredths", () => {
  assert.equal(sliderStep(16_000), 200);
  assert.equal(sliderStep(1), 0.01);
  assert.equal(sliderStep(40), 0.5);
  const values = Float64Array.from([...Array.from({ length: 198 }, (_, index) => 3000 + index * 50), 90_000, 120_000]).sort();
  const domain = histogramDomain(values, null)!;
  assert.ok(domain[1] < 20_000, "one outlier does not squeeze the rest into a bar");
  assert.ok(domain[0] <= 3000);
  // The range shown is always inside the slider.
  const wide = histogramDomain(values, [1000, 50_000])!;
  assert.ok(wide[0] <= 1000 && wide[1] >= 50_000);
  assert.equal(histogramDomain(new Float64Array(0), null), null);
  assert.deepEqual(histogramDomain(new Float64Array(0), [2, 8]), [2, 8]);
});

test("the histogram counts every value, the ones beyond the slider in its end bars", () => {
  const counts = histogram(Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 50, -5]), [0, 10], 5);
  assert.deepEqual(counts, [3, 2, 2, 2, 3]);
  assert.equal(rankIn(Float64Array.from([1, 2, 3, 4]), 2), 0.5);
  assert.equal(rankIn(Float64Array.from([1, 2, 3, 4]), 0), 0);
});

test("the address carries the range and scope, and reads them back", () => {
  const query = withLegendScaleQuery("layer=crime&zoom=9", { range: [12.34567, 140], scope: "view" });
  assert.equal(new URLSearchParams(query).get("range"), "12.35,140");
  assert.equal(new URLSearchParams(query).get("scope"), null);
  assert.deepEqual(legendScaleFromQuery(query), { range: [12.35, 140], scope: "view" });
  const scoped = withLegendScaleQuery(query, { range: null, scope: "england" });
  assert.equal(new URLSearchParams(scoped).get("range"), null);
  assert.deepEqual(legendScaleFromQuery(scoped), { range: null, scope: "england" });
  assert.equal(withLegendScaleQuery(scoped, AUTO_SCALE), "layer=crime&zoom=9");
  assert.equal(legendScaleFromQuery("layer=crime"), null);
  // Broken values are no range.
  for (const raw of ["", "5", "a,b", "5,5", "1,2,3", ",4", "Infinity,2"]) assert.equal(parseRange(raw), null, raw);
  assert.deepEqual(parseRange("9000,3000"), [3000, 9000]);
});

test("this device keeps each layer's scale; blocked or broken storage is ignored", () => {
  const storage = memoryStorage();
  writeStoredScale("crime", { range: [10, 120.123456], scope: "view" }, storage);
  writeStoredScale("price-per-square-metre", { range: null, scope: "region" }, storage);
  assert.deepEqual(readStoredScales(storage), {
    crime: { range: [10, 120.1], scope: "view" },
    "price-per-square-metre": { range: null, scope: "region" },
  });
  writeStoredScale("crime", AUTO_SCALE, storage);
  assert.deepEqual(Object.keys(readStoredScales(storage)), ["price-per-square-metre"]);
  assert.deepEqual(readStoredScales(memoryStorage({ [LEGEND_SCALE_STORAGE_KEY]: "{not json" })), {});
  assert.deepEqual(readStoredScales(memoryStorage({ [LEGEND_SCALE_STORAGE_KEY]: JSON.stringify({ x: { range: ["a", 2] }, y: 4 }) })), {});
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readStoredScales(throwing), {});
  assert.doesNotThrow(() => writeStoredScale("crime", { range: [1, 2], scope: "view" }, throwing));
});

test("the store: a drag is live only, a release commits and saves, the link wins for its layer", () => {
  const storage = memoryStorage({ [LEGEND_SCALE_STORAGE_KEY]: JSON.stringify({ crime: { range: [5, 50], scope: "view" } }) });
  bootLegendScales("?layer=price-per-square-metre&range=3000,9000", storage);
  assert.deepEqual(legendScaleFor("price-per-square-metre"), { range: [3000, 9000], scope: "view" });
  assert.deepEqual(legendScaleFor("crime"), { range: [5, 50], scope: "view" });
  assert.equal(legendScaleFor("noise"), AUTO_SCALE);
  let calls = 0;
  const unsubscribe = subscribeLegendScale(() => { calls += 1; });
  setLegendScale("crime", { range: [5, 80], scope: "view" }, { commit: false, storage });
  assert.ok(legendScaleDragging());
  assert.deepEqual(legendScaleFor("crime").range, [5, 80]);
  assert.deepEqual(committedLegendScale("crime").range, [5, 50]);
  setLegendScale("crime", legendScaleFor("crime"), { commit: true, storage });
  assert.equal(legendScaleDragging(), false);
  assert.deepEqual(committedLegendScale("crime").range, [5, 80]);
  assert.deepEqual(readStoredScales(storage).crime.range, [5, 80]);
  setLegendScale("crime", AUTO_SCALE, { storage });
  assert.equal(committedLegendScale("crime"), AUTO_SCALE);
  assert.equal(readStoredScales(storage).crime, undefined);
  assert.equal(calls, 3);
  unsubscribe();
  // The change scale has its own key: a price range is not a percent.
  assert.equal(legendScaleKey("price-per-square-metre", "change"), "price-per-square-metre:change");
  bootLegendScales("?layer=price-per-square-metre&scale=change&range=-10,30", storage);
  assert.deepEqual(legendScaleFor("price-per-square-metre:change").range, [-10, 30]);
  bootLegendScales("", null);
});

test("a criterion's legend reads in its unit: no nudged 0.001, the top keeps its + and unit", () => {
  const stops = [
    { value: 0, colour: "#a", label: "0" }, { value: 0.001, colour: "#b", label: "0.001" }, { value: 0.2, colour: "#c", label: "" },
    { value: 0.5, colour: "#d", label: "" }, { value: 0.85, colour: "#e", label: "0.85+" },
  ];
  assert.deepEqual(readableCustomLegend(stops, "density").map((stop) => stop.label), ["0", "", "", "", "0.85+ per km²"]);
  const residents = readableCustomLegend([
    { value: 0, colour: "#a", label: "0" }, { value: 1.234, colour: "#b", label: "1.234" }, { value: 9.51, colour: "#e", label: "9.51+ per 1,000" },
  ], "per_resident");
  assert.deepEqual(residents.map((stop) => stop.label), ["0", "1.2", "9.5+ per 1,000"]);
  const counts = readableCustomLegend([{ value: 0, colour: "#a", label: "0" }, { value: 3, colour: "#b", label: "3" }, { value: 18, colour: "#c", label: "18+" }], "count");
  assert.deepEqual(counts.map((stop) => stop.label), ["0", "3", "18+"]);
  const words = [{ value: -1, colour: "#a", label: "more cafés" }, { value: 1, colour: "#b", label: "more pubs" }];
  assert.deepEqual(readableCustomLegend(words, "balance"), words);
});

test("a London map (CLOSE_KNIT_ENGLAND off) offers no England ranks and reads a saved one as the region's", () => {
  assert.deepEqual(servedScopes("london"), ["view", "region"]);
  assert.deepEqual(servedScopes("england"), ["view", "region", "england"]);
  assert.equal(servedScope("england", "london"), "region");
  assert.equal(servedScope("england", "england"), "england");
  assert.equal(servedScope("view", "london"), "view");
});
