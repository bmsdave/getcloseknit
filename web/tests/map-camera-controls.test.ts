import assert from "node:assert/strict";
import test from "node:test";

import { escapeRung, type EscapeClaims } from "../src/lib/esc-ladder";
import { COMPASS_EASE_MS, COMPASS_HIDE_MS, compassShown, needleAngle } from "../src/lib/map-compass";
import { DEFAULT_MAP_STATE, parseMapState } from "../src/lib/map-state";

// Map controls PR 1: the compass chip, north by default and the Esc ladder.

test("the map opens heading north; a link's own bearing still wins", () => {
  assert.equal(DEFAULT_MAP_STATE.bearing, 0);
  assert.equal(parseMapState(new URLSearchParams("")).bearing, 0);
  assert.equal(parseMapState(new URLSearchParams("bearing=-12")).bearing, -12);
});

test("the compass shows only while the settled camera is turned or tilted", () => {
  assert.equal(compassShown({ bearing: 0, pitch: 0 }), false);
  assert.equal(compassShown({ bearing: 30, pitch: 0 }), true);
  assert.equal(compassShown({ bearing: -30, pitch: 0 }), true);
  assert.equal(compassShown({ bearing: 0, pitch: 45 }), true);
  // A bearing MapLibre has snapped to north is 0 exactly; a floating-point whisper is still north.
  assert.equal(compassShown({ bearing: 1e-9, pitch: 0 }), false);
  // After a tap it stays while the map eases back, even once the camera reads north and flat.
  assert.equal(compassShown({ bearing: 0, pitch: 0 }, true), true);
  assert.ok(COMPASS_HIDE_MS > COMPASS_EASE_MS, "the chip outlives the ease");
});

test("the needle undoes the map's bearing so its north half points north", () => {
  assert.equal(needleAngle(0), 0);
  assert.equal(needleAngle(30), -30);
  assert.equal(needleAngle(-90), 90);
});

const free: EscapeClaims = { typing: false, dialog: false, drawing: false, handled: false };

test("Escape closes one rung per press: peek, then card, then selection", () => {
  assert.equal(escapeRung({ peek: true, card: true, selection: true }, free), "peek");
  assert.equal(escapeRung({ peek: false, card: true, selection: true }, free), "card");
  assert.equal(escapeRung({ peek: false, card: false, selection: true }, free), "selection");
  assert.equal(escapeRung({ peek: false, card: false, selection: false }, free), null);
});

test("Escape is left to what claims it first", () => {
  const open = { peek: true, card: true, selection: true };
  assert.equal(escapeRung(open, { ...free, typing: true }), null);
  assert.equal(escapeRung(open, { ...free, dialog: true }), null);
  assert.equal(escapeRung(open, { ...free, drawing: true }), null);
  assert.equal(escapeRung(open, { ...free, handled: true }), null);
});
