import { expect, test, type Page } from "./fixtures";

import type { PreferenceProfile } from "../src/lib/contracts";
import { encodeShareLink, encodeSharedProfile, exampleProfile } from "../src/lib/profile-state";
import { PROFILE_KEY, SEEDED_SEARCH, seedSearch } from "./wizard";

// Sharing always answers in words (role=status), and a shared link reads as someone else's search.

/** No share sheet; a clipboard that records what it was given, or refuses. */
async function stubClipboard(page: Page, works = true) {
  await page.addInitScript((ok) => {
    Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => {
        if (!ok) throw new DOMException("denied", "NotAllowedError");
        (window as unknown as { copied: string }).copied = text;
      },
    } });
  }, works);
}

async function confirmProfileShare(page: Page) {
  await page.getByTestId("share-search").click();
  await page.getByRole("button", { name: "Confirm share" }).click();
}

test("sharing the search copies the link and says so in the map toast (the review said who sees what)", async ({ page }) => {
  await stubClipboard(page);
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  // The review before sharing names who sees what.
  await page.getByTestId("share-search").click();
  await expect(page.getByRole("dialog", { name: "Review before sharing" })).toContainText("Anyone with this link sees these private details");
  await page.getByRole("button", { name: "Confirm share" }).click();
  // v4.2 (board V4-10): "Link copied." is the map toast, 3 s; no second line in the panel.
  await expect(page.getByTestId("map-toast")).toHaveAttribute("data-kind", "link-copied");
  await expect(page.getByTestId("map-toast-text")).toHaveText("Link copied.");
  await expect(page.getByTestId("match-ranking").getByTestId("share-status")).toHaveText("");
  // It goes by itself (another map notice may take its place: one at a time).
  await expect(page.locator('[data-testid="map-toast"][data-kind="link-copied"]')).toHaveCount(0, { timeout: 5_000 });
  const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  // Only the search travels: the results layer and the profile, never the map's position.
  expect(copied).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?layer=personal-match#profile=v3\.[\w-]+$/);
  expect(new URL(copied).hash).toBe(new URL(page.url()).hash);
});

test("a refused clipboard shows the link to copy instead of failing silently", async ({ page }) => {
  await stubClipboard(page, false);
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  await confirmProfileShare(page);
  await expect(page.getByTestId("share-status").first()).toContainText("Couldn't copy the link. Copy it from here");
  await expect(page.getByLabel("Link to share")).toHaveValue(/#profile=v3\./);
});

test("the system share sheet is used where there is one", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "share", { configurable: true,
      value: async (data: { url: string }) => { (window as unknown as { shared: string }).shared = data.url; } });
  });
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  await confirmProfileShare(page);
  await expect(page.getByTestId("share-status").first()).toHaveText("Link shared — anyone with it sees your budget and place");
  expect(await page.evaluate(() => (window as unknown as { shared: string }).shared)).toMatch(/#profile=v3\./);
});

test("a shared link opens as this search until the recipient makes it theirs", async ({ page }) => {
  const shared = { ...SEEDED_SEARCH, targetBudget: 480000, maximumBudget: 600000 } as unknown as PreferenceProfile;
  await page.goto(`/?layer=personal-match${encodeSharedProfile(shared)}`);
  const panel = page.getByTestId("match-ranking");
  await expect(panel.getByRole("heading", { level: 2, name: "This search" })).toBeVisible();
  const banner = panel.getByTestId("shared-banner");
  await expect(banner).toContainText("A shared London search · Buy up to £600k · 2-bed home");
  await expect(banner).not.toContainText("shortlist");
  await expect(banner.getByRole("link", { name: "What is Close Knit?" })).toHaveAttribute("href", "/guide");
  // Opening a link stores nothing.
  expect(await page.evaluate((key) => window.localStorage.getItem(key), PROFILE_KEY)).toBeNull();

  await banner.getByRole("button", { name: "Make it mine" }).click();
  // Desktop: the panel's heading; a phone: its sheet's title.
  await expect(page.getByRole("heading", { level: 2, name: "My match" }).filter({ visible: true })).toHaveCount(1);
  await expect(panel.getByTestId("shared-banner")).toHaveCount(0);
});

test("a shared link carries the compared areas, ticked for the recipient but not stored", async ({ page }) => {
  await stubClipboard(page);
  await seedSearch(page);
  await page.goto("/?layer=personal-match&lat=51.5&lng=-0.12&zoom=12");
  await page.getByRole("checkbox", { name: "Compare North London preview" }).click();
  await page.getByRole("checkbox", { name: "Compare South Bank preview" }).click();
  await page.getByTestId("share-search").click();
  const review = page.getByRole("dialog", { name: "Review before sharing" });
  await expect(review).toContainText("the areas you are comparing");
  await expect(review.getByTestId("share-compared")).toHaveText("2 compared areas: North London preview, South Bank preview");
  await review.getByRole("button", { name: "Confirm share" }).click();
  await expect(page.getByTestId("map-toast-text")).toHaveText("Link copied.");
  const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(copied).not.toMatch(/lat=|lng=|zoom=|pitch=|bearing=/);
  expect(copied).toMatch(/&compare=E01000002\.E01000003$/);

  // The recipient: a fresh device.
  const recipient = await page.context().browser()!.newContext({ viewport: page.viewportSize() ?? undefined });
  const other = await recipient.newPage();
  await other.goto(copied);
  const panel = other.getByTestId("match-ranking");
  await expect(panel.getByTestId("shared-banner")).toContainText("A shared London search");
  await expect(panel.getByRole("checkbox", { name: "Compare North London preview" })).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByRole("checkbox", { name: "Compare South Bank preview" })).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByTestId("comparison-tray")).toContainText("2 areas");
  expect(await other.evaluate(() => window.localStorage.getItem("close-knit.compare.v1"))).toBeNull();
  await recipient.close();
});

test("the shared card shows the whole search at 390px and its chips show above the fold, then the top 10", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const link = `/?layer=personal-match${encodeShareLink(exampleProfile(), ["uk:lsoa:E01000002" as never, "uk:lsoa:E01000003" as never])}`;
  expect(`https://getcloseknit.com${link}`.length).toBeLessThan(300);
  await page.goto(link);
  const card = page.getByTestId("shared-banner");
  await expect(card).toBeVisible();
  const lines = await card.evaluate((node) => {
    const line = node.querySelector(".shared-card__line")!.getBoundingClientRect();
    const actions = node.querySelector(".shared-card__actions")!.getBoundingClientRect();
    return { line: line.height, actions: actions.height };
  });
  // The search wraps (two lines here) rather than being cut off with an ellipsis.
  expect(lines.line).toBeLessThanOrEqual(42);
  expect(lines.actions).toBeLessThanOrEqual(48);
  // CUJ08 step 2 (v4.5, round 2 #34): chips in priority order first, so the Budget chip the partner taps is in view;
  // the count and the top 10 follow them.
  const panel = page.getByTestId("match-ranking").filter({ visible: true }).first();
  const budget = panel.locator('[data-testid="match-item"][data-id="affordability"]').getByTestId("match-chip");
  const box = await budget.boundingBox();
  expect((box?.y ?? 900) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
  const first = panel.getByTestId("match-row").first();
  await expect(first).toBeAttached();
  expect(await budget.evaluate((chip, row) => !!(chip.compareDocumentPosition(row!) & Node.DOCUMENT_POSITION_FOLLOWING), await first.elementHandle()))
    .toBe(true);
});
