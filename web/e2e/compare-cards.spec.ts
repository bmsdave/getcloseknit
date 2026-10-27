import { expect, test, type Page } from "./fixtures";
import { continueToReview, seedClassicSearch } from "./wizard";
import { openMatchBuilder } from "./top-bar";

async function openRanking(page: Page) {
  await seedClassicSearch(page);
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  await expect(page.getByTestId("match-ranking")).toContainText("match");
}

// UX-45: every ranked result card carries an explicit checkbox-style Compare
// control named with the full area name, operable by pointer, touch, and
// keyboard, with its selection state exposed.
test("compare controls are named checkboxes with visible state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openRanking(page);
  const ranking = page.getByTestId("match-ranking");
  const boxes = ranking.getByRole("checkbox", { name: /^Compare / });

  // One named control per card, starting unchecked.
  await expect(boxes.nth(0)).toBeVisible();
  expect(await boxes.count()).toBeGreaterThanOrEqual(2);
  const firstName = await boxes.nth(0).getAttribute("aria-label");
  expect(firstName ?? "").toMatch(/Compare \S.+preview/);
  await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "false");

  // Pointer toggles selection state on and off.
  await boxes.nth(0).click();
  await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("comparison-tray")).toContainText("Select at least two areas to compare.");
  await boxes.nth(0).click();
  await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "false");

  // Keyboard toggles a second card; the tray's Compare opens /compare with both (v3 Fix 22: no dialog).
  await boxes.nth(0).click();
  await boxes.nth(1).focus();
  await page.keyboard.press("Space");
  await expect(boxes.nth(1)).toHaveAttribute("aria-checked", "true");
  const compare = page.getByTestId("comparison-tray").getByRole("link", { name: "Compare areas" });
  await expect(compare).toHaveAttribute("href", /^\/compare\?/);
  await compare.click();
  await expect(page).toHaveURL(/\/compare\?/);
  await expect(page.getByTestId("comparison-dialog")).toHaveCount(0);
});

test.describe("mobile compare controls", () => {
  test.use({ hasTouch: true });

  test("touch toggles the checkbox state", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRanking(page);
    const boxes = page.getByTestId("match-ranking").getByRole("checkbox", { name: /^Compare / });
    await expect(boxes.nth(0)).toBeVisible();
    await boxes.nth(1).tap();
    await expect(boxes.nth(1)).toHaveAttribute("aria-checked", "true");
  });
});
