import { expect, test } from "./fixtures";
import { routeEnglandScope } from "./england-view";

// The places the site serves (GET /api/v1/scope) did not load: the page says so over everything with Try again,
// rather than passing London's words off as the map's (DESIGN.md §6, England map). The test server has no evidence
// API, so the browser asks for the scope itself.
test("a scope that does not load says so, and Try again loads it", async ({ page }) => {
  let fail = true;
  await page.route("**/api/v1/scope**", async (route) => {
    if (fail) return route.fulfill({ status: 503, json: { error: "unavailable" } });
    return route.fallback();
  });
  await page.goto("/area/london");
  const notice = page.getByTestId("scope-error");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("What the map covers didn't load.");
  fail = false;
  await routeEnglandScope(page);
  await page.getByTestId("scope-error-retry").click();
  await expect(notice).toHaveCount(0);
});
