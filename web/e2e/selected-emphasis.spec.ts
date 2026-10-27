import { expect, test, type Page } from "./fixtures";
import { chooseLayer, openEvidenceSection, showEvidenceSummary } from "./evidence";
import { openMapSettings } from "./top-bar";

async function selectWestminster(page: Page) {
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
}

// UX-55: the selected geography keeps its emphasis treatment across analytic
// layers, pitch changes, and evidence-section navigation — the selection
// itself must endure every transition that the treatment rides on.
test("selection endures layers, pitch, and section navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await selectWestminster(page);

  // Every analytic layer keeps the selection.
  // By test id: Overview's tiles share some of these names.
  for (const layer of ["crime", "deprivation", "income", "social-renting", "price-per-square-metre"]) {
    await chooseLayer(page, layer);
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  }

  // Pitch changes (from Map settings) keep the selection.
  await openMapSettings(page);
  await page.getByRole("button", { name: "Tilt map" }).click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-map-pitch", "45");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await page.getByRole("button", { name: "Flatten map" }).click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-map-pitch", "0");
  // The Layers card sits beside the area, which stays in view; Escape closes it.
  await expect(page.getByTestId("selected-area")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("layers-panel")).toBeHidden();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

  // The full page's sections keep the area, and "Open on the map" returns to it.
  for (const name of ["Price", "Environment", "Planning", "People"] as const) {
    await openEvidenceSection(page, name);
    await expect(page.getByTestId("area-page-title")).toContainText(/St James's|Westminster/);
  }
  await page.getByTestId("open-on-map").click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await showEvidenceSummary(page);
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tiles")).toBeInViewport();
});

test.describe("mobile selection endurance", () => {
  test.use({ hasTouch: true });

  test("touch layer switches keep the selection", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await selectWestminster(page);
    await chooseLayer(page, "crime");
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
    await chooseLayer(page, "price-per-square-metre");
    await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  });
});

