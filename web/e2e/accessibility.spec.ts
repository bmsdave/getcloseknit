import { expect, test } from "./fixtures";

import { continueToReview, matchItem } from "./wizard";
import { openMatchBuilder, openMatchBuilderByKeyboard } from "./top-bar";

test("core exploration is keyboard operable and exposes textual evidence", async ({ page }) => {
  // PR #284: Price per m² opens on Rank in London; ?scale=linear keeps this on Actual.
  await page.goto("/?scale=linear");

  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await search.focus();
  await search.fill("SW1A");
  await expect(page.getByRole("option", { name: /SW1A 1AA.*Westminster/ })).toBeVisible();
  // Past the Postcode group (the SW1A 1AA and SW1A 1AB pages) to the home in SW1A 1AA.
  await search.press("ArrowDown");
  await search.press("ArrowDown");
  await search.press("Enter");

  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByLabel(/Price per square metre colour legend, £\d+(\.\d)?k/)).toBeVisible();
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£9,600");

  // The map's Layers button opens the Layers menu; Enter on a group opens it in place, the arrow goes
  // down into its items, Enter chooses, Escape closes (Crime stays open for its types) and focus returns.
  const layers = page.getByTestId("layers-toggle");
  await layers.focus();
  await layers.press("Enter");
  await page.getByTestId("topic-group-safety").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("topic-group-safety")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("layer-crime")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  await page.keyboard.press("Escape");
  await expect(layers).toBeFocused();
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Crime");
});

test("reduced motion disables meaningful CSS animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const duration = await page.getByTestId("close-knit").evaluate(
    (element) => getComputedStyle(element).animationDuration,
  );
  const durationMs = duration.endsWith("ms")
    ? Number.parseFloat(duration)
    : Number.parseFloat(duration) * 1_000;
  expect(durationMs).toBeLessThanOrEqual(0.01);
});

test("personal priorities move focus and expose keyboard-adjusted explanations", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  // My match opens on its list with the budget focused (v4 Task 21c: no wizard).
  const budget = page.getByTestId("match-list").getByTestId("budget-max");
  await expect(budget).toBeFocused();
  await budget.fill("650000");
  // The keyboard, not the field: the start row takes a budget by itself after a 900 ms pause and goes with its field.
  await page.keyboard.press("Enter");

  // "What matters" chips are buttons: Tab to one and press it.
  await page.getByTestId("chip-safer-streets").focus();
  await page.keyboard.press("Enter");
  await expect(matchItem(page, "range:crime")).toBeVisible();
  // The ≡ handle reorders from the keyboard and keeps focus.
  const handle = matchItem(page, "range:crime").locator(".match-item__handle");
  await expect(handle).toHaveAccessibleName(/^Move Safer streets, priority 1 of 1$/);
  await page.getByTestId("match-top").getByRole("button", { name: /preview/ }).first().click();
  // v4.4: the row opens the one area view; "← My match" goes back to the list, from the keyboard too.
  await expect(page.getByTestId("area-view")).toBeVisible();
  const back = page.getByTestId("area-view-back");
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("match-ranking")).toContainText("Safer streets");
});

test("mobile search-to-comparison journey stays keyboard operable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile sheet and touch-target journey");

  await page.goto("/");

  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await search.focus();
  await search.fill("SW1A");
  await expect(page.getByRole("listbox", { name: "Search results" })).toBeVisible();
  await expect(search).toHaveAttribute("aria-expanded", "true");
  // Past the Postcode group (the SW1A 1AA and SW1A 1AB pages) to the home in SW1A 1AA.
  await search.press("ArrowDown");
  await search.press("ArrowDown");
  await search.press("Enter");

  const selected = page.getByTestId("selected-area");
  await expect(selected).toContainText(/St James's|Westminster/);
  await expect(selected).toBeFocused();

  const close = page.getByTestId("evidence-sheet-close");
  await close.focus();
  await close.press("Enter");
  await expect(page.getByTestId("evidence-panel")).toBeHidden();
  const reopen = page.getByTestId("evidence-sheet-reopen");
  await reopen.focus();
  await reopen.press("Enter");
  await expect(page.getByTestId("evidence-panel")).toBeVisible();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

  const layers = page.getByTestId("layers-toggle");
  await layers.focus();
  await layers.press("Enter");
  await page.getByTestId("topic-group-safety").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("layer-crime")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Crime");

  await openMatchBuilderByKeyboard(page);
  await continueToReview(page);
  const ranking = page.getByTestId("match-ranking");
  await expect(ranking).toBeVisible();

  const compareButtons = ranking.getByRole("checkbox", { name: /^Compare / });
  await compareButtons.nth(0).focus();
  await compareButtons.nth(0).press("Enter");
  await compareButtons.nth(1).focus();
  await compareButtons.nth(1).press("Enter");

  // v3 Fix 22: Compare opens /compare (no dialog); the tray's names are removable by keyboard.
  const tray = page.getByTestId("comparison-tray");
  await expect(tray.getByRole("link", { name: "Compare areas" })).toHaveAttribute("href", /^\/compare\?/);
  const names = tray.locator(".tray-areas > summary");
  await names.focus();
  await names.press("Enter");
  const firstLabel = await compareButtons.nth(0).getAttribute("aria-label");
  await expect(tray.getByTestId("comparison-chip").first()).toContainText((firstLabel ?? "").replace(/^[^A-Za-z]*Compare /, "").trim());
  const remove = tray.getByRole("button", { name: /^Remove / }).first();
  await remove.focus();
  await remove.press("Enter");
  await expect(tray).toContainText("Select at least two areas to compare.");
});

// C2/C8: the first Tab on a page off the map is Skip to content; Enter moves focus into
// <main>, past the header, so the next Tab is the page's own content.
for (const path of ["/area/lsoa/E01000001", "/rankings/most-expensive", "/guide/reading-the-map", "/property/100000000001"]) {
  test(`skip to content comes first on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByTestId("site-header")).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    const where = await page.evaluate(() => {
      const active = document.activeElement;
      return { inMain: Boolean(active?.closest("main")), inHeader: Boolean(active?.closest(".site-header")) };
    });
    expect(where).toEqual({ inMain: true, inHeader: false });
    expect(page.url()).not.toContain("#");
  });
}
