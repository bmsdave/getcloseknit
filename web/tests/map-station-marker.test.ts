import assert from "node:assert/strict";
import test from "node:test";

import {
  drawStationMarker, ringSegments, STATION_MARKER_PX, STATION_MARKER_THEME, stationMarkerId, stationMarkerImage, stationMarkerLines, type MarkerContext,
} from "../src/lib/map-station-marker";
import { applyTransitTheme, ensureTransit, LINE_COLOURS, putStationMarker, stationColours } from "../src/lib/map-transit";

/** A 2D context that records each ring arc drawn with its stroke colour. */
function recorder() {
  const arcs: { colour: unknown; start: number; end: number; width: number }[] = [];
  const fills: unknown[] = [];
  let lineWidth = 0, strokeStyle: unknown = "", pending: { start: number; end: number; radius: number } | null = null;
  const context = {
    beginPath() { pending = null; }, moveTo() {}, lineTo() {},
    arc(_x: number, _y: number, radius: number, start: number, end: number) { pending = { start, end, radius }; },
    stroke() { if (pending) arcs.push({ colour: strokeStyle, start: pending.start, end: pending.end, width: lineWidth }); },
    fill() { fills.push(context.fillStyle); },
    get lineWidth() { return lineWidth; }, set lineWidth(v: number) { lineWidth = v; },
    get strokeStyle() { return strokeStyle; }, set strokeStyle(v: unknown) { strokeStyle = v; },
    fillStyle: "" as unknown, lineCap: "butt" as CanvasLineCap,
  };
  return { context: context as unknown as MarkerContext, arcs, fills };
}

test("the ring splits into one equal segment per line, clockwise from twelve o'clock", () => {
  assert.equal(ringSegments(["#E32017"]).length, 1);
  const one = ringSegments(["#E32017"])[0];
  assert.ok(Math.abs(one.end - one.start - 2 * Math.PI) < 1e-9, "a single line is a whole ring");
  const six = ringSegments(["a", "b", "c", "d", "e", "f"]);
  assert.equal(six.length, 6);
  assert.ok(Math.abs(six[0].start + Math.PI / 2) < 1e-9, "starts at the top");
  for (const [i, segment] of six.entries()) {
    assert.ok(Math.abs(segment.end - segment.start - Math.PI / 3) < 1e-9, "equal segments");
    if (i) assert.equal(segment.start, six[i - 1].end, "no gaps or overlaps");
  }
  assert.deepEqual(six.map((s) => s.colour), ["a", "b", "c", "d", "e", "f"], "in the data's order");
});

test("the marker draws each line's segment in that line's official colour, round a plain centre", () => {
  const lines = ["circle", "hammersmith-city", "metropolitan", "northern", "piccadilly", "victoria"];
  const colours = stationColours(lines, "day");
  assert.deepEqual(colours, ["#FFC80A", "#F589A6", "#9B0058", "#22252c", "#0019A8", "#039BE5"]);
  const { context, arcs, fills } = recorder();
  drawStationMarker(context, colours, STATION_MARKER_PX * 2, "day");
  const ring = arcs.filter((arc) => arc.end - arc.start < 2 * Math.PI - 1e-9);
  assert.deepEqual(ring.map((arc) => arc.colour), colours, "one ring segment per line, in its colour");
  assert.deepEqual(fills, [STATION_MARKER_THEME.day.centre], "a white centre by day (never the roundel's bar)");
  const night = recorder();
  drawStationMarker(night.context, stationColours(["northern"], "night"), STATION_MARKER_PX, "night");
  assert.equal(night.arcs.filter((arc) => arc.colour === "#eef3f8").length, 1, "the Northern line turns light at night");
  assert.deepEqual(night.fills, [STATION_MARKER_THEME.night.centre]);
});

test("marker ids name the station's lines and read back", () => {
  assert.equal(stationMarkerId("central,northern"), "ck-station-central,northern");
  assert.equal(stationMarkerId(["central", "northern"]), "ck-station-central,northern");
  assert.deepEqual(stationMarkerLines("ck-station-central,northern"), ["central", "northern"]);
  assert.equal(stationMarkerLines("ck-ball-victoria-1"), null, "other images are not ours");
  assert.equal(stationMarkerLines("ck-station-"), null);
  assert.equal(stationMarkerImage(["#E32017"], "day", 2), null, "no canvas outside a browser");
  assert.ok(Object.keys(LINE_COLOURS).length >= 20);
});

test("markers are drawn on demand per line combination, cached, and redrawn when the theme changes", () => {
  // A stand-in canvas: the drawing is recorded, the pixels are a blank box of the right size.
  const drawn: unknown[][] = [];
  const document = { createElement: () => ({ width: 0, height: 0, getContext() {
    const { context, arcs } = recorder();
    drawn.push(arcs);
    return Object.assign(context, { getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) });
  } }) };
  Object.assign(globalThis, { document });
  try {
    const images = new Map<string, { width: number }>(), updated: string[] = [];
    const hook: { resolve?: (id: string) => void } = {};
    let layers = 0;
    const map = {
      getSource: () => undefined, getLayer: () => (layers ? {} : undefined),
      addSource() {}, addLayer() { layers++; }, setPaintProperty() {},
      hasImage: (id: string) => images.has(id),
      addImage: (id: string, image: { width: number }) => { images.set(id, image); },
      updateImage: (id: string, image: { width: number }) => { images.set(id, image); updated.push(id); },
      setMissingStyleImageResolver(next: (id: string) => void) { hook.resolve = next; },
    };
    ensureTransit(map, "http://x", "day", 2);
    assert.ok(hook.resolve, "the map asks the transit layer for missing markers");
    hook.resolve!("ck-station-central,northern");
    hook.resolve!("ck-station-dlr");
    hook.resolve!("ck-ball-victoria-1");
    assert.deepEqual([...images.keys()], ["ck-station-central,northern", "ck-station-dlr"], "foreign ids are never claimed");
    assert.equal(images.get("ck-station-dlr")!.width, STATION_MARKER_PX * 2, "drawn at the pixel ratio");
    const draws = drawn.length;
    putStationMarker(map, "ck-station-central,northern", "day", 2);
    assert.equal(drawn.length, draws, "a line combination is drawn once per theme and ratio");
    updated.length = 0;
    applyTransitTheme(map, "night");
    assert.deepEqual(updated.sort(), ["ck-station-central,northern", "ck-station-dlr"], "every marker drawn so far is redrawn for the night");
    assert.equal(drawn.length, draws + 2);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});
