import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SatinValueBar } from "../src/components/knit/satin";

const widthOfFill = (html: string) => Number(html.match(/<g class="satin">.*?<rect [^>]*width="([\d.]+)"/)?.[1] ?? 0);

test("a value bar stitches value / max of its track and keeps the figure as text", () => {
  const html = renderToStaticMarkup(createElement(SatinValueBar, { value: 50, max: 100, colour: "#2f5bd3", label: "£9,600 per m²", width: 100 }));
  assert.match(html, /£9,600 per m²/);
  assert.match(html, /aria-hidden="true"/); // the bar is decoration; the text carries the fact
  assert.equal(widthOfFill(html), 50);
  const full = renderToStaticMarkup(createElement(SatinValueBar, { value: 100, max: 100, colour: "#2f5bd3", label: "x", width: 100 }));
  assert.equal(widthOfFill(full), 100);
  const none = renderToStaticMarkup(createElement(SatinValueBar, { value: 5, max: 0, colour: "#2f5bd3", label: "x" }));
  assert.doesNotMatch(none, /class="satin"/);
});
