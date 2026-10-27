import { expect, test } from "./fixtures";

import { openShowPanel } from "./top-bar";

const REAL_PRICE = "/?mode=real&release=official-2026-06&layer=price-per-square-metre&zoom=15";

test("individual sales are offered on house-level layers in Real mode only", async ({ page }) => {
  // "Recent sales" is a checkbox in Show, usable where sales apply.
  await page.goto("/?layer=price-per-square-metre");
  await expect(page.getByTestId("close-knit")).toBeVisible();
  await openShowPanel(page);
  await expect(page.getByTestId("sales-toggle")).toBeDisabled();
  await expect(page.getByTestId("map-overlays")).toContainText("Over Price per m², with real data");

  await page.goto(REAL_PRICE);
  await openShowPanel(page);
  await expect(page.getByTestId("sales-toggle")).toBeEnabled();
  await expect(page.getByTestId("sales-toggle")).not.toBeChecked();
  await page.goto("/?mode=real&release=official-2026-06&layer=crime");
  await expect(page.getByTestId("close-knit")).toBeVisible();
  await openShowPanel(page);
  await expect(page.getByTestId("sales-toggle")).toBeDisabled();
});

test("the sales panel switches colour modes, growth horizons and filters", async ({ page }) => {
  const tiles: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/tiles/sales/")) tiles.push(request.url());
  });
  await page.goto(REAL_PRICE);
  await openShowPanel(page);
  await page.getByTestId("sales-toggle").check();
  const panel = page.getByTestId("sales-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("sales-legend")).toContainText("£200k");

  await panel.getByRole("button", { name: "Expensive" }).click();
  await expect(page.getByTestId("sales-legend")).toContainText("£360k");

  await panel.getByRole("button", { name: "Growth" }).click();
  await panel.getByRole("button", { name: "10y" }).click();
  await expect(panel.getByRole("button", { name: "10y" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("sales-legend")).toContainText("+120%");

  // Filters are chip lists with All · None (v4 Task 19); "Other" is opt-in.
  const other = page.getByTestId("sales-types").getByRole("button", { name: "Other", exact: true });
  await expect(other).toHaveAttribute("aria-pressed", "false");
  await other.click();
  await expect(other).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("sales-panel")).toContainText("HM Land Registry");
  await expect.poll(() => tiles.length).toBeGreaterThan(0);

  await page.getByTestId("sales-toggle").uncheck();
  await expect(page.getByTestId("sales-panel")).toHaveCount(0);
});
