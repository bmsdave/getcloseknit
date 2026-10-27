import assert from "node:assert/strict";
import test from "node:test";

import { rubberBand, snapAfterRelease, snapAfterTap, stepSnap } from "../src/lib/sheet-snap";

// A 375x812 phone: the peek (grabber and one line), half and full under the top bar.
const heights = { collapsed: 72, half: 380, full: 732 };

test("a slow release rests on the nearest snap", () => {
  assert.equal(snapAfterRelease(400, 0, heights), "half");
  assert.equal(snapAfterRelease(540, 0.2, heights), "half");
  assert.equal(snapAfterRelease(600, -0.2, heights), "full");
  assert.equal(snapAfterRelease(200, 0, heights), "collapsed");
  assert.equal(snapAfterRelease(900, 0, heights), "full");
  assert.equal(snapAfterRelease(60, 0, heights), "collapsed");
});

test("a flick goes on to the next snap its way, whatever the distance", () => {
  assert.equal(snapAfterRelease(395, -0.8, heights), "full");
  assert.equal(snapAfterRelease(365, 0.8, heights), "collapsed");
  assert.equal(snapAfterRelease(80, -1.5, heights), "half");
  assert.equal(snapAfterRelease(720, 1.5, heights), "half");
  // Flung down from far up, it still stops at the next snap below the finger.
  assert.equal(snapAfterRelease(500, 2, heights), "half");
});

test("a flick past the ends stays on the end snap", () => {
  assert.equal(snapAfterRelease(800, -2, heights), "full");
  assert.equal(snapAfterRelease(100, 2, heights), "collapsed");
  assert.equal(snapAfterRelease(420, -2, heights, ["collapsed", "half"]), "half");
});

test("the rubber band gives way less the further it is pulled, and never past its stretch", () => {
  assert.equal(rubberBand(50, 0, 100), 50);
  const a = rubberBand(-40, 0, 100);
  const b = rubberBand(-200, 0, 100);
  assert.ok(a < 0 && a > -40, `${a}`);
  assert.ok(b < a && b > -64, `${b}`);
  assert.ok(rubberBand(140, 0, 100) > 100 && rubberBand(140, 0, 100) < 140);
});

test("a tap on the grabber toggles the peek and half; from full it comes down to half", () => {
  assert.equal(snapAfterTap("collapsed"), "half");
  assert.equal(snapAfterTap("half"), "collapsed");
  assert.equal(snapAfterTap("full"), "half");
});

test("arrow keys step one allowed snap and stop at the ends", () => {
  assert.equal(stepSnap("collapsed", 1), "half");
  assert.equal(stepSnap("half", 1), "full");
  assert.equal(stepSnap("full", 1), "full");
  assert.equal(stepSnap("full", -1), "half");
  assert.equal(stepSnap("collapsed", -1), "collapsed");
  assert.equal(stepSnap("half", 1, ["collapsed", "half"]), "half");
  assert.equal(stepSnap("full", -1, ["collapsed", "half"]), "collapsed");
});
