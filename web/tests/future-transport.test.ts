import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FutureTransportNote } from "../src/components/future-transport";
import { METRIC_IDS } from "../src/lib/contracts";
import { METRICS } from "../src/lib/fixtures";
import { futureTransportPath, readAreaFutureTransport, type AreaFutureTransport } from "../src/lib/future-transport";
import { isLayerAvailableInMode, parseMapState } from "../src/lib/map-state";
import { findTopic, LAYER_EXCLUSIONS } from "../src/lib/map-topics";
import { rangeLabel, rangeLayer } from "../src/lib/range-layers";

const PAYLOAD = {
  schemaVersion: "area-future-transport.v1", productReleaseId: "rel-test", dataMode: "release", confidence: "medium",
  value: {
    available: true,
    nearest: { station: "Old Kent Road 1", scheme: "Bakerloo line extension", mode: "tube", distanceM: 400, status: "proposed",
      expectedYear: null, sourceUrl: "https://tfl.gov.uk/travel-information/improvements-and-projects/bakerloo-line-extension", withinReach: true },
    note: "New station Old Kent Road 1 ≈ 0.4 km away, proposed, not funded",
  },
  evidence: [], sources: [], caveats: ["Plans change: a proposed scheme is shown as proposed, never as coming."],
};

const render = (data: AreaFutureTransport | null) => renderToStaticMarkup(createElement(FutureTransportNote, { data }));

test("reads only an area-future-transport.v1 envelope", () => {
  assert.equal(futureTransportPath("uk:lsoa:E01000001"), "/api/v1/areas/uk%3Alsoa%3AE01000001/future-transport");
  assert.equal(readAreaFutureTransport(PAYLOAD)?.value.nearest?.station, "Old Kent Road 1");
  assert.equal(readAreaFutureTransport({ schemaVersion: "area-location.v1" }), null);
  assert.equal(readAreaFutureTransport(null), null);
});

test("the card line keeps the word proposed and links the official page", () => {
  const html = render(readAreaFutureTransport(PAYLOAD));
  assert.match(html, /New station Old Kent Road 1 ≈ 0\.4 km away, proposed, not funded/);
  assert.match(html, /href="https:\/\/tfl\.gov\.uk\/travel-information\/improvements-and-projects\/bakerloo-line-extension"/);
  assert.match(html, /data-status="proposed"/);
  assert.doesNotMatch(html, /coming|expected/i);
});

test("nothing within 2 km, unloaded or loading: no line", () => {
  assert.equal(render(null), "");
  assert.equal(render(readAreaFutureTransport({ ...PAYLOAD, value: { ...PAYLOAD.value, note: null } })), "");
  assert.equal(render(readAreaFutureTransport({ ...PAYLOAD, value: { available: false, nearest: null, note: null } })), "");
});

// Layers v5 (PR 1): the km layer leaves the menu (New stations become pins, PR 2); it stays a metric, a link and a criterion.
test("the layer is a real layer and a range criterion where closer is better, out of the menu with a reason", () => {
  assert.ok((METRIC_IDS as readonly string[]).includes("future-station-distance"));
  assert.ok(METRICS.some((metric) => metric.id === "future-station-distance"));
  assert.equal(findTopic("future-station-distance"), null);
  assert.ok((LAYER_EXCLUSIONS["future-station-distance"]?.length ?? 0) > 10);
  assert.ok(isLayerAvailableInMode("future-station-distance", "real"));
  assert.equal(parseMapState(new URLSearchParams("layer=future-station-distance")).layer, "future-station-distance");
  assert.equal(rangeLayer("future-station-distance")?.better, "lower");
  assert.equal(rangeLabel({ layer: "future-station-distance", min: null, max: 2, softMin: null, softMax: null, importance: 3 }),
    "≤ 2 km to a new station");
});
