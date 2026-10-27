import { expect, test } from "./fixtures";

// Block 6 of a home's page: the area's layers scorecard (?scope=overview; demo fixture here), server-rendered.
test("a home's Overview opens with a summary, then the layer and preset tiles and the band chips", async ({ page }) => {
  await page.goto("/property/100000000001");
  const overview = page.getByTestId("home-overview");
  await expect(overview.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(overview.getByTestId("home-overview-summary")).toHaveText(
    "Prices are higher than most of London (£12,400/m²). Crime is higher than most of London (130.1 per 1,000). "
    + "The walk to a station is 3 min, rated 10/10 for London. Green & trees rate 6/10. It is less deprived than most of London.");

  const tiles = overview.locator('[data-testid^="area-tile-"]');
  await expect(tiles).toHaveCount(13); // 10 layers, then 3 ready-made criteria
  await expect(overview.getByTestId("area-tile-custom:nightlife")).toContainText("Nightlife");
  // On a phone the tiles after the sixth unfold under "Show all"; they are in the page either way.
  await expect(overview.getByTestId("area-tile-custom:culture")).toHaveAttribute("href", "/?selected=uk%3Alsoa%3AE01000001&layer=custom%3Aculture");
  // A layer the area has no data for keeps its place.
  await expect(overview.getByTestId("area-tile-road-collisions")).toContainText("No data");
  await expect(overview.getByTestId("area-tile-noise")).toHaveAttribute("href", "/?selected=uk%3Alsoa%3AE01000001&layer=noise");

  await expect(overview.getByTestId("overview-chip-flood")).toHaveText("Flood: Low");
  await expect(overview.getByTestId("overview-chip-broadband")).toHaveText("Broadband: 100% gigabit");
  // Air waits on its licence flag (withheld), so it is left out rather than "No data".
  await expect(overview.getByTestId("overview-chip-air")).toHaveCount(0);

  // Before the area's own sections.
  const order = await page.evaluate(() => {
    const overviewTop = document.querySelector('[data-testid="home-overview"]')!.getBoundingClientRect().top;
    const sections = document.querySelector('[data-testid="home-area-sections"]')?.getBoundingClientRect().top ?? Infinity;
    return overviewTop < sections;
  });
  expect(order).toBe(true);
});

// The area's land reads "Low" (the layers chip); 12 Sample Street's own EA bands are very low. The chip
// follows the home, as the Environment row below it does, and says whose band it is.
test("a home's Overview flood chip agrees with its Environment flood row", async ({ page, request }) => {
  await page.goto("/property/100000000012");
  const chip = page.getByTestId("home-overview").getByTestId("overview-chip-flood");
  await expect(chip).toHaveText("Flood: Very low");
  await expect(chip).toHaveAttribute("title", "Flood, this home");
  await expect(chip).toHaveAttribute("aria-label", "Flood: Very low, this home");
  const row = page.getByTestId("home-area-sections").getByTestId("evidence-section-environment").getByTestId("flood-bands");
  await expect(row.locator("dt")).toContainText("Flood, this home");
  await expect(row.getByTestId("flood")).toHaveText("rivers and sea: very low · surface water: very low");
  // Both in the server's HTML, before hydration.
  const html = await (await request.get("/property/100000000012")).text();
  expect(html).toContain('title="Flood, this home"');
  expect(html).toContain(">Flood: Very low</li>");
});
