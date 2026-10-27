import { expect, expectSteady, test, type Page } from "./fixtures";

import type { MatchCriterion, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { MATCH_CHIPS } from "../src/lib/match-ranges";
import { addCriterion, freshSearch, setBudget } from "../src/lib/match-search";

// v4.6 saved-brief track (check round 3, CUJ03 / CUJ14): /?saved=1 opens Saved on a direct load even when the saved
// map setup reopens My match, and keeps saying so in the address; the brief shows each area's trade-offs; sender
// and partner see the same scores; the partner reads "Their must-haves".

const PROFILE_KEY = "close-knit.preference-profile.v1";
const SHORTLISTS = "close-knit.saved-shortlists.v1";
const MAP_SETUP = "close-knit.map-state.v2";
const A = "uk:lsoa:E01000002";
const B = "uk:lsoa:E01000003";

function cuj03(): PreferenceProfile {
  const kingsCross: MatchCriterion = {
    kind: "place", id: "kings-cross", label: "King's Cross", target: { kind: "point", latitude: 51.5306, longitude: -0.1239 },
    mode: "transit", targetMinutes: 35, must: false,
  };
  const chip = (id: string) => MATCH_CHIPS.find((entry) => entry.id === id)!.criterion;
  let profile = setBudget(freshSearch(structuredClone(DEFAULT_PROFILE)), { market: "buy", maximum: 650_000 });
  profile = addCriterion(profile, kingsCross);
  profile = addCriterion(profile, chip("safer-streets"));
  return addCriterion(profile, { ...chip("good-schools"), must: true });
}

/** Two saved areas and the CUJ03 search; `matchOpen` also saves a map setup on My match (as a returning visitor's). */
async function seed(page: Page, { matchOpen = false }: { matchOpen?: boolean } = {}) {
  const search = cuj03();
  const shortlists = [{
    schemaVersion: "saved-shortlist.v1", id: "s1", name: "My shortlist", createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z", candidates: [A, B], candidateNames: {},
    profile: search, mode: "demo", release: "preview-2026-09", evidence: [],
  }];
  await page.addInitScript(([profileKey, shortlistsKey, setupKey, own, stored, setup]) => {
    if (window.localStorage.getItem("e2e-seeded")) return;
    window.localStorage.setItem("e2e-seeded", "1");
    window.localStorage.setItem(profileKey, own);
    window.localStorage.setItem(shortlistsKey, stored);
    if (setup) window.localStorage.setItem(setupKey, setup);
  }, [PROFILE_KEY, SHORTLISTS, MAP_SETUP, JSON.stringify(search), JSON.stringify(shortlists),
    matchOpen ? "layer=personal-match&lat=51.55&lng=-0.1&zoom=12" : ""] as const);
}

test("/?saved=1 opens Saved on a direct load, over a saved My match, and the address keeps it until closed", async ({ page }) => {
  // A phone too: My match's sheet must not cover Saved (it opens once Saved closes).
  await seed(page, { matchOpen: true });
  await page.goto("/?saved=1");
  const panel = page.getByTestId("saved-panel");
  await expect(panel).toBeVisible();
  // My match opening from the saved setup does not close it.
  await expectSteady(async () => expect(await panel.isVisible(), "Saved stays open").toBe(true), 1_500);
  await expect(page).toHaveURL(/[?&]saved=1/);
  await expect(page).toHaveURL(/layer=personal-match/);
  // CUJ14 (2 taps): two areas already ticked, Compare · 2 ready.
  await expect(panel.getByTestId("saved-compare-areas")).toHaveText("Compare · 2");
  // Shown only: opening Saved leaves the shared compare tray empty (no tray over the map afterwards).
  expect(await page.evaluate(() => window.localStorage.getItem("close-knit.compare.v1"))).toBeNull();
  await page.reload();
  await expect(page.getByTestId("saved-panel")).toBeVisible();
  await page.getByTestId("saved-close").click();
  await expect(page.getByTestId("saved-panel")).toHaveCount(0);
  await expect(page).not.toHaveURL(/saved=1/);
  if (test.info().project.name === "mobile") await expect(page.getByTestId("match-sheet")).toBeVisible();
  // The saved map setup never keeps Saved open.
  expect(await page.evaluate((key) => window.localStorage.getItem(key) ?? "", MAP_SETUP)).not.toContain("saved=");
});

test("the brief: trade-offs per area, the same scores for sender and partner, and 'Their must-haves'", async ({ page, browser }) => {
  test.skip(test.info().project.name === "mobile", "CUJ03 is desktop");
  await seed(page);
  await page.goto(`/compare?kind=places&ids=${encodeURIComponent(A)},${encodeURIComponent(B)}`);
  await page.getByTestId("compare-brief").click();
  await expect(page.getByTestId("decision-brief-preview")).toBeVisible({ timeout: 20_000 });
  const verdicts = page.getByTestId("brief-verdict");
  await expect(verdicts).toHaveCount(2);
  // Every area has its trade-offs row: the search's shortfall, then the area's standout cons (South Bank preview is
  // noisier than 93% of London), or "None found".
  for (const verdict of await verdicts.all()) await expect(verdict.getByTestId("brief-trade-offs")).toBeVisible();
  await expect(verdicts.filter({ hasText: "South Bank preview" }).getByTestId("brief-trade-offs")).toContainText("Noisier than 93% of London");
  const headings = verdicts.locator("strong");
  await expect(headings.first()).toHaveText(/ · \d+$/);
  const sender = await headings.allInnerTexts();
  await expect(page.getByTestId("decision-brief")).toContainText("Your must-haves");
  // The address-bar link now carries the scores (and still nothing private).
  await expect.poll(() => page.url()).not.toBe("");
  await expect.poll(() => envelope(page.url()).scores !== undefined).toBe(true);
  expect(page.url()).not.toMatch(/650000|51\.53/);

  const partner = await browser.newContext();
  const other = await partner.newPage();
  await other.goto(page.url());
  await expect(other.getByTestId("decision-brief-preview")).toBeVisible({ timeout: 20_000 });
  await expect(other.getByTestId("brief-header")).toContainText("Shared brief");
  await expect(other.getByTestId("brief-verdict").locator("strong")).toHaveText(sender);
  await expect(other.getByTestId("brief-scores-sent")).toHaveText("Scores as sent");
  const text = await other.getByTestId("decision-brief").innerText();
  expect(text).toContain("Their must-haves");
  expect(text).not.toMatch(/your must-haves/i);
  await partner.close();
});

/** The envelope inside /brief#shortlist=v1.… */
function envelope(url: string): Record<string, unknown> {
  const body = new URL(url).hash.slice("#shortlist=v1.".length);
  return JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
}
