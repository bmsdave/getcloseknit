import { readFileSync } from "node:fs";

import { expect, expectSteady, test, type Page } from "./fixtures";

import { STREET_LAYERS } from "../src/lib/map-landmarks";
import { treeAgeText, treePopupLines } from "../src/lib/map-street-trees";
import { topicItem } from "./evidence";
import { openShowPanel } from "./top-bar";

// Fix 9 + v4 Tasks 3, 6, 7: Show › Street trees (a green heat to zoom 15.5, then a dot per GLA tree) and Layers ›
// Nature › Green & trees with its views Area score · Green cover · Green streets (OS Open Roads links by their
// street trees per 100 m). The tiles are served from real rows round Cazenove Road (e2e/street-trees-fixture.json,
// exported with the tile functions' own fields from migration 066).

interface Feature { type: "Feature"; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }
interface Collection { type: "FeatureCollection"; features: Feature[] }
const FIXTURE = JSON.parse(readFileSync(new URL("./street-trees-fixture.json", import.meta.url), "utf8")) as { trees: Collection; streets: Collection };
const CENTRE = { lat: 51.5656, lng: -0.0725 };

/** Serves both tile endpoints from the fixture: single trees from zoom 15, one count per tile below (the heat's cells). */
async function serveTiles(page: Page) {
  const { geoJSONToTile } = await import("@maplibre/geojson-vt");
  const { fromGeojsonVt } = await import("@maplibre/vt-pbf");
  const serve = (collection: Collection, layer: string) => async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const [z, x, y] = new URL(route.request().url()).pathname.replace(".pbf", "").split("/").slice(-3).map(Number);
    const tile = geoJSONToTile(collection as never, z, x, y, { clip: true });
    if (!tile?.features.length) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 200, contentType: "application/vnd.mapbox-vector-tile",
      body: Buffer.from(fromGeojsonVt({ [layer]: tile }, { version: 2, extent: 4096 })) });
  };
  const trees = FIXTURE.trees.features;
  const middle = trees.reduce(([lng, lat], tree) => {
    const [x, y] = tree.geometry.coordinates as [number, number];
    return [lng + x / trees.length, lat + y / trees.length];
  }, [0, 0]);
  const cluster: Collection = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: middle }, properties: { n: trees.length } }] };
  await page.route("**/api/v1/tiles/street-trees/**", (route) => {
    const z = Number(new URL(route.request().url()).pathname.split("/").at(-3));
    return serve(z >= 15 ? FIXTURE.trees : cluster, "street_trees")(route);
  });
  await page.route("**/api/v1/tiles/green-streets/**", async (route) => {
    // As green_street_tile (migration 102): the lines, and from zoom 14 the bands of the streets with trees.
    const [z, x, y] = new URL(route.request().url()).pathname.replace(".pbf", "").split("/").slice(-3).map(Number);
    const layers = Object.fromEntries(([["green_streets", FIXTURE.streets], ["green_street_bands", z >= 14 ? BANDS : null]] as const)
      .flatMap(([name, collection]) => {
        const tile = collection && geoJSONToTile(collection as never, z, x, y, { clip: true });
        return tile?.features.length ? [[name, tile]] : [];
      }));
    if (!Object.keys(layers).length) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 200, contentType: "application/vnd.mapbox-vector-tile",
      body: Buffer.from(fromGeojsonVt(layers, { version: 2, extent: 4096 })) });
  });
}

/** Metres to degrees round the fixture's latitude. */
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((51.5656 * Math.PI) / 180));
/** A point `metres` to the left of a street's segment `a → b`, from its middle. */
function aside([a, b]: [number, number][], metres: number, along = 0.5): [number, number] {
  const [dx, dy] = [(b[0] - a[0]) / M_LNG, (b[1] - a[1]) / M_LAT];
  const length = Math.hypot(dx, dy);
  return [a[0] + (b[0] - a[0]) * along - (dy / length) * metres * M_LNG, a[1] + (b[1] - a[1]) * along + (dx / length) * metres * M_LAT];
}
/** The 35 m band each side of every street with trees, one flat-ended box per segment (the SQL's ST_Buffer, near enough). */
const BAND_M = 35;
const BANDS: Collection = { type: "FeatureCollection", features: FIXTURE.streets.features
  .filter((street) => Number(street.properties.trees) > 0 && street.geometry.type === "LineString")
  .flatMap((street) => {
    const points = street.geometry.coordinates as [number, number][];
    return points.slice(1).map((b, index) => {
      const a = points[index];
      const ring = [aside([a, b], BAND_M, 0), aside([a, b], BAND_M, 1), aside([a, b], -BAND_M, 1), aside([a, b], -BAND_M, 0)];
      return { type: "Feature" as const, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
        properties: { per_100m: street.properties.per_100m } };
    });
  }) };

async function mapReady(page: Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__closeKnitDiagnostics?.project), { timeout: 20_000 }).toBe("function");
}

async function screenPoint(page: Page, at: [number, number]) {
  const canvas = (await page.locator(".maplibregl-canvas").boundingBox())!;
  const point = await page.evaluate((lngLat) => window.__closeKnitDiagnostics!.project(lngLat), at);
  return { x: canvas.x + point.x, y: canvas.y + point.y };
}

// A tree with a recorded canopy and no other tree near it, so a tap finds it alone.
const point = (feature: Feature) => feature.geometry.coordinates as [number, number];
const gap = (tree: Feature) => Math.min(...FIXTURE.trees.features.filter((other) => other !== tree)
  .map((other) => Math.hypot((point(other)[0] - point(tree)[0]) * 0.62, point(other)[1] - point(tree)[1])));
const BIG_TREE = FIXTURE.trees.features.filter((tree) => Number(tree.properties.canopy_m) > 0)
  .sort((a, b) => gap(b) - gap(a))[0];
// The leafiest named street with trees on it.
const LEAFY = [...FIXTURE.streets.features].filter((street) => street.properties.name && Number(street.properties.trees) > 0)
  .sort((a, b) => Number(b.properties.per_100m) - Number(a.properties.per_100m))[0];

test("Show › Street trees: a green heat below street zoom, no numbers, then a dot per tree whose tap opens its kind and size", async ({ page }) => {
  await serveTiles(page);
  await page.goto(`/?diagnostics=1&layer=nature-score&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=14`);
  await mapReady(page);
  const show = await openShowPanel(page);
  const toggle = show.getByTestId("street-trees-toggle");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect.poll(() => new URL(page.url()).searchParams.get("trees")).toBe("on");
  // The heat's key, "Street trees Fewer … More", and how to see each tree (v4 Task 3).
  await expect(show.getByTestId("street-trees-panel")).toContainText("Zoom in for each tree");
  await expect(show.getByTestId("tree-heat-key")).toHaveText(/Street trees\s*Fewer\s*More/);
  await expect(show.getByTestId("tree-key")).toHaveCount(0);
  // One line to the overview of all greenery: Green cover becomes the layer, the trees stay on.
  await show.getByTestId("street-trees-cover-link").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("canopy");
  await expect.poll(() => new URL(page.url()).searchParams.get("trees")).toBe("on");
  await expect(show.getByTestId("street-trees-cover-link")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto(`/?diagnostics=1&layer=nature-score&trees=on&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=14`);
  await mapReady(page);
  await openShowPanel(page);
  await page.keyboard.press("Escape");
  // The map's legend lists it under the area scale; the phone's one-line chip keeps only the scale (Task 2).
  const chipKey = page.getByTestId("legend-chip").getByTestId("tree-heat-key");
  if (test.info().project.name === "mobile") await expect(chipKey).toBeHidden();
  else await expect(chipKey).toHaveText(/Street trees\s*Fewer\s*More/);
  // Zoom 14: a heat and the dots' layer; no cluster bubbles, no count labels.
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.layerIds().filter((id) => id.startsWith("street-tree-")))).toEqual(
    ["street-tree-heat", "street-tree-point"]);
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.layoutProperty("street-tree-heat", "visibility"))).toBe("visible");

  // Zoom 14.6: the dots' tiles (zoom 15) are fetched ahead of the dots, once each, so they draw at once at 15.
  const ahead: string[] = [];
  page.on("request", (request) => {
    const match = /\/api\/v1\/tiles\/street-trees\/15\/\d+\/\d+\.pbf/.exec(request.url());
    if (match) ahead.push(match[0]);
  });
  await page.goto(`/?diagnostics=1&layer=nature-score&trees=on&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=14.6`);
  await mapReady(page);
  await expect.poll(() => ahead.length).toBeGreaterThan(0);
  await expectSteady(() => expect(new Set(ahead).size).toBe(ahead.length), 500);

  // Road collisions on too: the trees' heat stays under the collisions' (V4-03 board, both on).
  await page.route("**/api/v1/tiles/collisions/**", (route) => route.fulfill({ status: 204 }));
  await page.goto(`/?diagnostics=1&layer=nature-score&trees=on&collisions=on&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=13`);
  await mapReady(page);
  await expect.poll(async () => {
    const ids = await page.evaluate(() => window.__closeKnitDiagnostics!.layerIds());
    return ids.includes("street-tree-heat") && ids.includes("collision-heat") && ids.indexOf("street-tree-heat") < ids.indexOf("collision-heat");
  }).toBe(true);

  // Street zoom on the biggest tree: a hover peeks at it in the tooltip, a tap opens its card, and the tap is not an area pick.
  await page.goto(`/?diagnostics=1&layer=nature-score&trees=on&lat=${(BIG_TREE.geometry.coordinates as number[])[1]}&lng=${(BIG_TREE.geometry.coordinates as number[])[0]}&zoom=17.5`);
  await mapReady(page);
  const at = await screenPoint(page, BIG_TREE.geometry.coordinates as [number, number]);
  const tooltip = page.getByTestId("map-tooltip");
  if (test.info().project.name === "desktop") {
    // Desktop: hover shows the tooltip, and moving off puts it away.
    await expect(async () => {
      await page.mouse.move(at.x - 60, at.y - 60);
      await page.mouse.move(at.x, at.y);
      await expect(tooltip).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(tooltip.locator("strong, span")).toHaveText(treePopupLines(BIG_TREE.properties));
    await page.mouse.move(at.x - 120, at.y - 120);
    await expect(tooltip).toBeHidden();
  }
  const card = page.getByTestId("tree-card");
  await expect(async () => {
    await page.mouse.click(at.x, at.y);
    await expect(card).toBeAttached({ timeout: 1_000 });
  }).toPass();
  // Kind, size as recorded ("8 m tall · 6 m canopy · 40 cm girth"), age when given, owner and source.
  await expect(card).toHaveAttribute("data-kind", "tree");
  await expect(card.locator(".place-card__text").locator("strong, span")).toHaveText(treePopupLines(BIG_TREE.properties));
  await expect(card).toContainText(`${BIG_TREE.properties.canopy} canopy`);
  await expect(card).toContainText(treeAgeText(BIG_TREE.properties.age)!);
  expect(new URL(page.url()).searchParams.get("selected")).toBeNull();
  if (test.info().project.name === "mobile") {
    // A phone keeps the card in the lowered sheet: the peek line names it, and a tap there shows it.
    const reopen = page.getByTestId("evidence-sheet-reopen");
    await expect(reopen).toHaveAttribute("aria-label", `Show panel: ${treePopupLines(BIG_TREE.properties)[0]}`);
    await reopen.click();
  }
  // Its close button puts it away.
  await card.getByTestId("tree-card-close").click();
  await expect(card).toHaveCount(0);
});

test("Layers › Nature › Green & trees › Green streets: one green item with three views, streets by trees per 100 m, a street's own figures on a hover", async ({ page }, testInfo) => {
  await serveTiles(page);
  const [lng, lat] = (LEAFY.geometry.coordinates as number[][])[Math.floor((LEAFY.geometry.coordinates as number[][]).length / 2)];
  await page.goto(`/?diagnostics=1&lat=${lat}&lng=${lng}&zoom=16`);
  await mapReady(page);
  // v4 Task 7: Nature lists Green & trees and Wildlife seen; Canopy and Green streets are its views, not rows.
  const row = await topicItem(page, "green-streets");
  await expect(row).toHaveText("Green & trees");
  const panel = page.getByTestId("layers-panel");
  await expect(panel.getByTestId("layer-canopy")).toHaveCount(0);
  await expect(panel.getByTestId("layer-green-streets")).toHaveCount(0);
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(panel.getByTestId("topic-view-note")).toHaveText("Area score · green land, street trees, nature sites");
  const view = panel.getByTestId("view-nature-score-green-streets");
  await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "true");
  // PR #318 (Layers v5): Green streets brings Street trees, so its note names each tree at street zoom.
  await expect(panel.getByTestId("topic-view-note")).toHaveText("Green streets · council street trees per 100 m of road, each tree at street zoom");
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("green-streets");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Green & trees · Green streets");
  const legend = page.getByTestId("legend-chip").getByTestId("map-legend");
  await expect(legend).toHaveAttribute("data-legend", "green-streets");
  await expect(legend.getByTestId("legend-caption")).toHaveText("Green & trees · Green streets");
  await expect(legend.getByTestId("legend-view-note")).toHaveText("council street trees per 100 m of road, each tree at street zoom");
  await expect(legend).toContainText("12+");
  // The areas stay, clear: the streets carry the colour.
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.paintProperty("area-fill-lsoa", "fill-opacity"))).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.layerIds().includes("green-street-line"))).toBe(true);
  await page.keyboard.press("Escape");

  // The zone of homes: a band 35 m each side of the street in its green, under the line (the spine) and the
  // basemap's roads, so homes and pins draw over it: 20 m off the street, either side, it is drawn.
  const ids = await page.evaluate(() => window.__closeKnitDiagnostics!.layerIds());
  expect(ids.indexOf("green-street-band")).toBeGreaterThan(-1);
  expect(ids.indexOf("green-street-band")).toBeLessThan(ids.indexOf("green-street-line"));
  for (const road of STREET_LAYERS.filter((id) => ids.includes(id))) expect(ids.indexOf("green-street-band")).toBeLessThan(ids.indexOf(road));
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.paintProperty("green-street-band", "fill-color")))
    .toEqual(await page.evaluate(() => window.__closeKnitDiagnostics!.paintProperty("green-street-line", "line-color")));
  const coords = LEAFY.geometry.coordinates as [number, number][];
  const middle = Math.max(0, Math.floor(coords.length / 2) - 1);
  const segment: [[number, number], [number, number]] = [coords[middle], coords[middle + 1]];
  const count = async (metres: number) => {
    const at = await screenPoint(page, aside(segment, metres));
    const canvas = (await page.locator(".maplibregl-canvas").boundingBox())!;
    return page.evaluate(([px, py]) => window.__closeKnitDiagnostics!.renderedCount("green-street-band", [px, py]), [at.x - canvas.x, at.y - canvas.y]);
  };
  await expect.poll(() => count(20)).toBeGreaterThan(0);
  await expect.poll(() => count(-20)).toBeGreaterThan(0);

  // A hover on the leafy street peeks its trees per 100 m (Map controls PR 4: a line only peeks; a touch screen has
  // no peek, and a tap goes to the area under it).
  if (testInfo.project.name !== "mobile") {
    const on = await screenPoint(page, [lng, lat]);
    const peek = page.getByTestId("map-tooltip");
    await expect(async () => {
      await page.mouse.move(on.x + 30, on.y + 30);
      await page.mouse.move(on.x, on.y);
      await expect(peek).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(peek.locator("strong")).toHaveText(String(LEAFY.properties.name));
    await expect(peek).toContainText(`${Number(LEAFY.properties.per_100m).toLocaleString("en-GB", { maximumFractionDigits: 1 })} trees per 100 m`);
    await expect(page.locator(".maplibregl-canvas")).not.toHaveCSS("cursor", "pointer");
    await expect(page.getByTestId("tree-card")).toHaveCount(0);
  }

  // Back to the Area score view: the areas take the colour again and the streets go.
  await topicItem(page, "nature-score");
  await page.getByTestId("layers-panel").getByTestId("view-nature-score-area-score").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("nature-score");
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.paintProperty("area-fill-lsoa", "fill-opacity"))).not.toBe(0);
  await expect(page.getByTestId("legend-chip").getByTestId("map-legend")).not.toHaveAttribute("data-legend", "green-streets");
  await expect(page.getByTestId("legend-chip").getByTestId("legend-view-note")).toHaveText("green land, street trees, nature sites");
});

test("a shared Green streets link opens on it, with the tree key once Street trees is on, in both themes", async ({ page }) => {
  await serveTiles(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/?layer=green-streets&trees=on&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=16`);
    await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 20_000 });
    const legend = page.getByTestId("legend-chip").getByTestId("map-legend");
    await expect(legend).toHaveAttribute("data-legend", "green-streets");
    // Day: grey to deep green; night: its own, brighter greens.
    await expect(legend.locator(".map-legend-bar")).toHaveAttribute("data-colours", scheme === "light" ? /^#c8d0da / : /^#4a5878 /);
    await expect((await openShowPanel(page)).getByTestId("street-trees-toggle")).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(await topicItem(page, "green-streets")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
  }
  // Zoomed out past the streets: the legend asks to zoom in rather than showing an empty scale.
  await page.goto(`/?layer=green-streets&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=11`);
  await expect(page.getByTestId("legend-chip").getByTestId("legend-zoom-hint")).toHaveText("Zoom in to see the streets");
});

test("Street trees: zoomed out the panel says to zoom in; a place over a tree takes the tap, not the tree", async ({ page }) => {
  await serveTiles(page);
  // Zoom 11 draws no trees (no heat either): the panel says so.
  await page.goto(`/?layer=nature-score&trees=on&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=11`);
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 20_000 });
  const show = await openShowPanel(page);
  await expect(show.getByTestId("street-trees-panel")).toContainText("Zoom in to see the trees.");
  await expect(show.getByTestId("street-trees-panel")).not.toContainText("Counts here");
  await page.keyboard.press("Escape");

  // A café on the biggest tree's spot: its badge draws over the dot, so the tap opens the café alone.
  const { geoJSONToTile } = await import("@maplibre/geojson-vt");
  const { fromGeojsonVt } = await import("@maplibre/vt-pbf");
  const cafe: Collection = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: point(BIG_TREE) },
    properties: { id: "e2e-cafe", name: "Leaf Café", group: "coffee", category: "coffee_shop", score: 1 } }] };
  await page.route("**/api/v1/tiles/places/**", (route) => {
    const [z, x, y] = new URL(route.request().url()).pathname.replace(".pbf", "").split("/").slice(-3).map(Number);
    const tile = geoJSONToTile(cafe as never, z, x, y, { clip: true });
    if (!tile?.features.length) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 200, contentType: "application/vnd.mapbox-vector-tile",
      body: Buffer.from(fromGeojsonVt({ places: tile }, { version: 2, extent: 4096 })) });
  });
  await page.goto(`/?diagnostics=1&layer=nature-score&trees=on&lat=${point(BIG_TREE)[1]}&lng=${point(BIG_TREE)[0]}&zoom=17.5`);
  await mapReady(page);
  const at = await screenPoint(page, point(BIG_TREE));
  // A phone keeps the card in the lowered sheet ("Show panel: Leaf Café"): it is there, not necessarily in view.
  const card = page.getByTestId("place-card");
  await expect(async () => {
    await page.mouse.click(at.x, at.y);
    await expect(card).toBeAttached({ timeout: 1_000 });
  }).toPass();
  await expect(card).toHaveAttribute("aria-label", "Place: Leaf Café");
  await expect(page.getByTestId("tree-card")).toHaveCount(0);
});

// A real Canopy tile (zoom 14, round Cazenove Road) from deploy/tools/etl_canopy.py, served for every request.
const CANOPY_TILE = readFileSync(new URL("./canopy-tile-14-8188-5442.png", import.meta.url));

test("Green & trees › Green cover: green from the satellite at every zoom (no 'Zoom in'), its own legend; Street trees' heat steps aside", async ({ page }) => {
  const requested: string[] = [];
  await page.route("**/api/v1/tiles/canopy/**", (route) => {
    requested.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: "image/png", body: CANOPY_TILE });
  });
  await serveTiles(page);
  await page.goto(`/?diagnostics=1&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=14`);
  await mapReady(page);
  const row = await topicItem(page, "canopy");
  await expect(row).toHaveText("Green & trees");
  await row.click();
  const view = page.getByTestId("layers-panel").getByTestId("view-nature-score-green-cover");
  await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "true");
  // Old links keep their layer id: ?layer=canopy is this view.
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("canopy");
  const legend = page.getByTestId("legend-chip").getByTestId("map-legend");
  await expect(legend).toHaveAttribute("data-legend", "canopy");
  await expect(legend.getByTestId("legend-caption")).toHaveText("Green & trees · Green cover");
  await expect(legend.getByTestId("legend-view-note")).toHaveText("all greenery from satellite, gardens too");
  await expect(legend).toContainText("More");
  // Its "?" panel's one line to each tree turns Show › Street trees on and closes the panel.
  await page.getByTestId("legend-explain").click();
  const explainer = page.getByTestId("layer-explainer");
  await expect(explainer.getByTestId("layer-explainer-related")).toHaveText("Trees: Street trees");
  await explainer.getByTestId("layer-explainer-related").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("trees")).toBe("on");
  await expect(explainer).toHaveCount(0);
  // Trees on: the panel no longer offers them.
  await page.getByTestId("legend-explain").click();
  await expect(page.getByTestId("layer-explainer")).toBeVisible();
  await expect(page.getByTestId("layer-explainer-related")).toHaveCount(0);
  await page.getByTestId("layer-explainer-close").click();
  // The explainer closed the Layers menu (never both at once): back to the item for the next view.
  await (await topicItem(page, "canopy")).click();
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.paintProperty("area-fill-lsoa", "fill-opacity"))).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.layerIds().includes("canopy-cover"))).toBe(true);
  await expect.poll(() => requested.some((path) => /^\/api\/v1\/tiles\/canopy\/14\/\d+\/\d+\.png$/.test(path))).toBe(true);
  // Green streets next: one view at a time.
  await page.getByTestId("layers-panel").getByTestId("view-nature-score-green-streets").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("green-streets");
  await expect(legend).toHaveAttribute("data-legend", "green-streets");

  // v4 Task 6: zoomed out to 9 (the map's widest) a shared link still shows the cover, never "Zoom in": 256 px
  // tiles one level up, zoom 10, which hold the share of green (etl_canopy.py pyramid).
  requested.length = 0;
  await page.goto(`/?diagnostics=1&layer=canopy&trees=on&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=9`);
  await mapReady(page);
  const far = page.getByTestId("legend-chip").getByTestId("map-legend");
  await expect(far).toHaveAttribute("data-legend", "canopy");
  await expect(far.getByTestId("legend-zoom-hint")).toHaveCount(0);
  await expect(far).not.toContainText(/zoom in/i);
  await expect.poll(() => requested.some((path) => /^\/api\/v1\/tiles\/canopy\/10\/\d+\/\d+\.png$/.test(path))).toBe(true);

  // v4 Task 7: Green cover with Street trees on: the trees' heat is hidden below 16 (it repeats the cover).
  await page.goto(`/?diagnostics=1&layer=canopy&trees=on&lat=${CENTRE.lat}&lng=${CENTRE.lng}&zoom=14`);
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.layoutProperty("street-tree-heat", "visibility"))).toBe("none");
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.layoutProperty("street-tree-point", "visibility"))).toBe("visible");
  const show = await openShowPanel(page);
  await expect(show.getByTestId("street-trees-panel")).toContainText("Over Green cover: zoom in for each tree.");
  await expect(show.getByTestId("tree-heat-key")).toHaveCount(0);
  // Over Green cover the panel's "Overview: Green cover" link is away (it is the layer already).
  await expect(show.getByTestId("street-trees-cover-link")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Back to the Area score: the heat returns.
  await (await topicItem(page, "nature-score")).click();
  await page.getByTestId("layers-panel").getByTestId("view-nature-score-area-score").click();
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics!.layoutProperty("street-tree-heat", "visibility"))).toBe("visible");
});
