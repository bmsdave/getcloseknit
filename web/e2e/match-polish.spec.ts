import { expect, test } from "./fixtures";

import { SEEDED_SEARCH, seedSearch } from "./wizard";

// v4.2 follow-ups from the v4.1 reviews of My match (preview data): Best value only with areas to compare, and an
// area that fails a Must reads as filtered (the neutral hatch), never as scored low (red).
const SOUTH_BANK_ID = "uk:lsoa:E01000003";

test("Best value is hidden while no area has 20+ sales to compare, shown once the pack says some have", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  await expect(page.getByTestId("match-top").getByTestId("match-row").first()).toBeVisible();
  // The preview has no good-value figures: no sort switch at all (not a switch that then says "not enough sales").
  await expect(page.getByTestId("match-sort")).toHaveCount(0);
  await expect(page.getByTestId("match-sort-value")).toHaveCount(0);

  // The API's score pack says how many areas Best value would list (valueAreas).
  await page.route("**/api/v1/matches?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: body.schemaVersion?.startsWith("match-pack") ? { ...body, valueAreas: 2 } : body });
  });
  await page.reload();
  await expect(page.getByTestId("match-sort")).toBeVisible();
  await expect(page.getByTestId("match-sort-value")).toHaveText("Best value");
});

test("an area that fails a Must says Out in the neutral hatch, not the red of a low score", async ({ page, isMobile }) => {
  test.skip(isMobile, "the phone search list sits under My match's sheet; the badge is the same component");
  // Crime ≤ 60 as a Must: South Bank (crime 76) fails it.
  await seedSearch(page, {
    factors: SEEDED_SEARCH.factors.filter((factor) => factor.factorId !== "crime"),
    ranges: [{ layer: "crime", min: null, max: 60, softMin: null, softMax: null, importance: 3, must: true }],
  });
  await page.goto("/?layer=personal-match");
  // v4.4: an area chosen in My match opens the one area view; its score badge says Out.
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await search.fill("SE1 7PB");
  await page.getByRole("option", { name: /South Bank, London/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`selected=${encodeURIComponent(SOUTH_BANK_ID)}`));
  const label = page.getByTestId("area-view-score").filter({ visible: true }).first();
  await expect(label).toHaveText("Out of your search");
  const style = await label.evaluate((node) => {
    const css = getComputedStyle(node);
    return { image: css.backgroundImage, colour: css.backgroundColor, text: css.color };
  });
  expect(style.image).toContain("repeating-linear-gradient");
  expect(style.colour).toBe("rgba(0, 0, 0, 0)");
  expect(style.text).not.toBe("rgb(255, 255, 255)");
});
