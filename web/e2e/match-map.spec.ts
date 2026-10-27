import { expect, test, type Page } from "./fixtures";

import { SEEDED_SEARCH, seedSearch, typeBudget } from "./wizard";

// v4 Task 21e (My match map), Task 8 map part (zones), G5 Task 29 (night) on the preview data.
const SOUTH_BANK_ID = "uk:lsoa:E01000003";

type Diagnostics = {
  featureValue(id: string): unknown;
  renderedCount(layer: string, at?: [number, number]): number;
  project(lngLat: [number, number]): { x: number; y: number };
  renderedFeatureIds(): (string | number | undefined)[];
  paintProperty(layer: string, property: string): unknown;
};
type Probe = { __closeKnitDiagnostics?: Diagnostics };
const mapValue = (page: Page, id: string) => page.evaluate((area) =>
  (window as unknown as Probe).__closeKnitDiagnostics?.featureValue(area) ?? null, id);
const paint = (page: Page, layer: string, property: string) => page.evaluate(([name, key]) =>
  (window as unknown as Probe).__closeKnitDiagnostics?.paintProperty(name, key) ?? null, [layer, property]);
const renderedValues = (page: Page) => page.evaluate(() => {
  const d = (window as unknown as Probe).__closeKnitDiagnostics;
  return d ? d.renderedFeatureIds().map((id) => d.featureValue(String(id))) : [];
});

test("every scored area is coloured by its band, best to least like the search; a failed Must is hatched, not red", async ({ page }) => {
  // Crime ≤ 60 as a Must (in place of the seeded crime criterion: one per layer): South Bank (crime 76) fails it.
  await seedSearch(page, {
    factors: SEEDED_SEARCH.factors.filter((factor) => factor.factorId !== "crime"),
    ranges: [{ layer: "crime", min: null, max: 60, softMin: null, softMax: null, importance: 3, must: true }],
  });
  await page.goto("/?diagnostics=1&layer=personal-match");
  await expect(page.getByTestId("match-ranking")).toBeVisible();
  await expect.poll(() => mapValue(page, SOUTH_BANK_ID)).toBeNull();
  // The LSOAs' hatch (on their area tiles) holds the areas that fail the Must, South Bank among them.
  await expect.poll(async () => JSON.stringify(await paint(page, "match-out-hatch-lsoa", "fill-pattern"))).toContain("match-hatch");
  await expect.poll(() => page.evaluate(() => (window as unknown as Probe).__closeKnitDiagnostics?.renderedCount("match-out-hatch-lsoa") ?? 0))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => {
    const map = (window as unknown as { __closeKnitMap: import("maplibre-gl").Map }).__closeKnitMap;
    return [...new Set(map.queryRenderedFeatures({ layers: ["match-out-hatch-lsoa"] }).map((feature) => feature.id))];
  })).toContain(1000003);
});

test("with no Must, the bands spread from deep red (0) to deep blue (6)", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/?diagnostics=1&layer=personal-match");
  await expect(page.getByTestId("match-ranking")).toBeVisible();
  await expect.poll(async () => [...new Set((await renderedValues(page)).filter((value) => value !== null))])
    .toEqual(expect.arrayContaining([0, 6]));
  for (const value of await renderedValues(page)) if (value !== null) expect([0, 1, 2, 3, 4, 5, 6]).toContain(value);
});

test("Bottom 10 (?list=bottom): red pins −1 …; Top 10 pins stay in ink", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/?layer=personal-match&list=bottom");
  const pins = page.getByTestId("match-map-area");
  await expect(pins.first()).toBeAttached();
  await expect(pins.filter({ hasText: "−1" })).toHaveCount(1);
  expect(await pins.evaluateAll((all) => all.every((pin) => pin.classList.contains("bm-bottom")))).toBe(true);
  // Pins are redrawn as the brief settles: read the colour of the one on the map now.
  await expect.poll(() => pins.filter({ hasText: "−1" }).locator("b")
    .evaluate((badge) => (badge.isConnected ? getComputedStyle(badge).backgroundColor : "")).catch(() => "")).toBe("rgb(178, 24, 43)");
  // The list stays in the address; the top again drops it.
  await expect(page).toHaveURL(/list=bottom/);
  await page.goto("/?layer=personal-match");
  await expect(pins.first()).toBeAttached();
  await expect(pins.filter({ hasText: "−1" })).toHaveCount(0);
  expect(await pins.evaluateAll((all) => all.some((pin) => pin.classList.contains("bm-bottom")))).toBe(false);
  await expect.poll(() => pins.first().locator("b")
    .evaluate((badge) => (badge.isConnected ? getComputedStyle(badge).backgroundColor : "")).catch(() => "")).toBe("rgb(34, 37, 44)");
});

test("before any criterion the map is neutral with a hint, not every area grey under the match legend (v4.2)", async ({ page }) => {
  await page.goto("/?diagnostics=1");
  // The default layer paints first (and installs the diagnostics); then My match opens with nothing in it.
  await expect.poll(() => mapValue(page, SOUTH_BANK_ID), { timeout: 15_000 }).not.toBeNull();
  const start = page.getByTestId("intro-find");
  await ((await start.isVisible()) ? start : page.getByTestId("find-my-area")).click();
  await expect(page.getByTestId("match-list")).toBeVisible();
  const legend = page.getByTestId("map-legend").filter({ visible: true }).first();
  await expect(legend.getByTestId("legend-match-empty")).toHaveText("Add a budget or what matters to colour the map");
  await expect(legend.getByTestId("legend-match")).toHaveCount(0);
  await expect.poll(() => paint(page, "area-fill-lsoa", "fill-color")).toBe("rgba(0, 0, 0, 0)");
  // The budget colours it: the match ramp and its key come back.
  await typeBudget(page, "650k");
  await expect(legend.getByTestId("legend-match")).toBeVisible();
  await expect(legend.getByTestId("legend-match-empty")).toHaveCount(0);
  await expect.poll(() => paint(page, "area-fill-lsoa", "fill-color")).not.toBe("rgba(0, 0, 0, 0)");
});

test("a station or borough zone is outlined from its loaded shape, like a drawn one (v4.2)", async ({ page }) => {
  const shapes: unknown[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/v1/zone-shapes")) shapes.push(request.postDataJSON()); });
  await seedSearch(page, { zones: [
    { kind: "station", stationId: "osm:n9000001", maxWalkMinutes: 10, label: "Westminster preview station" },
    { kind: "borough", id: "uk:lad:E09000002", label: "Islington preview" },
  ] });
  await page.goto("/?diagnostics=1&layer=personal-match");
  await expect(page.getByTestId("match-ranking")).toBeVisible();
  await expect.poll(() => paint(page, "zone-draw-line", "line-dasharray"), { timeout: 15_000 }).toEqual([3, 2]);
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    __closeKnitDiagnostics: { geojsonKinds(source: string): string[] };
  }).__closeKnitDiagnostics.geojsonKinds("zone-draw"))).toEqual(["zone", "zone"]);
  // One question for the two zones (dev mode may mount twice): the same zones, never re-asked per render.
  expect(new Set(shapes.map((body) => JSON.stringify(body))).size).toBe(1);
  expect(shapes.length).toBeLessThanOrEqual(2);
});

test("at night the match outlines and zones are drawn in the night ink, and the legend keeps its bands", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await seedSearch(page, { zones: [{ kind: "polygon", points: [[51.51, -0.13], [51.51, -0.11], [51.5, -0.11], [51.5, -0.13]] }] });
  await page.goto("/?diagnostics=1&layer=personal-match");
  await expect(page.getByTestId("match-ranking")).toBeVisible();
  await expect.poll(() => paint(page, "zone-draw-line", "line-color"), { timeout: 15_000 }).toBe("#f4f7fa");
  expect(await paint(page, "zone-draw-line", "line-dasharray")).toEqual([3, 2]);
  expect(await paint(page, "zone-draw-fill", "fill-opacity")).toBe(0.06);
  await expect.poll(() => paint(page, "match-brief-top-line", "line-color")).toBe("#f4f7fa");
  const bar = page.getByTestId("map-legend").filter({ visible: true }).first().locator(".map-legend-bar");
  await expect(bar).toHaveAttribute("data-colours", "#b2182b #ef8a62 #fddbc7 #f2f2f2 #d1e5f0 #67a9cf #2166ac");
});

test("the popup's score badge is red for an area in the bottom 10% of the search, not for the best", async ({ page }, testInfo) => {
  // The preview areas sit under the phone sheet: the taps run on the desktop map.
  test.skip(testInfo.project.name === "mobile", "the preview areas sit under the phone sheet");
  await seedSearch(page);
  await page.goto("/?diagnostics=1&layer=personal-match");
  await expect(page.getByTestId("match-ranking")).toBeVisible();
  const names: Record<string, string> = { "uk:lsoa:E01000001": "Westminster preview", [SOUTH_BANK_ID]: "South Bank preview" };
  await expect.poll(async () => (await Promise.all(Object.keys(names).map((id) => mapValue(page, id))))
    .every((value) => value !== null)).toBe(true);
  const project = (at: [number, number]) => page.evaluate((lngLat) => (window as unknown as {
    __closeKnitDiagnostics: { project(at: [number, number]): { x: number; y: number } };
  }).__closeKnitDiagnostics.project(lngLat), at);
  // The map fits the results once: wait until the camera has settled before tapping.
  let last = "";
  await expect.poll(async () => {
    const now = JSON.stringify(await project([-0.12, 51.5]));
    const settled = now === last;
    last = now;
    return settled;
  }, { intervals: [500] }).toBe(true);
  const popup = page.getByTestId("match-fit-popup");
  const canvas = (await page.locator(".maplibregl-canvas").boundingBox())!;
  // Tap a grid over central London until the popup names the area (a numbered pin or the panel may cover a point).
  const openPopup = async (name: string) => {
    for (let lng = -0.17; lng <= -0.07; lng += 0.01) {
      for (let lat = 51.485; lat <= 51.525; lat += 0.005) {
        const point = await project([lng, lat]);
        const x = canvas.x + point.x, y = canvas.y + point.y;
        const onMap = await page.evaluate(([px, py]) =>
          document.elementFromPoint(px, py)?.classList.contains("maplibregl-canvas") ?? false, [x, y]);
        if (!onMap) continue;
        await page.mouse.click(x, y);
        if (((await popup.textContent({ timeout: 500 }).catch(() => "")) ?? "").includes(name)) return true;
      }
    }
    return false;
  };
  let checked = 0;
  for (const [id, name] of Object.entries(names)) {
    const band = await mapValue(page, id);
    if (band !== 0 && band !== 6) continue;
    expect(await openPopup(name)).toBe(true);
    // Band 0 is the bottom 5 %: a red badge, with words for screen readers; band 6 (the best) stays plain.
    if (band === 0) {
      await expect(popup.getByTestId("match-fit-bottom")).toContainText("bottom 10% of your search");
      await expect(popup.getByTestId("match-fit-bottom")).toHaveCSS("background-color", "rgb(178, 24, 43)");
    } else {
      await expect(popup.locator(".fit-popup__score")).toBeVisible();
      await expect(popup.getByTestId("match-fit-bottom")).toHaveCount(0);
    }
    // v4.5 (round 2 #47): the list's 0–100 score, never x/10.
    await expect(popup.locator(".fit-popup__score")).toHaveText(/^\d{1,3} of 100/);
    await expect(popup).not.toContainText("/10");
    checked += 1;
  }
  expect(checked).toBeGreaterThan(0);
});
