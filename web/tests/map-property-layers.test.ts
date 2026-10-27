import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createExpression, latest, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

import { METRICS } from "../src/lib/fixtures";
import {
  areaFadedUnderHouses,
  areaFillOpacityWithParcels,
  BLOCK_FILL_STRENGTH,
  blockColour,
  blocksShown,
  DEFAULT_SOLD_RAMP,
  dwellingFromFeature,
  homePaint,
  hoverTarget,
  NEUTRAL_LINE,
  opacityOverZoom,
  parcelsShown,
  PROPERTY_ATTRIBUTION,
  propertyLayers,
  propertyLayersApply,
  propertySource,
  SELECTED_OUTLINE_COLOUR,
  SHARED_PARCEL_AREA,
  SOLD_BANDS,
  SOLD_BANDS_LEGEND,
  soldBandColour,
  STREET_FILL_SCALE,
  tooltipLines,
} from "../src/lib/map-property-layers";
import { paletteById, paletteRamp, sampleRamp } from "../src/lib/palettes";

const price = METRICS.find((metric) => metric.id === "price-per-square-metre")!;

/** A paint value as MapLibre evaluates it for one feature in one hover/selection state, at house zoom. */
function evaluate(type: "fill" | "line" | "circle", property: string, value: unknown, properties: Record<string, unknown>,
  featureState: Record<string, boolean> = {}): unknown {
  const spec = (latest as unknown as Record<string, Record<string, unknown>>)[`paint_${type}`][property];
  const expression = createExpression(value, spec as never);
  if (expression.result !== "success") throw new Error(JSON.stringify(expression.value));
  return expression.value.evaluate({ zoom: 16 } as never, { type: "Polygon", properties } as never, featureState);
}

test("only the price layer gets a house-level map (stock value is merged into it)", () => {
  assert.equal(propertyLayersApply("price-per-square-metre"), true);
  assert.equal(propertyLayersApply("stock-value-per-square-metre"), false);
  assert.equal(propertyLayersApply("crime"), false);
  assert.equal(propertyLayersApply("personal-match"), false);
});

test("street blocks bridge zoom 12-14 and parcels take over from 15", () => {
  assert.equal(blocksShown("price-per-square-metre", 12), true);
  assert.equal(blocksShown("price-per-square-metre", 14.9), true);
  assert.equal(blocksShown("price-per-square-metre", 15), false);
  assert.equal(blocksShown("price-per-square-metre", 11.5), false);
  assert.equal(parcelsShown("price-per-square-metre", 15), true);
  assert.equal(parcelsShown("price-per-square-metre", 16.5), true);
  assert.equal(parcelsShown("price-per-square-metre", 14.9), false);
  assert.equal(parcelsShown("crime", 17), false);
  assert.match(PROPERTY_ATTRIBUTION, /reproduced with the permission of HM Land Registry/);
  assert.match(PROPERTY_ATTRIBUTION, /Ordnance Survey 100026316/);
});

test("the map and the methodology guide carry DATA-LICENCES.md's INSPIRE statement verbatim", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const row = readFileSync(join(root, "DATA-LICENCES.md"), "utf8").split("\n")
    .find((line) => line.startsWith("| INSPIRE Index Polygons |"));
  const statement = row?.match(/Verbatim, unaltered: "([^"]+)"/)?.[1];
  assert.ok(statement, "DATA-LICENCES.md has the INSPIRE row with its verbatim statement");
  assert.ok(PROPERTY_ATTRIBUTION.startsWith(statement), "map statement starts with the INSPIRE statement");
  // The guide's stock-value article (/guide/stock-value, formerly /methodology) wraps the text across JSX lines.
  const guide = readFileSync(join(root, "web", "src", "components", "guide", "articles.tsx"), "utf8")
    .replace(/\s+/g, " ");
  assert.ok(guide.includes(statement), "guide article carries the INSPIRE statement");
});

test("at house zoom a sold home takes its last sale's coarse band; others stay clear over their area's colour", () => {
  const colour = blockColour(price) as unknown[];
  assert.equal(colour[0], "case");
  assert.deepEqual(colour[1], ["==", ["get", "ppm"], null]);
  const ramp = colour[3] as unknown[];
  assert.equal(ramp[0], "interpolate");
  assert.deepEqual(ramp[2], ["ln", ["max", 1, ["to-number", ["get", "ppm"]]]]);
  assert.deepEqual(ramp.slice(3, 5), [Math.log(4000), "#2a6f97"]);
  assert.deepEqual(ramp.slice(-2), [Math.log(12000), "#c44536"]);
  const layers = propertyLayers(price);
  assert.match(JSON.stringify(layers[0].paint), /\["get","ppm"\]/, "street blocks: their median");
  assert.match(JSON.stringify(layers[1].paint), /\["get","ppm"\]/, "street block edges: their median");
  // Never a home's own £/m² or a value today: only the coarse band of its recorded sale.
  for (const layer of layers.slice(2)) {
    assert.doesNotMatch(JSON.stringify(layer.paint), /"sppm"|"ppm"|"value"|"percentile"/, `${layer.id}: no figure of its own`);
  }
  const state = (selected: number, hover: number, base: number) => ["case",
    ["boolean", ["feature-state", "selected"], false], selected,
    ["boolean", ["feature-state", "hover"], false], hover, base];
  const sold = ["!=", ["get", "band"], null];
  const parcel = layers[2].paint as Record<string, unknown>;
  assert.deepEqual(parcel["fill-color"], ["case", sold, soldBandColour(DEFAULT_SOLD_RAMP), SELECTED_OUTLINE_COLOUR]);
  const opacity = (properties: Record<string, unknown>, featureState: Record<string, boolean> = {}) =>
    evaluate("fill", "fill-opacity", parcel["fill-opacity"], properties, featureState);
  assert.deepEqual([opacity({ band: 3 }), opacity({ band: 3 }, { hover: true }), opacity({ band: 3 }, { selected: true })], [0.8, 0.95, 0.95],
    "a sold home is filled by its band");
  assert.deepEqual([opacity({}), opacity({}, { hover: true }), opacity({}, { selected: true })], [0, 0.2, 0.35],
    "any other is clear unless hovered or chosen");
  const dwelling = layers[4].paint as Record<string, unknown>;
  assert.deepEqual(dwelling["circle-color"], ["case", sold, soldBandColour(DEFAULT_SOLD_RAMP), SELECTED_OUTLINE_COLOUR]);
  assert.deepEqual(dwelling["circle-opacity"], ["case", sold, state(1, 1, 0.9), state(0.9, 0.6, 0)], "a ring unless sold, hovered or chosen");
});

test("sold bands: six coarse bands, low to high, in the chosen palette's price ramp (cheap is good)", () => {
  assert.deepEqual(SOLD_BANDS, ["Bottom 10%", "Bottom quarter", "Lower middle", "Upper middle", "Top quarter", "Top 10%"]);
  assert.equal(SOLD_BANDS_LEGEND, "Sold homes: where the last sale sat among similar homes sold here that year");
  // v4 Task 43: the default palette is colour-blind safe, cheap blue to dear red.
  const standard = sampleRamp(paletteRamp(paletteById("colour-blind"), "price-per-square-metre"), 6);
  assert.deepEqual(DEFAULT_SOLD_RAMP, standard);
  assert.equal(standard[0], "#2166ac", "the bottom 10% is the palette's good end");
  const blind = sampleRamp(paletteRamp(paletteById("colour-blind"), "price-per-square-metre"), 6);
  assert.deepEqual(soldBandColour(blind), ["match", ["to-number", ["get", "band"]],
    0, blind[0], 1, blind[1], 2, blind[2], 3, blind[3], 4, blind[4], 5, blind[5], "rgba(0, 0, 0, 0)"]);
  const paint = homePaint({ ramp: blind, theme: "night" });
  assert.match(JSON.stringify(paint["parcel-fill"]["fill-color"]), new RegExp(blind[5]));
  assert.match(JSON.stringify(paint["dwelling-point"]["circle-color"]), new RegExp(blind[0]));
});

test("parcel outlines and rings are a subtle neutral ink in Day and Night; only hover and choice are cobalt", () => {
  assert.deepEqual(NEUTRAL_LINE, { day: "#22252c", night: "#f4f7fa" }, "the --ink token of each theme");
  for (const theme of ["day", "night"] as const) {
    const paint = homePaint({ ramp: DEFAULT_SOLD_RAMP, theme });
    const expected: unknown[] = ["case", ["boolean", ["feature-state", "selected"], false], SELECTED_OUTLINE_COLOUR,
      ["boolean", ["feature-state", "hover"], false], SELECTED_OUTLINE_COLOUR, NEUTRAL_LINE[theme]];
    assert.deepEqual(paint["parcel-outline"]["line-color"], expected);
    assert.deepEqual(paint["dwelling-point"]["circle-stroke-color"], expected);
  }
  const layers = propertyLayers(price, { ramp: DEFAULT_SOLD_RAMP, theme: "night" });
  const outline = layers[3].paint as Record<string, unknown>;
  assert.deepEqual((outline["line-color"] as unknown[]).at(-1), "#f4f7fa");
  const opacity = (state: Record<string, boolean>) => evaluate("line", "line-opacity", outline["line-opacity"], { dwellings: 1 }, state);
  assert.deepEqual([opacity({}), opacity({ hover: true }), opacity({ selected: true })], [0.3, 0.9, 1]);
});

// #31: some Land Registry titles cover a whole estate. Hovering or choosing a home on one must
// not light the estate up: the parcel keeps a faint outline and the home is marked on its own.
test("a parcel wider than one home (several homes, or a title over 2,500 m²) never lights up on hover or choice", () => {
  assert.equal(SHARED_PARCEL_AREA, 2500, "beyond the largest 0.2% of one-home parcels (p99 ≈ 1,080 m², p99.5 ≈ 1,520 m²)");
  const [, , fill, outline] = propertyLayers(price).map((layer) => layer.paint as Record<string, unknown>);
  const one = { dwellings: 1, area: 320 };
  const oldTile = { dwellings: 1 };
  const estate = { dwellings: 3, area: 61_000 };
  const flats = { dwellings: 4, area: 210 };
  const wideTitle = { dwellings: 1, area: 40_000 };
  for (const [state, tint] of [[{}, 0], [{ hover: true }, 0.2], [{ selected: true }, 0.35]] as const) {
    const opacity = (properties: Record<string, unknown>) => evaluate("fill", "fill-opacity", fill["fill-opacity"], properties, state);
    assert.equal(opacity(one), tint, "a one-home plot is tinted as the home");
    assert.equal(opacity(oldTile), tint, "a tile without areas keeps the one-home rule");
    for (const shared of [estate, flats, wideTitle]) assert.equal(opacity(shared), 0, `${JSON.stringify(shared)}: never filled`);
    // A sold home on a wide title keeps its band but does not brighten the whole title.
    assert.equal(evaluate("fill", "fill-opacity", fill["fill-opacity"], { ...wideTitle, band: 2 }, state), 0.8);
  }
  const line = (property: string, properties: Record<string, unknown>, state: Record<string, boolean>) =>
    evaluate("line", property, outline[property], properties, state) as number;
  for (const shared of [estate, wideTitle]) {
    assert.ok(line("line-width", shared, { selected: true }) <= 1.4, "chosen: a faint outline, not the 3px ring of a home");
    assert.ok(line("line-width", shared, { hover: true }) <= 1.2);
    assert.ok(line("line-opacity", shared, { selected: true }) <= 0.75);
  }
  assert.equal(line("line-width", one, { selected: true }), 3);
});

/** A block's fill opacity as MapLibre evaluates it at one zoom. */
function blockOpacity(value: unknown, zoom: number, properties: Record<string, unknown>): number {
  const spec = (latest as unknown as Record<string, Record<string, unknown>>).paint_fill["fill-opacity"];
  const expression = createExpression(value, spec as never);
  if (expression.result !== "success") throw new Error(JSON.stringify(expression.value));
  return expression.value.evaluate({ zoom } as never, { type: "Polygon", properties } as never, {}) as number;
}

test("street blocks without a median are clear, so the area fill shows through them", () => {
  const [block, edge] = propertyLayers(price).map((layer) => layer.paint as Record<string, unknown>);
  assert.equal(blockOpacity(block["fill-opacity"], 12, {}), 0);
  assert.equal(blockOpacity(block["fill-opacity"], 14.5, { ppm: null }), 0);
  assert.equal(evaluate("line", "line-opacity", edge["line-opacity"], {}), 0, "no edge either");
});

// v4 Task 29: a small area opens below zoom 15 on a phone, where blocks cover it; at 0.85 the street
// map drowned in solid red. The fill steps back to the area fill's street tint; the edge keeps the colour.
test("street blocks step back to a tint by street zoom; their edge keeps their colour, hover thickens it", () => {
  const [block, edge] = propertyLayers(price).map((layer) => layer.paint as Record<string, unknown>);
  const at = (zoom: number) => blockOpacity(block["fill-opacity"], zoom, { ppm: 9000 });
  assert.equal(at(12), BLOCK_FILL_STRENGTH);
  assert.ok(at(14) < 0.6 && at(14) > STREET_FILL_SCALE, `zoom 14: ${at(14)}`);
  assert.ok(at(14.99) < 0.41, "a tint by street zoom, like the area fill");
  assert.deepEqual(edge["line-color"], block["fill-color"], "the edge is the block's own colour, Day and Night");
  assert.equal(evaluate("line", "line-opacity", edge["line-opacity"], { ppm: 9000 }), 0.9);
  const width = (state: Record<string, boolean>) => evaluate("line", "line-width", edge["line-width"], { ppm: 9000 }, state) as number;
  assert.ok(width({ hover: true }) > width({}));
  assert.ok(!JSON.stringify(block["fill-opacity"]).includes("feature-state"), "MapLibre refuses feature-state inside a zoom curve");
});

test("layers: blocks 12-15, parcels/outline/dwellings from 15; hover and selection drive the paint", () => {
  const layers = propertyLayers(price);
  assert.deepEqual(layers.map((layer) => [layer.id, layer.type, layer.minzoom, layer.maxzoom ?? null]),
    [["block-fill", "fill", 12, 15], ["block-outline", "line", 12, 15], ["parcel-fill", "fill", 15, null], ["parcel-outline", "line", 15, null],
      ["dwelling-point", "circle", 15, null]]);
  const outline = layers[3].paint as Record<string, unknown>;
  const width = (featureState: Record<string, boolean>) => evaluate("line", "line-width", outline["line-width"], { dwellings: 1 }, featureState);
  assert.deepEqual([width({}), width({ hover: true }), width({ selected: true })], [0.6, 1.6, 3]);
  const source = propertySource("http://localhost:4180");
  assert.equal(source.minzoom, 12);
  assert.equal(source.attribution, undefined);
});

test("the area fill keeps its strength under street blocks and homes; it steps back only under sale pins", () => {
  assert.equal(areaFadedUnderHouses(11.9, { sales: true }), false);
  assert.equal(areaFadedUnderHouses(12, { sales: false }), false, "blocks without a median fall back to the area fill");
  assert.equal(areaFadedUnderHouses(14.9, { sales: false }), false);
  assert.equal(areaFadedUnderHouses(16, { sales: false }), false, "parcels without a sale show the area's colour");
  assert.equal(areaFadedUnderHouses(12, { sales: true }), true, "sale pins carry their own colour");
  assert.equal(areaFadedUnderHouses(16, { sales: true }), true);
  const base = ["literal", 0.5] as never;
  assert.deepEqual(areaFillOpacityWithParcels(base, false), base);
  assert.deepEqual(areaFillOpacityWithParcels(base, true), ["*", 0.2, ["literal", 0.5]]);
});

test("opacityOverZoom: one fill-opacity for every zoom, zoom outside the feature-state terms, steps kept", () => {
  const base = ["*", 0.7, ["to-number", ["feature-state", "t"], 1]] as never;
  // The street step-back, with the fill at a fifth from 12 (sale pins) and stepped back to 0.5 from 14 (places).
  const scaleAt = (zoom: number) => (zoom >= 12 ? 0.2 : 1) * Math.min(1 - Math.max(0, Math.min(zoom, 15) - 12) / 3 * 0.6, zoom >= 14 ? 0.5 : 1);
  const opacity = opacityOverZoom(base, scaleAt, [12, 14]);
  const style = { version: 8, sources: { s: { type: "vector", tiles: ["https://x.test/{z}/{x}/{y}"] } },
    layers: [{ id: "f", type: "fill", source: "s", "source-layer": "l", paint: { "fill-opacity": opacity } }] };
  assert.deepEqual(validateStyleMin(style as never).map((error) => error.message), []);
  const spec = (latest as unknown as Record<string, Record<string, unknown>>).paint_fill["fill-opacity"];
  const compiled = createExpression(opacity, spec as never);
  if (compiled.result !== "success") throw new Error(JSON.stringify(compiled.value));
  for (const zoom of [5, 11.5, 12, 12.6, 13.5, 14, 14.8, 15, 18]) {
    const value = compiled.value.evaluate({ zoom } as never, { type: "Polygon", properties: {} } as never, { t: 1 }) as number;
    assert.ok(Math.abs(value - 0.7 * scaleAt(zoom)) < 0.005, `zoom ${zoom}: ${value} vs ${0.7 * scaleAt(zoom)}`);
  }
  // Nothing changes with zoom: the base alone, or a constant.
  assert.deepEqual(opacityOverZoom(base, () => 1, [12]), base);
  assert.equal(opacityOverZoom(base, () => 0, [12]), 0);
});

test("a click resolves to the dwelling the feature names", () => {
  assert.deepEqual(dwellingFromFeature({ uprn: 207147713, address_id: "uk:addr:327ecab263c9", ppm: 5704 }),
    { uprn: "207147713", addressId: "uk:addr:327ecab263c9" });
  assert.deepEqual(dwellingFromFeature({ uprn: "1" }), { uprn: "1", addressId: null });
  assert.equal(dwellingFromFeature({ ppm: 5 }), null);
  assert.equal(dwellingFromFeature(undefined), null);
});

test("hover targets name the source layer the feature id belongs to", () => {
  assert.deepEqual(hoverTarget("parcel-fill", 37560229), { sourceLayer: "parcels", id: 37560229 });
  assert.deepEqual(hoverTarget("dwelling-point", 207147713), { sourceLayer: "dwellings", id: 207147713 });
  assert.deepEqual(hoverTarget("block-fill", "hex100:3:4"), { sourceLayer: "blocks", id: "hex100:3:4" });
  assert.equal(hoverTarget("parcel-fill", undefined), null);
});

test("tooltips show the numbers: blocks summarise, parcels name the address when they have it", () => {
  assert.deepEqual(tooltipLines("block-fill", { area: 7196, dwellings: 33, ppm: 5931.4 }, "/m²"),
    ["33 homes · median £5,930/m²", "Zoom in to see homes"]);
  assert.deepEqual(tooltipLines("block-fill", { area: 24000, dwellings: 1, ppm: null }, "/m²"),
    ["1 home · too few for a median", "Zoom in to see homes"]);
  assert.deepEqual(tooltipLines("parcel-fill", { address: "9 The Drive, Enfield, EN2 0DG", latest_sale: "2019-05-01", dwellings: 1 }, "/m²"),
    ["9 The Drive, Enfield, EN2 0DG", "Sold 2019"]);
  assert.deepEqual(tooltipLines("parcel-fill", { latest_sale: "2019-05-01", dwellings: 4 }, "/m²"),
    ["4 dwellings on this parcel", "Latest sale here 2019"]);
  // A title wider than any one home's plot says so: the pointer may be streets away from the home.
  assert.deepEqual(tooltipLines("parcel-fill", { address: "9 The Drive, Enfield, EN2 0DG", latest_sale: "2019-05-01", dwellings: 1, area: 40_000 }, "/m²"),
    ["9 The Drive, Enfield, EN2 0DG", "Sold 2019", "Outline: its land title, wider than the home"]);
  assert.deepEqual(tooltipLines("parcel-fill", { latest_sale: "2019-05-01", dwellings: 3, area: 61_000 }, "/m²"),
    ["3 dwellings on this parcel", "Latest sale here 2019", "Outline: their land title, wider than the homes"]);
  assert.deepEqual(tooltipLines("dwelling-point", { latest_sale: "2019-05-01" }, "/m²"), ["Dwelling", "Sold 2019"]);
  // A sold home's band in words, never a percentile.
  assert.deepEqual(tooltipLines("parcel-fill", { latest_sale: "2019-05-01", dwellings: 1, band: 4 }, "/m²"),
    ["Dwelling", "Sold 2019", "Top quarter of similar homes sold here that year"]);
  assert.deepEqual(tooltipLines("dwelling-point", { latest_sale: "2019-05-01", band: 9 }, "/m²"), ["Dwelling", "Sold 2019"]);
  // A home with no recorded sale has no tooltip; an old tile's sppm is never read.
  assert.deepEqual(tooltipLines("dwelling-point", { sppm: 4633 }, "/m²"), []);
  // An old tile's restated figures are never read.
  assert.deepEqual(tooltipLines("parcel-fill", { ppm: 4633, value: 806095 }, "/m²"), []);
  assert.deepEqual(tooltipLines("parcel-fill", undefined, "/m²"), []);
});
