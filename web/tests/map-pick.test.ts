import assert from "node:assert/strict";
import test from "node:test";

import { collisionPeekLines, collisionPopup } from "../src/lib/map-collisions";
import { cycleLanePeekLines } from "../src/lib/map-cycle-lanes";
import {
  mapCardTitle, MARKER_LAYER, opensOnClick, pickAt, pickScene, PICK_LADDER, registerPickMarker, TAP_BOX_PX, tapBox,
  type PickFeature, type PickMarker, type PickScene,
} from "../src/lib/map-pick";
import { MY_LOCATION_LAYERS } from "../src/lib/my-location";
import { stationPeekLines } from "../src/lib/map-transit";

// ---- One hit-test for the map (Map controls PR 2–3) ----

/** A scene of point objects (and polygons without a screen point) on named layers; a box takes what lies inside it. */
function scene(features: PickFeature[]): PickScene & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    query(layers, [[x0, y0], [x1, y1]]) {
      asked.push([...layers]);
      return features.filter((feature) => layers.includes(feature.layer)
        && (!feature.at || (feature.at.x >= x0 && feature.at.x <= x1 && feature.at.y >= y0 && feature.at.y <= y1)));
    },
  };
}

const at = (layer: string, x: number, y: number, properties: Record<string, unknown> = {}, id?: string | number): PickFeature =>
  ({ layer, id, properties, at: { x, y }, lngLat: [x / 1000, y / 1000] });
const AREA: PickFeature = { layer: "area-fill-lsoa", id: "uk:lsoa:E01000001", properties: {}, at: null, lngLat: null };
const POINT = { x: 100, y: 100 };
const mouse = { intent: "click" as const, coarse: false };
const finger = { intent: "click" as const, coarse: true };
const hover = { intent: "hover" as const, coarse: false };

test("the ladder: a point object over an area takes the tap, in priority order", () => {
  assert.deepEqual(PICK_LADDER.map((rung) => rung.kind),
    ["my-place", "saved", "rank", "sale", "dwelling", "school", "place", "tree", "collision", "station", "line", "cell", "block", "area"]);
  const school = at("school-points", 100, 100, { urn: "100001" });
  const cap = scene([AREA, school]);
  assert.equal(pickAt(POINT, cap, mouse)?.kind, "school");
  // The area under the cap never hears of it; without the cap it is the pick.
  assert.equal(pickAt(POINT, scene([AREA]), mouse)?.kind, "area");
  assert.equal(pickAt(POINT, scene([AREA]), mouse)?.feature.id, "uk:lsoa:E01000001");
  assert.equal(pickAt(POINT, scene([]), mouse), null);
  // Sale pins and homes beat caps; caps beat places; places beat trees; trees beat collisions.
  const everything = [
    AREA, school, at("sale-pins", 100, 100), at("dwelling-point", 100, 100), at("place-points", 100, 100),
    at("street-tree-point", 100, 100), at("collision-point", 100, 100), at("ck-transit-stations", 100, 100),
  ];
  const order: string[] = [];
  for (let rest = everything; rest.length > 1; rest = rest.filter((feature) => feature !== pickAt(POINT, scene(rest), mouse)?.feature)) {
    order.push(pickAt(POINT, scene(rest), mouse)!.kind);
  }
  assert.deepEqual(order, ["sale", "dwelling", "school", "place", "tree", "collision", "area"]);
});

test("a fold is a school cluster; a green street and a cycle lane are lines that peek; a cell and a block are peeks over the area", () => {
  assert.equal(pickAt(POINT, scene([AREA, at("school-folds", 100, 100, { cluster: true, point_count: 3 })]), mouse)?.kind, "fold");
  assert.equal(pickAt(POINT, scene([AREA, at("school-points", 100, 100, { cluster: true, cluster_id: 7 })]), mouse)?.kind, "fold");
  const street: PickFeature = { layer: "green-street-line", properties: { name: "Leafy Road" }, at: null };
  assert.equal(pickAt(POINT, scene([AREA, street]), hover)?.kind, "line");
  assert.equal(pickAt(POINT, scene([AREA, street]), mouse)?.kind, "area");
  const lane: PickFeature = { layer: "cycle-cycleway", properties: { kind: "cycleway", name: "C3" }, at: null };
  assert.equal(pickAt(POINT, scene([AREA, street, lane]), hover)?.feature.layer, "cycle-cycleway", "a lane over the road it runs along");
  assert.equal(pickAt(POINT, scene([AREA, lane]), mouse)?.kind, "area");
  // A tree before its street; a station before the lane past it.
  assert.equal(pickAt(POINT, scene([AREA, street, at("street-tree-point", 101, 100)]), hover)?.kind, "tree");
  assert.equal(pickAt(POINT, scene([AREA, lane, at("ck-transit-stations", 100, 100)]), hover)?.kind, "station");
  const block: PickFeature = { layer: "block-fill", id: 5, properties: {}, at: null };
  assert.equal(pickAt(POINT, scene([AREA, block]), hover)?.kind, "block");
  assert.equal(pickAt(POINT, scene([AREA, block]), mouse)?.kind, "area");
  const cell: PickFeature = { layer: "sale-cells", properties: { n: 12 }, at: null };
  assert.equal(pickAt(POINT, scene([AREA, cell]), hover)?.kind, "cell");
  assert.equal(pickAt(POINT, scene([AREA, cell]), mouse)?.kind, "area");
});

test("stations peek on hover only: a click on one falls through to the area", () => {
  const station = at("ck-transit-stations", 100, 100, { name: "Baker Street", lines: "bakerloo,circle,hammersmith-city,jubilee,metropolitan" });
  assert.equal(pickAt(POINT, scene([AREA, station]), hover)?.kind, "station");
  assert.equal(pickAt(POINT, scene([AREA, station]), mouse)?.kind, "area");
  assert.deepEqual(stationPeekLines(station.properties), ["Baker Street", "Bakerloo · Circle · Hammersmith & City · Jubilee · Metropolitan"]);
  assert.deepEqual(stationPeekLines({ name: "Lonely Halt", lines: "" }), ["Lonely Halt"]);
  assert.deepEqual(stationPeekLines({}), []);
});

test("a finger gets a 44 px box on caps, places, trees and collisions; a mouse keeps the drawn size", () => {
  assert.equal(TAP_BOX_PX, 44);
  assert.deepEqual(tapBox(POINT, 22), [[78, 78], [122, 122]]);
  assert.deepEqual(tapBox(POINT, 0), [[100, 100], [100, 100]]);
  for (const layer of ["school-points", "place-points", "street-tree-point", "collision-point"]) {
    const near = scene([AREA, at(layer, 120, 100)]);
    assert.equal(pickAt(POINT, near, finger)?.feature.layer, layer, `${layer} within 22 px of a finger`);
    assert.equal(pickAt(POINT, scene([AREA, at(layer, 123, 100)]), finger)?.kind, "area", `${layer} past the box`);
  }
  // A mouse: the cap's image is its own target; a badge keeps its 10 px, a dot its 4.
  assert.equal(pickAt(POINT, scene([AREA, at("school-points", 101, 100)]), mouse)?.kind, "area");
  assert.equal(pickAt(POINT, scene([AREA, at("place-points", 109, 100)]), mouse)?.kind, "place");
  assert.equal(pickAt(POINT, scene([AREA, at("place-points", 111, 100)]), mouse)?.kind, "area");
  assert.equal(pickAt(POINT, scene([AREA, at("street-tree-point", 104, 100)]), mouse)?.kind, "tree");
  assert.equal(pickAt(POINT, scene([AREA, at("street-tree-point", 105, 100)]), mouse)?.kind, "area");
  // Sale pins take 44 px with any pointer; a home is hit exactly.
  assert.equal(pickAt(POINT, scene([AREA, at("sale-pins", 120, 100)]), mouse)?.kind, "sale");
  assert.equal(pickAt(POINT, scene([AREA, at("dwelling-point", 101, 100)]), mouse)?.kind, "area");
});

test("inside a box the nearest object wins; a stack of collisions comes whole", () => {
  const far = at("place-points", 108, 100, { name: "Far" });
  const near = at("place-points", 100, 103, { name: "Near" });
  assert.equal(pickAt(POINT, scene([AREA, far, near]), mouse)?.feature.properties.name, "Near");
  const pick = pickAt(POINT, scene([AREA, at("collision-point", 102, 100, { severity: 2, year: 2023, road_user: "pedestrian" }),
    at("collision-point", 101, 100, { severity: 3, year: 2022, road_user: "cyclist" })]), mouse);
  assert.equal(pick?.kind, "collision");
  assert.equal(pick?.features.length, 2);
  const content = collisionPopup(pick!.features.map((feature) => feature.properties), 17);
  assert.deepEqual(collisionPeekLines(content), ["2 people hurt here", "Serious · 2023 · Pedestrian", "Slight · 2022 · Cyclist"]);
  assert.deepEqual(collisionPeekLines(collisionPopup([{ severity: 1, year: 2024, road_user: "car", dark: true }], 17)),
    ["Fatal · 2024 · Dark", "In a car"]);
  assert.deepEqual(collisionPeekLines(null), []);
});

test("the scene over a map asks only for layers on it and shown, and projects points", () => {
  const map = {
    layers: { "school-points": "visible", "area-fill-lsoa": undefined, "place-points": "none" } as Record<string, string | undefined>,
    getLayer(id: string) { return id in this.layers ? {} : undefined; },
    getLayoutProperty(id: string) { return this.layers[id]; },
    asked: [] as string[][],
    queryRenderedFeatures(_box: unknown, options: { layers: string[] }) {
      this.asked.push(options.layers);
      return options.layers.includes("school-points")
        ? [{ layer: { id: "school-points" }, id: 1, properties: { urn: "100001" }, geometry: { type: "Point", coordinates: [-0.1, 51.5] } }]
        : [{ layer: { id: "area-fill-lsoa" }, id: "uk:lsoa:E01000001", properties: null, geometry: { type: "Polygon" } }];
    },
    project() { return { x: 10, y: 20 }; },
    getContainer() { return { getBoundingClientRect: () => ({ left: 0, top: 0 }) }; },
  };
  const pick = pickAt(POINT, pickScene(map), hover);
  assert.deepEqual(pick?.feature, { layer: "school-points", id: 1, properties: { urn: "100001" }, at: { x: 10, y: 20 }, lngLat: [-0.1, 51.5] });
  // Hidden places and absent sale pins are never asked for.
  assert.deepEqual(map.asked, [["school-points"]]);
  const bare = { ...map, layers: { "area-fill-lsoa": undefined } as Record<string, string | undefined> };
  assert.equal(pickAt(POINT, pickScene(bare), mouse)?.kind, "area");
});

test("a card's title names it on a phone's peek line", () => {
  assert.equal(mapCardTitle({ kind: "place", place: { name: "Pizza East", detail: null, sources: null } as never }), "Pizza East");
  assert.equal(mapCardTitle({ kind: "collision", content: { kind: "many", count: 3, zoomIn: true, records: [] }, zoomIn: null }), "3 people hurt here");
  assert.equal(mapCardTitle({ kind: "tree", lines: ["London plane", "20 m tall"] }), "London plane");
  assert.equal(mapCardTitle({ kind: "tree", lines: [] }), "Tree");
  assert.equal(mapCardTitle({ kind: "my-place", placeId: "work", name: "Work" }), "Work");
});

// ---- Map controls PR 4: DOM markers, lines, cursor ----

/** A marker's element: a box on the page (the map's frame starts at 50, 50), with child boxes. */
function element(left: number, top: number, width: number, height: number, children: [number, number, number, number][] = []) {
  const box = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h });
  return {
    isConnected: true, dataset: {} as DOMStringMap,
    getBoundingClientRect: () => box(left, top, width, height),
    children: children.map(([l, t, w, h]) => ({ getBoundingClientRect: () => box(l, t, w, h) })),
  };
}

/** A map with an area under every point, a sale pin at (100, 100), and the given markers registered on it. */
function markerMap(markers: Omit<PickMarker, "lngLat">[]) {
  const map = {
    getLayer: (id: string) => (id === "area-fill-lsoa" || id === "sale-pins" ? {} : undefined),
    getLayoutProperty: () => "visible",
    queryRenderedFeatures: (_box: unknown, options: { layers: string[] }) => options.layers.includes("sale-pins")
      ? [{ layer: { id: "sale-pins" }, properties: {}, geometry: { type: "Point", coordinates: [0.1, 0.1] } }]
      : [{ layer: { id: "area-fill-lsoa" }, id: "uk:lsoa:E01000001", properties: null, geometry: { type: "Polygon" } }],
    project: () => ({ x: 100, y: 100 }),
    getContainer: () => ({ getBoundingClientRect: () => ({ left: 50, top: 50 }) }),
  };
  for (const marker of markers) registerPickMarker(map, { ...marker, lngLat: [0, 0] });
  return map;
}

test("your places, saved ♡ and ranking pins join the ladder over every canvas layer", () => {
  // Your place's pin covers (90–110, 90–110) in the map's frame.
  const pin = element(140, 140, 20, 20);
  const map = markerMap([{ kind: "my-place", element: pin, properties: { placeId: "work", name: "Work", lines: ["Work"] } }]);
  const pick = pickAt(POINT, pickScene(map), mouse);
  assert.equal(pick?.kind, "my-place", "the pin over a sale pin and an area");
  assert.equal(pick?.feature.layer, MARKER_LAYER["my-place"]);
  assert.equal(pick?.feature.properties.placeId, "work");
  assert.deepEqual(pick?.feature.at, { x: 100, y: 100 });
  assert.equal(pin.dataset.pick, "open", "a click opens it: the CSS pointer");
  // Past the pin a mouse finds the sale pin; a finger within 22 px still finds the pin.
  assert.equal(pickAt({ x: 125, y: 100 }, pickScene(map), mouse)?.kind, "sale");
  assert.equal(pickAt({ x: 130, y: 100 }, pickScene(map), finger)?.kind, "my-place");
  assert.equal(pickAt({ x: 133, y: 100 }, pickScene(map), finger)?.kind, "sale");
});

test("a pin's box takes in its teardrop above the label; a removed or hidden marker drops out", () => {
  // The label is (90–150, 100–116); the teardrop rises to 80.
  const pin = element(140, 150, 60, 16, [[140, 130, 24, 30]]);
  const map = markerMap([{ kind: "my-place", element: pin, properties: { placeId: "gym", lines: ["Gym"] } }]);
  assert.equal(pickAt({ x: 100, y: 85 }, pickScene(map), mouse)?.kind, "my-place");
  pin.isConnected = false;
  assert.equal(pickAt({ x: 100, y: 105 }, pickScene(map), mouse)?.kind, "sale", "a marker off the page is gone");
  const hidden = element(140, 140, 0, 0);
  assert.equal(pickAt(POINT, pickScene(markerMap([{ kind: "saved", element: hidden, properties: { uprn: "1", lines: ["Home"] } }])), mouse)?.kind, "sale");
});

test("a saved home's ♡ opens; a saved school's ♡ and a ranking pin only peek, and a click falls through", () => {
  const home = element(140, 140, 20, 20);
  const school = element(140, 140, 20, 20);
  const rank = element(140, 140, 20, 20);
  assert.equal(pickAt(POINT, pickScene(markerMap([{ kind: "saved", element: home, properties: { uprn: "100000000001", lines: ["1 Preview Road", "Saved"] } }])), mouse)?.kind, "saved");
  assert.equal(home.dataset.pick, "open");
  const peeks = markerMap([
    { kind: "saved", element: school, properties: { peekOnly: true, lines: ["Preview Primary", "Saved"] } },
    { kind: "rank", element: rank, properties: { geographyId: "uk:lsoa:E01000001", lines: ["1 · Westminster", "£1.2m"] } },
  ]);
  assert.equal(pickAt(POINT, pickScene(peeks), hover)?.kind, "saved");
  assert.equal(pickAt(POINT, pickScene(peeks), mouse)?.kind, "sale", "a click goes past both to the sale pin");
  assert.equal(school.dataset.pick, "peek");
  assert.equal(rank.dataset.pick, "peek");
  const rankOnly = markerMap([{ kind: "rank", element: element(140, 140, 20, 20), properties: { lines: ["3 · Soho", "£980k"] } }]);
  assert.deepEqual(pickAt(POINT, pickScene(rankOnly), hover)?.feature.properties.lines, ["3 · Soho", "£980k"]);
});

test("the cursor: a pointer over what a click opens, the default over a peek; the my-location dot is on no rung", () => {
  const pickOf = (features: PickFeature[], intent = hover) => pickAt(POINT, scene(features), intent);
  assert.equal(opensOnClick(pickOf([AREA])), true);
  assert.equal(opensOnClick(pickOf([AREA, at("school-points", 100, 100)])), true);
  assert.equal(opensOnClick(pickOf([AREA, at("school-folds", 100, 100, { cluster: true })])), true);
  assert.equal(opensOnClick(pickOf([AREA, at("ck-transit-stations", 100, 100)])), false);
  assert.equal(opensOnClick(pickOf([AREA, { layer: "cycle-lane", properties: { kind: "lane" }, at: null }])), false);
  assert.equal(opensOnClick(pickOf([AREA, { layer: "green-street-line", properties: {}, at: null }])), false);
  assert.equal(opensOnClick(pickOf([{ ...AREA, layer: MARKER_LAYER.saved, properties: { peekOnly: true } }])), false);
  assert.equal(opensOnClick(null), false);
  const rungs = PICK_LADDER.flatMap((rung) => rung.layers);
  for (const layer of MY_LOCATION_LAYERS) assert.equal(rungs.includes(layer), false, `${layer} takes no tap`);
});

test("a cycle lane peeks its type, then its name", () => {
  assert.deepEqual(cycleLanePeekLines({ kind: "cycleway", name: "C3" }), ["Cycleway", "C3"]);
  assert.deepEqual(cycleLanePeekLines({ kind: "protected", name: "" }), ["Protected track"]);
  assert.deepEqual(cycleLanePeekLines({ kind: "lane" }), ["Painted lane"]);
  assert.deepEqual(cycleLanePeekLines({ kind: "lane", name: "Painted lane" }), ["Painted lane"]);
  assert.deepEqual(cycleLanePeekLines({}), []);
});
