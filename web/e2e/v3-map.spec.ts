import { expect, expectSteady, test, type Page } from "./fixtures";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { chooseLayer, openLayersPanel, topicItem } from "./evidence";
import { openShowPanel } from "./top-bar";

// v3 round 1, map and layers (docs/design/v3-spec.md Fixes 1, 2 + 24, 3, 4–5, 6–7, 8, 10, 11, 12 + 21).

function camera(page: Page) {
  const parameters = new URL(page.url()).searchParams;
  return { lat: Number(parameters.get("lat")), lng: Number(parameters.get("lng")), zoom: Number(parameters.get("zoom")) };
}

/** The link's camera once it has stayed the same for 600 ms (a fit may follow the first move). */
async function settledCamera(page: Page) {
  let last = "";
  await expect.poll(() => {
    const next = JSON.stringify(camera(page));
    const still = next === last;
    last = next;
    return still;
  }, { message: "the camera never settled", intervals: [600], timeout: 10_000 }).toBe(true);
  return camera(page);
}

async function mapReady(page: Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
}

test("Fix 11: the bar is a compact pill top-left, ≡ inside it; the map shows across the rest of the top", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the desktop bar");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await mapReady(page);
  const pill = (await page.getByTestId("top-bar-pill").boundingBox())!;
  expect(pill.x).toBeLessThanOrEqual(16);
  expect(pill.width).toBeLessThan(560);
  const [menu, brand, search] = await Promise.all([page.getByTestId("top-menu-toggle"), page.locator(".explorer-pill .brand"),
    page.locator(".explorer-pill .search-wrap")].map((el) => el.boundingBox()));
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(brand!.x);
  expect(brand!.x + brand!.width).toBeLessThanOrEqual(search!.x);
  // Between the pill and the right edge the top of the map takes the pointer.
  expect(await page.evaluate(() => document.elementFromPoint(900, 40)?.classList.contains("maplibregl-canvas"))).toBe(true);
  // The ≡ menu opens under the pill, from its left.
  await page.getByTestId("top-menu-toggle").click();
  const panel = (await page.getByTestId("top-menu").boundingBox())!;
  expect(Math.abs(panel.x - pill.x)).toBeLessThanOrEqual(12);
});

test("Fix 1: an area chosen brings the panel in; the round buttons and ⓘ sit 12px from its left edge", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the desktop panel");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByTestId("map-hint")).toHaveCount(0);
  const dock = (await page.getByTestId("map-dock").boundingBox())!;
  for (const id of ["layers-toggle", "zoom-in", "map-attribution-toggle"]) {
    await expect.poll(async () => {
      const box = (await page.getByTestId(id).boundingBox())!;
      return Math.round(dock.x - (box.x + box.width));
    }, id).toBe(12);
  }
  // The panel has no Sources & privacy or Terms of its own (v3 Fix 22); its "Sources" goes to the area's own.
  await expect(page.getByTestId("map-dock").getByRole("link", { name: /^(Sources & privacy|Terms)$/ })).toHaveCount(0);
  await expect(page.getByTestId("map-dock").getByRole("link", { name: "Sources", exact: true })).toHaveAttribute("href", "#sheet-area-sources");
});

test("Fix 3: None is a plain map: no colours, no legend, kept in the address; a layer colours it again", async ({ page }) => {
  await page.goto("/?diagnostics=1");
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => typeof window.__closeKnitDiagnostics?.paintProperty)).toBe("function");
  const panel = await openLayersPanel(page);
  const none = panel.getByTestId("layer-none");
  await none.click();
  await expect(none).toHaveAttribute("aria-pressed", "true");
  // Nothing else is chosen: no item is current, no view pressed.
  await expect(panel.locator(".topic-item[aria-current='true'], [data-testid^='view-'][aria-pressed='true']")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("colours")).toBe("none");
  await expect(page.getByTestId("legend-chip")).toHaveCount(0);
  await expect(page.getByTestId("layers-toggle")).toHaveAttribute("title", "Layers · None");
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics.paintProperty("area-fill-lsoa", "fill-opacity"))).toBe(0);
  await page.keyboard.press("Escape");

  // A reload keeps it.
  await page.reload();
  await mapReady(page);
  await expect(page.getByTestId("legend-chip")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.paintProperty("area-fill-lsoa", "fill-opacity") ?? null)).toBe(0);

  await chooseLayer(page, "crime");
  await expect.poll(() => new URL(page.url()).searchParams.get("colours")).toBeNull();
  await expect(page.getByTestId("legend-chip")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics.paintProperty("area-fill-lsoa", "fill-opacity"))).not.toBe(0);
});

test("Fixes 6–7: the item shown without views is one pill; with views, the light block holds them; many views fold", async ({ page }) => {
  await page.goto("/?layer=station-access");
  const panel = await openLayersPanel(page);
  await expect(panel.getByTestId("topic-group-getting-around")).toHaveAttribute("aria-expanded", "true");
  const station = panel.getByTestId("layer-station-access");
  await expect(station).toHaveAttribute("aria-current", "true");
  const pill = panel.locator("li.topic-pill");
  await expect(pill).toHaveCount(1);
  await expect(pill).toContainText("Station walk");
  // One pill: no empty strip under it.
  await expect(pill.getByTestId("topic-details")).toHaveCount(0);
  expect((await pill.boundingBox())!.height).toBeLessThanOrEqual(48);
  await expect(panel.locator("li.topic-block[data-current]")).toHaveCount(0);

  // Price per m² has views: a block, lit only while it is the one shown.
  await panel.getByTestId("topic-group-cost").click();
  await expect(panel.locator("li.topic-block[data-current]")).toHaveCount(0);
  // PR #318 (Layers v5): Borough HPI's 5/10 yrs subviews make Cost a longer group, so views open once the item is chosen.
  await panel.getByTestId("layer-price-per-square-metre").click();
  await panel.getByTestId("view-price-per-square-metre-rank").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "price-per-square-metre");
  await expect(panel.locator("li.topic-block[data-current]")).toHaveCount(1);
  await expect(panel.locator("li.topic-pill")).toHaveCount(0);
  // A closed group names the item it holds.
  await panel.getByTestId("topic-group-nature").click();
  await expect(panel.getByTestId("topic-group-held-cost")).toHaveText("Price per m²");

  // Green & trees and Wildlife seen; twelve species fold behind "+n" once chosen.
  await expect(panel.getByTestId("layer-nature-score")).toHaveText("Green & trees");
  await panel.getByTestId("layer-wildlife-hedgehog").click();
  await expect(panel.getByTestId("views-more-wildlife-hedgehog")).toHaveText("+7");
  await expect(panel.locator("[data-testid^='view-wildlife-hedgehog-']")).toHaveCount(5);
  await panel.getByTestId("views-more-wildlife-hedgehog").click();
  await expect(panel.locator("[data-testid^='view-wildlife-hedgehog-']")).toHaveCount(12);
});

test("Fix 8: Wildlife's legend says Seen, not absent; Green & trees is explained in three parts with the area's own", async ({ page }) => {
  await page.route("**/api/v1/areas/*/nature", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ available: true, green: { share: 0.3, percentile: 34 }, trees: { count: 40, perHectare: 9.1, percentile: 58, top: [] },
      site: { name: "Nature reserve", kind: "lnr", metres: 900, percentile: 41 }, score: { percentile: 44 }, home: null, wildlife: null, sources: [] }),
  }));
  await page.goto("/?layer=wildlife-hedgehog");
  await expect(page.getByTestId("legend-wildlife-note")).toHaveText("Seen, not absent");
  await page.getByTestId("legend-explain").click();
  await expect(page.getByTestId("layer-explainer-line")).toContainText("people's sightings (GBIF)");
  await page.keyboard.press("Escape");

  await page.goto("/?layer=nature-score&selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByTestId("legend-wildlife-note")).toHaveCount(0);
  await expect(page.getByTestId("legend-caption")).toContainText("Green & trees");
  await page.getByTestId("legend-explain").click();
  const explainer = page.getByTestId("layer-explainer");
  await expect(explainer).toHaveAccessibleName("About Green & trees");
  await expect(explainer.getByTestId("layer-explainer-line")).toHaveText("Green land, street trees and a nature site nearby, as one score.");
  await expect(explainer.getByTestId("layer-explainer-value")).toHaveText(["34th", "58th", "41st"]);
  await expect(explainer.getByTestId("layer-explainer-points")).toContainText("No score if a part is missing");
  await expect(explainer.getByTestId("layer-explainer-guide")).toHaveAttribute("href", "/guide/nature");
});

test("Fix 12: the legend ? explains the layer shown, with London typical and the area chosen on its scale", async ({ page }, testInfo) => {
  await page.goto("/?layer=crime&selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  const about = page.getByTestId("legend-explain");
  await about.click();
  const explainer = page.getByTestId("layer-explainer");
  await expect(explainer).toBeVisible();
  await expect(explainer.getByRole("heading", { name: "Crime" })).toBeVisible();
  await expect(explainer.getByTestId("layer-explainer-points")).toContainText("police.uk, to Jun 2026");
  await expect(explainer.getByTestId("layer-explainer-average")).toContainText(/London typical [\d.]+ crimes per 1,000/);
  await expect(explainer.getByTestId("layer-explainer-area")).toContainText(/St James's.* · [\d.,]+ crimes per 1,000/);
  await expect(explainer.getByTestId("layer-explainer-guide")).toHaveAttribute("href", "/guide/crime");
  // Inside the window, above the chip (a phone: a MapSheet, the chip riding above it).
  const [panel, chip] = await Promise.all([explainer.boundingBox(), page.getByTestId("legend-chip").boundingBox()]);
  if (testInfo.project.name === "mobile") expect(chip!.y + chip!.height).toBeLessThanOrEqual(panel!.y);
  else expect(panel!.y + panel!.height).toBeLessThanOrEqual(chip!.y);
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // × and Escape close it; the Layers menu and the explainer are never open together.
  await page.getByTestId("layer-explainer-close").click();
  await expect(explainer).toBeHidden();
  await about.click();
  await page.keyboard.press("Escape");
  await expect(explainer).toBeHidden();
  await expect(about).toBeFocused();
  await about.click();
  await page.getByTestId("layers-toggle").click();
  await expect(explainer).toBeHidden();
  await expect(page.getByTestId("layers-panel")).toBeVisible();
});

test("Fix 10: switching layers never moves the camera the visitor left", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "+ and − are the desktop's (a phone pinches)");
  // No position in the link: the map fits the chosen MSOA once (it is not drawn at the price layer's LSOA level).
  await page.goto("/?selected=uk%3Amsoa%3AE02000002&period=2026-06");
  await expect(page.getByTestId("selected-area")).toContainText("Highbury · N5");
  await expect.poll(() => new URL(page.url()).searchParams.get("lat"), { timeout: 30_000 }).not.toBeNull();
  const fitted = await settledCamera(page);
  // Moved by the + button: no gesture to cancel a pending fit with.
  await page.getByTestId("zoom-in").click();
  await expect.poll(() => camera(page).zoom).toBeCloseTo(fitted.zoom + 1, 1);
  const left = camera(page);
  // Income is drawn per MSOA (the chosen area's own level), then back to prices.
  await chooseLayer(page, "income");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "income");
  await expectSteady(() => expect(camera(page)).toEqual(left), 1_500);
  await chooseLayer(page, "price-per-square-metre");
  await expectSteady(() => expect(camera(page)).toEqual(left), 1_500);
  // A new selection may still bring the camera to it.
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect.poll(() => camera(page).lat, { timeout: 10_000 }).not.toBe(left.lat);
});

test("Fix 10: a wider area chosen from ♡ Saved is fitted once; a later layer that draws it never flies back", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "+ and − are the desktop's (a phone pinches)");
  const highbury = "uk:msoa:E02000002";
  await page.addInitScript((value) => window.localStorage.setItem("close-knit.saved-shortlists.v1", value), JSON.stringify([{
    schemaVersion: "saved-shortlist.v1", id: "seeded-fix-10", name: "Fix 10", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z",
    candidates: [highbury], candidateNames: { [highbury]: "Highbury" }, profile: DEFAULT_PROFILE, mode: "demo", release: "demo-fixture-pack", evidence: [],
  }]));
  // The price layer draws LSOAs: the MSOA is outlined and fitted by its own shape, not by a drawn area.
  await page.goto("/?layer=price-per-square-metre&period=2026-06&lat=51.45&lng=-0.2&zoom=11");
  await mapReady(page);
  await page.getByTestId("header-saved-areas").click();
  // PRs #316/#320: the Saved row reads "Highbury £6,800/m²" once its price is in.
  await page.getByTestId("saved-panel").getByRole("button", { name: /^Highbury\b/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText("Highbury");
  await expect.poll(() => camera(page).lng, { timeout: 10_000 }).not.toBe(-0.2);
  const fitted = await settledCamera(page);
  await page.getByTestId("zoom-in").click();
  await expect.poll(() => camera(page).zoom).toBeCloseTo(fitted.zoom + 1, 1);
  const left = camera(page);
  // Income draws MSOAs, Highbury among them: the camera stays where the visitor left it.
  await chooseLayer(page, "income");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "income");
  await expectSteady(() => expect(camera(page)).toEqual(left), 1_500);
});

test.describe("Fix 2 + 24: road collisions", () => {
  const [lng, lat] = [-0.1416, 51.501];
  // Two casualties at one spot, west of the first: the side panel a card opens in covers the map's east on a laptop.
  const STACK: [number, number] = [lng - 0.004, lat];

  async function serveCollisions(page: Page) {
    const { geoJSONToTile } = await import("@maplibre/geojson-vt");
    const { fromGeojsonVt } = await import("@maplibre/vt-pbf");
    const point = (at: [number, number], properties: Record<string, unknown>) => ({
      type: "Feature" as const, properties: { n: 1, ...properties }, geometry: { type: "Point" as const, coordinates: at },
    });
    const casualties = {
      type: "FeatureCollection",
      features: [
        point([lng, lat], { severity: 2, year: 2023, road_user: "pedestrian", child: true, dark: true }),
        point(STACK, { severity: 3, year: 2024, road_user: "cyclist", child: false, dark: false }),
        point(STACK, { severity: 1, year: 2021, road_user: "car", child: false, dark: false }),
      ],
    };
    await page.route("**/api/v1/tiles/collisions/**", (route) => {
      const [z, x, y] = new URL(route.request().url()).pathname.replace(".pbf", "").split("/").slice(-3).map(Number);
      const tile = geoJSONToTile(casualties as never, z, x, y, { clip: true });
      if (!tile?.features.length) return route.fulfill({ status: 204 });
      return route.fulfill({ status: 200, contentType: "application/vnd.mapbox-vector-tile", body: Buffer.from(fromGeojsonVt({ collisions: tile }, { version: 2, extent: 4096 })) });
    });
  }

  async function showCollisions(page: Page) {
    await page.goto(`/?diagnostics=1&layer=price-per-square-metre&zoom=15&lat=${lat}&lng=${lng}`);
    await mapReady(page);
    const show = await openShowPanel(page);
    await show.getByTestId("collisions-toggle").check();
    return show;
  }

  test("a link with ?collisions=on opens the map with the overlay on (a home's Safety → On map)", async ({ page }) => {
    await serveCollisions(page);
    await page.goto(`/?diagnostics=1&layer=crime&collisions=on&zoom=15&lat=${lat}&lng=${lng}`);
    await mapReady(page);
    const show = await openShowPanel(page);
    await expect(show.getByTestId("collisions-toggle")).toBeChecked();
  });

  test("a home's Safety \"On map\" link, clicked, opens the map with the overlay on", async ({ page }) => {
    await serveCollisions(page);
    await page.goto("/property/100000000001");
    const link = page.getByTestId("road-safety-map");
    await link.scrollIntoViewIfNeeded();
    await expect(link).toHaveAttribute("href", /collisions=on/);
    await link.click();
    await expect(page).toHaveURL(/^[^?]+\/\?.*selected=uk%3Alsoa%3AE01000001/);
    await mapReady(page);
    const show = await openShowPanel(page);
    await expect(show.getByTestId("collisions-toggle")).toBeChecked();
  });

  test("the dots draw over street names and labels; a dot's popup names the casualty and links STATS19", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "hover needs a pointer");
    await serveCollisions(page);
    await showCollisions(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.layerIds().includes("collision-point") ?? false)).toBe(true);
    const ids = await page.evaluate(() => window.__closeKnitDiagnostics.layerIds());
    for (const label of ["area-labels-district", "area-labels-borough"]) {
      if (ids.includes(label)) expect(ids.indexOf("collision-point"), label).toBeGreaterThan(ids.indexOf(label));
    }
    // The heatmap stays under the labels.
    expect(ids.indexOf("collision-heat")).toBeLessThan(ids.indexOf("collision-point"));
    // The bursts (v4 Task 4) go in once their pictures are drawn, over the labels too.
    await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.layerIds().includes("collision-marker") ?? false)).toBe(true);

    const canvas = (await page.locator(".maplibregl-canvas").boundingBox())!;
    const dot = await page.evaluate((at) => window.__closeKnitDiagnostics.project(at), [lng, lat] as [number, number]);
    // A hover peeks at the casualty in the map tooltip (Map controls PR 3): it takes no pointer or focus.
    const tooltip = page.getByTestId("map-tooltip");
    await expect(async () => {
      await page.mouse.move(canvas.x + dot.x + 20, canvas.y + dot.y + 20);
      await page.mouse.move(canvas.x + dot.x, canvas.y + dot.y, { steps: 4 });
      await expect(tooltip).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(tooltip.locator("strong")).toHaveText("Serious · 2023 · Dark");
    await expect(tooltip).toContainText("Pedestrian · child 0–15");
    await expect(tooltip).not.toContainText("Killed");
    // The tooltip sits beside the dot, never over it.
    const box = (await tooltip.boundingBox())!;
    const [x, y] = [canvas.x + dot.x, canvas.y + dot.y];
    expect(x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height).toBe(false);
    // A click opens the casualty's card in the sheet, with the STATS19 link; the area under the dot stays unselected.
    const card = page.getByTestId("collision-card");
    await expect(async () => {
      await page.mouse.click(canvas.x + dot.x, canvas.y + dot.y);
      await expect(card).toBeAttached({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(card).toContainText("Serious");
    await expect(card).toContainText("2023");
    await expect(card).toContainText("Dark");
    await expect(card).toContainText("Pedestrian · child 0–15");
    await expect(card.getByRole("link", { name: "STATS19 data ↗" })).toHaveAttribute("href", "https://www.gov.uk/government/statistical-data-sets/road-safety-open-data");
    expect(new URL(page.url()).searchParams.get("selected")).toBeNull();

    // Two people hurt at one spot: how many, and Zoom in.
    const stack = await page.evaluate((at) => window.__closeKnitDiagnostics.project(at), STACK);
    await expect(async () => {
      await page.mouse.move(canvas.x + stack.x + 20, canvas.y + stack.y + 20);
      await page.mouse.move(canvas.x + stack.x, canvas.y + stack.y, { steps: 4 });
      await expect(tooltip).toContainText("2 people hurt here", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.mouse.click(canvas.x + stack.x, canvas.y + stack.y);
    await expect(card).toContainText("2 people hurt here");
    await expect(card.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await card.getByTestId("collision-card-close").click();
    await expect(card).toHaveCount(0);
  });

  test("each filter list has All · None; None leaves no dots and asks for at least one", async ({ page }) => {
    await serveCollisions(page);
    const show = await showCollisions(page);
    const panel = show.getByTestId("collision-panel");
    await expect(panel.getByTestId("collision-heat-key")).toContainText("Casualties weighted by severity");
    await expect(panel.getByTestId("collision-severity-1")).toContainText("Fatal");
    for (const group of ["users", "severity", "year"]) {
      await expect(panel.getByTestId(`collision-${group}-all`)).toBeDisabled();
      await expect(panel.getByTestId(`collision-${group}-none`)).toBeEnabled();
    }
    await panel.getByTestId("collision-severity-none").click();
    // The map toast says it (v4 Task 10), not a line in the panel.
    await expect(page.getByTestId("map-toast")).toHaveAttribute("data-kind", "pick-one");
    await expect(page.getByTestId("map-toast-text")).toHaveText("Pick at least one.");
    await expect(panel.getByTestId("collision-severity-1").getByRole("checkbox")).not.toBeChecked();
    await expect(panel.getByTestId("collision-severity-none")).toBeDisabled();
    await panel.getByTestId("collision-severity-all").click();
    await expect(panel.getByRole("group", { name: "How badly" })).not.toHaveAttribute("data-empty");
    await expect(panel.getByRole("checkbox", { name: /Serious/ })).toBeChecked();
  });
});

test("Fix 12 on a phone: the explainer is a MapSheet at half (v4 Task 13), the chip above it, inside the screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone layout");
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await page.getByTestId("legend-explain").click();
  const explainer = page.getByTestId("layer-explainer");
  await expect(explainer).toBeVisible();
  const sheet = page.locator("[data-sheet='explainer']");
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect.poll(() => sheet.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  const [panel, chip] = await Promise.all([sheet.boundingBox(), page.getByTestId("legend-chip").boundingBox()]);
  const { width, height } = page.viewportSize()!;
  expect(panel!.x).toBe(0);
  expect(panel!.width).toBe(width);
  expect(Math.abs(panel!.y + panel!.height - height)).toBeLessThanOrEqual(1);
  expect(chip!.y + chip!.height).toBeLessThanOrEqual(panel!.y);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  await page.getByTestId("layer-explainer-close").click();
  await expect(explainer).toBeHidden();
});

test("Fix 21: a criterion's panel has no scale and no tags; the legend ? names what it counts", async ({ page }) => {
  await page.goto("/?layer=custom:gyms");
  const focus = page.getByTestId("criterion-focus");
  await expect(focus.getByRole("heading", { level: 1 })).toHaveText("Nearest gym or sports centre");
  await expect(focus.getByTestId("criterion-legend")).toHaveCount(0);
  await expect(focus).not.toContainText("OpenStreetMap tags");
  await expect(focus.getByTestId("criterion-add")).toBeVisible();
  await page.getByTestId("legend-explain").click();
  await expect(page.getByTestId("layer-explainer-points")).toContainText("Counted from OpenStreetMap: gyms and sports centres");
  await expect(page.getByTestId("layer-explainer-points")).toContainText("leisure=fitness_centre");
});

test("search reaches a layer inside a closed group; cleared, the groups come back", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  await panel.getByTestId("topic-search").fill("hedgehog");
  await expect(panel.locator(".topic-item").first()).toHaveText("Wildlife seen");
  await expect(panel.getByTestId("layer-none")).toHaveCount(0);
  await panel.getByTestId("topic-search").fill("");
  await expect(panel.getByTestId("layer-none")).toBeVisible();
  await expect(await topicItem(page, "nature-score")).toHaveText("Green & trees");
});
