import { expect, test, type Page } from "./fixtures";

async function selectWestminster(page: Page) {
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
}

// UX-43: closing never strands users without a discoverable return path —
// one persistent reopen control with selected/empty labels, preserved active
// section, and announced expanded state.
test("desktop close and reopen preserves the brief as left", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await selectWestminster(page);
  // Unfold all 12 tiles: part of the state the panel keeps.
  const more = page.getByTestId("evidence-panel").getByTestId("area-tiles-more");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");

  const close = page.getByTestId("evidence-sheet-close");
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await close.click();

  // One persistent reopen control names the selected area and admits closure.
  const reopen = page.getByTestId("evidence-sheet-reopen");
  await expect(reopen).toHaveAttribute("aria-expanded", "false");
  await expect(reopen).toContainText("St James's · SW1A");

  // Keyboard reopen restores the panel as left: all 12 tiles still unfolded.
  await reopen.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("evidence-sheet-close")).toBeVisible();
});

// Map controls PR 1 (Esc ladder, lib/esc-ladder.ts): Escape deselects the area from anywhere, so its panel
// (desktop) or sheet (phone) goes; typing in a field keeps its own Escape. Focus inside the panel moves to the map.
for (const { name, size } of [{ name: "desktop", size: { width: 1280, height: 720 } }, { name: "phone", size: { width: 390, height: 844 } }]) {
  test(`Escape deselects the area from anywhere (${name})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/?selected=uk%3Alsoa%3AE01000001");
    const dock = page.getByTestId("map-dock");
    await expect(page.getByTestId("evidence-panel").getByTestId("area-tiles")).toBeVisible({ timeout: 15_000 });
    await expect(dock).toHaveAttribute("data-snap", "half");
    // A field's Escape is its own.
    const search = page.getByRole("combobox", { name: "Search", exact: true });
    await search.focus();
    await page.keyboard.press("Escape");
    await expect(dock).toHaveAttribute("data-snap", "half");
    await expect(dock).not.toHaveAttribute("data-area", "empty");
    // Focus inside the panel: Escape deselects the area and focus moves to the map, never stranded.
    await page.getByTestId("evidence-panel").getByTestId("selected-area").focus();
    await page.keyboard.press("Escape");
    await expect(dock).toHaveAttribute("data-area", "empty");
    await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toBeNull();
    await expect(page.locator(".maplibregl-canvas").first()).toBeFocused();
    // Chosen again, Escape with focus on the page itself (not in the panel) deselects it too.
    await page.goto("/?selected=uk%3Alsoa%3AE01000001");
    await expect(page.getByTestId("evidence-panel").getByTestId("area-tiles")).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
    await expect(dock).toHaveAttribute("data-area", "empty");
  });
}

test.describe("mobile close and reopen", () => {
  test.use({ hasTouch: true });

  test("the empty sheet rests at its peek; opened, it is the prompt and an example", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const dock = page.getByTestId("map-dock");
    await expect(dock).toHaveAttribute("data-snap", "collapsed");
    await page.getByTestId("evidence-sheet-reopen").tap();
    await expect(dock).toHaveAttribute("data-snap", "half");
    await expect(page.getByTestId("evidence-empty")).toBeVisible();
    // The prompt and Try an example sit at the top of the half sheet.
    const example = page.getByTestId("empty-example");
    await expect(example).toBeVisible();
    const top = (await dock.boundingBox())!.y;
    expect((await example.boundingBox())!.y - top).toBeLessThan(80);
    // Nothing to fold but the peek itself, so there is no Close.
    await expect(page.getByTestId("evidence-sheet-close")).toBeHidden();
    await example.tap();
    // v4 Task 13: a phone's My match is its own sheet, lowered so London shows.
    await expect(page.getByTestId("match-sheet")).toBeVisible();
  });

  test("a folded sheet reopens from its area row", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await selectWestminster(page);
    await page.getByTestId("evidence-sheet-close").tap();
    const reopen = page.getByTestId("evidence-sheet-reopen");
    await expect(reopen).toContainText("St James's · SW1A");
    await expect(reopen).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("evidence-panel")).toBeHidden();

    await reopen.tap();
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  });
});
