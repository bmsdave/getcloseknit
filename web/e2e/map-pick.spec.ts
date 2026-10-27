import { expect, test, type Page } from "./fixtures";

// Map controls PR 2–3 (lib/map-pick.ts, map-controller/interactions.ts registerPick): one hit-test for every tap and hover.
// Hover (a mouse) peeks: a school's popup, the tooltip for a station; it takes no pointer and goes when the
// pointer leaves. A click or tap opens the object's card in the sheet and never selects the area under it;
// a "+N" fold zooms in; a tap on the empty map selects the area and closes the card. A touch screen has no
// peek: the tap goes straight to the card.
// Preview points (app/api/v1/schools/points): Westminster Primary Preview (report card) at zoom 15.

const PRIMARY = { lng: -0.139, lat: 51.503, name: "Westminster Primary Preview" };

async function openAt(page: Page, at: { lng: number; lat: number }, zoom = 15, extra = "") {
  const points = page.waitForResponse((response) => response.url().includes("/api/v1/schools/points"));
  await page.goto(`/?lat=${at.lat}&lng=${at.lng}&zoom=${zoom}&schools=on&stations=off&diagnostics=1${extra}`);
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  expect((await points).ok()).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.layerIds().includes("school-points") ?? false)).toBe(true);
}

/** A place on the page, in CSS pixels. */
async function screenPoint(page: Page, at: { lng: number; lat: number }) {
  const canvas = await page.locator(".maplibregl-canvas").boundingBox();
  const point = await page.evaluate((lngLat) => window.__closeKnitDiagnostics.project(lngLat), [at.lng, at.lat] as [number, number]);
  return { x: (canvas?.x ?? 0) + point.x, y: (canvas?.y ?? 0) + point.y };
}

const selectedIn = (page: Page) => new URL(page.url()).searchParams.get("selected");

test("hover a cap: the popup peeks without a link or a pointer, and goes when the pointer leaves", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "a touch screen has no peek");
  await openAt(page, PRIMARY);
  const popup = page.getByTestId("school-popup");
  await expect(async () => {
    const cap = await screenPoint(page, PRIMARY);
    await page.mouse.move(cap.x + 40, cap.y + 40);
    await page.mouse.move(cap.x, cap.y);
    await expect(popup).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(popup.locator(".school-pop__name")).toHaveText(PRIMARY.name);
  await expect(popup.getByTestId("school-popup-link")).toHaveCount(0);
  expect(await popup.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
  await expect(page.locator(".maplibregl-canvas")).toHaveCSS("cursor", "pointer");
  const cap = await screenPoint(page, PRIMARY);
  await page.mouse.move(cap.x + 200, cap.y + 160);
  await expect(popup).toBeHidden();
  await expect(page.getByTestId("school-card")).toHaveCount(0);
});

test("a click on a cap over an area opens the school in the panel, never the area; the empty map selects the area and closes it", async ({ page }, testInfo) => {
  const touch = testInfo.project.name === "mobile";
  await openAt(page, PRIMARY);
  // The school page's own content in the panel (school-panel.tsx), with the full page one link away.
  const card = page.getByTestId("school-panel");
  await expect(async () => {
    const cap = await screenPoint(page, PRIMARY);
    await page.mouse.click(cap.x, cap.y);
    await expect(card).toBeAttached({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(card).toHaveAttribute("data-urn", "100001");
  await expect(card.getByRole("heading", { level: 1 })).toHaveText(PRIMARY.name);
  await expect(card).toContainText("Primary school");
  await expect(card.getByTestId("school-panel-page")).toHaveAttribute("href", "/school/100001");
  await expect(card.getByTestId("school-panel-page")).toHaveText("Open school page ›");
  await expect(card.getByTestId("school-save")).toBeAttached();
  // The popup is a peek only: never pinned by a tap, and gone once the card opens.
  await expect(page.getByTestId("school-popup")).toHaveCount(0);
  expect(selectedIn(page), "the area under the cap stays unselected").toBeNull();
  // A tap on the map clear of the cap selects the area there and closes the card (on a phone, above the sheet the school raised).
  const cap = await screenPoint(page, PRIMARY);
  await page.mouse.click(cap.x - 150, touch ? cap.y - 160 : cap.y + 120);
  await expect.poll(() => selectedIn(page)).toMatch(/^uk:/);
  await expect(card).toHaveCount(0);
  if (touch) return;
  // Escape closes the card too.
  await page.mouse.click(cap.x, cap.y);
  await expect(card).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
});

test("a tap on a +N fold zooms in until it opens, and selects nothing", async ({ page }) => {
  // Two schools 60 m apart fold into one cap with "+1" at neighbourhood zoom.
  const TWIN = { lng: -0.1395, lat: 51.5035 };
  await page.route("**/api/v1/schools/points*", (route) => route.fulfill({ json: { schemaVersion: "school-points.v1", schools: [
    { urn: "100001", name: "Westminster Primary Preview", phase: "primary", latitude: PRIMARY.lat, longitude: PRIMARY.lng, kind: "state", stage: "primary" },
    { urn: "100002", name: "Twin Primary Preview", phase: "primary", latitude: TWIN.lat, longitude: TWIN.lng, kind: "state", stage: "primary", ofsted: "good" },
  ] } }));
  await openAt(page, PRIMARY, 14);
  // The folded cap is the cluster feature of the caps' own layer (its "+N" beside it is a picture only).
  const fold = async () => {
    const canvas = await page.locator(".maplibregl-canvas").boundingBox();
    const first = (await page.evaluate(() => window.__closeKnitDiagnostics.renderedPoints("school-points"))).find((point) => point.properties.cluster === true);
    return first ? { x: (canvas?.x ?? 0) + first.x, y: (canvas?.y ?? 0) + first.y, count: first.properties.point_count } : null;
  };
  await expect.poll(fold, { timeout: 15_000 }).not.toBeNull();
  const before = await page.evaluate(() => window.__closeKnitCamera!().zoom);
  await expect(async () => {
    const at = (await fold())!;
    expect(at.count).toBe(2);
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => page.evaluate(() => window.__closeKnitCamera!().zoom), { timeout: 1_500 }).toBeGreaterThan(before + 0.9);
  }).toPass({ timeout: 15_000 });
  expect(selectedIn(page)).toBeNull();
  await expect(page.getByTestId("school-card")).toHaveCount(0);
  await expect(page.getByTestId("school-popup")).toHaveCount(0);
});

test("a station peeks on hover with its name and lines", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "a touch screen has no peek");
  await page.goto(`/?lat=51.5308&lng=-0.1238&zoom=14&stations=on&schools=off&places=off&diagnostics=1`);
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  // An interchange drawn well inside the canvas (a rendered feature can sit in a tile just past its edge).
  const station = async () => {
    const canvas = (await page.locator(".maplibregl-canvas").boundingBox())!;
    const points = await page.evaluate(() => window.__closeKnitDiagnostics.renderedPoints("ck-transit-stations"));
    const first = points.find((point) => String(point.properties.lines).includes(",")
      && point.x > 60 && point.x < canvas.width - 60 && point.y > 120 && point.y < canvas.height - 120);
    return first ? { x: canvas.x + first.x, y: canvas.y + first.y, name: String(first.properties.name) } : null;
  };
  await expect.poll(station, { timeout: 20_000 }).not.toBeNull();
  const tooltip = page.getByTestId("map-tooltip");
  await expect(async () => {
    const at = (await station())!;
    await page.mouse.move(at.x + 30, at.y + 30);
    await page.mouse.move(at.x, at.y);
    await expect(tooltip).toBeVisible({ timeout: 1_000 });
    await expect(tooltip.locator("strong")).toHaveText(at.name);
  }).toPass({ timeout: 15_000 });
  await expect(tooltip.locator("span")).toContainText(/·/);
  // No click yet: the cursor does not promise one.
  await expect(page.locator(".maplibregl-canvas")).not.toHaveCSS("cursor", "pointer");
});
