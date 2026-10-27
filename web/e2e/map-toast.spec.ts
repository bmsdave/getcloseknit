import { expect, test, type Page } from "./fixtures";

import { openLayersPanel } from "./evidence";

// v4 Task 10: one map toast for every short map notice, above the controls, the legend and the
// sheets; ✕ and auto-hide; "How to allow" for a blocked location. And the map's error states from
// G5 Task 25: colours that did not load say so, with Try again.

/** The browser's answer to "my location": blocked (code 1), unavailable (code 2) or a fix. */
async function stubLocation(page: Page, answer: { code: 1 | 2 } | { latitude: number; longitude: number; accuracy: number }, wait = 150) {
  await page.addInitScript(({ given, wait }) => {
    const geolocation = {
      getCurrentPosition(success: PositionCallback, failure?: PositionErrorCallback) {
        window.setTimeout(() => {
          if ("code" in given) failure?.({ code: given.code, message: "stub", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
          else success({ coords: { ...given, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
        }, wait);
      },
      watchPosition: () => 0,
      clearWatch: () => undefined,
    };
    Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
  }, { given: answer, wait });
}

async function mapReady(page: Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
}

test("a blocked location: the toast sits above the legend and every control, with How to allow", async ({ page }, testInfo) => {
  await stubLocation(page, { code: 1 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await mapReady(page);
  await page.getByTestId("locate-me").click();
  const toast = page.getByTestId("map-toast");
  await expect(toast).toHaveAttribute("data-kind", "location-blocked");
  await expect(page.getByTestId("map-toast-text")).toHaveText("Location is blocked for this site.");
  await expect(page.getByTestId("map-toast-region")).toHaveAttribute("role", "status");
  await expect(page.getByTestId("locate-me")).toHaveAttribute("data-state", "idle");
  // Never under anything: the toast is what is on top at its own centre, and it clears the legend.
  const box = (await toast.boundingBox())!;
  const top = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("[data-testid='map-toast']"),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(top).toBe(true);
  const legend = (await page.getByTestId("legend-chip").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(legend.y);
  if (testInfo.project.name === "mobile") {
    // Phones: just under the search pill, full width minus the gutters.
    const viewport = page.viewportSize()!;
    expect(box.x).toBeLessThanOrEqual(12);
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 24);
    const pill = (await page.locator(".explorer-pill").boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(pill.y + pill.height);
    expect(box.y - (pill.y + pill.height)).toBeLessThanOrEqual(24);
  } else {
    // Desktops: top-centre of the map the panel leaves visible, at most 520px.
    expect(box.width).toBeLessThanOrEqual(520);
    const dock = (await page.getByTestId("map-dock").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(dock.x);
  }
  // How to allow: the steps in a sheet, Try again asks once more.
  await page.getByTestId("map-toast-link").click();
  await expect(toast).toBeHidden();
  const steps = page.getByTestId("location-help");
  await expect(steps.getByRole("heading", { name: "Allow your location" })).toBeVisible();
  await expect(steps).toContainText("Website Settings › Location › Allow");
  await steps.getByTestId("location-retry").click();
  await expect(steps).toBeHidden();
  await expect(page.getByTestId("map-toast")).toHaveAttribute("data-kind", "location-blocked");
  // ✕ dismisses it.
  await page.getByTestId("map-toast-close").click();
  await expect(page.getByTestId("map-toast")).toHaveCount(0);
});

test("unavailable: a plain toast that hides on its own after 6 s", async ({ page }) => {
  await stubLocation(page, { code: 2 });
  await page.goto("/");
  await mapReady(page);
  await page.getByTestId("locate-me").click();
  await expect(page.getByTestId("map-toast-text")).toHaveText("Location isn't available here.");
  await expect(page.getByTestId("map-toast-link")).toHaveCount(0);
  await expect(page.getByTestId("map-toast")).toHaveCount(0, { timeout: 8_000 });
});

test("found: a spinner while waiting, then the blue dot and a filled button, and no toast", async ({ page }) => {
  await stubLocation(page, { latitude: 51.5, longitude: -0.12, accuracy: 60 }, 1500);
  await page.goto("/");
  await mapReady(page);
  const locate = page.getByTestId("locate-me");
  await locate.click();
  await expect(locate).toHaveAttribute("data-state", "locating");
  await expect(locate).toHaveAttribute("data-state", "found");
  await expect(page.getByTestId("map-toast")).toHaveCount(0);
});

test("one toast at a time: the newest replaces the old", async ({ page }) => {
  await stubLocation(page, { code: 2 });
  await page.goto("/");
  await mapReady(page);
  const panel = await openLayersPanel(page);
  await panel.getByTestId("topic-group-safety").click();
  await panel.getByTestId("layer-crime").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  await panel.getByTestId("layers-default").click();
  await expect(page.getByTestId("map-toast")).toHaveAttribute("data-kind", "reset");
  await page.getByTestId("layers-close").click();
  await page.getByTestId("locate-me").click();
  await expect(page.getByTestId("map-toast")).toHaveCount(1);
  await expect(page.getByTestId("map-toast")).toHaveAttribute("data-kind", "location-unavailable");
});

test("map colours that did not load (a 503) say so; Try again paints them", async ({ page }) => {
  let fail = true;
  await page.route("**/api/v1/value-packs/crime/**", (route) => (fail ? route.fulfill({ status: 503, body: "busy" }) : route.fallback()));
  await page.goto("/?layer=crime");
  const toast = page.getByTestId("map-toast");
  await expect(toast).toHaveAttribute("data-kind", "colours-failed", { timeout: 15_000 });
  await expect(page.getByTestId("map-toast-text")).toHaveText("Map colours didn't load.");
  fail = false;
  await page.getByTestId("map-toast-action").click();
  await expect(toast).toHaveCount(0);
  await expect(page.locator(".map-status")).toHaveText("Map ready");
});
