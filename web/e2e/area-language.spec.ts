import { expect, test } from "./fixtures";
import { openEvidenceSection } from "./evidence";

// UX-41: every value names the geography or property identity it describes —
// area statistics never borrow street, building, household, or property
// precision. Each tab is operated; each value's label is asserted.
const viewports = [
  { name: "390", size: { width: 390, height: 844 } },
  { name: "1280", size: { width: 1280, height: 720 } },
] as const;

for (const { name, size } of viewports) {
  test(`evidence values name their geography at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2024-06");
    const brief = page.getByTestId("evidence-panel");
    await expect(brief.getByTestId("selected-area")).toContainText("St James's");

    // No separate map reading and no jargon: the area is named in words, never "LSOA" or its code.
    await expect(brief.getByTestId("raw-value")).toHaveCount(0);
    await expect(brief.getByTestId("area-tile-price")).toContainText("£9,600/m²");
    await expect(brief.getByTestId("evidence-summary")).not.toContainText(/LSOA|MSOA|E0\d{7}/);
    const panel = page;

    // Prices by type name their area in words (or the wider area they were widened to) and their period.
    await openEvidenceSection(page, "Price & market");
    await expect(panel.getByTestId("price-types").locator(".price-types__lead")).toContainText(/[Ss]ales in (this neighbourhood|the wider .+ area)/);
    await expect(panel.getByTestId("price-types").locator(".price-types__lead")).toContainText(/12 months to [A-Z][a-z]{2} \d{4}/);
    await expect(panel.getByTestId("price-types")).not.toContainText("LSOA");

    // Environment shares describe the area's land, never buildings.
    await openEvidenceSection(page, "Environment");
    const flood = panel.getByTestId("flood-bands");
    await expect(panel.getByTestId("card-sources-environment")).toContainText("shares of the area's land");
    await expect(flood).toBeVisible();
    await expect(flood).not.toContainText(/building/i);

    // Planning records name their borough.
    await openEvidenceSection(page, "Planning");
    await expect(panel.getByTestId("planning-results")).toContainText("24/05110/FULL");
    await expect(panel.getByTestId("planning-withdrawn-note")).toContainText("Westminster");
  });

  test(`property values name the property identity at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
    await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
    const panel = await openEvidenceSection(page, "Homes sold nearby");
    await expect(panel.getByTestId("property-history")).toContainText("SW1A 1AA");
    await expect(panel.getByText("not property valuations")).toBeVisible();
  });
}
