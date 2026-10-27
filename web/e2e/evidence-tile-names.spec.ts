import { expect, test } from "./fixtures";

// The map's area tiles (v4 Task 12: the area page's own): each is one link named by its label and value,
// with the London strip spoken as words ("Better than 92% of London"); labels are sentence case, never
// codes, and nothing says x/10.
test("area tile names are clean and in sentence case", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");
  const panel = page.getByTestId("evidence-panel");
  const tile = panel.getByTestId("area-tile-safety");
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await expect(tile).toHaveAccessibleName(/^Safety More crime than \d+%/);
  await expect(tile.getByTestId("london-strip")).toHaveAccessibleName(/^(Better|Worse) than \d+% of London$|^No London rank$/);
  const names = await panel.locator(".standout-tile__label").allTextContents();
  expect(names.length).toBeGreaterThan(0);
  for (const label of names) expect(label).not.toMatch(/[A-Z]{3,}|\s,|\/10/);
});
