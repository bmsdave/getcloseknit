import assert from "node:assert/strict";
import test from "node:test";

import type { ValuePackEntry } from "../src/lib/contracts";
import {
  changeAvailable,
  changeBasePeriod,
  changeValues,
  parseChangeWindow,
  percentChange,
  scaleFromQuery,
  withScaleQuery,
} from "../src/lib/map-trend";
import { TREND_ARROW_MIN_ZOOM, trendArrow, trendArrowLayers } from "../src/lib/map-trend-arrows";
import { CHANGE_RANGE_PERCENT, DIVERGING_RAMP, divergingStops } from "../src/lib/palettes";
import { UNKNOWN_FILL_COLOR } from "../src/lib/map-legend";

function entry(geographyId: string, value: number | null): ValuePackEntry {
  return {
    geographyId: geographyId as ValuePackEntry["geographyId"],
    name: geographyId,
    metricId: "price-per-square-metre",
    period: "2026-06",
    value,
    regionPercentile: 50,
    countryPercentile: null,
    sampleCount: 30,
    quality: "observed",
    sourceVersion: "test",
    carrier: "lsoa",
  };
}

test("percent change compares the two ends and never guesses", () => {
  assert.equal(percentChange(8_000, 10_000), 25);
  assert.equal(percentChange(10_000, 8_000), -20);
  assert.equal(percentChange(8_238, 9_600), 16.5);
  assert.equal(percentChange(null, 9_600), null);
  assert.equal(percentChange(8_000, null), null);
  assert.equal(percentChange(0, 9_600), null);
  assert.equal(percentChange(undefined, 9_600), null);
});

test("change values match areas by id and leave missing areas unknown", () => {
  const current = [entry("uk:lsoa:A", 12_000), entry("uk:lsoa:B", 6_000), entry("uk:msoa:C", 7_000), entry("uk:lsoa:D", null)];
  const base = [entry("uk:lsoa:A", 10_000), entry("uk:lsoa:B", 8_000), entry("uk:lsoa:C", 7_000), entry("uk:lsoa:D", 5_000)];
  const values = changeValues(current, base);
  assert.deepEqual(values.map((value) => value.value), [20, -25, null, null]);
  // Percentiles describe levels, not change: they must not leak into the change scale.
  assert.ok(values.every((value) => value.regionPercentile === null));
  assert.deepEqual(changeValues(current, null).map((value) => value.value), [null, null, null, null]);
});

test("the change base period must exist in the metric's history", () => {
  const periods = ["2006-06", "2016-06", "2021-06", "2025-06", "2026-06"];
  assert.equal(changeBasePeriod("2026-06", 5, periods), "2021-06");
  assert.equal(changeBasePeriod("2026-06", 1, periods), "2025-06");
  assert.equal(changeBasePeriod("2026-06", 20, periods), "2006-06");
  assert.equal(changeBasePeriod("2026-06", 3, periods), null);
  assert.equal(changeBasePeriod("2026-Q2", 1, periods), null);
});

test("only price per square metre offers the change scale", () => {
  assert.equal(changeAvailable("price-per-square-metre"), true);
  assert.equal(changeAvailable("stock-value-per-square-metre"), false);
  assert.equal(changeAvailable("crime"), false);
});

test("scale mode and window round-trip through the address", () => {
  const base = "lat=51.5&layer=price-per-square-metre";
  const shared = withScaleQuery(base, "change", 10);
  assert.match(shared, /scale=change/);
  assert.match(shared, /window=10/);
  assert.deepEqual(scaleFromQuery(`?${shared}`), { scale: "change", window: 10 });
  assert.equal(withScaleQuery(base, "linear", 10), base);
  // Price per m² opens on rank: rank stays out of its address, actual values are named.
  assert.equal(withScaleQuery(base, "percentile", 10, "percentile"), base);
  assert.equal(withScaleQuery(base, "linear", 10, "percentile"), `${base}&scale=linear`);
  assert.equal(withScaleQuery(`${base}&scale=change&window=5`, "percentile", 5), `${base}&scale=percentile`);
  assert.deepEqual(scaleFromQuery("?scale=bogus&window=7"), { scale: null, window: null });
  assert.equal(parseChangeWindow("20"), 20);
  assert.equal(parseChangeWindow(null), null);
});

test("the diverging ramp spans a fixed ±50% with a neutral middle at 0", () => {
  const stops = divergingStops();
  assert.equal(stops.length, DIVERGING_RAMP.length);
  assert.equal(stops[0].value, -CHANGE_RANGE_PERCENT);
  assert.equal(stops.at(-1)?.value, CHANGE_RANGE_PERCENT);
  const middle = stops[Math.floor(stops.length / 2)];
  assert.equal(middle.value, 0);
  assert.equal(middle.label, "0%");
  assert.equal(stops[0].label, "−50%");
  assert.equal(stops.at(-1)?.label, "+50%");
  for (let index = 1; index < stops.length; index += 1) assert.ok(stops[index].value > stops[index - 1].value);
});

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

test("the diverging ramp reads without hue: both ends are dark, the middle is light", () => {
  // Purple–orange stays apart for red–green colour blindness; lightness
  // carries "how much" even in greyscale.
  const stops = divergingStops();
  const middle = luminance(stops[3].colour);
  assert.ok(middle > 0.85);
  for (let step = 0; step < 3; step += 1) {
    assert.ok(luminance(stops[step].colour) < luminance(stops[step + 1].colour), `falling side lightens towards 0 at ${step}`);
    assert.ok(luminance(stops[6 - step].colour) < luminance(stops[5 - step].colour), `rising side lightens towards 0 at ${step}`);
  }
  assert.notEqual(stops[3].colour, UNKNOWN_FILL_COLOR);
});

test("trend arrows: up, down or flat, from street zoom only", () => {
  assert.equal(trendArrow(12), "up");
  assert.equal(trendArrow(-3), "down");
  assert.equal(trendArrow(0.2), null);
  assert.equal(trendArrow(null), null);
  const layers = trendArrowLayers("area-tiles-lsoa", "lsoa");
  assert.equal(layers.length, 2);
  for (const layer of layers) {
    assert.equal(layer.minzoom, TREND_ARROW_MIN_ZOOM);
    assert.equal(layer.source, "area-tiles-lsoa");
    assert.equal(layer["source-layer"], "lsoa");
    assert.equal(layer.layout?.visibility, "none");
  }
  // Thread icons drawn as map images, never a font glyph.
  assert.deepEqual(layers.map((layer) => layer.layout?.["icon-image"]), ["trend-rise", "trend-fall"]);
  assert.equal(layers.some((layer) => layer.layout && "text-field" in layer.layout), false);
  assert.equal(TREND_ARROW_MIN_ZOOM, 13);
});
