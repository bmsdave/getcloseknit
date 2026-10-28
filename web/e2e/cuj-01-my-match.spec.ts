import { expect, test, type Page } from "./fixtures";

import { PROFILE_KEY, SEEDED_SEARCH, typeBudget } from "./wizard";

// CUJ-01 v4 (boards V4-21b-cuj-my-match, CUJ01-find-my-area-v4): My match without a wizard, phone and desktop.
// Budget → map coloured → Travel to → What matters → Soften (Undo) → Fine-tune → reorder → area → Top 10 | Bottom 10.

const list = (page: Page) => page.getByTestId("match-list");
const item = (page: Page, id: string) => page.locator(`[data-testid="match-item"][data-id="${id}"]`);

/**
 * The list has stopped moving: its rows at the same place on two reads in a row and no slide playing. A chip's
 * pack lands after its rank (the count and the peek above the rows change height), so boxes read before it went
 * stale under load and the drag dropped short (about 1 run in 3).
 */
async function settled(page: Page): Promise<void> {
  await expect(list(page).getByTestId("areas-left")).toBeVisible();
  let last = "";
  await expect.poll(async () => {
    const now = await list(page).evaluate((root) => JSON.stringify([
      [...root.querySelectorAll("[data-testid='match-item']")].map((row) => Math.round(row.getBoundingClientRect().top)),
      root.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
    ]));
    const still = now === last && now.endsWith(",0]");
    last = now;
    return still;
  }, { intervals: [100] }).toBe(true);
}

/** The ids of the list's criteria in order (Musts first). */
async function order(page: Page): Promise<string[]> {
  return page.getByTestId("match-item").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-id") ?? ""));
}

test("first visit: a labelled start, no wizard, the budget focused; the map colours after the budget", async ({ page }) => {
  await page.goto("/");
  const start = page.getByTestId("intro-find");
  await expect(start).toBeVisible();
  // v4 Task 36 / 28: one primary on screen: the card's labelled start, the round My match button calm meanwhile.
  const round = page.getByTestId("find-my-area");
  const [startFill, roundFill] = await Promise.all([start, round].map((locator) => locator.evaluate((node) => getComputedStyle(node).backgroundColor)));
  expect(roundFill).not.toBe(startFill);
  // v4 Task 28: nothing chosen yet, so Show carries no count.
  await expect(page.locator(".map-round__count")).toHaveCount(0);
  await start.click();
  await expect(list(page)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Find my area" })).toHaveCount(0);
  const budget = list(page).getByTestId("budget-max");
  await expect(budget).toBeFocused();
  await expect(list(page).getByTestId("match-travel")).toBeVisible();
  await expect(list(page).getByTestId("what-matters")).toContainText("Safer streets");
  // Two taps: type the maximum, Enter. The budget joins as a Must on top and the ranking appears.
  await budget.fill("650k");
  // The keyboard, not the field: the start row takes a budget by itself after a 900 ms pause and goes with its field.
  await page.keyboard.press("Enter");
  // v4.4: the chip names both ends, so the £650k typed is never hidden behind "≤ £600k"; the card says the stretch.
  await expect(item(page, "affordability")).toContainText("Budget ≤ £600k–£650k");
  await expect(item(page, "affordability").getByTestId("match-item-rank")).toHaveText("Must");
  await item(page, "affordability").getByTestId("match-chip").click();
  await expect(page.getByTestId("match-card-affordability").getByTestId("match-card-line"))
    .toHaveText("Typical price here ≤ £600k · stretch to £650k");
  await expect(list(page).getByTestId("areas-left")).toBeVisible();
  await expect(page.getByTestId("match-top").getByTestId("match-row").first()).toBeVisible();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), PROFILE_KEY)).toContain("\"order\":[\"affordability\"]");
});

test("Travel to a kind: \"gym\" offers the nearest gym on foot before any address (CUJ-13 v4)", async ({ page }) => {
  await page.goto("/?layer=personal-match");
  await typeBudget(page, "650k");
  await list(page).getByTestId("travel-to").fill("gym");
  const kind = list(page).getByTestId("travel-kind").first();
  await expect(kind).toHaveText("Gym · ≤ 10 min walk");
  await kind.click();
  // The same card as What matters › Gym nearby: walk minutes with the +50% soft edge, ranked like any criterion.
  await expect(item(page, "place:gym")).toContainText("Gym ≤ 10–15′");
  await expect(item(page, "place:gym").getByTestId("match-item-rank")).toHaveText("#1");
});

test("the CUJ: places, chips, Soften with Undo, Fine-tune, reorder, an area, Top 10 | Bottom 10, share", async ({ page, isMobile }) => {
  await page.goto("/?layer=personal-match");
  await typeBudget(page, "650k");

  // Travel to: a station, 35 min by default, ranked like any criterion.
  await list(page).getByTestId("travel-to").fill("Waterloo");
  await list(page).getByTestId("travel-options").getByRole("button").first().click();
  const place = page.locator('[data-testid="match-item"][data-id^="place:"]');
  await expect(place).toContainText("Waterloo preview station ≤ 35–53′");
  await expect(place.getByTestId("match-item-rank")).toHaveText("#1");

  // What matters: one tap each, the chip joins at the end with its weight from the place in the list.
  await list(page).getByTestId("chip-safer-streets").click();
  await list(page).getByTestId("chip-good-schools").click();
  await expect(item(page, "range:crime").getByTestId("match-item-rank")).toHaveText("#2");
  await expect(item(page, "range:schools").getByTestId("match-item-rank")).toHaveText("#3");
  await expect(item(page, "range:schools").getByTestId("match-item-weight")).toHaveText("11%");
  await expect(list(page).getByTestId("chip-safer-streets")).toHaveCount(0);

  // Soften: names what cuts most and what one step brings back; Undo in the toast puts it back.
  const hint = list(page).getByTestId("soften-hint");
  await expect(hint).toBeVisible();
  const before = await list(page).getByTestId("areas-left").textContent();
  await hint.getByTestId("soften").click();
  await expect(page.getByTestId("map-toast-text")).toContainText("now");
  await page.getByTestId("map-toast-action").click();
  await expect(list(page).getByTestId("areas-left")).toHaveText(before ?? "");

  // A chip opens its card in place: the simple level (one handle, the soft edge a fade, Must).
  await item(page, "range:crime").getByTestId("match-chip").click();
  const card = page.getByTestId("match-card-range:crime");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("one-handle")).toBeVisible();
  await expect(card.getByTestId("match-card-line")).toContainText("up to");
  if (!isMobile) {
    // Fine-tune (desktop; a phone shows the simple level): the histogram, the edge handles and the priority.
    await card.getByTestId("fine-tune").click();
    await expect(card.getByTestId("match-card-priority")).toContainText("Priority #2 of 3");
    await expect(card.getByTestId("range-slider")).toBeVisible();
  }
  // Must moves it into the Must block, with no weight; Must off brings it back at the end.
  await card.getByTestId("match-card-must").click();
  await expect(item(page, "range:crime").getByTestId("match-item-rank")).toHaveText("Must");
  await expect(item(page, "range:crime").getByTestId("match-item-weight")).toHaveCount(0);
  await page.getByTestId("match-card-range:crime").getByTestId("match-card-must").click();
  expect(await order(page)).toEqual(["affordability", expect.stringMatching(/^place:/), "range:schools", "range:crime"]);

  // Reorder from the keyboard (≡ ↑): Good schools to #1; the top ten re-sort, Undo in the toast.
  const handle = item(page, "range:schools").locator(".match-item__handle");
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("map-toast-text")).toHaveText("Good schools now #1 · top 10 re-sorted");
  await expect(item(page, "range:schools").getByTestId("match-item-rank")).toHaveText("#1");
  await expect(item(page, "range:schools").getByTestId("match-item-weight")).toHaveText("61%");

  // The ten: each row says why, in the household's priority order.
  const top = page.getByTestId("match-top");
  await expect(top.getByTestId("match-row").first().getByTestId("match-row-why")).toContainText("#");
  await top.getByTestId("match-row").first().locator(".match-row__main").click();
  // v4.4: the row opens the one area view; "← My match" goes back to the ten.
  await expect(page.getByTestId("area-view").filter({ visible: true })).toBeVisible();
  await page.getByTestId("area-view-back").filter({ visible: true }).click();

  // Bottom 10: the ten least like the search, in the address for the map's pins (per user, never public).
  await page.getByTestId("match-list-bottom").click();
  await expect(page.getByTestId("match-bottom")).toBeVisible();
  await expect(page.getByTestId("match-results")).toContainText("Least like your search");
  await expect(page).toHaveURL(/[?&]list=bottom/);
  await page.getByTestId("match-list-top").click();
  await expect(page).not.toHaveURL(/[?&]list=bottom/);

  // Share: the ordered list as a #profile=v3. link.
  await page.getByTestId("share-search").click();
  await page.getByTestId("share-preview").getByRole("button", { name: "Confirm share" }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/^#profile=v3\./);

  // A reload keeps the search in its order.
  const kept = await order(page);
  await page.goto("/?layer=personal-match");
  await expect.poll(() => order(page)).toEqual(kept);
});

test("drag ≡ reorders the ranked list (Task 21d)", async ({ page, isMobile }) => {
  test.skip(isMobile, "a mouse drag; phones long-press (the keyboard path is in the CUJ above)");
  await page.goto("/?layer=personal-match");
  await typeBudget(page, "650k");
  await list(page).getByTestId("chip-safer-streets").click();
  await list(page).getByTestId("chip-good-schools").click();
  // The pack scored with all three: the rows move no more once it lands.
  const scored = page.waitForResponse((response) => response.url().includes("/api/v1/matches")
    && (response.request().postData() ?? "").includes("noise"));
  await list(page).getByTestId("chip-quiet-streets").click();
  await expect(item(page, "range:noise").getByTestId("match-item-rank")).toHaveText("#3");
  await scored;
  await settled(page);
  const handle = item(page, "range:noise").locator(".match-item__handle");
  const target = await item(page, "range:crime").boundingBox();
  const from = await handle.boundingBox();
  const x = from!.x + from!.width / 2;
  await page.mouse.move(x, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, target!.y + 4, { steps: 8 });
  // The rows the lifted one passed slide out of its way (180 ms); one more move once they rest reads the drop slot
  // from where they are, not from mid-slide.
  await page.waitForTimeout(250);
  await page.mouse.move(x, target!.y + 3);
  await page.mouse.up();
  await expect(item(page, "range:noise").getByTestId("match-item-rank")).toHaveText("#1");
  await expect(page.getByTestId("map-toast-text")).toHaveText("Quiet streets now #1 · top 10 re-sorted");
});

test("an old wizard search opens as the list, its priorities as range chips in order", async ({ page }) => {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), { key: PROFILE_KEY, value: SEEDED_SEARCH });
  await page.goto("/?layer=personal-match");
  await expect(item(page, "range:crime")).toContainText("Safer streets");
  // Equal weights keep the old order: the budget, then Safer streets.
  await expect.poll(() => order(page)).toEqual(["affordability", "range:crime"]);
});

test("Where (Task 8): zones are a criterion in My match, not in Show", async ({ page }) => {
  await page.goto("/?layer=personal-match");
  await typeBudget(page, "650k");
  await list(page).getByTestId("chip-where").click();
  await list(page).getByTestId("where-add-station").click();
  await list(page).getByTestId("where-search").fill("Highbury");
  await list(page).getByRole("button", { name: /Highbury preview station/ }).click();
  await expect(item(page, "zone")).toContainText("Where");
  await item(page, "zone").getByTestId("match-chip").click();
  await expect(page.getByTestId("where-zones")).toContainText("Highbury");
  // Show has no "Areas you drew" any more.
  const toggle = page.getByTestId("show-toggle");
  await toggle.click();
  await expect(page.getByTestId("show-panel")).toBeVisible();
  await expect(page.getByTestId("show-panel").getByTestId("draw-zone")).toHaveCount(0);
  await expect(page.getByTestId("show-panel")).not.toContainText("Areas you drew");
});

test("phone: My match is the one MapSheet; the example opens lowered on London", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone sheet");
  await page.goto("/");
  await page.getByTestId("intro-example").click();
  const sheet = page.getByTestId("match-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-snap", "collapsed");
  await expect(sheet.getByTestId("match-peek")).toContainText("3 criteria");
  // v4 Task 28: the map frames London (prod today lands at zoom 9 south of it).
  await expect.poll(() => {
    const query = new URL(page.url()).searchParams;
    const [lat, lng, zoom] = ["lat", "lng", "zoom"].map((key) => Number(query.get(key) ?? NaN));
    return lat > 51.38 && lat < 51.62 && lng > -0.35 && lng < 0.15 && zoom >= 9.5;
  }, { timeout: 10_000 }).toBe(true);
  // Up to half, then ✕ leaves My match.
  await sheet.getByTestId("map-sheet-handle").click();
  await expect(sheet).not.toHaveAttribute("data-snap", "collapsed");
  await page.getByTestId("match-sheet-close").click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("close-knit")).not.toHaveAttribute("data-active-metric", "personal-match");
});
