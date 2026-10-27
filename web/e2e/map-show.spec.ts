import { expect, test } from "./fixtures";

import { openMatchBuilder, openShowPanel } from "./top-bar";
import { continueToReview, findMyArea, matchItem, PROFILE_KEY } from "./wizard";

// Show (map-layers.tsx): the round map-pin button's card of what is drawn on top of the colours, as
// tick-boxes keyed by their yarn (drawing an area is My match › Where now). The round buttons: My match, Layers,
// Show, then my location (with + and − on a desktop).

test("the round buttons stack My match, Layers and Show; Show lists its overlays with Stations on", async ({ page }, testInfo) => {
  await page.goto("/");
  const rail = page.getByTestId("map-rail");
  await expect(rail.getByRole("button")).toHaveCount(3);
  for (const [index, name] of ["My match", "Layers", "Show"].entries()) await expect(rail.getByRole("button").nth(index)).toHaveAccessibleName(name);
  await expect(page.getByTestId("locate-me")).toBeVisible();
  // A phone pinches to zoom: + and − are a desktop's.
  await expect(page.getByTestId("zoom-in")).toBeVisible({ visible: testInfo.project.name !== "mobile" });

  const show = await openShowPanel(page);
  await expect(show).toHaveAccessibleName("Show");
  const overlays = show.getByTestId("map-overlays");
  await expect(overlays.locator(".topic-overlay .topic-item__name")).toHaveText(
    ["Local places", "Schools", "Recent sales", "Stations", "My places", "Cycle lanes", "Road collisions", "Street trees"]);
  await expect(overlays.getByTestId("stations-toggle")).toBeChecked();
  await expect(overlays.getByTestId("schools-toggle")).not.toBeChecked();
  // Nothing pinned yet: My places says where to pin one.
  await expect(overlays.getByTestId("my-places-toggle")).toBeDisabled();

  await overlays.getByTestId("stations-toggle").uncheck();
  await expect.poll(() => new URL(page.url()).searchParams.get("stations")).toBe("off");
  const points = page.waitForResponse((response) => response.url().includes("/api/v1/schools/points"));
  await overlays.getByTestId("schools-toggle").check();
  expect((await points).ok()).toBe(true);
  await expect.poll(() => new URL(page.url()).searchParams.get("schools")).toBe("on");
  await expect(page.getByTestId("show-toggle")).toContainText("2");

  // A shared link keeps them.
  await page.reload();
  await expect(page.getByTestId("show-toggle")).toContainText("2");
  await expect((await openShowPanel(page)).getByTestId("stations-toggle")).not.toBeChecked();
});

async function startDrawing(page: import("@playwright/test").Page) {
  await openMatchBuilder(page);
  await continueToReview(page);
  await findMyArea(page).getByTestId("chip-where").click();
  await findMyArea(page).getByTestId("where-add-draw").click();
}

// v4 Task 8: drawing an area is My match › Where, not Show. Drawing mode is a slim bar over the map with the only
// corner counter: Tap corners · n so far · Undo · Cancel · Done (Done at the bottom of a phone's screen).
test("My match › Where › Draw on map adds a drawn area to Where; Show has no drawing", async ({ page }) => {
  await page.goto("/?lat=51.505&lng=-0.12&zoom=13");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect((await openShowPanel(page)).getByTestId("draw-zone")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await startDrawing(page);
  const bar = page.getByTestId("zone-draw-bar");
  await expect(bar.getByTestId("zone-draw-count")).toHaveText("Tap corners · 0 so far");
  // One counter: the Where card shows none of its own.
  await expect(page.getByText(/so far/)).toHaveCount(1);
  await expect(bar.getByTestId("finish-zone")).toBeDisabled();
  await expect(bar.getByTestId("undo-corner")).toBeDisabled();
  const canvas = await page.locator(".maplibregl-canvas").boundingBox();
  const cx = (canvas?.x ?? 0) + (canvas?.width ?? 0) * 0.3;
  const cy = (canvas?.y ?? 0) + (canvas?.height ?? 0) * 0.4;
  const corners = async () => Number(await bar.getByTestId("zone-draw-count").getAttribute("data-corners") ?? 0);
  for (const [index, [dx, dy]] of [[0, 0], [60, 0], [30, 50], [90, 40]].entries()) {
    // Retried until the tap counts: the drawing layer loads when drawing starts.
    await expect(async () => {
      if (await corners() <= index) await page.mouse.click(cx + dx, cy + dy);
      expect(await corners()).toBeGreaterThan(index);
    }).toPass();
  }
  await expect(bar.getByTestId("zone-draw-count")).toHaveText("Tap corners · 4 so far");
  // Undo takes the last corner back.
  await bar.getByTestId("undo-corner").click();
  await expect(bar.getByTestId("zone-draw-count")).toHaveText("Tap corners · 3 so far");
  await bar.getByTestId("finish-zone").click();
  // Done: the bar goes (no "0 so far" beside the finished zone) and a notice says where it went.
  await expect(bar).toHaveCount(0);
  await expect(page.getByText("Area I drew · added to Where")).toBeVisible();
  await expect(matchItem(page, "zone")).toContainText("Area I drew");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) ?? "", PROFILE_KEY)).toContain("polygon");
});

test("on a phone, drawing keeps Done at the bottom of the screen and the map clear", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lat=51.505&lng=-0.12&zoom=13");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await startDrawing(page);
  const bar = page.getByTestId("zone-draw-bar");
  await expect(bar).toBeVisible();
  const top = await bar.boundingBox();
  const done = await bar.getByTestId("finish-zone").boundingBox();
  expect(top!.y).toBeLessThan(140);
  expect(top!.height).toBeLessThan(64);
  // Thumb-reachable: Done sits near the bottom edge, full width within the 16 px gutters.
  expect(done!.y + done!.height).toBeGreaterThan(844 - 160);
  // My match's sheet steps aside, so a tap lands on Done.
  const centre = { x: done!.x + done!.width / 2, y: done!.y + done!.height / 2 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid"), centre)).toBe("finish-zone");
  expect(done!.x).toBeGreaterThanOrEqual(15);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Escape cancels.
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});
