import { expect, test } from "./fixtures";
import { openTopMenu } from "./top-bar";

test("the menu links to the terms of use and the page states the essentials", async ({ page }) => {
  await page.goto("/");
  await openTopMenu(page);
  // The href, then a direct visit: a menu click can race the map's own URL update on the dev server.
  await expect(page.getByTestId("terms-link")).toHaveAttribute("href", "/terms");
  await page.goto("/terms");
  const terms = page.getByTestId("terms-page");
  await expect(terms.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(terms.getByTestId("terms-not-advice")).toContainText("Not financial advice");
  await expect(terms.locator("#acceptable-use")).toContainText("bulk extraction");
  await expect(terms.locator("#reuse")).toContainText("Hidden homes stay hidden");
  await expect(terms.getByTestId("terms-places-download")).toHaveAttribute("href", "/api/v2/downloads/places.csv");
  await expect(terms.locator("#law")).toContainText("England and Wales");
  await expect(terms.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
});

test("the AI agents page and the privacy notice link to the terms", async ({ page }) => {
  // /claude is /agents now (v3 Fix 17).
  await page.goto("/claude");
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.locator(".subpage-foot").getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", "/terms");
  await page.goto("/privacy");
  await expect(page.locator(".subpage-foot").getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", "/terms");
});
