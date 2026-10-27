import { existsSync } from "node:fs";

import { expect, test, type Page } from "./fixtures";
import { routeEngland } from "./england-view";
import { archivePath, CENTRE, REAL_AREA_TILES, routeRealTiles } from "./real-area-tiles";

// Neighbouring areas share their edges exactly at every zoom (api migration 119; docs/review-2026-10/review.md,
// "Почему полигоны не стыкуются"). Real area tiles around a point of the border of Redbridge (London) and Epping
// Forest (Essex) (deploy/tools/area_topology.py --export web/e2e/area-tiles), read from the static archives with Range
// requests as production serves them, drawn by the map's own fill as one flat
// half-transparent black without antialiasing on white: a pixel two areas paint comes out darker (an overlap), one
// no area paints stays white (a gap). Across the switch from MSOAs to LSOAs at zoom 9, the neighbourhood zoom 9.5
// and the top tile zoom (12) overzoomed.

const OPEN = `/?mode=real&release=official-2026-06&layer=price-per-square-metre&lat=${CENTRE[1]}&lng=${CENTRE[0]}&diagnostics=1`;
/** The square read around the centre, in CSS pixels: all land, inside the exported tiles at each zoom. */
const box = (zoom: number) => (zoom < 8 ? 24 : 64);

/**
 * Pixels in the box painted once, twice or more (overlap) and never (gap), at a zoom: the tiles the map loads there
 * (its fill's source: MSOAs below 7, LSOAs from it) drawn by a flat layer of our own, everything else hidden.
 */
async function coverage(page: Page, zoom: number) {
  await page.evaluate(([lon, lat, z]) => window.__closeKnitMap!.jumpTo({ center: [lon, lat], zoom: z }), [...CENTRE, zoom]);
  const kind = zoom < 9 ? "msoa" : "lsoa";
  await expect.poll(() => page.evaluate((source) => {
    const map = window.__closeKnitMap!;
    return window.__closeKnitDiagnostics.fillSource() === source && map.isSourceLoaded(source) && map.areTilesLoaded();
  }, `area-tiles-${kind}`), { timeout: 20_000 }).toBe(true);
  await page.evaluate((carrier) => {
    const map = window.__closeKnitMap!;
    if (map.getLayer("topology-fill")) map.removeLayer("topology-fill");
    for (const layer of map.getStyle().layers) map.setLayoutProperty(layer.id, "visibility", "none");
    if (!map.getLayer("topology-paper")) {
      map.addLayer({ id: "topology-paper", type: "background", paint: { "background-color": "#ffffff" } });
    }
    map.setLayoutProperty("topology-paper", "visibility", "visible");
    map.addLayer({ id: "topology-fill", type: "fill", source: `area-tiles-${carrier}`, "source-layer": carrier,
      paint: { "fill-color": "#000000", "fill-opacity": 0.5, "fill-antialias": false } });
  }, kind);
  await expect.poll(() => page.evaluate(() => window.__closeKnitMap!.loaded() && window.__closeKnitMap!.areTilesLoaded()))
    .toBe(true);
  return page.evaluate(([lon, lat, box]) => new Promise<{ once: number; overlap: number; gap: number }>((resolve) => {
    const map = window.__closeKnitMap!;
    {
      map.once("render", () => {
        const canvas = map.getCanvas();
        const ratio = canvas.width / canvas.clientWidth;
        const centre = map.project([lon, lat]);
        const side = Math.round(box * ratio);
        const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext;
        const pixels = new Uint8Array(side * side * 4);
        gl.readPixels(Math.round((centre.x - box / 2) * ratio), canvas.height - Math.round((centre.y + box / 2) * ratio),
          side, side, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const counts = { once: 0, overlap: 0, gap: 0 };
        for (let index = 0; index < pixels.length; index += 4) {
          const value = pixels[index + 1];
          if (value > 191) counts.gap += 1;
          else if (value < 96) counts.overlap += 1;
          else counts.once += 1;
        }
        resolve(counts);
      });
      map.triggerRepaint();
    }
  }), [...CENTRE, box(zoom)] as const);
}

test("neighbouring areas neither overlap nor leave gaps across zooms 9 and 9.5 and overzoomed", async ({ page }) => {
  test.skip(!existsSync(archivePath("lsoa")), "no exported area tiles");
  test.setTimeout(120_000);
  await routeEngland(page, { areaTiles: REAL_AREA_TILES });
  const ranges = await routeRealTiles(page);
  await page.goto(`${OPEN}&zoom=6.9`);
  await page.waitForFunction(() => !!window.__closeKnitMap, null, { timeout: 20_000 });
  for (const zoom of [6.9, 8.9, 9.1, 9.4, 9.6, 12.5, 16]) {
    const counts = await coverage(page, zoom);
    expect.soft(counts, `zoom ${zoom}`).toEqual({ once: counts.once + counts.overlap + counts.gap, overlap: 0, gap: 0 });
    expect(counts.once).toBeGreaterThan(0);
  }
  // Both kinds came from their archives: the header and root directory first, then tile by tile.
  for (const kind of ["msoa", "lsoa"]) expect(ranges.filter((range) => range.includes(`-${kind}.pmtiles`)).length).toBeGreaterThan(1);
});
