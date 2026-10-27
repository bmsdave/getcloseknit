import { expect, test, type Page } from "./fixtures";

import { chooseLayer, openScaleSettings } from "./evidence";
import { menuToggle, openMapSettings, openTopMenu, showTimeline } from "./top-bar";

// docs/superpowers/specs/2026-10-05-two-block-layout-design.md: two blocks
// sit over the map — the top bar and the area dock — at any width, plus the map's
// own controls as in Google or Apple Maps: the Layers button and the legend chip
// (map-layers.tsx). Every layer and comparison is chosen in the Layers card
// (layers-panel.spec.ts).
const viewports = [
  { name: "1440", size: { width: 1440, height: 900 } },
  { name: "1280", size: { width: 1280, height: 720 } },
  { name: "375", size: { width: 375, height: 812 } },
] as const;

/** Everything painted over the map: fixed or absolute boxes inside the
 * viewport that are not the map itself, named by their block. */
async function overlays(page: Page) {
  return page.evaluate(() => {
    const inViewport = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight
        && getComputedStyle(el).visibility !== "hidden";
    };
    const stage = document.querySelector(".map-stage");
    const found: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const position = getComputedStyle(el).position;
      if (position !== "fixed" && position !== "absolute") continue;
      if (!inViewport(el)) continue;
      if (el === stage || el.closest(".map-canvas")) continue;
      // Parts of a block are the block.
      const block = el.closest("[data-block]");
      if (block && block !== el) continue;
      found.push(block?.getAttribute("data-block") ?? `${el.tagName.toLowerCase()}.${el.className}`);
    }
    return found;
  });
}

async function mapReady(page: Page) {
  await expect(page.locator(".map-status")).toHaveText("Map ready");
}

for (const { name, size } of viewports) {
  test(`two blocks and the map's controls sit over the map at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/?selected=uk%3Alsoa%3AE01000001");
    await mapReady(page);
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

    expect((await overlays(page)).sort()).toEqual(["map-controls", "map-dock", "top-bar"]);
    for (const gone of [".maplibregl-ctrl-group", ".pitch-controls", "[data-testid='map-only-toggle']", ".map-toolbar", ".layer-picker", ".explore-chips"]) {
      await expect(page.locator(gone), gone).toHaveCount(0);
    }
    // "Map ready" stays for screen readers only.
    await expect(page.locator(".map-status")).toHaveClass(/sr-only/);
    // The period slider lives in the Layers card, not in the area dock nor a card of its own.
    await showTimeline(page);
    await expect(page.getByTestId("layers-panel").getByTestId("price-timeline")).toBeVisible();
    await expect(page.getByTestId("map-dock").getByTestId("price-timeline")).toHaveCount(0);

    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scroll, "no horizontal scroll").toBeLessThanOrEqual(0);
  });
}

test("the menu is a disclosure: Escape and outside click close it, focus returns", async ({ page }) => {
  await page.goto("/");
  await mapReady(page);
  const toggle = menuToggle(page);
  const menu = page.getByTestId("top-menu");

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // Menu v5: Rankings is a top-level link; Privacy · Terms · Feedback always at the foot.
  await expect(menu.getByRole("link", { name: "Rankings" })).toHaveAttribute("href", "/rankings");
  await expect(menu.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(menu.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  // An open fold is not a disclosure to close first: Escape closes the menu.
  await menu.getByRole("link", { name: "Rankings" }).focus();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  await expect(menu).toBeVisible();
  await page.getByRole("combobox", { name: "Search", exact: true }).click();
  await expect(menu).toBeHidden();
});

test("map settings change the theme and the map tilt; the data mode is dev-only", async ({ page }) => {
  await page.goto("/");
  await mapReady(page);
  const explorer = page.getByTestId("close-knit");

  // No internals for visitors: no data mode switch, no release id.
  await openTopMenu(page);
  await expect(page.getByTestId("data-mode-selector")).toHaveCount(0);
  await expect(page.getByTestId("map-dock")).not.toContainText("preview-2026-09");
  await page.keyboard.press("Escape");

  await openMapSettings(page);
  await page.getByTestId("top-menu").getByRole("group", { name: "Theme" }).getByRole("button", { name: "Night" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "night");
  await page.getByTestId("appearance-toggle").click();
  await expect(page.getByTestId("appearance-menu")).toBeVisible();
  // Escape folds Colours first, then Map settings.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("appearance-menu")).toBeHidden();
  await expect(page.getByTestId("map-settings")).toBeVisible();

  await page.getByRole("button", { name: "Flatten map" }).click();
  await expect(explorer).toHaveAttribute("data-map-pitch", "0");
  await expect.poll(() => new URL(page.url()).searchParams.get("pitch")).toBe("0");
  await page.getByRole("button", { name: "Tilt map" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("pitch")).toBe("45");
  await expect(page.getByRole("button", { name: "Tilt map" })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-settings")).toBeHidden();

  await page.goto("/?dev=1");
  await openTopMenu(page);
  await page.getByRole("radio", { name: /Real/ }).check();
  await expect(page.getByTestId("data-status")).toContainText("Real data");
  await expect(page.getByTestId("data-mode-release")).toContainText("Release");
});

test("the data selector and the crime checklist", async ({ page }) => {
  await page.goto("/");
  await mapReady(page);

  await showTimeline(page);
  await expect(page.getByTestId("layers-panel").getByTestId("price-timeline").getByLabel("Price period")).toBeVisible();
  await chooseLayer(page, "crime");
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("crime");
  await expect(page.getByTestId("price-timeline")).toHaveCount(0);

  const settings = await openScaleSettings(page);
  await expect(settings.getByTestId("crime-filter")).toBeVisible();
  const burglary = settings.getByRole("checkbox", { name: "Include burglary" });
  await burglary.uncheck();
  await settings.getByTestId("crime-all").click();
  await expect(burglary).toBeChecked();

  await burglary.focus();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(page.getByTestId("layers-toggle")).toBeFocused();
});

/** Phones start with nothing chosen at the sheet's peek; the footer waits for the open sheet. */
async function openEmptySheet(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) > 800) return;
  await page.getByTestId("evidence-sheet-reopen").click();
  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "half");
}

test("the map's ⓘ corner holds the credits, Sources & privacy and Terms, one keyboard step away", async ({ page }) => {
  await page.goto("/");
  await mapReady(page);
  const toggle = page.getByTestId("map-attribution-toggle");
  // On the map itself, with or without an area (v3 Fix 1): never in the area panel.
  await expect(page.getByTestId("map-dock").getByTestId("map-attribution-toggle")).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const text = page.getByTestId("map-credits-text");
  await expect(text).toBeVisible();
  await expect(text.locator(".maplibregl-ctrl-attrib")).toContainText("MapLibre");
  await expect(text.getByRole("link", { name: "Sources & privacy" })).toHaveAttribute("href", "/privacy");
  await expect(text.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  await page.keyboard.press("Escape");
  await expect(text).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("keyboard reaches every part of both blocks and the map's controls", async ({ page }) => {
  await page.goto("/");
  await mapReady(page);
  // Past the first visit: the round My match button.
  await page.getByTestId("intro-dismiss").click();
  await openEmptySheet(page);
  const tabThrough = async (count: number) => {
    const reached = new Set<string>();
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press("Tab");
      reached.add(await page.evaluate(() => {
        const el = document.activeElement;
        return el?.getAttribute("data-testid") ?? el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? "";
      }));
    }
    return [...reached];
  };
  await page.getByTestId("top-menu-toggle").focus();
  const closed = await tabThrough(16);
  // ≡ leads the pill; the legend's "?" and the map's ⓘ follow the round buttons.
  for (const id of ["find-my-area", "layers-toggle", "show-toggle", "locate-me", "legend-chip", "legend-explain", "map-attribution-toggle"]) {
    expect(closed, id).toContain(id);
  }
  // The menu's search, None, then Price per m²'s views and its period.
  await showTimeline(page);
  await page.getByTestId("topic-search").focus();
  const open = await tabThrough(12);
  for (const id of ["layer-none", "topic-group-cost", "layer-price-per-square-metre", "Play timeline", "Price period"]) expect(open, id).toContain(id);
});

test.describe("desktop dock", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the 44px strip is the desktop collapse");
  });

  test("the dock collapses to a 44px strip and expands again", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?selected=uk%3Alsoa%3AE01000001");
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
    const dock = page.getByTestId("map-dock");
    // PR #343: the side panel opens 460px wide by default (its left edge resizes it).
    expect((await dock.boundingBox())?.width).toBe(460);

    await page.getByRole("button", { name: "Hide panel" }).click();
    await expect(dock).toHaveAttribute("data-expanded", "false");
    expect((await dock.boundingBox())?.width).toBe(44);
    await expect(page.getByTestId("evidence-panel")).toBeHidden();
    // The strip keeps the attribution and names what it would show.
    await expect(page.getByTestId("map-attribution-toggle")).toBeVisible();
    const reopen = page.getByTestId("evidence-sheet-reopen");
    await expect(reopen).toContainText("St James's · SW1A");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    await reopen.click();
    await expect(dock).toHaveAttribute("data-expanded", "true");
    expect((await dock.boundingBox())?.width).toBe(460);
    await expect(page.getByTestId("selected-area")).toBeVisible();
  });
});

test.describe("phone sheet", () => {
  test.use({ hasTouch: true });

  test("collapsed, the sheet is a peek: the grabber over the area row, 80px at most, the map's controls above it", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?selected=uk%3Alsoa%3AE01000001");
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
    const dock = page.getByTestId("map-dock");

    await page.getByTestId("evidence-sheet-close").click();
    await expect(dock).toHaveAttribute("data-expanded", "false");
    // The sheet holds the area only; Sources & privacy is in the ≡ menu.
    await expect(dock.getByTestId("layers-toggle")).toHaveCount(0);
    await expect(dock.getByTestId("map-legend")).toHaveCount(0);
    await expect(dock.getByTestId("sources-privacy-link")).toBeHidden();
    const row = page.getByTestId("evidence-sheet-reopen");
    await expect(row).toContainText("St James's · SW1A ·");
    await expect(row).toContainText("/m²");
    await expect(row).not.toContainText("£/m²");
    const box = await dock.boundingBox();
    expect(box?.height ?? 812, "the peek is 80px or less").toBeLessThanOrEqual(80);
    // My location (under the round buttons) and the chip ride just above the peek (measured once the sheet has settled).
    await expect.poll(() => dock.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
    const peek = await dock.boundingBox();
    for (const id of ["locate-me", "legend-chip"]) {
      await expect.poll(async () => {
        const control = await page.getByTestId(id).boundingBox();
        return (peek?.y ?? 0) - (control?.y ?? 0) - (control?.height ?? 0);
      }, id).toBe(12);
    }

    await row.tap();
    await expect(dock).toHaveAttribute("data-expanded", "true");
    await expect(page.getByTestId("selected-area")).toBeVisible();
  });
});

test("fit on load keeps the selected area clear of the dock", async ({ page }, testInfo) => {
  // A selected link without a map position opens fitted to that area, padded
  // for the dock: the area's centre sits left of the map centre beside the
  // desktop panel, and above it over the phone sheet. North London preview
  // spans lng -0.123..-0.068, lat 51.523..51.57 (e2e/selected-area-fit.spec.ts).
  await page.goto("/?selected=uk%3Amsoa%3AE02000002&period=2026-06");
  await expect(page.getByTestId("selected-area")).toContainText("Highbury · N5");
  await expect.poll(() => new URL(page.url()).searchParams.get("lat"), { timeout: 30_000 }).not.toBeNull();
  const parameters = new URL(page.url()).searchParams;
  const centre = { lat: Number(parameters.get("lat")), lng: Number(parameters.get("lng")) };
  if (testInfo.project.name === "desktop") expect(centre.lng).toBeGreaterThan((-0.123 + -0.068) / 2);
  else expect(centre.lat).toBeLessThan((51.523 + 51.57) / 2);
});
