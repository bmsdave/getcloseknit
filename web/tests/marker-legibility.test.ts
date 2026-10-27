import assert from "node:assert/strict";
import test from "node:test";

import { COLLISION_AREA_FADE, SEVERITIES, collisionIconMarkup } from "../src/lib/map-collisions";
import { saleHaloColour } from "../src/lib/map-sale-layers";
import { SCHOOL_FOLD_RADIUS } from "../src/lib/map-school-layer";
import {
  RANK_TIERS, SCHOOL_CAP_PX, SCHOOL_ICON_SCALE, SCHOOL_ICON_UNITS, STAGE_LETTER_UNITS, TIER_COLOUR, TIER_TEXT, plaqueMarkup,
} from "../src/lib/school-icons";

// v4.6 marker legibility (owner, 2026-10-19: "school icons are very small, you can't make them out"): every map marker
// can be made out on a phone — text on a marker renders at 11 px or more, glyphs keep 4:1 on their own fill, and a
// marker takes a 44 px tap.

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("v4.6: school caps are 36 px; the phase letter renders at 12 px or more, P and S at 14 px", () => {
  assert.equal(SCHOOL_CAP_PX, 36);
  assert.ok(STAGE_LETTER_UNITS.one * SCHOOL_ICON_SCALE >= 14);
  assert.ok(STAGE_LETTER_UNITS.two * SCHOOL_ICON_SCALE >= 12);
  // The icon's canvas is its hover and tap box (MapLibre hit-tests the image's box): at least 44 px.
  assert.ok(SCHOOL_ICON_UNITS * SCHOOL_ICON_SCALE >= 44);
  // Caps that would overlap fold: the fold radius is the cap's size.
  assert.equal(SCHOOL_FOLD_RADIUS, SCHOOL_CAP_PX);
});

test("v4.6: every award plaque's number renders at 11 px or more, at 4:1 or better on its fill", () => {
  for (const tier of RANK_TIERS) {
    const markup = plaqueMarkup(tier);
    const scale = Number(/scale\(([\d.]+)\)/.exec(markup)?.[1]);
    const size = Number(/<text[^>]*font-size="([\d.]+)"/.exec(markup)?.[1]);
    assert.ok(size * scale * SCHOOL_ICON_SCALE >= 11, `tier ${tier}: ${(size * scale * SCHOOL_ICON_SCALE).toFixed(1)} px`);
    assert.ok(contrast(TIER_TEXT[tier], TIER_COLOUR[tier]) >= 4, `tier ${tier}: ${contrast(TIER_TEXT[tier], TIER_COLOUR[tier]).toFixed(2)}:1`);
    assert.match(markup, new RegExp(`fill="${TIER_TEXT[tier]}"[^>]*>${tier}</text>`));
  }
});

test("v4.6: collision bursts are 24 / 20 / 16 px (severity by size), the road user big enough to make out", () => {
  assert.deepEqual(SEVERITIES.map((severity) => severity.px), [24, 20, 16]);
  // Serious and slight keep their white edge with a dark rim outside it (a sun burst on snow is 1.5:1); fatal's
  // own outline stays the one solid dark edge.
  assert.match(collisionIconMarkup(3, "walk"), /fill="none" stroke="#22252c" stroke-opacity="0.6"/);
  assert.doesNotMatch(collisionIconMarkup(1, "walk"), /stroke-opacity="0.6"/);
  // The warm heat over a warm area colour: the area fill steps back while the heat shows.
  assert.ok(COLLISION_AREA_FADE > 0 && COLLISION_AREA_FADE <= 0.5);
});

test("v4.6: sale pins keep a 3:1 outline on both basemaps", () => {
  assert.ok(contrast(saleHaloColour("day"), "#f4f7fa") >= 3);
  assert.ok(contrast(saleHaloColour("night"), "#16203a") >= 3);
});
