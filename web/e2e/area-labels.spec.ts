import { expect, test, type Page } from "./fixtures";
import { openAreaPage } from "./evidence";

const WESTMINSTER = "uk:lsoa:E01000001" as const;

function renderedLabels(page: Page) {
  return () => page.evaluate(() => window.__closeKnitDiagnostics?.renderedAreaLabels() ?? []);
}

async function openMap(page: Page, zoom: number, lat: number, lng: number) {
  await page.goto(`/?layer=price-per-square-metre&period=2026-06&zoom=${zoom}&lat=${lat}&lng=${lng}&diagnostics=1`);
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect.poll(() => page.evaluate((id) => window.__closeKnitDiagnostics?.featureValue(id) ?? null, WESTMINSTER),
    { timeout: 30_000 }).not.toBeNull();
}

test("zoomed out, each borough is labelled once and no LSOA code shows", async ({ page }) => {
  await openMap(page, 10, 51.52, -0.1);
  await expect.poll(async () => (await renderedLabels(page)()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const labels = await renderedLabels(page)();
  expect(labels.map((label) => label.kind)).toEqual(labels.map(() => "borough"));
  const texts = labels.map((label) => label.label);
  expect(new Set(texts).size).toBe(texts.length);
  expect(texts).toContain("Westminster");
  for (const text of texts) expect(text).not.toMatch(/\d{3}[A-Z]?$/);
});

test("at mid zoom, postcode districts are labelled once each with a neighbourhood name", async ({ page }) => {
  await openMap(page, 12.5, 51.51, -0.12);
  await expect.poll(async () => (await renderedLabels(page)()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const labels = await renderedLabels(page)();
  expect(labels.map((label) => label.kind)).toEqual(labels.map(() => "district"));
  const texts = labels.map((label) => label.label);
  expect(new Set(texts).size).toBe(texts.length);
  expect(texts).toContain("SW1A · St James's");
  for (const text of texts) expect(text).toMatch(/^[A-Z]{1,2}\d[A-Z\d]? · /);
});

test("at street zoom the map draws no area labels", async ({ page }) => {
  await openMap(page, 15, 51.501, -0.1416);
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.layerIds() ?? []))
    .toEqual(expect.arrayContaining(["area-labels-borough", "area-labels-district"]));
  expect(await renderedLabels(page)()).toEqual([]);
});

test("the panel titles an area by its neighbourhood and postcode district only; the official name is in Sources", async ({ page }) => {
  await page.goto(`/?selected=${WESTMINSTER}`);
  const title = page.getByTestId("selected-area");
  // Sight and screen readers alike get the friendly name only.
  await expect(title).toHaveText("St James's · SW1A");
  await expect(page.getByRole("heading", { level: 1, name: "St James's · SW1A", exact: true })).toBeVisible();
  await expect(page.getByTestId("area-title-code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "About this area's official name" })).toHaveCount(0);
  // The full page names it once, in Sources.
  await openAreaPage(page);
  await expect(page.getByTestId("area-page-title")).toHaveText("St James's · SW1A");
  await expect(page.getByTestId("area-official-name")).toContainText("Westminster preview (E01000001)");
});
