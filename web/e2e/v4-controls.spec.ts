import { expect, expectSteady, test, type Locator, type Page } from "./fixtures";

import { openShowPanel, openTopMenu } from "./top-bar";

// v4.2 controls: the layer pill (Task 2), a phone on its side (Task 11), the desktop panel from the
// top (Task 14), a click only selects (Task 15), Show › Recent sales options (Task 19) and the
// keyboard / screen reader pass (G5 Task 33).

const AREA = "/?selected=uk%3Alsoa%3AE01000001";
const REAL_PRICE = "/?mode=real&release=official-2026-06&layer=price-per-square-metre&zoom=15";

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  expect(found, "on screen").toBeTruthy();
  return found!;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
}

async function mapReady(page: Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
}

function within(inner: Box, viewport: { width: number; height: number }) {
  expect(inner.x).toBeGreaterThanOrEqual(0);
  expect(inner.y).toBeGreaterThanOrEqual(0);
  expect(inner.x + inner.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(inner.y + inner.height).toBeLessThanOrEqual(viewport.height + 0.5);
}

test.describe("Task 2: a phone names the layer under the search", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the pill names the layer in full, opens Layers, and the legend keeps the scale and ?", async ({ page }) => {
    await page.goto(`${AREA}&layer=price-per-square-metre`);
    const pill = page.getByTestId("layer-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("Price per m²");
    // Never cut: the name's box holds all of its text.
    const cut = await pill.locator(".layer-pill__name").evaluate((node) => node.scrollWidth > node.clientWidth + 1);
    expect(cut).toBe(false);
    const bar = await box(page.getByTestId("top-bar-pill"));
    expect((await box(pill)).y).toBeGreaterThanOrEqual(bar.y + bar.height);
    // The chip shows the scale and "?" only; its name and period stay for screen readers.
    expect((await box(page.getByTestId("legend-chip").getByTestId("legend-caption"))).width).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("legend-chip")).toHaveAccessibleName(/Price per m² · /);
    await expect(page.getByTestId("legend-explain")).toBeVisible();
    await pill.click();
    await expect(page.getByTestId("layers-panel")).toBeVisible();
    await expect(pill).toHaveAttribute("aria-expanded", "true");
  });

  test("a view is named with the layer", async ({ page }) => {
    await page.goto(`${AREA}&layer=price-per-square-metre`);
    await page.getByTestId("layer-pill").click();
    await page.getByTestId("layers-panel").getByRole("button", { name: "Change", exact: true }).click();
    await expect(page.getByTestId("layer-pill")).toContainText(/Price per m² · .*change/i);
  });
});

test.describe("Task 2: desktop keeps its legend name", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("no pill on a desktop", async ({ page }) => {
    await page.goto(AREA);
    await expect(page.getByTestId("legend-chip").getByTestId("legend-caption")).toBeVisible();
    await expect(page.getByTestId("layer-pill")).toBeHidden();
  });
});

for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }]) {
  test.describe(`Task 11: a ${viewport.width} × ${viewport.height} phone on its side`, () => {
    test.use({ viewport });

    test("one-row bar, three circles, locate alone, a slim legend; nothing overlaps or leaves the screen", async ({ page }) => {
      await page.goto("/");
      await mapReady(page);
      await page.getByTestId("intro-dismiss").click();
      await expect(page.getByRole("combobox", { name: "Search", exact: true })).toHaveAttribute("placeholder", "Choose an area");
      await expect(page.getByTestId("map-hint")).toBeHidden();
      await expect(page.getByTestId("zoom-in")).toBeHidden();
      await expect(page.getByTestId("map-attribution-toggle")).toBeHidden();
      const bar = await box(page.getByTestId("top-bar-pill"));
      const controls = {
        match: await box(page.getByTestId("find-my-area")),
        layers: await box(page.getByTestId("layers-toggle")),
        show: await box(page.getByTestId("show-toggle")),
        locate: await box(page.getByTestId("locate-me")),
        legend: await box(page.locator(".map-key__row")),
        bar,
      };
      const entries = Object.entries(controls);
      for (const [name, rect] of entries) {
        within(rect, viewport);
        for (const [other, second] of entries) {
          if (name < other) expect(overlaps(rect, second), `${name} × ${other}`).toBe(false);
        }
      }
      // The three circles in one column, the top bar one row above them.
      expect(controls.match.x).toBeCloseTo(controls.show.x, 0);
      expect(controls.bar.height).toBeLessThanOrEqual(60);
      expect(controls.legend.width).toBeLessThanOrEqual(viewport.width / 2 + 0.5);
      // Show is never under My location (G5 Task 26).
      expect(controls.show.y + controls.show.height).toBeLessThan(controls.locate.y);
    });

    test("Layers opens as a 360px right-side panel, full height, and closes with Escape", async ({ page }) => {
      await page.goto(AREA);
      await mapReady(page);
      await page.getByTestId("layers-toggle").click();
      const panel = await box(page.getByTestId("layers-panel"));
      expect(panel.width).toBeCloseTo(360, 0);
      expect(panel.x + panel.width).toBeGreaterThan(viewport.width - 20);
      expect(panel.height).toBeGreaterThan(viewport.height - 24);
      // The bar shrinks to keep clear of it.
      expect(overlaps(await box(page.getByTestId("top-bar-pill")), panel)).toBe(false);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("layers-panel")).toBeHidden();
    });

    test("the area panel sits right, the circles beside it, and ⓘ credits live in the menu foot", async ({ page }) => {
      await page.goto(AREA);
      await mapReady(page);
      const dock = await box(page.getByTestId("map-dock"));
      expect(dock.width).toBeCloseTo(360, 0);
      for (const id of ["find-my-area", "layers-toggle", "show-toggle", "locate-me"]) {
        const control = await box(page.getByTestId(id));
        expect(overlaps(control, dock), id).toBe(false);
        within(control, viewport);
      }
      await openTopMenu(page);
      await page.getByTestId("menu-map-credits").click();
      await expect(page.getByTestId("map-credits-text")).toBeVisible();
      // Focus moves into the credits (their first link), so a keyboard is where the card opened.
      await expect.poll(() => page.evaluate(() => !!document.querySelector("[data-testid=map-credits-text]")?.contains(document.activeElement)))
        .toBe(true);
    });
  });
}

test.describe("Task 11: a 1024 × 600 tablet keeps the desktop layout", () => {
  test.use({ viewport: { width: 1024, height: 600 } });

  test("zoom buttons, ⓘ and the hint row stay", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    await expect(page.getByTestId("zoom-in")).toBeVisible();
    await expect(page.getByTestId("map-attribution-toggle")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Search", exact: true })).toHaveAttribute("placeholder", "Search");
  });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  test.describe(`Task 14: the right panel from the top at ${viewport.width}`, () => {
    test.use({ viewport });

    test("panel top-aligned with the search pill; the stack 12px left of it, never under it", async ({ page }) => {
      await page.goto(AREA);
      await mapReady(page);
      const dock = await box(page.getByTestId("map-dock"));
      const pill = await box(page.getByTestId("top-bar-pill"));
      expect(dock.y).toBeCloseTo(pill.y, 0);
      expect(viewport.height - (dock.y + dock.height)).toBeCloseTo(12, 0);
      const match = await box(page.getByTestId("find-my-area"));
      expect(match.y).toBeCloseTo(dock.y, 0);
      for (const id of ["find-my-area", "layers-toggle", "show-toggle"]) {
        const control = await box(page.getByTestId(id));
        expect(dock.x - (control.x + control.width), id).toBeCloseTo(12, 0);
      }
      expect(overlaps(pill, match)).toBe(false);
      // Folded: the stack goes back to the strip's edge, under the bar.
      await page.getByTestId("evidence-sheet-close").click();
      await expect(page.getByTestId("evidence-sheet-reopen")).toBeVisible();
      const folded = await box(page.getByTestId("map-dock"));
      const stack = await box(page.getByTestId("find-my-area"));
      expect(overlaps(stack, folded)).toBe(false);
      expect(stack.y).toBeGreaterThanOrEqual(pill.y + pill.height);
    });
  });
}

test.describe("Task 15: a map click only selects", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Map controls PR 1: a double click zooms in a step everywhere (as Google); the first click still selects.
  test("a click selects and never moves the camera; a double click zooms in; no box zoom", async ({ page }) => {
    await page.goto(`/?diagnostics=1&lat=51.5&lng=-0.12&zoom=14`);
    await mapReady(page);
    await expect.poll(() => page.evaluate(() => typeof window.__closeKnitCamera)).toBe("function");
    const before = await page.evaluate(() => window.__closeKnitCamera!());
    expect(before.doubleClickZoom).toBe(true);
    expect(before.boxZoom).toBe(false);
    const canvas = page.locator(".maplibregl-canvas").first();
    const frame = await box(canvas);
    await page.mouse.click(frame.x + frame.width * 0.35, frame.y + frame.height * 0.5);
    await expect(page.getByTestId("map-dock")).not.toHaveAttribute("data-area", "empty");
    await expectSteady(async () => {
      const clicked = await page.evaluate(() => window.__closeKnitCamera!());
      expect(clicked.zoom).toBeCloseTo(before.zoom, 5);
      expect(clicked.lng).toBeCloseTo(before.lng, 6);
      expect(clicked.lat).toBeCloseTo(before.lat, 6);
    }, 600);
    await page.mouse.dblclick(frame.x + frame.width * 0.3, frame.y + frame.height * 0.55);
    await expect.poll(() => page.evaluate(() => window.__closeKnitCamera!().zoom)).toBeCloseTo(before.zoom + 1, 1);
    expect(await canvas.evaluate((node) => (node as HTMLElement).style.cursor)).not.toBe("zoom-in");
  });
});

test.describe("Task 19: Show › Recent sales options fit the panel", () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`nothing runs past the panel edge at ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(REAL_PRICE);
      const show = await openShowPanel(page);
      await page.getByTestId("sales-toggle").check();
      const panel = page.getByTestId("sales-panel");
      await expect(panel).toBeVisible();
      const edge = await box(show);
      const overflowing = await panel.evaluate((node, right) => [...node.querySelectorAll<HTMLElement>("button, input, span, i")]
        .filter((element) => element.getClientRects().length > 0 && !element.closest(".sr-only"))
        .filter((element) => element.getBoundingClientRect().right > right + 1)
        .map((element) => element.textContent), edge.x + edge.width);
      expect(overflowing).toEqual([]);
      // Small labels on their own lines, three key labels and "No data".
      await expect(panel.getByTestId("sales-colour-by").getByRole("button", { name: "Growth" })).toBeVisible();
      await expect(panel.getByTestId("sales-legend").locator(".show-sub__key-labels > span")).toHaveCount(3);
      await expect(panel.getByTestId("sales-legend")).toContainText("No data");
      // The licence and method sit behind ⓘ; the panel keeps one muted line.
      await expect(panel).not.toContainText("Crown copyright");
      await page.getByTestId("sales-about-toggle").click();
      await expect(page.getByTestId("sales-about")).toContainText("Crown copyright");
    });
  }

  test("chip lists with All · None; Default resets them", async ({ page }) => {
    await page.goto(REAL_PRICE);
    await openShowPanel(page);
    await page.getByTestId("sales-toggle").check();
    const tenure = page.getByTestId("sales-tenure");
    await tenure.getByRole("button", { name: "Leasehold", exact: true }).click();
    await expect(tenure.getByRole("button", { name: "Leasehold", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(tenure.getByRole("button", { name: "Freehold", exact: true })).toHaveAttribute("aria-pressed", "true");
    await tenure.getByRole("button", { name: "Tenure: none" }).click();
    await expect(page.getByTestId("map-toast")).toContainText("Pick at least one");
    await tenure.getByRole("button", { name: "Tenure: all" }).click();
    await expect(tenure.getByRole("button", { name: "Leasehold", exact: true })).toHaveAttribute("aria-pressed", "true");
    const years = page.getByTestId("sales-years");
    await years.getByRole("button", { name: "Earlier", exact: true }).click();
    await expect(years.getByRole("button", { name: "Earlier", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("show-default").click();
    await expect(page.getByTestId("sales-toggle")).not.toBeChecked();
  });
});

test.describe("Task 33: keyboard and screen reader", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Enter on the focused map chooses the area in the middle", async ({ page }) => {
    await page.goto("/?lat=51.5&lng=-0.12&zoom=13");
    await mapReady(page);
    await expect(page.getByTestId("map-dock")).toHaveAttribute("data-area", "empty");
    // Retried: the area shapes paint a moment after "Map ready", and Enter needs one under the middle.
    await expect(async () => {
      await page.locator(".maplibregl-canvas").first().focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("map-dock")).toHaveAttribute("data-area", "area", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
  });

  test("Show's name says how many are on; never 'Show2'", async ({ page }) => {
    await page.goto(AREA);
    const show = page.getByTestId("show-toggle");
    const name = await show.evaluate((node) => node.querySelector(".sr-only")?.textContent);
    expect(name).toMatch(/^Show(, \d+ on)?$/);
    await expect(page.getByRole("button", { name: /^Show\d/ })).toHaveCount(0);
  });

  test("Looks wrong is a disclosure and its form takes focus", async ({ page }) => {
    await page.goto("/area/lsoa/E01000001");
    const safety = page.getByTestId("evidence-section-safety");
    const open = safety.getByTestId("correction-report-open");
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await open.click();
    await expect(safety.getByRole("heading", { name: "Report a figure" })).toBeFocused();
    await expect(safety.getByRole("group", { name: "Who got it wrong?" })).toBeVisible();
  });

  test("the area sheet's tiles and breadcrumbs and the area page's chips are 44px targets", async ({ page }) => {
    await page.goto(AREA);
    // v4 Task 12: no "Details ›" links; each tile is the link to its section, the wider areas are buttons.
    const tile = page.locator(".dock-area .standout-tile").first();
    await expect(tile).toBeVisible({ timeout: 15_000 });
    expect((await box(tile)).height).toBeGreaterThanOrEqual(44);
    // PR #144 (v4.6 CUJ14 r3): the desktop panel's crumbs are one line, each 32px tall to tap (layout.css). The panel
    // layout follows the width (min-width: 801px), not the device: this block's 1440px viewport has it on a phone
    // profile too; the phone sheet's crumbs stay 44px.
    const crumb = (page.viewportSize()?.width ?? 0) > 800 ? 32 : 44;
    expect((await box(page.locator(".dock-area .area-brief__parent").first())).height).toBeGreaterThanOrEqual(crumb);
    await page.goto("/area/lsoa/E01000001");
    const chip = page.locator(".area-tabs a").first();
    expect((await box(chip)).height).toBeGreaterThanOrEqual(44);
  });
});
