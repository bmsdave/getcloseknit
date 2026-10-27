import { expect, test } from "./fixtures";
import { openEvidenceSection } from "./evidence";
import { longParagraphs } from "./text-density";

// Local market by property type (track G). Demo mode answers from fixtures.
test("market and recent-sales routes serve demo contracts", async ({ request }) => {
  const market = await request.get("/api/v1/areas/uk%3Alsoa%3AE01000002/market-by-type");
  expect(market.ok()).toBeTruthy();
  const body = await market.json();
  expect(body).toMatchObject({
    schemaVersion: "area-market-by-type.v1",
    available: true,
    basis: { carrier: "msoa", widened: true, minimumSales: 10 },
    window: { end: "2026-07" },
  });
  expect(body.byType.map((row: { propertyType: string }) => row.propertyType)).toEqual(["D", "S", "T", "F", "O"]);
  expect(body.trend[0].points).toHaveLength(11);

  const sales = await request.get("/api/v1/areas/uk%3Alsoa%3AE01000001/recent-sales?page=2&pageSize=5&sort=newest");
  expect(await sales.json()).toMatchObject({ schemaVersion: "area-recent-sales.v1", page: 2, pageSize: 5, sort: "newest" });

  expect((await request.get("/api/v1/areas/uk%3Alsoa%3AE01000001/recent-sales?pageSize=500")).status()).toBe(400);
  expect((await request.get("/api/v1/areas/uk%3Alsoa%3AE01999999/market-by-type")).status()).toBe(404);
});

test("Price holds the market by type, its rows and the sales list, on desktop and phone", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000002&period=2026-06");
  const section = await openEvidenceSection(page, "Price");
  const keys = section.getByTestId("price-key-numbers");

  // All four types always: median, sales and the middle half as a band; a widened basis says so.
  const types = section.getByTestId("price-types");
  await expect(types.locator("[data-testid^=price-type-]")).toHaveCount(4);
  await expect(types.locator(".price-types__lead")).toContainText(/[Ss]ales in the wider .+ area/);
  await expect(section.getByTestId("price-type-F")).toContainText(/£\d+k\d+ sales/);
  await expect(section.getByTestId("price-type-F")).toContainText(/Middle half £\d+k–£[\d.]+[km]/);
  await expect(section.getByTestId("price-type-D")).toContainText(/few sales|No sales/);
  // Plain, copyable rows: all homes (a widened basis named), the change; never a price for one home.
  await expect(keys.getByTestId("market-median")).toContainText(/All homes£\d+k median · \d+ sales · .+/);
  await expect(keys).toContainText(/Change1 y [+−]\d/);
  await expect(keys).not.toContainText(/E0\d|worth|valuation/);
  // One chart: the ten-year line (All homes by default); no market tiles or box plots beside it.
  await expect(section.getByTestId("market-trend-price").locator(".market-line")).toHaveAttribute("data-series", "all");
  await expect(section.getByTestId("market-tiles")).toHaveCount(0);
  await expect(section.getByTestId("market-by-type")).toHaveCount(0);

  // Licence and caveats sit in the section's one ⓘ fold, closed.
  await expect(section.getByTestId("card-sources-price")).not.toHaveAttribute("open");
  await expect(section.getByTestId("market-sources")).toContainText("Price Paid");

  // The sales themselves follow in the same section, closed as "Recent sales (N)":
  // five first; "Show all" opens the sorted, paged list.
  const recent = section.getByTestId("market-recent");
  await expect(recent).not.toHaveAttribute("open");
  await recent.locator(":scope > summary").click();
  await expect(recent.getByTestId("market-sales").locator("tbody tr")).toHaveCount(5);
  await expect(recent.getByTestId("market-page")).toHaveCount(0);
  await recent.getByTestId("market-show-all").click();
  await expect(recent.getByTestId("market-sales").locator("tbody tr")).toHaveCount(20);
  await expect(recent.getByTestId("market-page")).toContainText("1–20 of");
  await recent.getByRole("button", { name: "Next" }).click();
  await expect(recent.getByTestId("market-page")).toContainText("21–");
  await recent.getByRole("button", { name: "Newest" }).click();
  await expect(recent.getByTestId("market-page")).toContainText("1–20 of");

  // Nothing in the section makes the page scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("Price opens on a chart at 1280×720, with no long paragraphs", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000002&period=2026-06");
  const panel = await openEvidenceSection(page, "Price");
  await expect(panel.getByTestId("price-types")).toBeInViewport();
  expect(await longParagraphs(page)).toEqual([]);
  // The price sample is method: in the section's ⓘ fold, closed.
  await expect(panel.getByTestId("price-sample-explanation")).toBeHidden();
});

// The area card's enrichments (£/sq ft, the middle half, the population chip) keep the map sheet inside its own width.
for (const width of [320, 390]) {
  test(`the map sheet at full height never scrolls sideways at ${width}px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the sheet snaps on a phone");
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?selected=uk%3Alsoa%3AE01000002&period=2026-06");
    const panel = page.getByTestId("evidence-panel");
    await expect(panel.getByTestId("selected-area")).toContainText(/\w/, { timeout: 30_000 });
    await page.getByTestId("sheet-handle").focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "full");
    await expect(panel.getByTestId("market-median")).toContainText("middle half", { timeout: 30_000 });
    const people = panel.getByTestId("people-key-numbers");
    await people.scrollIntoViewIfNeeded();
    await expect(people).toContainText("people (", { timeout: 15_000 });
    const sideways = await page.evaluate(() => [document.documentElement, ...document.querySelectorAll(".dock-area")]
      .map((element) => element.scrollWidth - element.clientWidth));
    expect(Math.max(...sideways), JSON.stringify(sideways)).toBeLessThanOrEqual(0);
  });
}
