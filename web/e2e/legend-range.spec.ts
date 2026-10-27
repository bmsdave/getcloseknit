import { expect, test, type Locator, type Page } from "./fixtures";

import { LONDON_AREAS, routeEngland } from "./england-view";

// The reader's own colour scale (lib/legend-range.ts): two handles over the histogram in the legend set the ramp's
// low and high value; the colours spread in equal steps between them, the address and this device keep the range,
// and Reset returns to the view's own scale. The areas are answered in the browser (england-view.ts).
const PRICE = "/?mode=real&release=official-2026-06&layer=price-per-square-metre&lat=51.5&lng=-0.12&zoom=9.6&diagnostics=1";
// London's middle columns: in view on a phone as on a laptop.
const INSIDE = LONDON_AREAS.filter((area) => area.box[0] >= -0.3 && area.box[2] <= 0);

/** The painted values (places on the colour scale) once every area has one. */
async function painted(page: Page): Promise<number[]> {
  const handle = await page.waitForFunction((ids) => {
    const values = ids.map((id) => window.__closeKnitDiagnostics?.featureValue(id));
    return values.every((value) => typeof value === "number") ? values : null;
  }, INSIDE.map((area) => area.id), { timeout: 30_000 });
  return await handle.jsonValue() as number[];
}

/** Drags a handle's thumb sideways by `share` of the slider's width (negative: left). */
async function drag(page: Page, handle: Locator, share: number) {
  const box = (await handle.boundingBox())!;
  const { value, min, max, thumb } = await handle.evaluate((node: HTMLInputElement) => ({
    value: Number(node.value), min: Number(node.min), max: Number(node.max),
    thumb: Number.parseFloat(getComputedStyle(node).height),
  }));
  const x = box.x + thumb / 2 + (box.width - thumb) * ((value - min) / (max - min));
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * share, y, { steps: 10 });
  await page.mouse.up();
}

test("a dragged handle recolours the map, a reload keeps the range, Reset returns to the view's scale", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the desktop legend shows the range inline");
  await routeEngland(page);
  await page.goto(PRICE);
  const before = await painted(page);
  const range = page.getByTestId("legend-range");
  await expect(range).toBeVisible();
  await expect(range.getByTestId("legend-range-bars").locator(".satin").first()).toBeAttached();
  await expect(page.getByTestId("legend-scope-view")).toHaveAttribute("aria-pressed", "true");
  // The handles start at the view's own ends, in the layer's unit.
  await expect(page.getByTestId("legend-range-high-value")).toContainText("£");
  await drag(page, page.getByTestId("legend-range-high"), -0.45);
  await expect(page.getByTestId("legend-custom-badge")).toBeVisible();
  await expect(page.getByTestId("legend-custom")).toContainText("+");
  await expect(page.getByTestId("legend-range-reset")).toBeVisible();
  // A lower top: more of London reaches the last colour.
  await expect.poll(async () => (await painted(page)).filter((value) => value >= 100).length)
    .toBeGreaterThan(before.filter((value) => value >= 100).length);
  const after = await painted(page);
  const high = Number(await page.getByTestId("legend-range-high").inputValue());
  // Equal steps: an area's place is its value's share of the range (below low 0, above high 100).
  const low = Number(await page.getByTestId("legend-range-low").inputValue());
  INSIDE.forEach((area, index) => {
    const expected = Math.min(100, Math.max(0, ((area.value - low) / (high - low)) * 100));
    expect(after[index]).toBeCloseTo(expected, 0);
  });
  await expect(page).toHaveURL(/[?&]range=/);

  await page.reload();
  await expect(page.getByTestId("legend-custom-badge")).toBeVisible();
  await expect.poll(async () => painted(page)).toEqual(after);
  expect(Number(await page.getByTestId("legend-range-high").inputValue())).toBeCloseTo(high, 0);

  await page.getByTestId("legend-range-reset").click();
  await expect(page.getByTestId("legend-custom-badge")).toHaveCount(0);
  await expect(page.getByTestId("legend-percentile").first()).toContainText("Lowest in view");
  await expect(page).not.toHaveURL(/[?&]range=/);
  await expect.poll(async () => painted(page)).toEqual(before);
});

test("each handle names the layer and its unit, is a 44px target and steps with the keys", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the desktop legend shows the range inline");
  await routeEngland(page);
  await page.goto(PRICE);
  await painted(page);
  const low = page.getByRole("slider", { name: /colours from/ });
  const high = page.getByRole("slider", { name: /colours to/ });
  await expect(low).toHaveAttribute("aria-label", /^Price per .+, colours from, in £\/m²$/);
  await expect(high).toHaveAttribute("aria-label", /^Price per .+, colours to, in £\/m²$/);
  await expect(low).toHaveAttribute("aria-valuetext", /£/);
  // The dot stays small; the target around it is 44px.
  expect(await low.evaluate((node) => Number.parseFloat(getComputedStyle(node).height))).toBe(44);

  const step = Number(await low.getAttribute("step"));
  const start = Number(await low.inputValue());
  await low.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await low.inputValue())).toBeCloseTo(start + step, 6);
  await expect(page.getByTestId("legend-custom-badge")).toBeVisible();
  // End takes the low handle as far as it goes: one step under the high one.
  await page.keyboard.press("End");
  const top = Number(await high.inputValue());
  await expect.poll(async () => Number(await low.inputValue())).toBeCloseTo(top - step, 6);
  // Both handles at the top end: a press on the low dot takes the low handle, the one that can still move.
  const box = await low.boundingBox();
  const lowAt = (Number(await low.inputValue()) - Number(await low.getAttribute("min")))
    / (Number(await low.getAttribute("max")) - Number(await low.getAttribute("min")));
  const x = box!.x + 22 + (box!.width - 44) * lowAt;
  expect(await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.getAttribute("data-testid"),
    [x, box!.y + box!.height / 2])).toBe("legend-range-low");
  await expect(page).toHaveURL(/[?&]range=/);
});

test("England's ranks on demand, and a fixed-break layer takes a range from a link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the desktop legend shows the range inline");
  await routeEngland(page);
  await page.goto(PRICE);
  await painted(page);
  await page.getByTestId("legend-scope-england").click();
  await expect(page.getByTestId("legend-scope-england")).toHaveAttribute("aria-pressed", "true");
  // Every London area sits in England's top tenth: all at 90 or more, as the published ranks say.
  await expect.poll(async () => Math.min(...await painted(page))).toBeGreaterThanOrEqual(90);
  await expect(page.getByTestId("legend-percentile").first()).toContainText("Lowest in England");
  await expect(page).toHaveURL(/[?&]scope=england/);
  // Moving the map keeps the choice.
  await page.keyboard.press("Escape");
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => Math.min(...await painted(page))).toBeGreaterThanOrEqual(90);

  // Crime is coloured on fixed breaks: a range from the address moves them, equal steps from 6,000 to 8,000.
  await page.goto("/?mode=real&release=official-2026-06&layer=crime&scale=linear&lat=51.5&lng=-0.12&zoom=9.6&diagnostics=1&range=6000,8000");
  const values = await painted(page);
  INSIDE.forEach((area, index) => {
    expect(values[index]).toBeCloseTo(Math.min(100, Math.max(0, ((area.value - 6000) / 2000) * 100)), 0);
  });
  await expect(page.getByTestId("legend-custom")).toContainText("≤");
  await expect(page.getByTestId("legend-scope-view")).toHaveCount(0);
});

test("on a phone the chip opens the range above it; the layer pill still opens Layers", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the phone legend");
  await routeEngland(page);
  await page.goto(PRICE);
  const before = await painted(page);
  const chip = page.getByTestId("legend-chip");
  const range = page.getByTestId("legend-range");
  await expect(range).toBeHidden();
  await chip.click();
  await expect(range).toBeVisible();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("layers-panel")).toHaveCount(0);
  const [card, key] = [(await range.boundingBox())!, (await chip.boundingBox())!];
  // Just above the chip, a short card: the map stays in view.
  expect(card.y + card.height).toBeLessThanOrEqual(key.y + 1);
  expect(card.height).toBeLessThanOrEqual(150);
  await drag(page, page.getByTestId("legend-range-high"), -0.45);
  await expect.poll(async () => (await painted(page)).filter((value) => value >= 100).length)
    .toBeGreaterThan(before.filter((value) => value >= 100).length);
  await expect(page).toHaveURL(/[?&]range=/);
  await chip.click();
  await expect(range).toBeHidden();
  await page.getByTestId("layer-pill").click();
  await expect(page.getByTestId("layers-panel")).toBeVisible();
});
