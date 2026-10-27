import { expect, test, type Page } from "./fixtures";
import { openEvidenceSection, SECTION_IDS, showEvidenceSummary, type SectionName } from "./evidence";
import { longParagraphs } from "./text-density";

// Infographic rule for the map's brief and every section of the area card,
// at 1280×720 (desktop project) and on a phone (mobile project): no visible
// paragraph over 25 words, and once a section's heading is scrolled to the
// top, its content is already in view: a graphic (a chart, rows with bars, the
// ratings' stitched steps) or, where a chart would mean nothing (v3: stations,
// schools, essentials), its rows.
const AREA = "/?selected=uk%3Alsoa%3AE01000001&period=2026-06";
const SECTIONS: SectionName[] = [
  "Price", "Homes sold nearby", "Getting around", "Safety", "Schools", "Local places", "Environment", "Homes", "People", "Living costs",
];

async function openSection(page: Page, name: SectionName) {
  if (name === "Homes sold nearby") {
    // The home's own value chart leads the card when a home is chosen.
    await page.goto("/");
    await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
    await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  } else {
    await page.goto(AREA);
  }
  await expect(page.getByTestId("selected-area")).toBeVisible();
  await openEvidenceSection(page, name);
}

/**
 * True when a chart inside the scope is in the viewport (ancestor clipping
 * included): wholly, or at least 40px of a taller one. A sliver at the
 * bottom edge does not count.
 */
async function chartInView(page: Page, scope: string, align: string): Promise<boolean> {
  return page.evaluate(async ({ scope, align }) => {
    // Re-align on every poll: content above (a home's stock value, earlier
    // sections) loads late and pushes the section down.
    document.querySelector(align)?.scrollIntoView({ block: "start" });
    const charts = [...document.querySelectorAll(`${scope} :is([role=img], .rating__steps, .share-rows, .price-types, .essentials, .school-rows, .key-numbers)`)];
    if (charts.length === 0) return false;
    const shown = await Promise.all(charts.map((chart) => new Promise<boolean>((resolve) => {
      const observer = new IntersectionObserver(([entry]) => {
        observer.disconnect();
        const height = entry.boundingClientRect.height;
        resolve(entry.isIntersecting && entry.intersectionRect.height >= Math.min(height, 40) - 0.5);
      });
      observer.observe(chart);
    })));
    return shown.some(Boolean);
  }, { scope, align });
}

test("Summary: a chart in view at the top and no long paragraphs", async ({ page }, testInfo) => {
  if (testInfo.project.name === "desktop") await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(AREA);
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-station-walk")).toContainText("min");
  await showEvidenceSummary(page);
  // The tiles' London strips are the summary's graphic (v4 Task 12: the area page's tiles, no x/10 steps).
  await expect(page.locator("[data-testid=evidence-summary] .standout-tile .london-strip").first()).toBeInViewport();
  expect(await longParagraphs(page)).toEqual([]);
});

for (const name of SECTIONS) {
  test(`${name}: a chart or its rows in view below the section header and no long paragraphs`, async ({ page }, testInfo) => {
    if (testInfo.project.name === "desktop") await page.setViewportSize({ width: 1280, height: 720 });
    await openSection(page, name);
    const id = SECTION_IDS[name];
    const section = page.getByTestId(`evidence-section-${id}`);
    // Let the section finish loading before measuring.
    await expect(section.getByText(/^Loading/)).toHaveCount(0);
    await expect.poll(
      () => chartInView(page, `#${id}`, `#${id}`),
      { message: `a graphic in view in ${name}` },
    ).toBe(true);
    expect(await longParagraphs(page)).toEqual([]);
  });
}
