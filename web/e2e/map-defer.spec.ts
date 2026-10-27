import { expect, test, type Page } from "./fixtures";

// Proposal #28: the page paints before MapLibre arrives (a poster holds the map's place), text
// pages never download it, and the first-visit card is server-rendered so it is the first paint.

const MAPLIBRE_JS = "fill-extrusion-vertical-gradient";
const MAPLIBRE_CSS = "maplibregl-ctrl-scale";

/** JS and CSS this page downloaded that carry MapLibre (its library or its stylesheet). */
function watchMaplibre(page: Page) {
  const hits: string[] = [];
  page.on("response", async (response) => {
    const url = response.url();
    const css = /\.css(\?|$)/.test(url);
    if (!css && !/\.js(\?|$)/.test(url)) return;
    const body = await response.text().catch(() => "");
    if (body.includes(css ? MAPLIBRE_CSS : MAPLIBRE_JS)) hits.push(url);
  });
  return hits;
}

test("the poster comes first and the map takes its place", async ({ browser, page, request }) => {
  const hits = watchMaplibre(page);
  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByTestId("map-poster")).toHaveCount(0);
  await expect.poll(() => hits.length).toBeGreaterThanOrEqual(2);

  const html = await (await request.get("/")).text();
  expect(html).toContain('data-testid="map-poster"');
  expect(html).not.toContain('data-testid="map-canvas"');
  // The first view's value line is in the server's HTML, not waiting on scripts.
  expect(html).toContain('data-testid="intro-value"');

  // Before any script runs: the poster, hidden from assistive technology, in the map's own box.
  const still = await browser.newContext({ javaScriptEnabled: false });
  const before = await still.newPage();
  await before.goto("/");
  const poster = before.getByTestId("map-poster");
  await expect(poster).toHaveAttribute("aria-hidden", "true");
  expect(await poster.boundingBox()).toEqual(await page.getByTestId("map-canvas").boundingBox());
  await still.close();
});

for (const route of ["/guide/reading-the-map", "/guide/glossary", "/rankings", "/tools", "/about"]) {
  test(`${route} loads no MapLibre script or stylesheet`, async ({ page }) => {
    const hits = watchMaplibre(page);
    await page.goto(route, { waitUntil: "networkidle" });
    expect(hits).toEqual([]);
  });
}

test("a visitor who closed the card never sees it flash on load", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("close-knit.intro-dismissed.v1", "1");
    (window as unknown as { seen: boolean }).seen = false;
    const look = () => {
      if (document.querySelector("[data-testid='intro-card']")?.getClientRects().length) (window as unknown as { seen: boolean }).seen = true;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { seen: boolean }).seen)).toBe(false);
  await expect(page.locator("html")).not.toHaveAttribute("data-intro-boot", /.*/);
});

test("the footer says Demo data in full for screen readers and on hover, never cut off", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const status = page.getByTestId("data-status");
  await expect(status).toHaveText("Demo data · not for decisions");
  await expect(status.locator("[title]")).toHaveAttribute("title", "Demo data · not for decisions");
  await expect(status.locator(".sr-only")).toHaveText("· not for decisions");
  expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
