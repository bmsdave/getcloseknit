import { expect, test, type Page } from "./fixtures";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";

// ♡ Saved (Saved v2): areas, homes, schools and places in one panel on the map, with no search
// needed; chips filter by kind; Compare on a block heading opens /compare for that kind only.

const SHORTLISTS = "close-knit.saved-shortlists.v1";
const ITEMS = "close-knit.saved-items.v1";

async function seed(page: Page) {
  await page.addInitScript(([shortlistsKey, itemsKey, profile]) => {
    if (window.localStorage.getItem("e2e-seeded")) return;
    window.localStorage.setItem("e2e-seeded", "1");
    window.localStorage.setItem(shortlistsKey, JSON.stringify([{
      schemaVersion: "saved-shortlist.v1", id: "s1", name: "My shortlist", createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z", candidates: ["uk:lsoa:E01000001", "uk:lsoa:E01000002"],
      candidateNames: { "uk:lsoa:E01000001": "Westminster preview", "uk:lsoa:E01000002": "North London preview" },
      profile, mode: "demo", release: "preview-2026-09", evidence: [],
    }]));
    window.localStorage.setItem(itemsKey, JSON.stringify({ schemaVersion: "saved-items.v1", items: [
      { kind: "place", id: "p1", name: "Better Gym", meta: "Gym", at: [-0.12, 51.5], savedAt: "2026-10-02T10:00:00.000Z" },
      { kind: "school", id: "100001", name: "Preview Primary", meta: "Primary school", href: "/school/100001", at: [-0.13, 51.51], savedAt: "2026-10-02T10:00:00.000Z" },
    ] }));
  }, [SHORTLISTS, ITEMS, DEFAULT_PROFILE] as const);
}

test("♡ N opens Saved: chips, blocks by kind, On map hearts and unsave", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  const heart = page.getByTestId("header-saved-areas");
  await expect(heart).toHaveAttribute("aria-label", "Saved (4)");
  await heart.click();
  const panel = page.getByTestId("saved-panel");
  // v4.4: "Saved" alone (the count is in ♡ N and on the chips).
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Saved");
  await expect(panel.getByTestId("saved-filter-areas")).toContainText("2");
  await expect(panel.getByTestId("saved-block-areas").getByTestId("saved-row")).toHaveCount(2);
  await expect(panel.getByTestId("saved-block-schools")).toContainText("Preview Primary");
  await expect(panel.getByTestId("saved-block-places")).toContainText("Better Gym");
  // Places are never compared; areas are, once two are ticked.
  await expect(panel.getByTestId("saved-block-places").getByRole("button", { name: "Compare" })).toHaveCount(0);
  await expect(panel.getByTestId("saved-row-tick")).toHaveCount(2);
  // The automatic "My shortlist" is the Areas block itself: not listed a second time.
  await expect(panel.getByTestId("saved-block-shortlists")).toHaveCount(0);

  await panel.getByTestId("saved-filter-places").click();
  await expect(panel.getByTestId("saved-filter-places")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByTestId("saved-block-areas")).toHaveCount(0);
  await expect(panel.getByTestId("saved-block-places")).toBeVisible();

  // On map: the gym and the school as hearts (areas join once their outlines load).
  await expect(page.getByTestId("saved-pin").first()).toBeAttached({ timeout: 15_000 });
  expect(await page.getByTestId("saved-pin").count()).toBeGreaterThanOrEqual(2);
  await panel.getByTestId("saved-on-map").click();
  await expect(panel.getByTestId("saved-on-map")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("saved-pin")).toHaveCount(0);

  await panel.getByTestId("saved-row-unsave").click();
  await expect(heart).toHaveAttribute("aria-label", "Saved (3)");
  await panel.getByTestId("saved-close").click();
  await expect(panel).toHaveCount(0);
});

// v4 Task 52: each saved area says what changed since this device last opened Saved; a first visit only
// records what it saw. Rows carry no unexplained dot (v4 Task 45).
test("saved areas say what changed since the last visit", async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    if (window.localStorage.getItem("e2e-since")) return;
    window.localStorage.setItem("e2e-since", "1");
    window.localStorage.setItem("close-knit.saved-since.v1", JSON.stringify({ schemaVersion: "saved-since.v2", areas: {
      "uk:lsoa:E01000001": { on: "2026-10-01", newest: "2026-01-31", ppm: 5_000, windowEnd: "2025-07" },
    } }));
  });
  await page.goto("/?saved=1");
  const areas = page.getByTestId("saved-panel").getByTestId("saved-block-areas");
  const rows = areas.getByTestId("saved-row");
  await expect(rows.first().getByTestId("saved-row-since")).toHaveText(/^Since 1 Oct: \d+ new sales? · £\/m² up \d+%$/);
  // v4.6: the move is the £/m² on the same row against the £5,000 seen on 1 Oct (one series, not the market median).
  const meta = await rows.first().getByTestId("saved-row-meta").innerText();
  const shown = Number(/£([\d,]+)\/m²/.exec(meta)![1].replace(/,/g, ""));
  const percent = Number(/up (\d+)%/.exec(await rows.first().getByTestId("saved-row-since").innerText())![1]);
  // The row rounds to £100: the % sits within that rounding of the shown figure's move.
  expect(Math.abs(percent - (shown / 5_000 - 1) * 100)).toBeLessThanOrEqual(1.5);
  await expect(rows.first().getByTestId("saved-row-since")).toHaveAttribute("data-changed", "true");
  await expect(areas.getByTestId("saved-row-since")).toHaveCount(1);
  await expect(areas.locator("svg.dot")).toHaveCount(0);
  // Both areas are recorded for the next visit; the same day still compares with 1 Oct.
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("close-knit.saved-since.v1") ?? "{}"));
  expect(Object.keys(stored.areas).sort()).toEqual(["uk:lsoa:E01000001", "uk:lsoa:E01000002"]);
  expect(stored.areas["uk:lsoa:E01000001"].previous.on).toBe("2026-10-01");
  await page.goto("/?saved=1");
  await expect(page.getByTestId("saved-panel").getByTestId("saved-row-since").first()).toHaveText(/^Since 1 Oct: /);
});

test("Compare on Saved › Areas opens /compare with the ticked areas side by side", async ({ page }) => {
  await seed(page);
  await page.goto("/?saved=1");
  const panel = page.getByTestId("saved-panel");
  // v4.6 (CUJ14 board, 2 taps): Saved opens with both areas ticked and Compare · 2 ready.
  await expect(panel.getByTestId("saved-compare-areas")).toHaveText("Compare · 2");
  await expect(panel.getByTestId("saved-tick-hint")).toHaveCount(0);
  for (const tick of await panel.getByTestId("saved-row-tick").all()) await expect(tick).toBeChecked();
  await panel.getByTestId("saved-compare-areas").click();
  await expect(page).toHaveURL(/\/compare\?kind=places&ids=uk%3Alsoa%3AE01000001,uk%3Alsoa%3AE01000002/);
  const table = page.getByTestId("compare-table");
  await expect(table.getByTestId("compare-column")).toHaveCount(2);
  await expect(table.getByTestId("compare-row").first()).toBeVisible();
  await expect(table.getByTestId("compare-best").first()).toBeVisible();
  await expect(page.getByTestId("compare-kind-places")).toHaveAttribute("aria-current", "page");
  // The compared areas wait in the map's tray.
  await page.goto("/");
  await expect(page.getByTestId("compare-tray")).toContainText("Compare · 2");
  await expect(page.getByTestId("compare-tray-open")).toHaveAttribute("href", /\/compare\?kind=places/);
});

test("a school's ♡ saves it to Saved › Schools", async ({ page }) => {
  await page.goto("/school/100001");
  const save = page.getByTestId("school-save");
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("header-saved-areas")).toHaveAttribute("aria-label", "Saved (1)");
  await page.getByTestId("header-saved-areas").click();
  await expect(page.getByTestId("saved-panel").getByTestId("saved-block-schools")).toBeVisible({ timeout: 15_000 });
});

test("/compare never mixes kinds, and its phone layout never scrolls the page sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/compare?kind=schools&ids=100001,uk:lsoa:E01000001,100002");
  await expect(page.getByTestId("compare-table").getByTestId("compare-column")).toHaveCount(2);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(wide).toBe(false);
});
