import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Map as MapLibreMap } from "maplibre-gl";

import { applyBasemapTheme, basemapPaint, BASEMAP_PALETTES } from "../src/lib/map-basemap-theme";
import {
  ensureLandmarks, GREEN_VEIL_LAYER_FIRST, isLandmarkLayer, LANDMARK_PALETTES, landmarkPaint, landmarkVeilLayers, PARK_LABEL_LAYER, veilAnchor, WATER_VEIL_LAYER,
} from "../src/lib/map-landmarks";

function fakeMap(sources: string[]) {
  const layers: { id: string; type: string; source?: string; before?: string }[] = [];
  const layout: Record<string, unknown> = {};
  const map = {
    getSource: (id: string) => (sources.includes(id) ? {} : undefined),
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    addSource: (id: string) => { sources.push(id); },
    addLayer: (layer: { id: string; type: string; source?: string }, before?: string) => { layers.push({ ...layer, before }); },
    setLayoutProperty: (id: string, property: string, value: unknown) => { layout[`${id}.${property}`] = value; },
  };
  return { map, layers, layout };
}

test("the area colour and its veils lie over the basemap's buildings, under its streets", () => {
  // Positron's own order: under its opaque buildings the colour only showed in courtyards (street zoom).
  const positron = ["background", "park", "water", "landuse_residential", "waterway", "building",
    "tunnel_motorway_casing", "highway_path", "highway_minor", "label_city"];
  const anchor = veilAnchor((id) => positron.includes(id));
  assert.ok(anchor && positron.indexOf(anchor) > positron.indexOf("building"), `${anchor} is over the buildings`);
  assert.equal(veilAnchor((id) => ["building", "highway_minor"].includes(id)), "highway_minor");
});

test("landmarks go in only over a real basemap, once, ground under the water and veils under the buildings", () => {
  const fixture = fakeMap([]);
  ensureLandmarks(fixture.map, "http://x", "day", { ground: "water", veil: "building" });
  assert.equal(fixture.layers.length, 0, "the test fixture style has no basemap: left alone");

  const { map, layers, layout } = fakeMap(["openmaptiles"]);
  map.addLayer({ id: "park", type: "fill" });
  ensureLandmarks(map, "http://x", "day", { ground: "water", veil: "building" });
  const count = layers.length;
  ensureLandmarks(map, "http://x", "day", { ground: "water", veil: "building" });
  assert.equal(layers.length, count, "added once");
  assert.equal(layout["park.visibility"], "none", "protected areas (a World Heritage Site) are not painted as parks");
  const ground = layers.filter((l) => l.id.startsWith("ck-green-ground"));
  assert.deepEqual(ground.map((l) => l.before), ["water", "water", "water"]);
  const veils = layers.filter((l) => l.before === "building").map((l) => l.id);
  assert.equal(veils[0], GREEN_VEIL_LAYER_FIRST, "the area colour goes in under the first veil");
  assert.ok(veils.indexOf(WATER_VEIL_LAYER) > veils.indexOf(GREEN_VEIL_LAYER_FIRST), "water lies over the parks");
  assert.equal(layers.at(-1)!.id, PARK_LABEL_LAYER);
  assert.equal(layers.at(-1)!.before, undefined, "park names over the basemap's labels");
});

test("the data keeps first place: parks are a soft veil over the area colour, water nearly opaque", () => {
  for (const theme of ["day", "night"] as const) {
    const p = LANDMARK_PALETTES[theme];
    assert.ok(p.parkVeil >= 0.3 && p.parkVeil <= 0.5, "the area colour still reads through a park");
    assert.ok(p.waterVeil >= 0.8 && p.waterVeil < 1);
    const veil = landmarkVeilLayers(theme).find((l) => l.id === GREEN_VEIL_LAYER_FIRST)!;
    assert.equal((veil.paint as Record<string, unknown>)["fill-opacity"], p.parkVeil);
    assert.equal(BASEMAP_PALETTES[theme].water, p.water, "the ground's water and the veil are one blue");
    assert.equal(BASEMAP_PALETTES[theme].park, p.park);
  }
});

test("park greens are clean and fresh, never olive or deep pine", () => {
  const hsl = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return { h: (h + 360) % 360, l };
  };
  for (const theme of ["day", "night"] as const) {
    for (const colour of [LANDMARK_PALETTES[theme].park, LANDMARK_PALETTES[theme].parkEdge, LANDMARK_PALETTES[theme].parkLabel]) {
      const { h } = hsl(colour);
      assert.ok(h >= 125 && h <= 185, `${theme} ${colour} is a fresh green (hue ${h.toFixed(0)}), not olive`);
    }
  }
  assert.ok(hsl(LANDMARK_PALETTES.night.park).l > 0.15, "not deep pine at night");
});

test("the theme switch re-applies every landmark's paint, and the basemap pass leaves them alone", () => {
  const ids = [...landmarkVeilLayers("day").map((l) => l.id), PARK_LABEL_LAYER, "ck-green-ground-landcover"];
  assert.ok(ids.every(isLandmarkLayer));
  assert.ok(!isLandmarkLayer("ck-house-numbers") && !isLandmarkLayer("water"));
  const layers = [...ids.map((id) => ({ id, type: id.includes("label") ? "symbol" : "fill", source: "openmaptiles" })), { id: "water_name_line_label", type: "symbol", source: "openmaptiles" }];
  const paints: Record<string, Record<string, unknown>> = {};
  const map = {
    getStyle: () => ({ layers }), getLayer: (id: string) => layers.find((l) => l.id === id),
    setPaintProperty: (id: string, property: string, value: unknown) => { (paints[id] ??= {})[property] = value; },
  };
  applyBasemapTheme(map as unknown as MapLibreMap, "night");
  const night = LANDMARK_PALETTES.night;
  assert.equal(paints[WATER_VEIL_LAYER]["fill-color"], night.water);
  assert.equal(paints["ck-water-edge"]["line-color"], night.waterEdge, "edges keep their own colour, not the basemap's");
  assert.equal(paints[PARK_LABEL_LAYER]["text-color"], night.parkLabel);
  assert.equal(paints[PARK_LABEL_LAYER]["text-halo-color"], night.halo);
  assert.equal(paints.water_name_line_label["text-color"], night.waterLabel, "the river is named in the water's blue");
  assert.deepEqual(basemapPaint("symbol", "place_city", BASEMAP_PALETTES.day)[0], ["text-color", BASEMAP_PALETTES.day.label]);
  assert.ok(landmarkPaint("day").length > 10);
});

test("the big parks are named from the opening zoom, the rest by size", () => {
  const parks = JSON.parse(readFileSync(new URL("../public/park-labels.json", import.meta.url), "utf8")) as {
    features: { properties: { name: string; minzoom: number; rank: number }; geometry: { coordinates: [number, number] } }[];
  };
  const byName = new Map(parks.features.map((f) => [f.properties.name, f]));
  for (const name of ["Hyde Park", "Regent's Park", "Hampstead Heath", "Richmond Park", "Victoria Park", "Greenwich Park"]) {
    assert.equal(byName.get(name)?.properties.minzoom, 11, `${name} from zoom 11`);
  }
  assert.ok(parks.features.length >= 30);
  for (const { properties, geometry: { coordinates: [lon, lat] } } of parks.features) {
    assert.ok(lon > -0.52 && lon < 0.34 && lat > 51.28 && lat < 51.7, `${properties.name} is in London`);
    assert.ok([11, 12, 13].includes(properties.minzoom));
  }
  const hyde = byName.get("Hyde Park")!.geometry.coordinates;
  assert.ok(Math.abs(hyde[0] + 0.165) < 0.01 && Math.abs(hyde[1] - 51.508) < 0.01, "Hyde Park where it is");
});
