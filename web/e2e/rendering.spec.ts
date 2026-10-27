import { expect, test } from "./fixtures";
import { addChip, continueToReview, matchItem } from "./wizard";
import { openMatchBuilder } from "./top-bar";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop rendering contract");
});

test("MapLibre worker loads analytics geometry", async ({ page }) => {
  // PR #284: Price per m² opens on Rank in London; ?scale=linear keeps this on Actual.
  await page.goto("/?diagnostics=1&scale=linear");
  await expect(page.locator(".map-status")).toHaveText("Map ready");

  // Cold dev servers compile the fixtures-heavy value-pack route on first
  // hit, so diagnostics acquisition allows startup latency; assertions stay.
  // Predicates stay null-safe: a throwing probe retried every poll
  // interval starves the install it waits for (observed 30s stall vs ~2s).
  await expect.poll(
    () => page.evaluate(() => window.__closeKnitDiagnostics?.sourceAreaCount() ?? -1),
    { timeout: 30_000 },
  ).toBeGreaterThan(0);
  await expect.poll(
    () => page.evaluate(() => window.__closeKnitDiagnostics?.featureValue("uk:lsoa:E01000001") ?? null),
  ).toBe(9_600);
  await expect.poll(
    () => page.evaluate(() => window.__closeKnitDiagnostics?.renderedFeatureIds() ?? []),
  ).toContain("uk:lsoa:E01000001");
});

test("style updates stay within the 10 ms p95 frame-work budget", async ({ page }, testInfo) => {
  await page.goto("/?diagnostics=1");
  // PR #106 (v4.0 MapToast) added a second role=status (the toast region): name the map's own.
  await expect(page.locator(".map-status")).toHaveText("Map ready");

  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
  }));
  await expect.poll(
    () => page.evaluate(() => typeof window.__closeKnitDiagnostics),
    { timeout: 30_000 },
  ).toBe("object");
  const geometryBefore = await page.evaluate(() => window.__closeKnitDiagnostics.geometryUpdateCount());
  const p95 = await page.evaluate(() => window.__closeKnitDiagnostics.measureStyleUpdate(40));
  const geometryAfter = await page.evaluate(() => window.__closeKnitDiagnostics.geometryUpdateCount());
  testInfo.annotations.push({
    type: "frame-work-budget",
    description: `p95=${p95.toFixed(2)}ms over 40 style updates; ${JSON.stringify(environment)}`,
  });
  // eslint-disable-next-line no-console
  console.log(`frame-work p95=${p95.toFixed(2)}ms env=${JSON.stringify(environment)}`);

  expect(p95).toBeLessThanOrEqual(10);
  expect(geometryAfter).toBe(geometryBefore);
});

test("evidence remains usable when the basemap style fails", async ({ page }) => {
  await page.route("**/api/v1/style*", (route) => route.abort());
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");

  await expect(page.getByTestId("evidence-panel")).toContainText("St James's");
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£9,600");
  await expect(page.locator(".map-status")).toHaveText("Basemap unavailable; analytics remain usable");
});

test("evidence remains usable without a WebGL context", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: never[]
    ) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return (original as Function).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");

  await expect(page.getByTestId("map-fallback")).toBeVisible();
  await expect(page.getByTestId("evidence-panel")).toContainText("St James's");
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£9,600");
});

test("desktop overview is visually stable", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06&pitch=45&diagnostics=1");
  await waitForMapPaint(page);
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

  await expect(page).toHaveScreenshot("london-price-overview.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.015,
  });
});

test("sparse price evidence is visually explicit", async ({ page }) => {
  // PR #284: Price per m² opens on Rank in London; ?scale=linear keeps this on Actual.
  await page.goto("/?selected=uk%3Amsoa%3AE02000002&period=2026-06&pitch=45&diagnostics=1&scale=linear");
  await waitForMapPaint(page);
  // A wider area has the one area view (v4.4): its tiles, never a price for one home (v4 Task 12); no About this data fold (v3 Fix 22.8).
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£");
  await expect(page.getByTestId("home-cost")).toHaveCount(0);
  await expect(page.getByTestId("about-this-data")).toHaveCount(0);

  await expect(page).toHaveScreenshot("sparse-price-fallback.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.015,
  });
});

test("close zoom renders neutral 3D buildings", async ({ page }) => {
  // Every layer keeps the grey relief; on the price layer the clear parcels show the area's colour under it.
  await page.goto("/?lat=51.503&lng=-0.144&zoom=15.5&pitch=55&layer=crime&selected=uk%3Alsoa%3AE01000001&diagnostics=1");
  await waitForMapPaint(page);
  // The Tube overlay arrives on its own schedule; this baseline is about the buildings.
  await page.evaluate(() => window.__closeKnitDiagnostics?.hideTransit());
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  await expect(page).toHaveScreenshot("close-zoom-3d-buildings.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.015,
  });
});

test("personal match choropleth keeps score and evidence textual", async ({ page }) => {
  await page.goto("/?diagnostics=1");
  await openMatchBuilder(page);
  await continueToReview(page);
  await page.getByTestId("match-ranking").getByRole("button", { name: /preview/ }).first().click();
  // The pointer would otherwise rest over the panel's buttons (hover tint in the baseline): park it over empty map.
  await page.mouse.move(700, 250);
  await waitForMapPaint(page);
  // The Tube overlay arrives on its own schedule; this baseline is about the match colours.
  await page.evaluate(() => window.__closeKnitDiagnostics?.hideTransit());
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  await expect(page).toHaveScreenshot("personal-match-selected.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.015,
  });
});

test("priority changes update feature state without rebuilding geometry", async ({ page }) => {
  // Start on the match layer so the geometry baseline is the match pack:
  // settling from the default price pack would rebuild once by design.
  await page.goto("/?diagnostics=1&layer=personal-match");
  await openMatchBuilder(page);
  await continueToReview(page);
  await expect(page.getByTestId("match-ranking")).toBeVisible();
  await waitForMapPaint(page);
  const before = await page.evaluate(() => window.__closeKnitDiagnostics?.geometryUpdateCount() ?? -1);
  expect(before).toBeGreaterThan(0);

  // "Safer streets" joins the list, then becomes a Must on its card (v4 Task 21c).
  await addChip(page, "safer-streets");
  await matchItem(page, "range:crime").getByTestId("match-chip").click();
  await page.getByTestId("match-card-range:crime").getByTestId("match-card-must").click();
  await expect(matchItem(page, "range:crime").getByTestId("match-item-rank")).toHaveText("Must");
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.geometryUpdateCount() ?? -1)).toBe(before);
});

async function waitForMapPaint(page: import("@playwright/test").Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 10_000 });
  await expect.poll(
    () => page.evaluate(() => window.__closeKnitDiagnostics?.renderedAreaCount() ?? -1),
    { timeout: 30_000 },
  ).toBeGreaterThan(0);
  // "Map ready" fires at style load (layer load phase C): the area labels and the Tube network load after the
  // first idle. Wait for the layer's paint, both overlays' data and a settled map, so a baseline never races them.
  await expect(page.locator(".map-stage")).toHaveAttribute("data-painting", "false", { timeout: 30_000 });
  await expect.poll(
    () => page.evaluate(() => {
      const map = window.__closeKnitMap;
      if (!map) return "no map";
      // Both get their data at the same first idle; loaded() then covers the labels (none at street zoom).
      if (!map.querySourceFeatures("tfl-network").length) return "no Tube yet";
      return map.loaded() && !map.isMoving() ? "idle" : "busy";
    }),
    { timeout: 30_000 },
  ).toBe("idle");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

declare global {
  interface Window {
    __closeKnitDiagnostics: {
      measureStyleUpdate(iterations: number): number;
      renderedAreaCount(): number;
      sourceAreaCount(): number;
      fillSource(): string;
      hideTransit(): void;
      featureValue(id: `uk:${"lsoa" | "msoa" | "lad"}:${string}`): unknown;
      renderedFeatureIds(): (string | number | undefined)[];
      renderedArrows(): { layer: string; id: string | number | undefined }[];
      renderedAreaLabels(): { kind: string; label: string }[];
      layerIds(): string[];
      debug(): unknown;
      geometryUpdateCount(): number;
      paintProperty(layer: string, property: string): unknown;
      renderedCount(layer: string, at?: [number, number]): number;
      layoutProperty(layer: string, property: string): unknown;
      geojsonKinds(source: string): string[];
      project(lngLat: [number, number]): { x: number; y: number };
      renderedPoints(layer: string): { x: number; y: number; properties: Record<string, unknown> }[];
      morph(): { morphing: boolean; progress: number; weight: number; landed: number; samples: { at: number; writeMs: number; position: number; weight: number }[]; period: string | null };
      refreshTimings(): { period: string; fetchMs: number; applyMs: number }[];
    };
  }
}
