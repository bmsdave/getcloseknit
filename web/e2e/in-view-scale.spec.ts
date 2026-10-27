import { expect, test } from "./fixtures";

import { LONDON_AREAS, paintedValues, routeEngland, SOUTH_EAST_AREAS } from "./england-view";

// The rank scale is the view's own (lib/view-scale.ts): the values of the areas in view split into equal shares,
// one scale for everything on screen. London's areas all sit in England's top tenth here (as price per m² does), so
// England's ranks would paint all of London one red; the view's own scale spreads them over the ramp, and a view
// across London's boundary colours equal values alike on both sides. The areas are answered in the browser
// (england-view.ts).

test("all of London at z9.6: the view's own scale spreads London over the ramp", async ({ page }) => {
  await routeEngland(page);
  await page.goto("/?mode=real&release=official-2026-06&layer=price-per-square-metre&lat=51.5&lng=-0.12&zoom=9.6&diagnostics=1");
  // London's middle columns are in view on a phone as on a laptop.
  const inside = LONDON_AREAS.filter((area) => area.box[0] >= -0.3 && area.box[2] <= 0);
  const values = await paintedValues(page, inside.map((area) => area.id));
  // England's ranks would put every one at 90 or more; the view's scale uses the whole ramp: five or more classes.
  const classes = new Set(values.map((value) => Math.min(7, Math.floor(value / 12.5))));
  expect(classes.size).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId("legend-percentile").first()).toContainText("Lowest in view");
  await expect(page.getByTestId("legend-percentile").first()).toContainText("£");
});

test("across London's boundary at z9.2: one scale both sides, equal values in equal colours", async ({ page }) => {
  await routeEngland(page);
  await page.goto("/?mode=real&release=official-2026-06&layer=price-per-square-metre&lat=51.5&lng=-0.12&zoom=9.2&diagnostics=1");
  const areas = [...LONDON_AREAS, ...SOUTH_EAST_AREAS];
  const values = await paintedValues(page, areas.map((area) => area.id));
  // London's £5,000 and its neighbour's £5,000 paint the same; England's ranks would give 90 and 40.
  expect(values[LONDON_AREAS.length]).toBe(values[0]);
  // Higher values never paint lower, whichever side of the line they are on.
  const ordered = areas.map((area, index) => ({ value: area.value, painted: values[index] })).sort((a, b) => a.value - b.value);
  for (let index = 1; index < ordered.length; index += 1) {
    expect(ordered[index].painted).toBeGreaterThanOrEqual(ordered[index - 1].painted);
  }
  expect(Math.min(...values)).toBe(0);
  expect(Math.max(...values)).toBe(100);
  await expect(page.getByTestId("legend-percentile").first()).toContainText("Lowest in view");
});
