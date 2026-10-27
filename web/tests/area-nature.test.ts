import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AreaNatureBlock, natureFact, type AreaNature } from "../src/components/area-nature";

const NATURE: AreaNature = {
  available: true,
  green: { share: 0.418, percentile: 71 },
  trees: { count: 212, perHectare: 9, percentile: 64, top: [{ name: "London Plane", count: 40 }, { name: "Lime", count: 22 }] },
  site: { name: "Brockwell Park", kind: "lnr", metres: 640, percentile: 80 },
  score: { percentile: 77 },
  home: { uprn: "1", greenShare: 0.25, streetTrees: 1 },
  wildlife: { radiusMetres: 1000, firstYear: 2021, lastYear: 2025, records: 489, enough: true, birds: 47, mammals: 3, amphibians: 0, notable: ["Hedgehog", "Swift"] },
  sources: [],
};

const render = (nature: AreaNature | null | "unavailable") => renderToStaticMarkup(createElement(AreaNatureBlock, { nature }));

test("figures stay text beside the satin bars", () => {
  const html = render(NATURE);
  assert.match(html, /Green land.*42%/);
  assert.match(html, /9\.0 \/ ha/);
  assert.match(html, /212 street trees, mostly London Plane, Lime/);
  assert.match(html, /Nearest nature reserve: <strong>Brockwell Park<\/strong> · 640 m/);
  assert.match(html, /This home, within ~100 m: <strong>25% green<\/strong> · <strong>1 street tree<\/strong>/);
});

test("wildlife lists what was seen and never claims an absence", () => {
  const html = render(NATURE);
  assert.match(html, /Seen within 1 km, 2021–2025: <strong>47 bird species<\/strong> · 3 mammals/);
  assert.doesNotMatch(html, /amphibian/); // zero is left out, not shown as "0 amphibians"
  assert.match(html, /<li>Hedgehog<\/li><li>Swift<\/li>/);
  assert.doesNotMatch(html, /Few records/);
  const thin = render({ ...NATURE, wildlife: { ...NATURE.wildlife!, records: 12, enough: false } });
  assert.match(thin, /Few records here: what&#x27;s listed is a minimum/);
});

test("unknown is unknown: nothing rendered and no rating fact", () => {
  assert.equal(render("unavailable"), "");
  assert.equal(natureFact("unavailable"), undefined);
  assert.equal(natureFact({ ...NATURE, green: null }), undefined);
  assert.equal(natureFact(NATURE), "42% of the land is green");
});

test("a shared map link keeps a Nature or Wildlife seen layer", async () => {
  const { parseMapState } = await import("../src/lib/map-state");
  assert.equal(parseMapState(new URLSearchParams("layer=wildlife-hedgehog")).layer, "wildlife-hedgehog");
  assert.equal(parseMapState(new URLSearchParams("layer=nature-score")).layer, "nature-score");
});

test("Nature layers are published in real mode", async () => {
  const { isLayerAvailableInMode } = await import("../src/lib/map-state");
  assert.ok(isLayerAvailableInMode("wildlife-hedgehog", "real"));
  assert.ok(isLayerAvailableInMode("nature-score", "real"));
});

test("wildlife values read as words, never as a bare band number", async () => {
  const { mapValueText } = await import("../src/lib/map-legend");
  const metric = { id: "wildlife-hedgehog", unit: "band" };
  assert.deepEqual([0, 1, 1.8, 2.6].map((value) => mapValueText(value, metric)),
    ["Not in the records", "Seen rarely", "Seen sometimes", "Seen often"]);
  assert.equal(mapValueText(72, { id: "nature-score", unit: "percentile" }), "Greener than 72% of London");
});

test("Nature legends carry no single month", async () => {
  const { legendCaption } = await import("../src/lib/map-legend");
  assert.equal(legendCaption({ id: "wildlife-owl", label: "Wildlife seen: Owl" }, "2025-01"), "Wildlife seen: Owl, records within 1 km");
});
