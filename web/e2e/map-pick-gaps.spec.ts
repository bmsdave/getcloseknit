import { expect, test, type Page } from "./fixtures";

import { seedSearch } from "./wizard";

// Map controls PR 4 (lib/map-pick.ts): the gaps in the one hit-test. Your place's pin opens its card (rename,
// move, remove, commute from here); a saved home's ♡ opens the home's card; a cycle lane peeks its type on a
// hover (a line only peeks: the cursor stays the default). Every one goes through pickAt, no handler of its own.

const OFFICE = { lat: 51.5306, lng: -0.1239 };
// The preview home (lib/fixtures.ts: 1 Parliament Preview, SW1A 1AA).
const HOME = { uprn: "100000000001", lat: 51.501, lng: -0.1416 };

async function mapReady(page: Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__closeKnitDiagnostics?.project), { timeout: 20_000 }).toBe("function");
}

async function screenPoint(page: Page, at: { lng: number; lat: number }) {
  const canvas = (await page.locator(".maplibregl-canvas").boundingBox())!;
  const point = await page.evaluate((lngLat) => window.__closeKnitDiagnostics!.project(lngLat), [at.lng, at.lat] as [number, number]);
  return { x: canvas.x + point.x, y: canvas.y + point.y };
}

test("a tap on your place opens its card: rename, move, remove, commute from here", async ({ page }, testInfo) => {
  await seedSearch(page, { places: [{
    id: "office", label: "Office", target: { kind: "point", latitude: OFFICE.lat, longitude: OFFICE.lng },
    mode: "transit", targetMinutes: 30, weight: 3, must: false,
  }] });
  await page.goto(`/?mine=on&lat=${OFFICE.lat}&lng=${OFFICE.lng}&zoom=14&places=off&schools=off&stations=off&diagnostics=1`);
  await mapReady(page);
  const pin = page.getByTestId("my-place-pin");
  await expect(pin).toHaveAttribute("data-pick", "open");
  await expect(pin).toHaveCSS("cursor", "pointer");
  await pin.locator(".knit-pin").click();
  const card = page.getByTestId("my-place-card");
  await expect(card).toBeAttached();
  if (testInfo.project.name === "mobile") {
    // A phone's sheet stays lowered, its peek line naming the place; a tap raises it.
    const reopen = page.getByTestId("evidence-sheet-reopen");
    await expect(reopen).toHaveAttribute("aria-label", "Show panel: Office");
    await reopen.click();
  }
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("aria-label", "Your place: Office");
  expect(new URL(page.url()).searchParams.get("selected"), "the area under the pin stays unselected").toBeNull();

  // Rename: the card and the pin take the new name.
  await card.getByTestId("my-place-rename").click();
  await card.getByTestId("my-place-name").fill("Studio");
  await card.getByTestId("my-place-save").click();
  await expect(card.locator("strong")).toHaveText("Studio");
  await expect(pin.locator(".knit-place-label")).toHaveText("Studio");
  if (testInfo.project.name === "mobile") {
    // The raised sheet covers most of a phone's map: Remove from the card, the pin goes.
    await card.getByTestId("my-place-remove").click();
    await expect(card).toHaveCount(0);
    await expect(pin).toHaveCount(0);
    return;
  }

  // Move: a crosshair, then the next tap puts the pin there (and selects nothing).
  const before = (await pin.boundingBox())!;
  await card.getByTestId("my-place-move").click();
  await expect(card.getByTestId("my-place-move")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".maplibregl-canvas")).toHaveCSS("cursor", "crosshair");
  const office = await screenPoint(page, OFFICE);
  await page.mouse.click(office.x - 120, office.y + 60);
  await expect(card.getByTestId("my-place-move")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => Math.round((await pin.boundingBox())!.x - before.x)).toBeLessThan(-100);
  await expect(page.locator(".maplibregl-canvas")).not.toHaveCSS("cursor", "crosshair");
  expect(new URL(page.url()).searchParams.get("selected")).toBeNull();

  // Commute from here: My match, areas by the trip to it.
  await card.getByTestId("my-place-commute").click();
  await expect(page).toHaveURL(/layer=personal-match/);
  await expect(page.locator('[data-testid="match-item"][data-id="place:office"]')).toContainText("Studio");

  // Remove: the pin and its card go.
  await page.getByTestId("match-map-place").locator(".knit-pin").click();
  await expect(card).toBeVisible();
  await card.getByTestId("my-place-remove").click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("match-map-place")).toHaveCount(0);
  await expect(page.locator('[data-testid="match-item"][data-id="place:office"]')).toHaveCount(0);
});

test("a saved home's ♡ opens the home's card; its hover peeks the name", async ({ page }, testInfo) => {
  await page.addInitScript((uprn) => {
    const now = "2026-10-01T10:00:00.000Z";
    window.localStorage.setItem("close-knit.user-candidates.v1", JSON.stringify({ schemaVersion: "user-candidate-store.v1", candidates: [{
      schemaVersion: "user-candidate.v1", id: "candidate-1-parliament-preview", uprn, geographyId: "uk:lsoa:E01000001",
      address: { value: "1 Parliament Preview, London, SW1A 1AA", verification: "unverified", observedAt: now },
      referenceUrl: null, asking: null, bedrooms: null, floorAreaSqm: null, notes: null,
      linkage: { status: "unlinked", reason: "unknown-address" }, createdAt: now, updatedAt: now,
    }] }));
  }, HOME.uprn);
  await page.goto(`/?lat=${HOME.lat}&lng=${HOME.lng}&zoom=15&places=off&schools=off&stations=off&diagnostics=1`);
  await mapReady(page);
  const heart = page.locator('[data-testid="saved-pin"][data-saved^="home:"]');
  await expect(heart).toHaveAttribute("data-pick", "open", { timeout: 15_000 });
  if (testInfo.project.name !== "mobile") {
    await heart.hover();
    const peek = page.getByTestId("map-tooltip");
    await expect(peek).toBeVisible();
    await expect(peek.locator("strong")).toHaveText("1 Parliament Preview, London, SW1A 1AA");
  }
  await heart.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("uprn")).toBe(HOME.uprn);
  await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toBe("uk:lsoa:E01000001");
});

test("a cycle lane peeks its type on a hover; the cursor stays the default and a tap goes to the area", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "a touch screen has no peek");
  // Inside a preview area (the Westminster preview), so a tap has an area to select.
  const centre = { lat: 51.503, lng: -0.139 };
  const lanes = { type: "FeatureCollection", features: [{ type: "Feature", properties: { kind: "cycleway", name: "C3" },
    geometry: { type: "LineString", coordinates: [[centre.lng - 0.02, centre.lat], [centre.lng + 0.02, centre.lat]] } }] };
  const { geoJSONToTile } = await import("@maplibre/geojson-vt");
  const { fromGeojsonVt } = await import("@maplibre/vt-pbf");
  await page.route("**/api/v1/tiles/cycle-lanes/**", (route) => {
    const [z, x, y] = new URL(route.request().url()).pathname.replace(".pbf", "").split("/").slice(-3).map(Number);
    const tile = geoJSONToTile(lanes as never, z, x, y, { clip: true });
    if (!tile?.features.length) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 200, contentType: "application/vnd.mapbox-vector-tile",
      body: Buffer.from(fromGeojsonVt({ cycle_lanes: tile }, { version: 2, extent: 4096 })) });
  });
  await page.goto(`/?cycle=on&lat=${centre.lat}&lng=${centre.lng}&zoom=15&places=off&schools=off&stations=off&diagnostics=1`);
  await mapReady(page);
  const peek = page.getByTestId("map-tooltip");
  await expect(async () => {
    const on = await screenPoint(page, { lng: centre.lng + 0.002, lat: centre.lat });
    await page.mouse.move(on.x, on.y + 40);
    await page.mouse.move(on.x, on.y);
    await expect(peek).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(peek.locator("strong")).toHaveText("Cycleway");
  await expect(peek).toContainText("C3");
  await expect(page.locator(".maplibregl-canvas")).not.toHaveCSS("cursor", "pointer");
  // A click on the lane selects the area under it; no card opens.
  const on = await screenPoint(page, { lng: centre.lng + 0.002, lat: centre.lat });
  await page.mouse.click(on.x, on.y);
  await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toMatch(/^uk:/);
  await expect(page.locator(".place-card")).toHaveCount(0);
});
