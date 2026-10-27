import { expect, test, type Page } from "./fixtures";

import { DEMO_RELEASE } from "../src/lib/map-state";
import { chooseView, openLayerExplainer, openLayersPanel, showFullAreaView } from "./evidence";
import { showTimeline } from "./top-bar";

// v3 round 2, map leftovers (docs/design/v3-spec.md Fix 22.8, Fixes 4–5) and fresh data after a deploy.
// The desktop project checks 1440 px, the phone project 390 px; each in Day and Night.

const AREA = "/?layer=price-per-square-metre&selected=uk%3Alsoa%3AE01000001&period=2026-06";
const SCHEMES = ["light", "dark"] as const;

async function atWidth(page: Page, phone: boolean) {
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
}

/** No sideways scroll: the page is never wider than the window. */
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function insideWindow(page: Page, testId: string) {
  const box = (await page.getByTestId(testId).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test("Fix 22.8: help is the legend ? alone; the panel has no About this data fold and Report stays at the figure", async ({ page }, testInfo) => {
  await atWidth(page, testInfo.project.name === "mobile");
  const backgrounds: string[] = [];
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(AREA);
    const panel = page.getByTestId("evidence-panel");
    await expect(panel.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
    await expect(panel.getByTestId("home-cost")).toHaveCount(0);
    // No fold, no "this data" (?) and no method lines in the panel.
    await expect(page.getByTestId("about-this-data")).toHaveCount(0);
    await expect(panel.locator("summary", { hasText: "About this data" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "About this data" })).toHaveCount(0);
    for (const id of ["metric-description", "metric-freshness", "england-comparison", "home-cost-method"]) {
      await expect(panel.getByTestId(id), id).toHaveCount(0);
    }
    // "Report a wrong figure" stays at the end of the area view (a phone's sheet at full), without opening anything.
    await showFullAreaView(page);
    const report = panel.getByTestId("correction-report-open");
    await report.scrollIntoViewIfNeeded();
    await expect(report).toBeVisible();
    // Back to half, so the map's buttons show above the sheet again.
    if ((await page.getByTestId("map-dock").getAttribute("data-snap")) === "full") {
      await page.getByTestId("sheet-handle").focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "half");
    }

    // The Layers menu has no (?) of its own, on Rank or Change either.
    await chooseView(page, "price-per-square-metre", "rank");
    const menu = await openLayersPanel(page);
    await expect(menu.locator(".help-tip")).toHaveCount(0);
    await chooseView(page, "price-per-square-metre", "change");
    await expect(menu.getByTestId("change-window")).toBeVisible();
    await expect(menu.locator(".help-tip")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // What the menu's (?) said is in the legend's explainer: how to read the change scale.
    const explainer = await openLayerExplainer(page);
    await expect(explainer.getByTestId("layer-explainer-line")).toHaveText("What homes here sold for, per square metre of floor.");
    await expect(explainer.getByTestId("layer-explainer-points")).toContainText("HM Land Registry Price Paid");
    await expect(explainer.getByTestId("layer-explainer-points")).toContainText("Price change over 5 years");
    // Said once: the colours in the note under the scale, the years and arrows in the point.
    await expect(explainer.getByText(/orange/)).toHaveCount(1);
    const guide = explainer.getByTestId("layer-explainer-guide");
    await expect(guide).toHaveAttribute("href", "/guide/price-per-m2");
    // A phone's sheet scrolls: the guide link is reachable inside it.
    await guide.scrollIntoViewIfNeeded();
    await expect(guide).toBeInViewport();
    await insideWindow(page, "layer-explainer");
    await noSideScroll(page);
    backgrounds.push(await explainer.evaluate((node) => getComputedStyle(node).backgroundColor));
    await page.keyboard.press("Escape");
    await expect(explainer).toBeHidden();
  }
  // Day and Night each paint the explainer in their own surface.
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
});

test("Fixes 4–5: Price per m² steps a month at a time over 2006–2026; the label follows the month", async ({ page }, testInfo) => {
  await atWidth(page, testInfo.project.name === "mobile");
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/?period=2006-06");
    const explorer = page.getByTestId("close-knit");
    await showTimeline(page);
    const timeline = page.getByTestId("price-timeline");
    const slider = page.getByLabel("Price period");
    // 241 months, Jun 2006 … Jun 2026; the ends read as years.
    await expect(slider).toHaveAttribute("max", "240");
    await expect(timeline.locator(".timeline-ends")).toHaveText("20062026");
    await expect(timeline.locator(".timeline-period")).toHaveText("Jun 2006");
    await slider.press("ArrowRight");
    await expect(explorer).toHaveAttribute("data-active-period", "2006-07");
    await expect(timeline.locator(".timeline-period")).toHaveText("Jul 2006");
    await slider.press("End");
    await expect(explorer).toHaveAttribute("data-active-period", "2026-06");
    await slider.press("ArrowLeft");
    await expect(explorer).toHaveAttribute("data-active-period", "2026-05");
    await expect(timeline.locator(".timeline-period")).toHaveText("May 2026");
    await expect(page).toHaveURL(/period=2026-05/);
    await insideWindow(page, "price-timeline");
    await noSideScroll(page);
  }
});

test("fresh data after a deploy: school points and overlay tiles carry the release in their URL", async ({ page }) => {
  const release = `release=${DEMO_RELEASE}`;
  const points = page.waitForRequest((request) => request.url().includes("/api/v1/schools/points"));
  const tile = page.waitForRequest((request) => request.url().includes("/api/v1/tiles/properties/"));
  await page.goto("/?lat=51.5010&lng=-0.1416&zoom=16&schools=on&stations=off");
  // ?release=<id>: a new release is a new URL, so the hour-long cache never serves the old release's points.
  expect(new URL((await points).url()).searchParams.get("release")).toBe(DEMO_RELEASE);
  expect((await tile).url()).toContain(`.pbf?${release}`);
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
});
