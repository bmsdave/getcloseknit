import { expect, test } from "./fixtures";

// Chart kit demo (/dev/charts, development and e2e builds only): every chart is an image
// with a numeric accessible name, tables toggle, nothing scrolls sideways on
// a phone, and no control falls back to the browser's default button look.

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/charts");
  await expect(page.getByTestId("dev-charts")).toBeVisible();
});

test("every chart is an image with an accessible name", async ({ page }) => {
  const charts = page.locator("[role=img]");
  expect(await charts.count()).toBeGreaterThanOrEqual(10);
  const labels = await charts.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")?.trim() ?? ""));
  expect(labels.filter((label) => label.length === 0)).toEqual([]);
  // Values travel with the picture: a tiny share is named, not rounded to 0.
  expect(labels).toContain("Land by flood chance: High under 1%, Medium 2%, Low 10%, Very low 4%, Outside 84%");
  await expect(page.getByText("Unknown").first()).toBeVisible();
});

test("Show as table toggles a table in place of the chart", async ({ page }) => {
  const frame = page.locator(".chart-frame", { has: page.getByRole("heading", { name: "Rivers and sea" }) });
  const toggle = frame.getByRole("button", { name: "Show as table" });
  await expect(frame.locator("table")).toHaveCount(0);
  // Retried: a click before hydration lands on a button without a handler.
  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass();
  await expect(frame.locator("table")).toBeVisible();
  await expect(frame.locator("[role=img]")).toHaveCount(0);
  await toggle.click();
  await expect(frame.locator("table")).toHaveCount(0);
  await expect(frame.locator("[role=img]")).toHaveCount(1);
});

test("no horizontal scroll at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByTestId("dev-charts")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("charts have no browser-default buttons", async ({ page }) => {
  const bad = await page.evaluate(() => [...document.querySelectorAll("button")]
    .filter((button) => button.getClientRects().length > 0)
    .filter((button) => ["outset", "inset"].includes(getComputedStyle(button).borderTopStyle))
    .map((button) => (button.getAttribute("aria-label") ?? button.textContent ?? "").trim()));
  expect(bad).toEqual([]);
});
