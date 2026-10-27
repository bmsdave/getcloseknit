import { expect, test } from "./fixtures";
import { openEvidenceSection } from "./evidence";
import { REAL_AREA, routeRealEvidence } from "./real-environment";
import { longParagraphs } from "./text-density";

// Track I: the flood BFF answers demo mode from fixtures (no evidence API here).
test("demo flood bands for an area and a home", async ({ request }) => {
  const area = await request.get("/api/v1/areas/uk%3Alsoa%3AE01000001/flood?uprn=100000000001");
  expect(area.ok()).toBeTruthy();
  expect(await area.json()).toMatchObject({
    schemaVersion: "area-flood.v1",
    geographyId: "uk:lsoa:E01000001",
    available: true,
    riversSea: { highestBand: "medium", shares: { "very-low": 0.78, low: 0.18, medium: 0.04, high: 0 } },
    surfaceWater: { highestBand: "high" },
    dwelling: { uprn: "100000000001", riversSea: "low", surfaceWater: "very-low" },
    sourceVersion: "preview-ea-flood",
  });

  const borough = await request.get("/api/v1/areas/uk%3Aborough%3AE09000002/flood");
  expect(await borough.json()).toMatchObject({ riversSea: { highestBand: "very-low" }, dwelling: null });
});

test("unknown areas and malformed homes are errors, not very low", async ({ request }) => {
  expect((await request.get("/api/v1/areas/uk%3Alsoa%3AE01009999/flood")).status()).toBe(404);
  expect((await request.get("/api/v1/areas/uk%3Alsoa%3AE01000001/flood?uprn=12ab")).status()).toBe(400);
});

test("real flood bands are one row of Green & quiet (highest band per source), with the method and licence in its ⓘ", async ({ page }) => {
  await routeRealEvidence(page);
  await page.goto(REAL_AREA);
  const section = await openEvidenceSection(page, "Environment");

  // v3 Fix 33c: numbers and words, no strip; each source's highest band covering 1% of the land.
  const flood = page.getByTestId("flood-bands");
  await expect(flood).toContainText(/Flood \(highest band\)rivers and sea: medium · surface water: (very low|low|medium|high)/);
  // Sections above still loading can push it down after the scroll: with the section scrolled to, it is in view.
  await expect(async () => {
    await section.evaluate((node) => node.scrollIntoView({ block: "start" }));
    await expect(flood).toBeInViewport({ timeout: 1_000 });
  }).toPass();

  // Method, caveat and licence: folded in the section's one ⓘ.
  await expect(flood.locator("details")).toHaveCount(0);
  const sources = page.getByTestId("card-sources-environment");
  await expect(sources).not.toHaveAttribute("open");
  await sources.locator("summary").click();
  await expect(page.getByTestId("flood-area-caveat")).toContainText("for an area, not for a specific property");
  await expect(sources).toContainText("Environment Agency");
  expect(await longParagraphs(page)).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the flood headline names surface water when it is the worse source", async ({ page }) => {
  // Osidge-like: rivers and sea very low everywhere, surface water medium on part of the land.
  await page.route(/\/api\/v1\/areas\/[^/?]+\/flood/, (route) => route.fulfill({ json: {
    schemaVersion: "area-flood.v1", productReleaseId: "test", geographyId: "uk:lsoa:E01000001", available: true,
    riversSea: { shares: { "very-low": 1, low: 0, medium: 0, high: 0 }, highestBand: "very-low" },
    surfaceWater: { shares: { "very-low": 0.94, low: 0.04, medium: 0.01, high: 0.01 }, highestBand: "medium" },
    dwelling: null, sourceVersion: "preview-ea-flood", attribution: null, caveats: [],
  } }));
  // The area page's Green & quiet row gives each source's highest band (read by the browser, so the mock applies).
  await page.setExtraHTTPHeaders({ "x-close-knit-seed": "off" });
  await page.goto("/area/lsoa/E01000001");
  await expect(page.getByTestId("flood-bands")).toContainText("rivers and sea: very low · surface water: medium", { timeout: 30_000 });
});
