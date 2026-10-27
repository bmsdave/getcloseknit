import { expect, test } from "./fixtures";
import { backToArea, openAreaPage, openEvidenceSection, openLayerExplainer, showFullAreaView } from "./evidence";

// UX-35, v4 Task 12: the map's area view answers a buyer's first questions in the area page's own words
// (the verdict, the tags and the v3 tiles with London strips, v3 Fix 27G), never an x/10 score or a price
// for one home; method detail waits behind the legend's "?" (no About this data fold, v3 Fix 22.8).
const viewports = [
  { name: "390", size: { width: 390, height: 844 } },
  { name: "1280", size: { width: 1280, height: 720 } },
] as const;

const AREA = "/?selected=uk%3Alsoa%3AE01000001&period=2026-06";

for (const { name, size } of viewports) {
  test(`the area view answers the area, the full page the rest, at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(AREA);
    const panel = page.getByTestId("evidence-panel");
    await expect(panel.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

    // The verdict, the tags and the first tiles, in the area page's words, at every height.
    await expect(panel.getByTestId("area-verdict-line")).toContainText("more crime than most of London");
    await expect(panel.getByTestId("area-tag-con").first()).toHaveText(/More crime than 92% of London/);
    await expect(panel.getByTestId("area-tile-price")).toContainText("£9,600/m²");
    await expect(panel.getByTestId("area-tile-safety")).toContainText("More crime than 92%");
    await expect(panel.getByTestId("area-tile-schools")).toContainText("within 1.5 km");
    // One vocabulary: no x/10, no "Details ›", no price for a home (FLAGS.md: AREA_HOME_COST_ESTIMATE off).
    await expect(panel).not.toContainText(/\d+\/10|out of 10|Details ›|What a home costs/);
    for (const id of ["home-cost", "home-cost-value", "raw-value", "brief-highlights", "overview-badges", "area-faq"]) {
      await expect(panel.getByTestId(id), id).toHaveCount(0);
    }

    // Method detail is the legend's "?", not a fold in the panel; Report stays at the figure (the full view's end).
    const explainer = await openLayerExplainer(page);
    await expect(explainer.getByTestId("layer-explainer-line")).not.toBeEmpty();
    await expect(explainer.getByTestId("layer-explainer-points")).toContainText("HM Land Registry");
    await expect(explainer.getByTestId("layer-explainer-guide")).toBeVisible();
    await explainer.getByTestId("layer-explainer-close").click();
    await backToArea(page);
    await showFullAreaView(page);
    await expect(panel.getByTestId("about-this-data")).toHaveCount(0);
    await expect(panel.getByTestId("metric-freshness")).toHaveCount(0);
    await expect(panel.getByTestId("correction-report-open")).toBeVisible();

    // The full page: a verdict and tags lead; no "Read as text", no income or deprivation tile, no quick answers.
    const full = await openAreaPage(page);
    await expect(full.getByTestId("area-verdict-line")).toContainText("more crime than most of London");
    await expect(full.getByTestId("area-tag-con").first()).toHaveText(/More crime than 92% of London/);
    await expect(full.getByTestId("area-summary-text")).toHaveCount(0);
    await expect(full.getByTestId("area-faq")).toHaveCount(0);
    await expect(full.getByTestId("area-tiles").locator("[data-testid^=area-tile-]")).toHaveCount(12);
    for (const id of ["income", "deprivation", "social-renting", "people"]) await expect(full.getByTestId(`area-tile-${id}`)).toHaveCount(0);
    // Safety: the rate in the title row with London in words, offence types against London's tick.
    const safety = await openEvidenceSection(page, "Safety");
    await expect(safety.getByTestId("section-headline-safety")).toHaveText(/^54 \/ 1,000 · London [\d,.]+$/); // r3 #8: London's figure beside it
    await expect(safety.getByTestId("london-chip-safety")).toHaveText("More crime than 92% of London");
    await expect(safety.getByTestId("rate-row").first()).toContainText("Violence and sexual offences22.1");
    await expect(safety.getByRole("group", { name: /out of 10/ })).toHaveCount(0);
    // People: neutral shares and deprivation in decile words, never rated or under Safety.
    const people = await openEvidenceSection(page, "People");
    await expect(people.getByTestId("people-key-numbers")).toContainText(/Deprivation: (among London's (least|most) deprived \d+%|around London's middle)/);
    await expect(people.getByRole("group", { name: /out of 10/ })).toHaveCount(0);
    await expect(safety.getByTestId("people-section")).toHaveCount(0);
    await expect(people).not.toContainText("100%");
  });
}

test("the side panel opens on its header, verdict and first tiles, the way on pinned in view", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(AREA);
  const panel = page.getByTestId("evidence-panel");
  await expect(panel.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(panel.getByTestId("area-tile-schools")).toContainText("within 1.5 km", { timeout: 20_000 });
  await expect(panel.getByTestId("selected-area")).toBeInViewport({ ratio: 1 });
  await expect(panel.getByTestId("area-verdict-line")).toBeInViewport({ ratio: 1 });
  await expect(panel.getByTestId("area-tile-price")).toBeInViewport({ ratio: 1 });
  await expect(panel.getByTestId("open-area-page")).toBeInViewport({ ratio: 1 });
});

test("a topic without data says No data here and keeps its place, never zero", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  await openAreaPage(page);
  // The demo has no modelled air for this area: the tile stays eighth and says so, with no London dot.
  const tiles = page.getByTestId("area-tiles").locator("[data-testid^=area-tile-]");
  await expect(tiles.nth(7)).toHaveAttribute("data-testid", "area-tile-air");
  await expect(tiles.nth(7)).toContainText("No data here");
  await expect(tiles.nth(7)).not.toContainText(/\d/);
  await expect(tiles.nth(7).locator(".london-strip__dot")).toHaveCount(0);
});

test("an unreachable profile leaves the tiles whole on the panel and the page", async ({ page }) => {
  await page.route(/\/api\/v1\/areas\/[^/?]+\/profile/, (route) => route.fulfill({ status: 503, json: { error: "down" } }));
  await page.goto(AREA);
  // The panel's tiles have their own source (area-standouts.v1), as on the full page: they stay whole.
  const panel = page.getByTestId("evidence-panel");
  await expect(panel.getByTestId("area-tile-price")).toContainText("£9,600/m²");
  await expect(panel.getByTestId("area-tile-safety")).toContainText("More crime than 92%");
  await openAreaPage(page);
  await expect(page.getByTestId("area-tile-price")).toContainText("£9,600/m²");
  await expect(page.getByTestId("area-tile-safety")).toContainText("More crime than 92%");
});

test("Getting around lists the nearest stations as rows (walk · zone · lines), no bars", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  const section = await openEvidenceSection(page, "Getting around");
  await expect(section.getByTestId("section-headline-getting-around")).toHaveText(/^about \d+ min to .+/); // PR #273 (#188): "about N min" with the detour
  await expect(section.getByTestId("station-row").first()).toContainText(/\d+ min walk · Zone \d/);
  await expect(section.getByTestId("station-walk")).toContainText("3 min to a station");
  await expect(section.locator(".et-rings, .station-access, .chart-bars")).toHaveCount(0);
});
