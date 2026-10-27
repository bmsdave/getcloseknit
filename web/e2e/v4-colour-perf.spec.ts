import { expect, type Page, test } from "./fixtures";

import { openMapSettings } from "./top-bar";

// v4.2 track colour-perf: Task 43 (colour-blind-safe default), Task 29 (night controls), Task 32 (loading state).

async function openColours(page: Page) {
  await openMapSettings(page);
  if (!(await page.getByTestId("appearance-menu").isVisible())) await page.getByTestId("appearance-toggle").click();
  return page.getByTestId("appearance-menu");
}

test("Task 43: a first visit paints the colour-blind-safe palette, listed first", async ({ page }) => {
  await page.goto("/");
  const bar = page.getByTestId("map-legend").locator(".map-legend-bar");
  await expect(bar).toHaveAttribute("data-colours", /^#2166ac .* #b2182b$/);
  const colours = await openColours(page);
  const first = colours.getByRole("button").first();
  await expect(first).toContainText("Colour-blind safe");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(colours.getByRole("button", { name: "Traffic light" })).toHaveAttribute("aria-pressed", "false");
});

test("Task 43: a visitor who chose the traffic light keeps it", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("close-knit.palette", "current"));
  await page.goto("/");
  await expect(page.getByTestId("map-legend").locator(".map-legend-bar")).toHaveAttribute("data-colours", /^#1a9850 .* #d73027$/);
});

test("Task 29: by Night the round map controls stand off the navy map", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("close-knit.ui-theme", "night"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "night");
  const layers = page.getByTestId("layers-toggle");
  await expect(layers).toBeVisible();
  const look = await layers.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, shadow: style.boxShadow };
  });
  // Lifted navy (#4a5c8f; round 2: #34436a still barely stood out), not the panel navy (#1b2540) that vanished on
  // the #16203a basemap, with a 2px light rim.
  expect(look.background).toBe("rgb(74, 92, 143)");
  expect(look.shadow).toContain("rgba(244, 247, 250, 0.62) 0px 0px 0px 2px");
});

test("Task 32: while the colours load a Loading map pill shows, and goes once they are painted", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/value-packs/**", async (route) => { await held; await route.fallback(); });
  await page.goto("/");
  const stage = page.locator(".map-stage");
  await expect(stage).toHaveAttribute("data-painting", "true");
  const pill = page.getByTestId("map-loading");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText("Loading map");
  await expect(pill).toHaveAttribute("aria-hidden", "true");
  release();
  await expect(stage).toHaveAttribute("data-painting", "false");
  await expect(pill).toBeHidden();
});
