import { areaReads, expect, test, type Page } from "./fixtures";
import { longParagraphs } from "./text-density";
import { openAreaPage, openEvidenceSection, sectionToggle, showEvidenceSummary, type SectionName } from "./evidence";

// The tiles. One area view everywhere (v4 Task 12): the full area page, the desktop side panel and the
// phone sheet at full show the 12 fixed tiles of v3 Fix 27G (Price · Safety · Schools · Station walk ·
// Cycling · Noise · Nature · Air · GP · Food hygiene · Nightlife · Families), each a title row and a mini
// London strip, every one a link to its section; the phone sheet's peek shows the first four. The old
// x/10 tiles ("Safety 2/10", "Details ›") are gone.
const AREA = "/?selected=uk%3Alsoa%3AE01000001&period=2026-06";
const PAGE = "/area/lsoa/E01000001";
const PAGE_TILES = ["price", "safety", "schools", "station-walk", "cycling", "noise", "nature", "air", "gp", "food-hygiene", "nightlife", "families"];

async function openWithData(page: Page, url = AREA) {
  await page.goto(url);
  if (url !== AREA) {
    const full = await openAreaPage(page);
    await expect(full.getByTestId("area-tile-schools")).toContainText("within 1.5 km", { timeout: 20_000 });
    return full;
  }
  const scope = page.getByTestId("evidence-panel");
  // First paint waits on a chain of requests (evidence, then the standouts); a busy
  // machine running the mobile project in parallel needs longer than the default 5s.
  await expect(scope.getByTestId("area-tile-schools")).toContainText("within 1.5 km", { timeout: 20_000 });
  return scope;
}

test("the side panel's tiles are the area page's 12, in one order, the first row in view at 1280×720", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const panel = await openWithData(page);
  const tiles = panel.getByTestId("area-tiles").locator("[data-testid^=area-tile-]");
  expect(await tiles.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")!.replace("area-tile-", "")))).toEqual(PAGE_TILES);
  for (const id of PAGE_TILES.slice(0, 2)) await expect(panel.getByTestId(`area-tile-${id}`), id).toBeInViewport({ ratio: 1 });
  await expect(panel.getByTestId("area-tile-safety").getByTestId("london-strip")).toHaveAttribute("aria-label", /^Better than \d+% of London$/);
  // One vocabulary: no x/10 score, no rating band, no "Details ›", no key line.
  await expect(panel.getByTestId("area-tiles")).not.toContainText(/\/10|Details|No rating/);
  await expect(panel.getByTestId("tiles-key")).toHaveCount(0);
});

test("the panel and the area page say each tile in the same words", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const panel = await openWithData(page);
  const words: Record<string, string> = {};
  for (const id of PAGE_TILES.slice(0, 4)) words[id] = (await panel.getByTestId(`area-tile-${id}`).locator(".standout-tile__value").textContent())?.trim() ?? "";
  const full = await openWithData(page, PAGE);
  for (const id of PAGE_TILES.slice(0, 4)) await expect(full.getByTestId(`area-tile-${id}`).locator(".standout-tile__value"), id).toHaveText(words[id]);
});

test("on a phone the peek's 4 tiles fit whole, nothing clipped or sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const panel = await openWithData(page);
  const tiles = panel.getByTestId("area-tiles").locator(".standout-tile");
  await expect(tiles).toHaveCount(4);
  const overflowing = await panel.locator(".standout-tile *").evaluateAll((nodes) => nodes
    .filter((node) => node.getBoundingClientRect().right > node.closest(".standout-tile")!.getBoundingClientRect().right + 1)
    .map((node) => node.textContent));
  expect(overflowing).toEqual([]);
  const right = await panel.getByTestId("area-tiles").evaluate((list) => list.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("on the full page the 12 tiles keep one order, and each shows its section and focuses its heading", async ({ page }) => {
  const full = await openWithData(page, PAGE);
  const tiles = full.getByTestId("area-tiles").locator("[data-testid^=area-tile-]");
  expect(await tiles.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")!.replace("area-tile-", "")))).toEqual(PAGE_TILES);
  // Each tile: a title row and a mini London strip (a dot where London ranks it).
  await expect(full.getByTestId("area-tile-safety").getByTestId("london-strip")).toHaveAttribute("aria-label", /^Better than \d+% of London$/);
  const targets: Array<[string, SectionName, string]> = [
    ["price", "Price", "market-trend-price"], ["safety", "Safety", "safety-types"],
    ["station-walk", "Getting around", "getting-around-key-numbers"], ["schools", "Schools", "school-phases"],
    ["gp", "Health", "evidence-section-health"], ["families", "Local places", "essentials"],
    ["noise", "Green & quiet", "environment-key-numbers"],
  ];
  // A phone shows the first six; Show all 12 unfolds the rest.
  if (await full.getByTestId("area-tiles-more").isVisible()) await full.getByTestId("area-tiles-more").click();
  for (const [id, section, content] of targets) {
    await showEvidenceSummary(page);
    await full.getByTestId(`area-tile-${id}`).focus();
    await page.keyboard.press("Enter");
    const header = sectionToggle(full, section);
    await expect(header, id).toBeFocused();
    await expect(header, id).toBeInViewport();
    await expect(full.getByTestId(content), id).toBeVisible();
  }
});

test("each section's evidence loads once, however many sections share it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // The browser's own reads (as in the map sheet): the server-seeded page reads none (area-r2.spec.ts).
  await page.setExtraHTTPHeaders({ "x-close-knit-seed": "off" });
  const requests: string[] = [];
  page.on("request", (request) => {
    // On their own or in a section batch.
    for (const url of areaReads(request)) {
      const match = /\/api\/v1\/areas\/[^/?]+\/(people|schools|places)\b/.exec(url);
      if (match) requests.push(match[1]);
    }
  });
  const full = await openWithData(page, PAGE);
  // Homes and People share one Census payload; Getting around, Local places and Environment one places payload.
  await expect(full.getByTestId("homes-chart")).toBeVisible();
  await expect(full.getByTestId("people-key-numbers")).toBeVisible();
  await expect(full.getByTestId("school-phases")).toBeVisible();
  await expect(full.getByTestId("essentials")).toBeVisible();
  for (const name of ["people", "schools", "places"]) expect(requests.filter((entry) => entry === name), name).toHaveLength(1);
});

test("an area with no figures says so on the page, never 0 and no sentence", async ({ page }) => {
  // The area page reads its sections in the browser here, so the mocks below apply to it too.
  await page.setExtraHTTPHeaders({ "x-close-knit-seed": "off" });
  await page.route(/\/api\/v1\/areas\/[^/?]+\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.summary = { ...body.summary, value: null, regionPercentile: null, countryPercentile: null };
    body.priceTimeline = body.priceTimeline.map((point: object) => ({ ...point, value: null }));
    await route.fulfill({ response, json: body });
  });
  await page.route(/\/api\/v1\/areas\/[^/?]+\/profile/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, metrics: [], schools: null, noise: null, regionRanks: null } });
  });
  await page.route(/\/api\/v1\/areas\/[^/?]+\/(flood|places)/, (route) => route.fulfill({ status: 404, json: { error: "none" } }));
  await page.goto(AREA);
  const full = await openAreaPage(page);
  // The page's tiles have their own source (rendered with the page); an unknown one says so, never 0.
  await expect(full.getByTestId("area-tile-air")).toContainText("No data here");
  await expect(full.getByTestId("overview-badges")).toHaveCount(0);
  // Unknown figures leave their rows out or say so; never a 0.
  await openEvidenceSection(page, "Getting around");
  await expect(full.getByTestId("getting-around-key-numbers")).toContainText("Unknown for this area");
  await expect(full.getByTestId("essentials")).toHaveCount(0);
  // Requests still in flight when the test ends must not fail it from inside the route handlers.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const size of [{ width: 1280, height: 720 }, { width: 375, height: 812 }]) {
  test(`the panel and the full page's glance have no long paragraphs at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await openWithData(page);
    expect(await longParagraphs(page)).toEqual([]);
    await openWithData(page, PAGE);
    expect(await longParagraphs(page)).toEqual([]);
  });
}

test("tile text wraps between words; a phone shows two columns and the first six, then Show all 12", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 812 });
    const full = await openWithData(page, PAGE);
    const list = full.getByTestId("area-tiles");
    const columns = await list.evaluate((node) => new Set([...node.children]
      .filter((cell) => (cell as HTMLElement).offsetWidth > 0).map((cell) => Math.round(cell.getBoundingClientRect().left))).size);
    expect(columns, `${width}px`).toBe(2);
    await expect(list.locator("[data-testid^=area-tile-]:visible")).toHaveCount(6);
    await full.getByTestId("area-tiles-more").click();
    await expect(list.locator("[data-testid^=area-tile-]:visible")).toHaveCount(12);
    await expect(full.getByTestId("area-tiles-more")).toHaveText("Show first 6");
    // Nothing runs past its tile's edge.
    const overflowing = await full.locator(".standout-tile *").evaluateAll((nodes) => nodes
      .filter((node) => node.getBoundingClientRect().right > node.closest(".standout-tile")!.getBoundingClientRect().right + 1)
      .map((node) => node.textContent));
    expect(overflowing, `${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("area-tiles-more")).toBeHidden();
  await expect(page.getByTestId("area-tiles").locator("[data-testid^=area-tile-]:visible")).toHaveCount(12);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px`).toBe(true);
  }
});
