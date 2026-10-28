import assert from "node:assert/strict";
import test from "node:test";

import type { Map as MapLibreMap } from "maplibre-gl";

import { fitMissedArea, fitPendingArea, fitWiderArea, motionDuration } from "../src/components/map-controller/camera";
import { controllerOf, createMapController, disposeMapController, type MapController } from "../src/components/map-controller/controller";
import { areaBounds, areaTilesOf, coverageOf, layerPackBase, mergePacks, sameAreas, waitsForMonth } from "../src/components/map-controller/data";
import { closeMapRung, mapEscapeRungs, peekLines, setHover } from "../src/components/map-controller/interactions";
import { applyCollisions, applyCycleLanes } from "../src/components/map-controller/overlays";
import {
  applyArrowValues, applyAreaSelection, applyPlain, colourExpression, drawnValues, lsoaLevels, sameValues, writeAreaState,
} from "../src/components/map-controller/paint";
import { ownScale, resolveAnalyticsView, scaleBounds, valuesInView } from "../src/components/map-controller/scale";
import type { AreaMapProps } from "../src/components/map-controller/types";
import type { AreaBoxes } from "../src/lib/area-boxes";
import { areaTileLayers } from "../src/lib/area-tiles";
import type { GeographyId, MapDefinition, ValuePack, ValuePackEntry } from "../src/lib/contracts";
import { METRICS } from "../src/lib/fixtures";
import type { Bbox, MapCoverage } from "../src/lib/map-coverage";
import type { Pick } from "../src/lib/map-pick";
import { TREND_ARROW_LAYER_IDS } from "../src/lib/map-trend-arrows";

// map-controller/ (review #22): the area map's state lives on one controller per map, read by focused modules.

const LSOA_A = "uk:lsoa:E01000001" as GeographyId;
const LSOA_B = "uk:lsoa:E01000002" as GeographyId;
const metric = (id: string) => METRICS.find((entry) => entry.id === id)! as MapDefinition;

/** The parts of a MapLibre map the modules touch, recording what they do. */
function fakeMap(options: { sources?: string[]; layers?: string[]; zoom?: number; bounds?: Bbox } = {}) {
  const sources = new Set(options.sources ?? []);
  const layers = new Set(options.layers ?? []);
  const calls: [string, ...unknown[]][] = [];
  let zoom = options.zoom ?? 10;
  let bounds: Bbox = options.bounds ?? [-0.2, 51.4, 0, 51.6];
  const tooltip = { hidden: true };
  const map = {
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    setFeatureState: (target: unknown, state: unknown) => calls.push(["setFeatureState", target, state]),
    removeFeatureState: (target: unknown) => calls.push(["removeFeatureState", target]),
    setFilter: (id: string, filter: unknown) => calls.push(["setFilter", id, filter]),
    setLayoutProperty: (id: string, property: string, value: unknown) => calls.push(["setLayoutProperty", id, property, value]),
    setPaintProperty: (id: string, property: string, value: unknown) => calls.push(["setPaintProperty", id, property, value]),
    getZoom: () => zoom,
    getBounds: () => ({ getWest: () => bounds[0], getSouth: () => bounds[1], getEast: () => bounds[2], getNorth: () => bounds[3] }),
    getContainer: () => ({ parentElement: { querySelector: () => tooltip }, dataset: {} }),
    stop: () => calls.push(["stop"]),
    fitBounds: (box: unknown) => calls.push(["fitBounds", box]),
  };
  return {
    map: map as unknown as MapLibreMap, calls, tooltip,
    move: (next: { zoom?: number; bounds?: Bbox }) => { zoom = next.zoom ?? zoom; bounds = next.bounds ?? bounds; },
  };
}

function controllerFor(fake: ReturnType<typeof fakeMap>): MapController {
  return createMapController(fake.map, {
    onCamera: () => undefined, onPitch: () => undefined, onSelect: () => undefined, onSelectDwelling: () => undefined,
    onSelectSale: () => undefined, onMedian: () => undefined,
  });
}

function entry(geographyId: GeographyId, value: number | null, regionPercentile: number | null = null): ValuePackEntry {
  return {
    geographyId, name: geographyId, metricId: "price-per-square-metre", period: "2026-06", value, regionPercentile,
    countryPercentile: null, sampleCount: 10, quality: "observed", sourceVersion: "test", carrier: "lsoa",
  };
}

function pack(values: ValuePackEntry[], period = "2026-06"): ValuePack {
  return { schemaVersion: "area-value-pack.v1", metricId: "price-per-square-metre", period, sourceVersion: "test", values };
}

const BOXES: AreaBoxes = [
  { id: LSOA_A, bbox: [-0.1, 51.5, -0.09, 51.51] },
  { id: LSOA_B, bbox: [1, 52, 1.01, 52.01] },
] as AreaBoxes;

test("each map has its own controller, found by the map until it is disposed", () => {
  const one = controllerFor(fakeMap());
  const two = controllerFor(fakeMap());
  assert.equal(controllerOf(one.map), one);
  assert.equal(controllerOf(two.map), two);
  one.plain = true;
  one.tileStates.set(LSOA_A, { selected: true });
  assert.equal(two.plain, false, "state is the controller's, not shared between maps");
  assert.equal(two.tileStates.size, 0);
  let disposed = false;
  one.morph = { dispose: () => { disposed = true; } } as unknown as MapController["morph"];
  disposeMapController(one);
  assert.ok(disposed, "its morph stops");
  assert.equal(controllerOf(one.map), undefined);
});

test("the coverage is read only after it answered, and its tiles only when it names them", () => {
  const controller = controllerFor(fakeMap());
  assert.throws(() => coverageOf(controller), /coverage read before it loaded/);
  assert.equal(areaTilesOf(controller), null);
  controller.coverage = { coverage: "london" } as unknown as MapCoverage;
  assert.equal(coverageOf(controller), controller.coverage);
  assert.equal(areaTilesOf(controller), null, "a coverage without area tiles");
});

test("pieces' packs merge into one: the first's month, every piece's areas, null when none has the month", () => {
  const props = { metric: metric("price-per-square-metre") };
  const one = pack([entry(LSOA_A, 1)]);
  assert.equal(mergePacks([one], props, "2026-06"), one);
  assert.equal(mergePacks([null, null], props, "2026-06"), null);
  const merged = mergePacks([one, null, pack([entry(LSOA_B, 2)], "2026-05")], props, "2026-01")!;
  assert.equal(merged.period, "2026-06");
  assert.deepEqual(merged.values.map((value) => value.geographyId), [LSOA_A, LSOA_B]);
});

test("boxes: the same areas in any order, and one area's bounds", () => {
  assert.ok(sameAreas(BOXES, [BOXES[1], BOXES[0]] as AreaBoxes));
  assert.ok(!sameAreas(null, BOXES));
  assert.ok(!sameAreas(BOXES, [BOXES[0]] as AreaBoxes));
  assert.deepEqual(areaBounds(BOXES, LSOA_B), [1, 52, 1.01, 52.01]);
  assert.equal(areaBounds(null, LSOA_B), null);
});

test("a layer waits for its month; a pack of its own or a match never does", () => {
  const props = (over: Partial<AreaMapProps>) => ({ metric: metric("price-per-square-metre"), matchPack: null, clientPack: null,
    mode: "real", period: "", release: "r1", ...over }) as AreaMapProps;
  assert.ok(waitsForMonth(props({})));
  assert.ok(!waitsForMonth(props({ period: "2026-06" })));
  assert.ok(!waitsForMonth(props({ mode: "demo" })));
  assert.ok(!waitsForMonth(props({ clientPack: pack([]) })));
  assert.equal(layerPackBase(props({})), null, "no month, no pack to fetch");
  assert.match(layerPackBase(props({ period: "2026-06" })) ?? "", /price-per-square-metre/);
});

test("an area's feature-state is merged as written and dropped when nothing is left", () => {
  const fake = fakeMap({ sources: ["area-tiles-lsoa"] });
  const controller = controllerFor(fake);
  writeAreaState(controller, LSOA_A, { selected: true });
  writeAreaState(controller, LSOA_A, { value: 3 });
  assert.deepEqual(controller.tileStates.get(LSOA_A), { selected: true, value: 3 });
  writeAreaState(controller, LSOA_A, { selected: false, value: null });
  assert.equal(controller.tileStates.has(LSOA_A), false);
  assert.deepEqual(fake.calls.map(([name]) => name), ["setFeatureState", "setFeatureState", "removeFeatureState"]);
  writeAreaState(controller, "uk:lsoa:not-a-code", { selected: true });
  assert.equal(fake.calls.length, 3, "an id the tiles cannot hold writes nothing");
});

test("the selection moves its flag and its kind's outline, once per change", () => {
  const outline = areaTileLayers("lsoa").outline;
  const fake = fakeMap({ sources: ["area-tiles-lsoa"], layers: [outline] });
  const controller = controllerFor(fake);
  applyAreaSelection(controller, LSOA_A);
  applyAreaSelection(controller, LSOA_A);
  applyAreaSelection(controller, LSOA_B);
  assert.equal(controller.selectedArea, LSOA_B);
  assert.equal(fake.calls.filter(([name]) => name === "setFilter").length, 2);
  assert.ok(!controller.tileStates.has(LSOA_A), "the area left unselected holds no state");
  assert.deepEqual(controller.tileStates.get(LSOA_B), { selected: true });
});

test("change arrows write only the values that changed; None hides them", () => {
  const fake = fakeMap({ sources: ["area-tiles-lsoa"], layers: [...TREND_ARROW_LAYER_IDS] });
  const controller = controllerFor(fake);
  applyArrowValues(controller, pack([entry(LSOA_A, 5), entry(LSOA_B, -2)]));
  applyArrowValues(controller, pack([entry(LSOA_A, 5), entry(LSOA_B, 1)]));
  assert.equal(fake.calls.filter(([name]) => name === "setFeatureState").length, 3);
  controller.changeScale = true;
  applyPlain(controller, true);
  applyPlain(controller, true);
  const visibility = fake.calls.filter(([name, , property]) => name === "setLayoutProperty" && property === "visibility");
  assert.equal(visibility.length, TREND_ARROW_LAYER_IDS.length, "a second None changes nothing");
  assert.ok(visibility.every((call) => call[3] === "none"));
});

test("paint helpers: drawn values, same values, one colour expression per scale, LSOA levels", () => {
  const values = [entry(LSOA_A, 1), entry(LSOA_B, 2), entry("uk:lsoa:E01000003" as GeographyId, 3)];
  assert.equal(drawnValues(null, values), values);
  assert.deepEqual(drawnValues(BOXES, values).map((value) => value.geographyId), [LSOA_A, LSOA_B]);
  assert.ok(sameValues(values, values.map((value) => ({ ...value }))));
  assert.ok(!sameValues(values, [values[0], { ...values[1], value: 9 }, values[2]]));
  const price = metric("price-per-square-metre");
  assert.equal(colourExpression(price, "linear", null), colourExpression(price, "linear", null));
  assert.notEqual(colourExpression(price, "linear", null), colourExpression(price, "percentile", null));
  assert.ok(lsoaLevels({ metric: price, matchPack: null, clientPack: null }) === (price.carrier === "lsoa"));
  assert.ok(!lsoaLevels({ metric: price, matchPack: {} as AreaMapProps["matchPack"], clientPack: null }));
});

test("the scale: values in view, the reader's scale only off a match, published ranks without a view", () => {
  assert.deepEqual(valuesInView([entry(LSOA_A, 1), entry(LSOA_B, 2), entry(LSOA_A, null)], [-0.2, 51.4, 0, 51.6],
    new Map(BOXES.map((box) => [box.id as string, box.bbox]))), [1]);
  const price = metric("price-per-square-metre");
  assert.ok(ownScale({ metric: price, matchPack: null }, "linear").adjustable);
  assert.ok(!ownScale({ metric: price, matchPack: {} as AreaMapProps["matchPack"] }, "linear").adjustable);
  const props = { metric: price, matchPack: null, clientPack: null, selected: LSOA_A, excludedCrime: [], scaleMode: "percentile" } as unknown as AreaMapProps;
  const view = resolveAnalyticsView(pack([entry(LSOA_A, 100, 40), entry(LSOA_B, 300, 90)]), props, null);
  assert.equal(view.scaleMode, "percentile");
  assert.deepEqual(view.pack.values.map((value) => value.value), [40, 90]);
  assert.equal(view.median, 200, "the price layer's median, for the legend tick");
  assert.equal(view.selected, LSOA_A);
});

test("the rank scale keeps its view until the map moves far enough", () => {
  const fake = fakeMap({ zoom: 12, bounds: [0, 0, 1, 1] });
  const controller = controllerFor(fake);
  assert.deepEqual(scaleBounds(controller, "price:lsoa"), [0, 0, 1, 1]);
  fake.move({ bounds: [0.1, 0, 1.1, 1] });
  assert.deepEqual(scaleBounds(controller, "price:lsoa"), [0, 0, 1, 1], "a small pan keeps the anchor");
  fake.move({ zoom: 13 });
  assert.deepEqual(scaleBounds(controller, "price:lsoa"), [0.1, 0, 1.1, 1], "a zoom takes the view now");
  assert.deepEqual(controller.scaleAnchor?.bounds, [0.1, 0, 1.1, 1]);
});

test("camera: a pending fit waits for its box, then is spent; a wider area fits once per selection", () => {
  assert.equal(motionDuration(700), 700, "no window: full length");
  const fake = fakeMap();
  const controller = controllerFor(fake);
  const frame = { top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 };
  (fake.map as unknown as { getContainer: () => unknown }).getContainer = () => ({ getBoundingClientRect: () => frame });
  const page = globalThis as unknown as { document?: unknown };
  page.document = { querySelector: () => null };
  try {
    controller.pendingFit = LSOA_A;
    fitPendingArea(controller);
    assert.equal(controller.pendingFit, LSOA_A, "no box yet");
    controller.paintedBoxes = BOXES;
    fitPendingArea(controller);
    assert.equal(controller.pendingFit, null);
    assert.deepEqual(fake.calls.map(([name]) => name), ["stop", "fitBounds"]);
    assert.deepEqual(fake.calls[1][1], BOXES[0].bbox);
    fitWiderArea(controller, LSOA_B, [0, 0, 1, 1]);
    fitWiderArea(controller, LSOA_B, [0, 0, 1, 1]);
    assert.equal(fake.calls.length, 3, "a wider area fits once per selection");
    assert.equal(controller.fittedWiderArea, LSOA_B);
  } finally {
    delete page.document;
  }
});

test("camera: a link to an MSOA far from the view flies there on an LSOA layer too (G-E08)", () => {
  const controller = controllerFor(fakeMap());
  const page = globalThis as unknown as { fetch: unknown };
  const saved = page.fetch;
  page.fetch = () => new Promise(() => undefined);
  try {
    const msoa = "uk:msoa:E02002373" as GeographyId;
    const props = { mode: "real" as const, release: "r", period: "2026-06", metric: { id: "hmo-per-1000", carrier: "lsoa" } };
    fitMissedArea(controller, msoa, props);
    assert.equal(controller.distantFit, msoa, "its evidence box is fetched");
    assert.equal(controller.fittedWiderArea, msoa, "the wider-area outline never fits it again");
    controller.distantFit = null;
    fitMissedArea(controller, msoa, props);
    assert.equal(controller.distantFit, null, "once per selection");
    fitMissedArea(controller, LSOA_B, props);
    assert.equal(controller.distantFit, LSOA_B, "an area of the layer's own carrier");
    assert.notEqual(controller.fittedWiderArea, LSOA_B);
  } finally {
    page.fetch = saved;
  }
});

test("interactions: the area tooltip prefers the rolled-up lines; hover and Esc clear through the controller", () => {
  const fake = fakeMap({ sources: ["properties"] });
  const controller = controllerFor(fake);
  const pick = { kind: "area", feature: { id: LSOA_A, layer: "area-fill-lsoa", properties: {} }, features: [] } as unknown as Pick;
  assert.deepEqual(peekLines(controller, pick), []);
  controller.areaTooltip = () => ["LSOA"];
  assert.deepEqual(peekLines(controller, pick), ["LSOA"]);
  controller.rolledTooltip = () => ["MSOA"];
  assert.deepEqual(peekLines(controller, pick), ["MSOA"]);

  setHover(controller, { id: 7, sourceLayer: "parcels" } as never);
  assert.deepEqual(controller.hovered, { id: 7, sourceLayer: "parcels" });
  const shown: unknown[] = [];
  controller.schoolPopup = { show: (open) => shown.push(open), open: { point: { urn: 1 } } as never };
  assert.deepEqual(mapEscapeRungs(fake.map), { peek: true, card: false });
  closeMapRung(fake.map, "peek");
  assert.equal(controller.hovered, null);
  assert.equal(controller.schoolPopup.open, null);
  assert.deepEqual(shown, [null]);
  assert.deepEqual(mapEscapeRungs(fake.map), { peek: false, card: false });
});

test("overlays: off before they were ever on touches nothing but the controller", () => {
  const fake = fakeMap();
  const controller = controllerFor(fake);
  applyCycleLanes(fake.map, false);
  applyCollisions(controller, null);
  assert.equal(controller.collisionView, null);
  assert.equal(fake.calls.length, 0);
});
