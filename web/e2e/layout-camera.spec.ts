import { expect, expectSteady, test, type Page } from "./fixtures";

/**
 * A layout change only changes the layout (owner report, 2026-10-20): the camera (centre, zoom, bearing,
 * pitch) stays where it was when the window goes from the desktop layout to a narrow desktop, a phone,
 * a phone on its side (the short layout, lib/viewport.ts) and back, with an area selected. Covers the
 * three ways a selection frames the map: a link's fit on load (zoomTo), a wider area's own outline fit
 * (a borough) and a plain map click (no fit).
 */

type Camera = { zoom: number; lng: number; lat: number; bearing: number; pitch: number };

const LAYOUTS = [
  { name: "narrow desktop", width: 900, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "short landscape", width: 844, height: 390 },
  { name: "desktop", width: 1440, height: 900 },
];

async function camera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__closeKnitCamera!());
}

async function mapReady(page: Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__closeKnitCamera)).toBe("function");
}

/** The camera once it has stopped moving (a fit on load animates): the same in two reads half a second apart. */
async function settledCamera(page: Page): Promise<Camera> {
  let last: Camera | null = null;
  await expect.poll(async () => {
    const next = await camera(page);
    const still = !!last && Math.abs(next.zoom - last.zoom) < 1e-9 && Math.abs(next.lng - last.lng) < 1e-9 && Math.abs(next.lat - last.lat) < 1e-9;
    last = next;
    return still;
  }, { message: "the camera never settled", intervals: [500], timeout: 10_000 }).toBe(true);
  return last!;
}

function expectSame(after: Camera, before: Camera, layout: string) {
  expect(after.zoom, `${layout}: zoom`).toBeCloseTo(before.zoom, 6);
  expect(after.lng, `${layout}: longitude`).toBeCloseTo(before.lng, 6);
  expect(after.lat, `${layout}: latitude`).toBeCloseTo(before.lat, 6);
  expect(after.bearing, `${layout}: bearing`).toBeCloseTo(before.bearing, 6);
  expect(after.pitch, `${layout}: pitch`).toBeCloseTo(before.pitch, 6);
}

/** Every layout in turn, then back to the desktop; the camera must not move at any step. */
async function switchLayouts(page: Page) {
  const before = await settledCamera(page);
  for (const layout of LAYOUTS) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await expectSteady(async () => expectSame(await camera(page), before, layout.name), 1500);
  }
}

test.describe("Layout switch keeps the map camera still", () => {
  // The spec sizes the window itself; the phone profile's touch emulation adds nothing here.
  test.skip(({ isMobile }) => !!isMobile, "desktop browser only");
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const selected of ["uk:lsoa:E01000001", "uk:lad:E09000001"]) {
    test(`${selected} from a link: resizing through every layout and back never moves the camera`, async ({ page }) => {
      await page.goto(`/?diagnostics=1&selected=${encodeURIComponent(selected)}`);
      await mapReady(page);
      await switchLayouts(page);
    });
  }

  test("an area chosen on the map: resizing through every layout and back never moves the camera", async ({ page }) => {
    await page.goto("/?diagnostics=1&lat=51.5&lng=-0.12&zoom=14");
    await mapReady(page);
    const frame = (await page.locator(".maplibregl-canvas").first().boundingBox())!;
    await page.mouse.click(frame.x + frame.width * 0.35, frame.y + frame.height * 0.5);
    await expect(page.getByTestId("map-dock")).not.toHaveAttribute("data-area", "empty");
    await switchLayouts(page);
  });
});
