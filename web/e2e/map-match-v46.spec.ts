import { expect, test, type Page } from "./fixtures";

import { findMyArea, seedSearch } from "./wizard";

// v4.6 (check round 3, track "map-match"): the map and My match.

const desktop = (name: string) => name === "desktop";

test("CUJ16: a deep link with a non-price layer and no month asks the layer's own month, never the price month", async ({ page }) => {
  // Real mode with the release's definitions slow to arrive: the placeholder knows no months (the 404 of round 3).
  await page.route("**/api/v1/metrics", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  const asked: string[] = [];
  await page.route("**/api/v1/areas/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("metric") === "noise") asked.push(url.searchParams.get("period") ?? "");
    if (url.searchParams.get("mode") === "real") { url.searchParams.set("mode", "demo"); url.searchParams.set("release", "preview-2026-09"); }
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  await page.goto("/?lat=51.535&lng=-0.12&zoom=13&layer=noise&selected=uk%3Alsoa%3AE01000001&mode=real&release=official-2026-06");
  await expect.poll(() => asked.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page).toHaveURL(/period=2022-12/);
  expect(asked.filter((period) => period !== "2022-12"), `noise asked for ${asked.join(", ")}`).toEqual([]);
  // Requests still in flight when the test ends are not errors of the page.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("CUJ10: a ranking's On map keeps rank= in the address, so a reload shows the same top 10", async ({ page }) => {
  await page.goto("/?layer=price-per-square-metre&period=2026-06&rank=most-expensive");
  await expect(page.getByTestId("ranking-top")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get("lat")), { timeout: 30_000 }).not.toBeNull();
  await expect(page).toHaveURL(/rank=most-expensive/);
  await page.reload();
  await expect(page.getByTestId("ranking-top")).toBeVisible({ timeout: 30_000 });
  // ✕ drops it from the address too.
  await page.getByTestId("ranking-top").getByRole("button", { name: /close|✕/i }).first().click();
  await expect(page).not.toHaveURL(/rank=/);
});

test("CUJ06/CUJ11: a tool's price is the budget, said as from Tools; areas over it are filtered (hatched), not red", async ({ page }) => {
  await page.goto("/?find=budget&price=500000&diagnostics=1");
  const budget = page.locator('[data-testid="match-item"][data-id="affordability"]');
  await expect(budget).toContainText("Budget ≤ £500k · from Tools", { timeout: 30_000 });
  await expect(page.getByTestId("match-list").getByTestId("areas-left")).toBeVisible();
  // Every area the count leaves out is grey under the hatch (no band of its own); those left are coloured.
  const values = async () => page.evaluate(() => {
    const diagnostics = window.__closeKnitDiagnostics;
    if (!diagnostics) return null;
    return [...new Set(diagnostics.renderedFeatureIds())].map((id) => diagnostics.featureValue(id as never));
  });
  const left = Number((await page.getByTestId("areas-left").innerText()).replace(/,/g, ""));
  await expect.poll(async () => (await values())?.filter((value) => value !== null && value !== undefined).length, { timeout: 30_000 }).toBe(left);
});

test("CUJ01: the old blocks under the ten wait behind a flag; Share search stays", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  await expect(page.getByTestId("match-results")).toBeVisible({ timeout: 30_000 });
  for (const gone of ["compare-places", "saved-areas-costs", "match-tailor-open", "refine-schools", "brief-layers", "your-data", "clear-search"]) {
    await expect(page.getByTestId(gone), gone).toHaveCount(0);
  }
  await expect(page.locator(".tray-stages")).toHaveCount(0);
  await expect(page.getByTestId("share-search")).toHaveText(/Share search/);
  // The start questions only while nothing is asked yet.
  await expect(findMyArea(page).getByRole("group", { name: "Kids at home?" })).toHaveCount(0);
});

test("CUJ01: with the flag on (this device), the older blocks come back", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("close-knit.match-extras", "on"));
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  await expect(page.getByTestId("saved-areas-costs")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("your-data")).toBeVisible();
});

async function openFirstRow(page: Page) {
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  const row = page.getByTestId("match-top").getByTestId("match-row").first().locator(".match-row__main");
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByTestId("area-view").filter({ visible: true })).toBeVisible({ timeout: 30_000 });
}

test("CUJ06 desktop: Check a home is on screen in the area panel, with the panel's own way on", async ({ page }, testInfo) => {
  test.skip(!desktop(testInfo.project.name), "the desktop side panel");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFirstRow(page);
  const check = page.getByTestId("panel-check-home").filter({ visible: true });
  await expect(check).toBeVisible();
  const box = (await check.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(900);
});

test("CUJ14 desktop: the panel's crumbs are one line above the title", async ({ page }, testInfo) => {
  test.skip(!desktop(testInfo.project.name), "the desktop side panel");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?lat=51.55&lng=-0.09&zoom=13&selected=uk%3Alsoa%3AE01000001");
  const crumbs = page.getByTestId("wider-areas").locator("ol");
  await expect(crumbs).toBeVisible({ timeout: 30_000 });
  await expect(crumbs.locator("li")).not.toHaveCount(0);
  expect((await crumbs.boundingBox())!.height).toBeLessThanOrEqual(46);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("HomePhone: one Try an example on a first visit", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("intro-example")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dock-example").filter({ visible: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try an example" }).filter({ visible: true })).toHaveCount(1);
  });

  test("CUJ06 phone: an area from My match reads ← My match in the sheet's header, once, and its tiles before the footer", async ({ page }) => {
    await openFirstRow(page);
    const sheet = page.getByTestId("match-sheet");
    await expect(sheet.getByTestId("area-view-back")).toHaveCount(1);
    await expect(sheet.locator(".map-sheet__title")).toHaveCount(0);
    await expect(sheet.locator(".map-sheet__head")).toContainText("My match");
    const footer = sheet.getByTestId("area-view-footer");
    await expect(footer).toHaveCSS("position", "static");
    await sheet.getByTestId("area-view-back").click();
    await expect(page.getByTestId("match-results")).toBeVisible();
  });

  test("CUJ01 phone: a chip tapped scrolls the sheet back to the order and the count", async ({ page }) => {
    await seedSearch(page);
    await page.goto("/?layer=personal-match");
    const count = page.getByTestId("match-count").filter({ visible: true });
    await expect(count).toBeVisible({ timeout: 30_000 });
    const chip = findMyArea(page).getByTestId("chip-good-schools");
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await expect.poll(async () => {
      const box = await count.boundingBox();
      return box !== null && box.y >= 0 && box.y + box.height <= 844;
    }, { timeout: 10_000 }).toBe(true);
  });

  test("CUJ16 phone: a crumb row longer than its room fades at the edge", async ({ page }) => {
    await page.goto("/?selected=uk%3Alsoa%3AE01000001");
    const row = page.getByTestId("wider-areas").locator("ol").filter({ visible: true }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    // Narrow it so it overflows whatever the names: the row then says so with its fade.
    await row.evaluate((node) => { (node as HTMLElement).style.maxWidth = "80px"; });
    await expect(row).toHaveAttribute("data-fade", /end|both/);
  });
});
