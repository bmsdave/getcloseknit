import { expect, test } from "./fixtures";

// Wave 3 subpage polish: the header's ♡ N (named "Saved (N)") for a returning reader.

const SHORTLISTS_KEY = "close-knit.saved-shortlists.v1";

test("the header shows Saved (N) only when this browser has saved some, and stores nothing", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.getByTestId("site-header")).toBeVisible();
  await expect(page.getByTestId("header-saved-areas")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key !== "close-knit.visitor.v1"))).toEqual([]);

  const saved = JSON.stringify([
    { id: "a", name: "My shortlist", candidates: ["uk:lsoa:E01000001", "uk:lsoa:E01000002"] },
    { id: "b", name: "Second", candidates: ["uk:lsoa:E01000002"] },
  ]);
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [SHORTLISTS_KEY, saved]);
  await page.goto("/rankings/most-expensive");
  const link = page.getByTestId("site-header").getByRole("link", { name: "Saved (2)" });
  await expect(link).toBeVisible();
  await expect(link).toHaveText("2");
  // Off the map, ♡ N opens the map on Saved.
  await expect(link).toHaveAttribute("href", "/?saved=1");
  // The anonymous usage id (lib/usage.ts) aside, only what the reader saved.
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key !== "close-knit.visitor.v1"))).toEqual([SHORTLISTS_KEY]);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), SHORTLISTS_KEY)).toBe(saved);
});
