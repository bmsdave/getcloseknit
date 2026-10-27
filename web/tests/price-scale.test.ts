import assert from "node:assert/strict";
import test from "node:test";

import { METRICS } from "../src/lib/fixtures";
import { blockColour, propertyLayers, propertyLayersApply, tooltipLines } from "../src/lib/map-property-layers";
import { saleColour } from "../src/lib/map-sale-layers";
import { parseMapState } from "../src/lib/map-state";
import { PRICE_RAMP } from "../src/lib/palettes";
import {
  hueBandRanges,
  logBreaks,
  logColourExpression,
  median,
  nextTimelinePeriod,
  perceptualRamp,
  PRICE_HISTORY_STEPS,
  PRICE_LATEST_STEPS,
  PRICE_STEPS,
  priceBand,
  priceBandCounts,
  priceBreaks,
  priceStops,
  rampPosition,
  rangeLabel,
  stopsRange,
  timelineIndex,
  timelinePeriods,
  yearlyPeriods,
} from "../src/lib/price-scale";

// Vigintiles (0, 5 … 100%) of real LSOA £/m² packs (official-2026-06 release).
const LSOA_2006 = [1761, 2228, 2347, 2442, 2508, 2579, 2656, 2724, 2784, 2871, 2946, 3041, 3137, 3240, 3375, 3557, 3777, 4045, 4410, 5213, 13354];
const LSOA_2026 = [3895, 4872, 5012, 5214, 5410, 5559, 5680, 5833, 6021, 6237, 6429, 6636, 6915, 7317, 7706, 8098, 8675, 9230, 9958, 11236, 18925];
// priceBreaks over the 21 yearly packs of the local official release (scripts/price-hue-spread.ts, October 2026).
const REAL_BREAKS = [2300, 3300, 4600, 5400, 6000, 6900, 8600, 14000];

function months(start: number, end: number): string[] {
  const periods: string[] = [];
  for (let value = start; value <= end; value += 1) {
    periods.push(`${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`);
  }
  return periods;
}

test("the timeline steps once a year: June, plus the latest month when it is not June", () => {
  const monthly = months(2006 * 12 + 5, 2026 * 12 + 3);
  const steps = yearlyPeriods(monthly);
  assert.equal(steps[0], "2006-06");
  assert.equal(steps.at(-2), "2025-06");
  assert.equal(steps.at(-1), "2026-04");
  assert.equal(steps.length, 21);
  assert.deepEqual(yearlyPeriods(months(2006 * 12 + 5, 2026 * 12 + 5)).slice(-2), ["2025-06", "2026-06"]);
});

test("the timeline steps a month at a time over every month the release has (v3 Fix 4–5)", () => {
  const steps = timelinePeriods(months(2006 * 12 + 5, 2026 * 12 + 5));
  assert.equal(steps.length, 241);
  assert.deepEqual(steps.slice(0, 3), ["2006-06", "2006-07", "2006-08"]);
  assert.equal(timelineIndex(steps, "2006-06"), 0);
  assert.equal(timelineIndex(steps, "2015-03"), steps.indexOf("2015-03"));
  assert.equal(nextTimelinePeriod(steps, "2015-03"), "2015-04");
  assert.equal(nextTimelinePeriod(steps, "2015-12"), "2016-01");
  assert.equal(nextTimelinePeriod(steps, "2026-06"), null);
  // A month outside the release rests on the step before it and plays on from there.
  assert.equal(timelineIndex(steps, "2027-01"), 240);
  assert.equal(nextTimelinePeriod(steps, "2005-01"), "2006-06");
});

test("breaks are equal-count over the latest year, with history steps below down to every year's low end", () => {
  // A log-uniform latest year and an older, cheaper year.
  const latest = Array.from({ length: 5000 }, (_, index) => 4000 * Math.exp((1.5 * (index + 0.5)) / 5000));
  const older = latest.map((value) => value / 2);
  const breaks = priceBreaks([...older, ...latest], latest)!;
  assert.equal(breaks.length, PRICE_STEPS + 1);
  assert.equal(PRICE_STEPS, PRICE_HISTORY_STEPS + PRICE_LATEST_STEPS);
  for (let index = 1; index < breaks.length; index += 1) assert.ok(breaks[index] > breaks[index - 1]);
  // Rounded to what the labels show: £100 under £10k, £1k above.
  for (const value of breaks) assert.equal(value % (value < 10_000 ? 100 : 1_000), 0, `${value}`);
  // The history steps run from every year's 2nd percentile up to the latest year's, evenly on a log axis.
  assert.equal(breaks[0], Math.round(older[200] / 100) * 100);
  assert.equal(breaks[PRICE_HISTORY_STEPS], Math.round(latest[100] / 100) * 100);
  assert.equal(breaks.at(-1), Math.round(latest[4900] / 1000) * 1000);
  // Each latest step (a quintile) holds about a fifth of 96% of the latest year's values; the top
  // band ~2% (here 3.5%: its £17.4k break rounds down to £17k).
  const shares = priceBandCounts(latest, breaks).map((count) => count / latest.length);
  for (const share of shares.slice(PRICE_HISTORY_STEPS, -1)) assert.ok(Math.abs(share - 0.192) < 0.02, `step holds ${share}`);
  assert.ok(shares.at(-1)! < 0.04, `top band holds ${shares.at(-1)}`);
  assert.ok(shares.slice(0, PRICE_HISTORY_STEPS).reduce((sum, share) => sum + share, 0) < 0.03);
  // No cheaper history: the history steps still reach 20% below the latest year.
  assert.equal(priceBreaks(latest, latest)![0], Math.round((latest[100] * 0.8) / 100) * 100);
  assert.equal(priceBreaks([], []), null);
  assert.equal(priceBreaks([5000, 5000], [5000, 5000]), null);
  assert.equal(rangeLabel({ low: 2300, high: 14000 }), "£2.3k – £14k+");
});

test("tied quantiles still give strictly rising breaks", () => {
  const values = [...Array.from({ length: 80 }, () => 4000), ...Array.from({ length: 20 }, (_, index) => 5000 + index * 500)];
  const breaks = priceBreaks(values, values)!;
  for (let index = 1; index < breaks.length; index += 1) assert.ok(breaks[index] > breaks[index - 1]);
});

test("ramp position gives every break-to-break step an equal share, log within a step, clamped", () => {
  const breaks = [1000, 2000, 2500, 8000, 10000];
  assert.equal(rampPosition(1000, breaks), 0);
  assert.equal(rampPosition(2000, breaks), 0.25);
  assert.equal(rampPosition(2500, breaks), 0.5);
  assert.ok(Math.abs(rampPosition(Math.sqrt(2500 * 8000), breaks) - 0.625) < 1e-9);
  assert.equal(rampPosition(10000, breaks), 1);
  assert.equal(rampPosition(500, breaks), 0);
  assert.equal(rampPosition(99_000, breaks), 1);
  assert.equal(rampPosition(0, breaks), 0);
  assert.equal(logBreaks({ low: 2000, high: 14000 }).length, PRICE_STEPS + 1);
});

test("one colour band per break: band 0 takes everything below, the last everything from the top break up", () => {
  const breaks = REAL_BREAKS;
  assert.equal(priceBand(1000, breaks), 0);
  assert.equal(priceBand(3299, breaks), 0);
  assert.equal(priceBand(3300, breaks), 1);
  assert.equal(priceBand(13_999, breaks), breaks.length - 2);
  assert.equal(priceBand(14_000, breaks), breaks.length - 1);
  assert.equal(priceBandCounts([null, 0, ...LSOA_2006], breaks).reduce((sum, count) => sum + count, 0), LSOA_2006.length);
  // The latest year spreads over the latest steps; 2006 sits in the history bands.
  assert.equal(priceBand(median(LSOA_2026)!, breaks), PRICE_HISTORY_STEPS + 2, "the 2026 median sits in the middle quintile");
  assert.ok(priceBand(median(LSOA_2006)!, breaks) < PRICE_HISTORY_STEPS);
  const counts2026 = priceBandCounts(LSOA_2026.slice(1, -1), breaks);
  assert.ok(Math.max(...counts2026) <= 5, `2026 vigintiles per band ${counts2026}`);
});

test("one stop per break in the ramp's own colours; the legend lists each band's £/m² span", () => {
  const stops = priceStops(REAL_BREAKS, PRICE_RAMP);
  assert.equal(stops.length, PRICE_STEPS + 1);
  assert.deepEqual(stops.map((stop) => stop.value), REAL_BREAKS);
  assert.deepEqual(stops.map((stop) => stop.colour), [...PRICE_RAMP]);
  assert.equal(stops[0].label, "£2.3k");
  assert.equal(stops.at(-1)!.label, "£14k+");
  assert.deepEqual(stopsRange(stops), { low: 2300, high: 14000 });
  const bands = hueBandRanges(stops);
  assert.equal(bands.length, PRICE_STEPS + 1);
  assert.deepEqual(bands.map((band) => band.label).slice(0, 3), ["Under £3.3k", "£3.3k–£4.6k", "£4.6k–£5.4k"]);
  assert.deepEqual(bands.map((band) => band.label).slice(-2), ["£8.6k–£14k", "£14k+"]);
  assert.equal(bands.at(-1)!.colour, PRICE_RAMP.at(-1));
  assert.equal(new Set(bands.map((band) => band.colour)).size, bands.length);
  // Six-colour palettes spread end to end over the breaks.
  const viridis = priceStops(REAL_BREAKS, ["#440154", "#fde725"]);
  assert.equal(viridis[0].colour, "#440154");
  assert.equal(viridis.at(-1)!.colour, "#fde725");
});

test("the default price ramp is a short sequential ramp: about seven steps, darkening from cheap to dear", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
      .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  assert.equal(PRICE_RAMP.length, PRICE_STEPS + 1);
  assert.ok(PRICE_RAMP.length >= 6 && PRICE_RAMP.length <= 8, `${PRICE_RAMP.length} colours`);
  const levels = PRICE_RAMP.map(luminance);
  // Lightness alone orders the ramp, so it reads under any colour-vision deficiency (and in greyscale).
  for (let index = 1; index < levels.length; index += 1) {
    assert.ok(levels[index] < levels[index - 1] * 0.85, `darker at ${index}: ${levels[index]} vs ${levels[index - 1]}`);
  }
  assert.ok((levels[0] + 0.05) / (levels.at(-1)! + 0.05) > 10, "the ends differ strongly in contrast");
});

test("the perceptual ramp keeps the palette's ends and steps evenly in lightness", () => {
  const ramp = perceptualRamp(["#eff6fb", "#08519c"], 7);
  assert.equal(ramp.length, 7);
  assert.equal(ramp[0], "#eff6fb");
  assert.equal(ramp[6], "#08519c");
  const luminance = ramp.map((hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16));
  for (let index = 1; index < luminance.length; index += 1) assert.ok(luminance[index] < luminance[index - 1]);
});

test("map colours interpolate over ln(value) between ln(stop)", () => {
  const expression = logColourExpression(["get", "ppm"], [{ value: 2000, colour: "#000000" }, { value: 16000, colour: "#ffffff" }]);
  assert.deepEqual(expression.slice(0, 3), ["interpolate", ["linear"], ["ln", ["max", 1, ["to-number", ["get", "ppm"]]]]]);
  assert.ok(Math.abs((expression[3] as number) - Math.log(2000)) < 1e-9);
  assert.equal(expression[4], "#000000");
});

test("homes take their area's colour; blocks their median; pins never a restated value", () => {
  const price = METRICS.find((metric) => metric.id === "price-per-square-metre")!;
  const homes = JSON.stringify(propertyLayers(price).filter((layer) => !layer.id.startsWith("block-")).map((layer) => layer.paint));
  assert.doesNotMatch(homes, /"sppm"|"ppm"|"value"/);
  assert.match(JSON.stringify(blockColour(price)), /#d1d5d3/, "blocks without a median are grey");
  assert.deepEqual(tooltipLines("parcel-fill", { ppm: 9000, sppm: 4000, value: 900000, latest_sale: "2019-05-01" }, "/m²"),
    ["Dwelling", "Sold 2019"]);
  const base = { colourBy: "price", years: 5, scale: "default" } as const;
  assert.doesNotMatch(JSON.stringify(saleColour(base)), /"value"/);
});

test("stock value merged into the price layer: old links open price per m²", () => {
  assert.equal(parseMapState(new URLSearchParams("layer=stock-value-per-square-metre")).layer, "price-per-square-metre");
  assert.equal(propertyLayersApply("stock-value-per-square-metre"), false);
  assert.equal(propertyLayersApply("price-per-square-metre"), true);
});
