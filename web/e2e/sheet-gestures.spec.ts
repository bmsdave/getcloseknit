import { expect, expectSteady, pause, test, type Page } from "./fixtures";

// The phone sheet under real touch: CDP touch events reach the page as
// touch and pointer events, as a finger would. The sheet rests at its peek,
// half or full and moves between them like the sheet in Apple or Google Maps:
// the grabber, head and peek line drag it, a flick goes one snap its way, the
// evidence is text that scrolls (a pull down from its top moves the sheet), a
// tap on the map never moves it, and the page never scrolls.

test.use({ hasTouch: true });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "touch gestures on the phone sheet");
});

async function openArea(page: Page) {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "half");
  // v4.5: the half grows to show the whole peek once its tiles are in (map-dock.tsx usePeekFit); measure after.
  // A cold dev server compiles the standouts route on the first test: allow it the time.
  await expect(page.getByTestId("area-tiles").locator(".standout-tile")).toHaveCount(4, { timeout: 20_000 });
  await expect.poll(() => page.getByTestId("map-dock").evaluate((node) => node.style.getPropertyValue("--sheet-fit"))).not.toBe("");
  await settled(page);
}

/**
 * One finger from (x, y0) to (x, y1), then lifted. Slow (the default) moves
 * in 5px steps and rests before lifting, so the release has no speed; a
 * flick moves in three long steps 16ms apart by the event clock and lifts.
 * `rest` holds the finger still before it lifts.
 */
async function drag(page: Page, x: number, y0: number, y1: number, how: "slow" | "flick" = "slow", rest = how === "slow" ? 200 : 0) {
  const cdp = await page.context().newCDPSession(page);
  const steps = how === "flick" ? 3 : Math.max(2, Math.round(Math.abs(y1 - y0) / 5));
  const moves = Array.from({ length: steps }, (_, index) => ({ x, y: y0 + ((y1 - y0) * (index + 1)) / steps }));
  if (how === "flick") {
    // The finger's own clock: 16ms a move however busy the test run is.
    const start = Date.now() / 1000;
    const send = (type: string, touchPoints: { x: number; y: number }[], at: number) =>
      cdp.send("Input.dispatchTouchEvent", { type: type as "touchMove", touchPoints, timestamp: start + at });
    await send("touchStart", [{ x, y: y0 }], 0);
    for (const [index, point] of moves.entries()) await send("touchMove", [point], (index + 1) * 0.016);
    await send("touchEnd", [], (steps + 1) * 0.016 + rest / 1000);
  } else {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
    for (const point of moves) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
      await pause(16);
    }
    if (rest) await pause(rest);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await cdp.detach();
}

/** Whether a tap's outcome shows within `ms` (a tap may land on no area): true as soon as it does. */
function comesTrue(check: () => Promise<boolean>, ms = 1_000): Promise<boolean> {
  return expect.poll(check, { timeout: ms }).toBe(true).then(() => true, () => false);
}

/** Waits for the sheet to finish sliding to where it rests. */
async function settled(page: Page) {
  await expect.poll(() => page.getByTestId("map-dock").evaluate((node) => getComputedStyle(node).transform)).toBe("none");
}

async function centre(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves the sheet with its grabber's keys: ArrowUp and ArrowDown step a snap, Escape lowers it. */
async function snapTo(page: Page, snap: "collapsed" | "half" | "full") {
  const dock = page.getByTestId("map-dock");
  const handle = page.getByTestId("sheet-handle");
  await handle.focus();
  // Escape lowers a raised sheet; on the peek it is the Esc ladder's next rung and deselects the area.
  if ((await dock.getAttribute("data-snap")) !== "collapsed") await page.keyboard.press("Escape");
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  for (const step of snap === "collapsed" ? [] : snap === "half" ? ["half"] : ["half", "full"]) {
    await page.keyboard.press("ArrowUp");
    await expect(dock).toHaveAttribute("data-snap", step);
  }
  await settled(page);
}

/** A point where the map itself is on top (not the top bar or the sheet), to tap it like a person would. */
async function openMapPoint(page: Page) {
  const point = await page.evaluate(() => {
    for (let y = innerHeight * 0.15; y < innerHeight * 0.9; y += 20) {
      for (let x = innerWidth / 2 - 60; x < innerWidth - 20; x += 20) {
        if (document.elementFromPoint(x, y)?.classList.contains("maplibregl-canvas")) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no visible map point");
  return point;
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const dock = document.querySelector("[data-testid='map-dock']")!.getBoundingClientRect();
    const bar = document.querySelector(".explorer-header")!.getBoundingClientRect();
    return { top: dock.top, bottom: dock.bottom, barBottom: bar.bottom, viewport: innerHeight, pageScroll: document.scrollingElement!.scrollTop + scrollY };
  });
}

test("tapping the grabber toggles the peek and half; from full it comes down to half", async ({ page }) => {
  await openArea(page);
  const dock = page.getByTestId("map-dock");
  const handle = page.getByTestId("sheet-handle");
  await expect(handle).toHaveRole("button");
  const box = await handle.boundingBox();
  expect(box?.height ?? 0, "the handle is a finger-sized target").toBeGreaterThanOrEqual(24);

  await handle.tap();
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  await expect(page.getByTestId("evidence-panel")).toBeHidden();
  await expect(page.getByTestId("evidence-sheet-reopen")).toContainText("St James's · SW1A");
  await settled(page);
  // The peek is a small tail: the grabber over one line.
  const peek = await geometry(page);
  expect(peek.bottom).toBeCloseTo(peek.viewport, 0);
  expect(peek.bottom - peek.top, "the peek is one line under the grabber").toBeLessThanOrEqual(80);

  await handle.tap();
  await expect(dock).toHaveAttribute("data-snap", "half");
  await expect(page.getByTestId("evidence-panel")).toBeVisible();

  await snapTo(page, "full");
  const full = await geometry(page);
  expect(full.top, "the full sheet stops under the top bar").toBeGreaterThanOrEqual(full.barBottom);
  expect(full.bottom).toBeCloseTo(full.viewport, 0);
  await expect(page.getByTestId("selected-area")).toBeInViewport();
  await page.getByTestId("sheet-handle").tap();
  await expect(dock).toHaveAttribute("data-snap", "half");
});

test("a tap on the map never opens, closes or moves the sheet", async ({ page }) => {
  await openArea(page);
  const dock = page.getByTestId("map-dock");
  // The map is up and painted before it is tapped.
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get("lat")), { timeout: 30_000 }).not.toBeNull();
  // (Full covers the map up to the top bar: there is no map left to tap.)
  for (const snap of ["collapsed", "half"] as const) {
    await snapTo(page, snap);
    const before = await geometry(page);
    const at = await openMapPoint(page);
    await page.touchscreen.tap(at.x, at.y);
    await expectSteady(async () => {
      expect(await dock.getAttribute("data-snap"), `a map tap at ${snap}`).toBe(snap);
      expect((await geometry(page)).top, `the sheet stays put at ${snap}`).toBeCloseTo(before.top, 0);
    }, 600);
  }
});

test("with nothing chosen the sheet rests at its peek: the prompt; the first area tapped opens its peek view (v4.4)", async ({ page }) => {
  // A returning visitor (the first-visit card closed): the peek carries the one "Try an example" (v4.6).
  await page.addInitScript(() => window.localStorage.setItem("close-knit.intro-dismissed.v1", "1"));
  await page.goto("/");
  const dock = page.getByTestId("map-dock");
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  // The peek is "Choose an area · Try an example" (v3 Fix 1).
  await expect(page.getByTestId("evidence-sheet-reopen")).toHaveText("Choose an area");
  await expect(page.getByTestId("dock-example")).toHaveText("Try an example");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get("lat")), { timeout: 30_000 }).not.toBeNull();
  await settled(page);
  const before = await geometry(page);
  expect(before.bottom - before.top, "the peek, not an empty half").toBeLessThanOrEqual(80);
  const selected = () => page.evaluate(() => new URL(location.href).searchParams.get("selected"));
  const points = await page.evaluate(() => [0.3, 0.4, 0.2, 0.5].flatMap((fy) => [0.5, 0.3, 0.7].map((fx) => ({ x: innerWidth * fx, y: innerHeight * fy })))
    .filter(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("maplibregl-canvas")));
  for (const point of points) {
    await page.touchscreen.tap(point.x, point.y);
    if (await comesTrue(async () => !!(await selected()))) break;
  }
  expect(await selected(), "a tap on the map chose an area").not.toBeNull();
  await expect(dock).toHaveAttribute("data-area", "area");
  // Final prod check: never a one-line bar needing a second tap; the peek (half) shows at once.
  await expect(dock).toHaveAttribute("data-snap", "half");
  await expect(page.getByTestId("evidence-panel")).toHaveAttribute("data-view", "peek");
});

test("with nothing chosen the sheet stays a peek bar through the map's controls, and the centre is the map's", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const dock = page.getByTestId("map-dock");
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get("lat")), { timeout: 30_000 }).not.toBeNull();
  // Layers and Show open and close over it; nothing lifts the empty sheet but the visitor's own tap.
  for (const id of ["layers-toggle", "show-toggle"]) {
    await page.getByTestId(id).click();
    await page.getByTestId("layers-close").click();
    await expect(dock).toHaveAttribute("data-snap", "collapsed");
  }
  await settled(page);
  // A tap at the centre lands on the map (it chooses whatever area is there), never on the sheet.
  // (Polled: the static poster covers the canvas until the map's first frame.)
  await expect.poll(() => page.evaluate(() => document.elementFromPoint(195, 422)?.classList.contains("maplibregl-canvas"))).toBe(true);
  await page.touchscreen.tap(195, 422);
  // An area chosen there opens its peek (v4.4); a tap on no area leaves the bar down.
  const chosen = await comesTrue(() => page.evaluate(() => !!new URL(location.href).searchParams.get("selected")), 5_000);
  await expect(dock).toHaveAttribute("data-snap", chosen ? "half" : "collapsed");
});

test("collapsed, a new area chosen on the map opens its peek view at half (v4.4)", async ({ page }) => {
  await openArea(page);
  const dock = page.getByTestId("map-dock");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get("lat")), { timeout: 30_000 }).not.toBeNull();
  await snapTo(page, "collapsed");
  const row = page.getByTestId("evidence-sheet-reopen");
  const first = await row.textContent();
  const selected = () => page.evaluate(() => new URL(location.href).searchParams.get("selected"));
  const was = await selected();
  // Tap around the map until a tap lands on another area.
  const points = await page.evaluate(() => [0.4, 0.3, 0.5, 0.2].flatMap((fy) => [0.95, 0.05, 0.85, 0.15].map((fx) => ({ x: innerWidth * fx, y: innerHeight * fy })))
    .filter(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("maplibregl-canvas")));
  for (const point of points) {
    await page.touchscreen.tap(point.x, point.y);
    if (await comesTrue(async () => (await selected()) !== was)) break;
  }
  expect(await selected(), "a tap on the map chose another area").not.toBe(was);
  await expect(dock).toHaveAttribute("data-snap", "half");
  await expect(page.getByTestId("evidence-panel")).toHaveAttribute("data-view", "peek");
  await expect(page.getByTestId("selected-area")).not.toHaveText(first?.split(" · ")[0] ?? "");
});

test("a search result, asked for, rises from the peek to half", async ({ page }) => {
  await openArea(page);
  await snapTo(page, "collapsed");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).tap();
  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "half");
  await expect(page.getByTestId("evidence-panel")).toBeVisible();
});

test("a slow drag on the grabber, head or peek line rests on the nearest snap", async ({ page }) => {
  await openArea(page);
  const dock = page.getByTestId("map-dock");
  const half = await geometry(page);

  let at = await centre(page, "sheet-handle");
  await drag(page, at.x, at.y, at.y - 300);
  await expect(dock).toHaveAttribute("data-snap", "full");
  await settled(page);
  expect((await geometry(page)).top).toBeLessThan(half.top);

  // The sheet's lower button drags too; the drag must not press it (that would lower the sheet to its peek).
  at = await centre(page, "evidence-sheet-close");
  await drag(page, at.x, at.y, at.y + 300);
  await expect(dock).toHaveAttribute("data-snap", "half");
  await settled(page);
  expect((await geometry(page)).top).toBeCloseTo(half.top, 0);

  // Most of the way from half to the peek (the area's half fits its whole peek, v4.5: taller than 45%).
  at = await centre(page, "sheet-handle");
  await drag(page, at.x, at.y, at.y + 340);
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  await expect(page.getByTestId("evidence-panel")).toBeHidden();

  // Collapsed, the reopen row drags the sheet back up.
  await settled(page);
  at = await centre(page, "evidence-sheet-reopen");
  await drag(page, at.x, at.y, at.y - 340);
  await expect(dock).toHaveAttribute("data-snap", "half");

  // A short drag springs back.
  await settled(page);
  at = await centre(page, "sheet-handle");
  await drag(page, at.x, at.y, at.y + 30);
  await expect(dock).toHaveAttribute("data-snap", "half");
  await settled(page);
  expect((await geometry(page)).top).toBeCloseTo(half.top, 0);
  expect((await geometry(page)).pageScroll).toBe(0);
});

test("the sheet follows the finger by transform alone, stretching past full", async ({ page }) => {
  await openArea(page);
  const at = await centre(page, "sheet-handle");
  const cdp = await page.context().newCDPSession(page);
  const sheetTop = () => page.getByTestId("map-dock").evaluate((node) => node.getBoundingClientRect().top);
  const before = await sheetTop();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: at.x, y: at.y - step * 10 }] });
  }
  await expect.poll(sheetTop).toBeCloseTo(before - 90, -1);
  const pinned = await page.getByTestId("map-dock").evaluate((node) => ({ dragging: node.dataset.dragging, transform: node.style.transform }));
  expect(pinned.dragging).toBe("true");
  expect(pinned.transform).toMatch(/^translate3d\(/);
  // Far past the top it gives way less and less.
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: at.x, y: at.y - 100 - step * 80 }] });
  }
  const bar = await page.locator(".explorer-header").evaluate((node) => node.getBoundingClientRect().bottom);
  await expect.poll(sheetTop).toBeLessThan(bar);
  expect(await sheetTop(), "the stretch past full is short").toBeGreaterThan(bar - 70);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "full");
  await settled(page);
  expect(await sheetTop()).toBeGreaterThanOrEqual(bar);
});

test("a flick goes on one snap its way, a drag that rests first does not", async ({ page }) => {
  await openArea(page);
  const dock = page.getByTestId("map-dock");

  // 160px up from half is nearer half than full: only its speed takes it to full.
  let at = await centre(page, "sheet-handle");
  await drag(page, at.x, at.y, at.y - 160, "flick");
  await expect(dock).toHaveAttribute("data-snap", "full");
  await settled(page);

  at = await centre(page, "sheet-handle");
  await drag(page, at.x, at.y, at.y + 160, "flick");
  await expect(dock).toHaveAttribute("data-snap", "half");
  await settled(page);

  at = await centre(page, "sheet-handle");
  await drag(page, at.x, at.y, at.y + 100, "flick");
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  await settled(page);

  // The same flick held still before lifting rests on the nearest snap.
  at = await centre(page, "sheet-handle");
  await drag(page, at.x, at.y, at.y - 60, "flick", 250);
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
});

test("the evidence hands over to the sheet: it scrolls only once the sheet is full", async ({ page }) => {
  await openArea(page);
  const dock = page.getByTestId("map-dock");
  const area = page.locator(".dock-area");
  const scrollTop = () => area.evaluate((node) => node.scrollTop);
  let box = (await area.boundingBox())!;
  const x = box.x + box.width / 2;

  // The evidence is text: below full a drag up on it scrolls it (or nothing), never moving the sheet.
  const half = await geometry(page);
  await drag(page, x, box.y + box.height - 30, box.y + box.height - 230);
  await expectSteady(async () => {
    expect(await dock.getAttribute("data-snap")).toBe("half");
    expect((await geometry(page)).top).toBeCloseTo(half.top, 0);
  }, 300);
  // Nor does a drag down on it: a finger selecting text must not lower the sheet.
  await area.evaluate((node) => { node.scrollTop = 0; });
  await drag(page, x, box.y + 30, box.y + 230);
  await expectSteady(async () => {
    expect(await dock.getAttribute("data-snap")).toBe("half");
    expect((await geometry(page)).top).toBeCloseTo(half.top, 0);
  }, 300);
  await snapTo(page, "full");
  // The demo evidence fits a full sheet: room is added below it, so there is something to scroll.
  await area.evaluate((node) => { (node.firstElementChild as HTMLElement).style.paddingBottom = "600px"; });

  // Full: up scrolls the evidence and the sheet stays.
  box = (await area.boundingBox())!;
  await drag(page, x, box.y + box.height - 40, box.y + 40);
  await expect.poll(scrollTop).toBeGreaterThan(20);
  await expect(dock).toHaveAttribute("data-snap", "full");

  // Scrolled, down scrolls back rather than moving the sheet.
  const scrolled = await scrollTop();
  await drag(page, x, box.y + 100, box.y + 140);
  await expect.poll(scrollTop).toBeLessThan(scrolled);
  await expect(dock).toHaveAttribute("data-snap", "full");

  // At its top, a pull down moves the sheet.
  await area.evaluate((node) => { node.scrollTop = 0; });
  await drag(page, x, box.y + 40, box.y + 340);
  await expect(dock).toHaveAttribute("data-snap", "half");
  expect(await scrollTop()).toBe(0);
  expect((await geometry(page)).pageScroll).toBe(0);
});

test("one pull down the scrolled full evidence scrolls it to its top, then lowers the sheet", async ({ page }) => {
  await openArea(page);
  const dock = page.getByTestId("map-dock");
  await snapTo(page, "full");
  const area = page.locator(".dock-area");
  // Scrolled 100px down (the demo evidence is short, shorter still in v3's brief: room is added below it).
  await area.evaluate((node) => {
    (node.firstElementChild as HTMLElement).style.paddingBottom = "1200px";
    node.scrollTop = 100;
  });
  expect(await area.evaluate((node) => node.scrollTop)).toBe(100);
  const box = (await area.boundingBox())!;
  // One finger, never lifted: 100px of scroll back to the top, then the sheet follows it down.
  await drag(page, box.x + box.width / 2, box.y + 40, box.y + 440);
  await expect(dock).toHaveAttribute("data-snap", "half");
  expect(await area.evaluate((node) => node.scrollTop)).toBe(0);
  expect((await geometry(page)).pageScroll).toBe(0);
});

test("taps inside the sheet still press their buttons; drags over them do not", async ({ page }) => {
  await openArea(page);
  // The brief's one action: a drag over it does not press it (nor move the sheet), a tap follows it.
  const open = page.getByTestId("open-area-page");
  const at = await centre(page, "open-area-page");
  await drag(page, at.x, at.y, at.y - 300);
  await expectSteady(async () => {
    expect(await page.getByTestId("map-dock").getAttribute("data-snap")).toBe("half");
    expect(new URL(page.url()).pathname).toBe("/");
  }, 300);
  await settled(page);
  await open.tap();
  await expect(page).toHaveURL(/\/area\/lsoa\/E01000001/);
});

test("a tap on the map's Layers button lowers the area to its peek and opens Layers at half; closing leaves the area at its peek", async ({ page }) => {
  await openArea(page);
  const dock = page.getByTestId("map-dock");
  await settled(page);
  await page.getByTestId("layers-toggle").tap();
  const layers = page.getByTestId("layers-panel");
  await expect(layers).toHaveAttribute("data-snap", "half");
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  await page.getByTestId("layers-close").tap();
  await expect(layers).toBeHidden();
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  await expect(page.getByTestId("evidence-sheet-reopen")).toContainText(/St James's|Westminster/);
  // Lifting the area sheet closes any MapSheet: one sheet at a time.
  await page.getByTestId("layers-toggle").tap();
  await expect(layers).toBeVisible();
  await page.getByTestId("layers-toggle").tap();
  await expect(layers).toBeHidden();
});

// v4 Task 13: every MapSheet takes the area sheet's gestures. The same cases run over each one; each
// waits on data-snap and the end of the slide (settledSheet), never on a fixed time.
const SHEETS = [
  { name: "Layers", open: "layers-toggle", sheet: "layers-panel" },
  { name: "Show", open: "show-toggle", sheet: "show-panel" },
] as const;

async function settledSheet(page: Page, testId: string) {
  await expect.poll(() => page.getByTestId(testId).evaluate((node) => getComputedStyle(node).transform)).toBe("none");
}

for (const { name, open, sheet } of SHEETS) {
  test(`${name}: drag up to full, scroll only at full, pull down to half, flick down to close`, async ({ page }) => {
    await openArea(page);
    await page.getByTestId(open).tap();
    const panel = page.getByTestId(sheet);
    await expect(panel).toHaveAttribute("data-snap", "half");
    await settledSheet(page, sheet);
    const grip = panel.getByTestId("map-sheet-handle");
    await expect(grip).toHaveAccessibleName("Sheet size: half height");
    // At half the body does not scroll: a drag in it moves the sheet.
    const body = panel.locator(".map-sheet__body");
    expect(await body.evaluate((node) => getComputedStyle(node).overflowY)).toBe("hidden");
    const head = await panel.locator(".map-sheet__head").boundingBox();
    const x = (head?.x ?? 0) + 40;
    const y = (head?.y ?? 0) + 20;
    await drag(page, x, y, 90);
    await expect(panel).toHaveAttribute("data-snap", "full");
    await settledSheet(page, sheet);
    expect(await body.evaluate((node) => getComputedStyle(node).overflowY)).toBe("auto");
    await expect(grip).toHaveAccessibleName("Sheet size: full height");
    // From full a slow pull down on the head rests at half.
    const top = await panel.locator(".map-sheet__head").boundingBox();
    const viewport = page.viewportSize()!;
    await drag(page, x, (top?.y ?? 0) + 20, viewport.height * 0.5);
    await expect(panel).toHaveAttribute("data-snap", "half");
    await settledSheet(page, sheet);
    // A flick down from half closes it (no peek).
    const half = await panel.locator(".map-sheet__head").boundingBox();
    await drag(page, x, (half?.y ?? 0) + 20, (half?.y ?? 0) + 200, "flick");
    await expect(panel).toBeHidden();
    await expect(page.getByTestId(open)).toBeFocused();
  });

  test(`${name}: the grabber's keys step it, Escape and the back gesture close it`, async ({ page }) => {
    await openArea(page);
    await page.getByTestId(open).tap();
    const panel = page.getByTestId(sheet);
    await expect(panel).toHaveAttribute("data-snap", "half");
    const grip = panel.getByTestId("map-sheet-handle");
    await grip.focus();
    await page.keyboard.press("ArrowUp");
    await expect(panel).toHaveAttribute("data-snap", "full");
    await page.keyboard.press("ArrowDown");
    await expect(panel).toHaveAttribute("data-snap", "half");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByTestId(open)).toBeFocused();
    // The back gesture closes the sheet and stays on the map, with the map's own address.
    await page.getByTestId(open).tap();
    await expect(panel).toBeVisible();
    const address = page.url();
    await page.goBack();
    await expect(panel).toBeHidden();
    await expect(page.getByTestId("map-dock")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(new URL(address).pathname);
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  });
}

test("one sheet at a time: Show replaces Layers, the explainer replaces Show", async ({ page }) => {
  await openArea(page);
  await page.getByTestId("layers-toggle").tap();
  await expect(page.getByTestId("layers-panel")).toBeVisible();
  await page.getByTestId("show-toggle").tap();
  await expect(page.getByTestId("layers-panel")).toBeHidden();
  await expect(page.getByTestId("show-panel")).toHaveAttribute("data-snap", "half");
  await page.getByTestId("legend-explain").tap();
  await expect(page.getByTestId("show-panel")).toBeHidden();
  const explainer = page.locator("[data-sheet='explainer']");
  await expect(explainer).toHaveAttribute("data-snap", "half");
  await expect(explainer.getByTestId("layer-explainer")).toBeVisible();
  await page.getByTestId("layer-explainer-close").tap();
  await expect(explainer).toHaveCount(0);
});

test("the grabber is a button: Enter and Space toggle, the arrows step, Escape lowers the sheet", async ({ page }) => {
  await openArea(page);
  const dock = page.getByTestId("map-dock");
  const handle = page.getByTestId("sheet-handle");
  await expect(handle).toHaveRole("button");
  await expect(handle).toHaveAccessibleName("Panel size: half height");
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(dock).toHaveAttribute("data-snap", "full");
  await expect(handle).toHaveAccessibleName("Panel size: full height");
  await page.keyboard.press("ArrowDown");
  await expect(dock).toHaveAttribute("data-snap", "half");
  await page.keyboard.press("Enter");
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  await expect(handle).toBeFocused();
  await page.keyboard.press(" ");
  await expect(dock).toHaveAttribute("data-snap", "half");
  await page.keyboard.press("Escape");
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
});

test("snap changes slide, and instantly under reduced motion", async ({ page }) => {
  await openArea(page);
  const duration = () => page.getByTestId("map-dock").evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration));
  expect(await duration()).toBeGreaterThanOrEqual(0.25);
  // Frame by frame, the sheet's top on its way to full.
  const tops = page.getByTestId("map-dock").evaluate((node) => new Promise<number[]>((resolve) => {
    const seen: number[] = [];
    const frame = () => {
      seen.push(Math.round(node.getBoundingClientRect().top));
      if (node.dataset.snap === "full" && getComputedStyle(node).transform === "none") resolve(seen);
      else requestAnimationFrame(frame);
    };
    frame();
  }));
  await page.getByTestId("sheet-handle").focus();
  await page.keyboard.press("ArrowUp");
  const path = await tops;
  const between = path.filter((top) => top < path[0] && top > path[path.length - 1]);
  expect(between.length, `the sheet slides from where it was: ${path.join(",")}`).toBeGreaterThan(2);
  await settled(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await duration()).toBeLessThan(0.01);
});

// v4 Task 11: height wins over width. A phone on its side (any width) gets the short layout: the area is a
// 360px right-side panel, full height, not a bottom sheet (it used to keep the sheet).
test("a phone on its side shows the area as a right-side panel", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  const dock = page.getByTestId("map-dock");
  await expect(dock).toBeVisible();
  const box = (await dock.boundingBox())!;
  expect(box.width).toBeCloseTo(360, 0);
  expect(box.x + box.width).toBeCloseTo(667 - 8, 0);
  expect(box.height).toBeGreaterThan(375 - 24);
  await expect(page.getByTestId("sheet-handle")).toBeHidden();
});

test("the explorer page itself never scrolls or rubber-bands", async ({ page }) => {
  await openArea(page);
  const overscroll = await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);
  expect(overscroll).toBe("none");
  const viewport = await page.evaluate(() => document.querySelector("meta[name='viewport']")?.getAttribute("content"));
  expect(viewport, "safe-area insets apply only with viewport-fit=cover").toContain("viewport-fit=cover");
  const sizes = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, view: innerHeight }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.view);
});
