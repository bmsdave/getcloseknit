import { expect, test } from "./fixtures";

import { sectionToggle, openAreaPage } from "./evidence";
import { matchOpener, openMatchBuilderByKeyboard } from "./top-bar";

// UX-63, v4 Task 21c: My match opens from the round button by keyboard straight on the budget field (no wizard
// dialog to trap focus in: on a desktop it is the side panel).
test("Enter on My match lands on the budget field", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await openMatchBuilderByKeyboard(page);
  await expect(page.getByTestId("match-list").getByTestId("budget-max")).toBeFocused();
});

test("the skip link leads to area evidence", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to area evidence" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#area-evidence")).toBeFocused();
});

test("the full page's section chips work by keyboard and move focus to the section", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/area/lsoa/E01000001");
  await openAreaPage(page);

  const chip = page.getByTestId("area-tab-price");
  await chip.focus();
  await page.keyboard.press("Enter");
  const header = sectionToggle(page, "Price");
  await expect(header).toBeFocused();
  await expect(header).toBeInViewport();
  await expect(page.getByTestId("market-trend-price")).toBeVisible();
});

// v4 Task 13: on a phone My match is the one MapSheet: Escape closes it and focus returns to its opener.
test("the My match sheet closes on Escape and gives focus back at mobile size", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openMatchBuilderByKeyboard(page);
  await expect(page.getByTestId("match-sheet")).toBeVisible();
  await expect(page.getByTestId("match-list").getByTestId("budget-max")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("match-sheet")).toHaveCount(0);
  await expect(matchOpener(page)).toBeFocused();
});
