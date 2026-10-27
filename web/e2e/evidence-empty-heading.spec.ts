import { expect, test } from "./fixtures";

// Cross-lane contract 6: the empty evidence panel's line is an h2 (the page's
// one h1 is the intro's value line); its test id and focus target stay. With
// nothing chosen a desktop shows no panel (v3 Fix 1): the hint under the search
// says it; a phone's sheet shows it once opened from its peek.
test("the empty evidence panel names the next action in an h2", async ({ page }, testInfo) => {
  await page.goto("/");
  const line = page.getByTestId("selected-area");
  await expect(line).toHaveText(/Choose an area\s*on the map or search/);
  if (testInfo.project.name === "mobile") {
    await page.getByTestId("evidence-sheet-reopen").click();
    await expect(page.getByRole("heading", { level: 2, name: /Choose an area/ })).toBeVisible();
  } else {
    await expect(page.getByTestId("map-dock")).toBeHidden();
    await expect(page.getByRole("heading", { level: 2, name: /Choose an area/, includeHidden: true })).toHaveCount(1);
  }
  await expect(line).toHaveAttribute("tabindex", "-1");
  await expect(page.getByTestId("evidence-panel").locator("h1")).toHaveCount(0);
});
