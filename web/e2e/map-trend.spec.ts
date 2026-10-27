import { expect, test, type Page } from "./fixtures";

import { chooseLayer, chooseView, openLayerExplainer, openScaleSettings } from "./evidence";

const WESTMINSTER = "uk:lsoa:E01000001" as const;

function valueOf(page: Page) {
  return () => page.evaluate((id) => window.__closeKnitDiagnostics?.featureValue(id) ?? null, WESTMINSTER);
}

test("the change scale colours price per m² by its change and shows a diverging legend", async ({ page }) => {
  // PR #284: Price per m² opens on Rank in London; ?scale=linear keeps this on Actual.
  await page.goto("/?layer=price-per-square-metre&period=2026-06&diagnostics=1&scale=linear");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect.poll(valueOf(page), { timeout: 30_000 }).toBe(9_600);

  await chooseView(page, "price-per-square-metre", "change");
  // 2021-06 £8,238 → 2026-06 £9,600 in the fixtures.
  await expect.poll(valueOf(page)).toBe(16.5);
  const legend = page.getByTestId("legend-change");
  await expect(legend).toContainText("−50%");
  await expect(legend).toContainText("0%");
  await expect(legend).toContainText("+50%");
  await expect(page.getByTestId("map-legend")).toContainText("5-year change to Jun 2026");
  await expect(page).toHaveURL(/scale=change/);
  await expect(page).toHaveURL(/window=5/);

  // "over 1 · 5 · 10 years", inline under Change (v3 Fix 4).
  await expect(page.getByTestId("change-window").locator("[data-testid^='change-window-']")).toHaveText(["1", "5", "10"]);
  await expect(page.getByTestId("change-window-5")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("change-window-10").click();
  await expect(page).toHaveURL(/window=10/);
  await expect.poll(valueOf(page)).not.toBe(16.5);
  await expect(page.getByTestId("map-legend")).toContainText("10-year change to Jun 2026");

  // How to read it is the legend's "?", not a (?) in the Layers menu (v3 Fix 22.8).
  await expect(page.getByTestId("change-window").locator(".help-tip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const explainer = await openLayerExplainer(page);
  await expect(explainer.getByTestId("layer-explainer-points")).toContainText("Price change over 10 years");
  await page.keyboard.press("Escape");

  // Change is a price-only view: Crime has no views (only its types) and paints actual values.
  await chooseLayer(page, "crime");
  await expect(page.getByTestId("map-legend")).toContainText("Crimes per 1,000");
  await expect(page.getByTestId("legend-change")).toHaveCount(0);
  const details = await openScaleSettings(page);
  await expect(details.locator("[data-testid^='view-crime-']")).toHaveCount(0);
  await expect(details.getByTestId("crime-filter")).toBeVisible();
});

test("a shared change link restores the scale and arrows appear from zoom 13", async ({ page }) => {
  await page.goto("/?layer=price-per-square-metre&period=2026-06&scale=change&window=5&zoom=11&lat=51.501&lng=-0.1416&diagnostics=1");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect.poll(valueOf(page), { timeout: 30_000 }).toBe(16.5);
  await openScaleSettings(page);
  await expect(page.getByTestId("view-price-per-square-metre-change")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("change-window-5")).toHaveAttribute("aria-pressed", "true");
  const arrows = () => page.evaluate(() => window.__closeKnitDiagnostics?.renderedArrows() ?? []);
  expect(await arrows()).toEqual([]);

  await page.goto("/?layer=price-per-square-metre&period=2026-06&scale=change&window=5&zoom=13&lat=51.501&lng=-0.1416&diagnostics=1");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect.poll(valueOf(page), { timeout: 30_000 }).toBe(16.5);
  await expect.poll(arrows).toContainEqual({ layer: "trend-arrows-up", id: WESTMINSTER });
  // Fixture prices only rise: no area may show a falling arrow.
  expect((await arrows()).filter((arrow) => arrow.layer === "trend-arrows-down")).toEqual([]);
  // The change scale (arrows included) keeps the rendering.spec.ts frame-work budget.
  expect(await page.evaluate(() => window.__closeKnitDiagnostics.measureStyleUpdate(40))).toBeLessThanOrEqual(10);
});

test("a window reaching before the price history says so instead of guessing", async ({ page }) => {
  await page.goto("/?layer=price-per-square-metre&period=2016-06&scale=change&window=20&diagnostics=1");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await openScaleSettings(page);
  // A window a link carries outside 1 · 5 · 10 shows as its own pill.
  await expect(page.getByTestId("change-window-20")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("change-unavailable")).toContainText("1996-06");
  await expect.poll(valueOf(page), { timeout: 30_000 }).toBeNull();
});
