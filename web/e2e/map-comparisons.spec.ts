import { expect, test, type Page } from "./fixtures";

import { openLayersPanel, topicItem } from "./evidence";

// Ready-made comparisons (Specialty coffee, Gyms, …) live in "Colour the map by" with every other
// layer: one choice paints the map, from a cold visit and with no search. Picked there, it only
// recolours the map: the card stays open and the side panel stays as it was (no My match panel).

async function choose(page: Page, layer: string) {
  await (await topicItem(page, layer)).click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", layer);
  await expect(page.getByTestId("layers-panel")).toBeVisible();
}

test("a comparison picked in Layers paints the map and leaves the side panel as it was", async ({ page }) => {
  await page.goto("/?layer=crime");
  const explorer = page.getByTestId("close-knit");
  await expect(explorer).toHaveAttribute("data-active-metric", "crime");

  await choose(page, "custom:gyms");
  await expect(page).toHaveURL(/layer=custom%3Agyms/);
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Gyms");
  await expect(page.getByTestId("criterion-focus")).toHaveCount(0);

  // Another comparison switches; the card marks the one shown.
  await choose(page, "custom:nightlife");
  const panel = page.getByTestId("layers-panel");
  await expect(panel.getByTestId("layer-custom:nightlife")).toHaveAttribute("aria-current", "true");

  await choose(page, "custom:good-coffee");
  // The map key reads in places like the panel's ("0 … 3+"), never a re-capped "0.005+".
  await expect(page.getByTestId("map-legend")).not.toContainText("0.00");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByTestId("criterion-focus")).toHaveCount(0);
});

test("an area picked under a comparison keeps its key numbers beside the comparison's value", async ({ page }) => {
  await page.goto("/?layer=custom:gyms");
  const focus = page.getByTestId("criterion-focus");
  await expect(focus.getByRole("heading", { level: 1 })).toHaveText("Nearest gym or sports centre");
  await focus.getByTestId("criterion-top").getByRole("button").first().click();
  const picked = focus.getByTestId("criterion-selected");
  await expect(picked).toContainText(/gyms and sports centres/);
  // The same way to the area page as on any other layer.
  await expect(picked.getByTestId("open-area-page")).toHaveCount(1);
  await expect(picked.getByTestId("open-area-page")).toHaveAttribute("href", /^\/area\/lsoa\//);
  // The area sheet's peek (v4 Task 12): its verdict and first 4 tiles, each to the full page's section.
  const tiles = picked.getByTestId("area-tiles");
  await expect(tiles).toBeVisible();
  await expect(tiles.locator("li")).toHaveCount(4);
  await expect(tiles.getByTestId("area-tile-price")).toHaveAttribute("href", /^\/area\/lsoa\/[^#]+#price$/);
  await expect(tiles.getByTestId("area-tile-safety")).toBeVisible();
  await expect(picked).not.toContainText(/\d+\/10|Details ›/);
});

test("a shared comparison link opens on its group; with no layer before, the way back is My match", async ({ page }) => {
  await page.goto("/?layer=custom:good-coffee-kebab");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "custom:good-coffee-kebab");
  await expect(page.getByRole("button", { name: "← Back to My match" }).filter({ visible: true })).toBeVisible();
  const panel = await openLayersPanel(page);
  await expect(panel.getByTestId("topic-group-food-drink")).toContainText("Food & drink");
  // Layers v5: Coffee vs kebab is a view of Cafés.
  await expect(panel.getByTestId("layer-custom:good-coffee")).toHaveAttribute("aria-current", "true");
  await expect(panel.getByTestId("view-custom:good-coffee-vs-kebab")).toHaveAttribute("aria-pressed", "true");
});

test("Build your own sits in My criteria and paints what it builds", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  await panel.getByTestId("topic-group-my-criteria").click();
  await panel.getByTestId("topic-build-your-own").click();
  const builder = panel.getByTestId("criteria-builder");
  await expect(builder).toBeVisible();
  await builder.getByRole("button", { name: /Show/ }).first().click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", /^custom:/);
  await expect(panel).toBeVisible();
});

test("nothing floats between the top bar and the first-visit card any more", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".first-visit-intro")).toBeVisible();
  await expect(page.locator(".explore-chips")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
