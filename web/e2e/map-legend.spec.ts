import { expect, test } from "./fixtures";

import { chooseLayer, openLayersPanel, openScaleSettings } from "./evidence";
import { openShowPanel, openTopMenu } from "./top-bar";
import { seedSearch } from "./wizard";

// UX-57: the map's legend chip (map-layers.tsx) says in one line what the colours
// show and when, with ticks and a London-typical marker. The Layers card carries no
// colour key of its own. It follows layer and mode changes.
test("map legend interprets colour and follows layer changes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  const legend = page.getByTestId("map-legend");
  await expect(legend).toBeVisible();
  await expect(legend.getByTestId("legend-caption")).toHaveText("Price per m² · Jun 2026");
  // First open paints the London rank, not £/m² (owner decision 2026-10-20): no median tick on the rank scale.
  await expect(legend.getByTestId("legend-percentile")).toHaveText(/Lowest in London.*Highest/);
  await expect(legend.getByTestId("legend-median-tick")).toHaveCount(0);
  // "No data" is a key of its own, only while a grey area is in view (DESIGN.md §6, England map), never a caption.
  for (const gone of ["Real data", "value now", "Higher means more", "2026-06", "grey = no data", "London typical"]) await expect(legend).not.toContainText(gone);
  // The chip names the layer and period over its scale, then a "?" that explains the layer (v3 Fix 12).
  await expect(legend.getByTestId("legend-caption")).toBeVisible();
  const about = page.getByTestId("legend-explain");
  // The "?" carries the layer's title with its view; the explainer itself is named after the layer alone.
  await expect(about).toHaveAccessibleName("About Price per m² · Rank in London");
  await about.click();
  const explainer = page.getByTestId("layer-explainer");
  await expect(explainer).toHaveAccessibleName("About Price per m²");
  await expect(explainer.getByTestId("layer-explainer-line")).toHaveText("What homes here sold for, per square metre of floor.");
  await expect(explainer.getByTestId("layer-explainer-points")).toContainText("HM Land Registry Price Paid");
  await expect(explainer.getByTestId("layer-explainer-points")).toContainText("Sales to Jun 2026");
  await expect(explainer.getByTestId("layer-explainer-average")).toContainText(/London typical \d+(st|nd|rd|th)/);
  // No area chosen: no area mark.
  await expect(explainer.getByTestId("layer-explainer-area")).toHaveCount(0);
  await expect(explainer.getByTestId("layer-explainer-guide")).toHaveAttribute("href", "/guide/price-per-m2");
  await page.keyboard.press("Escape");
  await expect(explainer).toBeHidden();
  await expect(about).toBeFocused();
  const details = await openScaleSettings(page);
  for (const id of ["legend-details", "legend-more", "legend-price-bands", "legend-london-typical"]) await expect(details.getByTestId(id)).toHaveCount(0);

  await chooseLayer(page, "crime");
  await expect(legend.getByTestId("legend-caption")).toContainText("Crimes per 1,000 people a year");
  await expect(legend.getByTestId("legend-crime")).toContainText("200+");

  await chooseLayer(page, "income");
  await expect(legend).toContainText("Household income a year");
});

// Map colours paint every layer: the default (colour-blind safe, v4 Task 43) runs blue (good) to red (bad)
// where one end is better (prices: cheap is blue, dear is red), and a calm sequential ramp on income, which
// is neither; the traffic light stays a choice; the change scale keeps its own colours.
test("the legend paints the chosen map colours on every layer", async ({ page }) => {
  test.slow(); // eleven map loads, one per layer and palette
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const bar = page.getByTestId("map-legend").locator(".map-legend-bar");
  const colours = async () => (await bar.getAttribute("data-colours"))?.split(" ") ?? [];
  await expect(bar).toHaveAttribute("data-colours", /^#2166ac .* #b2182b$/);
  expect(await colours()).not.toContain("#1a9850");

  await chooseLayer(page, "income");
  await expect(bar).toHaveAttribute("data-colours", /^#edf8b1 /);
  expect(await colours()).not.toContain("#b2182b");

  // Census layers are neither good nor bad: the calm ramp in every palette, never the traffic light.
  await page.goto("/?layer=census-ethnicity-asian&palette=current");
  await expect(bar).toHaveAttribute("data-colours", /^#eef5fb /);
  await page.goto("/?layer=census-ethnicity-bangladeshi&palette=colour-blind");
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toContainText("% of residents, Bangladeshi (Census 2021)");
  expect(await colours()).not.toContain("#b2182b");
  await page.goto("/?layer=census-birth-country-poland&palette=colour-blind");
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toContainText("MSOA figures: each MSOA is one colour");
  expect(await colours()).not.toContain("#b2182b");
  await page.goto("/?layer=census-household-lone-parent&palette=colour-blind");
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toContainText("% of households, lone parent (Census 2021)");
  expect(await colours()).not.toContain("#b2182b");

  await page.goto("/?layer=typical-price-flat&palette=current");
  await expect(bar).toHaveAttribute("data-colours", /^#1a9850 .* #d73027$/);
  await page.goto("/?layer=typical-price");
  await expect(bar).toHaveAttribute("data-colours", /^#2166ac .* #b2182b$/);

  await page.goto("/?palette=current");
  await chooseLayer(page, "crime");
  await expect(bar).toHaveAttribute("data-colours", /^#1a9850 .* #d73027$/);
  await chooseLayer(page, "deprivation");
  await expect(bar).toHaveAttribute("data-colours", /^#d73027 .* #1a9850$/);

  await page.goto("/?palette=viridis");
  await expect(bar).toHaveAttribute("data-colours", /^#440154 /);

  await page.goto("/?palette=viridis&layer=price-per-square-metre&scale=change&window=5");
  await expect(page.getByTestId("legend-change")).toBeVisible();
  await expect(bar).toHaveAttribute("data-colours", /^#542788 .* #b35806$/);
});

test("map legend follows mode changes and stays readable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The data mode switch is an internal: ?dev=1.
  await page.goto("/?dev=1");
  await openScaleSettings(page);

  const legend = page.getByTestId("map-legend");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("Price per m²");

  // Switching mode from the ≡ menu (dev); the legend stays plain.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("layers-panel")).toBeHidden();
  await openTopMenu(page);
  await page.getByRole("radio", { name: /Real/ }).click();
  await page.keyboard.press("Escape");
  await openScaleSettings(page);
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("Price per m²");
  await expect(legend).not.toContainText("Real data");
});

// #30: one place to choose data. Place types are tick-boxes under Places in the
// data selector, each keyed by the badge the map draws; no chips float on the map.
test("places' types are ticked in the data selector, each keyed by its map badge; no chips on the map", async ({ page }) => {
  await page.goto("/?places=all&lat=51.539&lng=-0.1426&zoom=15");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect(page.getByTestId("places-legend")).toHaveCount(0);
  await expect(page.getByText("Show:", { exact: true })).toHaveCount(0);
  const overlays = (await openShowPanel(page)).getByTestId("map-overlays");
  await expect(overlays.getByTestId("places-toggle")).toBeChecked();
  for (const [id, label] of [["coffee", "Coffee"], ["food", "Food & takeaway"], ["pub", "Pubs & bars"], ["shop", "Shops"], ["leisure", "Sport & culture"], ["other", "Other"]]) {
    const row = overlays.getByTestId(`places-group-${id}`);
    await expect(row).toHaveText(label);
    await expect(row.getByRole("checkbox", { name: label })).toBeVisible();
    // The key is the map's own badge (felt disc and ring), not a colour swatch.
    await expect(row.locator("svg.place-badge circle")).toHaveCount(3);
  }
  // "Other" starts hidden; unticking a type keeps the address in step.
  await expect(overlays.getByRole("checkbox", { name: "Other" })).not.toBeChecked();
  await overlays.getByRole("checkbox", { name: "Food & takeaway" }).uncheck();
  await expect.poll(() => new URL(page.url()).searchParams.get("places")).toBe("coffee,pub,shop,leisure");
  // Places off: its types go with it.
  await overlays.getByTestId("places-toggle").uncheck();
  await expect(overlays.getByTestId("places-panel")).toHaveCount(0);
  await expect(page.getByTestId("places-legend")).toHaveCount(0);
  // Places are read flat, and no first-visit card covers them.
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-map-pitch", "0");
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
});

test("My match's legend runs least like your search to best match, hatch for a failed Must, and links to how to read the map", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  const legend = page.getByTestId("map-legend").filter({ visible: true }).first();
  // v4 Task 21e: 7 RdBu bands by percentile, every scored area coloured; no "top 50", nothing left clear.
  await expect(legend.getByTestId("legend-caption")).toHaveText("My match");
  await expect(legend.getByTestId("legend-match")).toHaveText(/Least like your search\s*Best match/);
  await expect(legend.locator(".map-legend-bar")).toHaveAttribute("data-colours", "#b2182b #ef8a62 #fddbc7 #f2f2f2 #d1e5f0 #67a9cf #2166ac");
  await expect(legend.getByTestId("legend-clear")).toHaveCount(0);
  // Keyed: only the hatch of an area that fails a Must (board V4-21e); a soft miss reads red, not grey.
  await expect(legend.getByTestId("legend-match-keys")).toHaveText(/^\s*fails a Must\s*$/);
  // The guide link is the legend "?"'s (v3 Fix 12); the Layers menu has none (Fix 22.8).
  const panel = await openLayersPanel(page);
  await expect(panel.getByRole("link", { name: "How to read the map" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("legend-explain").click();
  await expect(page.getByTestId("layer-explainer-guide")).toHaveAttribute("href", "/guide/your-match");
  // My match ranks: no London figure on its scale.
  await expect(page.getByTestId("layer-explainer-average")).toHaveCount(0);
});

// The chip is the only legend, compact on a phone: above the sheet's peek, beside the round Layers
// button, never past the screen's edge; a tap opens the Layers card without moving the sheet.
// The half grows to show the area's whole peek (map-dock.tsx usePeekFit): St James's peek is high enough that the
// round buttons lie in a row, and on the narrowest phones (≤400px) the chip gives way to the layer pill
// (layout.css data-sheet-high). A 412px phone keeps it: measure there, once the peek has its height.
test("on a phone the legend chip rides above the sheet and opens the colour range", async ({ page }) => {
  const width = 412;
  await page.setViewportSize({ width, height: 915 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toBeVisible();
  const chip = page.getByTestId("legend-chip");
  const dock = page.getByTestId("map-dock");
  await expect(page.getByTestId("area-tiles").locator(".standout-tile")).toHaveCount(4, { timeout: 20_000 });
  await expect.poll(() => dock.evaluate((node) => node.style.getPropertyValue("--sheet-fit"))).not.toBe("");
  await expect.poll(() => dock.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  // One 44px line: the layer and period, then a thin scale between its lowest and highest labels.
  await expect(chip.getByTestId("legend-caption")).toHaveText("Price per m² · Jun 2026");
  await expect(chip.locator(".map-legend-bar")).toBeVisible();
  await expect(chip.locator(".map-legend-stops span:not([data-edge])").first()).toBeHidden();
  await expect(chip.locator(".map-legend-stops span[data-edge]")).toHaveCount(2);
  await expect(chip.getByTestId("legend-median-tick")).toBeHidden();
  await expect(chip).toHaveAccessibleName(/Price per m² · Jun 2026/);
  const sheet = await dock.boundingBox();
  // Once it has slid to where the sheet rests.
  await expect.poll(async () => {
    const chipBox = await chip.boundingBox();
    return (chipBox?.y ?? 0) + (chipBox?.height ?? 0) <= (sheet?.y ?? 0);
  }).toBe(true);
  const box = await chip.boundingBox();
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(8);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width - 8);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(sheet?.y ?? 0);
  expect(box?.height ?? 999).toBeLessThanOrEqual(46);
  // A tap opens the colour range above the chip (legend-range.spec.ts); the layer pill opens Layers.
  await chip.click();
  await expect(page.getByTestId("legend-range")).toBeVisible();
  await page.getByTestId("layer-pill").click();
  await expect(page.getByTestId("layers-panel")).toBeVisible();
  // One sheet at a time (v4 Task 13): the area waits at its peek under Layers.
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
});

test("the chip shows the whole key on a desktop, bottom-left of the map", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toBeVisible();
  const legend = page.getByTestId("map-legend");
  await expect(legend.locator(".map-legend-bar")).toBeVisible();
  await expect(legend.locator(".map-legend-stops")).toBeVisible();
  await expect(page.getByTestId("map-dock").getByTestId("map-legend")).toHaveCount(0);
});

// #20: a phone on its side (844×390): the compact head and CTA bar leave the verdict and the tags' row in
// view (v4 Task 12: the side panel's area view; the tiles are a short scroll away).
test("landscape phone shows the verdict and tags above the CTA bar", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toBeVisible();
  await expect(page.locator(".dock-area .area-tags")).toBeVisible({ timeout: 15_000 });
  const tile = await page.locator(".dock-area .area-tags").boundingBox();
  const bar = await page.locator(".dock-area .area-brief__actions").boundingBox();
  expect(tile && bar, "tile and CTA bar on screen").toBeTruthy();
  expect((tile?.y ?? 0) + (tile?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
});
