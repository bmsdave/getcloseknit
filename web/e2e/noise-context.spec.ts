import { expect, test } from "./fixtures";
import { openEvidenceSection } from "./evidence";
import { REAL_AREA, REAL_NOISE, routeRealEvidence } from "./real-environment";
import { longParagraphs } from "./text-density";

// Noise in the area card is one row of Green & quiet (v3 Fix 33.6; the strips that repeat the tiles are
// gone): the share of homes over 55 dB with London in words, never a pilot form and never a quietness
// claim. Its method and licence sit in the section's ⓘ.
const SEED_OFF = { "x-close-knit-seed": "off" };

test("the card has no noise pilot: without figures Green & quiet has no noise row", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  const section = await openEvidenceSection(page, "Environment");
  await expect(section.getByTestId("environment-key-numbers")).toBeVisible();
  await expect(section.getByTestId("noise-share")).toHaveCount(0);
  await expect(page.getByTestId("noise-context")).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Record visit" })).toHaveCount(0);
});

test("a corridor gap never renders as a quietness guarantee", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000002");
  const section = await openEvidenceSection(page, "Environment");
  // No noise figures here: no noise row, never "quiet" or 0%.
  const rows = section.getByTestId("environment-key-numbers");
  await expect(rows.getByTestId("flood-bands")).toBeVisible();
  await expect(rows.getByTestId("noise-share")).toHaveCount(0);
  await expect(rows).not.toContainText(/quiet|\b0%/i);
});

test("real noise is one row of homes over 55 dB against London, its method in the section's ⓘ", async ({ page }) => {
  // The browser reads the sections (no server-rendered seed), so the routes apply.
  await page.setExtraHTTPHeaders(SEED_OFF);
  await routeRealEvidence(page);
  await page.goto(REAL_AREA);
  const section = await openEvidenceSection(page, "Environment");
  const rows = section.getByTestId("environment-key-numbers");
  await expect(rows.getByTestId("noise-share")).toContainText(/Homes over 55 dB64\.9% · London \d+%/);
  await expect(rows).toContainText("Median 55.5 dB");
  // PR #303 (audit wording): "362 recorded homes".
  await expect(page.getByTestId("card-sources-environment")).toContainText("362 recorded homes");
  await expect(page.getByTestId("card-sources-environment")).toContainText("Defra strategic noise mapping");
  expect(await longParagraphs(page)).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("an area without noise figures leaves the noise row out, and the ⓘ links to why", async ({ page }) => {
  await page.setExtraHTTPHeaders(SEED_OFF);
  await routeRealEvidence(page, { ...REAL_NOISE, available: false });
  await page.goto(REAL_AREA);
  const section = await openEvidenceSection(page, "Environment");
  // One empty state per fact: the flood row stays; there is no noise row.
  const rows = section.getByTestId("environment-key-numbers");
  await expect(rows.getByTestId("flood-bands")).toBeVisible();
  await expect(rows.getByTestId("noise-share")).toHaveCount(0);
  const sources = page.getByTestId("card-sources-environment");
  await sources.locator("summary").click();
  await expect(sources.getByRole("link", { name: "Why?" })).toHaveAttribute("href", "/guide/noise");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
