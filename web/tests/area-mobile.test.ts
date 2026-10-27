import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MobileRow, MobileSourceLines } from "../src/components/area-mobile";

import { type AreaMobileResponse, mobilePath, mobilePercent, mobileRow, readAreaMobile } from "../src/lib/area-mobile";
import { parseMapState } from "../src/lib/map-state";
import { findTopic, hiddenTopicLayers, LAYER_EXCLUSIONS, visibleTopicGroups } from "../src/lib/map-topics";

const CAMDEN: AreaMobileResponse = {
  schemaVersion: "area-mobile.v1", productReleaseId: "r1", geographyId: "uk:lsoa:E01000842", available: true,
  grain: "borough", confidence: "medium",
  value: {
    borough: { id: "uk:lad:E09000007", name: "Camden" }, premises: 122219,
    indoor4gAll: { share: 0.9988, regionPercentile: 91, regionShare: 0.9921 },
    outdoor5gAny: { share: 1, regionPercentile: 50, regionShare: 0.9999 },
    outdoor4gAll: 1, outdoor5gAll: 1, notes: ["n"], sourceVersions: ["src-ofcom-mobile"],
  },
  evidence: [], notes: ["n"], sources: [], caveats: [],
};

test("Mobile payloads are recognised and fetched per area", () => {
  assert.equal(readAreaMobile(CAMDEN), CAMDEN);
  assert.equal(readAreaMobile({ schemaVersion: "area-home.v1", notes: [] }), null);
  assert.equal(mobilePath("uk:lsoa:E01000842"), "/api/v1/areas/uk%3Alsoa%3AE01000842/mobile");
});

test("Mobile reads as one row: 4G indoors and 5G outdoors, the borough and London", () => {
  assert.deepEqual(mobileRow(CAMDEN), {
    term: "Mobile (Camden)",
    value: "4G indoors 99.9% (above 91% of boroughs) · 5G outdoors 100%",
  });
  assert.equal(mobileRow({ ...CAMDEN, available: false, value: null }), null);
  assert.equal(mobileRow(null), null);
  assert.equal(mobilePercent(0.9657), "96.6%");
  assert.equal(mobilePercent(1), "100%");
  assert.equal(mobilePercent(null), null);
});

// Layers v5 (PR 1): one Ofcom figure per borough paints the borough one colour; out of the menu, the links still work.
test("Mobile layers are out of the Layers menu with a reason; their links still paint them", () => {
  for (const layer of ["mobile-4g-indoor", "mobile-5g-outdoor"] as const) {
    assert.ok((LAYER_EXCLUSIONS[layer]?.length ?? 0) > 10, layer);
    assert.equal(findTopic(layer), null, layer);
    assert.equal(parseMapState(new URLSearchParams({ layer })).layer, layer);
  }
});

test("A flagged layer the release leaves out is hidden from the selector", () => {
  const layers = (groups: ReturnType<typeof visibleTopicGroups>) => groups.flatMap((group) => group.items.map((item) => item.layer));
  // Not known yet (demo, or the metrics list still loading): nothing hidden.
  assert.deepEqual(hiddenTopicLayers(null), []);
  assert.deepEqual(hiddenTopicLayers(new Set(["air-no2", "noise"])), []);
  assert.deepEqual(hiddenTopicLayers(new Set(["noise"])), ["air-no2"]);
  assert.ok(layers(visibleTopicGroups()).includes("air-no2"));
  assert.ok(!layers(visibleTopicGroups([], ["air-no2"])).includes("air-no2"));
});

test("The Homes row renders beside broadband, and nothing before the layer is loaded", () => {
  const html = renderToStaticMarkup(createElement(MobileRow, { mobile: CAMDEN }));
  assert.match(html, /data-testid="home-mobile"/);
  assert.match(html, /<dt>Mobile \(Camden\)<\/dt><dd>4G indoors 99\.9% \(above 91% of boroughs\) · 5G outdoors 100%<\/dd>/);
  assert.equal(renderToStaticMarkup(createElement(MobileRow, { mobile: null })), "");
  assert.equal(renderToStaticMarkup(createElement(MobileRow, { mobile: "unknown" })), "");
  const sources = renderToStaticMarkup(createElement(MobileSourceLines, {
    mobile: { ...CAMDEN, sources: [{ release: "r", sourceUrl: "u", licence: "OGL-3.0", attribution: "Ofcom Connected Nations" }],
      caveats: ["Predicted coverage, not measured speed."] } }));
  assert.equal(sources, "<p>Ofcom Connected Nations</p><p>Predicted coverage, not measured speed.</p>");
});
