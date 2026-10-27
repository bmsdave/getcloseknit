import { expect, test } from "./fixtures";
import { openMatchBuilder, showTimeline } from "./top-bar";
import { chooseLayer, openEvidenceSection } from "./evidence";

// UX-65: the journey stays operable at 200% zoom and under reduced motion.
test.describe("zoomed journey", () => {
  // 640x360 CSS px is what 200% browser zoom at 1280x720 reports to layout.
  test("primary actions stay reachable at 200 percent with no page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto("/");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await expect(page.getByRole("combobox", { name: "Search", exact: true })).toBeVisible();
    await openMatchBuilder(page);
    await expect(page.getByTestId("match-list")).toBeVisible();
    // 640 × 360 is a short window (v4 Task 11): My match is the right-side panel, left by choosing a layer.
    await chooseLayer(page, "price-per-square-metre");

    await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
    await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
    await openEvidenceSection(page, "Price & market");
    // The Price section's action (v3: no unit switch) is in reach without a sideways scroll.
    await expect(page.getByTestId("section-map-price")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    await page.getByTestId("open-on-map").click();
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
    await chooseLayer(page, "crime");
    await expect(page.getByTestId("map-legend")).toContainText("Crimes per 1,000");
  });
});

test.describe("reduced motion", () => {
  async function reducedPage(browser: import("@playwright/test").Browser, viewport: { width: number; height: number }) {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport });
    const page = await context.newPage();
    return { context, page };
  }

  test("selection, layers, and timeline operate instantly", async ({ browser }) => {
    const { context, page } = await reducedPage(browser, { width: 1280, height: 720 });
    try {
      await page.goto("/");
      expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

      await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
      await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
      await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

      await chooseLayer(page, "income");
      await expect(page.getByTestId("map-legend")).toContainText("Household income a year");

      await chooseLayer(page, "price-per-square-metre");
      await showTimeline(page);
      await page.getByRole("button", { name: "Play timeline" }).click();
      await expect(page.getByRole("button", { name: "Play timeline" })).toBeVisible();
      await page.getByLabel("Price period").press("End");
      await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-period", "2026-06");
    } finally {
      await context.close();
    }
  });

  test("the phone layers panel works without motion", async ({ browser }) => {
    const { context, page } = await reducedPage(browser, { width: 390, height: 844 });
    try {
      await page.goto("/");
      await chooseLayer(page, "station-access");
      await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "station-access");
      await expect(page.getByTestId("legend-chip-layer")).toHaveText("Station walk");
    } finally {
      await context.close();
    }
  });
});
