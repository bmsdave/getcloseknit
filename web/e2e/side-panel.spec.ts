import { expect, test, type Page } from "./fixtures";

// The desktop side panel (map-dock.tsx, lib/panel-width.ts): wider by default, resized by its left edge,
// remembered per browser; the Price block lays out by the panel's width; a school opens in the panel.

const AREA = "/?selected=uk%3Alsoa%3AE01000002&period=2026-06";
const KEY = "close-knit.panel-width.v1";
const dockWidth = (page: Page) => page.getByTestId("map-dock").evaluate((node) => Math.round(node.getBoundingClientRect().width));

test.describe("desktop", () => {
  test.skip(({ isMobile }) => isMobile, "phones keep the bottom sheet");

  test("drag the panel's edge: it resizes, the width survives a reload, keys step it and a double-click resets", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(AREA);
    const handle = page.getByTestId("panel-resize");
    await expect(handle).toBeVisible({ timeout: 30_000 });
    expect(await dockWidth(page)).toBe(460);
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => dockWidth(page)).toBe(600);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("600");

    // A reload paints at the stored width (the boot script sets it before the map's markup).
    await page.reload();
    await expect(page.getByTestId("map-dock")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--dock-w"))).toBe("600px");
    expect(await dockWidth(page)).toBe(600);

    // Keyboard: ← widens, → narrows, Home is the minimum; the separator reports its value.
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => dockWidth(page)).toBe(584);
    await expect(handle).toHaveAttribute("aria-valuenow", "584");
    await page.keyboard.press("Home");
    await expect.poll(() => dockWidth(page)).toBe(360);
    // Never wider than the max, nor so wide the map has no room.
    await page.keyboard.press("End");
    await expect.poll(() => dockWidth(page)).toBe(760);
    // A double-click goes back to the default and forgets the width.
    await handle.dblclick();
    await expect.poll(() => dockWidth(page)).toBe(460);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  });

  test("a narrow window caps the panel so the map keeps its room", async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "760"), KEY);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(AREA);
    await expect(page.getByTestId("map-dock")).toBeVisible({ timeout: 30_000 });
    expect(await dockWidth(page)).toBe(1024 - 420);
  });

  for (const [width, columns] of [[360, 2], [760, 4]] as const) {
    test(`Price by type at a ${width}px panel: ${columns} across, every type a button that charts its line`, async ({ page }) => {
      await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [KEY, String(width)]);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(AREA);
      const types = page.getByTestId("price-types");
      await types.scrollIntoViewIfNeeded({ timeout: 30_000 });
      const cards = types.locator("[data-testid^=price-type-]");
      await expect(cards).toHaveCount(4);
      const tops = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(4 / columns);
      // Nothing in a card is cut or runs past it.
      const overflow = await cards.evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).length);
      expect(overflow).toBe(0);
      // Every type has the same affordance (a button, never dimmed) and puts its line on the chart; again: back to all homes.
      const chart = page.getByTestId("market-trend-price");
      for (const code of ["F", "T", "S", "D"]) {
        const button = types.getByTestId(`price-type-${code}`).getByRole("button");
        expect(await button.evaluate((node) => getComputedStyle(node.closest("li")!).opacity)).toBe("1");
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect(types.locator("[aria-pressed=true]")).toHaveCount(1);
        await expect(chart).toBeAttached();
      }
      await types.getByTestId("price-type-D").getByRole("button").click();
      await expect(types.locator("[aria-pressed=true]")).toHaveCount(0);
    });
  }
});

// A school: its cap opens the school page's sections in the panel instead of the area; ‹ Back returns.
const PRIMARY = { lng: -0.139, lat: 51.503 };

async function capPoint(page: Page) {
  const canvas = await page.locator(".maplibregl-canvas").boundingBox();
  const point = await page.evaluate((lngLat) => window.__closeKnitDiagnostics.project(lngLat), [PRIMARY.lng, PRIMARY.lat] as [number, number]);
  return { x: (canvas?.x ?? 0) + point.x, y: (canvas?.y ?? 0) + point.y };
}

test("a school's cap opens its page sections in the panel; Back returns to the area; the address keeps it", async ({ page, isMobile }) => {
  await page.goto(`/?lat=${PRIMARY.lat}&lng=${PRIMARY.lng}&zoom=15&schools=on&stations=off&diagnostics=1`);
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.layerIds().includes("school-points") ?? false)).toBe(true);
  // Choose the area beside the school first.
  const cap = await capPoint(page);
  await page.mouse.click(cap.x - 150, cap.y + 120);
  await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toMatch(/^uk:/);
  const area = new URL(page.url()).searchParams.get("selected");
  await expect(page.getByTestId("evidence-panel")).toBeAttached();
  // A phone's area sheet rises to its half over the middle of the map, where the cap is: lower it to its peek.
  if (isMobile) {
    await page.getByTestId("sheet-handle").click();
    await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "collapsed");
  }

  const panel = page.getByTestId("school-panel");
  await expect(async () => {
    const at = await capPoint(page);
    await page.mouse.click(at.x, at.y);
    await expect(panel).toBeAttached({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(panel).toHaveAttribute("data-urn", "100001");
  const sections = panel.getByTestId("school-section");
  await expect(panel.locator('[data-testid="school-section"][data-section="inspections"]')).toBeAttached({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="school-section"][data-section="results"]')).toBeAttached();
  expect(await sections.count()).toBeGreaterThan(3);
  await expect(page.getByTestId("evidence-panel")).toHaveCount(0);
  await expect(panel.getByTestId("school-panel-page")).toHaveAttribute("href", `/school/100001?from=${encodeURIComponent(area!)}`);
  await expect.poll(() => new URL(page.url()).searchParams.get("school")).toBe("100001");
  expect(new URL(page.url()).searchParams.get("selected")).toBe(area);

  // A reload (or a shared link) opens the school in the panel again.
  await page.reload();
  await expect(panel.locator('[data-testid="school-section"][data-section="inspections"]')).toBeAttached({ timeout: 30_000 });

  await panel.getByTestId("school-panel-back").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("evidence-panel")).toBeAttached();
  await expect.poll(() => new URL(page.url()).searchParams.get("school")).toBeNull();
  expect(new URL(page.url()).searchParams.get("selected")).toBe(area);
});
