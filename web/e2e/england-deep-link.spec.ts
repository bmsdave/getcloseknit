import { expect, test, type Page } from "./fixtures";
import { AREA_TILES, routeEnglandScope, routeNoAreas } from "./england-view";

// The England map (CLOSE_KNIT_ENGLAND): a link naming an area outside London without a position used to stay on
// central London. The test server has no evidence API, so the coverage, the areas and the Cornwall area's own
// evidence are answered here; everything else is the demo answer.
const CORNWALL = "uk:lsoa:E01019015";
const CORNWALL_BOX = [-4.8, 50.33, -4.76, 50.36];
const COVERAGE = {
  schemaVersion: "map-coverage.v1", coverage: "england", productReleaseId: "official-2026-06", areaTiles: AREA_TILES,
  bounds: [[-6.45, 49.86], [1.77, 55.82]],
  regions: [
    { id: "E12000007", name: "London", bbox: [-0.52, 51.28, 0.34, 51.7] },
    { id: "E12000009", name: "South West", bbox: [-6.45, 49.86, -1.48, 51.69] },
  ],
  chunks: [
    { id: "E12000007", region: "E12000007", bbox: [-0.52, 51.28, 0.34, 51.7], areas: 4994 },
    { id: "E06000052", region: "E12000009", bbox: [-5.75, 49.95, -4.16, 50.94], areas: 326 },
  ],
};

async function routeEngland(page: Page) {
  await page.route("**/api/v1/areas/**", async (route) => {
    const url = new URL(route.request().url());
    if (!decodeURIComponent(url.pathname).includes(CORNWALL)) return route.fallback();
    // Cornwall's card reads as a London fixture area's, placed in Cornwall and its region.
    url.pathname = decodeURIComponent(url.pathname).replace(CORNWALL, "uk:lsoa:E01000001");
    url.searchParams.set("mode", "demo");
    url.searchParams.set("release", "preview-2026-09");
    const response = await route.fetch({ url: url.toString() });
    // Relabelled so real mode does not reject them as "preview-" fixtures (as e2e/real-environment.ts).
    const text = (await response.text()).replaceAll("\"preview-", "\"pilot-");
    const body = (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } })();
    if (!body || body.schemaVersion !== "area-summary.v1") return route.fulfill({ response });
    const summary = { ...(body.summary as object), geographyId: CORNWALL };
    return route.fulfill({ response, json: { ...body, summary, bbox: CORNWALL_BOX, rankScope: { code: "E12000009", name: "South West" } } });
  });
  // No areas and no values in view: the map has nothing of Cornwall's until it flies there.
  await routeNoAreas(page);
  await page.route("**/api/v1/value-packs/**", (route) => {
    const [metricId, period] = new URL(route.request().url()).pathname.split("/").slice(-2);
    return route.fulfill({ json: { schemaVersion: "area-value-pack.v1", metricId, period, sourceVersion: "", values: [] } });
  });
  await routeEnglandScope(page);
  await page.route("**/api/v1/map/coverage**", (route) => route.fulfill({ json: COVERAGE }));
}

test("a link to an area outside London without a position flies there and writes it to the address", async ({ page }) => {
  await routeEngland(page);
  await page.goto(`/?mode=real&release=official-2026-06&selected=${encodeURIComponent(CORNWALL)}`);
  await expect.poll(() => {
    const url = new URL(page.url());
    return [Number(url.searchParams.get("lat")), Number(url.searchParams.get("lng"))];
  }, { timeout: 20_000 }).toEqual([expect.closeTo(50.345, 1), expect.closeTo(-4.78, 1)]);
  // The card's breadcrumbs start at the area's region, not London.
  await expect(page.getByTestId("wider-areas-region").first()).toHaveText("South West");
  // A section still loading would otherwise end in route.fetch after the test ("Test ended", an error outside any test).
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
