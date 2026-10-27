import { expect, test } from "./fixtures";
import { openEvidenceSection } from "./evidence";
import { showTimeline } from "./top-bar";

// UX-36: housing content names its geography (in words, never "LSOA") and
// period: the full page's prices by type and its crime rows. The panel's tiles keep
// today's figure whatever the month (v4 Task 12).
test("housing timeline names its area in words and its period", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");
  // At the newest month the brief's price tile carries the figure.
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£9,600");
  await showTimeline(page);
  await page.getByLabel("Price period").press("Home");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-period", "2006-06");
  await expect(page.getByTestId("raw-value")).toHaveCount(0);
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£9,600");
  await page.getByLabel("Price period").press("End");

  await openEvidenceSection(page, "Price & market");
  const lead = page.getByTestId("price-types").locator(".price-types__lead");
  await expect(lead).toContainText(/[Ss]ales in (this neighbourhood|the wider .+ area)/);
  await expect(lead).toContainText(/12 months to [A-Z][a-z]{2} \d{4}/);
  await expect(page.getByTestId("price-types")).not.toContainText("LSOA");

  const safety = await openEvidenceSection(page, "Safety & services");
  await expect(safety.getByTestId("safety-types")).toContainText("Top offences per 1,000 a year · St James's");
  await expect(safety.getByTestId("safety-key-numbers")).toContainText(/Period12 months to [A-Z][a-z]{2} \d{4}/);
  await expect(safety).not.toContainText("LSOA");
});
