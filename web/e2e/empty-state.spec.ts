import { expect, test } from "./fixtures";
import { showEvidenceSummary } from "./evidence";

// UX-42 and v3 Fix 1: before selection the map stays whole — no side panel at
// all on a desktop, one hint chip under the search ("Choose an area · Try an
// example") — and the round buttons sit 12px in from the map's right edge.
test("desktop empty state is a hint under the search, not a panel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByTestId("intro-dismiss").click();
  await expect(page.getByTestId("map-dock")).toBeHidden();
  const hint = page.getByTestId("map-hint");
  await expect(hint).toHaveText(/Choose an area\s*·\s*Try an example/);
  const [chip, bar] = await Promise.all([hint.boundingBox(), page.getByTestId("top-bar-pill").boundingBox()]);
  expect(chip!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
  expect(Math.abs(chip!.x - bar!.x)).toBeLessThanOrEqual(1);
  const rail = await page.getByTestId("layers-toggle").boundingBox();
  expect(1280 - (rail!.x + rail!.width)).toBe(12);
  await page.getByTestId("map-hint-example").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "personal-match");
  await expect(hint).toHaveCount(0);
});

test("mobile empty state collapses to a peek and expands on selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const panel = page.getByTestId("evidence-panel");
  await expect(panel.getByTestId("selected-area")).toContainText("Choose an area");

  await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "collapsed");
  await expect(page.getByTestId("evidence-sheet-reopen")).toContainText("Choose an area");
  // The peek names the next action and reserves a fraction of the viewport:
  // the whole sheet (layers, the legend's one line of words over its scale, this line, footer) stays small.
  await expect(panel.getByTestId("evidence-empty")).toContainText("on the map or search");
  const box = await page.getByTestId("map-dock").boundingBox();
  expect(box, "peek reserves little viewport").not.toBeNull();
  expect(box?.height ?? 844).toBeLessThan(844 * 0.28);

  // Selecting an area expands the full sheet from the peek state.
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(panel.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(panel.getByTestId("evidence-empty")).toHaveCount(0);
  await showEvidenceSummary(page);
  await expect(panel.getByTestId("area-tile-price")).toBeVisible();
});
