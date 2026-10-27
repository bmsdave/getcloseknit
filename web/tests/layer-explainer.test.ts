import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LayerExplainer } from "../src/components/layer-explainer";
import { legendRamp, MapLegend } from "../src/components/map-legend";
import type { MapDefinition } from "../src/lib/contracts";
import { CUSTOM_PRESETS } from "../src/lib/custom-presets";
import { METRICS } from "../src/lib/fixtures";
import { explainLayer, MAX_POINTS, paintedStore, scaleMarks, scaleValueText } from "../src/lib/layer-explainer";
import { plainFromQuery, withPlainQuery } from "../src/lib/map-shows";

const metric = (id: string) => METRICS.find((entry) => entry.id === id)! as MapDefinition;

test("Price per m², Crime and Green & trees say what they measure, how and from where", () => {
  const price = explainLayer(metric("price-per-square-metre"), { name: "Price per m²", period: "2026-06" });
  assert.equal(price.line, "What homes here sold for, per square metre of floor.");
  assert.ok(price.points.some((point) => point.source === "Sales to Jun 2026"));
  assert.equal(price.guide, "/guide/price-per-m2");
  const crime = explainLayer(metric("crime"), { name: "Crime", period: "2026-06" });
  assert.match(crime.line, /every 1,000 people/);
  assert.ok(crime.points.some((point) => point.source === "police.uk, to Jun 2026"));
  const green = explainLayer(metric("nature-score"), { name: "Green & trees", period: "2025-01", nature: { green: 34, trees: 58, site: 41 } });
  assert.equal(green.name, "Green & trees");
  assert.deepEqual(green.points.slice(0, 3).map((point) => [point.text, point.value]),
    [["Green land", "34th"], ["Street trees per hectare", "58th"], ["Nature site nearby", "41st"]]);
  assert.equal(green.guide, "/guide/nature");
  // No area chosen (or no figures for it): the parts carry no value, never a guess.
  assert.ok(explainLayer(metric("nature-score"), { name: "Green & trees", period: "2025-01" }).points.every((point) => point.value === undefined));
});

test("wildlife is presence only; a criterion says what OpenStreetMap places it counts", () => {
  const hedgehog = explainLayer(metric("wildlife-hedgehog"), { name: "Wildlife seen", period: "2025-01" });
  assert.match(hedgehog.line, /people's sightings \(GBIF\)/);
  assert.ok(hedgehog.points.some((point) => /Seen, not absent/.test(point.text)));
  const gyms = CUSTOM_PRESETS.find((entry) => entry.criterion.id === "gyms")!.criterion;
  const lens = explainLayer(metric("crime"), { name: "Gyms", period: "2026-06", criterion: gyms });
  assert.equal(lens.points[0].text, "Counted from OpenStreetMap: gyms and sports centres");
  assert.match(lens.points[0].source, /leisure=fitness_centre/);
  assert.equal(lens.guide, "/guide/your-match");
});

test("any other layer is explained from its own published definition, in at most four points", () => {
  for (const entry of METRICS) {
    const explained = explainLayer(entry as MapDefinition, { name: entry.shortLabel, period: entry.defaultPeriod });
    assert.ok(explained.line.length > 10, entry.id);
    assert.ok(explained.points.length <= MAX_POINTS, entry.id);
    assert.ok(explained.guide.startsWith("/guide"), entry.id);
  }
  const noise = explainLayer(metric("noise"), { name: "Noise", period: "2026-06" });
  // A one-sentence description already ends with a full stop (#266): do not add a second one.
  assert.equal(noise.line, metric("noise").description.split(". ")[0].replace(/\.$/, "") + ".");
});

test("a rank or change scale says how to read it in the explainer, not in the Layers menu (v3 Fix 22.8)", () => {
  const price = metric("price-per-square-metre");
  const actual = explainLayer(price, { name: "Price per m²", period: "2026-06", scaleMode: "linear" });
  assert.ok(actual.points.every((point) => !/rank|Price change/.test(point.text)));
  const rank = explainLayer(price, { name: "Price per m²", period: "2026-06", scaleMode: "percentile" });
  assert.equal(rank.points.at(-1)!.text, "Colours rank areas from lowest to highest in London");
  const manchester = explainLayer(price, { name: "Price per m²", period: "2026-06", scaleMode: "percentile", rankScope: "North West" });
  assert.equal(manchester.points.at(-1)!.text, "Colours rank areas from lowest to highest in North West");
  const change = explainLayer(price, { name: "Price per m²", period: "2026-06", scaleMode: "change", changeWindow: 10 });
  assert.equal(change.points.at(-1)!.text, "Price change over 10 years");
  assert.ok(change.points.length <= MAX_POINTS);
});

test("the scale marks London typical and the chosen area where the legend draws them", () => {
  const position = (value: number) => value / 100;
  const marks = scaleMarks({
    metric: { id: "nature-score", unit: "percentile" }, scaleMode: "linear", values: [10, 50, 90, null], position,
    selected: { name: "Highbury East", value: 44 },
  });
  assert.deepEqual(marks.average, { position: 0.5, label: "London typical Greener than 50% of London" });
  assert.deepEqual(marks.area, { position: 0.44, label: "Highbury East · Greener than 44% of London" });
  // Off the ramp's ends: pinned to them.
  assert.equal(scaleMarks({ metric: { id: "crime", unit: "rate" }, scaleMode: "linear", values: [500], position, selected: null }).average?.position, 1);
  // My match ranks; a colour square has two axes: neither has a London figure.
  assert.deepEqual(scaleMarks({ metric: { id: "personal-match", unit: "rank" }, scaleMode: "linear", values: [1, 2], position, selected: null }), { average: null, area: null });
  assert.equal(scaleValueText(44, { id: "price-per-square-metre", unit: "GBP" }, "percentile"), "44th");
  assert.equal(scaleValueText(-12.4, { id: "price-per-square-metre", unit: "GBP" }, "change"), "−12%");
  assert.equal(scaleValueText(7600, { id: "price-per-square-metre", unit: "GBP" }, "linear"), "£7,600/m²");
});

test("the rank legend names the view's scope: London, a region, or its region across regions", () => {
  const legend = { metric: metric("price-per-square-metre"), period: "2026-06", mode: "real" as const, scaleMode: "percentile" as const, changeWindow: 5 as const, stopsOverride: null };
  const html = (rankScope?: string) => renderToStaticMarkup(createElement(MapLegend, { ...legend, rankScope }));
  assert.match(html(), /Lowest in London/);
  assert.match(html("North West"), /Lowest in North West/);
  assert.match(html("North West"), /by rank in North West/);
  assert.doesNotMatch(html("its region"), /in London/);
});

test("the panel shows the name, the points, both marks and the guide link; the legend gives its ramp", () => {
  const legend = { metric: metric("crime"), period: "2026-06", mode: "demo" as const, scaleMode: "linear" as const, changeWindow: 5 as const, stopsOverride: null };
  const ramp = legendRamp(legend)!;
  assert.ok(ramp.colours.length > 2);
  assert.match(ramp.note, /Grey: no data/);
  assert.equal(ramp.position(-5), 0);
  const html = renderToStaticMarkup(createElement(LayerExplainer, {
    explanation: explainLayer(legend.metric, { name: "Crime", period: "2026-06" }), ramp,
    average: { position: 0.4, label: "London typical 95" }, area: { position: 0.6, label: "Highbury East · 112" }, onClose: () => undefined,
  }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-label="About Crime"/);
  assert.match(html, /London typical 95/);
  assert.match(html, /Highbury East · 112/);
  assert.match(html, /href="\/guide\/crime"[^>]*>More in the guide →/);
});

test("the painted values wait in a store: only a subscriber (an open explainer) hears a step", () => {
  const store = paintedStore();
  assert.equal(store.get(), null);
  let heard = 0;
  const stop = store.subscribe(() => { heard += 1; });
  store.set({ metricId: "crime", scaleMode: "linear", values: [] });
  assert.equal(heard, 1);
  assert.equal(store.get()?.metricId, "crime");
  stop();
  store.set({ metricId: "income", scaleMode: "linear", values: [] });
  assert.equal(heard, 1);
});

test("None travels in the address as ?colours=none", () => {
  assert.equal(plainFromQuery("?colours=none&layer=crime"), true);
  assert.equal(plainFromQuery("?layer=crime"), false);
  assert.equal(withPlainQuery("layer=crime", true), "layer=crime&colours=none");
  assert.equal(withPlainQuery("layer=crime&colours=none", false), "layer=crime");
});
