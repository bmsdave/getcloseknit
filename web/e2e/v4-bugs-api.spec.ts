import { expect, test, type Page, type Route } from "./fixtures";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";

// v4 G5: Task 23 (the save-listing area call), Task 24 (names, not codes) and Task 25's page part
// (a refused area read in plain words, with Try again).

const AREA = "uk:lsoa:E01000001";
const SHORTLISTS_KEY = "close-knit.saved-shortlists.v1";

/** The panel's area read for one metric (the map's own reads of other metrics pass through). */
function routeAreaRead(page: Page, metric: string, handler: (route: Route) => Promise<void> | void) {
  return page.route((url) => decodeURIComponent(url.pathname) === `/api/v1/areas/${AREA}` && url.searchParams.get("metric") === metric, handler);
}

test("Task 23: the saved confirmation names the area from a call with metric and month", async ({ page }) => {
  const areaCalls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (decodeURIComponent(url.pathname) === `/api/v1/areas/${AREA}`) areaCalls.push(url.search);
  });
  const listing = {
    url: "https://www.rightmove.co.uk/properties/1", portal: "rightmove", address: "1 Example Street, London SW1A 1AA",
    market: "buy", askingPrice: 650000, bedrooms: 2, floorAreaSqm: null, geographyId: AREA,
  };
  await page.goto(`/save-listing#listing=v1.${Buffer.from(JSON.stringify(listing)).toString("base64url")}`);
  await expect(page.getByTestId("save-listing-area")).toHaveText("St James's · SW1A →");
  expect(areaCalls.length).toBeGreaterThan(0);
  for (const search of areaCalls) expect(search).toContain("metric=price-per-square-metre");
});

test("Task 24: an area saved under its code reads with its name in Saved", async ({ page }) => {
  const now = "2026-10-01T00:00:00.000Z";
  const stored = [{
    schemaVersion: "saved-shortlist.v1", id: "old-share", name: "My shortlist", createdAt: now, updatedAt: now,
    candidates: [AREA], candidateNames: { [AREA]: "Westminster 018A" }, profile: DEFAULT_PROFILE,
    mode: "demo", release: "demo-fixture-pack",
    evidence: [{ geographyId: AREA, name: "Westminster 018A", score: null, excluded: false, evidenceCompleteness: 0 }],
  }];
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [SHORTLISTS_KEY, JSON.stringify(stored)]);
  await page.goto("/?saved=1");
  const row = page.getByTestId("saved-block-areas").getByTestId("saved-row").first();
  await expect(row).toContainText("St James's · SW1A");
  await expect(row).not.toContainText("018A");
});

test("Task 25: a refused area read says so in words, never the raw API error", async ({ page }) => {
  await routeAreaRead(page, "crime", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{\"error\":\"period-not-found\"}" }));
  await page.goto(`/?layer=crime&period=2026-06&selected=${encodeURIComponent(AREA)}`);
  const unavailable = page.getByTestId("evidence-unavailable").first();
  await expect(unavailable).toBeVisible();
  await expect(unavailable).toContainText("No figure for this area yet.");
  await expect(unavailable).not.toContainText("status 404");
  await expect(unavailable).toHaveAttribute("data-reason", "evidence-unavailable (status 404)");
});

test("Task 25: a failed area read offers Try again, which asks again", async ({ page }) => {
  let down = true;
  await routeAreaRead(page, "crime", (route) => (down
    ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" }) : route.fallback()));
  await page.goto(`/?layer=crime&period=2026-06&selected=${encodeURIComponent(AREA)}`);
  const unavailable = page.getByTestId("evidence-unavailable").first();
  await expect(unavailable).toContainText("This area didn't load.");
  await expect(unavailable).not.toContainText("status 503");
  down = false;
  await unavailable.getByTestId("evidence-retry").click();
  await expect(page.getByTestId("evidence-unavailable")).toHaveCount(0);
});

for (const link of ["", "&period=2025-01"]) {
  test(`Task 25: a deprivation deep link${link ? " with ?period" : ""} asks for a month it has, never a 404`, async ({ page }) => {
    const missing: string[] = [];
    const asked: string[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith("/api/v1/")) return;
      if (response.status() === 404) missing.push(`${url.pathname}${url.search}`);
      if (decodeURIComponent(url.pathname) === `/api/v1/areas/${AREA}` && url.searchParams.get("metric") === "deprivation") {
        asked.push(url.searchParams.get("period") ?? "");
      }
    });
    await page.goto(`/?layer=deprivation${link}&selected=${encodeURIComponent(AREA)}`);
    await expect(page.getByTestId("evidence-panel")).toContainText("St James's");
    await expect(page.getByTestId("evidence-unavailable")).toHaveCount(0);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((period) => period === "2025-01")).toBe(true);
    expect(missing).toEqual([]);
  });
}
