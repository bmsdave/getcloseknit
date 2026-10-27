import { expect, test, type Page } from "./fixtures";

import { openMatchBuilder } from "./top-bar";
import { findMyArea, matchItem, PROFILE_KEY } from "./wizard";

// "Try an example": results at once from a ready-made search, under a banner that says so, and
// nothing written: the household's storage is the same before and after (the camera's saved map view
// aside, which every map move updates, and the anonymous usage ids, lib/usage.ts, written whenever its
// first events are sent).
const SKIPPED = ["close-knit.map-state.v2", "close-knit.visitor.v1", "close-knit.session.v1"];

async function storage(page: Page) {
  return page.evaluate((skip) => {
    const read = (store: Storage) => Object.fromEntries(Object.keys(store).filter((key) => !skip.includes(key) && !key.startsWith("close-knit.intro"))
      .map((key) => [key, store.getItem(key)]));
    return { local: read(window.localStorage), session: read(window.sessionStorage) };
  }, SKIPPED);
}

test("the example shows results under its banner and saves nothing", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page.getByTestId("intro-example")).toBeVisible();
  const before = await storage(page);
  await page.getByTestId("intro-example").click();
  const panel = page.getByTestId("match-ranking");
  await expect(panel.getByTestId("example-banner")).toContainText("Example search");
  if (isMobile) {
    // A phone opens the example's sheet lowered over London; up to full to read the list.
    await page.getByTestId("match-sheet").getByTestId("map-sheet-handle").focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
  }
  await expect(matchItem(page, "affordability")).toContainText("£600k");
  await expect(matchItem(page, "range:crime")).toBeVisible();
  await expect(page.getByTestId("match-top").getByTestId("match-row").first()).toBeVisible({ timeout: 15_000 });

  expect(await storage(page)).toEqual(before);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), PROFILE_KEY)).toBeNull();

  // Making it theirs: the household's own search, saved as usual.
  await panel.getByRole("button", { name: "Make it mine" }).click();
  await expect(panel.getByTestId("example-banner")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PROFILE_KEY)).not.toBeNull();
});

test("the budget field reads money and waits for a real figure", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  const budget = findMyArea(page).getByTestId("budget-max");
  await expect(budget).toHaveValue("");
  await expect(budget).toHaveAttribute("placeholder", "Max price, e.g. £650k");
  await expect(budget).toHaveAttribute("inputmode", "numeric");
  // Nothing below £10k is a price: the start rows stay.
  await budget.fill("0");
  await budget.press("Enter");
  await expect(findMyArea(page).getByTestId("match-budget-start")).toBeVisible();
  // Renting asks a monthly figure.
  await findMyArea(page).getByRole("group", { name: "Buy or rent" }).getByRole("button", { name: "Rent" }).click();
  await expect(findMyArea(page).getByTestId("budget-max")).toHaveAttribute("placeholder", "Max rent, e.g. £2,500");
  await findMyArea(page).getByTestId("budget-max").fill("2300");
  // The keyboard, not the field: the start row takes a budget by itself after a 900 ms pause and goes with its field.
  await page.keyboard.press("Enter");
  await expect(matchItem(page, "affordability")).toContainText("£2,300 a month");
});
