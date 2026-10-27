import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DETAIL_ABOUT, DetailLegend, StreetTreesPanel, detailCaption, detailExplanation, detailRelated } from "../src/components/detail-legend";
import { LayerExplainer } from "../src/components/layer-explainer";
import { HELP } from "../src/lib/help-texts";
import {
  CANOPY_ALPHAS, GREEN_STREET_BAND_LAYER, GREEN_STREET_BREAKS, GREEN_STREET_LAYER, GREEN_STREET_LAYERS, GREEN_STREET_TOP, STREET_TREE_PALETTES, TREE_HEAT_LAYER, TREE_LAYERS,
  canopyLayer, canopyLegendColours, canopySource, greenStreetColour, greenStreetLayers, greenStreetPopupLines, greenStreetRamp, greenStreetSource,
  tilesCovering, treeAgeText, treeHeatPaint, treeHeatRamp, treeLayers, treeOwnerText, treePopupLines, treeSizeText, treeSource,
} from "../src/lib/map-street-trees";
import { legendCaption } from "../src/lib/map-legend";
import { isLayerAvailableInMode, parseMapState } from "../src/lib/map-state";
import { activeTopicView, findTopic, MAP_OVERLAYS, MAP_TOPIC_GROUPS, searchTopics, topicTitle, topicViewNote } from "../src/lib/map-topics";
import { DETAIL_LAYER_IDS, isDetailLayer, detailAreaLayer } from "../src/lib/nature-layers";
import { parseTileCoordinate } from "../src/lib/tile-proxy";

test("a tree's popup: kind, size as recorded, age when given, owner as people say it", () => {
  const plane = { name: "London Plane", height: "13 m", canopy: "8 m", girth: "32 cm", age: "Mature (31-80)", owner: "LB Hackney" };
  assert.deepEqual(treePopupLines(plane), [
    "London Plane", "13 m tall · 8 m canopy · 32 cm girth", "Mature · 31–80 years", "Hackney Council · GLA tree list"]);
  // Nothing recorded: one plain line, and no age line at all.
  assert.deepEqual(treePopupLines({ name: "Cherry", owner: "Transport for London" }), ["Cherry", "Size not recorded", "TfL · GLA tree list"]);
  assert.equal(treeSizeText({ height: "5–10 m", girth: "Sapling" }), "5–10 m tall · Sapling");
  assert.equal(treeSizeText({ canopy: "under 3 m" }), "under 3 m canopy");
  assert.equal(treeAgeText("Veteran (over 150)"), "Veteran · over 150 years");
  assert.equal(treeAgeText(null), null);
  assert.equal(treeOwnerText("RB Greenwich"), "Greenwich Council");
  assert.equal(treeOwnerText("The Royal Parks"), "Royal Parks");
  assert.equal(treeOwnerText("City of London"), "City of London");
  assert.equal(treePopupLines({})[0], "Tree");
});

test("a street's popup: trees per 100 m, kerbs under canopy where known, and bare streets say so", () => {
  assert.deepEqual(greenStreetPopupLines({ name: "Kyverdale Road", trees: 36, per_100m: 14.2, canopy: 0.41 }),
    ["Kyverdale Road", "14.2 trees per 100 m · 41% of kerbs under canopy", "36 trees · GLA tree list"]);
  assert.deepEqual(greenStreetPopupLines({ name: "Northwold Road", trees: 1, per_100m: 2 }),
    ["Northwold Road", "2 trees per 100 m", "1 tree · GLA tree list"]);
  assert.deepEqual(greenStreetPopupLines({ trees: 0, per_100m: 0 }), ["Unnamed road", "No street trees", "Council, TfL and park trees within 20 m"]);
});

test("streets are grey with no tree, then six greens from 2 to 12+ per 100 m, in both themes", () => {
  for (const palette of Object.values(STREET_TREE_PALETTES)) {
    assert.equal(palette.greens.length, GREEN_STREET_BREAKS.length);
    const colour = greenStreetColour(palette) as unknown[];
    assert.equal(colour[0], "step");
    assert.equal(colour[2], palette.bare);
    // A link with a tree at all is green; the top class starts at 12.
    assert.deepEqual(colour.slice(3, 5), [0.05, palette.greens[0]]);
    assert.deepEqual(colour.slice(-2), [12, palette.greens[5]]);
    assert.deepEqual(greenStreetRamp(palette), [palette.bare, ...palette.greens]);
  }
  assert.equal(GREEN_STREET_TOP, "12+");
  assert.notDeepEqual(STREET_TREE_PALETTES.day, STREET_TREE_PALETTES.night);
});

test("tiles: trees from zoom 12 (a heat, no numbers), single trees from 15, streets from 13, both overzoomed past 15", () => {
  const trees = treeSource("https://example.test");
  assert.equal(trees.tiles?.[0], "https://example.test/api/v1/tiles/street-trees/{z}/{x}/{y}.pbf");
  assert.deepEqual([trees.minzoom, trees.maxzoom], [12, 15]);
  assert.match(String(trees.attribution), /GLA/);
  const streets = greenStreetSource("");
  assert.deepEqual([streets.minzoom, streets.maxzoom], [13, 15]);
  assert.match(String(streets.attribution), /OS data © Crown copyright/);
  const layers = treeLayers(STREET_TREE_PALETTES.day);
  assert.deepEqual(layers.map((layer) => layer.id), [...TREE_LAYERS]);
  // v4 Task 3, then the owner (2026-10-20): the heat to zoom 15.5, the dots from 15, where the tiles first hold
  // single trees, so they are never late; no cluster bubbles or count labels.
  assert.deepEqual(layers.map((layer) => [layer.type, layer.minzoom, layer.maxzoom]), [["heatmap", 12, 15.5], ["circle", 15, undefined]]);
  assert.equal(TREE_LAYERS[0], TREE_HEAT_LAYER);
  assert.ok(!layers.some((layer) => layer.type === "symbol"));
  assert.equal(greenStreetLayers(STREET_TREE_PALETTES.night).find((layer) => layer.id === GREEN_STREET_LAYER)?.minzoom, 13);
});

test("Green streets' band: the homes 35 m either side of a tree-lined street, in its green at 20 %, under the line", () => {
  for (const palette of Object.values(STREET_TREE_PALETTES)) {
    const layers = greenStreetLayers(palette);
    // The band first (drawn under), the line on top as its spine.
    assert.deepEqual(layers.map((layer) => layer.id), [GREEN_STREET_BAND_LAYER, GREEN_STREET_LAYER]);
    assert.deepEqual([...GREEN_STREET_LAYERS], [GREEN_STREET_BAND_LAYER, GREEN_STREET_LAYER]);
    const [band, line] = layers;
    assert.equal(band.type, "fill");
    assert.equal((band as { source: string }).source, (line as { source: string }).source);
    assert.equal((band as { "source-layer": string })["source-layer"], "green_street_bands");
    // Lines alone to 14.5, the band faded in by 15.5 as the trees' heat fades out (board: By zoom).
    assert.equal(band.minzoom, 14.5);
    const paint = band.paint as Record<string, unknown>;
    assert.deepEqual(paint["fill-opacity"], ["interpolate", ["linear"], ["zoom"], 14.5, 0, 15.5, 0.2]);
    // The same greens as the street's line, per theme.
    assert.deepEqual(paint["fill-color"], greenStreetColour(palette));
    assert.deepEqual(paint["fill-color"], (line.paint as Record<string, unknown>)["line-color"]);
  }
});

test("the zoom-15 tiles covering a box: Highbury at zoom 15 is one tile, a whole-London box too many to fetch ahead", () => {
  assert.deepEqual(tilesCovering([-0.106, 51.551, -0.104, 51.553], 15), [{ z: 15, x: 16374, y: 10889 }]);
  // A box over a tile seam: both, columns then rows.
  assert.deepEqual(tilesCovering([-0.106, 51.549, -0.09, 51.553], 15).map(({ x, y }) => `${x}/${y}`), ["16374/10889", "16374/10890", "16375/10889", "16375/10890"]);
  assert.deepEqual(tilesCovering([-0.5, 51.3, 0.3, 51.7], 15), []);
  assert.equal(tilesCovering([-0.5, 51.3, 0.3, 51.7], 15, 100_000).length > 1000, true);
});

test("the trees' heat: weighed by trees per cell, soft greens from clear, 0.7 at zoom 15 and gone by 16", () => {
  for (const palette of Object.values(STREET_TREE_PALETTES)) {
    const paint = treeHeatPaint(palette) as Record<string, unknown[]>;
    assert.deepEqual(paint["heatmap-weight"], ["coalesce", ["get", "n"], 1]);
    // V4-03 board: radius 10 at zoom 10, 18 at 13, 28 at 15.
    assert.deepEqual(paint["heatmap-radius"].slice(3, 9), [10, 10, 13, 18, 15, 28]);
    assert.deepEqual(paint["heatmap-opacity"], ["interpolate", ["linear"], ["zoom"], 15, 0.7, 15.5, 0]);
    // A zoom step in spreads the trees over four times the pixels: the intensity grows with it.
    const intensity = paint["heatmap-intensity"];
    assert.ok((intensity.at(-1) as number) / (intensity[4] as number) > 30);
    for (let index = 6; index < intensity.length; index += 2) assert.ok((intensity[index] as number) > (intensity[index - 2] as number));
    const colour = paint["heatmap-color"];
    assert.equal(colour[3], 0);
    assert.match(String(colour[4]), /^rgba\(\d+, \d+, \d+, 0\)$/);  // clear at none, no grey fringe
    assert.equal(colour.at(-1), palette.greens.at(-1));
    assert.deepEqual(treeHeatRamp(palette), [...palette.greens]);
  }
  // Green, never the collisions' warm ramp (Task 5): the heat's colours are the street greens.
  assert.ok(treeHeatRamp(STREET_TREE_PALETTES.day).every((hex) => STREET_TREE_PALETTES.day.greens.includes(hex)));
});

test("a tree's dot: as wide as its canopy at street zoom, a fixed small dot with no size", () => {
  const point = treeLayers(STREET_TREE_PALETTES.day)[1] as { paint: Record<string, unknown> };
  const radius = point.paint["circle-radius"] as unknown[];
  assert.deepEqual(radius.slice(0, 3), ["interpolate", ["exponential", 2], ["zoom"]]);
  // Zoom 18: an 8 m crown is about 10.7 px across its radius (0.373 m a pixel).
  const at18 = radius[6] as unknown[];
  assert.equal(at18[0], "case");
  assert.equal(at18[3], 4);
  assert.deepEqual((at18[2] as unknown[])[0], "max");
  // Fading in from 15 as the heat fades out, full by 15.5.
  assert.deepEqual((point.paint["circle-opacity"] as unknown[]).slice(0, 6), ["interpolate", ["linear"], ["zoom"], 15, 0, 15.5]);
});

test("Nature: one Green & trees item whose views are Area score, Green cover and Green streets; old links still open them", () => {
  const nature = MAP_TOPIC_GROUPS.find((group) => group.id === "nature")!;
  assert.deepEqual(nature.items.map((item) => item.id), ["nature-score", "wildlife-hedgehog"]);
  const item = findTopic("green-streets")!;
  assert.equal(item.id, "nature-score");
  assert.equal(item.label, "Green & trees");
  assert.deepEqual(item.views?.map((view) => [view.label, view.layer]),
    [["Area score", "nature-score"], ["Green cover", "canopy"], ["Green streets", "green-streets"]]);
  // One line each says what it is (V4-07 board).
  assert.deepEqual(item.views?.map((view) => view.note), [
    "green land, street trees, nature sites", "all greenery from satellite, gardens too", "council street trees per 100 m of road, each tree at street zoom"]);
  assert.equal(topicViewNote("canopy"), "all greenery from satellite, gardens too");
  assert.equal(topicViewNote("crime"), null);
  assert.equal(findTopic("canopy")?.id, "nature-score");
  assert.equal(activeTopicView(item, { layer: "canopy", scaleMode: "linear" })?.label, "Green cover");
  // The search keywords stay on the item.
  for (const word of ["tree-lined", "canopy", "green cover"]) assert.ok(searchTopics(word).some((found) => found.id === "nature-score"), word);
  assert.equal(topicTitle({ layer: "green-streets", scaleMode: "linear", changeWindow: 5 }, [], "x"), "Green & trees · Green streets");
  assert.equal(topicTitle({ layer: "canopy", scaleMode: "linear", changeWindow: 5 }, [], "x"), "Green & trees · Green cover");
  // The Area score legend reads like its siblings, its line under the scale (V4-07 board).
  assert.equal(legendCaption({ id: "nature-score", label: "Green & trees" }, "2025-07"), "Green & trees · Area score (rank in London)");
  assert.ok(isDetailLayer("green-streets"));
  assert.ok(!isDetailLayer("nature-score"));
  assert.equal(detailAreaLayer("green-streets"), "nature-score");
  assert.equal(detailAreaLayer("crime"), "crime");
  // A shared link opens it, and real data has it.
  assert.equal(parseMapState(new URLSearchParams("layer=green-streets")).layer, "green-streets");
  assert.equal(parseMapState(new URLSearchParams("layer=canopy")).layer, "canopy");
  assert.ok(isLayerAvailableInMode("green-streets", "real"));
  // Street trees is a Show row, not a layer.
  assert.equal(MAP_OVERLAYS.at(-1)?.id, "trees");
  assert.equal(findTopic("trees"), null);
});

test("the legend: Green streets 0 to 12+ with its line, and Street trees' key: the heat's greens, then the dots from zoom 15.5", () => {
  const off = renderToStaticMarkup(createElement(DetailLegend, { layer: "green-streets", trees: false, zoom: 15 }));
  assert.match(off, /Green &amp; trees · Green streets/);
  assert.match(off, /council street trees per 100 m of road/);
  assert.match(off, />0</);
  assert.match(off, />12\+</);
  assert.doesNotMatch(off, /tree-key|tree-heat-key/);
  // Street trees on: below zoom 15.5 the heat's key (no numbers), from 15.5 the dots'.
  const heat = renderToStaticMarkup(createElement(DetailLegend, { layer: "green-streets", trees: true, zoom: 15 }));
  assert.match(heat, /tree-heat-key/);
  assert.match(heat, />Fewer<.*>More</);
  const dots = renderToStaticMarkup(createElement(DetailLegend, { layer: "green-streets", trees: true, zoom: 16 }));
  assert.match(dots, /Canopy/);
  assert.match(dots, /Size unknown/);
  // Zoomed out past the streets: no scale, a word to zoom in.
  const out = renderToStaticMarkup(createElement(DetailLegend, { layer: "green-streets", trees: true, zoom: 12 }));
  assert.match(out, /Zoom in to see the streets/);
  assert.doesNotMatch(out, /12\+/);
  assert.equal(detailCaption("canopy"), "Green & trees · Green cover");

  const panel = (zoom: number, cover = false) => renderToStaticMarkup(createElement(StreetTreesPanel, { zoom, cover }));
  assert.match(panel(13), /tree-heat-key/);
  assert.match(panel(13), /Zoom in for each tree/);
  assert.doesNotMatch(panel(13), /\d+k|Counts here/);  // no numbers any more
  assert.doesNotMatch(panel(16), /zoom in/i);
  assert.match(panel(16), /Size unknown/);
  // Below zoom 12 nothing is drawn.
  assert.match(panel(11), /Zoom in to see the trees/);
  // Over Green cover the heat is hidden: no heat key, a word that the dots come zoomed in (v4 Task 7).
  assert.doesNotMatch(panel(14, true), /tree-heat-key/);
  assert.match(panel(14, true), /Over Green cover: zoom in for each tree/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(DetailLegend, { layer: "canopy", trees: true, zoom: 14 })), /tree-heat-key|tree-key/);
  assert.match(renderToStaticMarkup(createElement(DetailLegend, { layer: "canopy", trees: true, zoom: 16 })), /tree-key/);
  // The (?) is the board's "Street trees (council list)": GLA, Nov 2025, no gardens or parks.
  assert.match(panel(13), /About Street trees \(council list\)/);
  assert.match(HELP["street-trees"].short, /GLA street trees, Nov 2025/);
  assert.match(HELP["street-trees"].short, /Private gardens and parks are not included/);
});

test("the two views of the same trees link to each other in one line: Street trees → Green cover, Green cover → Street trees", () => {
  const panel = renderToStaticMarkup(createElement(StreetTreesPanel, { zoom: 14, onCover: () => undefined }));
  assert.match(panel, /data-testid="street-trees-cover-link"[^>]*>Overview: Green cover</);
  // Over Green cover already, or without the switch: no link.
  assert.doesNotMatch(renderToStaticMarkup(createElement(StreetTreesPanel, { zoom: 14, cover: true, onCover: () => undefined })), /Overview: Green cover/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(StreetTreesPanel, { zoom: 14 })), /Overview: Green cover/);
  // Green cover's "?" panel (the legend chip is a button, so the link cannot sit in it): while the trees are off.
  assert.deepEqual(detailRelated("canopy", false), { label: "Trees: Street trees", show: "trees" });
  assert.equal(detailRelated("canopy", true), null);
  assert.equal(detailRelated("green-streets", false), null);
  const explainer = renderToStaticMarkup(createElement(LayerExplainer, {
    explanation: detailExplanation("canopy"), ramp: null, average: null, area: null, onClose: () => undefined,
    related: { label: detailRelated("canopy", false)!.label, onSelect: () => undefined },
  }));
  assert.match(explainer, /data-testid="layer-explainer-related"[^>]*>Trees: Street trees</);
  assert.doesNotMatch(renderToStaticMarkup(createElement(DetailLegend, { layer: "canopy", trees: false, zoom: 14 })), /Trees: Street trees|<button/);
});

test("Green cover (canopy): tiles from zoom 8, only over London, four shades over the theme's ground, never 'zoom in'", () => {
  const source = canopySource("https://example.test");
  assert.equal(source.type, "raster");
  assert.equal(source.tiles?.[0], "https://example.test/api/v1/tiles/canopy/{z}/{x}/{y}.png");
  // v4 Task 6: zoom 8-10 hold each pixel's share of green (etl_canopy.py pyramid); 14 is stretched further in.
  assert.deepEqual([source.minzoom, source.maxzoom, source.tileSize], [8, 14, 256]);
  assert.deepEqual(source.bounds, [-0.52, 51.28, 0.34, 51.7]);
  assert.match(String(source.attribution), /Copernicus Sentinel/);
  assert.equal(canopyLayer("day").type, "raster");
  assert.equal(canopyLayer("day").minzoom, 8);
  assert.notDeepEqual(canopyLayer("day").paint, canopyLayer("night").paint);
  for (const theme of ["day", "night"] as const) {
    const colours = canopyLegendColours(theme);
    assert.equal(colours.length, CANOPY_ALPHAS.length);
    assert.ok(colours.every((colour) => /^#[0-9a-f]{6}$/.test(colour)));
  }
  // The densest shade by day is near the leaf green itself; by night it sits on navy.
  assert.equal(canopyLegendColours("day")[3], "#4e9f88");
  assert.notEqual(canopyLegendColours("night")[0], canopyLegendColours("day")[0]);
  for (const zoom of [8, 9, 10, 12]) {
    const legend = renderToStaticMarkup(createElement(DetailLegend, { layer: "canopy", trees: false, zoom }));
    assert.match(legend, /Green &amp; trees · Green cover/);
    assert.match(legend, /all greenery from satellite, gardens too/);
    assert.match(legend, />Less</);
    assert.match(legend, />More</);
    assert.doesNotMatch(legend, /zoom in/i);
  }
  assert.match(DETAIL_ABOUT.canopy, /private ones too/);
  assert.doesNotMatch(DETAIL_ABOUT.canopy, /zoom in/i);
  assert.equal(detailExplanation("canopy").name, "Green cover");
  assert.deepEqual([...DETAIL_LAYER_IDS], ["green-streets", "canopy"]);
  assert.equal(detailAreaLayer("canopy"), "nature-score");
  assert.deepEqual(parseTileCoordinate("14", "8186", "5448.png", ".png"), { z: 14, x: 8186, y: 5448 });
  assert.equal(parseTileCoordinate("14", "8186", "5448.png"), null);  // a vector route never takes a PNG name
});
