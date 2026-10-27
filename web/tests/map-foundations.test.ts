import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_COLLISION_VIEW } from "../src/lib/map-collisions";
import { defaultSaleView } from "../src/lib/map-sale-layers";
import {
  collisionsFromQuery, crimeOffFromQuery, cycleFromQuery, defaultScaleMode, defaultShowSetup, isDefaultLayers, isDefaultShow, mergeMapSetup, salesFromQuery,
  savedSetup, withCollisionsQuery, withCrimeOffQuery, withCycleQuery, withSalesQuery,
} from "../src/lib/map-setup";
import { closeMapSheet, openMapSheet, openMapSheetId, subscribeMapSheets } from "../src/lib/map-sheets";
import { currentMapToast, hideMapToast, MAP_TOAST_MS, showMapToast, subscribeMapToast } from "../src/lib/map-toast";
import { accuracyRing, myLocationData } from "../src/lib/my-location";

// ---- MapToast (v4 Task 10) ----

test("one map toast at a time: the newest replaces the old, and a stale hide leaves the new one", () => {
  let heard = 0;
  const stop = subscribeMapToast(() => { heard += 1; });
  const first = showMapToast("Location is blocked for this site.", { kind: "location-blocked", link: { label: "How to allow", onClick: () => undefined } });
  assert.equal(currentMapToast()?.ms, MAP_TOAST_MS);
  const second = showMapToast("Pick at least one.", { ms: 4000 });
  assert.equal(currentMapToast()?.text, "Pick at least one.");
  assert.equal(currentMapToast()?.ms, 4000);
  hideMapToast(first);
  assert.equal(currentMapToast()?.id, second, "the first toast's timer must not hide the second");
  hideMapToast(second);
  assert.equal(currentMapToast(), null);
  assert.equal(heard, 3);
  stop();
});

// ---- MapSheet store (v4 Task 13) ----

test("one map sheet at a time: opening another replaces it, closing another id leaves it", () => {
  let heard = 0;
  const stop = subscribeMapSheets(() => { heard += 1; });
  openMapSheet("layers");
  openMapSheet("show");
  assert.equal(openMapSheetId(), "show");
  closeMapSheet("layers");
  assert.equal(openMapSheetId(), "show");
  closeMapSheet();
  assert.equal(openMapSheetId(), null);
  assert.equal(heard, 3);
  stop();
});

// ---- Map setup (v4 Task 18) ----

test("a bare visit opens with the saved setup, but never its area or home", () => {
  const saved = "lat=51.4&lng=-0.2&zoom=14&pitch=0&bearing=0&layer=crime&period=2025-12&selected=uk%3Alsoa%3AE01000001&schools=on&places=off&cycle=on&crime-off=burglary";
  const merged = new URLSearchParams(mergeMapSetup("", saved));
  assert.equal(merged.get("layer"), "crime");
  assert.equal(merged.get("period"), "2025-12");
  assert.equal(merged.get("zoom"), "14");
  assert.equal(merged.get("schools"), "on");
  assert.equal(merged.get("places"), "off");
  assert.equal(merged.get("cycle"), "on");
  assert.equal(merged.get("crime-off"), "burglary");
  assert.equal(merged.get("selected"), null);
  assert.equal(merged.get("pitch"), null, "2D/3D keeps its own rule");
});

test("a link's params win for what they set; the saved setup fills the rest (URL > saved > default)", () => {
  const saved = "lat=51.4&lng=-0.2&zoom=14&layer=crime&period=2025-12&scale=percentile&schools=on&trees=on";
  // A ranking's "On map ↗" names only the layer: the saved crime view does not ride along, Show and the camera do.
  const linked = new URLSearchParams(mergeMapSetup("?layer=price-per-square-metre", saved));
  assert.equal(linked.get("layer"), "price-per-square-metre");
  assert.equal(linked.get("period"), null);
  assert.equal(linked.get("scale"), null);
  assert.equal(linked.get("schools"), "on");
  assert.equal(linked.get("zoom"), "14");
  // A link to an area without a position fits that area: no saved camera.
  const area = new URLSearchParams(mergeMapSetup("selected=uk%3Alsoa%3AE01000001", saved));
  assert.equal(area.get("zoom"), null);
  assert.equal(area.get("layer"), "crime");
  // Show items one by one: a link that turns trees off keeps the saved schools.
  const show = new URLSearchParams(mergeMapSetup("trees=off", saved));
  assert.equal(show.get("trees"), "off");
  assert.equal(show.get("schools"), "on");
  // Nothing saved: the link as it is.
  assert.equal(mergeMapSetup("?layer=crime", null), "layer=crime");
});

test("the saved setup drops the chosen home but keeps the area for Back to the map", () => {
  const saved = new URLSearchParams(savedSetup("layer=crime&selected=uk%3Alsoa%3AE01000001&uprn=123&address=uk%3Aaddr%3Aabc"));
  assert.equal(saved.get("selected"), "uk:lsoa:E01000001");
  assert.equal(saved.get("uprn"), null);
  assert.equal(saved.get("address"), null);
});

test("Show's sub-filters round-trip through the query", () => {
  assert.equal(cycleFromQuery(withCycleQuery("", true)), true);
  assert.equal(withCycleQuery("cycle=on", false), "");
  assert.deepEqual(crimeOffFromQuery(withCrimeOffQuery("", ["violent-crime", "burglary"])), ["burglary", "violent-crime"]);
  assert.deepEqual(crimeOffFromQuery("crime-off=<script>,burglary"), ["burglary"]);

  assert.equal(collisionsFromQuery(""), null);
  assert.equal(new URLSearchParams(withCollisionsQuery("", DEFAULT_COLLISION_VIEW)).get("collisions"), "on");
  assert.deepEqual(collisionsFromQuery("collisions=on"), DEFAULT_COLLISION_VIEW);
  const narrowed = { ...DEFAULT_COLLISION_VIEW, severities: [1, 2], light: "dark" as const, children: true };
  assert.deepEqual(collisionsFromQuery(withCollisionsQuery("", narrowed)), narrowed);
  // Junk falls back to the defaults field by field.
  assert.deepEqual(collisionsFromQuery("collisions=%7Bnope"), DEFAULT_COLLISION_VIEW);
  assert.deepEqual(collisionsFromQuery('collisions={"users":["alien","cyclist"],"light":"moon"}')?.users, ["cyclist"]);

  const base = defaultSaleView(2026);
  assert.equal(salesFromQuery("", base), base);
  assert.equal(withSalesQuery("", base, base), "");
  const growth = { ...base, on: true, colourBy: "growth" as const, filters: { ...base.filters, tenure: "L" as const, fromYear: 2010 } };
  const query = withSalesQuery("", growth, base);
  assert.deepEqual(salesFromQuery(query, base), growth);
  assert.equal(new URLSearchParams(withSalesQuery("", { ...base, on: true }, base)).get("sales"), "on");
});

test("Default: Show holds Local places and Stations only; Layers price per m² · Rank · latest", () => {
  const sales = defaultSaleView(2026);
  const show = defaultShowSetup(sales);
  assert.equal(show.placeView.on, true);
  assert.equal(show.shows.stations, true);
  assert.equal(show.shows.schools || show.shows.trees || show.shows.mine || show.cycleLanes, false);
  assert.equal(show.collisions, null);
  assert.equal(isDefaultShow(show, sales), true);
  assert.equal(isDefaultShow({ ...show, cycleLanes: true }, sales), false);
  assert.equal(isDefaultShow({ ...show, collisions: DEFAULT_COLLISION_VIEW }, sales), false);
  assert.equal(isDefaultShow({ ...show, placeView: { ...show.placeView, groups: show.placeView.groups.slice(1) } }, sales), false);
  assert.equal(isDefaultShow({ ...show, saleView: { ...sales, ramp: ["a"] } as typeof sales }, sales), true, "colours are not a choice made in Show");

  const layers = { layer: "price-per-square-metre", period: "2026-06", scaleMode: "percentile", changeWindow: 5, excludedCrime: [], plain: false };
  assert.equal(isDefaultLayers(layers, "2026-06", 5), true);
  assert.equal(isDefaultLayers({ ...layers, layer: "crime" }, "2026-06", 5), false);
  assert.equal(isDefaultLayers({ ...layers, period: "2020-01" }, "2026-06", 5), false);
  assert.equal(isDefaultLayers({ ...layers, scaleMode: "linear" }, "2026-06", 5), false);
  assert.equal(defaultScaleMode("price-per-square-metre"), "percentile");
  assert.equal(defaultScaleMode("crime"), "linear");
  assert.equal(isDefaultLayers({ ...layers, plain: true }, "2026-06", 5), false);
});

// ---- My location (v4 Task 10) ----

test("my location's accuracy ring is closed, round in metres and never smaller than 10 m", () => {
  const ring = accuracyRing(-0.1278, 51.5074, 100, 32);
  assert.equal(ring.length, 33);
  assert.deepEqual(ring[0], ring[32]);
  const northMetres = (ring[8][1] - 51.5074) * 111_320;
  const eastMetres = (ring[0][0] + 0.1278) * 111_320 * Math.cos((51.5074 * Math.PI) / 180);
  assert.ok(Math.abs(northMetres - 100) < 0.5 && Math.abs(eastMetres - 100) < 0.5);
  const tiny = accuracyRing(0, 51.5, 1, 4);
  assert.ok((tiny[1][1] - 51.5) * 111_320 > 9.9);
  const data = myLocationData(-0.1, 51.5, 50);
  assert.deepEqual(data.features.map((feature) => feature.geometry.type), ["Polygon", "Point"]);
});
