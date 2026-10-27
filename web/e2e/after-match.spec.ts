import { expect, test, type Page } from "./fixtures";

import { decodeSharedShortlist } from "../src/lib/saved-shortlists";
import { captureShares, lastShare } from "./share-capture";
import { seedSearch } from "./wizard";

// v4.1 "after the match": Task 9 (portal links), 35 (no dead end), 38 (share redaction), 41 (one price).

const DRAWN = { kind: "polygon", label: "Area I drew", points: [[51.495, -0.15], [51.495, -0.13], [51.507, -0.13], [51.507, -0.15]] };

/** My match's Where card, opened from its chip (v4 Task 8). */
async function openSearch(page: Page) {
  const card = page.getByTestId("match-card-zone");
  await expect(async () => {
    if (!(await card.isVisible())) await page.locator('[data-testid="match-item"][data-id="zone"]').getByTestId("match-chip").click({ timeout: 1_000 });
    await expect(card).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return card;
}

test("Task 9: under the top 10, the matching areas open on the portals through /go", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  const block = page.getByTestId("homes-in-these-areas");
  await expect(block.getByRole("heading", { name: "Homes for sale in these areas" })).toBeVisible();
  await expect(block).toContainText("Up to £650k · 2+ beds passed on · opens in a new tab");
  const link = block.getByTestId("portal-district-rightmove").first();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("href", /^\/go\/rightmove\?kind=listings&outcode=[A-Z0-9]+&market=buy&max_price=650000&beds=2&from=web$/);
});

test("Task 9: a drawn zone chip opens Rightmove and Zoopla as that drawn area", async ({ page, request }) => {
  await seedSearch(page, { zones: [DRAWN] });
  await page.goto("/?layer=personal-match");
  const search = await openSearch(page);
  const chips = search.getByTestId("zone-portal-chips");
  await chips.getByTestId("zone-chip").first().click();
  const rightmove = chips.getByTestId("zone-portal-rightmove");
  await expect(rightmove).toHaveAttribute("href", /^\/go\/rightmove\?kind=zone&market=buy&max_price=650000&beds=2&from=web&shape=draw&poly=/);
  await expect(chips.getByTestId("zone-portal-zoopla")).toBeVisible();
  await expect(chips).toContainText("Up to £650k · 2+ beds passed on");
  // /go rebuilds the portal URL from the parameters: Rightmove's draw-a-search with the same box.
  const answer = await request.get((await rightmove.getAttribute("href"))!, { maxRedirects: 0 });
  expect(answer.status()).toBe(302);
  expect(answer.headers().location).toMatch(/^https:\/\/www\.rightmove\.co\.uk\/property-for-sale\/map\.html\?locationIdentifier=USERDEFINEDAREA%5E%7B%22polylines%22%3A%22.+&maxPrice=650000&minBedrooms=2$/);
  // The result block opens the zone itself, not the districts.
  await expect(page.getByTestId("homes-in-these-areas").getByTestId("zone-portal-zoopla")).toHaveAttribute("href", /kind=zone/);
  // Anything else at /go is refused.
  expect((await request.get("/go/evil?kind=listings&outcode=E8&market=buy&max_price=500000&beds=2", { maxRedirects: 0 })).status()).toBe(404);
});

test("Task 35: Compare and its Brief end on each area's page and its homes on the portals", async ({ page }) => {
  await captureShares(page);
  await seedSearch(page);
  await page.goto("/compare?kind=places&ids=uk%3Alsoa%3AE01000002,uk%3Alsoa%3AE01000003");
  const next = page.getByTestId("compare-next");
  await expect(next.getByTestId("compare-area-page")).toHaveCount(2);
  await expect(next.getByTestId("area-portal-zoopla").first()).toHaveAttribute("href", /^\/go\/zoopla\?kind=listings&outcode=[A-Z0-9]+&market=buy&max_price=650000&beds=2&from=web$/);

  await page.getByTestId("compare-brief").click();
  const view = page.getByTestId("brief-page");
  const steps = view.getByTestId("brief-next-steps");
  await expect(steps.getByTestId("brief-next-area")).toHaveCount(2);
  await expect(steps.getByTestId("brief-area-page").first()).toHaveAttribute("href", /^\/area\/lsoa\/E0100000[23]$/);
  await expect(steps.getByTestId("area-portal-rightmove").first()).toHaveAttribute("href", /^\/go\/rightmove\?kind=listings/);
});

test("Task 38: Copy link reviews first; the link leaves the budget and exact places out unless ticked", async ({ page }) => {
  await captureShares(page);
  await seedSearch(page, {
    places: [{ id: "work", label: "Secret Office 77", target: { kind: "point", latitude: 51.512345, longitude: -0.087654 }, mode: "transit", targetMinutes: 30, weight: 3, must: false }],
  });
  await page.goto("/compare?kind=places&ids=uk%3Alsoa%3AE01000002,uk%3Alsoa%3AE01000003");
  await page.getByTestId("compare-brief").click();
  const view = page.getByTestId("brief-page");
  await view.getByTestId("brief-copy-link").click();
  const review = view.getByTestId("share-review");
  await expect(review).toContainText("Review before sharing");
  await expect(review.getByTestId("share-review-left")).toContainText("Budget up to £650,000");
  await expect(review.getByTestId("share-review-left")).toContainText("Exact places: Secret Office 77");
  expect(await lastShare(page)).toBeNull();
  await review.getByTestId("share-review-confirm").click();
  await expect(view.getByTestId("share-status")).toContainText("Link copied");
  const redacted = decodeSharedShortlist(new URL((await lastShare(page))!).hash);
  expect(redacted.ok && redacted.share.budgetShared).toBe(false);
  expect(redacted.ok && redacted.share.profile.maximumBudget).toBe(100_000_000);
  expect(JSON.stringify(redacted)).not.toContain("51.512345");

  // The partner's brief says so, with no limit figure (a fresh load: only the hash differs).
  const shared = new URL((await lastShare(page))!);
  await page.goto("about:blank");
  await page.goto(`${shared.pathname}${shared.hash}`);
  // A copied link is a Shared brief, even on this device (v4.4): not "Your brief is ready".
  await expect(page.getByTestId("decision-brief-preview")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("brief-header")).toContainText("Shared brief");
  await expect(page.getByTestId("brief-header").getByRole("status")).toHaveText("");
  await expect(page.getByTestId("decision-brief-preview")).toContainText("Budget not shared.");
  await expect(page.getByTestId("decision-brief-preview")).not.toContainText("100,000,000");
  await expect(page.getByTestId("decision-brief-preview")).not.toContainText("Secret Office 77");

  await page.goto("/compare?kind=places&ids=uk%3Alsoa%3AE01000002,uk%3Alsoa%3AE01000003");
  await page.getByTestId("compare-brief").click();
  await page.getByTestId("brief-page").getByTestId("brief-copy-link").click();
  await page.getByTestId("share-include-includeBudget").check();
  await page.getByTestId("share-review-confirm").click();
  await expect.poll(async () => {
    const decoded = decodeSharedShortlist(new URL((await lastShare(page))!).hash);
    return decoded.ok && decoded.share.profile.maximumBudget;
  }).toBe(650_000);
});

test("Task 41: one price from stamp duty to buy-to-let, the tabs and Check a home", async ({ page }) => {
  await page.goto("/tools/stamp-duty");
  await expect(page).toHaveURL(/\/tools\/stamp-duty\?price=500000$/);
  await page.getByTestId("sdlt-price").fill("612000");
  await expect(page).toHaveURL(/\?price=612000$/);
  await expect(page.getByTestId("tool-next-lead")).toHaveText("Next with £612k");
  await expect(page.getByTestId("tool-tab-investor")).toHaveAttribute("href", "/tools/investor?price=612000");
  await expect(page.getByTestId("tool-check-home")).toHaveAttribute("href", "/tools/check-a-home?price=612000");
  await expect(page.getByTestId("tool-find-areas")).toHaveAttribute("href", "/?find=budget&price=612000");
  await page.getByTestId("tool-buy-to-let").click();
  await expect(page).toHaveURL(/\/tools\/investor\?price=612000&from=stamp\+duty$/);
  await expect(page.getByTestId("tools-prefill")).toContainText("stamp duty");
  await expect(page.getByTestId("tool-tab-check-a-home")).toHaveAttribute("href", "/tools/check-a-home?price=612000");
});

test("Task 41: Check a home with no price starts from the My match budget and carries it", async ({ page }) => {
  await seedSearch(page);
  await page.goto("/tools/check-a-home");
  await expect(page.getByTestId("cost-prefill")).toContainText("Started from your budget (£650,000)");
  await expect(page).toHaveURL(/\/tools\/check-a-home\?price=650000$/);
  await expect(page.getByTestId("tool-tab-stamp-duty")).toHaveAttribute("href", "/tools/stamp-duty?price=650000");
});

test("Task 41: a saved listing's asking price goes on to Check a home", async ({ page }) => {
  const listing = {
    url: "https://www.rightmove.co.uk/properties/1", portal: "rightmove", address: "1 Example Street, London SW1A 1AA",
    market: "buy", askingPrice: 600000, bedrooms: 2, floorAreaSqm: null, geographyId: "uk:lsoa:E01000001",
  };
  await page.goto(`/save-listing#listing=v1.${Buffer.from(JSON.stringify(listing)).toString("base64url")}`);
  await expect(page.getByTestId("save-listing-line")).toContainText("£600,000 asking · 2 bed");
  await expect(page.getByTestId("save-listing-check")).toHaveAttribute("href", /price=600000/);
  await page.goto("/area/lsoa/E01000001");
  const row = page.getByTestId("saved-homes-here");
  await expect(row).toContainText("£600,000 asking");
  await row.getByTestId("saved-home-check").click();
  await expect(page).toHaveURL(/\/tools\/check-a-home\?area=uk%3Alsoa%3AE01000001&price=600000&from=1\+Example\+Street/);
  await expect(page.getByTestId("cost-prefill")).toContainText("1 Example Street");
});
