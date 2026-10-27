import { expect, test, type Page } from "./fixtures";
import { openAreaPage, openEvidenceSection, SECTION_ORDER, sectionToggle, type SectionName } from "./evidence";

const SECTIONS: SectionName[] = [
  "Price", "Getting around", "Safety", "Schools", "Local places", "Green & quiet", "Health", "Homes", "People", "Living costs",
];

async function selectOption(page: Page, fill: string, option: RegExp) {
  await page.getByRole("combobox", { name: "Search", exact: true }).fill(fill);
  await page.getByRole("option", { name: option }).click();
}

// UX-44: each module appears exactly once and moving between sections does
// not refetch unchanged evidence — visit every section of the area card,
// with and without a chosen home, while observing counts.
test("every section renders once and never refetches unchanged inputs", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  let areaRequests = 0;
  page.on("request", (request) => {
    // Area evidence itself; card-owned resources (/schools, /noise) are
    // read once per page by their cards and are not area evidence.
    if (/\/api\/v1\/areas\/[^/?]+(\?|$)/.test(request.url())) areaRequests += 1;
  });
  await page.goto("/");
  await selectOption(page, "SW1A", /SW1A 1AA.*Westminster/);
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await openAreaPage(page);
  await expect(page).toHaveURL(/\/area\/lsoa\/E01000001\?uprn=/);
  expect(areaRequests, "the page fetches area evidence").toBeGreaterThan(0);

  // Every section once, in order, always open.
  await expect(page.locator("section.area-section")).toHaveCount(SECTION_ORDER.length);
  for (const name of SECTIONS) {
    const section = await openEvidenceSection(page, name);
    await expect(sectionToggle(page, name)).toBeInViewport();
    await expect(section).toBeVisible();
  }
  await expect(page.getByTestId("getting-around-key-numbers")).toHaveCount(1);
  await expect(page.getByTestId("essentials")).toHaveCount(1);
  await page.waitForLoadState("networkidle");
  const loaded = areaRequests;

  // Moving through the sections again (tab chips) refetches nothing.
  for (const name of SECTIONS) await page.getByTestId("area-tabs").getByRole("link", { name, exact: true }).click();
  await page.waitForLoadState("networkidle");
  expect(areaRequests, "moving between sections refetches").toBe(loaded);

  // The chosen home travelled with the link: its record renders once.
  await expect(page.getByTestId("property-history")).toBeVisible();
  await expect(page.getByTestId("property-history")).toHaveCount(1);

  // An area-only page has no home record and no home tools (they live on /tools/check-a-home).
  await page.goto("/area/lsoa/E01000003");
  await openEvidenceSection(page, "Homes sold nearby");
  await expect(page.getByTestId("market-sales-section")).toBeVisible();
  await expect(page.getByTestId("property-history")).toHaveCount(0);
  await expect(page.getByTestId("property-tools")).toHaveCount(0);
});
