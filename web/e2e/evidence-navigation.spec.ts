import { expect, test, type Page } from "./fixtures";
import { openAreaPage, openEvidenceSection, SECTION_ORDER, sectionToggle, showEvidenceSummary, showFullAreaView } from "./evidence";

// The map panel is the area view (v4 Task 12: a phone's peek, or the area card); the
// full area page holds every topic as one always-open section, in one fixed
// order. Each module lives in exactly one section.
const viewports = [
  { name: "390", size: { width: 390, height: 844 } },
  { name: "1280", size: { width: 1280, height: 720 } },
] as const;

async function openEvidence(page: Page) {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  const panel = page.getByTestId("evidence-panel");
  await expect(panel.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  return panel;
}

// v4 Task 12: one area view. A phone's sheet at half is the peek (verdict, tags, the first 4 tiles); the
// desktop side panel (and the sheet at full) is the area card: 12 tiles and every section. Never x/10,
// "Details ›" or "What a home costs here"; "Open full area page" is the sticky footer at every height.
test("the phone peek: verdict, tags, the first 4 tiles and the way to the full page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openEvidence(page);
  await expect(panel).toHaveAttribute("data-view", "peek");
  await expect(panel.getByTestId("area-verdict-line")).toBeVisible();
  await expect(panel.getByTestId("area-tags")).toBeVisible();
  await expect(panel.getByTestId("area-tiles").locator("li")).toHaveCount(4);
  await expect(panel.getByTestId("area-tiles-more")).toHaveCount(0);
  // Every tile in view above the sticky footer at half height (≈ 400px on an 844px phone).
  for (const tile of await panel.getByTestId("area-tiles").locator(".standout-tile").all()) await expect(tile).toBeInViewport({ ratio: 1 });
  await expect(panel.locator("[data-testid^=evidence-section-]")).toHaveCount(0);
  for (const id of ["overview-tiles", "home-cost", "home-cost-value", "brief-highlights", "metric-description"]) {
    await expect(panel.getByTestId(id), id).toHaveCount(0);
  }
  await expect(panel).not.toContainText(/\d+\/10|Details ›|What a home costs/);
  await expect(panel.getByTestId("open-area-page")).toBeInViewport();
  await expect(panel.getByTestId("open-area-page")).toHaveAttribute("href", /^\/area\/lsoa\/E01000001\?mode=demo&release=/);
});

for (const { name, size } of viewports) {
  test(`the full area view: 12 tiles, every section, no x/10 at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await openEvidence(page);
    const panel = await showFullAreaView(page);
    await expect(panel.getByTestId("area-tiles").locator("li")).toHaveCount(12);
    await expect(panel.getByTestId("area-tiles-more")).toHaveText("Show all 12");
    await expect(panel.getByTestId("page-tailor")).toHaveCount(1);
    for (const id of SECTION_ORDER) await expect(panel.getByTestId(`evidence-section-${id}`), id).toHaveCount(1);
    await expect(panel.getByTestId("home-cost")).toHaveCount(0);
    await expect(panel.locator(".area-tile, [data-tile]")).toHaveCount(0);
    await expect(panel.getByTestId("area-tiles")).not.toContainText(/\/10|Details/);
    await expect(panel.getByTestId("open-area-page")).toBeInViewport();
  });

  test(`the full page lists every section, open, and each owns its modules at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await openEvidence(page);
    const full = await openAreaPage(page);
    await expect(full.getByTestId("area-page-title")).toContainText(/St James's|Westminster/);

    const sections = full.locator("[data-testid^=evidence-section-]:not([data-testid=evidence-section-planning])");
    await expect(sections).toHaveCount(SECTION_ORDER.length);
    for (const [index, id] of SECTION_ORDER.entries()) {
      await expect(sections.nth(index)).toHaveAttribute("data-testid", `evidence-section-${id}`);
    }
    await expect(full.locator("[data-testid^=section-toggle-]")).toHaveCount(0);
    // Planning folds in the footer and loads once opened.
    await expect(full.getByTestId("planning-context")).toHaveCount(0);

    const environment = await openEvidenceSection(page, "Environment");
    await expect(environment.getByTestId("flood-bands")).toBeVisible();
    // Rows only (the tiles carry the strips): flood bands, and noise only where it has figures (none in the demo); no noise pilot.
    await expect(environment.getByTestId("environment-noise")).toHaveCount(0);
    await expect(full.getByTestId("noise-context")).toHaveCount(0);
    await expect(environment.getByTestId("planning-context")).toHaveCount(0);
    const price = await openEvidenceSection(page, "Price");
    await expect(price.getByTestId("market-sales-section")).toHaveCount(1);
    await expect(full.getByTestId("people-section")).toHaveCount(1);
    await expect(full.getByTestId("homes-section")).toHaveCount(1);

    const planning = await openEvidenceSection(page, "Planning");
    await expect(planning.getByTestId("planning-context")).toBeVisible();
    await expect(planning.getByTestId("flood-bands")).toHaveCount(0);
    for (const id of ["flood-bands", "planning-context", "civic-council"]) {
      await expect(full.getByTestId(id), id).toHaveCount(1);
    }

    await showEvidenceSummary(page);
    await expect(full.getByTestId("area-tiles")).toBeInViewport();
  });

  test(`the planning fold operates by keyboard at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/area/lsoa/E01000001");
    const full = await openAreaPage(page);

    const header = sectionToggle(full, "Planning");
    await header.evaluate((node) => node.scrollIntoView({ block: "start" }));
    await header.focus();
    await page.keyboard.press("Enter");
    await expect(full.getByTestId("footer-planning")).toHaveAttribute("open", "");
    await expect(full.getByTestId("planning-context")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(full.getByTestId("footer-planning")).not.toHaveAttribute("open", "");
  });
}

test("a peek tile opens the full page at its section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEvidence(page);
  const tile = page.getByTestId("evidence-panel").getByTestId("area-tile-safety");
  await expect(tile).toHaveAttribute("href", /^\/area\/lsoa\/E01000001\?mode=demo&release=[^#]+#safety$/);
  // Retried: under load the first tap can land before the router is ready.
  await expect(async () => {
    if (!page.url().includes("/area/lsoa/")) await tile.click();
    await expect(page).toHaveURL(/\/area\/lsoa\/E01000001\?mode=demo&release=[^#]+#safety$/, { timeout: 3_000 });
  }).toPass();
  const heading = sectionToggle(page, "Safety");
  await expect(heading).toBeInViewport({ timeout: 15_000 });
  await expect(page.getByTestId("safety-key-numbers")).toBeVisible();
});

test("a desktop panel tile scrolls the panel to its section", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const panel = await openEvidence(page);
  await expect(panel.getByTestId("evidence-section-safety")).toHaveCount(1, { timeout: 15_000 });
  await panel.getByTestId("area-tile-safety").click();
  await expect(page).toHaveURL(/\/\?/);
  await expect(panel.getByTestId("evidence-section-safety").locator(".area-section__title")).toBeInViewport({ timeout: 10_000 });
});

test("the full page goes back to the map", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  const full = await openAreaPage(page);
  await full.getByTestId("open-on-map").click();
  await expect(page).toHaveURL(/\/\?.*selected=uk%3Alsoa%3AE01000001/);
  await expect(page.getByTestId("evidence-panel").getByTestId("selected-area")).toContainText(/St James's|Westminster/);
});
