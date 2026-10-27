import { expect, test, type Page } from "./fixtures";

import { openLayersPanel } from "./evidence";
import { openShowPanel } from "./top-bar";

// v4 Task 18: everything set on the map is saved on this device and comes back on every return;
// a link's own params win for what they set (URL > saved > default); Show and Layers have Default
// with Undo; Privacy › Clear my data forgets it.

async function setUp(page: Page) {
  await page.goto("/");
  const layers = await openLayersPanel(page);
  await layers.getByTestId("topic-group-safety").click();
  await layers.getByTestId("layer-crime").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  const show = await openShowPanel(page);
  await show.getByTestId("schools-toggle").check();
  await show.getByTestId("cycle-lanes-toggle").check();
  await show.getByTestId("stations-toggle").uncheck();
  await show.getByTestId("collisions-toggle").check();
  await show.getByTestId("collision-severity-3").getByRole("checkbox").uncheck();
  await page.getByTestId("layers-close").click();
  // Saved on change: the address the map writes is the setup saved.
  await expect(page).toHaveURL(/cycle=on/);
  await expect(page).toHaveURL(/collisions=/);
}

async function expectSetUp(page: Page) {
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  const show = await openShowPanel(page);
  await expect(show.getByTestId("schools-toggle")).toBeChecked();
  await expect(show.getByTestId("cycle-lanes-toggle")).toBeChecked();
  await expect(show.getByTestId("stations-toggle")).not.toBeChecked();
  await expect(show.getByTestId("collisions-toggle")).toBeChecked();
  await expect(show.getByTestId("collision-severity-3").getByRole("checkbox")).not.toBeChecked();
  await expect(show.getByTestId("collision-severity-2").getByRole("checkbox")).toBeChecked();
  return show;
}

test("set filters, open another page, come back to a bare / : the same setup", async ({ page }) => {
  await setUp(page);
  await page.goto("/privacy");
  await page.goto("/");
  await expectSetUp(page);
});

test("a link's params win only for what they set", async ({ page }) => {
  await setUp(page);
  await page.goto("/?layer=income");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "income");
  const show = await openShowPanel(page);
  await expect(show.getByTestId("schools-toggle")).toBeChecked();
  await expect(show.getByTestId("cycle-lanes-toggle")).toBeChecked();
  await page.goto("/?schools=off&cycle=off");
  const again = await openShowPanel(page);
  await expect(again.getByTestId("cycle-lanes-toggle")).not.toBeChecked();
  // The merged setup is saved again: the next return keeps the linked layer.
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "income");
});

test("Show › Default puts back Local places and Stations; Undo restores the setup exactly", async ({ page }) => {
  await setUp(page);
  const show = await openShowPanel(page);
  const reset = show.getByTestId("show-default");
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(show.getByTestId("places-toggle")).toBeChecked();
  await expect(show.getByTestId("stations-toggle")).toBeChecked();
  for (const id of ["schools-toggle", "cycle-lanes-toggle", "collisions-toggle", "street-trees-toggle"]) await expect(show.getByTestId(id)).not.toBeChecked();
  await expect(reset).toBeDisabled();
  await expect(page.getByTestId("map-toast-text")).toHaveText("Reset to default");
  await page.getByTestId("map-toast-action").click();
  await expect(page.getByTestId("map-toast")).toHaveCount(0);
  await expectSetUp(page);
  // Layers is its own sheet: Show's Default left the layer alone.
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
});

test("Layers › Default puts back Price per m² · Rank · latest; Undo brings Crime back", async ({ page }) => {
  await setUp(page);
  const layers = await openLayersPanel(page);
  await layers.getByTestId("layers-default").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "price-per-square-metre");
  await expect(layers.getByTestId("layers-default")).toBeDisabled();
  await page.getByTestId("map-toast-action").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
});

test("Privacy › Clear my data forgets the setup", async ({ page }) => {
  await setUp(page);
  await page.goto("/privacy");
  // Retried: a click before hydration lands on a button without a handler.
  await expect(async () => {
    await page.getByTestId("clear-device-data-button").click();
    await expect(page.getByTestId("clear-device-data")).toContainText("Cleared", { timeout: 1_000 });
  }).toPass();
  await page.goto("/");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "price-per-square-metre");
  const show = await openShowPanel(page);
  await expect(show.getByTestId("show-default")).toBeDisabled();
});

test("the camera comes back too", async ({ page }) => {
  await page.goto("/?lat=51.47&lng=-0.05&zoom=13.5");
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
  await expect(page).toHaveURL(/zoom=13\.5/);
  await page.goto("/privacy");
  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
  await expect(page).toHaveURL(/lat=51\.47/);
  await expect(page).toHaveURL(/zoom=13\.5/);
});
