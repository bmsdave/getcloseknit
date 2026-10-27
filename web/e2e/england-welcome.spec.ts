import { expect, test, type Page } from "./fixtures";
import { AREA_TILES, routeEnglandScope, routeNoAreas } from "./england-view";

// The welcome card on the England map (CLOSE_KNIT_ENGLAND): no "London homes", and no commute promised outside
// London (TfL journeys are London's). The test server has no evidence API, so the coverage is answered here, with
// no areas and no values: only the card's words are under test. London's words stay (e2e/first-view.spec.ts).
const COVERAGE = {
  schemaVersion: "map-coverage.v1", coverage: "england", productReleaseId: "official-2026-06", areaTiles: AREA_TILES,
  bounds: [[-6.45, 49.86], [1.77, 55.82]],
  regions: [{ id: "E12000007", name: "London", bbox: [-0.52, 51.28, 0.34, 51.7] }],
  chunks: [{ id: "E12000007", region: "E12000007", bbox: [-0.52, 51.28, 0.34, 51.7], areas: 4994 }],
};

async function routeEngland(page: Page) {
  await routeNoAreas(page);
  await page.route("**/api/v1/value-packs/**", (route) => {
    const [metricId, period] = new URL(route.request().url()).pathname.split("/").slice(-2);
    return route.fulfill({ json: { schemaVersion: "area-value-pack.v1", metricId, period, sourceVersion: "", values: [] } });
  });
  await routeEnglandScope(page);
  await page.route("**/api/v1/map/coverage**", (route) => route.fulfill({ json: COVERAGE }));
}

test("on the England map the welcome card names no city and promises no commute", async ({ page }) => {
  await routeEngland(page);
  await page.goto("/?mode=real&release=official-2026-06");
  const intro = page.getByTestId("intro-card");
  await expect(intro.getByTestId("intro-value")).toHaveText("What homes really sold for, and which areas fit your budget");
  await expect(intro.getByTestId("intro-steps").locator("li")).toHaveText(["Budget & needs", "Matching areas", "Compare & brief"]);
  await expect(intro).not.toContainText(/London|commute/);
});
