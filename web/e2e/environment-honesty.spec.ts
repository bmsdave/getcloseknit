import { expect, test } from "./fixtures";
import { openEvidenceSection } from "./evidence";

// UX-37: under Environment, missing coverage is never presented as safety,
// quietness, or zero exposure — for uncovered areas, for unavailable views,
// and across view switches.
test("uncovered area states unknown flood and noise together", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000002");
  await openEvidenceSection(page, "Environment");

  // Demo flood bands for this area are all very low: Green & quiet names each source's highest band in
  // words (v3 Fix 33.6), never "safe"; "shares of the area's land" is in the ⓘ.
  const rows = page.getByTestId("environment-key-numbers");
  await expect(rows.getByTestId("flood-bands")).toContainText("rivers and sea: very low");
  await expect(page.getByTestId("card-sources-environment").first()).toContainText("shares of the area's land");
  await expect(rows.getByText(/flood score/i)).toHaveCount(0);

  // No strategic noise figures here: no noise row, never quiet or 0%.
  await expect(rows.getByTestId("noise-share")).toHaveCount(0);
  await expect(rows).not.toContainText(/quiet|\b0%/i);
});

test("environment tab never claims safety, quiet, or zero exposure", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  const tab = await openEvidenceSection(page, "Environment");
  await expect(tab.getByTestId("flood-bands")).toBeVisible();

  for (const claim of [
    /you are safe/i,
    /\bis safe\b/i,
    /no flood risk/i,
    /low flood risk/i,
    /quiet neighbourhood/i,
    /peaceful area/i,
    /zero exposure/i,
  ]) {
    await expect(tab.getByText(claim)).toHaveCount(0);
  }
});
