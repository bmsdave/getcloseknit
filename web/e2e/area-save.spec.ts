import { expect, test } from "./fixtures";

import { showFullAreaView } from "./evidence";
import { findMyArea, matchItem, PROFILE_KEY, seedSearch } from "./wizard";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

// #12, v3 Fix 22: an area page offers the next steps (♡, Watch, Add to compare; Like this sits in
// What's next › Nearby, and on the map's area card) and they carry over to the home page's results.
// Nothing is stored before one is pressed.

const COMPARE_KEY = "close-knit.compare.v1";
const SHORTLISTS_KEY = "close-knit.saved-shortlists.v1";

const stored = (page: import("@playwright/test").Page) => page.evaluate((keys) => keys.map((key) => window.localStorage.getItem(key)),
  [PROFILE_KEY, COMPARE_KEY, SHORTLISTS_KEY]);

test("save and compare on an area page, then find them on the home page", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/area/lsoa/E01000002");
  const actions = page.getByTestId("area-save-actions");
  // The ♡ is the only Save: no "Save area" text button (v3 Fix 22).
  const heart = actions.getByTestId("save-area");
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await expect(actions.getByRole("button", { name: "Save area" })).toHaveCount(0);
  expect((await stored(page)).slice(1)).toEqual([null, null]);

  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await actions.getByRole("button", { name: "Add to compare" }).click();
  await expect(actions.getByRole("button", { name: "In compare (1)" })).toHaveAttribute("aria-pressed", "true");
  await expect(actions.locator(".area-save-actions__status")).toContainText("Added to compare (1 of 4)");

  await page.goto("/?layer=personal-match");
  const panel = page.getByTestId("match-ranking");
  await expect(panel.getByRole("checkbox", { name: /^Compare .*North London preview|^Compare Highbury/ }).first()).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
  await expect(panel.getByTestId("comparison-tray")).toContainText("1 area");
  await panel.getByTestId("saved-areas-costs").locator(":scope > summary").click();
  const saved = panel.getByTestId("saved-shortlists");
  await expect(saved).toContainText("My shortlist");
  // G38: the name, then "1 area · Saved …" on its own line; Open, Share, Delete.
  const row = saved.getByTestId("shortlist-row").first();
  await expect(row.locator(".shortlist-row__name")).toHaveText("My shortlist");
  await expect(row.getByTestId("shortlist-row-meta")).toHaveText(/^1 area · Saved \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/);
  await expect(row.getByRole("button")).toHaveText(["Open", "Share", "Delete"]);
});

test("Like this opens My match on the basics with the area's ballpark", async ({ page }) => {
  await page.goto("/area/lsoa/E01000002");
  // One "Like this" on the page: What's next › Nearby (v3 Fix 22).
  await expect(page.getByRole("link", { name: "Like this" })).toHaveCount(1);
  await expect(page.getByTestId("area-save-actions").getByTestId("find-like")).toHaveCount(0);
  await page.getByTestId("next-like-this").click();
  const list = findMyArea(page);
  await expect(list.getByTestId("find-like-summary")).toContainText("Like Highbury", { timeout: 15_000 });
  // The top of the middle half of recent sales here (an area band, never one home's price).
  await expect(list.getByTestId("budget-max")).toHaveValue("£840,000", { timeout: 15_000 });
  // Opening the link and reading the area stores nothing.
  expect(await stored(page)).toEqual([null, null, null]);

  await list.getByTestId("budget-max").fill("500000");
  // The keyboard, not the field: the start row takes a budget by itself after a 900 ms pause and goes with its field.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("match-results")).toBeVisible();
  expect(JSON.parse((await stored(page))[0]!).maximumBudget).toBe(500000);
});

test("a find-like link names only London neighbourhoods", async ({ page }) => {
  await page.goto("/?find=like&area=lsoa:nope");
  await expect(page.getByTestId("match-list")).toBeHidden();
});

// v3: on phones the page's one row (♡ · Compare · On map · ⋯) fits without scrolling sideways, and
// the ⋯ menu opens inside the screen. Nothing on the page sits past the viewport's right edge.
for (const width of [320, 390]) {
  test(`the area page's actions fit one row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/area/lsoa/E01000002");
    const row = page.getByTestId("area-save-actions").getByRole("group");
    const controls = row.locator(":scope > button, :scope > a, :scope > details > summary");
    await expect(controls).toHaveCount(4);
    const middles = await controls.evaluateAll((nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); return (box.top + box.bottom) / 2; }));
    expect(Math.max(...middles) - Math.min(...middles), "one row").toBeLessThan(8);
    await row.getByTestId("area-more-menu").locator("summary").click();
    await expect(row.getByTestId("watch-listings-open")).toBeVisible();
    // Like this is What's next › Nearby, not the ⋯ (v3 Fix 22).
    await expect(row.getByTestId("find-like")).toHaveCount(0);
    const past = await page.evaluate(() => {
      const edge = document.documentElement.clientWidth;
      // Inside a sideways scroller (the section chips) a chip past the edge is scrolled to, not off the page.
      const scrolled = (node: Element) => {
        for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (/auto|scroll|hidden/.test(getComputedStyle(parent).overflowX)) return true;
        }
        return false;
      };
      return [...document.querySelectorAll("main *")]
        .filter((node) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.right > edge + 0.5 && !scrolled(node); })
        .map((node) => `${node.tagName}.${node.className}`).slice(0, 5);
    });
    expect(past).toEqual([]);
  });
}

// Bug 13: on the map, "Like this" is a link to the same page (/?find=like&area=…), so the
// page stays mounted and nothing read the new address: the button looked dead.
test("Like this on the map's area card opens My match from that area", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000002");
  const panel = page.getByTestId("evidence-panel");
  // ♡ in the header beside the name (v4 Task 12); the card's row: Watch · Compare · Like this (v3 Fix 22).
  await expect(panel.locator(".area-brief__title-row").getByTestId("save-area")).toBeVisible();
  await expect(panel.getByTestId("save-area")).toHaveCount(1);
  await showFullAreaView(page);
  await expect(panel.getByTestId("area-save-actions").getByRole("button", { name: "Compare" })).toBeVisible();
  await panel.getByTestId("area-save-actions").getByRole("link", { name: "Like this" }).click();
  const note = findMyArea(page).getByTestId("find-like-summary");
  await expect(note).toContainText("Like Highbury", { timeout: 15_000 });
  // Dismissing drops the link from the address, so the button works a second time.
  await note.getByRole("button", { name: "Not from this area" }).click();
  await expect(note).toBeHidden();
  await expect(page).not.toHaveURL(/find=like/);
  await page.goto("/?selected=uk%3Alsoa%3AE01000002&layer=price-per-square-metre");
  await showFullAreaView(page);
  await page.getByTestId("evidence-panel").getByTestId("area-save-actions").getByRole("link", { name: "Like this" }).click();
  await expect(findMyArea(page).getByTestId("find-like-summary")).toContainText("Like Highbury", { timeout: 15_000 });
});

// Item 14: "Find areas like this" starts from all of the area's criteria, not just its price, and says
// which ones it took; the household confirms the budget and lands on them as Musts, each to loosen or tighten.
test("Find areas like this seeds price, crime, station walk and deprivation decile from the area", async ({ page }) => {
  await page.goto("/?find=like&area=lsoa:E01000002");
  const list = findMyArea(page);
  const note = list.getByTestId("find-like-summary");
  await expect(note).toContainText("per m²", { timeout: 15_000 });
  await expect(note).toContainText("crime");
  await expect(note).toContainText("a station within about a 14-minute walk");
  await expect(note).toContainText("official deprivation decile about 4 (1 = most deprived)");
  await expect(note).not.toContainText(/income|social rent|estimated price|worth/i);
  await expect(list.getByTestId("budget-max")).toHaveValue("£840,000", { timeout: 15_000 });
  await list.getByTestId("budget-max").press("Enter");
  for (const id of ["range:crime", "range:station-access", "range:price-per-square-metre", "range:deprivation"]) {
    await expect(matchItem(page, id).getByTestId("match-item-rank")).toHaveText("Must");
  }
  // Loosening one works like any other search.
  await matchItem(page, "range:crime").getByTestId("match-chip").click();
  await page.getByTestId("match-card-range:crime").getByTestId("match-card-must").click();
  await expect(matchItem(page, "range:crime").getByTestId("match-item-rank")).toHaveText(/^#\d$/);
});

// G20: Watch new listings sits in the same row on the area page and on the map's area panel.
test("Watch is in the area's action row on the page and on the map", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  // On the area page Watch is in the row's ⋯ menu.
  await page.getByTestId("area-more-menu").locator("summary").click();
  await expect(page.getByTestId("area-save-actions").getByTestId("watch-listings-open")).toBeVisible();
  await expect(page.getByTestId("watch-listings-open")).toHaveCount(1);
  await page.getByTestId("watch-listings-open").click();
  await expect(page.getByTestId("watch-listings-prompt")).toContainText("St James's");
  await page.goto("/?selected=uk:lsoa:E01000001");
  await showFullAreaView(page);
  // The map panel: Watch beside ♡ in the header (CUJ12 v4), at every height.
  await expect(page.getByTestId("evidence-panel").locator(".area-brief__title-row").getByTestId("watch-listings-open")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("watch-listings-open")).toHaveCount(1);
});
