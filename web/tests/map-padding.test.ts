import assert from "node:assert/strict";
import test from "node:test";

import { MIN_VISIBLE_PX, paddingFor, paddingOffset, panBounds } from "../src/lib/map-padding";

const rect = (left: number, top: number, width: number, height: number) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

test("desktop: the side panel's width pads the right, the top bar the top", () => {
  const frame = rect(0, 0, 1440, 900);
  const padding = paddingFor(frame, rect(12, 12, 1416, 56), rect(1048, 80, 380, 808), 24);
  assert.deepEqual(padding, { top: 92, bottom: 24, left: 24, right: 392 + 24 });
});

test("phone: the bottom sheet's visible height pads the bottom", () => {
  const frame = rect(0, 0, 390, 844);
  // A sheet at half the screen.
  const half = paddingFor(frame, rect(8, 8, 374, 56), rect(0, 422, 390, 422), 24);
  assert.deepEqual(half, { top: 88, bottom: 422 + 24, left: 24, right: 24 });
  // A sheet covering three quarters: the gaps give way (not the sheet) so the map keeps room to fit into.
  const padding = paddingFor(frame, rect(8, 8, 374, 56), rect(0, 211, 390, 633), 24);
  assert.ok(padding.top > 64 && padding.top < 88, `${padding.top}`);
  assert.ok(padding.bottom > 633, `${padding.bottom}`);
  assert.equal(frame.height - padding.top - padding.bottom, MIN_VISIBLE_PX);
  // The centre moves up into the visible strip.
  assert.ok(paddingOffset(padding)[1] < -200);
});

test("My match on a phone: a wide gap shrinks before the target is pushed under the sheet", () => {
  const frame = rect(0, 0, 390, 844);
  // The sheet at its default height leaves a ~150px strip; My match asks for a 48px gap.
  const padding = paddingFor(frame, rect(8, 8, 374, 56), rect(0, 220, 390, 624), 48);
  assert.ok(padding.bottom >= 624, `${padding.bottom}`);
  assert.ok(padding.top >= 64, `${padding.top}`);
  assert.equal(frame.height - padding.top - padding.bottom, MIN_VISIBLE_PX);
});

test("a full-height sheet still leaves the map room to fit into", () => {
  const frame = rect(0, 0, 390, 844);
  const padding = paddingFor(frame, rect(8, 8, 374, 56), rect(0, 40, 390, 804), 24);
  assert.equal(padding.top + padding.bottom, frame.height - MIN_VISIBLE_PX);
  assert.ok(padding.top >= 0 && padding.bottom >= 0);
});

test("phones may pan one London-height further south, so London can sit above the sheet", () => {
  const london: [[number, number], [number, number]] = [[-0.85, 51.15], [0.65, 51.83]];
  assert.deepEqual(panBounds(london, 1440), london);
  const phone = panBounds(london, 390);
  assert.deepEqual(phone[1], london[1]);
  assert.ok(Math.abs(phone[0][1] - 50.47) < 1e-9);
});

test("no blocks on screen: only the gap", () => {
  assert.deepEqual(paddingFor(rect(0, 0, 390, 844), null, null, 24), { top: 24, bottom: 24, left: 24, right: 24 });
});
