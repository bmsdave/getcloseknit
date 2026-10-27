import { expect, type Page, test } from "./fixtures";

import { openMapSettings } from "./top-bar";

// Map colours and the 2D/3D view are viewer settings: they survive a reload (F5) and a fresh visit.

async function openColours(page: Page) {
  await openMapSettings(page);
  if (!(await page.getByTestId("appearance-menu").isVisible())) await page.getByTestId("appearance-toggle").click();
  return page.getByTestId("appearance-menu");
}

test("Back to the map keeps the layer, zoom and area", async ({ page }) => {
  await page.goto("/?lat=51.515&lng=-0.09&zoom=12.6&layer=crime&selected=uk%3Alsoa%3AE01000001");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  // The map saves its view once the camera settles.
  await expect.poll(() => page.evaluate(() => new URLSearchParams(localStorage.getItem("close-knit.map-state.v2") ?? "").get("zoom"))).toBe("12.6");

  await page.goto("/guide");
  const back = page.getByRole("link", { name: "Back to the map", exact: true });
  await expect(back).toHaveAttribute("href", /layer=crime/);
  await back.click();
  await expect(page.getByTestId("close-knit")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("crime");
  const url = new URL(page.url());
  expect(url.searchParams.get("zoom")).toBe("12.6");
  expect(url.searchParams.get("selected")).toBe("uk:lsoa:E01000001");
});

test("the area page's Open on map keeps the layer and zoom", async ({ page }) => {
  await page.goto("/?lat=51.515&lng=-0.09&zoom=12.6&layer=crime&selected=uk%3Alsoa%3AE01000001");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect.poll(() => page.evaluate(() => new URLSearchParams(localStorage.getItem("close-knit.map-state.v2") ?? "").get("zoom"))).toBe("12.6");

  await page.getByTestId("open-area-page").first().click();
  await expect(page.getByTestId("area-full-page")).toBeVisible();
  const back = page.getByTestId("open-on-map");
  await expect(back).toHaveAttribute("href", /layer=crime/);
  await back.click();
  await expect(page.getByTestId("close-knit")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("crime");
  const url = new URL(page.url());
  expect(url.searchParams.get("zoom")).toBe("12.6");
  expect(url.searchParams.get("selected")).toBe("uk:lsoa:E01000001");
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toContainText("Crime");
});

test("the chosen map colours survive a reload", async ({ page }) => {
  await page.goto("/");
  const bar = page.getByTestId("map-legend").locator(".map-legend-bar");
  // Price is good-low: the default palette (colour-blind safe, v4 Task 43) paints it blue (cheaper) first.
  await expect(bar).toHaveAttribute("data-colours", /^#2166ac /);

  await (await openColours(page)).getByRole("button", { name: "Viridis" }).click();
  await expect(bar).toHaveAttribute("data-colours", /^#440154 /);

  await page.reload();
  await expect(bar).toHaveAttribute("data-colours", /^#440154 /);
  await expect((await openColours(page)).getByRole("button", { name: "Viridis" })).toHaveAttribute("aria-pressed", "true");

  // A fresh visit with no query keeps them too; a link's own ?palette= still wins.
  await page.goto("/");
  await expect(bar).toHaveAttribute("data-colours", /^#440154 /);
  await page.goto("/?palette=magma");
  await expect(bar).toHaveAttribute("data-colours", /^#fcfdbf /);
});

test("the chosen 2D/3D view survives a reload and a fresh visit", async ({ page }) => {
  const explorer = page.getByTestId("close-knit");
  await page.goto("/");
  // Places are on by default and read flat, at any width, until the viewer chooses.
  await expect(explorer).toHaveAttribute("data-map-pitch", "0");

  await openMapSettings(page);
  await page.getByRole("button", { name: "Tilt map" }).click();
  await expect(explorer).toHaveAttribute("data-map-pitch", "45");

  await page.reload();
  await expect(explorer).toHaveAttribute("data-map-pitch", "45");
  await expect.poll(() => new URL(page.url()).searchParams.get("pitch")).toBe("45");
  await page.goto("/");
  await expect(explorer).toHaveAttribute("data-map-pitch", "45");
  await expect.poll(() => new URL(page.url()).searchParams.get("pitch")).toBe("45");

  // A link's own pitch still wins over the remembered view.
  await page.goto("/?pitch=0");
  await expect(explorer).toHaveAttribute("data-map-pitch", "0");

  // Choosing 2D is remembered too.
  await openMapSettings(page);
  await page.getByRole("button", { name: "Flatten map" }).click();
  await page.goto("/?places=off");
  await expect(explorer).toHaveAttribute("data-map-pitch", "0");
});
