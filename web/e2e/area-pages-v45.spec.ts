import { expect, test, type Page } from "./fixtures";

// v4.5 (check round 2, track area-pages): names never codes, the desktop panel header readable in
// full with something saved, and a phone's peek showing all four tiles above its sticky footer.

/** A prod-length name in the panel's header (the demo names are short): the last crumb and the title. */
async function longNames(page: Page) {
  await page.evaluate(() => {
    const crumb = [...document.querySelectorAll(".map-dock .area-brief__parents li")].at(-1);
    if (crumb) crumb.textContent = "Canonbury East & Mildmay Park · N1";
    const title = document.querySelector('.map-dock [data-testid="selected-area"]');
    if (title) title.textContent = "Canonbury East & Mildmay Park";
  });
}

test("desktop: with something saved, the last crumb clears ♡ N and the title shows whole", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the desktop side panel");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000002");
  const panel = page.getByTestId("evidence-panel");
  await panel.getByTestId("save-area").click();
  const saved = page.getByTestId("header-saved-areas");
  await expect(saved).toHaveAttribute("aria-label", "Saved (1)");
  await longNames(page);
  const heart = (await saved.boundingBox())!;
  const crumbs = await page.locator(".map-dock .area-brief__parents li").evaluateAll((items) =>
    items.map((item) => { const box = item.getBoundingClientRect(); return { right: box.right, top: box.top, bottom: box.bottom }; }));
  for (const crumb of crumbs) {
    const overlaps = crumb.right > heart.x && crumb.top < heart.y + heart.height && crumb.bottom > heart.y;
    expect(overlaps, "a crumb under ♡ N").toBe(false);
  }
  const title = await panel.getByTestId("selected-area").evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth, height: node.getBoundingClientRect().height }));
  expect(title.scroll).toBeLessThanOrEqual(title.client);
  expect(title.height).toBeGreaterThan(40); // two lines, not "Canonbury East & Mil…"
});

test("phone: the peek at half shows all four tiles above the sticky footer, every tag on screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the phone sheet");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  const panel = page.getByTestId("evidence-panel");
  await expect(panel).toHaveAttribute("data-view", "peek");
  await expect(panel.getByTestId("area-tiles").locator(".standout-tile")).toHaveCount(4);
  const footerTop = async () => (await panel.getByTestId("area-view-footer").boundingBox())!.y;
  await expect.poll(async () => {
    const bottoms = await panel.getByTestId("area-tiles").locator(".standout-tile").evaluateAll((tiles) => tiles.map((tile) => tile.getBoundingClientRect().bottom));
    return Math.max(...bottoms) <= await footerTop();
  }).toBe(true);
  const tags = await panel.getByTestId("area-tags").locator("li").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().right));
  for (const right of tags) expect(right).toBeLessThanOrEqual(390);
});

test("a home's page names its area, never an LSOA or MSOA code", async ({ page }) => {
  await page.goto("/property/100000000001");
  await expect(page.getByTestId("property-summary")).toContainText(" in St James's, ");
  const area = page.getByTestId("area-prices").getByTestId("area-prices-area");
  await expect(area).toHaveText("Sales in this neighbourhood: St James's · SW1A");
  for (const text of [await page.getByTestId("property-summary").textContent(), await area.textContent()]) {
    expect(text).not.toMatch(/LSOA|MSOA|[A-Za-z] \d{3}[A-Z]?\b/);
  }
});

test("the borough's Areas list names each area once, with no code", async ({ page }) => {
  await page.goto("/area/lad/E09000001");
  const rows = page.getByTestId("borough-area");
  await expect(rows.first()).toBeVisible();
  const names = await rows.locator(".borough-areas__name").allTextContents();
  for (const name of names) expect(name).not.toMatch(/[A-Za-z] \d{3}[A-Z]?\b/);
  expect(new Set(names).size).toBe(names.length);
});
