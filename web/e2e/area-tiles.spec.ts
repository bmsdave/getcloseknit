import { expect, test } from "./fixtures";

import { LONDON_AREAS, paintedValues, routeEngland, SOUTH_EAST_AREAS } from "./england-view";

// The areas drawn from vector tiles (lib/area-tiles.ts, api map_tiles.py), the only way their shapes reach the map:
// the coverage names the tiles, the map fetches each piece's boxes (lib/area-boxes.ts) and colours the tiles'
// features by feature-state, with the view's own scale and the selection. The tiles are the england-view grid,
// encoded in the browser.

const OPEN = "/?mode=real&release=official-2026-06&layer=price-per-square-metre&lat=51.5&lng=-0.12&diagnostics=1";

async function fillState(page: import("./fixtures").Page, id: string) {
  return page.evaluate((area) => (window as unknown as { __closeKnitFillState?: (id: string) => Record<string, unknown> })
    .__closeKnitFillState?.(area) ?? null, id);
}

test("the tiles draw the areas: boxes, never shapes, and colours as feature-state on the tile features", async ({ page }) => {
  const seen = await routeEngland(page);
  const shapes: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/v1/areas/geometry")) shapes.push(request.url()); });
  // Below NEIGHBOURHOOD_ZOOM: the page names no London boxes in its head (lib/map-preload.ts), only the map asks.
  await page.goto(`${OPEN}&zoom=9.4`);
  const inside = LONDON_AREAS.filter((area) => area.box[0] >= -0.3 && area.box[2] <= 0);
  const values = await paintedValues(page, inside.map((area) => area.id));
  // The view's own scale (in-view-scale.spec.ts).
  expect(new Set(values.map((value) => Math.min(7, Math.floor(value / 12.5)))).size).toBeGreaterThanOrEqual(5);
  await expect.poll(() => seen.tiles.some((path) => path.includes("/lsoa/"))).toBe(true);
  expect(seen.boxes.length).toBeGreaterThan(0);
  // No shapes are asked for anywhere: the tiles are their only way in.
  expect(shapes).toEqual([]);
  // The tile features carry the area ids the rest of the map reads, and each painted one holds its colour's state.
  await expect.poll(async () => page.evaluate(() => window.__closeKnitDiagnostics?.renderedFeatureIds() ?? []))
    .toEqual(expect.arrayContaining([inside[0].id]));
  const state = await fillState(page, inside[0].id);
  expect(state?.qa ?? state?.qb).toBe("observed");
  // Each kind's own fill, drawn without the antialiased edge pass that darkened every shared edge.
  expect(await page.evaluate(() => window.__closeKnitDiagnostics.paintProperty("area-fill-lsoa", "fill-antialias"))).toBe(false);
});

test("across London's boundary at z9.2 on tiles: one scale both sides", async ({ page }) => {
  await routeEngland(page);
  await page.goto(`${OPEN}&zoom=9.2`);
  const areas = [...LONDON_AREAS, ...SOUTH_EAST_AREAS];
  const values = await paintedValues(page, areas.map((area) => area.id));
  expect(values[LONDON_AREAS.length]).toBe(values[0]);
  expect(Math.min(...values)).toBe(0);
  expect(Math.max(...values)).toBe(100);
});

test("a tap on a tile feature selects its area, outlined from the same tiles", async ({ page }) => {
  const seen = await routeEngland(page);
  await page.goto(`${OPEN}&zoom=10`);
  // The area under the view's centre: clear of the intro card and the sheet on a phone.
  const target = LONDON_AREAS[21];
  await paintedValues(page, [target.id]);
  await expect.poll(async () => page.evaluate(() => window.__closeKnitDiagnostics?.renderedFeatureIds() ?? []))
    .toEqual(expect.arrayContaining([target.id]));
  const point = await page.evaluate(([lon, lat]) => {
    const map = window.__closeKnitMap!;
    const projected = map.project([lon, lat]);
    const box = map.getCanvas().getBoundingClientRect();
    return { x: box.left + projected.x, y: box.top + projected.y };
  }, [(target.box[0] + target.box[2]) / 2, (target.box[1] + target.box[3]) / 2]);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await fillState(page, target.id))?.selected).toBe(true);
  // Its west edge, drawn from the fill's own tiles (no shape of its own is fetched): white over a dark halo, where
  // without an outline the light basemap shows in the gap between squares.
  const pixel = (dx: number) => page.evaluate(([lon, lat, offset]) => new Promise<number[]>((resolve) => {
    const map = window.__closeKnitMap!;
    map.once("render", () => {
      const canvas = map.getCanvas();
      const ratio = canvas.width / canvas.clientWidth;
      const point = map.project([lon, lat]);
      const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext;
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.round((point.x + offset) * ratio), canvas.height - Math.round(point.y * ratio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      resolve([...pixel.slice(0, 3)]);
    });
    map.triggerRepaint();
  }), [target.box[0], (target.box[1] + target.box[3]) / 2, dx] as const);
  await expect.poll(async () => Math.min(...await pixel(0))).toBeGreaterThan(230);
  expect(Math.max(...await pixel(-3))).toBeLessThan(110);
  expect(seen.boxes.filter((url) => new URL(url).searchParams.has("id"))).toEqual([]);
});
