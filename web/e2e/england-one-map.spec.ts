import { expect, test, type Page } from "./fixtures";
import { AREA_TILES, routeEnglandScope, squaresTile } from "./england-view";

// The England map is one map (CLOSE_KNIT_ENGLAND): a view across London's boundary loads London and its neighbours
// at the same level, paints them in the same frame, and colours both by rank in England. The test server has no
// evidence API, so the coverage, tiles, boxes and value packs are answered here: one area each side of the line.
const LONDON = "E12000007";
const SOUTH_EAST = "E12000008";
const COVERAGE = {
  schemaVersion: "map-coverage.v1", coverage: "england", productReleaseId: "official-2026-06", areaTiles: AREA_TILES,
  bounds: [[-6.45, 49.86], [1.77, 55.82]],
  regions: [
    { id: LONDON, name: "London", bbox: [-0.52, 51.28, 0.34, 51.7] },
    { id: SOUTH_EAST, name: "South East", bbox: [-1.96, 50.57, 1.45, 52.2] },
  ],
  chunks: [
    { id: LONDON, region: LONDON, bbox: [-0.52, 51.28, 0.34, 51.7], areas: 1 },
    { id: "E07000072", region: SOUTH_EAST, bbox: [-0.06, 51.45, 0.4, 51.8], areas: 1 },
  ],
};
// Two squares by the map's middle at both views (z9 at 51.5,-0.12 and z8 at 51.6,0.2), on a laptop and a phone.
const AREAS: Record<string, { carrier: "lsoa" | "msoa"; id: string; box: [number, number, number, number]; london: number; england: number }[]> = {
  [LONDON]: [
    { carrier: "lsoa", id: "uk:lsoa:E01000001", box: [-0.14, 51.5, -0.06, 51.58], london: 20, england: 85 },
    { carrier: "msoa", id: "uk:msoa:E02000001", box: [-0.14, 51.5, -0.06, 51.58], london: 20, england: 85 },
  ],
  [SOUTH_EAST]: [
    { carrier: "lsoa", id: "uk:lsoa:E01024000", box: [-0.06, 51.5, 0.02, 51.58], london: 95, england: 88 },
    { carrier: "msoa", id: "uk:msoa:E02005000", box: [-0.06, 51.5, 0.02, 51.58], london: 95, england: 88 },
  ],
};
AREAS.E07000072 = AREAS[SOUTH_EAST];

/** The neighbours answer late: a map that painted London first would show it alone. */
async function routeEngland(page: Page, requests: string[]) {
  const late = (chunks: string[]) => chunks.some((chunk) => chunk !== LONDON);
  await routeEnglandScope(page);
  await page.route("**/api/v1/map/coverage**", (route) => route.fulfill({ json: COVERAGE }));
  await page.route("**/api/v1/tiles/areas/**", (route) => {
    const [kind, z, x, y] = new URL(route.request().url()).pathname.split("/").slice(-4);
    const squares = [...AREAS[LONDON], ...AREAS[SOUTH_EAST]].filter((area) => area.carrier === kind);
    const body = squaresTile(kind, squares, Number(z), Number(x), Number(y.replace(".mvt", "")));
    return body.length ? route.fulfill({ status: 200, body, headers: { "content-type": "application/vnd.mapbox-vector-tile" } })
      : route.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/areas/boxes**", async (route) => {
    const url = new URL(route.request().url());
    const carrier = url.searchParams.get("carrier");
    const chunk = url.searchParams.get("chunk") ?? "";
    requests.push(`boxes ${chunk} ${carrier}`);
    if (late([chunk])) await new Promise((resolve) => setTimeout(resolve, 1_000));
    const areas = (AREAS[chunk] ?? []).filter((area) => area.carrier === carrier).map((area) => [area.id, ...area.box]);
    return route.fulfill({ json: { schemaVersion: "area-boxes.v1", carrier, areas } });
  });
  await page.route("**/api/v1/value-packs/**", async (route) => {
    const url = new URL(route.request().url());
    const [metricId, period] = url.pathname.split("/").slice(-2);
    const chunks = (url.searchParams.get("chunk") ?? "").split(",").filter(Boolean);
    const carrier = url.searchParams.get("level") ?? "lsoa";
    requests.push(`values ${chunks.join(",")} ${carrier}`);
    if (late(chunks)) await new Promise((resolve) => setTimeout(resolve, 1_000));
    const values = chunks.flatMap((chunk) => AREAS[chunk] ?? []).filter((area) => area.carrier === carrier).map((area) => ({
      geographyId: area.id, name: "", metricId, period, value: 5000 + area.london, regionPercentile: area.london,
      countryPercentile: area.england, sampleCount: 10, quality: "observed", sourceVersion: "", carrier,
    }));
    return route.fulfill({ json: { schemaVersion: "area-value-pack.v1", metricId, period, sourceVersion: "", values } });
  });
}

for (const view of [{ lat: 51.5, lng: -0.12, zoom: 9 }, { lat: 51.6, lng: 0.2, zoom: 9.2 }]) {
  test(`across London's boundary at z${view.zoom}, both sides paint in one frame at one level on one scale for the view`, async ({ page }) => {
    const requests: string[] = [];
    await routeEngland(page, requests);
    await page.goto(`/?mode=real&release=official-2026-06&layer=price-per-square-metre&lat=${view.lat}&lng=${view.lng}&zoom=${view.zoom}&diagnostics=1`);
    // The first frame with any area coloured in it (the tiles draw every area, clear until its colour lands).
    const first = await page.waitForFunction(() => {
      const ids = (window.__closeKnitDiagnostics?.renderedFeatureIds() ?? []).map(String)
        .filter((id) => window.__closeKnitDiagnostics?.featureValue(id as never) != null);
      return ids.length ? ids : null;
    }, null, { polling: "raf", timeout: 30_000 });
    const ids = [...new Set(await first.jsonValue() as string[])].sort();
    expect(ids).toEqual(["uk:lsoa:E01000001", "uk:lsoa:E01024000"]);
    // One level for both regions: no London-only piece.
    const boxes = requests.filter((request) => request.startsWith("boxes"));
    expect(new Set(boxes.map((request) => request.split(" ").slice(2).join(" "))).size).toBe(1);
    // Few areas in view (under 20): coloured by rank in England, one scale on both sides; the legend says so.
    expect(await page.evaluate(() => window.__closeKnitDiagnostics?.featureValue("uk:lsoa:E01000001"))).toBe(85);
    expect(await page.evaluate(() => window.__closeKnitDiagnostics?.featureValue("uk:lsoa:E01024000"))).toBe(88);
    await expect(page.getByTestId("legend-percentile").first()).toContainText("Lowest in England");
  });
}

test("a view inside London with few areas falls back on London's ranks", async ({ page }) => {
  await routeEngland(page, []);
  await page.goto("/?mode=real&release=official-2026-06&layer=price-per-square-metre&lat=51.45&lng=-0.3&zoom=13&diagnostics=1");
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.featureValue("uk:lsoa:E01000001") ?? null),
    { timeout: 30_000 }).toBe(20);
  await expect(page.getByTestId("legend-percentile").first()).toContainText("Lowest in London");
});
