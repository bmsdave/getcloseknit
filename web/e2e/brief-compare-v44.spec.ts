import { expect, test, type Page } from "./fixtures";

import type { MatchCriterion, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { MATCH_CHIPS } from "../src/lib/match-ranges";
import { addCriterion, freshSearch, setBudget } from "../src/lib/match-search";

// v4.4 brief-compare track (final prod check, CUJ03): the Brief reflects the search, its link is redacted, a partner
// sees a Shared brief, /compare shows the search and fits a phone, Saved ticks what Compare compares, the phone
// header keeps its logo, and /postcode/{pc}/homes has the site header and the full breadcrumb.

const PROFILE_KEY = "close-knit.preference-profile.v1";
const SHORTLISTS = "close-knit.saved-shortlists.v1";
const A = "uk:lsoa:E01000002";
const B = "uk:lsoa:E01000003";
const C = "uk:lsoa:E01000001";

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

/** Three saved areas, and (unless `profile: false`) the CUJ03 search as this browser's own. */
async function seed(page: Page, { profile = true }: { profile?: boolean } = {}) {
  const search = profile ? cuj03() : null;
  const shortlists = [{
    schemaVersion: "saved-shortlist.v1", id: "s1", name: "My shortlist", createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z", candidates: [A, B, C], candidateNames: {},
    profile: search ?? DEFAULT_PROFILE, mode: "demo", release: "preview-2026-09", evidence: [],
  }];
  await page.addInitScript(([profileKey, shortlistsKey, own, stored]) => {
    if (window.localStorage.getItem("e2e-seeded")) return;
    window.localStorage.setItem("e2e-seeded", "1");
    if (own) window.localStorage.setItem(profileKey, own);
    window.localStorage.setItem(shortlistsKey, stored);
  }, [PROFILE_KEY, SHORTLISTS, search ? JSON.stringify(search) : "", JSON.stringify(shortlists)] as const);
}

/** The envelope inside /brief#shortlist=v1.… */
function envelope(url: string): Record<string, unknown> {
  const body = new URL(url).hash.slice("#shortlist=v1.".length);
  return JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
}

test("Compare › Brief: the address-bar link is redacted, the owner's brief reads the search; a partner sees a Shared brief", async ({ page, browser }) => {
  test.skip(test.info().project.name === "mobile", "CUJ03 is desktop");
  await seed(page);
  await page.goto(`/compare?kind=places&ids=${encodeURIComponent(A)},${encodeURIComponent(B)}`);
  await page.getByTestId("compare-brief").click();
  await expect(page).toHaveURL(/\/brief#shortlist=v1\./);
  // Finding 53: nothing private rides in the link.
  const sent = envelope(page.url());
  expect(sent.redacted).toBe(true);
  expect(sent.include).toEqual({ places: false, budget: false, notes: false });
  expect(page.url()).not.toMatch(/650000|51\.53/);
  const decoded = Buffer.from(String(sent.profileFragment).replace(/^#profile=v3\./, ""), "base64url").toString();
  expect(decoded).not.toMatch(/650000|51\.53|King/);

  // The owner's own brief (this device): the search as set, never "left out: crime, schools".
  const brief = page.getByTestId("decision-brief-preview");
  await expect(brief).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("brief-ready")).toContainText("Your brief is ready");
  await expect(brief).toContainText("What matters, most important first: Your place 1 (#1), Safer streets (#2), Good schools (#3)");
  await expect(brief).not.toContainText("Left out of your score");
  await expect(brief).not.toContainText("haven't picked any priorities");
  await expect(brief).toContainText("your £650k limit");
  await expect(page.getByText("Private details (left out unless you tick them)")).toBeVisible();
  // Each area: its score in the heading, then what it gains or gives up.
  await expect(page.getByTestId("brief-verdict").first().locator("strong")).toHaveText(/ · \d+$/);

  // Finding 54: the partner, in a fresh browser, sees a Shared brief with Save all and Open map.
  const partner = await browser.newContext();
  const other = await partner.newPage();
  await other.goto(page.url());
  await expect(other.getByTestId("decision-brief-preview")).toBeVisible({ timeout: 20_000 });
  await expect(other.getByTestId("brief-header")).toContainText("Shared brief");
  await expect(other.getByTestId("brief-shortlist-name")).toHaveText(/ vs /);
  await expect(other.getByTestId("brief-ready")).toHaveText("");
  await expect(other.getByText("Private details (left out unless you tick them)")).toHaveCount(0);
  await expect(other.getByTestId("brief-copy-link")).toHaveCount(0);
  const text = await other.getByTestId("decision-brief").innerText();
  expect(text).not.toMatch(/your £\d|Your brief is ready|650/);
  expect(text).toContain("Budget not shared");
  // The place (a pinned point) stays out, so the shared order starts at Safer streets.
  expect(text).toContain("Safer streets (#1), Good schools (#2)");
  expect(text).not.toMatch(/your order/);
  await expect(other.getByTestId("brief-open-map")).toHaveAttribute("href", /^\/\?layer=personal-match#profile=v3\./);
  await other.getByTestId("brief-save-all").click();
  await expect(other.getByTestId("brief-save-all")).toHaveText("Saved");
  await expect(other.getByTestId("header-saved-areas")).toHaveAttribute("aria-label", "Saved (2)");
  await partner.close();
});

test("/compare shows the Match row, Tailored to and the trip to your place, in the v4 tile words", async ({ page }) => {
  await seed(page);
  await page.goto(`/compare?kind=places&ids=${encodeURIComponent(A)},${encodeURIComponent(B)}`);
  await expect(page.getByTestId("compare-tailored")).toHaveText(/^Tailored to: Buy ≤ £650k · 2-bed · King's Cross/);
  const table = page.getByTestId("compare-table");
  await expect(table.locator('[data-row="Match"] td').first()).toHaveText(/^(\d+|Out)(Best)?$/, { timeout: 20_000 });
  await expect(table.locator('[data-row="King\'s Cross"] td').first()).toHaveText(/^\d+ min(Best)?$/);
  await expect(table.locator('[data-row="Safety"] td').first()).toHaveText(/^(Safer than|More crime than) \d+%/);
  await expect(table.locator('[data-row="Noise"] td').first()).toHaveText(/% over 55 dB/);
  await expect(table.locator('[data-row="Schools"] td').first()).toHaveText(/within 1\.5 km/);
  await expect(table).not.toContainText("/1k");
  await expect(page.getByTestId("breadcrumbs").getByRole("listitem")).toHaveText(["Saved", "Compare"]);
});

test("/compare on a phone: both columns fit, nothing clipped or scrolled sideways", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "phone layout");
  await seed(page, { profile: false });
  await page.goto(`/compare?kind=places&ids=${encodeURIComponent(A)},${encodeURIComponent(B)}`);
  const table = page.getByTestId("compare-table");
  await expect(table.getByTestId("compare-column")).toHaveCount(2);
  const fits = await table.evaluate((scroller) => ({
    scroll: scroller.scrollWidth, client: scroller.clientWidth, page: document.documentElement.scrollWidth, width: window.innerWidth,
  }));
  expect(fits.scroll).toBeLessThanOrEqual(fits.client + 1);
  expect(fits.page).toBeLessThanOrEqual(fits.width);
  const last = await table.getByTestId("compare-column").last().boundingBox();
  expect(last!.x + last!.width).toBeLessThanOrEqual(fits.width);
});

test("Saved: tick boxes, match scores, and Compare takes the ticked areas only", async ({ page }) => {
  await seed(page);
  await page.goto("/?saved=1");
  const panel = page.getByTestId("saved-panel");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Saved");
  const rows = panel.getByTestId("saved-block-areas").getByTestId("saved-row");
  await expect(rows).toHaveCount(3);
  await expect(panel.getByTestId("saved-row-score").first()).toHaveText(/^\d+$/, { timeout: 20_000 });
  // The automatic shortlist is the Areas block itself, not listed again.
  await expect(panel.getByTestId("saved-block-shortlists")).toHaveCount(0);
  // v4.6: Saved opens with two ticked (Compare · 2 ready); untick them to choose others.
  await expect(panel.getByTestId("saved-compare-areas")).toHaveText("Compare · 2");
  for (const tick of await panel.getByTestId("saved-row-tick").all()) await tick.uncheck();
  await expect(panel.getByTestId("saved-compare-areas")).toHaveCount(0);
  await rows.nth(0).getByTestId("saved-row-tick").check();
  await rows.nth(2).getByTestId("saved-row-tick").check();
  await expect(panel.getByTestId("saved-compare-areas")).toHaveText("Compare · 2");
  await panel.getByTestId("saved-compare-areas").click();
  await expect(page).toHaveURL(/\/compare\?kind=places&ids=/);
  await expect(page.getByTestId("compare-column")).toHaveCount(2);
});

test("phone subpage header: the logo is whole with ♡ N showing", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "phone header");
  await seed(page, { profile: false });
  for (const path of ["/rankings", `/compare?kind=places&ids=${encodeURIComponent(A)},${encodeURIComponent(B)}`, "/area/lsoa/E01000001"]) {
    await page.goto(path);
    const header = page.getByTestId("site-header");
    await expect(header.getByTestId("header-saved-areas")).toBeVisible();
    const word = header.locator(".brand-lockup__word");
    const clipped = await word.evaluate((node) => {
      const brand = node.closest(".site-header__brand")!.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const search = document.querySelector(".site-header .search-open")?.getBoundingClientRect();
      return { overflow: node.scrollWidth > node.clientWidth + 1, beyond: box.right > brand.right + 1, overlap: search ? box.right > search.left : false };
    });
    expect(clipped, path).toEqual({ overflow: false, beyond: false, overlap: false });
    await expect(header.getByRole("link", { name: "Back to the map", exact: true })).toBeVisible();
  }
});

test("/postcode/{pc}/homes: the site header and London › borough › area › postcode › Homes", async ({ page }) => {
  await page.goto("/postcode/SW1A-1AB/homes");
  await expect(page.getByTestId("postcode-homes-page").getByTestId("site-header")).toBeVisible();
  const labels = (await page.getByTestId("breadcrumbs").getByRole("listitem").allInnerTexts()).map((label) => label.trim());
  expect(labels[0]).toBe("London");
  expect(labels.at(-1)).toBe("Homes");
  expect(labels.at(-2)).toBe("SW1A 1AB");
  expect(labels.length).toBeGreaterThanOrEqual(4);
});
