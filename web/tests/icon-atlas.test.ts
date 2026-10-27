import assert from "node:assert/strict";
import test from "node:test";

import { SEVERITIES } from "../src/lib/map-collisions";
import { PLACE_GROUPS } from "../src/lib/map-place-layers";
import { SALE_PIN_RAMP, saleLayers, saleStops, defaultSaleView } from "../src/lib/map-sale-layers";
import { ROUTE_YARN } from "../src/lib/place-yarn";
import { OFSTED_COLOUR, TIER_COLOUR } from "../src/lib/school-icons";

/** CIE76 ΔE between two hex colours (sRGB D65 → Lab). */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92));
    const xyz = [(r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + bl * 0.0722, (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883]
      .map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
    return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
  };
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// Colours that mean something else on the map (V4-20): Ofsted tops, plaques, collisions, tree leaf, cycle sky.
const RESERVED = [...Object.values(OFSTED_COLOUR), ...Object.values(TIER_COLOUR), ...SEVERITIES.map((severity) => severity.colour), "#2f8f73", "#4aa3df"];

test("Task 20 clash 1: places get their own muted palette, never an Ofsted, plaque, collision, tree or cycle colour", () => {
  assert.deepEqual(PLACE_GROUPS.map((group) => group.colour), ["#9d744d", "#c57d82", "#946897", "#235b6e", "#7292c1", "#62514d"]);
  for (const group of PLACE_GROUPS) {
    const nearest = Math.min(...RESERVED.map((colour) => deltaE(group.colour, colour)));
    assert.ok(nearest >= (group.id === "other" ? 10 : 12), `${group.label} ${group.colour}: ΔE ${nearest.toFixed(1)}`);
  }
});

test("Task 20 clash 2: tangerine means collisions only; cycling is sky", () => {
  assert.equal(ROUTE_YARN.cycle, "#4aa3df");
  for (const group of PLACE_GROUPS) assert.notEqual(group.colour, "#f28b30");
});

test("Task 20 clash 4: sale pins are rounded squares on a one-hue plum ramp, no red or green", () => {
  assert.deepEqual(saleStops({ colourBy: "price", years: 5, scale: "default" }).map((stop) => stop.colour), [...SALE_PIN_RAMP]);
  for (const colour of SALE_PIN_RAMP) {
    assert.ok(Math.min(...SEVERITIES.map((severity) => deltaE(colour, severity.colour)), deltaE(colour, "#2f8f73")) >= 14, colour);
  }
  const [cells, pins] = saleLayers(defaultSaleView(2026));
  for (const layer of [cells, pins]) {
    assert.equal(layer.type, "symbol");
    assert.equal((layer as { layout: Record<string, unknown> }).layout["icon-image"], "sale-square");
  }
});
