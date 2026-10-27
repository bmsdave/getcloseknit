import { expect, test } from "./fixtures";

// Local council section (track J) on its stand-alone page, demo fixtures.
test("an area shows where it sits, council tax bands, representatives and codes", async ({ page }) => {
  await page.goto("/civic?area=uk%3Alsoa%3AE01000001");
  const section = page.getByTestId("civic-section");
  await expect(page.getByTestId("civic-breadcrumb").getByRole("listitem")).toHaveText([
    "England", "London", "Westminster preview borough", "Westminster preview central ward", "Westminster preview",
  ]);
  const rows = page.getByTestId("civic-council-tax").getByRole("row");
  await expect(rows).toHaveCount(9);
  await expect(rows.nth(4)).toContainText(/D\s*£1,100\.00/);
  await expect(page.getByTestId("civic-person")).toHaveCount(4);
  await expect(section).toContainText("MP for Westminster preview constituency");
  await expect(page.getByTestId("civic-fetched")).toHaveText("Checked on 1 October 2026.");
  await expect(page.getByTestId("civic-codes")).toContainText("E05000001");
  await expect(page.getByTestId("civic-sources")).toContainText("Demo data");

  // every (?) opens a short explanation and is a 44px target
  const tips = section.locator(".help-tip__button");
  await expect(tips).toHaveCount(4);
  for (const tip of await tips.all()) {
    const box = await tip.boundingBox();
    expect(box && box.width >= 44 && box.height >= 44).toBeTruthy();
  }
  await section.getByRole("button", { name: "About council tax bands" }).click();
  await expect(section).toContainText("band H pays double");

  // no browser-default buttons
  const outset = await page.evaluate(() => [...document.querySelectorAll("button")]
    .filter((button) => button.getClientRects().length > 0)
    .filter((button) => ["outset", "inset"].includes(getComputedStyle(button).borderTopStyle)).length);
  expect(outset).toBe(0);
  // no horizontal page scroll at any viewport
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("a postcode shows the month it was first used", async ({ page }) => {
  await page.goto("/civic?postcode=sw1a1aa");
  await expect(page.getByTestId("civic-breadcrumb").getByRole("listitem").last()).toHaveText("SW1A 1AA");
  await expect(page.getByTestId("civic-codes")).toContainText("Postcode first usedJanuary 1980");
});

test("a borough lists its MP but asks for a neighbourhood for councillors", async ({ page }) => {
  // An old LAD id (before step R2) moves to the current one.
  await page.goto("/civic?area=uk%3Aborough%3AE09000002");
  await expect(page).toHaveURL(/area=uk%3Alad%3AE09000002$/);
  await expect(page.getByTestId("civic-breadcrumb").getByRole("listitem")).toHaveCount(3);
  await expect(page.getByTestId("civic-representatives")).toContainText("Pick a neighbourhood");
  await expect(page.getByTestId("civic-person")).toHaveCount(1);
});

test("demo API answers known places and 404s the rest", async ({ request }) => {
  const area = await request.get("/api/v1/areas/uk%3Amsoa%3AE02000003/civic");
  expect(area.status()).toBe(200);
  expect((await area.json()).schemaVersion).toBe("civic.v1");
  expect((await request.get("/api/v1/postcodes/SE17PB/civic")).status()).toBe(200);
  expect((await request.get("/api/v1/areas/uk%3Alsoa%3AE01009999/civic")).status()).toBe(404);
  expect((await request.get("/api/v1/postcodes/E16AN/civic")).status()).toBe(404);
});
