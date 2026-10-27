import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BivariateLegendCompact } from "../src/components/bivariate-legend";
import type { BivariateSquare } from "../src/lib/contracts";

const SQUARE: BivariateSquare = {
  axes: { a: { label: "kebab shops", thresholds: [1, 2, 4] }, b: { label: "cafés", thresholds: [7, 20, 37] } },
  // colours[a][b]: column = shade of A, row = shade of B.
  colours: [0, 1, 2, 3].map((a) => [0, 1, 2, 3].map((b) => `#${a}${b}0000`)),
  corners: { none: "few kebab shops or cafés", a: "mostly kebab shops", b: "mostly cafés", both: "many of both" },
};

test("the lens legend chip has a visible key of the corners the map paints (v4 Task 45)", () => {
  const html = renderToStaticMarkup(createElement(BivariateLegendCompact, { square: SQUARE, label: "Kebab shops vs cafés" }));
  const key = html.slice(html.indexOf('data-testid="legend-bivariate-key"'));
  for (const corner of ["mostly kebab shops", "mostly cafés", "many of both"]) assert.ok(key.includes(corner), corner);
  // Each key entry is its corner's own colour: mostly A, mostly B, both.
  const order = ["#300000", "#030000", "#330000"].map((colour) => key.indexOf(colour));
  assert.ok(order.every((at) => at > 0) && order[0] < order[1] && order[1] < order[2], JSON.stringify(order));
});
