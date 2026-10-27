import { expect, test, type Page } from "./fixtures";
import { continueToReview, seedClassicSearch } from "./wizard";
import { openMatchBuilder } from "./top-bar";

async function openRanking(page: Page) {
  await seedClassicSearch(page);
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  const ranking = page.getByTestId("match-ranking");
  await expect(ranking.getByRole("checkbox", { name: /^Compare / }).nth(0)).toBeVisible();
}

// UX-46: a persistent comparison tray names every selection, counts toward
// four, removes individually or all at once, and enables Compare areas at
// two selections — staying visible while results scroll.
test("tray tracks selections and gates the compare action", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openRanking(page);
  const tray = page.getByTestId("comparison-tray");
  const boxes = page.getByTestId("match-ranking").getByRole("checkbox", { name: /^Compare / });
  const firstName = ((await boxes.nth(0).textContent()) ?? "").replace(/^Compare /, "").trim();

  // Empty tray: count, disabled action, no chips.
  await expect(tray).toContainText("0 of 4 selected");
  await expect(tray.getByRole("button", { name: "Compare areas" })).toBeDisabled();
  await expect(tray.getByTestId("comparison-chip")).toHaveCount(0);

  // One selection: named chip, count, action still gated.
  await boxes.nth(0).click();
  await expect(tray).toContainText("1 of 4 selected");
  await expect(tray.getByTestId("comparison-chip")).toHaveCount(1);
  await expect(tray.getByTestId("comparison-chip").nth(0)).toContainText(firstName);
  await expect(tray.getByRole("button", { name: "Compare areas" })).toBeDisabled();

  // Two selections: Compare becomes a link to /compare with both areas (v3 Fix 22: no dialog, and
  // no Make my brief here: the brief is Compare › Brief).
  await boxes.nth(1).click();
  await expect(tray).toContainText("2 of 4 selected");
  const compareAction = tray.getByRole("link", { name: "Compare areas" });
  await expect(compareAction).toHaveAttribute("href", /^\/compare\?kind=places&ids=uk%3Alsoa%3A\w+,uk%3Alsoa%3A\w+$/);
  await expect(tray.getByTestId("make-brief")).toHaveCount(0);

  // Keyboard removal of one chip drops the count and re-gates the action.
  // The names (each removable) and Clear open from the count.
  await tray.locator(".tray-areas > summary").click();
  await tray.getByTestId("comparison-chip").nth(0).getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(tray).toContainText("1 of 4 selected");
  await expect(tray.getByRole("button", { name: "Compare areas" })).toBeDisabled();

  // Clear empties the tray and unchecks every card.
  await boxes.nth(0).click();
  await expect(tray).toContainText("2 of 4 selected");
  await tray.getByRole("button", { name: "Clear" }).click();
  await expect(tray).toContainText("0 of 4 selected");
  await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "false");
  await expect(boxes.nth(1)).toHaveAttribute("aria-checked", "false");
});

test.describe("mobile comparison tray", () => {
  test.use({ hasTouch: true });

  test("tray stays visible while results scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRanking(page);
    const tray = page.getByTestId("comparison-tray");
    const boxes = page.getByTestId("match-ranking").getByRole("checkbox", { name: /^Compare / });
    await boxes.nth(0).tap();
    await expect(tray.getByTestId("comparison-chip")).toHaveCount(1);

    // Scroll the last card into view; the sticky tray must remain on screen.
    await boxes.last().scrollIntoViewIfNeeded();
    const box = await tray.boundingBox();
    expect(box, "tray visible while scrolling").not.toBeNull();
    expect(box?.y ?? 844).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 844) + (box?.height ?? 844)).toBeLessThanOrEqual(844);
  });
});
