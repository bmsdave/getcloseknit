import { expect, expectSteady, test, type Page } from "./fixtures";

import { PRICE_MORPH_MS } from "../src/lib/price-scale";
import { openLayersPanel, openScaleSettings } from "./evidence";
import { showTimeline } from "./top-bar";

// One price layer: a monthly timeline on a fixed log colour scale, and homes
// at house zoom in their last sale's coarse band, else their area's colour
// (never a figure of their own). Plus
// "Typical home price", an area layer with a property-type selector.

async function paint(page: Page, layer: string, property: string): Promise<string> {
  return JSON.stringify(await page.evaluate(([id, name]) =>
    window.__closeKnitDiagnostics?.paintProperty(id, name) ?? null, [layer, property]));
}

test("old stock-value links open the price layer, the only £/m² layer", async ({ page }) => {
  await page.goto("/?layer=stock-value-per-square-metre");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "price-per-square-metre");
  const panel = await openLayersPanel(page);
  await expect(panel.getByTestId("layer-price-per-square-metre")).toHaveAttribute("aria-current", "true");
  await expect(panel.getByTestId("layer-stock-value-per-square-metre")).toHaveCount(0);
  await expect(page).toHaveURL(/layer=price-per-square-metre/);
});

test("the timeline steps a month at a time over all 241 months and plays a month every 200 ms (v3 Fix 4–5)", async ({ page }) => {
  await page.goto("/?period=2006-06");
  const explorer = page.getByTestId("close-knit");
  const slider = page.getByLabel("Price period");
  const label = page.getByTestId("price-timeline").locator(".timeline-period");
  await expect(explorer).toHaveAttribute("data-active-period", "2006-06");
  await showTimeline(page);
  // Every month of 2006-06 … 2026-06 is a step: 241 of them.
  await expect(slider).toHaveAttribute("max", "240");
  await slider.press("ArrowRight");
  await expect(explorer).toHaveAttribute("data-active-period", "2006-07");
  await expect(label).toHaveText("Jul 2006");
  await expect(slider).toHaveAttribute("aria-valuetext", "Jul 2006");
  await slider.press("ArrowLeft");
  await expect(explorer).toHaveAttribute("data-active-period", "2006-06");
  await slider.press("End");
  await expect(explorer).toHaveAttribute("data-active-period", "2026-06");
  await slider.press("ArrowLeft");
  await expect(explorer).toHaveAttribute("data-active-period", "2026-05");
  await expect(label).toHaveText("May 2026");

  // Play moves on a month at a time, one per 200 ms. Each step reaches the
  // app 120 ms before the map starts its morph (timers on a controlled clock).
  await page.clock.install({ time: new Date("2026-06-01T10:00:00Z") });
  await page.goto("/?period=2015-05");
  // Time stands still from here: only runFor moves it.
  await page.clock.pauseAt(new Date("2026-06-01T11:00:00Z"));
  await expect(explorer).toHaveAttribute("data-active-period", "2015-05");
  await showTimeline(page);
  await expect(label).toHaveText("May 2015");
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect(page.getByRole("button", { name: "Pause timeline" })).toBeVisible();
  await page.clock.runFor(60);
  await expect(explorer).toHaveAttribute("data-active-period", "2015-05");
  await page.clock.runFor(40);
  await expect(explorer).toHaveAttribute("data-active-period", "2015-06");
  await expect(label).toHaveText("Jun 2015");
  await page.clock.runFor(200);
  await expect(explorer).toHaveAttribute("data-active-period", "2015-07");
  await expect(label).toHaveText("Jul 2015");
  await page.getByRole("button", { name: "Pause timeline" }).click();
});

test("play runs once to the latest month and stops; play there replays from 2006", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-06-01T10:00:00Z") });
  await page.goto("/?period=2026-05");
  await page.clock.pauseAt(new Date("2026-06-01T11:00:00Z"));
  const explorer = page.getByTestId("close-knit");
  await expect(explorer).toHaveAttribute("data-active-period", "2026-05");
  await showTimeline(page);
  await page.getByRole("button", { name: "Play timeline" }).click();
  await page.clock.runFor(100);
  await expect(explorer).toHaveAttribute("data-active-period", "2026-06");
  await expect(page.getByRole("button", { name: "Play timeline" })).toBeVisible();
  await page.clock.runFor(2000);
  await expect(explorer).toHaveAttribute("data-active-period", "2026-06");

  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect(explorer).toHaveAttribute("data-active-period", "2006-06");
  await expect(page.getByRole("button", { name: "Pause timeline" })).toBeVisible();
  await page.clock.runFor(100);
  await expect(explorer).toHaveAttribute("data-active-period", "2006-07");
});

/** Records, every animation frame until read back, anything that would show a second fill layer or a layer-opacity fade. */
async function recordFillLayers(page: Page) {
  await page.evaluate(() => {
    const record = window as unknown as { __layers: { next: boolean; layerOpacity: unknown }[] };
    record.__layers = [];
    const sample = () => {
      const diagnostics = window.__closeKnitDiagnostics;
      record.__layers.push({
        next: diagnostics.layerIds().includes("area-fill-next"),
        layerOpacity: diagnostics.paintProperty("area-fill-lsoa", "fill-layer-opacity") ?? null,
      });
      if (record.__layers.length < 900) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return () => page.evaluate(() => (window as unknown as { __layers: { next: boolean; layerOpacity: unknown }[] }).__layers);
}

/**
 * When the page's main thread was busy: a 50 ms timer chain, each tick's delay past its 50 ms. Playback hands each
 * month over on a timer too, so a busy thread (a frame drawn in software, beside other specs) holds both up alike;
 * a pause on an idle thread (waiting on a pack) leaves this chain on time.
 */
async function recordBusyThread(page: Page) {
  await page.evaluate(() => {
    const record = window as unknown as { __busy: { at: number; late: number }[] };
    record.__busy = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      record.__busy.push({ at: now, late: now - last - 50 });
      last = now;
      if (record.__busy.length < 1_000) setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  });
  return () => page.evaluate(() => (window as unknown as { __busy: { at: number; late: number }[] }).__busy);
}

async function waitForDiagnostics(page: Page) {
  await expect.poll(
    () => page.evaluate(() => window.__closeKnitDiagnostics?.morph().period ?? null),
    { timeout: 30_000 },
  ).toBe("2006-06");
}

const morphState = (page: Page) => page.evaluate(() => window.__closeKnitDiagnostics.morph());
const pageNow = (page: Page) => page.evaluate(() => performance.now());
/** Morph frames sampled since a page time. */
const morphFrames = async (page: Page, since: number) => (await morphState(page)).samples.filter((sample) => sample.at >= since);

test("a step morphs the values in the one fill layer: the weight moves frame by frame, then rests", async ({ page }) => {
  // PR #284: Price per m² opens on Rank in London; ?scale=linear keeps this on Actual.
  await page.goto("/?diagnostics=1&period=2006-06&scale=linear");
  await waitForDiagnostics(page);
  const layers = await recordFillLayers(page);
  const since = await pageNow(page);
  await showTimeline(page);
  await page.getByLabel("Price period").press("ArrowRight");
  await expect.poll(async () => (await morphState(page)).period).toBe("2006-07");
  await expect.poll(async () => (await morphState(page)).morphing).toBe(false);
  const { weight, landed } = await morphState(page);
  const samples = await morphFrames(page, since);
  const weights = samples.map((sample) => sample.weight);
  // At least one frame between the two months (the morph is 200 ms: a busy machine may paint only one in it, at
  // any point of the way, e.g. [0.08, 1]).
  expect(weights.some((t) => t > 0 && t < 1), JSON.stringify(weights)).toBe(true);
  // Towards the key that took July: the weight only rises, and lands at 1.
  for (let index = 1; index < weights.length; index += 1) expect(weights[index]).toBeGreaterThanOrEqual(weights[index - 1]);
  expect(weight).toBe(1);
  expect(landed).toBe(1);
  // One fill layer throughout, never a whole-layer opacity fade.
  const frames = await layers();
  expect(frames.length).toBeGreaterThan(5);
  expect(frames.every((frame) => !frame.next && frame.layerOpacity === null)).toBe(true);
  expect(await page.evaluate(() => window.__closeKnitDiagnostics.featureValue("uk:lsoa:E01000001"))).not.toBeNull();
});

test("playback moves through the months without pausing, and each frame stays cheap", async ({ page }) => {
  // PR #284: Price per m² opens on Rank in London; ?scale=linear keeps this on Actual.
  await page.goto("/?diagnostics=1&period=2006-06&scale=linear");
  await waitForDiagnostics(page);
  const layers = await recordFillLayers(page);
  const busy = await recordBusyThread(page);
  const since = await pageNow(page);
  await showTimeline(page);
  await page.getByRole("button", { name: "Play timeline" }).click();
  // A month per 200 ms: nine months in (about as long as four 450 ms years were), past steps a poll could miss one by one.
  const explorer = page.getByTestId("close-knit");
  const month = async () => {
    const period = (await explorer.getAttribute("data-active-period")) ?? "2006-06";
    return Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7));
  };
  await expect.poll(month, { timeout: 15_000 }).toBeGreaterThanOrEqual(2007 * 12 + 3);
  await page.getByRole("button", { name: "Pause timeline" }).click();
  await expect.poll(async () => (await morphState(page)).morphing).toBe(false);
  const { landed } = await morphState(page);
  const samples = await morphFrames(page, since);
  expect(landed).toBeGreaterThanOrEqual(6);
  // Timeline position (morphs landed + progress) never steps back …
  const positions = samples.map((sample) => sample.position);
  for (let index = 1; index < positions.length; index += 1) expect(positions[index]).toBeGreaterThanOrEqual(positions[index - 1]);
  // … and the months run back to back: once moving, the timeline never stands still (the next month starts where
  // the last one landed). The position is the time played, a month per PRICE_MORPH_MS, so a slow frame (the map
  // draws in software here, beside other specs) moves it on by its own length; a pause is time it does not. While
  // the main thread is busy no timer fires, the hand-over of the next month's neither: what the frames cost is
  // checked below, and a pause on an idle thread is the timeline's own.
  const moving = samples.filter((sample) => sample.position > 0.05 && sample.position < landed - 0.05)
    // A landing writes the last frame's position again, and the next month's first frame follows at once.
    .filter((sample, index, all) => index === 0 || sample.position !== all[index - 1].position);
  const ticks = await busy();
  const pauses = moving.slice(1).map((sample, index) => {
    const from = moving[index];
    const stall = sample.at - from.at - (sample.position - from.position) * PRICE_MORPH_MS;
    const held = Math.max(0, ...ticks.filter((tick) => tick.at > from.at && tick.at <= sample.at + 50).map((tick) => tick.late));
    return stall - held;
  });
  expect(Math.max(...pauses), JSON.stringify(pauses)).toBeLessThan(250);
  // Per frame the map only writes the weight to the areas that move.
  const writes = samples.map((sample) => sample.writeMs).sort((a, b) => a - b);
  expect(writes[Math.ceil(writes.length * 0.95) - 1]).toBeLessThan(10);
  expect((await layers()).every((frame) => !frame.next && frame.layerOpacity === null)).toBe(true);
  // A plain repaint (no new values) stays inside the style-update budget.
  expect(await page.evaluate(() => window.__closeKnitDiagnostics.measureStyleUpdate(40))).toBeLessThanOrEqual(10);
});

test("with reduced motion a step switches at once and the median tick jumps", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto("/?diagnostics=1&period=2006-06&scale=linear");
    await waitForDiagnostics(page);
    await showTimeline(page);
    await page.getByLabel("Price period").press("ArrowRight");
    await expect.poll(async () => (await morphState(page)).period).toBe("2006-07");
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const state = await morphState(page);
    expect(state.samples).toEqual([]);
    expect(state.morphing).toBe(false);
    expect(state.landed).toBe(0);
    const tick = page.getByTestId("legend-median-tick");
    const duration = await tick.evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.01);
  } finally {
    await context.close();
  }
});

test("the price scale is fixed across years and its tick marks each year's London median", async ({ page }) => {
  await page.goto("/?period=2006-06&scale=linear");
  const legend = page.getByTestId("map-legend");
  const tick = legend.getByTestId("legend-median-tick");
  // A phone's one-line chip leaves the marker to the colour key; it still tracks the year.
  if ((page.viewportSize()?.width ?? 1280) > 800) await expect(tick).toBeVisible();
  else await expect(tick).toBeAttached();
  // It slides with the map's value morph rather than jumping.
  expect(await tick.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("left");
  const stops = await legend.getByTestId("legend-price").textContent();
  const early = await tick.getAttribute("data-value");
  const earlyLeft = await tick.evaluate((element) => (element as HTMLElement).style.left);

  await showTimeline(page);
  await page.getByLabel("Price period").press("End");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-period", "2026-06");
  await expect(tick).not.toHaveAttribute("data-value", early ?? "");
  const late = Number(await tick.getAttribute("data-value"));
  const lateLeft = await tick.evaluate((element) => (element as HTMLElement).style.left);
  expect(late).toBeGreaterThan(Number(early));
  expect(parseFloat(lateLeft)).toBeGreaterThan(parseFloat(earlyLeft));
  // Same range labels in both years.
  await expect(legend.getByTestId("legend-price")).toHaveText(stops ?? "");
  await expect(legend.locator(".map-legend-bar")).toHaveAccessibleName(/£\d+(\.\d)?k – £\d+(\.\d)?k\+/);
});

test("homes at house zoom: a sold home in its sale's band, others in the area's colour; no 'value now' switch", async ({ page }) => {
  await page.goto("/?diagnostics=1&layer=price-per-square-metre&zoom=16&lat=51.501&lng=-0.1416&homes=now");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect.poll(() => paint(page, "parcel-fill", "fill-opacity")).toContain('"hover"');
  for (const [layer, property] of [["parcel-fill", "fill-color"], ["dwelling-point", "circle-color"]]) {
    const colour = await paint(page, layer, property);
    expect(colour).toContain('["get","band"]');
    expect(colour).not.toMatch(/"sppm"|"ppm"|"value"/);
  }
  // Outlines are a quiet ink, not cobalt, until hovered or chosen.
  expect(await paint(page, "parcel-outline", "line-color")).toMatch(/"#22252c"\]$/);
  // The area fill keeps its strength under the homes (only the zoom step-back applies).
  await expect.poll(() => paint(page, "area-fill-lsoa", "fill-opacity")).not.toContain("[\"*\",0.2,");

  const settings = await openScaleSettings(page);
  await expect(settings.getByTestId("homes-switch")).toHaveCount(0);
  // The colour key (bands, sold-home bands) stays on the map, never in the card.
  for (const id of ["legend-details", "legend-sold-bands", "legend-price-bands"]) await expect(settings.getByTestId(id)).toHaveCount(0);
  await expect(page.getByTestId("legend-sold-compact")).toContainText("Sold homes: where the last sale sat among similar homes sold here that year");
  await expect(page).not.toHaveURL(/homes=/);
});

test("street blocks without a median are clear: the area fill keeps its strength under blocks", async ({ page }) => {
  await page.goto("/?diagnostics=1&layer=price-per-square-metre&zoom=13.5&lat=51.501&lng=-0.1416");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect.poll(() => paint(page, "block-fill", "fill-opacity")).toContain('["==",["get","ppm"],null],0');
  await expect.poll(() => paint(page, "area-fill-lsoa", "fill-opacity")).not.toContain("[\"*\",0.2,");
  // The compact key names the sold-home bands only at house zoom.
  await expect(page.getByTestId("legend-sold-compact")).toHaveCount(0);
});

test("at house zoom the compact key explains the sold-home colours", async ({ page }) => {
  await page.goto("/?layer=price-per-square-metre&zoom=16&lat=51.501&lng=-0.1416");
  const compact = page.getByTestId("legend-sold-compact");
  await expect(compact).toContainText("Sold homes: where the last sale sat among similar homes sold here that year");
});

test("Typical price is one item whose views (and legend) switch the type of home", async ({ page }) => {
  await page.goto("/?layer=typical-price&selected=uk%3Alsoa%3AE01000001");
  const panel = await openLayersPanel(page);
  // Cost, the group shown, is open and flat: no second level.
  await expect(panel.getByTestId("topic-group-cost")).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByTestId("layer-typical-price")).toHaveAttribute("aria-current", "true");
  await expect(panel.getByTestId("layer-typical-price")).toContainText("Typical price");
  for (const variant of ["flat", "terraced", "semi", "detached"]) await expect(panel.getByTestId(`layer-typical-price-${variant}`)).toHaveCount(0);
  // The types are the item's views: choosing one keeps the panel open. One period only: "Latest", no timeline.
  await expect(panel.locator("[data-testid^='view-typical-price-']")).toHaveText(["All", "Flats", "Terraced", "Semi", "Detached"]);
  await expect(panel.locator(".topic-latest")).toHaveText("Latest");
  await expect(panel.getByTestId("price-timeline")).toHaveCount(0);
  await panel.getByTestId("view-typical-price-typical-price-flat").click();
  await expect(page).toHaveURL(/layer=typical-price-flat/);
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Typical price · Flats");
  await panel.getByTestId("view-typical-price-typical-price").click();
  await page.keyboard.press("Escape");

  // The chip's key follows the type; the views are the one place to switch it (no second row on the key).
  const legend = page.getByTestId("map-legend");
  await expect(legend.getByTestId("legend-caption")).toContainText("Typical home price, all homes");
  await expect(page.getByTestId("typical-price-types")).toHaveCount(0);
  const details = await openScaleSettings(page);
  await details.getByTestId("view-typical-price-typical-price-terraced").click();
  await expect(page).toHaveURL(/layer=typical-price-terraced/);
  await expect(legend.getByTestId("legend-caption")).toContainText("Typical home price, terraced");
  // No help link in the menu: the legend "?" explains the layer (v3 Fix 22.8).
  await expect(page.getByTestId("layers-panel").getByTestId("legend-help")).toHaveCount(0);
  // The layer is area-level only: no parcels, no house-level map.
  await expect(page.getByTestId("parcel-attribution")).toHaveCount(0);
});

// #31: a Land Registry title can cover a whole estate. Hovering a home on it must not tint the
// estate, and choosing it marks the home itself. The property tile is served from a fixture: one
// title of three homes, about 400 m across (17 ha), round the preview home (1 Parliament Preview).
test("a title over a whole estate is not lit up by hover; choosing a home on it marks the home", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "hover needs a pointer");
  const { geoJSONToTile } = await import("@maplibre/geojson-vt");
  const { fromGeojsonVt } = await import("@maplibre/vt-pbf");
  const [lng, lat] = [-0.1416, 51.501];
  const estate = {
    type: "FeatureCollection",
    features: [{
      type: "Feature", id: 7,
      properties: { id: 7, dwellings: 3, area: 170_000, latest_sale: "2019-05", uprn: "100000000001", address_id: "uk:addr:a1b2c3d4e5f6" },
      geometry: { type: "Polygon", coordinates: [[[lng - 0.003, lat - 0.0018], [lng + 0.003, lat - 0.0018], [lng + 0.003, lat + 0.0018], [lng - 0.003, lat + 0.0018], [lng - 0.003, lat - 0.0018]]] },
    }],
  } as const;
  await page.route("**/api/v1/tiles/properties/**", (route) => {
    const [z, x, y] = new URL(route.request().url()).pathname.replace(".pbf", "").split("/").slice(-3).map(Number);
    const tile = geoJSONToTile(estate as never, z, x, y, { clip: true });
    if (!tile?.features.length) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 200, contentType: "application/vnd.mapbox-vector-tile", body: Buffer.from(fromGeojsonVt({ parcels: tile }, { version: 2, extent: 4096 })) });
  });
  await page.goto("/?diagnostics=1&layer=price-per-square-metre&zoom=16&lat=51.501&lng=-0.1416");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  const canvas = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await expect.poll(() => page.evaluate(() => typeof window.__closeKnitDiagnostics?.project)).toBe("function");
  const home = await page.evaluate((at) => window.__closeKnitDiagnostics!.project(at), [lng, lat] as [number, number]);
  // On the title, 170 px from the home (about 130 m); and off it, on the area beside.
  const on = { x: canvas.x + home.x - 150, y: canvas.y + home.y - 80 };
  const off = { x: canvas.x + home.x - 400, y: canvas.y + home.y - 80 };
  const clip = { x: on.x - 50, y: on.y - 50, width: 30, height: 30 };
  const tooltip = page.locator(".map-tooltip");
  await expect(async () => {
    await page.mouse.move(on.x, on.y, { steps: 5 });
    await expect(tooltip).toContainText("3 dwellings on this parcel", { timeout: 1_000 });
  }).toPass();
  await expect(tooltip).toContainText("Outline: their land title, wider than the homes");
  // Off the title, then back over it: its fill does not change.
  await page.mouse.move(off.x, off.y, { steps: 5 });
  await expect(tooltip).toBeHidden();
  // At rest: the same in two shots 200 ms apart.
  let resting: Buffer | null = null;
  await expect.poll(async () => {
    const next = await page.screenshot({ clip });
    const still = !!resting && next.equals(resting);
    resting = next;
    return still;
  }, { intervals: [200] }).toBe(true);
  await page.mouse.move(on.x, on.y, { steps: 5 });
  await expect(tooltip).toContainText("3 dwellings on this parcel");
  await expectSteady(async () => expect((await page.screenshot({ clip })).equals(resting!), "hovering the estate tints it").toBe(true), 400);
  // Choosing it marks the home, not the title.
  await page.mouse.click(on.x, on.y);
  const ring = page.getByTestId("chosen-home");
  await expect(ring).toBeVisible();
  await expect(tooltip).toBeHidden();
  const box = (await ring.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (canvas.x + home.x))).toBeLessThan(3);
  expect(Math.abs(box.y + box.height / 2 - (canvas.y + home.y))).toBeLessThan(3);
});
