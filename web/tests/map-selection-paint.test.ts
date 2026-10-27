import assert from "node:assert/strict";
import test from "node:test";

import { SELECTION_HALO_COLOUR, selectionFillOpacity, selectionHaloPaint, selectionOutlinePaint } from "../src/lib/map-selection-paint";

function evaluate(expression: unknown, featureState: Record<string, unknown>): unknown {
  const run = (node: unknown): unknown => {
    if (!Array.isArray(node)) return node;
    const [operator, ...args] = node as [string, ...unknown[]];
    if (operator === "case") {
      for (let index = 0; index < args.length - 1; index += 2) {
        if (run(args[index])) return run(args[index + 1]);
      }
      return run(args[args.length - 1]);
    }
    if (operator === "boolean") {
      const [value, fallback] = args;
      const resolved = run(value);
      return typeof resolved === "boolean" ? resolved : run(fallback);
    }
    if (operator === "==") return run(args[0]) === run(args[1]);
    if (operator === "feature-state") return featureState[args[0] as string];
    throw new Error(`unsupported operator in test evaluator: ${operator}`);
  };
  return run(expression);
}

test("selected observed areas get the emphasis fill without touching hue", () => {
  assert.equal(evaluate(selectionFillOpacity(), { selected: true, quality: "observed" }), 0.95);
  assert.equal(evaluate(selectionFillOpacity(), { selected: false, quality: "observed" }), 0.88);
});

test("honesty opacities survive selection", () => {
  assert.equal(evaluate(selectionFillOpacity(), { selected: true, quality: "suppressed" }), 0.35);
  assert.equal(evaluate(selectionFillOpacity(), { selected: false, quality: "suppressed" }), 0.35);
  assert.equal(evaluate(selectionFillOpacity(), { selected: true, quality: "fallback" }), 0.8);
  assert.equal(evaluate(selectionFillOpacity(), { selected: false, quality: "fallback" }), 0.8);
});

test("only the selected area is outlined: thick white over a dark halo", () => {
  const paint = selectionOutlinePaint();
  assert.equal(evaluate(paint["line-color"], { selected: true }), "#ffffff");
  assert.equal(evaluate(paint["line-width"], { selected: true }), 3.5);
  const halo = selectionHaloPaint();
  assert.equal(halo["line-color"], SELECTION_HALO_COLOUR);
  assert.equal(evaluate(halo["line-width"], { selected: true }), 8);
  assert.equal(evaluate(halo["line-width"], { selected: false }), 0);
  assert.equal(evaluate(paint["line-color"], { selected: false }), "#ffffff");
  assert.equal(evaluate(paint["line-width"], { selected: false }), 0);
});

test("a wider area the map does not draw (a district or borough) gets the selection's outline and halo", async () => {
  const { widerAreaOutlinePaint, widerAreaHaloPaint } = await import("../src/lib/map-selection-paint");
  assert.deepEqual(widerAreaOutlinePaint(), { "line-color": "#ffffff", "line-width": 3.5 });
  assert.deepEqual(widerAreaHaloPaint(), { "line-color": SELECTION_HALO_COLOUR, "line-width": 8, "line-opacity": 0.85 });
});
