import assert from "node:assert/strict";
import test from "node:test";

import { EXPLORE_CHIPS } from "../src/lib/explore-chips";
import { THREAD_ICONS } from "../src/lib/thread-icons";
import { PLACE_GROUPS } from "../src/lib/map-place-layers";
import { AMENITY_COUNT } from "../src/components/places-section";
import { MY_PLACE_GLYPH } from "../src/lib/place-yarn";

test("every thread icon is a stroke path on the 24-unit grid", () => {
  for (const [name, d] of Object.entries(THREAD_ICONS)) {
    assert.match(d, /^M[\d.\s]/, `${name} starts with a move`);
    const numbers = [...d.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
    assert.ok(numbers.every((n) => Number.isFinite(n) && Math.abs(n) <= 24), `${name} stays on the 24-unit grid`);
  }
});

test("the icons the UI names are all drawn in thread", () => {
  const used = [
    "school", "building-school", "train", "bus", "tree", "shopping-cart", "beer", "tools-kitchen", "pill", "stethoscope", "home",
    "trend", "crime", "income", "flood", "noise", "people", "planning", "key",
    "settings", "panel", "layers", "chevron", "chevron-down", "menu", "star", "check", "play", "pause", "help", "info", "more", "search", "thumb-up", "thumb-down",
    "sparkle", "pin", "locate", "plus", "minus",
    ...PLACE_GROUPS.map((group) => `place-${group.id}`),
    ...EXPLORE_CHIPS.map((chip) => chip.icon),
    // v4 Task 20: the area page's places and My places' pins never fall back to the "Other" loop.
    ...Object.values(AMENITY_COUNT).map((entry) => entry.icon),
    ...Object.values(MY_PLACE_GLYPH),
  ];
  for (const name of used) assert.ok(THREAD_ICONS[name], `${name} has a thread path`);
});

test("v4 Task 20: barbell, swimming and glass-cocktail are drawn; help is a speech bubble, not info's ring", () => {
  for (const name of ["barbell", "swimming", "glass-cocktail"]) assert.ok(THREAD_ICONS[name], name);
  assert.notEqual(THREAD_ICONS.help.split(" M")[0], THREAD_ICONS.info.split(" M")[0]);
});
