import { expect, test, type Page } from "./fixtures";

import type { MatchCriterion, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { MATCH_CHIPS } from "../src/lib/match-ranges";
import { addCriterion, freshSearch, setBudget } from "../src/lib/match-search";

// v4.5 compare-brief track (check round 2, CUJ03 / CUJ14): /brief renders again for the owner and the partner (it
// posted the v1 profile, which the API refused), the partner keeps Save all and Open map whatever the ranking does,
// the Compare Schools row goes to the most schools nearby, and Saved and Compare show one £/m² series.

const PROFILE_KEY = "close-knit.preference-profile.v1";
const SHORTLISTS = "close-knit.saved-shortlists.v1";
const A = "uk:lsoa:E01000002";
const B = "uk:lsoa:E01000003";
const COMPARE = `/compare?kind=places&ids=${encodeURIComponent(A)},${encodeURIComponent(B)}`;

/** The CUJ03 search: a budget, a place and two chips (its ranges carry scale and must, as the panel writes them). */
function cuj03(): PreferenceProfile {
  const kingsCross: MatchCriterion = {
    kind: "place", id: "kings-cross", label: "King's Cross", target: { kind: "point", latitude: 51.5306, longitude: -0.1239 },
    mode: "transit", targetMinutes: 35, must: false,
  };
  const chip = (id: string) => MATCH_CHIPS.find((entry) => entry.id === id)!.criterion;
  let profile = setBudget(freshSearch(structuredClone(DEFAULT_PROFILE)), { market: "buy", maximum: 650_000 });
  profile = addCriterion(profile, kingsCross);
  profile = addCriterion(profile, chip("safer-streets"));
  return addCriterion(profile, chip("good-schools"));
}

async function seed(page: Page) {
  const search = cuj03();
  const shortlists = [{
    schemaVersion: "saved-shortlist.v1", id: "s1", name: "My shortlist", createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z", candidates: [A, B], candidateNames: {},
    profile: search, mode: "demo", release: "preview-2026-09", evidence: [],
  }];
  await page.addInitScript(([profileKey, shortlistsKey, own, stored]) => {
    if (window.localStorage.getItem("e2e-seeded")) return;
    window.localStorage.setItem("e2e-seeded", "1");
    window.localStorage.setItem(profileKey, own);
    window.localStorage.setItem(shortlistsKey, stored);
  }, [PROFILE_KEY, SHORTLISTS, JSON.stringify(search), JSON.stringify(shortlists)] as const);
}

/** Every /api/v1/matches POST body's schemaVersion, as the page sends them. */
function matchPosts(page: Page): string[] {
  const versions: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !new URL(request.url()).pathname.startsWith("/api/v1/matches")) return;
    versions.push(String((JSON.parse(request.postData() ?? "{}") as { schemaVersion?: string }).schemaVersion));
  });
  return versions;
}

test("/brief renders for the owner and the partner, and asks for the search as Compare does (v2)", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await seed(page);
  await page.goto(COMPARE);
  await page.getByTestId("compare-brief").click();
  await expect(page).toHaveURL(/\/brief#shortlist=v1\./);
  const posts = matchPosts(page);
  await page.reload();
  await expect(page.getByTestId("decision-brief-preview")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("brief-page")).not.toContainText("couldn't rank");
  await expect(page.getByTestId("brief-verdict")).toHaveCount(2);
  // The regression: the brief posted the v1 panel profile, which the API refuses (400) when ranges carry scale/must.
  expect(posts.length).toBeGreaterThan(0);
  expect(new Set(posts)).toEqual(new Set(["preference-profile.v2"]));

  const partner = await browser.newContext();
  const other = await partner.newPage();
  const partnerPosts = matchPosts(other);
  await other.goto(page.url());
  await expect(other.getByTestId("decision-brief-preview")).toBeVisible({ timeout: 20_000 });
  await expect(other.getByTestId("brief-header")).toContainText("Shared brief");
  await expect(other.getByTestId("brief-verdict")).toHaveCount(2);
  await expect(other.getByTestId("brief-save-all")).toHaveCount(1);
  await expect(other.getByTestId("brief-open-map")).toHaveCount(1);
  expect(new Set(partnerPosts)).toEqual(new Set(["preference-profile.v2"]));
  await partner.close();
});

test("the partner keeps Save all and Open map while the brief can't rank", async ({ page, browser }) => {
  await seed(page);
  await page.goto(COMPARE);
  await page.getByTestId("compare-brief").click();
  await expect(page).toHaveURL(/\/brief#shortlist=v1\./);
  const partner = await browser.newContext();
  const other = await partner.newPage();
  await other.route("**/api/v1/matches**", (route) => route.fulfill({ status: 400, json: { error: "invalid-preference-profile" } }));
  await other.goto(page.url());
  await expect(other.getByRole("status").filter({ hasText: "We couldn't rank these areas just now" })).toBeVisible({ timeout: 20_000 });
  await expect(other.getByTestId("brief-shortlist-name")).toHaveText(/ vs /);
  await expect(other.getByTestId("brief-open-map")).toHaveAttribute("href", /^\/\?layer=personal-match#profile=v3\./);
  await other.getByTestId("brief-save-all").click();
  await expect(other.getByTestId("brief-save-all")).toHaveText("Saved");
  await expect(other.getByTestId("header-saved-areas")).toHaveAttribute("aria-label", "Saved (2)");
  await partner.close();
});

test("Compare: Schools goes to the most schools nearby; a longer bar is always the better value", async ({ page }) => {
  await seed(page);
  await page.goto(COMPARE);
  const table = page.getByTestId("compare-table");
  const schools = table.locator('[data-row="Schools"] td');
  await expect(schools).toHaveCount(2);
  const counts = (await schools.allInnerTexts()).map((text) => Number(/^(\d+)/.exec(text)![1]));
  const best = counts.indexOf(Math.max(...counts));
  await expect(schools.nth(best)).toHaveAttribute("data-best", "");
  await expect(schools.nth(1 - best)).not.toHaveAttribute("data-best", "");
  // Every row with a winner gives it the full bar (lower-is-better rows included: price, minutes, noise).
  let checked = 0;
  for (const row of await table.locator('[data-testid="compare-row"]').all()) {
    const cells = await row.locator("td").evaluateAll((tds) => tds.map((cell) => ({
      best: cell.hasAttribute("data-best"), bar: cell.hasAttribute("data-bar") ? Number(cell.getAttribute("data-bar")) : null,
    })));
    if (cells.filter((cell) => cell.best).length !== 1 || cells.some((cell) => cell.bar === null)) continue;
    expect(cells.find((cell) => cell.best)!.bar, await row.getAttribute("data-row") ?? "").toBe(1);
    checked += 1;
  }
  expect(checked).toBeGreaterThanOrEqual(3);
});

test("Saved and Compare show the same £/m² for each area, and say where it comes from", async ({ page }) => {
  await seed(page);
  await page.goto("/?saved=1");
  const panel = page.getByTestId("saved-panel");
  const saved: Record<string, string> = {};
  for (const id of [A, B]) {
    const meta = panel.locator(`[data-testid="saved-row"][data-area="${id}"]`).getByTestId("saved-row-meta");
    await expect(meta).toHaveText(/£[\d,]+\/m²/, { timeout: 20_000 });
    await expect(meta).toHaveAttribute("title", /Price per m² layer/);
    saved[id] = (await meta.innerText()).match(/£[\d,]+\/m²/)![0];
  }
  await page.goto(COMPARE);
  const ids = await page.getByTestId("compare-column").evaluateAll((columns) => columns.map((column) => column.getAttribute("data-id")));
  const prices = page.locator('[data-row="Price"] td');
  await expect(prices.first()).toHaveText(/£[\d,]+\/m²/);
  for (const [index, id] of ids.entries()) {
    expect((await prices.nth(index).innerText()).match(/£[\d,]+\/m²/)![0], id ?? "").toBe(saved[id!]);
  }
  await expect(page.locator('[data-row="Price"] th')).toHaveAttribute("title", /Price per m² layer/);
});
