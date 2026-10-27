import { expect, test } from "./fixtures";

import { openScaleSettings } from "./evidence";

const WESTMINSTER_CRIME = "uk:lsoa:E01000001" as const;

test("the crime type checklist, Show all and Clear all reshape the map", async ({ page }) => {
  await page.goto("/?layer=crime&diagnostics=1");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  const valueOf = () => page.evaluate((id) => window.__closeKnitDiagnostics?.featureValue(id), WESTMINSTER_CRIME);
  await expect.poll(valueOf).toBe(54);

  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

  // Crime has no views: its types are always listed under it, every one ticked.
  const details = await openScaleSettings(page);
  await expect(details.locator("[data-testid^='view-crime-']")).toHaveCount(0);
  const filter = details.getByTestId("crime-filter");
  await expect(filter).toBeVisible();
  await expect(filter.locator("legend")).toHaveText("Types");
  const all = filter.getByTestId("crime-all");
  const none = filter.getByTestId("crime-none");
  const boxes = filter.getByRole("checkbox");
  await expect(all).toHaveText("Show all");
  await expect(none).toHaveText("Clear all");
  await expect(all).toBeDisabled();
  await expect(none).toBeEnabled();

  // Leaving a type out paints the rest on actual values, rescaled to them.
  const burglary = filter.getByRole("checkbox", { name: "Include burglary" });
  await burglary.uncheck();
  await expect.poll(valueOf).toBe(42.1);
  await expect(page.getByTestId("map-legend")).toContainText("87.4+");
  await expect(page).toHaveURL(/layer=crime/);
  await expect(all).toBeEnabled();

  // Show all ticks every type again.
  await all.click();
  await expect(burglary).toBeChecked();
  await expect(all).toBeDisabled();
  await expect(page.getByTestId("map-legend")).toContainText("200+");
  await expect.poll(valueOf).toBe(54);

  // Clear all leaves every type out.
  await none.click();
  for (const box of await boxes.all()) await expect(box).not.toBeChecked();
  await expect(none).toBeDisabled();
  await expect(all).toBeEnabled();
  await expect.poll(valueOf).not.toBe(54);

  // One type back, then all of them.
  await burglary.check();
  await expect(burglary).toBeChecked();
  await expect(none).toBeEnabled();
  await all.click();
  for (const box of await boxes.all()) await expect(box).toBeChecked();
  await expect.poll(valueOf).toBe(54);
});

declare global {
  interface Window {
    __closeKnitDiagnostics: {
      measureStyleUpdate(iterations: number): number;
      renderedAreaCount(): number;
      sourceAreaCount(): number;
      fillSource(): string;
      hideTransit(): void;
      featureValue(id: `uk:${"lsoa" | "msoa" | "lad"}:${string}`): unknown;
      renderedFeatureIds(): (string | number | undefined)[];
      renderedArrows(): { layer: string; id: string | number | undefined }[];
      renderedAreaLabels(): { kind: string; label: string }[];
      layerIds(): string[];
      debug(): unknown;
      geometryUpdateCount(): number;
      paintProperty(layer: string, property: string): unknown;
      renderedCount(layer: string, at?: [number, number]): number;
      layoutProperty(layer: string, property: string): unknown;
      geojsonKinds(source: string): string[];
      project(lngLat: [number, number]): { x: number; y: number };
      renderedPoints(layer: string): { x: number; y: number; properties: Record<string, unknown> }[];
      morph(): { morphing: boolean; progress: number; weight: number; landed: number; samples: { at: number; writeMs: number; position: number; weight: number }[]; period: string | null };
      refreshTimings(): { period: string; fetchMs: number; applyMs: number }[];
    };
  }
}
