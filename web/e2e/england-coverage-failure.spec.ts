import { AREA_TILES, routeEnglandScope, routeNoAreas } from "./england-view";
import { expect, test } from "./fixtures";

// A /map/coverage that fails is said, never painted as London's (England would stay grey for the release), and
// "Try again" asks again (lib/map-coverage.ts keeps no failure). The test server has no evidence API: the
// coverage and the served scope are answered here, with no areas and no values. The map's name is the served
// scope's, failed coverage or not.
const COVERAGE = {
  schemaVersion: "map-coverage.v1", coverage: "england", productReleaseId: "official-2026-06", areaTiles: AREA_TILES,
  bounds: [[-6.45, 49.86], [1.77, 55.82]],
  regions: [{ id: "E12000007", name: "London", bbox: [-0.52, 51.28, 0.34, 51.7] }],
  chunks: [{ id: "E12000007", region: "E12000007", bbox: [-0.52, 51.28, 0.34, 51.7], areas: 4994 }],
};

test("a failed coverage shows a toast and Try again reaches the England map", async ({ page }) => {
  await routeEnglandScope(page);
  await routeNoAreas(page);
  await page.route("**/api/v1/value-packs/**", (route) => {
    const [metricId, period] = new URL(route.request().url()).pathname.split("/").slice(-2);
    return route.fulfill({ json: { schemaVersion: "area-value-pack.v1", metricId, period, sourceVersion: "", values: [] } });
  });
  // The first answer waits for the basemap: a coverage that fails after "Map ready" still says the map is not.
  let fail: (() => Promise<void>) | null = null;
  await page.route("**/api/v1/map/coverage**", (route) => {
    if (fail === null) {
      fail = () => route.fulfill({ status: 500, json: { error: "unavailable" } });
      return;
    }
    return route.fulfill({ json: COVERAGE });
  });
  await page.goto("/?mode=real&release=official-2026-06");
  const status = page.locator(".map-status");
  await expect(status).toHaveText("Map ready", { timeout: 30_000 }); // the basemap, slow under three workers
  await expect.poll(() => fail !== null).toBe(true);
  await fail!();
  const toast = page.locator('[data-testid="map-toast"][data-kind="coverage-failed"]');
  await expect(toast).toContainText("Map didn't load.");
  await expect(status).toHaveText("Map areas unavailable");
  await expect(page.getByRole("region", { name: "Interactive England analytics map" })).toBeVisible();
  await toast.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("region", { name: "Interactive England analytics map" })).toBeVisible();
  await expect(status).toHaveText("Map ready");
});
