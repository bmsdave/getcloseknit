import { expect, test } from "./fixtures";

import { encodeBrief } from "../src/lib/brief-model";
import { encodeShareLink, exampleProfile } from "../src/lib/profile-state";
import { addChip, continueToReview, findMyArea, matchItem, seedSearch, typeBudget } from "./wizard";
import { openMatchBuilder } from "./top-bar";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

// My match is the search: what the household asked for is editable in the panel and drawn on
// the main map — places, marks, gains and compromises, prices against the budget, schools.

test("an agent's brief link opens My match on the main map", async ({ page }) => {
  const fragment = encodeBrief({
    areas: ["uk:lsoa:E01000001", "uk:lsoa:E01000002"], budget: [800000, 900000], market: "buy", bedrooms: 3,
    propertyType: "house", criteria: ["price", "safety"],
    destinations: [{ label: "King's Cross St Pancras", latitude: 51.530609, longitude: -0.123949 }],
  });
  await page.goto(`/brief${fragment}`);
  await expect(page).toHaveURL(/layer=personal-match/);
  await expect(page).not.toHaveURL(/profile=v\d/);
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "personal-match");
  // The search is the list: the budget, the place, what matters (v4 Task 21c).
  // A brief's range: comfortable to £800k, stretching to £900k.
  await expect(matchItem(page, "affordability")).toContainText("£800k");
  await expect(page.locator('[data-testid="match-item"][data-id^="place:"]')).toContainText("King's Cross St Pancras");
  await matchItem(page, "affordability").getByTestId("match-chip").click();
  // A house: every house type is chosen (Fix 33), the flat is not.
  const card = page.getByTestId("match-card-affordability");
  await expect(card.getByRole("group", { name: "Home" }).getByRole("button", { name: "House" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("group", { name: "Home" }).getByRole("button", { name: "Flat" })).toHaveAttribute("aria-pressed", "false");
  const home = card.getByTestId("home-types");
  for (const type of ["Terraced", "Semi", "Detached"]) await expect(home.getByRole("button", { name: type })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("group", { name: "Bedrooms" }).getByRole("button", { name: "3 bedrooms" })).toHaveAttribute("aria-pressed", "true");
  // v4.4: a link opens on the list (the area chosen in it); a row opens the one area view.
  await expect(page.getByTestId("match-ranking")).toBeVisible();
});

test("an incomplete brief link says so", async ({ page }) => {
  await page.goto("/brief#brief=v1.broken");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This brief link is incomplete.");
});

test("places, marks and compromises drive the ranking and the map", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  // "Parks nearby": one tap, the nearest park on foot joins the list.
  await addChip(page, "parks-nearby");
  await expect(matchItem(page, "place:park")).toContainText("Park ≤ 10");

  await page.getByTestId("match-ranking").getByRole("button", { name: /preview/ }).first().click();
  // v4.4: a row opens the one area view (verdict, tags, tiles), its score beside the name; no old in-list card.
  const view = page.getByTestId("area-view").filter({ visible: true });
  await expect(view).toBeVisible();
  await expect(page.getByTestId("area-view-score").filter({ visible: true })).toHaveText(/^\d+ match score$/);
  await expect(page.locator(".selected-area")).toHaveCount(0);
  await expect(view.getByRole("link", { name: "Open full area page" })).toHaveAttribute("href", /^\/area\/lsoa\/E0\d{7}/);
  await page.getByTestId("area-view-back").filter({ visible: true }).click();
  await expect(page.getByTestId("match-ranking")).toBeVisible();

  // The map carries the shortlist; schools nobody asked for stay off at London zoom.
  await expect(page.locator('[data-testid="match-map-area"]').first()).toBeAttached();
  await expect(page.locator('[data-testid="match-map-school"]')).toHaveCount(0);

  // A pinned place: Travel to › pin it, tap the map; the place joins the list and the map.
  await findMyArea(page).getByRole("button", { name: "Or pin it on the map" }).click();
  await page.mouse.click(...await openMapPoint(page));
  await expect(page.locator('[data-testid="match-item"][data-id^="place:pinned"]')).toContainText("Pinned place");
  await expect(page.locator('[data-testid="match-map-place"]')).toHaveCount(1);
});

/** A point where the map itself is on top (not the top bar or the dock), to tap it like a person would. */
async function openMapPoint(page: import("@playwright/test").Page): Promise<[number, number]> {
  const point = await page.evaluate(() => {
    const { innerWidth: width, innerHeight: height } = window;
    for (let y = height * 0.2; y < height * 0.9; y += 20) {
      for (let x = 20; x < width - 20; x += 20) {
        if (document.elementFromPoint(x, y)?.classList.contains("maplibregl-canvas")) return [x, y];
      }
    }
    return null;
  });
  if (!point) throw new Error("no visible map point");
  return point as [number, number];
}

test("your data lives with the search: erasing it returns to the first call to action", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  await expect(page.getByTestId("discuss-ai")).toHaveCount(0);
  const data = page.getByTestId("your-data");
  await data.locator("summary").click();
  await expect(data.getByLabel("Share redacted usage data to improve matching")).not.toBeChecked();
  await data.getByRole("button", { name: "Erase local profile" }).click();
  await data.getByRole("button", { name: "Confirm erase" }).click();
  await expect(page.getByTestId("match-budget-start")).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("close-knit.preference-profile.v1"))).toBeNull();
});

test("a criterion of your own on the map turns the panel into that criterion's key and ends", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  await expect(page.getByTestId("match-results")).toBeVisible();
  // The presets wait behind one "Compare places" button.
  await expect(page.getByTestId("preset-kebab-cafe")).toHaveCount(0);
  await page.getByTestId("compare-places").click();
  await page.getByTestId("preset-kebab-cafe").click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "custom:kebab-cafe");
  const focus = page.getByTestId("criterion-focus");
  await expect(focus.getByRole("heading", { level: 1 })).toHaveText("Kebab shops vs cafés");
  // One scale: the legend chip's; the panel repeats none (v3 Fix 21).
  await expect(focus.getByTestId("criterion-legend")).toHaveCount(0);
  await expect(page.getByTestId("map-legend").or(page.locator(".bivariate-legend"))).toHaveCount(1);
  await expect(focus.getByTestId("criterion-london")).toContainText("areas scored");
  await expect(focus.getByTestId("criterion-top").getByRole("listitem").first()).toBeVisible();
  await expect(focus.getByTestId("criterion-caveats")).toContainText("not who lives in an area");
  await expect(page.getByTestId("match-list")).toHaveCount(0);
  // Picking an area keeps the criterion panel and says how that area scores on it.
  await focus.getByTestId("criterion-top").getByRole("button").first().click();
  await expect(focus.getByTestId("criterion-selected")).toContainText(/kebabs & Turkish grills|place \(kebabs/);
  // "Add to my match" asks which way (no preset way) and how much it matters.
  await focus.getByTestId("criterion-add").click();
  await expect(focus.getByTestId("criterion-confirm")).toBeDisabled();
  await focus.getByTestId("criterion-direction-lower").click();
  await focus.getByTestId("criterion-confirm").click();
  await expect(focus).toContainText("In your match");
  await page.getByRole("button", { name: "← Back to My match" }).filter({ visible: true }).click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "personal-match");
  await expect(page.getByTestId("my-criterion-kebab-cafe")).toContainText("Kebab shops vs cafés");
  await expect(page.getByTestId("match-ranking")).toBeVisible();
});

test("a comparison link opens cold with its key, and picking one writes it to the address", async ({ page }) => {
  await page.goto("/?layer=custom:kebab-cafe");
  const focus = page.getByTestId("criterion-focus");
  // PR #318 (Layers v5): Kebab shops vs cafés left the menu; its link opens Cafés › Coffee vs kebab (MERGED_LAYERS).
  await expect(focus.getByRole("heading", { level: 1 })).toHaveText("Specialty coffee vs kebab shops");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "custom:good-coffee-kebab");
  await expect(page).toHaveURL(/layer=custom%3Agood-coffee-kebab/);
  await expect(page.getByTestId("match-list")).toHaveCount(0);
  // The key is the legend chip's alone (v3 Fix 21); counts in words, never scores, a median or the formula on show.
  await expect(focus.getByTestId("criterion-legend")).toHaveCount(0);
  await expect(page.getByTestId("legend-chip")).toBeVisible();
  await expect(focus.getByTestId("criterion-top")).toContainText(/kebabs & Turkish grills|place \(kebabs/);
  for (const hidden of [/[+−-]0\.\d\d/, /median/, /\(A - B\)/]) {
    expect(await focus.evaluate((element) => (element as HTMLElement).innerText)).not.toMatch(hidden);
  }
  await expect(focus.getByText("How this works")).toBeVisible();

  // With no search yet, My match is its three start rows; "Compare places" waits for a search.
  await page.getByRole("button", { name: "← Back to My match" }).filter({ visible: true }).click();
  await expect(page.getByTestId("match-budget-start")).toBeVisible();
  await seedSearch(page);
  await page.reload();
  // Retried: a click before hydration lands on a button without a handler.
  await expect(async () => {
    const toggle = page.getByTestId("compare-places");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(page.getByTestId("preset-gyms")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.getByTestId("preset-gyms").click();
  await expect(page).toHaveURL(/layer=custom%3Agyms/);
});

test("the budget is honest: past its stretch an area scores 0 and leaves the ten; the chip counts it", async ({ page }) => {
  // Preview ballparks: North London £440k, South Bank £510k, Westminster £600k. With a £500k maximum the last two are
  // past the budget's stretch: a fit of 0 scores 0 (21e: red on the map, never hidden as out).
  await seedSearch(page, {
    targetBudget: 400000, maximumBudget: 500000,
    factors: [
      { factorId: "affordability", weight: 3, direction: "target-range", minimumUtility: null, maximumUtility: null },
      { factorId: "crime", weight: 5, direction: "lower", minimumUtility: null, maximumUtility: null },
    ],
  });
  await page.goto("/?layer=personal-match");
  const top = page.getByTestId("match-top");
  await expect(top.getByTestId("match-row").first()).toBeVisible();
  await expect(top).not.toContainText("South Bank preview");
  // South Bank (£510k) and Westminster (£600k) are past the £500k stretch.
  await expect(matchItem(page, "affordability").getByTestId("match-item-cut")).toHaveText("−2");
  await page.getByTestId("match-list-bottom").click();
  await expect(page.getByTestId("match-bottom")).toContainText("South Bank preview");
  await page.getByTestId("match-list-top").click();

  // A bigger budget brings it back.
  await typeBudget(page, "650000");
  await expect(top).toContainText("South Bank preview");
  await expect(matchItem(page, "affordability").getByTestId("match-item-cut")).toHaveCount(0);
});

// C6: the shared card's summary is the sender's whole search: it wraps on a phone, never an ellipsis.
for (const width of [320, 390]) {
  test(`at ${width}px the shared search wraps with nothing cut off`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/?layer=personal-match${encodeShareLink(exampleProfile(), [])}`);
    const line = page.getByTestId("shared-banner").locator(".shared-card__line");
    await expect(line).toContainText("A shared London search · Buy up to £600k · 2-bed home");
    const fit = await line.evaluate((node) => ({
      ellipsis: getComputedStyle(node).textOverflow, nowrap: getComputedStyle(node).whiteSpace === "nowrap",
      cut: node.scrollWidth > node.clientWidth + 1, lines: Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)),
    }));
    expect(fit).toMatchObject({ ellipsis: "clip", nowrap: false, cut: false });
    expect(fit.lines).toBeGreaterThan(1);
  });
}

// G02: ♡ on each match row and on the open area's card saves the area; ♡ N counts it at once.
test("a match row's ♡ saves the area and the header counts it", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  const ranking = page.getByTestId("match-ranking");
  await expect(page.getByTestId("match-results")).toBeVisible();
  await expect(page.getByTestId("header-saved-areas")).toHaveCount(0);
  const heart = ranking.getByTestId("match-row-save").first();
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("header-saved-areas")).toHaveAttribute("aria-label", "Saved (1)");
  // The area view's ♡ (v4.4: a row opens it) is the same save.
  await ranking.locator(".match-rows .match-row__main").first().click();
  const save = page.getByTestId("evidence-panel").filter({ visible: true }).getByTestId("save-area");
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await save.click();
  await expect(page.getByTestId("header-saved-areas")).toHaveCount(0);
  await page.getByTestId("area-view-back").filter({ visible: true }).click();
  await expect(heart).toHaveAttribute("aria-pressed", "false");
});

// G16: a bare shared link (no layer) opens My match with the shared banner, not the price layer.
test("a bare #profile link opens My match with the shared banner", async ({ page }) => {
  await page.goto(`/${encodeShareLink(exampleProfile(), [])}`);
  await expect(page).toHaveURL(/layer=personal-match/);
  await expect(page.getByTestId("shared-banner")).toHaveCount(1);
});
