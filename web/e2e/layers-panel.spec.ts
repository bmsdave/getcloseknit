import { expect, test } from "./fixtures";

import { chooseView, openLayersPanel, openScaleSettings, topicItem } from "./evidence";

// The map's layers apart from the area, as in Google or Apple Maps (map-layers.tsx): a round Layers button
// and a legend chip on the map open the Layers menu (map-data-selector.tsx, v3 Fixes 3–7): a small search,
// None (the plain map), then the groups in decision order as an accordion, one open, its items in place
// (words only, no colour swatches: colours are chosen in ≡ › Map). Cost is flat: Price per m² with its
// views and the timeline, Typical price with its types. What is drawn on top is the round Show button's
// card; Map settings live in the ≡ menu only. The area block holds the area only.

test("the Layers button and the legend chip open one menu: None, the groups, Cost flat", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByTestId("layers-toggle");
  const chip = page.getByTestId("legend-chip");
  // The button is named by its visible word, never a longer aria-label (label-content-name-mismatch);
  // its tooltip names the layer shown.
  await expect(toggle).toHaveAccessibleName("Layers");
  await expect(toggle).not.toHaveAttribute("aria-label", /.*/);
  await expect(toggle).toHaveAttribute("title", "Layers · Price per m² · Rank in London");
  await expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // The chip: what colours the map, its period and its scale, once; it opens the same menu.
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Price per m² · Rank in London");
  await expect(chip).toHaveAccessibleName(/^Colour the map by: Price per m² · Rank in London\. Price per m² · Jun 2026/);
  await expect(chip.getByTestId("map-legend")).toBeVisible();
  await expect(page.getByTestId("map-legend")).toHaveCount(1);
  await expect(page.getByTestId("price-timeline")).toHaveCount(0);
  // The area block holds no layer row, legend, period or settings.
  const dock = page.getByTestId("map-dock");
  for (const id of ["layers-toggle", "legend-chip", "map-legend", "price-timeline", "map-settings-toggle"]) await expect(dock.getByTestId(id)).toHaveCount(0);
  // The Explore chip row is gone: every comparison is in the menu.
  await expect(page.getByTestId("explore-chips")).toHaveCount(0);

  const panel = await openLayersPanel(page);
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel).toHaveAccessibleName("Layers");
  await expect(panel.getByTestId("map-settings")).toHaveCount(0);
  await expect(dock.getByTestId("layers-panel")).toHaveCount(0);
  // No help link in the menu: the legend "?" explains the layer (v3 Fix 22.8).
  await expect(panel.getByTestId("legend-help")).toHaveCount(0);
  await expect(panel.getByTestId("layer-none")).toHaveText("None");
  await expect(panel.getByTestId("layer-none")).toHaveAttribute("aria-pressed", "false");
  await expect(panel.locator(".topic-group__label")).toHaveText([
    "Cost", "Transport", "Safety", "Food & drink", "Going out", "Everyday life", "Nature", "Homes & area", "People", "My criteria",
  ]);
  // The group of the layer shown opens with the menu; the others are closed rows.
  await expect(panel.getByTestId("topic-group-cost")).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByTestId("topic-group-safety")).toHaveAttribute("aria-expanded", "false");
  const price = panel.getByTestId("layer-price-per-square-metre");
  await expect(price).toHaveAttribute("aria-current", "true");
  await expect(price).toHaveText("Price per m²");
  // Cost outgrew the flat layout (five items > FLAT_GROUP_ITEMS): the layer shown lists its views, Rank chosen
  // by default (owner decision 2026-10-20); Typical price shows its types and "Latest" once it is chosen.
  await expect(panel.getByTestId("view-price-per-square-metre-rank")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator("[data-testid^='view-price-per-square-metre-']")).toHaveText(["Actual", "Rank", "Change", "Borough HPI"]);
  await expect(panel.locator("[data-testid^='view-typical-price-']")).toHaveCount(0);
  await expect(panel.locator("[data-testid^='view-'][aria-pressed='true']")).toHaveCount(1);
  // The timeline is Price per m²'s alone, on its row.
  await expect(panel.getByTestId("topic-details").getByTestId("price-timeline")).toBeVisible();
  await expect(panel.locator(".topic-list .layer-swatch, .topic-list .satin-swatch")).toHaveCount(0);
  // Overlays are Show's, not here.
  await expect(panel.getByTestId("map-overlays")).toHaveCount(0);

  // Every row is a 44px target.
  for (const height of await panel.locator(".topic-item, .topic-group__head, .topic-none").evaluateAll((nodes) =>
    nodes.filter((node) => (node as HTMLElement).offsetParent).map((node) => node.getBoundingClientRect().height))) {
    expect(height).toBeGreaterThanOrEqual(44);
  }

  // A view stays open; the chip names it. Rank is the default and stays out of the address; Actual is named.
  await chooseView(page, "price-per-square-metre", "actual");
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/scale=linear/);
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Price per m²");
  await expect(chip.getByTestId("legend-price")).toBeVisible();
  await chooseView(page, "price-per-square-metre", "rank");
  await expect(page).not.toHaveURL(/scale=/);
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Price per m² · Rank in London");
  await expect(chip.getByTestId("legend-percentile")).toHaveText(/Lowest in London.*Highest/);

  // Another item colours the map and the card stays open; Escape returns focus to the button.
  // Wealth (Layers v5): Income and Deprivation as its two views, Income first.
  const wealth = await topicItem(page, "income");
  await expect(wealth).toHaveText("Wealth");
  await wealth.click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "income");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-testid^='view-income-']")).toHaveText(["Income", "Deprivation"]);
  // Income has no rank view: it is painted on actual values.
  await expect(page).not.toHaveURL(/scale=percentile/);
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Wealth · Household income");
  // Income ranks (owner decision 2026-10-18): its Top 10 opens the highest household incomes.
  await expect(panel.getByTestId("layer-top-10")).toHaveAttribute("href", "/rankings/highest-income");
  // The colour key stays on the map, never in the card.
  for (const id of ["legend-details", "legend-more", "legend-price-bands", "legend-london-typical"]) await expect(panel.getByTestId(id)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("Layers › Crime › Top 10 opens the crime ranking on its good end", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  await panel.getByTestId("topic-group-safety").click();
  await panel.getByTestId("layer-crime").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  const top = panel.getByRole("link", { name: "Top 10: Crime" });
  // v4 Task 42: least crime first.
  await expect(top).toHaveAttribute("href", "/rankings/lowest-crime");
  await expect(panel.getByTestId("layer-top-10")).toHaveCount(1);
  await top.click();
  await expect(page).toHaveURL(/\/rankings\/lowest-crime$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("crime");
});

// Owner decision 2026-10-17: deprivation, the official index of the area, has its Top 10 like any layer.
test("Layers › Wealth › Deprivation › Top 10 opens the least deprived areas", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  await panel.getByTestId("topic-group-homes-area").click();
  await panel.getByTestId("layer-income").click();
  await panel.getByTestId("view-income-deprivation").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "deprivation");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Wealth · Deprivation");
  // An old Deprivation link opens the view too.
  const top = panel.getByRole("link", { name: "Top 10: Wealth" });
  await expect(top).toHaveAttribute("href", "/rankings/least-deprived");
  await top.click();
  await expect(page).toHaveURL(/\/rankings\/least-deprived$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Least deprived areas");
});

test("Crime stays open with its types: Show all and Clear all", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  await expect(panel.getByTestId("topic-group-safety")).toHaveText("Safety");
  await panel.getByTestId("topic-group-safety").click();
  await panel.getByTestId("layer-crime").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  await expect(panel).toBeVisible();
  // No views: the types checklist shows at once.
  await expect(panel.locator("[data-testid^='view-crime-']")).toHaveCount(0);
  const filter = panel.getByTestId("crime-filter");
  await expect(filter).toBeVisible();
  await expect(filter.locator("legend")).toHaveText("Types");
  await expect(panel).not.toContainText("Show all recorded crimes");
  for (const id of ["rescale-range", "scale-pinned-note", "legend-details"]) await expect(panel.getByTestId(id)).toHaveCount(0);
  const all = filter.getByTestId("crime-all");
  const none = filter.getByTestId("crime-none");
  await expect(all).toBeDisabled();
  await filter.getByRole("checkbox", { name: "Include burglary" }).uncheck();
  await expect(all).toBeEnabled();
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Crime");
  await none.click();
  await expect(none).toBeDisabled();
  await expect(filter.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await all.click();
  await expect(all).toBeDisabled();
  await expect(filter.getByRole("checkbox", { checked: false })).toHaveCount(0);
});

// The rate by neighbourhood sits under Crime; the Show card's "Road collisions" draws the points themselves.
// Layers v5 (PR 1): the rate and the Show row's dots are one item, Road danger: the dots come on with it.
test("Safety lists Road danger; choosing it brings the collisions' dots, leaving it takes them off", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  await panel.getByTestId("topic-group-safety").click();
  await expect(panel.locator(".topic-list .topic-item .topic-item__name")).toHaveText(["Crime", "Road danger"]);
  await panel.getByTestId("layer-road-collisions").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "road-collisions");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Road danger");
  await expect(page).toHaveURL(/collisions=on/);
  await panel.getByTestId("layer-crime").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  await expect(page).not.toHaveURL(/collisions=/);
  // A link from the Overview opens the same layer, its dots on; a link with its own filters keeps them.
  await page.goto("/?layer=road-collisions");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "road-collisions");
  await expect(page).toHaveURL(/collisions=on/);
  await page.goto("/?layer=road-collisions&collisions=%7B%22children%22%3Atrue%7D");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "road-collisions");
  await expect(page).toHaveURL(/collisions=%7B%22children%22%3Atrue%7D/);
});

// Layers v5 (PR 1): Street trees are Green & trees › Green streets' dots at street zoom.
test("Green & trees › Green streets brings Show › Street trees with it", async ({ page }) => {
  await page.goto("/");
  await chooseView(page, "nature-score", "green-streets");
  await expect(page).toHaveURL(/layer=green-streets/);
  await expect(page).toHaveURL(/trees=on/);
  await chooseView(page, "nature-score", "area-score");
  await expect(page).toHaveURL(/layer=nature-score/);
  await expect(page).not.toHaveURL(/trees=/);
});

// Census 2021 layers (lib/census-layers.ts) are descriptive: the category is a view inside the item, the
// legend names what is counted and the source, the colours are the calm ramp and there is no rank.
test("People layers pick a category inside the item, with a factual legend and no rank", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const panel = await openLayersPanel(page);
  await panel.getByTestId("topic-group-people").click();
  // Layers v5: Main language and Passports held are Country of birth's picks; PR 3 adds Student areas (TS066).
  await expect(panel.locator(".topic-list .topic-item .topic-item__name")).toHaveText(["Ethnic makeup", "Country of birth", "Religion", "Residents' age", "Household type",
    "Year of arrival", "National identity", "Student areas"]);
  await panel.getByTestId("layer-census-ethnicity-asian").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "census-ethnicity-asian");
  await expect(panel).toBeVisible();
  const views = panel.getByTestId("topic-details").locator(".topic-views button");
  await expect(views).toHaveText(["Asian", "Black", "Mixed", "White", "Other"]);
  await expect(panel.getByTestId("topic-details")).not.toContainText("Rank in London");

  await chooseView(page, "census-ethnicity-asian", "white");
  await expect(page).toHaveURL(/layer=census-ethnicity-white/);
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Ethnic makeup · White");
  const legend = page.getByTestId("map-legend");
  await expect(legend.getByTestId("legend-caption")).toHaveText("Ethnic makeup · % of residents, White (Census 2021)");
  expect((await legend.locator(".map-legend-bar").getAttribute("data-colours")) ?? "").not.toMatch(/#1a9850|#d73027/);

  // Two levels: under the chosen group, all of it or one of its detailed groups (a second row of chips).
  const subviews = panel.getByTestId("topic-subviews").getByRole("button");
  await expect(subviews).toHaveText(["All White", "White British", "Irish", "Gypsy or Irish Traveller", "Roma", "Other White"]);
  await expect(panel.getByTestId("view-census-ethnicity-asian-white-all")).toHaveAttribute("aria-pressed", "true");
  await chooseView(page, "census-ethnicity-asian", "asian");
  await expect(subviews).toHaveText(["All Asian", "Indian", "Pakistani", "Bangladeshi", "Chinese", "Other Asian"]);
  await chooseView(page, "census-ethnicity-asian", "indian");
  await expect(page).toHaveURL(/layer=census-ethnicity-indian/);
  await expect(panel.getByTestId("view-census-ethnicity-asian-asian")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Ethnic makeup · Indian");
  await expect(legend.getByTestId("legend-caption")).toHaveText("Ethnic makeup · % of residents, Indian (Census 2021)");
  await expect(panel.getByTestId("topic-details")).not.toContainText("Rank in London");
  await chooseView(page, "census-ethnicity-asian", "mixed");
  for (const clipped of await subviews.evaluateAll((nodes) => nodes.map((node) => node.scrollWidth > node.clientWidth))) {
    expect(clipped).toBe(false);
  }

  // Eight religions wrap into rows; every button stays whole.
  await chooseView(page, "census-religion-christian", "none");
  for (const clipped of await panel.locator(".topic-views button").evaluateAll((nodes) => nodes.map((node) => node.scrollWidth > node.clientWidth))) {
    expect(clipped).toBe(false);
  }

  // A rank in an old link is ignored: Census layers are always actual shares.
  await page.goto("/?layer=census-religion-none&scale=percentile");
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toHaveText("Religion · % of residents, no religion (Census 2021)");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Religion · No religion");
});

test("a detailed ethnic group's link opens Ethnic makeup on its group and subgroup; a group's link still works", async ({ page }) => {
  await page.goto("/?layer=census-ethnicity-caribbean");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Ethnic makeup · Caribbean");
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toHaveText("Ethnic makeup · % of residents, Black Caribbean (Census 2021)");
  await openScaleSettings(page);
  const panel = page.getByTestId("layers-panel");
  await expect(panel.getByTestId("view-census-ethnicity-asian-black")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByTestId("view-census-ethnicity-asian-caribbean")).toHaveAttribute("aria-pressed", "true");

  await page.goto("/?layer=census-ethnicity-black");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Ethnic makeup · Black");
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toHaveText("Ethnic makeup · % of residents, Black (Census 2021)");
});

test("Country of birth: a world region per area, or a country picked from a list of MSOA figures", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  await panel.getByTestId("topic-group-people").click();
  await panel.getByTestId("layer-census-birth-uk").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "census-birth-uk");
  const details = panel.getByTestId("topic-details");
  // More than six views fold behind "+n" (v3 Fix 6).
  await expect(details.locator(".topic-views button")).toHaveText(["UK", "EU before 2004", "Joined EU 2004", "Romania, Bulgaria", "Croatia, Cyprus, Malta", "+6"]);
  await details.getByTestId("views-more-census-birth-uk").click();
  await expect(details.locator(".topic-views button")).toHaveText([
    "UK", "EU before 2004", "Joined EU 2004", "Romania, Bulgaria", "Croatia, Cyprus, Malta", "Europe, non-EU", "Africa", "Middle East & Asia", "Americas & Caribbean", "Oceania & other", "British Overseas",
  ]);
  for (const clipped of await details.locator(".topic-views button").evaluateAll((nodes) => nodes.map((node) => node.scrollWidth > node.clientWidth))) {
    expect(clipped).toBe(false);
  }
  await expect(details).not.toContainText("Rank in London");
  const legend = page.getByTestId("map-legend");
  await chooseView(page, "census-birth-uk", "eu8");
  await expect(page).toHaveURL(/layer=census-birth-eu8/);
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Country of birth · Joined EU 2004");
  await expect(legend.getByTestId("legend-caption")).toHaveText("Country of birth · % of residents, born in a country that joined the EU in 2004 (Poland, Lithuania, Latvia, Estonia, Czechia, Slovakia, Hungary, Slovenia) (Census 2021)");

  // One country: searched for, painted as each MSOA's figure, and said so on the list and the legend.
  // Layers v5: languages and passports are picks of the same list, each named by its table.
  const picks = panel.getByTestId("topic-picks");
  await expect(picks.getByText("Pick a country, language or passport")).toBeVisible();
  await expect(picks.getByTestId("topic-picks-note")).toHaveText("MSOA figures: each MSOA is one colour.");
  await picks.getByTestId("topic-picks-search").fill("polan");
  await expect(picks.locator(".topic-picks__list button")).toHaveText(["Poland", "Passport: Poland"]);
  await picks.getByTestId("topic-picks-search").fill("polish");
  await expect(picks.locator(".topic-picks__list button")).toHaveText(["Language: Polish"]);
  await picks.getByTestId("pick-main-language-polish").click();
  await expect(page).toHaveURL(/layer=census-language-polish/);
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Country of birth · Language: Polish");
  // A language is a per-area figure: no "whole MSOA" line for it.
  await expect(picks.getByTestId("topic-picks-note")).toHaveText("MSOA figures: each MSOA is one colour.");
  await picks.getByTestId("topic-picks-search").fill("polan");
  await picks.getByTestId("pick-poland").click();
  await expect(page).toHaveURL(/layer=census-birth-country-poland/);
  await expect(picks.getByTestId("pick-poland")).toHaveAttribute("aria-pressed", "true");
  await expect(details.locator(".topic-views button[aria-pressed='true']")).toHaveCount(0);
  await expect(picks.getByTestId("topic-picks-note")).toHaveText("MSOA figures: each MSOA is one colour: Poland is shown for each whole MSOA.");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Country of birth · Poland (MSOA)");
  await expect(legend.getByTestId("legend-caption")).toHaveText(
    "Country of birth · % of residents, born in Poland (Census 2021, MSOA figures) · MSOA figures: each MSOA is one colour");
  expect((await legend.locator(".map-legend-bar").getAttribute("data-colours")) ?? "").not.toMatch(/#1a9850|#d73027/);
  await picks.getByTestId("topic-picks-search").fill("atlantis");
  await expect(picks.getByRole("status")).toHaveText("Nothing matches “atlantis”.");

  // A country's link opens it again, and the search finds the item by a country's name.
  await page.goto("/?layer=census-birth-country-india");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Country of birth · India (MSOA)");
  const again = await openLayersPanel(page);
  await again.getByTestId("topic-search").fill("nigeria");
  // Every detailed table with a Nigerian category: the ethnic group, the country (passports are its picks) and the identity.
  await expect(again.locator(".topic-list .topic-item__name")).toHaveText(["Ethnic makeup", "Country of birth", "National identity"]);
});

test("an old Social rent link opens Tenure on its Social rent view", async ({ page }) => {
  await page.goto("/?layer=social-renting");
  await expect(page.getByTestId("legend-chip-layer")).toHaveText("Tenure · Social rent");
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toHaveText("Tenure · % of households, social rent (Census 2021)");
  // A phone opens on the groups: step into Homes & area, where the item shown is.
  await openScaleSettings(page);
  const panel = page.getByTestId("layers-panel");
  await expect(panel.getByTestId("view-census-tenure-owned-social-rent")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByTestId("view-census-tenure-owned-owned")).toBeVisible();
});

test("search finds items across groups and Enter chooses the first", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  const search = panel.getByTestId("topic-search");
  await search.fill("kebab");
  await expect(panel.getByRole("tab", { selected: true })).toHaveCount(0);
  // Layers v5: the café cuts are one item, Cafés.
  await expect(panel.locator(".topic-item")).toHaveCount(1);
  await expect(panel.locator(".topic-item").first()).toHaveText("Cafés");
  await search.fill("zzzz");
  await expect(panel.getByText("Nothing matches “zzzz”.")).toBeVisible();
  await search.fill("station");
  await search.press("Enter");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "station-access");
  await expect(panel).toBeVisible();
});

test("search: noise finds the Noise layer first, painted on its own scale", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  const search = panel.getByTestId("topic-search");
  await search.fill("noise");
  await expect(panel.locator(".topic-item").first()).toHaveText("Noise");
  await expect(panel.locator(".topic-item", { hasText: "Quiet nights" })).toHaveCount(0);
  await search.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("noise");
  await expect(page.getByTestId("map-legend").locator(".map-legend-bar")).toBeVisible();
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toContainText("55 dB");
});

test("search: pollution finds the Clean air layer, painted in NO2", async ({ page }) => {
  await page.goto("/");
  const panel = await openLayersPanel(page);
  const search = panel.getByTestId("topic-search");
  await search.fill("pollution");
  await expect(panel.locator(".topic-item").first()).toHaveText("Clean air");
  await search.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("layer")).toBe("air-no2");
  await expect(page.getByTestId("map-legend").locator(".map-legend-bar")).toBeVisible();
  await expect(page.getByTestId("map-legend").getByTestId("legend-caption")).toContainText("NO₂");
});

test("the panel is keyboard operable and Escape returns focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the desktop keyboard path");
  await page.goto("/");
  const toggle = page.getByTestId("layers-toggle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  // Focus starts on the item shown, in its open group; the arrows move row by row (None, groups, items).
  await expect(page.getByTestId("layer-price-per-square-metre")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("layer-typical-price")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("topic-group-cost")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("layer-none")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("topic-search")).toBeFocused();
  // Enter on a group opens it in place and closes the one open (an accordion, no step back).
  await page.getByTestId("topic-group-getting-around").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("topic-group-getting-around")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("topic-group-cost")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("layer-station-access")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("layers-panel")).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "price-per-square-metre");

  await page.keyboard.press("Enter");
  await page.getByTestId("topic-group-safety").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("layer-crime")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
});

test("on a desktop Layers is a floating menu beside its button, as tall as its rows; the dock stays put", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the desktop popover");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  const toggle = page.getByTestId("layers-toggle");
  const chip = page.getByTestId("legend-chip");
  const dock = page.getByTestId("map-dock");
  const before = await dock.boundingBox();
  const button = await toggle.boundingBox();
  // The button sits top-right of the map under the top bar, beside the dock; the chip bottom-left.
  expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(before?.x ?? 0);
  expect(button?.y ?? 0).toBeLessThan(150);
  const key = await chip.boundingBox();
  expect(key?.x ?? 99).toBeLessThanOrEqual(16);
  expect((key?.y ?? 0) + (key?.height ?? 0)).toBeGreaterThan(860);

  const panel = await openLayersPanel(page);
  const box = await panel.boundingBox();
  // 340px, level with the Layers button and left of the round buttons, clear of the dock; the dock and the area stay as they were.
  expect(box?.width).toBe(340);
  expect(Math.abs((box?.y ?? 0) - (button?.y ?? 0))).toBeLessThanOrEqual(1);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(button?.x ?? 0);
  expect(await dock.boundingBox()).toEqual(before);
  await expect(page.getByTestId("selected-area")).toBeVisible();
  await expect(chip).toBeVisible();
  // The MapSheet head (v4 Task 13/18): Layers · Default · ✕, then the search; the height is its content's (at most 70% of the window).
  await expect(panel.getByTestId("layers-close")).toBeVisible();
  await expect(panel.getByTestId("layers-default")).toBeDisabled();
  const first = await panel.getByTestId("topic-search").boundingBox();
  expect((first?.y ?? 0) - (box?.y ?? 0)).toBeLessThanOrEqual(72);
  expect(box?.height ?? 999).toBeLessThanOrEqual(900 * 0.7 + 1);
  // An accordion: a group opens in place and the one open closes; the menu grows and shrinks with it.
  await expect(panel.getByTestId("layer-income")).toBeHidden();
  await panel.getByTestId("topic-group-homes-area").click();
  await expect(panel.getByTestId("topic-group-cost")).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByTestId("topic-group-cost")).toBeVisible();
  await expect(panel.getByTestId("layer-income")).toBeVisible();
  // The closed Cost row names the item it holds.
  await expect(panel.getByTestId("topic-group-held-cost")).toHaveText("Price per m²");
  await panel.getByTestId("topic-group-homes-area").click();
  await expect(panel.getByTestId("layer-income")).toBeHidden();
  const shut = await panel.boundingBox();
  expect(shut?.height ?? 999).toBeLessThan(box?.height ?? 0);
  // Show opens its own card beside its button; Layers brings the menu back.
  await page.getByTestId("show-toggle").click();
  await expect(panel).toBeHidden();
  const show = page.getByTestId("show-panel");
  await expect(show.getByTestId("map-overlays")).toBeVisible();
  const showButton = await page.getByTestId("show-toggle").boundingBox();
  expect(Math.abs(((await show.boundingBox())?.y ?? 0) - (showButton?.y ?? 0))).toBeLessThanOrEqual(1);
  await toggle.click();
  await expect(panel).toBeVisible();

  // Escape closes and returns focus to whichever opened it: the button, or the chip.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  await chip.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(chip).toBeFocused();

  // With the dock folded to its strip, the button moves beside the strip.
  await page.getByTestId("evidence-sheet-close").click();
  await expect(dock).toHaveAttribute("data-expanded", "false");
  const strip = await dock.boundingBox();
  // They slide with the panel (300ms), then rest 12px from the strip.
  await expect.poll(async () => {
    const moved = await toggle.boundingBox();
    return Math.round((strip?.x ?? 0) - (moved?.x ?? 0) - (moved?.width ?? 0));
  }).toBe(12);
});

test("a click outside closes the card on a desktop; a phone's sheet stays while the map is used", async ({ page }, testInfo) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await openLayersPanel(page);
  await page.mouse.click(30, 150);
  if (testInfo.project.name === "mobile") {
    // v4 Task 13: at half the map stays live above the sheet.
    await expect(page.getByTestId("layers-panel")).toBeVisible();
    await page.getByTestId("layers-close").click();
  }
  await expect(page.getByTestId("layers-panel")).toBeHidden();
});

test("on a phone Layers is a MapSheet at half; the area sheet waits at its peek", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone layout");
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  const dock = page.getByTestId("map-dock");
  await expect.poll(() => dock.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  const snap = await dock.getAttribute("data-snap");
  const sheet = await dock.boundingBox();
  // A round 44px button and the chip ride above the sheet.
  const toggle = page.getByTestId("layers-toggle");
  const button = await toggle.boundingBox();
  expect(button?.width).toBe(44);
  expect(button?.height).toBe(44);
  expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(sheet?.y ?? 0);
  const key = await page.getByTestId("legend-chip").boundingBox();
  expect((key?.y ?? 0) + (key?.height ?? 0)).toBeLessThanOrEqual(sheet?.y ?? 0);
  expect((key?.x ?? 0) + (key?.width ?? 0)).toBeLessThanOrEqual(button?.x ?? 0);

  const panel = await openLayersPanel(page);
  const viewport = page.viewportSize()!;
  await expect(panel).toHaveAttribute("data-snap", "half");
  await expect.poll(() => panel.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  const box = await panel.boundingBox();
  expect(box?.x).toBe(0);
  expect(box?.width).toBe(viewport.width);
  expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - viewport.height)).toBeLessThanOrEqual(1);
  // Half: the map stays in view above it, the round buttons ride over its top.
  expect(box?.height ?? 0).toBeLessThan(viewport.height * 0.6);
  expect(((await toggle.boundingBox())?.y ?? 0) + 44).toBeLessThanOrEqual(box?.y ?? 0);
  await expect(panel.getByTestId("topic-search")).toBeInViewport();
  // One sheet at a time: the area sheet waits at its peek, the area still chosen.
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  // The same accordion as a desktop.
  await expect(panel.getByTestId("topic-group-cost")).toHaveText("Cost");
  await expect(panel.getByTestId("topic-group-getting-around")).toHaveText("Transport");
  await expect(panel.getByTestId("layer-income")).toBeHidden();
  await panel.getByTestId("topic-group-homes-area").click();
  await expect(panel.getByTestId("topic-group-cost")).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByTestId("layer-income")).toBeVisible();
  await panel.getByTestId("layer-income").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "income");
  // Choosing keeps the card open.
  await expect(panel).toBeVisible();
  await panel.getByTestId("layers-close").click();
  await expect(panel).toBeHidden();
  // The area comes back at its peek, never lost; a tap lifts it to where it was.
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  await page.getByTestId("evidence-sheet-reopen").click();
  await expect(dock).toHaveAttribute("data-snap", snap ?? "");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

  // ✕ closes it, and so does a pull down on its head.
  await openLayersPanel(page);
  await panel.getByTestId("layers-close").click();
  await expect(panel).toBeHidden();
  await openLayersPanel(page);
  const head = await panel.locator(".map-sheet__head").boundingBox();
  const x = (head?.x ?? 0) + 30;
  const y = (head?.y ?? 0) + 6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 60, { steps: 4 });
  await page.mouse.move(x, y + 140, { steps: 4 });
  await page.mouse.up();
  await expect(panel).toBeHidden();
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
  expect(sheet).not.toBeNull();
});
