import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EXPLORE_CHIPS } from "../src/lib/explore-chips";
import { TYPICAL_PRICE_TYPES } from "../src/lib/typical-price";
import {
  CUSTOM_DIVERGING, CUSTOM_SEQUENTIAL, DEFAULT_PALETTE, metricPolarity, paletteById, paletteRamp, PALETTES, PRICE_RAMP, rampAt, recolourLegend,
  sampleRamp, themedLegend, YARN_RAMPS, yarnLegend, yarnRamp,
} from "../src/lib/palettes";

const legend = [
  { value: 0, colour: "#000000", label: "0" },
  { value: 50, colour: "#000000", label: "50" },
  { value: 100, colour: "#000000", label: "100+" },
];

test("ramps interpolate between their end colours", () => {
  assert.equal(rampAt(["#000000", "#ffffff"], 0), "#000000");
  assert.equal(rampAt(["#000000", "#ffffff"], 1), "#ffffff");
  assert.equal(rampAt(["#000000", "#ffffff"], 0.5), "#808080");
  assert.deepEqual(sampleRamp(["#000000", "#ffffff"], 3), ["#000000", "#808080", "#ffffff"]);
});

test("a palette recolours a legend but keeps its values and labels", () => {
  const recoloured = recolourLegend(legend, paletteById("viridis").colours);
  assert.deepEqual(recoloured.map((stop) => stop.value), [0, 50, 100]);
  assert.deepEqual(recoloured.map((stop) => stop.label), ["0", "50", "100+"]);
  assert.equal(recoloured[0].colour, "#440154");
  assert.equal(recoloured[2].colour, "#fde725");
});

test("a palette leaves clear stops clear and spreads over the painted ones", () => {
  const ranked = [
    { value: 0, colour: "rgba(243, 242, 236, 0)", label: "Not in your top 50" },
    { value: 49, colour: "rgba(243, 242, 236, 0)", label: "" },
    { value: 50, colour: "#f08a24", label: "#50" },
    { value: 100, colour: "#5b1a8e", label: "#1" },
  ];
  const recoloured = recolourLegend(ranked, paletteById("viridis").colours);
  assert.deepEqual(recoloured.slice(0, 2), ranked.slice(0, 2));
  assert.equal(recoloured[2].colour, "#440154");
  assert.equal(recoloured[3].colour, "#fde725");
});

test("every palette is a real ramp; unknown ids fall back to the default one", () => {
  for (const palette of PALETTES) assert.ok(palette.colours.length >= 2, palette.id);
  assert.equal(paletteById("no-such-palette").id, "colour-blind");
  assert.equal(paletteById(null).id, "colour-blind");
  // No layer keeps its own colours: the standard palette paints even a legend of black stops.
  for (const id of ["crime", "price-per-square-metre", "income", "custom:cafes"]) {
    assert.ok(themedLegend(id, legend, paletteById("current")).every((stop) => stop.colour !== "#000000"), id);
  }
});

test("each metric declares whether high values are good, bad or neither", () => {
  assert.equal(metricPolarity("crime"), "good-low");
  assert.equal(metricPolarity("deprivation"), "good-high");
  assert.equal(metricPolarity("station-access"), "good-low");
  assert.equal(metricPolarity("food-hygiene"), "good-high");
  // Prices: cheaper is better for a buyer, per m² and for the whole home of every type.
  for (const id of ["price-per-square-metre", ...TYPICAL_PRICE_TYPES.map((type) => type.id)]) {
    assert.equal(metricPolarity(id), "good-low", id);
  }
  for (const id of ["income", "social-renting", "custom:cafes", "census-age", "personal-match"]) {
    assert.equal(metricPolarity(id), "neutral", id);
  }
});

test("v4 Task 43: the default is colour-blind safe, listed first; the traffic light stays a choice under its old id", () => {
  assert.equal(DEFAULT_PALETTE, "colour-blind");
  assert.equal(PALETTES[0].id, DEFAULT_PALETTE);
  // A visitor who chose the traffic light has "current" stored or in a link: it still resolves to it.
  assert.equal(paletteById("current").label, "Traffic light");
  // No green-to-red default anywhere: the default price ramp runs blue (cheap) to red (dear).
  const ramp = paletteRamp(paletteById(DEFAULT_PALETTE), "price-per-square-metre");
  assert.ok(!ramp.includes("#1a9850"));
});

const GREEN = "#1a9850";
const RED = "#d73027";

test("the traffic light runs green (good) to red (bad) on polar layers and a calm ramp on neutral ones", () => {
  const standard = paletteById("current");
  const ends = (id: string) => { const stops = themedLegend(id, legend, standard); return [stops[0].colour, stops.at(-1)!.colour]; };
  assert.deepEqual(ends("crime"), [GREEN, RED]);
  assert.deepEqual(ends("station-access"), [GREEN, RED]);
  assert.deepEqual(ends("deprivation"), [RED, GREEN]);
  assert.deepEqual(ends("food-hygiene"), [RED, GREEN]);
  // Cheap is green, dear is red: price per m² and the whole-home price of every type.
  for (const id of ["price-per-square-metre", ...TYPICAL_PRICE_TYPES.map((type) => type.id)]) assert.deepEqual(ends(id), [GREEN, RED], id);
  // Income and the rest are neither good nor bad: no green or red, low to high.
  assert.deepEqual(paletteRamp(standard, "income"), paletteById("yarn").colours);
  assert.ok(!ends("income").includes(GREEN) && !ends("income").includes(RED));
});

test("'Colour-blind safe' puts red at the worse end and a safe sequential ramp on neutral layers", () => {
  const safe = paletteById("colour-blind");
  const ends = (id: string) => { const stops = themedLegend(id, legend, safe); return [stops[0].colour, stops.at(-1)!.colour]; };
  // Red is the worse end: few good hygiene ratings, the most deprived decile, the longest walk, the most crime.
  assert.equal(ends("food-hygiene")[0], "#b2182b");
  assert.equal(ends("deprivation")[0], "#b2182b");
  assert.equal(ends("station-access")[1], "#b2182b");
  assert.equal(ends("crime")[1], "#b2182b");
  // Cheap is blue, dear is red.
  for (const id of ["price-per-square-metre", ...TYPICAL_PRICE_TYPES.map((type) => type.id)]) assert.deepEqual(ends(id), ["#2166ac", "#b2182b"], id);
  assert.deepEqual(paletteRamp(safe, "income"), PRICE_RAMP);
});

test("the named palettes run low to high on every layer, whatever the polarity", () => {
  for (const id of ["viridis", "magma", "yarn", "ocean", "ember"]) {
    const palette = paletteById(id);
    for (const metric of ["crime", "deprivation", "price-per-square-metre"]) {
      assert.deepEqual(paletteRamp(palette, metric), palette.colours, `${id} on ${metric}`);
    }
  }
  assert.equal(themedLegend("deprivation", legend, paletteById("viridis"))[0].colour, "#440154");
});

/** Hue (degrees), HSL saturation and lightness of a #rrggbb colour. */
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, light = (max + min) / 2;
  const hue = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(hue + 360) % 360, d === 0 ? 0 : d / (1 - Math.abs(2 * light - 1)), light];
}

test("no palette paints olive: a dark or dull yellow-green", () => {
  for (const palette of PALETTES) {
    for (const metric of ["crime", "deprivation", "price-per-square-metre"]) {
      // The ramp's own stops and the shades between them that a 9-class legend picks.
      for (const colour of sampleRamp(paletteRamp(palette, metric), 9)) {
        const [hue, saturation, light] = hsl(colour);
        const olive = hue >= 45 && hue <= 95 && (light < 0.45 || (saturation < 0.6 && light < 0.55));
        assert.ok(!olive, `${palette.id}: ${colour}`);
      }
    }
  }
});

test("only a fully transparent stop counts as clear", async () => {
  const { isClearColour } = await import("../src/lib/palettes");
  assert.equal(isClearColour("rgba(243, 242, 236, 0)"), true);
  assert.equal(isClearColour("rgba(243,242,236,0.5)"), false);
  assert.equal(isClearColour("#2b8fd6"), false);
});

/** CIELAB L* (D65) of a #rrggbb colour. */
function lightness(hex: string): number {
  const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

const SNOW = "#f4f7fa";
const YARN_HEX: Record<string, string> = { cherry: "#e2453c", sun: "#f6c445", tangerine: "#f28b30", sky: "#4aa3df", cobalt: "#2f5bd3", pink: "#f08bb0" };

test("lens ramps run from snow through the chip's own yarn, at least 8 L* per step", () => {
  for (const [name, ramp] of Object.entries(YARN_RAMPS)) {
    assert.equal(ramp.length, 5, name);
    assert.equal(ramp[0], SNOW, name);
    const steps = ramp.map(lightness);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i - 1] - steps[i] >= 8, `${name} step ${i}: ${steps.map((l) => l.toFixed(1))}`);
    // The yarn itself lies on the ramp: between two stops in lightness, and the end is never lighter than it.
    assert.ok(steps[4] <= lightness(YARN_HEX[name]) + 0.5, `${name} ends lighter than its yarn`);
  }
  const sides = CUSTOM_DIVERGING.map(lightness);
  assert.equal(CUSTOM_DIVERGING[2], SNOW);
  for (let i = 1; i < sides.length; i++) assert.ok(Math.abs(sides[i] - sides[i - 1]) >= 8, `diverging step ${i}`);
});

test("the web's lens ramps match the API's (api/area_api/custom_criteria.py)", () => {
  const source = readFileSync(new URL("../../api/area_api/custom_criteria.py", import.meta.url), "utf8");
  const tuple = (name: string) => {
    const match = source.match(new RegExp(`^${name} = \\(([^)]*)\\)`, "m"));
    assert.ok(match, `${name} not found in custom_criteria.py`);
    return [...match[1].matchAll(/"(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  };
  assert.deepEqual(tuple("SEQUENTIAL"), [...CUSTOM_SEQUENTIAL]);
  assert.deepEqual(tuple("DIVERGING"), [...CUSTOM_DIVERGING]);
});

test("every Explore chip has a lens ramp in its own yarn", () => {
  for (const chip of EXPLORE_CHIPS) {
    const name = chip.yarn?.match(/--yarn-([a-z]+)/)?.[1];
    assert.ok(name && name in YARN_RAMPS, chip.label);
    assert.deepEqual(yarnRamp(chip.yarn), YARN_RAMPS[name as keyof typeof YARN_RAMPS]);
  }
  assert.deepEqual(yarnRamp(null), CUSTOM_SEQUENTIAL);
  assert.deepEqual(yarnRamp("var(--yarn-plaid)"), CUSTOM_SEQUENTIAL);
});

test("a chip's yarn swaps the API's sequential stops step for step and leaves pair stops alone", () => {
  const api = [0, 1, 2, 3, 4].map((step) => ({ value: step, colour: CUSTOM_SEQUENTIAL[4 - step], label: "" })); // reversed: "nearest"
  const sun = yarnLegend(api, YARN_RAMPS.sun);
  assert.deepEqual(sun.map((stop) => stop.colour), [...YARN_RAMPS.sun].reverse());
  assert.deepEqual(sun.map((stop) => stop.value), [0, 1, 2, 3, 4]);
  const pair = CUSTOM_DIVERGING.map((colour, value) => ({ value, colour, label: "" }));
  assert.deepEqual(yarnLegend(pair, YARN_RAMPS.sun).map((stop) => stop.colour).slice(0, 2), CUSTOM_DIVERGING.slice(0, 2));
});
