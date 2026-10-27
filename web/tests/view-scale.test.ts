import assert from "node:assert/strict";
import test from "node:test";

import { scaleMarks, scalePoint } from "../src/lib/layer-explainer";
import type { Bbox } from "../src/lib/map-coverage";
import {
  currentViewScale, needsRescale, setViewScale, subscribeViewScale, terseValue, viewBreaks, viewPosition, VIEW_SCALE_MIN_AREAS,
} from "../src/lib/view-scale";

const range = (count: number, from = 1) => Array.from({ length: count }, (_, index) => from + index);

test("breaks split the values in view into equal shares, lowest to highest", () => {
  const breaks = viewBreaks(range(101, 0), 5);
  assert.deepEqual(breaks, [0, 25, 50, 75, 100]);
  // Order does not matter, and skewed values still spread over every stop.
  const skewed = [...range(90, 1000), ...range(10, 9000)].reverse();
  const split = viewBreaks(skewed, 5)!;
  assert.equal(split[0], 1000);
  assert.equal(split[4], 9009);
  assert.ok(split[3] < 2000, "three quarters of the areas sit below the outliers");
});

test("too few areas or one value: no breaks (the published ranks colour the map)", () => {
  assert.equal(viewBreaks(range(VIEW_SCALE_MIN_AREAS - 1), 5), null);
  assert.notEqual(viewBreaks(range(VIEW_SCALE_MIN_AREAS), 5), null);
  assert.equal(viewBreaks(Array(50).fill(7), 5), null);
  assert.equal(viewBreaks(range(50), 1), null);
});

test("a value's place is linear between breaks and clamps beyond the ends", () => {
  const breaks = [0, 10, 20, 40, 80];
  assert.equal(viewPosition(0, breaks), 0);
  assert.equal(viewPosition(10, breaks), 25);
  assert.equal(viewPosition(30, breaks), 62.5);
  assert.equal(viewPosition(80, breaks), 100);
  assert.equal(viewPosition(-5, breaks), 0);
  assert.equal(viewPosition(500, breaks), 100);
});

test("tied breaks: a tied value sits in the middle of its run, others stay monotonic", () => {
  const breaks = [0, 0, 0, 2, 5];
  assert.equal(viewPosition(0, breaks), 25);
  assert.equal(viewPosition(1, breaks), 62.5);
  assert.equal(viewPosition(2, breaks), 75);
  assert.ok(viewPosition(3, breaks) > viewPosition(2, breaks));
  // Every place stays in 0..100 and never decreases with the value.
  let previous = -1;
  for (let value = -1; value <= 6; value += 0.25) {
    const place = viewPosition(value, breaks);
    assert.ok(place >= previous && place >= 0 && place <= 100, `value ${value}`);
    previous = place;
  }
});

test("the breaks from 35,000 values are cheap", () => {
  const values = Array.from({ length: 35_000 }, (_, index) => ((index * 7919) % 35_000) * 3.7);
  const started = performance.now();
  const breaks = viewBreaks(values, 9)!;
  for (const value of values) viewPosition(value, breaks);
  assert.ok(performance.now() - started < 100, "well under a frame budget on any laptop");
});

const LONDON: Bbox = [-0.6, 51.25, 0.35, 51.75];
const anchor = { zoom: 9.6, bounds: LONDON, level: "price:lsoa" };
const shifted = (dx: number, dy: number): Bbox => [LONDON[0] + dx, LONDON[1] + dy, LONDON[2] + dx, LONDON[3] + dy];

test("hysteresis: small moves keep the breaks, a real change takes new ones", () => {
  assert.equal(needsRescale(null, anchor), true);
  assert.equal(needsRescale(anchor, { ...anchor }), false);
  assert.equal(needsRescale(anchor, { ...anchor, zoom: 9.9 }), false);
  assert.equal(needsRescale(anchor, { ...anchor, zoom: 10.1 }), true);
  assert.equal(needsRescale(anchor, { ...anchor, zoom: 9.1 }), true);
  // The view is 0.95° wide and 0.5° tall: 30% is 0.285° across, 0.15° up.
  assert.equal(needsRescale(anchor, { ...anchor, bounds: shifted(0.25, 0) }), false);
  assert.equal(needsRescale(anchor, { ...anchor, bounds: shifted(0.3, 0) }), true);
  assert.equal(needsRescale(anchor, { ...anchor, bounds: shifted(0, 0.1) }), false);
  assert.equal(needsRescale(anchor, { ...anchor, bounds: shifted(0, 0.16) }), true);
  // Another level of areas (MSOAs zoomed out) or another layer always re-splits.
  assert.equal(needsRescale(anchor, { ...anchor, level: "price:msoa" }), true);
});

test("the legend's store tells listeners only of new breaks", () => {
  let calls = 0;
  const stop = subscribeViewScale(() => { calls += 1; });
  setViewScale({ metricId: "price", breaks: [1, 2, 3] });
  setViewScale({ metricId: "price", breaks: [1, 2, 3] });
  assert.equal(calls, 1);
  setViewScale({ metricId: "price", breaks: [1, 2, 4] });
  setViewScale(null);
  assert.equal(calls, 3);
  assert.equal(currentViewScale(), null);
  stop();
});

test("the explainer says the colours rank the areas in view, and marks real values", () => {
  assert.match(scalePoint("percentile", 5, "London", true)!.text, /areas in view/);
  assert.match(scalePoint("percentile", 5, "London")!.text, /in London/);
  const breaks = [2_000, 4_000, 6_000, 8_000, 16_000];
  const marks = scaleMarks({
    metric: { id: "price-per-square-metre", unit: "£/m²", bivariate: null }, scaleMode: "percentile",
    values: [3_000, 9_000], selected: { name: "Hackney", value: 9_000 }, position: (value) => viewPosition(value, breaks) / 100,
    inView: { median: breaks[2] },
  });
  assert.match(marks.average!.label, /^Typical in view £6/);
  assert.equal(marks.average!.position, 0.5);
  assert.match(marks.area!.label, /^Hackney · £9/);
});

test("class edges read in a few characters", () => {
  assert.equal(terseValue(7_640, "£/m²"), "£7.6k");
  assert.equal(terseValue(12.4, "%"), "12%");
  assert.equal(terseValue(3, "minutes"), "3 min");
  assert.equal(terseValue(1.5, "minutes"), "1.5 min");
  assert.equal(terseValue(3.25, "%"), "3.3%");
  assert.equal(terseValue(48_000, "£/year"), "£48k");
  assert.equal(terseValue(0.42, ""), "0.42");
  assert.equal(terseValue(1_234, "per 1,000"), "1.2k");
  assert.equal(terseValue(55, "percentile"), "55");
});
