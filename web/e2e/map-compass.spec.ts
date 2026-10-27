import { expect, test, type Page } from "./fixtures";

// Map controls PR 1: the compass chip shows only while the map is turned or tilted; a tap puts the map back
// to north and flat, keeping its centre and zoom, and the chip goes; Escape deselects the area last.

async function mapReady(page: Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
}

/** The map itself, under ?diagnostics=1. */
async function mapHandle(page: Page) {
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => typeof window.__closeKnitMap)).toBe("object");
}

test("the compass appears when the map turns and a tap brings it back to north", async ({ page }) => {
  await page.goto("/?diagnostics=1&lat=51.5&lng=-0.12&zoom=13&pitch=0");
  await mapHandle(page);
  const compass = page.getByTestId("map-compass");
  await expect(compass).toHaveCount(0);

  await page.evaluate(() => window.__closeKnitMap!.setBearing(30));
  await expect(compass).toBeVisible();
  await expect(compass).toHaveAttribute("aria-label", "Back to north");
  await expect(compass).not.toHaveAttribute("data-pitched", "true");
  const before = await page.evaluate(() => window.__closeKnitCamera!());

  await compass.click();
  await expect.poll(() => page.evaluate(() => window.__closeKnitCamera!().bearing)).toBeCloseTo(0, 3);
  await expect(compass).toHaveCount(0);
  const after = await page.evaluate(() => window.__closeKnitCamera!());
  expect(after.zoom).toBeCloseTo(before.zoom, 3);
  expect(after.lng).toBeCloseTo(before.lng, 4);
  expect(after.lat).toBeCloseTo(before.lat, 4);
});

test("a tilt shows the compass with its arc; the tap flattens the map and Map settings reads 2D", async ({ page }) => {
  await page.goto("/?diagnostics=1&lat=51.5&lng=-0.12&zoom=13&pitch=0");
  await mapHandle(page);
  const compass = page.getByTestId("map-compass");
  await page.evaluate(() => window.__closeKnitMap!.setPitch(45));
  await expect(compass).toBeVisible();
  await expect(compass).toHaveAttribute("data-pitched", "true");
  await compass.click();
  await expect.poll(() => page.evaluate(() => window.__closeKnitCamera!().pitch)).toBeCloseTo(0, 3);
  await expect(compass).toHaveCount(0);
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-map-pitch", "0");
});

test("Escape deselects the chosen area once nothing else is open", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await mapReady(page);
  await expect(page.getByTestId("map-dock")).not.toHaveAttribute("data-area", "empty");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-area", "empty");
  await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toBeNull();
});
