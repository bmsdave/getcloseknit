import assert from "node:assert/strict";
import test from "node:test";

import {
  adoptSavedState, applyEnvDefaults, initialPitch, isDemoAllowed, LONDON_BOUNDS, MIN_LINK_ZOOM, MIN_MAP_ZOOM, parseMapState,
  preserveDiagnosticsQuery, serializeMapState, selectedFitZoom, shouldFitSelectedArea, homeFromQuery, linkedLayer, withHomeQuery,
  unknownLayerNotice,
} from "../src/lib/map-state";
import type { MapState } from "../src/lib/map-state";

const SERVED = "rel-2026-09-london-6m-v1";

test("a real deployment stays real: ?mode=demo or a preview release needs ?dev=1", () => {
  for (const search of [
    "mode=demo&release=preview-2026-09", "mode=demo", "release=preview-2026-09",
    // Unparseable values must not fall through to the legacy demo default.
    "mode=bogus", "mode=Real", "mode=", "release=", "mode=real&release=bad%20x",
  ]) {
    const parameters = new URLSearchParams(search);
    applyEnvDefaults(parameters, { mode: "real", release: SERVED });
    assert.deepEqual([parseMapState(parameters).mode, parseMapState(parameters).release], ["real", SERVED], search);
  }
  const dev = new URLSearchParams("mode=demo&release=preview-2026-09&dev=1");
  applyEnvDefaults(dev, { mode: "real", release: SERVED });
  assert.equal(parseMapState(dev).mode, "demo");

  const demoDeployment = new URLSearchParams("mode=demo&release=preview-2026-09");
  applyEnvDefaults(demoDeployment, { mode: undefined, release: undefined });
  assert.equal(parseMapState(demoDeployment).mode, "demo");

  assert.equal(isDemoAllowed(new URLSearchParams(), "real"), false);
  assert.equal(isDemoAllowed(new URLSearchParams("dev=1"), "real"), true);
  assert.equal(isDemoAllowed(new URLSearchParams(), "demo"), true);
});

test("a saved demo choice is ignored on a real deployment unless demo is allowed", () => {
  const saved = { mode: "demo" as const, release: "preview-2026-09" };
  const served = { mode: "real" as const, release: SERVED };

  assert.deepEqual(adoptSavedState(saved, served, false), served);
  assert.deepEqual(adoptSavedState(saved, served, true), saved);
  assert.deepEqual(adoptSavedState(saved, { mode: "demo", release: "preview-2026-09" }, false), saved);
});

test("map state round-trips through a shareable query string", () => {
  const state: MapState = {
    latitude: 51.5074,
    longitude: -0.1278,
    zoom: 11,
    pitch: 45,
    bearing: -12,
    layer: "price-per-square-metre" as const,
    period: "2026-06",
    selected: "uk:lsoa:E01000001",
    mode: "demo" as const,
    release: "preview-2026-09",
  };

  assert.deepEqual(parseMapState(new URLSearchParams(serializeMapState(state))), state);
});

test("map state clamps pitch to the shared native-compatible limit", () => {
  const state = parseMapState(new URLSearchParams("pitch=85"));

  assert.equal(state.pitch, 60);
});

// Layers v5 (PR 1): a merged layer's old link opens the item and view that replaced it.
test("old links to merged layers open what replaced them", () => {
  assert.equal(parseMapState(new URLSearchParams("layer=stock-value-per-square-metre")).layer, "price-per-square-metre");
  assert.equal(parseMapState(new URLSearchParams("layer=custom:kebab-cafe")).layer, "custom:good-coffee-kebab");
  assert.equal(parseMapState(new URLSearchParams("layer=custom:quiet-nights")).layer, "custom:nightlife");
  // Layers v5 PR 3: Universities and colleges became Student areas; Rent change links still paint it.
  assert.equal(parseMapState(new URLSearchParams("layer=custom:universities")).layer, "student-share");
  // Views keep their own ids: Price per m² › Borough HPI, Wealth › Deprivation, Green & trees › Green streets.
  for (const layer of ["hpi-change-5y", "hpi-change-10y", "income", "deprivation", "green-streets", "road-collisions"]) {
    assert.equal(parseMapState(new URLSearchParams({ layer })).layer, layer);
  }
  // Dropped from the menu, still painted: Mobile signal, New stations and the dropped ready-made criteria.
  for (const layer of ["mobile-4g-indoor", "future-station-distance", "custom:pret-greggs", "rent-change-1y", "rent-change-5y"]) {
    assert.equal(parseMapState(new URLSearchParams({ layer })).layer, layer);
  }
});

test("missing numeric parameters preserve the London default camera", () => {
  const state = parseMapState(new URLSearchParams());

  assert.equal(state.latitude, 51.5074);
  assert.equal(state.longitude, -0.1278);
  assert.equal(state.zoom, 11);
  assert.equal(state.pitch, 45);
});

test("reloading a parent-area link retains the parent selection", () => {
  for (const selected of ["uk:msoa:E02000001", "uk:lad:E09000001"] as const) {
    const restored = parseMapState(new URLSearchParams(`selected=${encodeURIComponent(selected)}`));
    assert.equal(restored.selected, selected);
    assert.equal(parseMapState(new URLSearchParams(serializeMapState(restored))).selected, selected);
  }
});

test("personal match is a shareable map view without embedding a profile", () => {
  const state = parseMapState(new URLSearchParams("layer=personal-match"));

  assert.equal(state.layer, "personal-match");
  assert.doesNotMatch(serializeMapState(state), /profile|destination|budget/);
});

test("navigation preserves the diagnostics flag without sharing it", () => {
  const state: MapState = {
    latitude: 51.5074,
    longitude: -0.1278,
    zoom: 11,
    pitch: 45,
    bearing: -12,
    layer: "price-per-square-metre" as const,
    period: "2026-06",
    selected: null,
    mode: "demo" as const,
    release: "preview-2026-09",
  };

  assert.equal(preserveDiagnosticsQuery(serializeMapState(state), "?diagnostics=1").includes("diagnostics=1"), true);
  assert.equal(preserveDiagnosticsQuery(serializeMapState(state), "?layer=crime").includes("diagnostics"), false);
  assert.equal(preserveDiagnosticsQuery(serializeMapState(state), "?dev=1").includes("dev=1"), true);
  assert.equal(preserveDiagnosticsQuery(serializeMapState(state), "?layer=crime").includes("dev="), false);
  // v4.6: ?saved=1 (the Saved panel open) survives the map's own rewrites, so a reload opens Saved again.
  assert.equal(new URLSearchParams(preserveDiagnosticsQuery(serializeMapState(state), "?saved=1")).get("saved"), "1");
  assert.equal(preserveDiagnosticsQuery(serializeMapState(state), "?layer=crime").includes("saved="), false);
});

test("the London map is held to London; URLs cannot zoom out past England's widest view", () => {
  const [[west, south], [east, north]] = LONDON_BOUNDS;
  // Greater London's own extent sits inside the bounds.
  assert.ok(west < -0.51 && east > 0.33 && south < 51.29 && north > 51.69);
  // The map itself stops at MIN_MAP_ZOOM on the London map (area-map minZoom), at England's on the England map.
  assert.equal(parseMapState(new URLSearchParams("zoom=3")).zoom, MIN_LINK_ZOOM);
  assert.equal(parseMapState(new URLSearchParams("zoom=6")).zoom, 6);
  assert.equal(parseMapState(new URLSearchParams("zoom=9")).zoom, MIN_MAP_ZOOM);
});

test("a selected area without a map position asks the map to fit that area", () => {
  assert.equal(shouldFitSelectedArea(new URLSearchParams("selected=uk:lsoa:E01000477&period=2026-06")), true);
  // An unusable position is no position: the defaults would apply anyway.
  assert.equal(shouldFitSelectedArea(new URLSearchParams("selected=uk:lsoa:E01000477&lat=&zoom=abc")), true);
});

test("an explicit map position wins over fitting the selected area", () => {
  for (const position of ["lat=51.55", "lng=-0.28", "lat=51.55&lng=-0.28&zoom=13"]) {
    assert.equal(shouldFitSelectedArea(new URLSearchParams(`selected=uk:lsoa:E01000477&${position}`)), false, position);
    assert.equal(selectedFitZoom(new URLSearchParams(`selected=uk:lsoa:E01000477&${position}`)), null, position);
  }
});

test("a zoom alone still opens on the selected area, centred at that zoom (G-E08)", () => {
  // ?selected=uk:msoa:E02002373&z=12 stayed on London: the zoom counted as a position.
  for (const [query, zoom] of [["z=12", 12], ["zoom=13.5", 13.5], ["z=3", 5], ["zoom=abc", null], ["", null]] as const) {
    const parameters = new URLSearchParams(`selected=uk:msoa:E02002373${query ? `&${query}` : ""}`);
    assert.equal(shouldFitSelectedArea(parameters), true, query);
    assert.equal(selectedFitZoom(parameters), zoom, query);
  }
});

test("nothing to fit without a valid selected area", () => {
  assert.equal(shouldFitSelectedArea(new URLSearchParams()), false);
  assert.equal(shouldFitSelectedArea(new URLSearchParams("selected=not-an-area")), false);
});

test("phones open flat unless the link names a pitch; places are read flat at any width", () => {
  assert.equal(initialPitch("", 390, 45, null), 0);
  assert.equal(initialPitch("?pitch=30", 390, 30, null), 30);
  assert.equal(initialPitch("?places=off", 1440, 45, null), 45);
  // Places are on unless ?places=off: read flat.
  assert.equal(initialPitch("", 1440, 45, null), 0);
  assert.equal(initialPitch("?places=all", 1440, 45, null), 0);
  // The address always carries the pitch after load, so a reload keeps a tilted view.
  assert.equal(initialPitch("?places=all&pitch=45", 1440, 45, null), 45);
});

test("the viewer's own 2D/3D choice opens the map; a link's pitch still wins", () => {
  assert.equal(initialPitch("", 390, 45, 45), 45, "a phone opens tilted once the viewer chose 3D");
  assert.equal(initialPitch("", 1440, 45, 45), 45, "even with Places on");
  assert.equal(initialPitch("?places=off", 1440, 45, 0), 0);
  assert.equal(initialPitch("?pitch=45", 390, 45, 0), 45);
  assert.equal(initialPitch("?pitch=0", 1440, 0, 45), 0);
});

test("the chosen home round-trips through the map address and is dropped when cleared", () => {
  const state = parseMapState(new URLSearchParams("selected=uk%3Alsoa%3AE01000001&mode=demo"));
  const home = { uprn: "100000000001", addressId: "uk:addr:a1b2c3d4e5f6" as const };
  const query = withHomeQuery(serializeMapState(state), home);
  assert.match(query, /[?&]?uprn=100000000001(&|$)/);
  assert.match(query, /address=uk%3Aaddr%3Aa1b2c3d4e5f6/);
  assert.deepEqual(homeFromQuery(`?${query}`), home);
  assert.deepEqual(parseMapState(new URLSearchParams(query)), state, "the rest of the view is untouched");
  assert.equal(homeFromQuery(withHomeQuery(query, null)), null);
  // Only the address id, or only the UPRN, is still a home; anything else is ignored.
  assert.deepEqual(homeFromQuery("address=uk%3Aaddr%3Aabc"), { uprn: null, addressId: "uk:addr:abc" });
  assert.equal(homeFromQuery("uprn=12ab&address=javascript%3Aalert(1)"), null);
});

test("hand-written layer names open their layer; an unknown one says so; ?z= is the zoom (G-E27, G-E08)", () => {
  assert.equal(parseMapState(new URLSearchParams("layer=schools")).layer, "good-schools-nearby");
  assert.equal(parseMapState(new URLSearchParams("layer=hmo")).layer, "hmo-per-1000");
  assert.equal(parseMapState(new URLSearchParams("layer=commute")).layer, "price-per-square-metre");
  assert.equal(unknownLayerNotice("?layer=hmo"), null);
  assert.equal(unknownLayerNotice("?layer=crime"), null);
  assert.equal(unknownLayerNotice("?layer=custom:nightlife"), null);
  assert.equal(unknownLayerNotice(""), null);
  assert.match(unknownLayerNotice("?layer=commute") ?? "", /No map layer called “commute”: showing Price per m²/);
  assert.equal(parseMapState(new URLSearchParams("z=12.5")).zoom, 12.5);
  assert.equal(parseMapState(new URLSearchParams("zoom=9&z=12")).zoom, 9, "zoom wins");
  assert.equal(selectedFitZoom(new URLSearchParams("selected=uk:msoa:E02002373&z=12")), 12);
});

test("a link's short layer name is its layer, so its evidence asks for the layer's own month (HMO 404)", () => {
  // ?layer=hmo asked /areas/…?metric=hmo-per-1000&period=2026-06 (the price month): a 404.
  assert.equal(linkedLayer("?layer=hmo&selected=uk:msoa:E02001089"), "hmo-per-1000");
  assert.equal(linkedLayer("?layer=hmo-per-1000"), "hmo-per-1000");
  assert.equal(linkedLayer("?layer=commute"), null);
  assert.equal(linkedLayer(""), null);
});
