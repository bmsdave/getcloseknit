import { expect, test, type Locator, type Page } from "./fixtures";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { openAreaPage } from "./evidence";
import { openMatchBuilder } from "./top-bar";
import { continueToReview, findMyArea } from "./wizard";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

// Tailor (docs/area-card-2026-10/personalisation-spec.md, v3 Fix 33): on the area page one chip under
// the tags ("Tailor this page" / "Tailored to: …") opens a small card: house types, the four skippable
// Tailor steps and My match. Tailoring only reorders and highlights: the 12 tiles, the chips and the
// sections keep their order and nothing is hidden, on the page and in the map's area view alike.
const PAGE = "/area/lsoa/E01000001";
const BRIEF = "/?selected=uk%3Alsoa%3AE01000001&period=2026-06";
const PAGE_TILES = ["price", "safety", "schools", "station-walk", "cycling", "noise", "nature", "air", "gp", "food-hygiene", "nightlife", "families"];
const PROFILE_KEY = "close-knit.preference-profile.v1";

async function openCard(page: Page, url = PAGE): Promise<Locator> {
  await page.goto(url);
  const card = await openAreaPage(page);
  await expect(card.getByTestId("area-tile-schools")).toContainText("within 1.5 km", { timeout: 20_000 });
  // The tiles come with the page; the sections follow once the area's evidence is in.
  await expect(card.locator("section.area-section")).toHaveCount(10, { timeout: 30_000 });
  return card;
}

const pageTiles = (card: Locator) => card.getByTestId("area-tiles").locator("[data-testid^=area-tile-]")
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")!.replace("area-tile-", "")));
const order = async (card: Locator) => ({
  tiles: await pageTiles(card),
  tabs: await card.getByTestId("area-tabs").locator("a[data-section]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-section"))),
  sections: await card.locator("section[data-section]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-section"))),
});
const stored = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), PROFILE_KEY);

async function openSteps(page: Page, card: Locator): Promise<Locator> {
  await card.getByTestId("tailor-chip").click();
  await card.getByTestId("tailor-edit").click();
  const wizard = page.getByTestId("tailor-wizard");
  // The steps load when first opened.
  await expect(wizard).toBeVisible({ timeout: 15_000 });
  return wizard;
}

test("skipping every step keeps the default page and saves nothing", async ({ page }) => {
  const card = await openCard(page);
  const chip = card.getByTestId("tailor-chip");
  await expect(chip).toHaveText("Tailor this page");
  const wizard = await openSteps(page, card);
  for (const step of [1, 2, 3]) {
    await expect(wizard.getByTestId("tailor-progress")).toHaveText(`Step ${step} of 4`);
    // Done is always in reach.
    await expect(wizard.getByTestId("tailor-done")).toBeVisible();
    await wizard.getByTestId("tailor-skip").click();
  }
  await expect(wizard.getByTestId("tailor-progress")).toHaveText("Step 4 of 4");
  await expect(wizard.getByTestId("tailor-skip")).toHaveCount(0);
  await wizard.getByTestId("tailor-done").click();
  await expect(wizard).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  expect(await pageTiles(card)).toEqual(PAGE_TILES);
  await expect(card.locator("[data-mine]")).toHaveCount(0);
  await expect(chip).toHaveText("Tailor this page");
});

test("who's moving reorders and highlights only; Edit and Reset from the card", async ({ page }) => {
  const card = await openCard(page);
  const before = await order(card);
  const wizard = await openSteps(page, card);
  // One tap answers and moves on.
  await wizard.getByTestId("tailor-household-kids-secondary").click();
  await expect(wizard.getByTestId("tailor-progress")).toHaveText("Step 2 of 4");
  await expect(wizard.getByTestId("tailor-market-buy")).toHaveAttribute("aria-pressed", "true");
  await wizard.getByTestId("tailor-done").click();

  await expect(card.getByTestId("tailor-chip")).toHaveText(/^Tailored to: Buy · kids at secondary/);
  // Schools opens on Secondary (listed first); road casualties come first in Safety, marked for you.
  await expect(card.getByTestId("school-phase-secondary")).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByTestId("school-phases").getByRole("button").first()).toHaveAttribute("data-testid", "school-phase-secondary");
  await expect(card.getByTestId("safety-key-numbers").locator(":scope > div").first()).toHaveAttribute("data-mine", "");
  // Nothing moved or went away.
  expect(await order(card)).toEqual(before);
  await expect(card.getByTestId("school-phase-primary")).toBeVisible();
  const saved = JSON.parse((await stored(page))!) as { household: string; school: { phases: string[] } };
  expect([saved.household, saved.school.phases]).toEqual(["kids-secondary", ["secondary"]]);

  // The card edits and resets.
  await card.getByTestId("tailor-chip").click();
  await card.getByTestId("tailor-reset").click();
  await expect(card.getByTestId("tailor-chip")).toHaveText("Tailor this page");
  await expect(card.getByTestId("school-phase-primary")).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator("[data-mine]")).toHaveCount(0);
  expect(await stored(page) ?? "").not.toContain("household");
});

test("house types put the household's prices first and draw their lines; the rest stay", async ({ page }) => {
  const card = await openCard(page);
  const before = await order(card);
  await card.getByTestId("tailor-chip").click();
  await card.getByTestId("tailor-type-terraced").click();
  await expect(card.getByTestId("tailor-type-terraced")).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByTestId("tailor-chip")).toHaveText(/^Tailored to: Buy · Terraced/);
  const types = card.getByTestId("price-types");
  await expect(types.locator("[data-testid^=price-type-]")).toHaveCount(4);
  await expect(types.locator("[data-testid^=price-type-]").first()).toHaveAttribute("data-testid", "price-type-T");
  await expect(card.getByTestId("price-type-T")).toHaveAttribute("data-mine", "");
  // PR #343: the household's types are marked and ringed; the others are never dimmed.
  await expect(card.getByTestId("price-type-F")).not.toHaveAttribute("data-mine", "");
  await expect(card.getByTestId("price-type-F")).not.toHaveAttribute("data-dim", "");
  await expect(card.getByTestId("market-trend-price").locator(".market-line")).toHaveAttribute("data-series", "T");
  // Homes keeps every type, the household's marked; its headline says how many homes are theirs.
  await expect(card.getByTestId("section-headline-homes")).toHaveText(/^Your types: \d+% of homes$/);
  await expect(card.getByTestId("people-topic-accommodation").locator(".share-row[data-highlight]")).toHaveText(/Terraced house/);
  // ...first (reordered, never hidden: Other and Show all still hold the rest).
  await expect(card.getByTestId("people-topic-accommodation").locator(".share-row").first()).toHaveAttribute("data-highlight", "");
  expect(await order(card)).toEqual(before);
  // Tailor alone is not a search: no budget is shown as the household's own.
  await expect(card.getByTestId("price-budget-fit")).toHaveCount(0);
});

// v4 Task 12: one area view. The map's panel shows the area page's 12 tiles in their one order whatever
// Tailor says (the old brief's Tailor slots, "For you" marks and x/10 tiles are gone); a phone's peek the first 4.
test("the map's area view keeps the page's tiles and order whatever Tailor says", async ({ page }) => {
  await page.addInitScript((profile) => {
    window.localStorage.setItem("close-knit.preference-profile.v1", JSON.stringify(profile));
    window.localStorage.setItem("close-knit.tailor-only.v1", "1");
  }, { ...DEFAULT_PROFILE, lifestyle: ["gym"] });
  await page.goto(BRIEF);
  const panel = page.getByTestId("evidence-panel");
  await expect(panel.getByTestId("area-tile-schools")).toContainText("within 1.5 km", { timeout: 20_000 });
  const peek = (await panel.getAttribute("data-view")) === "peek";
  expect(await pageTiles(panel)).toEqual(peek ? PAGE_TILES.slice(0, 4) : PAGE_TILES);
  await expect(panel.locator("[data-tile], [data-testid^=for-you-]")).toHaveCount(0);
  const card = await openCard(page);
  expect(await pageTiles(card)).toEqual(PAGE_TILES);
});

test("the steps work from the keyboard and Escape saves nothing", async ({ page }) => {
  const card = await openCard(page);
  const chip = card.getByTestId("tailor-chip");
  await chip.focus();
  await page.keyboard.press("Enter");
  await card.getByTestId("tailor-edit").focus();
  await page.keyboard.press("Enter");
  const wizard = page.getByTestId("tailor-wizard");
  await expect(wizard.locator("#tailor-heading")).toBeFocused();
  await expect(wizard.locator("#tailor-heading")).toHaveText("Who's moving?");
  // Tab reaches the first answer after the close button; Enter answers and moves on.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(wizard.getByTestId("tailor-household-solo")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(wizard.locator("#tailor-heading")).toHaveText("Buy or rent?");
  await expect(wizard.locator("#tailor-heading")).toBeFocused();
  // Every control in the steps is at least 44px tall (DESIGN.md § Buttons and controls).
  const heights = await wizard.locator("button").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(wizard).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  await expect(chip).toHaveText("Tailor this page");
});

// G01: Tailor from My match itself, under the ten; Done returns to My match, which names the answers.
test("My match › Tailor opens Tailor; after Done, My match shows its answers", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  await page.getByTestId("match-tailor-open").click();
  const tailor = page.getByTestId("tailor-wizard");
  await expect(tailor).toBeVisible();
  await tailor.getByTestId("tailor-household-kids-primary").click();
  await tailor.getByTestId("tailor-done").click();
  await expect(tailor).toBeHidden();
  await expect(findMyArea(page)).toBeVisible();
  await expect(page.getByTestId("match-tailor-summary")).toBeVisible();
});
