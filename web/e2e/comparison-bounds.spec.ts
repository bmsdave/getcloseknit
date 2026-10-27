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

// UX-47: two distinct areas minimum, four maximum, no duplicates — invalid
// actions are explained and removing an area updates count and controls.
test("bounds are explained and removal updates the tray", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openRanking(page);
  const tray = page.getByTestId("comparison-tray");
  const boxes = page.getByTestId("match-ranking").getByRole("checkbox", { name: /^Compare / });

  // Below two selections the minimum is explained and the action gated.
  await expect(tray).toContainText("Select at least two areas to compare.");
  await expect(tray.getByRole("button", { name: "Compare areas" })).toBeDisabled();

  // Toggling the same card never duplicates its chip.
  await boxes.nth(0).click();
  await boxes.nth(0).click();
  await boxes.nth(0).click();
  await expect(tray).toContainText("1 of 4 selected");
  await expect(tray.getByTestId("comparison-chip")).toHaveCount(1);

  // Removing the area updates the count, re-gates the action, and the
  // minimum explanation returns.
  await tray.locator(".tray-areas > summary").click();
  await tray.getByTestId("comparison-chip").nth(0).getByRole("button").click();
  await expect(tray).toContainText("0 of 4 selected");
  await expect(tray).toContainText("Select at least two areas to compare.");
  await expect(tray.getByRole("button", { name: "Compare areas" })).toBeDisabled();
  await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "false");
});
