import { expect, expectSteady, test, type Page } from "./fixtures";

// "North London preview" (drawn at MSOA level in the demo value pack) spans
// lng -0.123..-0.068 and lat 51.523..51.57; the default view centre
// (51.5074, -0.1278) lies outside it.
const AREA_BOX = { west: -0.123, south: 51.523, east: -0.068, north: 51.57 };

function camera(page: Page) {
  const parameters = new URL(page.url()).searchParams;
  return {
    lat: Number(parameters.get("lat")),
    lng: Number(parameters.get("lng")),
    zoom: Number(parameters.get("zoom")),
  };
}

// /area/msoa/<code> is a guide page now (e2e/area-pages.spec.ts), not the map.
for (const path of ["/?selected=uk%3Amsoa%3AE02000002&period=2026-06"]) {
  test(`a selected area without a map position opens fitted to that area (${path})`, async ({ page }, testInfo) => {
    await page.goto(path);
    await expect(page.getByTestId("selected-area")).toContainText("Highbury · N5");

    // The fit writes the real position; until then the URL carries none.
    await expect.poll(() => new URL(page.url()).searchParams.get("lat"), { timeout: 30_000 }).not.toBeNull();
    const fitted = camera(page);
    expect(fitted.zoom).toBeGreaterThan(11);
    // The URL holds the map centre. On phones the fit pads for the bottom
    // sheet, so the area sits in the upper part and the centre may fall
    // below it (e2e/two-block-layout.spec.ts checks the padding itself).
    const below = testInfo.project.name === "mobile" ? AREA_BOX.north - AREA_BOX.south : 0;
    // On a desktop the fit pads for the side panel on the right (PR #343: 460px by default), so the area sits
    // left of the middle and the centre may fall east of it.
    const east = testInfo.project.name === "desktop" ? AREA_BOX.east - AREA_BOX.west : 0;
    expect(fitted.lat).toBeGreaterThan(AREA_BOX.south - below);
    expect(fitted.lat).toBeLessThan(AREA_BOX.north);
    expect(fitted.lng).toBeGreaterThan(AREA_BOX.west);
    expect(fitted.lng).toBeLessThan(AREA_BOX.east + east);
    expect(new URL(page.url()).searchParams.get("selected")).toBe("uk:msoa:E02000002");
  });
}

test("an explicit map position wins over fitting the selected area", async ({ page }) => {
  await page.goto("/?lat=51.501&lng=-0.1416&zoom=13&selected=uk%3Amsoa%3AE02000002&diagnostics=1");
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 10_000 });
  // Area shapes are loaded once diagnostics count source features; any fit would start then.
  await expect.poll(
    () => page.evaluate(() =>
      (window as unknown as { __closeKnitDiagnostics?: { sourceAreaCount(): number } })
        .__closeKnitDiagnostics?.sourceAreaCount() ?? -1),
    { timeout: 30_000 },
  ).toBeGreaterThan(0);

  await expectSteady(() => expect(camera(page)).toEqual({ lat: 51.501, lng: -0.1416, zoom: 13 }), 1_500);
});
