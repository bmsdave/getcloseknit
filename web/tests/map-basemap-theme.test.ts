import assert from "node:assert/strict";
import test from "node:test";

import type { Map as MapLibreMap } from "maplibre-gl";

import { applyBasemapTheme, BASEMAP_PALETTES, BUILDING_EXTRUSION_OPACITY, basemapRole } from "../src/lib/map-basemap-theme";
import { BOROUGH_LABEL_LAYER_ID } from "../src/lib/map-area-labels";
import { MY_PLACE_GLYPH, myPlacePinMarkup, placeKind } from "../src/lib/place-yarn";

test("positron layers get a palette role by type and id", () => {
  assert.equal(basemapRole("background", "background"), "bg");
  assert.equal(basemapRole("fill", "water"), "water");
  assert.equal(basemapRole("fill", "landcover_wood"), "park");
  assert.equal(basemapRole("fill", "park"), "park");
  assert.equal(basemapRole("fill", "building"), "building");
  assert.equal(basemapRole("line", "waterway"), "water");
  assert.equal(basemapRole("line", "railway_transit"), "rail");
  assert.equal(basemapRole("line", "boundary_2"), "boundary");
  assert.equal(basemapRole("line", "highway_major_casing"), "casing");
  assert.equal(basemapRole("line", "highway_motorway_inner"), "major");
  assert.equal(basemapRole("line", "highway_minor"), "road");
  assert.equal(basemapRole("symbol", "place_city"), null);
});

function fakeMap(layers: { id: string; type: string; source?: string }[], failing = new Set<string>()) {
  const paints: Record<string, Record<string, unknown>> = {};
  const map = {
    getStyle: () => ({ layers }),
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    setPaintProperty(id: string, property: string, value: unknown) {
      if (failing.has(id) || !layers.some((layer) => layer.id === id)) throw new Error(`no layer ${id}`);
      (paints[id] ??= {})[property] = value;
    },
  };
  return { map: map as unknown as MapLibreMap, paints };
}

test("night recolours the basemap and the area names but never the app's data layers", () => {
  const { map, paints } = fakeMap([
    { id: "background", type: "background" },
    { id: "water", type: "fill", source: "openmaptiles" },
    { id: "highway_minor", type: "line", source: "openmaptiles" },
    { id: "place_city", type: "symbol", source: "openmaptiles" },
    { id: "broken", type: "line", source: "openmaptiles" },
    { id: "area-fill-lsoa", type: "fill", source: "area-tiles-lsoa" },
    { id: "area-outline-lsoa", type: "line", source: "area-tiles-lsoa" },
    { id: "match-brief-route-line", type: "line", source: "match-brief-lines" },
    { id: "sale-pins", type: "circle", source: "sales" },
    { id: BOROUGH_LABEL_LAYER_ID, type: "symbol", source: "area-labels" },
  ], new Set(["broken"]));
  const night = BASEMAP_PALETTES.night;
  applyBasemapTheme(map, "night");
  assert.equal(paints.background["background-color"], night.bg);
  assert.equal(paints.water["fill-color"], night.water);
  assert.equal(paints.highway_minor["line-color"], night.road);
  assert.deepEqual(paints.place_city, { "text-color": night.label, "text-halo-color": night.halo });
  assert.equal(paints["area-fill-lsoa"], undefined);
  assert.equal(paints["area-outline-lsoa"], undefined);
  assert.equal(paints["match-brief-route-line"], undefined);
  assert.equal(paints["sale-pins"], undefined);
  assert.equal(paints[BOROUGH_LABEL_LAYER_ID]["text-halo-color"], "#16203a");
});

test("v4 Task 29: by Night the road-number shields (white plates) fade out, by paint only; by Day they show", () => {
  const { map, paints } = fakeMap([
    { id: "highway-shield-non-us", type: "symbol", source: "openmaptiles" },
    { id: "highway-name-major", type: "symbol", source: "openmaptiles" },
  ]);
  applyBasemapTheme(map, "night");
  assert.equal(paints["highway-shield-non-us"]["icon-opacity"], 0);
  assert.equal(paints["highway-shield-non-us"]["text-opacity"], 0);
  assert.equal(paints["highway-name-major"]["text-opacity"], undefined, "road names stay");
  applyBasemapTheme(map, "day");
  assert.equal(paints["highway-shield-non-us"]["icon-opacity"], 1);
});

test("a style without basemap layers (the test fixture) is left as it is", () => {
  const { map, paints } = fakeMap([{ id: "area-fill-lsoa", type: "fill", source: "area-tiles-lsoa" }]);
  assert.doesNotThrow(() => applyBasemapTheme(map, "day"));
  assert.deepEqual(paints, {});
});

/** Evaluates the road opacity: a linear zoom interpolation whose stops may match on the road's class. */
function opacityAt(expression: unknown, zoom: number, roadClass: string): number {
  const value = (output: unknown): number => {
    if (typeof output === "number") return output;
    const [op, , ...rest] = output as unknown[];
    assert.equal(op, "match");
    for (let i = 0; i < rest.length - 1; i += 2) {
      const labels = rest[i];
      if (Array.isArray(labels) ? labels.includes(roadClass) : labels === roadClass) return value(rest[i + 1]);
    }
    return value(rest[rest.length - 1]);
  };
  if (typeof expression === "number") return expression;
  const [op, , input, ...stops] = expression as unknown[];
  assert.equal(op, "interpolate");
  assert.deepEqual(input, ["zoom"]);
  const pairs: [number, unknown][] = [];
  for (let i = 0; i < stops.length; i += 2) pairs.push([stops[i] as number, stops[i + 1]]);
  if (zoom <= pairs[0][0]) return value(pairs[0][1]);
  for (let i = 1; i < pairs.length; i += 1) {
    const [z0, a] = pairs[i - 1];
    const [z1, b] = pairs[i];
    if (zoom <= z1) return value(a) + ((zoom - z0) / (z1 - z0)) * (value(b) - value(a));
  }
  return value(pairs[pairs.length - 1][1]);
}

test("over the area colour only the big roads draw at city zoom; streets come back at street zoom", () => {
  const roads = ["highway_minor", "highway_path", "highway_major_inner", "highway_major_casing", "highway_major_subtle",
    "highway_motorway_inner", "tunnel_motorway_casing", "highway_motorway_bridge_inner"];
  const { map, paints } = fakeMap([...roads.map((id) => ({ id, type: "line", source: "openmaptiles" })),
    { id: "railway", type: "line", source: "openmaptiles" }, { id: "highway-name-major", type: "symbol", source: "openmaptiles" }]);
  for (const theme of ["day", "night"] as const) {
    applyBasemapTheme(map, theme);
    for (const id of roads) assert.ok(paints[id]["line-opacity"] !== undefined, `${id} has a road opacity`);
    const at = (id: string, zoom: number, roadClass: string) => opacityAt(paints[id]["line-opacity"], zoom, roadClass);
    // City zoom (11): motorways and trunk roads only, translucent; everything else gone.
    assert.ok(at("highway_motorway_inner", 11, "motorway") >= 0.5 && at("highway_motorway_inner", 11, "motorway") < 1);
    assert.ok(at("highway_major_inner", 11, "trunk") >= 0.4 && at("highway_major_inner", 11, "trunk") < 1);
    assert.ok(at("highway_major_subtle", 10, "trunk") >= 0.4);
    for (const roadClass of ["primary", "secondary", "tertiary"]) assert.equal(at("highway_major_inner", 11, roadClass), 0);
    assert.equal(at("highway_major_subtle", 10, "secondary"), 0);
    assert.equal(at("highway_minor", 11, "minor"), 0);
    assert.equal(at("highway_path", 11, "path"), 0);
    // Mid zoom (13): primary roads join; minor streets and lanes are a faint trace.
    assert.ok(at("highway_major_inner", 13, "primary") >= 0.6);
    assert.ok(at("highway_major_inner", 13, "secondary") <= 0.3);
    for (const roadClass of ["minor", "service", "track"]) assert.ok(at("highway_minor", 13, roadClass) <= 0.15);
    assert.ok(at("highway_path", 13, "path") <= 0.05);
    // Street zoom (16): the street map is back.
    assert.ok(at("highway_minor", 16, "minor") >= 0.85);
    assert.ok(at("highway_major_casing", 16, "secondary") >= 0.95);
    assert.ok(at("highway_path", 16, "path") >= 0.8);
  }
  assert.equal(paints.railway["line-opacity"], undefined);
  assert.equal(paints["highway-name-major"]["text-opacity"], undefined);
});

test("3D buildings let the area colour through: they follow the theme and stay translucent", () => {
  const { map, paints } = fakeMap([{ id: "neutral-3d-buildings", type: "fill-extrusion", source: "area-buildings" }]);
  applyBasemapTheme(map, "night");
  assert.equal(paints["neutral-3d-buildings"]["fill-extrusion-color"], BASEMAP_PALETTES.night.building);
  assert.equal(paints["neutral-3d-buildings"]["fill-extrusion-opacity"], BUILDING_EXTRUSION_OPACITY);
  assert.ok(BUILDING_EXTRUSION_OPACITY <= 0.5, "most of the area colour shows through a building");
});

test("a place's yarn colour is its type, never its score", () => {
  assert.equal(placeKind("Work"), "work");
  assert.equal(placeKind("Sam's office"), "work");
  assert.equal(placeKind("Kids' school"), "school");
  assert.equal(placeKind("Gym"), "gym");
  assert.equal(placeKind("Mum's"), "family");
  assert.equal(placeKind("Friends"), "family");
  assert.equal(placeKind("Allotment"), "other");
  // v4 Task 20: an ink pin with the type's glyph, never a cherry / sun / tangerine dot.
  assert.deepEqual(MY_PLACE_GLYPH, { work: "briefcase", school: "school", gym: "barbell", family: "family", other: "heart" });
  const pin = myPlacePinMarkup("Gym");
  assert.match(pin, /data-kind="gym"/);
  assert.match(pin, /fill="#22252c"/);
  assert.doesNotMatch(pin, /#e2453c|#f6c445|#f28b30/);
});
