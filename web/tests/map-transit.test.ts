import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { areaFillFade, STREET_FILL_SCALE, zoomFillScale } from "../src/lib/map-property-layers";
import { TRANSIT_LINE_LAYER, TRANSIT_STATION_LAYER, transitLayers } from "../src/lib/map-transit";

const network = JSON.parse(readFileSync(new URL("../public/tfl-network.json", import.meta.url), "utf8")) as {
  features: { properties: { kind: string; line?: string; colour: string; name: string; interchange?: boolean; offset?: number } }[];
};

test("the network carries every TfL rail line in its own colour, and its stations", async () => {
  const { LINE_COLOURS } = await import("../src/lib/map-transit");
  const lines = network.features.filter((f) => f.properties.kind === "line");
  assert.equal(new Set(lines.map((f) => f.properties.line)).size, 20);
  for (const f of lines) assert.equal(f.properties.colour, LINE_COLOURS[f.properties.line!], `${f.properties.line} in its TfL colour`);
  const colour = Object.fromEntries(lines.map((f) => [f.properties.line, f.properties.colour]));
  assert.equal(colour.victoria, "#039BE5");
  assert.equal(colour.central, "#DC241F");
  assert.equal(colour.elizabeth, "#60399E");
  const stations = network.features.filter((f) => f.properties.kind === "station");
  assert.ok(stations.length > 400, `${stations.length} stations`);
  assert.ok(stations.some((s) => s.properties.name === "Oxford Circus" && s.properties.interchange));
  assert.ok(stations.every((s) => !/Underground Station$/.test(s.properties.name)), "names read like the map, not the register");
});

test("the app and the build use one colour table: TfL's Colour standard (Issue 11), screen values", async () => {
  const { LINE_COLOURS } = await import("../src/lib/map-transit");
  // @ts-expect-error: a plain .mjs build script
  const { LINES } = await import("../scripts/tfl-network.mjs");
  assert.deepEqual(LINE_COLOURS, Object.fromEntries(Object.entries(LINES as Record<string, [string, string]>).map(([line, [, colour]]) => [line, colour])));
  // Spot checks against the standard's RGB: Piccadilly 0 25 168, Jubilee 131 141 147, Hammersmith & City 245 137 166.
  assert.equal(LINE_COLOURS.piccadilly, "#0019A8");
  assert.equal(LINE_COLOURS.jubilee, "#838D93");
  assert.equal(LINE_COLOURS["hammersmith-city"], "#F589A6");
});

test("lines take their TfL colour; the Northern line turns light at night", () => {
  const line = (theme: "day" | "night") => transitLayers(theme).find((l) => l.id === TRANSIT_LINE_LAYER)!.paint as Record<string, unknown>;
  const day = JSON.stringify(line("day")["line-color"]), night = JSON.stringify(line("night")["line-color"]);
  assert.ok(day.includes('"victoria","#039BE5"') && day.includes('"northern","#22252c"'));
  assert.ok(night.includes('"northern","#eef3f8"'));
});

test("the area colour steps back to a tint as you zoom in, so the streets read through it (v4 Task 29)", () => {
  assert.equal(zoomFillScale(11), 1);
  assert.equal(zoomFillScale(12), 1);
  assert.ok(zoomFillScale(13.5) < 0.75 && zoomFillScale(13.5) > 0.65);
  assert.equal(zoomFillScale(15), STREET_FILL_SCALE);
  assert.equal(zoomFillScale(18), STREET_FILL_SCALE);
  // 0.88 observed opacity × 40%: a tint at street zoom, never a solid slab over the streets.
  assert.ok(0.88 * STREET_FILL_SCALE < 0.36);
});

test("at street zoom the fades never stack below the street tint", () => {
  // A colour-square lens (0.5) under places (0.75) at zoom 17 multiplied down to 0.13: grey ground.
  assert.equal(areaFillFade(11, []), 1);
  assert.equal(areaFillFade(17, []), STREET_FILL_SCALE);
  assert.equal(areaFillFade(17, [0.75]), STREET_FILL_SCALE);
  assert.equal(areaFillFade(17.5, [0.5, 0.75]), STREET_FILL_SCALE, "the strongest single fade wins");
  assert.equal(areaFillFade(12, [0.75]), 0.75);
});

test("the network is yarn: each line's body, twist and sheen follow its colour; stations are ring markers", async () => {
  const { transitLayers: layers, TRANSIT_TWIST_LAYER, lineColour } = await import("../src/lib/map-transit");
  const twist = layers("day").find((l) => l.id === TRANSIT_TWIST_LAYER)!.paint as Record<string, unknown>;
  assert.deepEqual(twist["line-dasharray"], [0.45, 0.6], "ply twist dashes");
  assert.equal(lineColour("northern", "night"), "#eef3f8");
  const station = layers("day").find((l) => l.id === TRANSIT_STATION_LAYER)!;
  assert.equal(station.type, "symbol");
  assert.deepEqual((station.layout as Record<string, unknown>)["icon-image"], ["concat", "ck-station-", ["get", "lines"]], "one marker per line combination");
  assert.ok(!("filter" in station && JSON.stringify(station.filter).includes("zoom")), "one rule for every station, so the outskirts are not emptier");
});

test("the basemap's night/day recolouring never greys out the TfL lines", async () => {
  const theme = await import("../src/lib/map-basemap-theme");
  const calls: string[] = [];
  const map = {
    getStyle: () => ({ layers: [{ id: TRANSIT_LINE_LAYER, type: "line", source: "tfl-network" }, { id: "railway_transit", type: "line", source: "openmaptiles" }] }),
    setPaintProperty: (id: string) => { calls.push(id); }, getLayer: () => undefined,
  };
  theme.applyBasemapTheme(map as never, "night");
  assert.deepEqual(calls, ["railway_transit"]);
});

test("lines are continuous threads: smoothed, yet through every station", async () => {
  // @ts-expect-error: a plain .mjs build script
  const { smoothLine } = await import("../scripts/tfl-network.mjs");
  const hops = [[0, 0], [1, 0], [1, 1], [2, 1]];
  const curve = smoothLine(hops) as number[][];
  assert.ok(curve.length > hops.length * 3, "bends instead of straight hops");
  for (const point of hops) assert.ok(curve.some((c) => c[0] === point[0] && c[1] === point[1]), `passes through ${point}`);
  assert.ok(curve.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])));
  // Every line with a bend is smoothed (Waterloo & City is two stations: a straight run is right).
  const features = network.features.filter((f) => f.properties.kind === "line" && f.properties.line !== "waterloo-city") as unknown as { properties: { line: string }; geometry: { coordinates: number[][][] } }[];
  for (const line of new Set(features.map((f) => f.properties.line))) {
    const runs = features.filter((f) => f.properties.line === line).flatMap((f) => f.geometry.coordinates);
    assert.ok(runs.flat().length > runs.length * 6, `the shipped ${line} line is smoothed`);
  }
});

type LineFeature = { properties: { line: string; offset: number }; geometry: { coordinates: number[][][] } };
const hopKeys = (runs: number[][][]) => runs.flatMap((run) => run.slice(1).map((p, i) => [run[i], p].map(String).sort().join("|")));

test("each stretch of track is drawn once per line, and shared track side by side, never stacked", async () => {
  // @ts-expect-error: a plain .mjs build script
  const { sharedStretches, lineFeatures } = await import("../scripts/tfl-network.mjs");
  // Circle and Hammersmith & City share a trunk (listed both ways, as TfL does); Circle then branches off.
  const trunk = [[0, 0], [0.01, 0], [0.02, 0]];
  const stretches = sharedStretches([
    ["circle", [trunk, [...trunk].reverse(), [...trunk, [0.03, 0.01]]]],
    ["hammersmith-city", [trunk, [...trunk, [0.03, -0.01]]]],
  ]) as { lines: string[]; points: number[][] }[];
  assert.deepEqual(stretches.map((s) => s.lines.join(",")).sort(), ["circle", "circle,hammersmith-city", "hammersmith-city"]);
  const features = lineFeatures(stretches) as LineFeature[];
  const lane = (line: string) => features.filter((f) => f.properties.line === line).map((f) => f.properties.offset).sort();
  assert.deepEqual(lane("circle"), [-0.5, 0], "Circle takes the left lane on the trunk, the middle on its own");
  assert.deepEqual(lane("hammersmith-city"), [0, 0.5]);
  // The shipped network: a line never draws a hop twice, and two lines on one hop are in different lanes.
  const shipped = network.features.filter((f) => f.properties.kind === "line") as unknown as LineFeature[];
  const lanes = new Map<string, Set<number>>();
  for (const line of new Set(shipped.map((f) => f.properties.line))) {
    const keys = shipped.filter((f) => f.properties.line === line).flatMap((f) => hopKeys(f.geometry.coordinates));
    assert.equal(new Set(keys).size, keys.length, `${line} draws each stretch once`);
  }
  for (const f of shipped) for (const k of hopKeys(f.geometry.coordinates)) {
    const taken = lanes.get(k) ?? new Set();
    assert.ok(!taken.has(f.properties.offset), `${f.properties.line} has a lane of its own at ${k}`);
    lanes.set(k, taken.add(f.properties.offset));
  }
  // Shared stretches the TfL map shows as parallel lines.
  const sharing = (a: string, b: string) => {
    const keys = (line: string) => new Set(shipped.filter((f) => f.properties.line === line).flatMap((f) => hopKeys(f.geometry.coordinates)));
    const kb = keys(b);
    return [...keys(a)].filter((k) => kb.has(k)).length;
  };
  assert.ok(sharing("circle", "metropolitan") >= 7, "Circle and Metropolitan, Baker Street to Aldgate");
  assert.ok(sharing("hammersmith-city", "metropolitan") >= 6, "Hammersmith & City and Metropolitan, Baker Street to Liverpool Street");
  assert.ok(sharing("district", "piccadilly") >= 3, "District and Piccadilly, Hammersmith to Acton Town");
  assert.ok(sharing("bakerloo", "lioness") >= 10, "Bakerloo and Lioness, Queen's Park to Harrow & Wealdstone (TfL lists their stops metres apart)");
  assert.ok(sharing("district", "hammersmith-city") >= 8, "District and Hammersmith & City, Aldgate East to Barking");
});

test("the network recedes zoomed out and comes forward as you zoom in", async () => {
  const { TRANSIT_REVEAL, TRANSIT_CASING_LAYER } = await import("../src/lib/map-transit");
  const strengths = TRANSIT_REVEAL.map(([, strength]) => strength);
  assert.ok(strengths.every((s, i) => i === 0 || s > strengths[i - 1]), "rises with zoom");
  assert.ok(strengths[0] <= 0.25 && strengths.at(-1) === 1, "faint across the city, full at street level");
  for (const theme of ["day", "night"] as const) {
    for (const layer of transitLayers(theme)) {
      const paint = layer.paint as Record<string, unknown>;
      const opacity = layer.type === "symbol" ? [paint["icon-opacity"], paint["text-opacity"]] : [paint["line-opacity"]];
      for (const value of opacity) assert.deepEqual((value as unknown[]).slice(0, 3), ["interpolate", ["linear"], ["zoom"]], `${layer.id} fades by zoom`);
    }
  }
  const casing = transitLayers("day").find((l) => l.id === TRANSIT_CASING_LAYER)!.paint as Record<string, unknown>;
  assert.deepEqual(casing["line-opacity"], ["interpolate", ["linear"], ["zoom"], 9, 0.12, 11, 0.2, 12, 0.44, 13, 0.68, 14.5, 0.8], "a layer keeps its own strength");
  // Stations ride the same zoom stops, stronger, so a marker is findable (not loud) at the opening zoom 11.
  const stations = transitLayers("day").find((l) => l.id === TRANSIT_STATION_LAYER)!.paint as Record<string, unknown>;
  assert.deepEqual(stations["icon-opacity"], ["interpolate", ["linear"], ["zoom"], 9, 0.24, 11, 0.4, 12, 0.88, 13, 1, 14.5, 1]);
});

type Station = { properties: { kind: string; id: string; name: string; lines: string; line: string; interchange: boolean }; geometry: { coordinates: number[] } };
const stations = (network.features as unknown as Station[]).filter((f) => f.properties.kind === "station");

test("every station carries each line that calls there, Tube lines first", async () => {
  const { LINE_COLOURS } = await import("../src/lib/map-transit");
  const lines = (name: string) => stations.find((s) => s.properties.name === name)?.properties.lines.split(",");
  for (const station of stations) {
    const list = station.properties.lines.split(",");
    assert.ok(list.length > 0 && list.every((line) => line in LINE_COLOURS), `${station.properties.name}: ${list}`);
    assert.equal(new Set(list).size, list.length, `${station.properties.name} lists a line once`);
    assert.equal(station.properties.line, list[0], "the main line is the first");
    assert.equal(station.properties.interchange, list.length > 1);
  }
  assert.deepEqual(lines("King's Cross & St Pancras International"), ["circle", "hammersmith-city", "metropolitan", "northern", "piccadilly", "victoria"]);
  assert.deepEqual(lines("Stratford"), ["central", "jubilee", "elizabeth", "dlr", "mildmay"]);
  assert.deepEqual(lines("Highbury & Islington"), ["victoria", "mildmay", "windrush"], "Overground lines join the Tube's");
  assert.deepEqual(lines("Canary Wharf"), ["jubilee", "elizabeth", "dlr"]);
  // The big interchanges, every line that calls there.
  assert.deepEqual(lines("Bank"), ["central", "northern", "waterloo-city", "dlr"]);
  assert.deepEqual(lines("Monument"), ["circle", "district"], "Bank and Monument are two stations in TfL's data");
  assert.deepEqual(lines("Baker Street"), ["bakerloo", "circle", "hammersmith-city", "jubilee", "metropolitan"]);
  assert.deepEqual(lines("Whitechapel"), ["district", "hammersmith-city", "elizabeth", "windrush"]);
  assert.deepEqual(lines("Liverpool Street"), ["central", "circle", "hammersmith-city", "metropolitan", "elizabeth", "weaver"]);
  assert.deepEqual(lines("Paddington"), ["bakerloo", "circle", "district", "hammersmith-city", "elizabeth"]);
  assert.deepEqual(lines("Canada Water"), ["jubilee", "windrush"]);
  // Every mode the map draws has its stations.
  for (const line of ["elizabeth", "dlr", "mildmay", "windrush", "liberty", "lioness", "suffragette", "weaver"]) {
    assert.ok(stations.some((s) => s.properties.lines.split(",").includes(line)), `${line} has stations`);
  }
});

test("the build merges a station's lines across routes, in the order lines are walked", async () => {
  // @ts-expect-error: a plain .mjs build script
  const { addRouteStations, stationFeature } = await import("../scripts/tfl-network.mjs");
  const stops = new Map();
  const bank = { id: "HUBBAN", name: "Bank Underground Station", lon: -0.0886, lat: 51.5133 };
  addRouteStations(stops, [bank, { id: "940GZZLUSPU", name: "St. Paul's Underground Station", lon: -0.0976, lat: 51.5146 }], "central");
  addRouteStations(stops, [bank, bank], "northern");
  addRouteStations(stops, [{ ...bank, name: "Bank DLR Station" }], "dlr");
  const feature = stationFeature("HUBBAN", stops.get("HUBBAN"));
  assert.equal(feature.properties.name, "Bank");
  assert.equal(feature.properties.lines, "central,northern,dlr");
  assert.equal(feature.properties.rank, 1, "three or more lines rank first");
  assert.equal(stationFeature("940GZZLUSPU", stops.get("940GZZLUSPU")).properties.interchange, false);
  // The shipped stations are exactly what the build makes of them.
  for (const station of stations.slice(0, 60)) {
    const [lon, lat] = station.geometry.coordinates;
    const rebuilt = stationFeature(station.properties.id, { name: station.properties.name, lon, lat, lines: station.properties.lines.split(",") });
    assert.deepEqual(rebuilt, station);
  }
});

test("an interchange's marker sits where its lines pass, not on TfL's hub point", () => {
  const metres = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 69400, (a[1] - b[1]) * 111300);
  const shipped = network.features.filter((f) => f.properties.kind === "line") as unknown as LineFeature[];
  const nearest = (p: number[], line: string) => Math.min(...shipped.filter((f) => f.properties.line === line).flatMap((f) => f.geometry.coordinates.flat()).map((c) => metres(p, c)));
  const at = (name: string) => stations.find((s) => s.properties.name === name)!;
  // King's Cross: TfL's hub point is the main-line station, ~110 m north of the Tube platforms.
  assert.ok(metres(at("King's Cross & St Pancras International").geometry.coordinates, [-0.123194, 51.530663]) < 15);
  // Custom House: the hub point is a kilometre north of the platforms.
  assert.ok(metres(at("Custom House").geometry.coordinates, [0.0267, 51.50974]) < 15);
  for (const name of ["King's Cross & St Pancras International", "Baker Street", "Stratford", "Canada Water", "Highbury & Islington", "Custom House", "Blackfriars"]) {
    const station = at(name);
    for (const line of station.properties.lines.split(",")) assert.ok(nearest(station.geometry.coordinates, line) < 20, `${name} on the ${line} line`);
  }
});
