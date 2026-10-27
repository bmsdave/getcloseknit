import { expect, test, type Locator, type Page } from "./fixtures";

import { SECTION_ORDER } from "./evidence";

// The area card (docs/design/v3-spec.md Fix 27G, 28, 33): the header and the 12 tiles, then one sticky
// chip bar and every section in the one fixed order, always open, each in the same frame (title row ·
// at most one chart · at most five rows · ⓘ Sources), text that can be selected, and the map sheet at
// full height showing the same card.
const AREA = "/area/lsoa/E01000001";

// Sections scroll instantly with reduced motion, so a click never lands mid-scroll.
test.use({ contextOptions: { reducedMotion: "reduce" } });

const TITLES = ["Price", "Getting around", "Safety", "Schools", "Local places", "Green & quiet", "Health", "Homes", "People", "Living costs"];

async function openCard(page: Page): Promise<Locator> {
  await page.goto(AREA);
  const full = page.getByTestId("area-full-page");
  await expect(full.getByTestId("area-tabs")).toBeVisible({ timeout: 30_000 });
  return full;
}

test("one sticky chip bar and sections in the one fixed order; no folding toggles", async ({ page }) => {
  const full = await openCard(page);
  const tabs = full.getByTestId("area-tabs").getByRole("link");
  await expect(tabs).toHaveText(TITLES);
  for (const [index, id] of SECTION_ORDER.entries()) {
    await expect(tabs.nth(index)).toHaveAttribute("data-section", id);
  }
  const sections = full.locator("section.area-section");
  await expect(sections).toHaveCount(SECTION_ORDER.length);
  expect(await sections.evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual([...SECTION_ORDER]);
  // Fix 28: the second bar (Overview · Homes · Schools · Places · Evidence pack) is gone.
  await expect(page.getByTestId("area-page-tabs")).toHaveCount(0);
  await expect(full.locator("[aria-expanded][data-testid^=section-toggle-]")).toHaveCount(0);
  for (const id of ["area-open-all", "area-close-all", "cost-worksheet", "viewing-checklist", "user-candidates", "similar-areas"]) {
    await expect(full.getByTestId(id), id).toHaveCount(0);
  }
  // The footer's big links: Evidence pack lives here and in ⋯.
  await expect(full.getByTestId("footer-check-home")).toHaveAttribute("href", /^\/tools\/check-a-home\?area=uk%3Alsoa%3AE01000001/);
  // Like this is the map card's own action now (v3 Fix 22), not a footer link.
  await expect(full.getByTestId("footer-similar")).toHaveCount(0);
  await expect(full.getByTestId("footer-pack")).toHaveAttribute("href", "/area/lsoa/E01000001/pack");
  await expect(full.getByTestId("footer-planning")).toBeVisible();
  await expect(full.getByTestId("footer-sources")).toBeVisible();

  // A chip scrolls its section to just under the bar (scroll-margin) and marks itself current.
  await tabs.nth(SECTION_ORDER.indexOf("environment")).click();
  await expect(page).toHaveURL(/#environment$/);
  const title = full.getByTestId("evidence-section-environment").locator(".area-section__title");
  await expect(title).toBeInViewport();
  await expect(full.getByTestId("area-tab-environment")).toHaveAttribute("aria-current", "true");
  const bar = await full.getByTestId("area-tabs").boundingBox();
  const heading = await title.boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
  // Scroll-spy: scrolling to another section moves the current chip.
  await full.getByTestId("evidence-section-people").evaluate((node) => node.scrollIntoView({ block: "start" }));
  await expect(full.getByTestId("area-tab-people")).toHaveAttribute("aria-current", "true");
});

test("each tile and tag lands on its own section", async ({ page }) => {
  const full = await openCard(page);
  const tiles = full.getByTestId("area-tiles");
  const sections: Record<string, string> = {
    price: "price", safety: "safety", schools: "schools", "station-walk": "getting-around", noise: "environment", gp: "health", families: "local-places",
  };
  // A phone shows the first six; Show all 12 unfolds the rest.
  if (await full.getByTestId("area-tiles-more").isVisible()) await full.getByTestId("area-tiles-more").click();
  for (const [tile, section] of Object.entries(sections)) {
    const link = tiles.getByTestId(`area-tile-${tile}`);
    await expect(link, tile).toHaveAttribute("href", `#${section}`);
    await link.click();
    await expect(page, tile).toHaveURL(new RegExp(`#${section}$`));
    await expect(full.getByTestId(`evidence-section-${section}`).locator(".area-section__title"), tile).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  const tag = full.getByTestId("area-tags").getByRole("link").first();
  const target = (await tag.getAttribute("href"))!.slice(1);
  await tag.click();
  await expect(full.getByTestId(`evidence-section-${target}`).locator(".area-section__title")).toBeInViewport();
  // An old card link still lands on the section that holds its topic.
  await page.goto(`${AREA}#living`);
  await expect(page.getByTestId("evidence-section-safety").locator(".area-section__title")).toBeInViewport({ timeout: 30_000 });
});

test("each section is one frame: title row, at most one chart, at most five rows (plus the household's), one ⓘ", async ({ page }) => {
  const full = await openCard(page);
  // Let every section finish loading.
  await expect(full.getByText(/^Loading/)).toHaveCount(0, { timeout: 30_000 });
  await expect(full.getByTestId("people-chart")).toBeVisible();
  const report = await full.locator("section.area-section").evaluateAll((sections) => sections.map((section) => {
    const body = section.querySelector(".area-section__body")!;
    const shown = (node: Element) => (node as HTMLElement).offsetWidth > 0 && !node.closest("details:not([open])");
    const charts = [...body.querySelectorAll("figure, .chart-frame, [role=img]")]
      .filter((node) => shown(node) && !node.parentElement?.closest("figure, .chart-frame, [role=img]"));
    // One-line captions (a lead line, a legend, a status) are not paragraphs.
    const paragraphs = [...body.querySelectorAll("p:not(.share-topic__lead):not(.price-types__lead):not(.share-legend):not(.area-section__status)")]
      .filter((node) => shown(node) && !node.closest(".homes-here, .market"))
      .map((node) => node.textContent?.trim() ?? "").filter((text) => text.split(/\s+/).length > 4);
    const rows = [...section.querySelectorAll(":scope > .area-section__body > .key-numbers > div:not([data-mine])")].length;
    return {
      id: section.id, charts: charts.length, paragraphs, rows,
      head: section.querySelector(".area-section__head .area-section__title") !== null,
      folds: [...section.querySelectorAll("details")].filter((node) => /sources/i.test(node.querySelector("summary")?.textContent ?? "")).length,
      showAll: [...section.querySelectorAll("button, summary")].filter((node) => /^Show all/.test(node.textContent?.trim() ?? "")).length,
      topics: section.querySelectorAll(".share-topic").length,
    };
  }));
  for (const entry of report) {
    expect(entry.head, `${entry.id}: a title row`).toBe(true);
    // Safety may add its line when crime moved 15% or more (owner decision 2026-10-17).
    expect(entry.charts, `${entry.id}: one chart at most`).toBeLessThanOrEqual(entry.id === "safety" ? 2 : 1);
    expect(entry.paragraphs, `${entry.id}: no body paragraphs`).toEqual([]);
    expect(entry.rows, `${entry.id}: five rows at most`).toBeLessThanOrEqual(5);
    expect(entry.folds, `${entry.id}: one Sources fold, the section's own`).toBe(1);
    // People and Homes: one "Show all" per topic (Fix 29); elsewhere one at most.
    expect(entry.showAll, `${entry.id}: Show all`).toBeLessThanOrEqual(Math.max(1, entry.topics));
  }
  // No scales that repeat a tile (noise, nature, summer nights) and no station or school bars.
  for (const id of ["noise-context", "environment-bands", "station-access", "places-station-rings", "kids-tiles"]) {
    await expect(full.getByTestId(id), id).toHaveCount(0);
  }
  await expect(full.locator(".metric-breakdown, .sparkline-summary, .area-section__ratings")).toHaveCount(0);
  await expect(full).not.toContainText("Not counted yet");
  // Recent sales: closed, with the count in its summary.
  const sales = full.getByTestId("market-recent");
  await expect(sales).not.toHaveAttribute("open");
  await expect(sales.locator("summary")).toHaveText(/^Recent sales \(\d+\)$/);
  await sales.locator("summary").click();
  await expect(sales.getByTestId("market-sales").locator("tbody tr")).toHaveCount(5);
  // Food hygiene is a row, not a second chart; nearest essentials are a list; Local places ends with All places.
  await expect(full.getByTestId("food-hygiene-share")).toContainText(/\d+% \(\d+ of \d+\)/);
  await expect(full.getByTestId("essentials").locator("li")).toHaveCount(5);
  await expect(full.getByTestId("all-places")).toHaveAttribute("href", "/area/lsoa/E01000001/places");
  // Council tax is one row; no bar chart.
  await expect(full.getByTestId("civic-council")).toContainText(/Band D £[\d,]+ · A £[\d,]+ … H £[\d,]+/);
  await expect(full.getByTestId("evidence-section-living-costs").locator(".chart-bars")).toHaveCount(0);
});

test("schools: Primary | Secondary rows link to the school's page with this area, distance in words", async ({ page }) => {
  const full = await openCard(page);
  const schools = full.getByTestId("evidence-section-schools");
  const rows = schools.getByTestId("area-school-row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(schools.getByTestId("school-phase-primary")).toHaveAttribute("aria-pressed", "true");
  const link = rows.first().getByTestId("area-school-link");
  await expect(link).toHaveAttribute("href", /^\/school\/\d+\?from=uk%3Alsoa%3AE01000001$/);
  await expect(schools.locator(".school-card__distance, .distance-scale")).toHaveCount(0);
  await schools.getByTestId("school-phase-secondary").click();
  await expect(schools.getByTestId("school-phase-secondary")).toHaveAttribute("aria-pressed", "true");
});

test("text in a section can be drag-selected and copied", async ({ page }) => {
  const full = await openCard(page);
  const row = full.getByTestId("safety-key-numbers").locator("dt").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  if (!box) throw new Error("no key-numbers row");
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected.trim().length).toBeGreaterThan(0);
});

test("the map sheet at full height shows the whole card, tiles first; half height keeps the brief", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the sheet snaps on a phone");
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  const panel = page.getByTestId("evidence-panel");
  await expect(panel.getByTestId("selected-area")).toContainText(/St James's|Westminster/, { timeout: 30_000 });
  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "half");
  await expect(panel.getByTestId("area-tabs")).toHaveCount(0);
  await expect(panel.getByTestId("open-area-page")).toBeVisible();

  // A tap on the grabber steps down (Maps-style); ArrowUp on it steps up to full.
  const handle = page.getByTestId("sheet-handle");
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "full");
  const tabs = panel.getByTestId("area-tabs").getByRole("link");
  await expect(tabs).toHaveText(TITLES, { timeout: 30_000 });
  const sections = panel.locator("section.area-section");
  expect(await sections.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")))).toEqual(
    SECTION_ORDER.map((id) => `evidence-section-${id}`),
  );
  // A tile stays in the sheet and shows its section.
  await panel.getByTestId("area-tile-safety").click();
  await expect(panel.getByTestId("evidence-section-safety").locator(".area-section__title")).toBeInViewport();
  expect(new URL(page.url()).pathname).toBe("/");
});
