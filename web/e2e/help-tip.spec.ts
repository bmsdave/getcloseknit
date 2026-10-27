import { expect, test } from "./fixtures";

// (?) bubbles: open on tap, link to the guide, and Escape closes only the
// bubble (focus back on its button) while the evidence sheet stays open.
test("Escape closes a help bubble without closing the evidence sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("Sample Street");
  await page.getByRole("option", { name: /10 Sample Street/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

  // The chosen home's public-record (?) in the side panel (v4 Task 12 dropped the home cost's).
  const help = page.locator(".evidence-panel .brief-home .help-tip__button").first();
  await expect(help).toBeVisible({ timeout: 20_000 });
  await help.click();
  const bubble = page.locator(".help-tip__bubble");
  await expect(bubble).toBeVisible();
  await expect(bubble.getByRole("link", { name: /Learn more/ })).toHaveAttribute("href", /^\/guide\//);
  // The bubble stays inside the screen: no sideways scroll on phones.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.keyboard.press("Escape");
  await expect(bubble).toHaveCount(0);
  await expect(help).toBeFocused();
  await expect(page.getByTestId("selected-area")).toBeVisible();
  // The panel's own Escape (v4.3) waits for the next press: the bubble took this one.
  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "half");
  // PR #314 (Esc ladder): the next Escape deselects the area, so its panel goes.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-area", "empty");
});
