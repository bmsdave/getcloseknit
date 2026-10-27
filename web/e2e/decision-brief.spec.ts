import { expect, test, type Page } from "./fixtures";
import { readFile } from "node:fs/promises";
import { openEvidenceSection } from "./evidence";
import { continueToReview, seedSearch } from "./wizard";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { encodeSharedShortlist, type SavedShortlist } from "../src/lib/saved-shortlists";
import { openMatchBuilder } from "./top-bar";
import { captureShares, lastShare } from "./share-capture";

test.use({ acceptDownloads: true });

const PROFILE_KEY = "close-knit.preference-profile.v1";
const KNOWN_ADDRESS = "1 Parliament Preview, London, SW1A 1AA";
const CANDIDATE_NOTE = "E2E brief note 90412";
const OFFICE_LABEL = "E2E Brief Office 308";

const SEEDED_PROFILE = {
  schemaVersion: "preference-profile.v1",
  market: "buy",
  targetBudget: 500000,
  maximumBudget: 650000,
  bedrooms: 2,
  forecastHorizon: "1y",
  factors: [],
  commuteDestinations: [
    {
      id: "dest-e2e", label: OFFICE_LABEL, latitude: 51.5, longitude: -0.12,
      mode: "transit", arrivalTime: "09:00", targetMinutes: 45, weight: 3,
    },
  ],
  school: {
    phases: ["primary"], characteristics: [],
    facetWeights: { progress: 3, attainment: 2, attendance: 1 },
    shortlistUrns: [], desiredSchoolCount: 3,
  },
  analyticsConsent: false,
};

async function seedProfile(page: Page) {
  await page.addInitScript(
    ({ key, profile }) => window.localStorage.setItem(key, JSON.stringify(profile)),
    { key: PROFILE_KEY, profile: SEEDED_PROFILE },
  );
}

async function addKnownCandidate(page: Page) {
  await page.goto("/area/lsoa/E01000001?uprn=100000000001");
  await openEvidenceSection(page, "Plan & check");
  await expect(page.getByTestId("user-candidates")).toBeVisible();
  await page.getByLabel("Home address").fill(KNOWN_ADDRESS);
  await page.getByLabel("Listing link (optional)").fill("https://example.invalid/listing/42");
  await page.getByLabel("Asking kind").selectOption("sale");
  await page.getByLabel("Asking amount").fill("600000");
  await page.getByLabel("Price unit").selectOption("gbp-total");
  await page.getByLabel("Private notes (optional)").fill(CANDIDATE_NOTE);
  await page.getByRole("button", { name: "Save home" }).click();
  await expect(page.getByTestId("candidate-status")).toContainText(`Home saved: ${KNOWN_ADDRESS}.`);
  await page.goto("/?selected=uk%3Alsoa%3AE01000001"); // The home's tools live on /tools/check-a-home.
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
}

async function openBrief(page: Page) {
  await openMatchBuilder(page);
  await continueToReview(page);
  await expect(page.getByTestId("match-results")).toBeVisible();
  // The decision brief waits behind "Saved areas & costs".
  await page.getByTestId("saved-areas-costs").locator(":scope > summary").click();
  const brief = page.getByTestId("decision-brief");
  await expect(brief).toBeVisible();
  return brief;
}

async function compareTwo(page: Page) {
  await page.getByRole("checkbox", { name: "Compare North London preview" }).click();
  await page.getByRole("checkbox", { name: "Compare South Bank preview" }).click();
  // The tray's Compare is a link to /compare now (v3 Fix 22); the two stay ticked for the brief.
  await expect(page.getByTestId("comparison-tray").getByRole("link", { name: "Compare areas" })).toHaveAttribute("href", /^\/compare\?/);
}

async function previewBrief(page: Page) {
  await page.getByRole("button", { name: "Preview decision brief" }).click();
  const preview = page.getByTestId("decision-brief-preview");
  await expect(preview).toBeVisible();
  return preview;
}

test("selects candidates, previews a sourced brief, toggles private fields, and exports readable markdown", async ({ page }) => {
  await seedProfile(page);
  await addKnownCandidate(page);
  await openBrief(page);
  await compareTwo(page);
  const preview = await previewBrief(page);

  await expect(preview).toContainText("Stated needs");
  await expect(preview).toContainText("Buying, up to £650,000 (your maximum)");
  await expect(preview).toContainText("Your must-haves");
  await expect(preview).toContainText("Trade-offs");
  await expect(preview).toContainText("Homes you're considering");
  await expect(preview).toContainText("Asking price (you entered, unverified)");
  await expect(preview).toContainText("£600,000");
  await expect(preview).toContainText("Achieved £570,000 on 2022-11-03 (official record)");
  await expect(preview).toContainText("never combined");
  await expect(preview).toContainText("Total housing costs");
  await expect(preview.getByTestId("brief-sources")).toContainText("Sources");
  await expect(preview).toContainText("Open questions");
  await expect(preview).toContainText("Ride the real commute");
  await expect(preview).toContainText("Limits");
  await expect(preview).toContainText("Nothing is sent anywhere");
  // The brief release is the evidence release set flowing from matching
  // (sourceReleaseSet in matching.ts via area-comparison.ts), not the demo
  // app release.
  await expect(page.getByTestId("brief-release")).toContainText("preview-open-data-2026-09");

  await expect(preview).not.toContainText(OFFICE_LABEL);
  await expect(preview).not.toContainText(CANDIDATE_NOTE);
  await expect(page.getByTestId("decision-brief-meta")).toContainText("Private details left out");

  await page.getByLabel("Include precise commute destinations").check();
  await expect(preview).toContainText(OFFICE_LABEL);
  await page.getByLabel("Include private notes").check();
  await expect(preview).toContainText(CANDIDATE_NOTE);
  await expect(page.getByTestId("decision-brief-meta")).toContainText("Includes the private details you ticked");

  await page.getByLabel("Include precise commute destinations").uncheck();
  await expect(preview).not.toContainText(OFFICE_LABEL);

  await page.getByLabel(`Include ${KNOWN_ADDRESS} in brief`).uncheck();
  await expect(preview).not.toContainText(KNOWN_ADDRESS);
  await expect(preview).toContainText("No homes added yet");
  await page.getByLabel(`Include ${KNOWN_ADDRESS} in brief`).check();
  await expect(preview).toContainText("£600,000");

  const markdown = await page.getByTestId("decision-brief-markdown").inputValue();
  expect(markdown).toContain("# Decision brief");
  expect(markdown).toContain("## Stated needs");
  expect(markdown).toContain("## Open questions");
  expect(markdown).toContain("£600,000");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download decision brief (Markdown)" }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const body = await readFile(path as string, "utf8");
  expect(body).toContain("# Decision brief");
  expect(body).toContain("## Sources");
  expect(body).toContain("## Open questions");
  expect(body).toContain("£600,000");
  expect(body).toContain("Achieved £570,000");
  expect(new URL(page.url()).hash).toBe("");
});

test("an unavailable comparison is stated explicitly and an empty brief is refused", async ({ page }) => {
  await seedProfile(page);
  await addKnownCandidate(page);
  await openBrief(page);

  await page.getByRole("checkbox", { name: "Compare North London preview" }).click();
  const preview = await previewBrief(page);
  await expect(preview).toContainText("Area comparison unavailable");
  await expect(preview).toContainText("at least two areas");
  await expect(preview).toContainText(KNOWN_ADDRESS);
  await expect(preview).toContainText("£600,000");

  await page.getByLabel(`Include ${KNOWN_ADDRESS} in brief`).uncheck();
  await expect(page.getByTestId("decision-brief")).toContainText(
    "brief needs at least one compared area or one selected candidate",
  );
  expect(new URL(page.url()).hash).toBe("");
});

test("costs are optional, folded after the brief, and the brief shows without them", async ({ page }) => {
  await seedProfile(page);
  await page.goto("/");
  await openBrief(page);
  await compareTwo(page);
  const costs = page.getByTestId("brief-costs");
  await expect(costs.getByRole("button", { name: "Add costs (optional)" })).toHaveAttribute("aria-expanded", "false");
  await expect(costs.getByLabel("Price (£)")).toBeHidden();
  const preview = await previewBrief(page);
  await expect(preview).toContainText("Add a price to see monthly costs.");
  // The fold comes after the brief in reading order.
  const order = await page.getByTestId("decision-brief").evaluate((brief) => {
    const a = brief.querySelector("[data-testid='decision-brief-preview']")!;
    const b = brief.querySelector("[data-testid='brief-costs']")!;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
  await costs.getByRole("button", { name: "Add costs (optional)" }).click();
  await expect(costs.getByLabel("Price (£)")).toHaveClass(/knit-field/);
  await costs.getByLabel("Price (£)").fill("600000");
  await costs.getByLabel("Deposit (£)").fill("60000");
  await costs.getByLabel("Interest rate (% a year)").fill("4.5");
  await costs.getByLabel("Term (years)").fill("25");
  await expect(preview).toContainText("Mortgage payment");
  // Two columns once the brief is 560px wide (a wide desktop panel); one on a phone.
  const tops = await costs.locator("label").evaluateAll((labels) => labels.slice(0, 2).map((label) => Math.round(label.getBoundingClientRect().top)));
  const width = await page.getByTestId("decision-brief").evaluate((brief) => brief.getBoundingClientRect().width);
  if (width >= 560) expect(tops[0]).toBe(tops[1]); else expect(tops[1]).toBeGreaterThan(tops[0]);
});

test("the brief opens with each area's verdict and keeps the release under Sources", async ({ page }) => {
  await seedProfile(page);
  await page.goto("/");
  await openBrief(page);
  await compareTwo(page);
  const preview = await previewBrief(page);
  await expect(preview).not.toContainText(/hard (constraint|utility)/i);
  // At a glance: each compared area in three lines, price first against the limit.
  await expect(preview.getByTestId("brief-verdict")).toHaveCount(2);
  await expect(preview.getByTestId("brief-verdict").first()).toContainText(/~£\d+k · £\d+k (under|over) your £650k limit/);
  // The release sits under Sources (folded), never above it.
  await expect(page.getByTestId("brief-release")).toBeHidden();
  await expect(page.getByTestId("decision-brief-meta")).not.toContainText("Release");
  await preview.getByTestId("brief-sources").getByRole("button", { name: "Sources" }).click();
  await expect(page.getByTestId("brief-release")).toBeVisible();
  expect(await page.getByTestId("decision-brief-markdown").inputValue()).toMatch(/^## At a glance$/m);
});

// Demo mode: one £ figure per area everywhere — the result row, its budget chip, the map pin, the
// area card, compare and the brief — at a bedroom count other than two.
test("the row, chip, pin, card, compare and brief show one price per area", async ({ page }, testInfo) => {
  await seedSearch(page, { bedrooms: 3, targetBudget: 400000, maximumBudget: 500000 });
  await page.addInitScript(() => window.localStorage.setItem("close-knit.compare.v1", JSON.stringify(["uk:lsoa:E01000001", "uk:lsoa:E01000003"])));
  await page.goto("/?layer=personal-match");
  // v4: South Bank (~£510k) is past the £500k stretch, so least like the search (21e): its card from the Bottom 10.
  await page.getByTestId("match-list-bottom").click({ timeout: 20_000 });
  const row = (name: string) => page.getByTestId("match-bottom").getByTestId("match-row").filter({ hasText: name });
  await row("South Bank preview").locator(".match-row__main").click({ timeout: 20_000 });
  // v4.5: the v4.4 area view has no ballpark chip (.brief-fit went with the old card); the pin says its home.
  await expect(page.getByTestId("selected-area")).toBeVisible();
  if (testInfo.project.name === "desktop") {
    // Pins carry the price on wide maps (phones show the rank only).
    await expect(page.getByTestId("match-map-area").filter({ hasText: "3-bed ~£510k" })).toHaveCount(1);
    await expect(page.getByTestId("match-map-area").filter({ hasText: "~£600k" })).toHaveCount(1);
  }

  // v3 Fix 22: the tray's Compare opens /compare, whose Brief is the one way to the brief.
  // (With an area open the tray sits under the area view: /compare with the two compared areas, as its link is.)
  await page.goto("/compare?kind=places&ids=uk%3Alsoa%3AE01000001,uk%3Alsoa%3AE01000003");
  await expect(page.getByTestId("compare-page")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("compare-brief").click();
  const verdicts = page.getByTestId("brief-page").getByTestId("brief-verdict");
  await expect(verdicts.filter({ hasText: "South Bank preview" })).toContainText("~£510k", { timeout: 20_000 });
  await expect(verdicts.filter({ hasText: "Westminster preview" })).toContainText("~£600k");
});

// The brief's header: a yarn accent (plied Yarn, no texture) and "Your brief is ready" as a status,
// on /brief#shortlist= and from Compare › Brief (v3 Fix 22: the one way to it from the map).
test("the brief says when it is ready, on /brief and from Compare › Brief", async ({ page }) => {
  const shortlist: SavedShortlist = {
    schemaVersion: "saved-shortlist.v1", id: "s1", name: "Test move", createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z", candidates: ["uk:lsoa:E01000002", "uk:lsoa:E01000003"], candidateNames: {},
    profile: { ...structuredClone(DEFAULT_PROFILE), maximumBudget: 600000 }, mode: "demo", release: "demo-fixture-pack", evidence: [],
  };
  // Someone else's link (v4.4): a Shared brief, named by its areas; it is theirs, so no "Your brief is ready".
  await page.goto(`/brief${encodeSharedShortlist(shortlist)}`);
  const header = page.getByTestId("brief-header");
  await expect(header.getByRole("heading", { level: 1 })).toHaveText("North London preview vs South Bank preview");
  await expect(header).toContainText("Shared brief · Test move");
  await expect(header.getByRole("status")).toHaveText("");
  await expect(header.locator(".brief-header__yarn .yarn")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await seedSearch(page);
  await page.goto("/compare?kind=places&ids=uk%3Alsoa%3AE01000002,uk%3Alsoa%3AE01000003");
  await page.getByTestId("compare-brief").click();
  await expect(page).toHaveURL(/\/brief#shortlist=v1\./);
  await expect(page.getByTestId("brief-header").getByRole("status")).toHaveText("Your brief is ready", { timeout: 20_000 });
});

// G06: the brief is shared as a link that opens it (/brief#shortlist=v1.…), not only downloaded.
test("Copy link shares the brief's own link, which opens the brief", async ({ page }) => {
  await captureShares(page);
  await seedSearch(page);
  await page.goto("/compare?kind=places&ids=uk%3Alsoa%3AE01000002,uk%3Alsoa%3AE01000003");
  await page.getByTestId("compare-brief").click();
  const view = page.getByTestId("brief-page");
  await view.getByTestId("brief-copy-link").click();
  // v4 Task 38: the review comes first; nothing is copied before Confirm share.
  await view.getByTestId("share-review-confirm").click();
  await expect(view.getByTestId("share-status")).toContainText("Link copied");
  const link = new URL((await lastShare(page))!);
  expect(link.pathname).toBe("/brief");
  expect(link.hash.startsWith("#shortlist=v1.")).toBe(true);
  await page.goto(`${link.pathname}${link.hash}`);
  // Only the fragment differs: the page reads the new link afresh (hashchange), as a partner's fresh open would.
  await expect(page.getByTestId("brief-page")).toBeVisible();
  // What the partner opens: the Shared brief (v4.4).
  await expect(page.getByTestId("decision-brief-preview")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("brief-header")).toContainText("Shared brief");
});

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page (at the end: tests/failure-classification.test.ts cites this spec by line).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

