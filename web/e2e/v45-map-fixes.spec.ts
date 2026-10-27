import { expect, test, type Locator, type Page } from "./fixtures";

// v4.5 map fixes from check round 2: Task 2 (which layer is on), Task 29 (street zoom floods solid red).

const AREA = "/?selected=uk%3Alsoa%3AE01000001";

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  expect(found, "on screen").toBeTruthy();
  return found!;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
}

/** Whether a node's text is cut (an ellipsis or hidden overflow). */
function cut(locator: Locator) {
  return locator.evaluate((node) => node.scrollWidth > node.clientWidth + 1 || getComputedStyle(node).textOverflow === "ellipsis");
}

async function mapReady(page: Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
}

test.describe("Task 2 on a phone: the pill names the layer and its view", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Price per m² · Actual, then Noise · Road and rail", async ({ page }) => {
    await page.goto(`${AREA}&layer=price-per-square-metre`);
    const pill = page.getByTestId("layer-pill");
    // PR #284: Price per m² opens on its London rank.
    await expect(pill).toHaveText("Layer: Price per m² · Rank in London");
    await page.goto(`${AREA}&layer=noise`);
    await expect(pill).toHaveText("Layer: Noise · Road and rail");
    expect(await cut(pill.locator(".layer-pill__name"))).toBe(false);
  });

  test("a first visit keeps the pill in view: the intro card sits under it", async ({ page }) => {
    await page.goto("/");
    const intro = page.locator(".first-visit-intro");
    await expect(intro).toBeVisible();
    const pill = page.getByTestId("layer-pill");
    await expect(pill).toBeVisible();
    // PR #284: Price per m² opens on its London rank.
    await expect(pill).toContainText("Price per m² · Rank in London");
    expect(overlaps(await box(pill), await box(intro))).toBe(false);
  });

  test("My match's legend ends wrap, never cut", async ({ page }) => {
    await page.goto("/?find=budget&price=570000");
    const ends = page.getByTestId("legend-chip").locator("[data-testid='legend-match'] span[data-edge]");
    await expect(ends.first()).toBeVisible({ timeout: 30_000 });
    await expect(ends).toHaveText(["Least like your search", "Best match"]);
    for (const end of await ends.all()) expect(await cut(end)).toBe(false);
  });
});

test.describe("Task 2 on a desktop: the legend names the layer", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ["day", "night"] as const) {
    test(`Noise reads Noise first (${theme})`, async ({ page }) => {
      await page.addInitScript((value) => window.localStorage.setItem("close-knit.ui-theme", value), theme);
      await page.goto("/?layer=noise");
      const caption = page.getByTestId("legend-chip").getByTestId("legend-caption");
      await expect(caption).toHaveText(/^Noise · % of homes at 55 dB or more · /);
      await expect(caption.getByTestId("legend-layer-name")).toHaveText("Noise");
      expect(await cut(caption)).toBe(false);
    });
  }

  test("Price keeps its one name", async ({ page }) => {
    await page.goto("/?layer=price-per-square-metre");
    await expect(page.getByTestId("legend-chip").getByTestId("legend-caption")).toHaveText(/^Price per m² · [A-Z][a-z]{2} \d{4}$/);
  });
});

test.describe("Task 2 on a phone on its side: the legend's layer name is never cut", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("Price per m² in full, the date in the chip's name only", async ({ page }) => {
    await page.goto("/?layer=price-per-square-metre");
    await mapReady(page);
    const chip = page.getByTestId("legend-chip");
    const name = chip.getByTestId("legend-layer-name");
    await expect(name).toHaveText("Price per m²");
    await expect(name).toBeVisible();
    expect(await cut(chip.getByTestId("legend-caption"))).toBe(false);
    expect(await cut(name)).toBe(false);
    await expect(chip).toHaveAccessibleName(/Price per m² · [A-Z][a-z]{2} \d{4}/);
    expect((await box(page.locator(".map-key__row"))).width).toBeLessThanOrEqual(844 / 2 + 0.5);
  });
});

test.describe("Task 29: street blocks step back to a tint", () => {
  test("the block fill is a zoom curve down to 40%, with an edge in the block's colour", async ({ page }) => {
    await page.goto("/?diagnostics=1&layer=price-per-square-metre&zoom=14&lat=51.501&lng=-0.1416");
    await mapReady(page);
    const paint = async (layer: string, property: string) => JSON.stringify(await page.evaluate(([id, name]) =>
      window.__closeKnitDiagnostics?.paintProperty(id, name) ?? null, [layer, property]));
    await expect.poll(() => paint("block-fill", "fill-opacity"), { timeout: 30_000 }).toContain('"interpolate"');
    expect(await paint("block-fill", "fill-opacity")).toContain("0.4");
    expect(await paint("block-outline", "line-color")).toBe(await paint("block-fill", "fill-color"));
  });
});
