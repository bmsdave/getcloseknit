import { expect, test, type Page } from "./fixtures";
import { LONDON, routeEngland } from "./england-view";
import { CENTRE, REAL_AREA_TILES, realTileIds, routeRealTiles } from "./real-area-tiles";

// The map hands from MSOAs to LSOAs at zoom 9 and from the regions' pieces to the LADs' at 9.5 (lib/map-coverage.ts)
// without a frame where the area fill is gone: each kind of area keeps its layers on the map (lib/area-tiles.ts
// areaLevelZooms), the kind drawn keeps drawing until the next one's colours land on its loaded tiles. Real tiles
// around the Redbridge/Epping Forest border (real-area-tiles.ts), every area valued.

const OPEN = `/?mode=real&release=official-2026-06&layer=price-per-square-metre&lat=${CENTRE[1]}&lng=${CENTRE[0]}&diagnostics=1`;
let IDS: Record<"lsoa" | "msoa", string[]>;
test.beforeAll(async () => { IDS = { lsoa: await realTileIds("lsoa"), msoa: await realTileIds("msoa") }; });

/** Value packs and boxes for the exported tiles' areas (one request carries them all, as the London piece). */
async function routeRealAreas(page: Page) {
  await page.route("**/api/v1/value-packs/**", (route) => {
    const url = new URL(route.request().url());
    const [metricId, period] = url.pathname.split("/").slice(-2);
    const level = url.searchParams.get("level") === "msoa" ? "msoa" : "lsoa";
    const ids = (url.searchParams.get("chunk") ?? "").split(",").includes(LONDON) ? IDS[level] : [];
    const values = ids.map((geographyId, index) => ({
      geographyId, name: "", metricId, period, value: 2_000 + (index * 37) % 9_000, regionPercentile: index % 101,
      countryPercentile: index % 101, sampleCount: 10, quality: "observed", sourceVersion: "", carrier: level,
    }));
    return route.fulfill({ json: { schemaVersion: "area-value-pack.v1", metricId, period, sourceVersion: "", values } });
  });
  await page.route("**/api/v1/areas/boxes**", (route) => {
    const url = new URL(route.request().url());
    const carrier = url.searchParams.get("carrier") === "msoa" ? "msoa" : "lsoa";
    const ids = url.searchParams.get("chunk") === LONDON ? IDS[carrier] : [];
    const [lon, lat] = CENTRE;
    return route.fulfill({ json: { schemaVersion: "area-boxes.v1", carrier,
      areas: ids.map((id) => [id, lon - 0.2, lat - 0.1, lon + 0.2, lat + 0.1]) } });
  });
}

interface Frame { zoom: number; kind: string | null }

/** Records, at every frame the map draws, the kind of area whose coloured fill is under the centre (null: none). */
async function recordFrames(page: Page) {
  await page.evaluate(([lon, lat]) => {
    const map = window.__closeKnitMap!;
    const frames: Frame[] = [];
    (window as unknown as { __frames: Frame[] }).__frames = frames;
    const layers = ["area-fill-lsoa", "area-fill-msoa", "area-fill-borough"];
    map.on("render", () => {
      const shown = layers.filter((id) => map.getLayer(id));
      const hit = shown.length ? map.queryRenderedFeatures(map.project([lon, lat]), { layers: shown })
        .find((feature) => feature.state?.qa != null || feature.state?.qb != null) : undefined;
      frames.push({ zoom: Math.round(map.getZoom() * 100) / 100, kind: hit?.sourceLayer ?? null });
    });
  }, CENTRE);
}

/** The frames so far; asks for one more, so a map gone idle before the recording started still reports. */
const frames = (page: Page) => page.evaluate(() => {
  window.__closeKnitMap!.triggerRepaint();
  return (window as unknown as { __frames: Frame[] }).__frames;
});

/** Eases to a zoom, then waits until the kind expected is coloured there and the map has settled. */
async function zoomTo(page: Page, zoom: number, kind: "lsoa" | "msoa") {
  await page.evaluate((z) => window.__closeKnitMap!.easeTo({ zoom: z, duration: 800 }), zoom);
  await expect.poll(async () => (await frames(page)).at(-1), { timeout: 20_000 }).toEqual({ zoom, kind });
  await page.evaluate(() => new Promise<void>((resolve) => {
    const map = window.__closeKnitMap!;
    map.once("idle", () => resolve());
    map.triggerRepaint();
  }));
}

test("crossing zooms 9 and 9.5 both ways, the area fill never leaves a frame blank", async ({ page }) => {
  test.setTimeout(120_000);
  await routeEngland(page, { areaTiles: REAL_AREA_TILES });
  await routeRealTiles(page);
  await routeRealAreas(page);
  await page.goto(`${OPEN}&zoom=8.6`);
  await page.waitForFunction(() => !!window.__closeKnitMap, null, { timeout: 20_000 });
  await recordFrames(page);
  await expect.poll(async () => (await frames(page)).at(-1)?.kind, { timeout: 20_000 }).toBe("msoa");
  let start = (await frames(page)).length;
  await zoomTo(page, 9.2, "lsoa");
  await zoomTo(page, 8.6, "msoa");
  const nine = (await frames(page)).slice(start);
  await page.evaluate(() => window.__closeKnitMap!.jumpTo({ zoom: 9.3 }));
  await expect.poll(async () => (await frames(page)).at(-1), { timeout: 20_000 }).toEqual({ zoom: 9.3, kind: "lsoa" });
  start = (await frames(page)).length;
  await zoomTo(page, 9.7, "lsoa");
  await zoomTo(page, 9.3, "lsoa");
  const neighbourhood = (await frames(page)).slice(start);
  for (const recorded of [nine, neighbourhood]) {
    expect(recorded.length).toBeGreaterThan(5);
    expect(recorded.filter((frame) => frame.kind === null)).toEqual([]);
  }
});
