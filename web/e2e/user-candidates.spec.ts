import { expect, test, type Page } from "./fixtures";
import { openEvidenceSection } from "./evidence";

const STORAGE_KEY = "close-knit.user-candidates.v1";
const KNOWN_ADDRESS = "1 Parliament Preview, London, SW1A 1AA";
const UNKNOWN_ADDRESS = "99 Nowhere Lane, London E9 9ZZ";
const CANDIDATE_NOTE = "E2E candidate note 517";

async function openCandidates(page: Page) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await openEvidenceSection(page, "Plan & check");
  const panel = page.getByTestId("user-candidates");
  await expect(panel).toBeVisible();
  return panel;
}

async function storedCandidates(page: Page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw as string);
}

async function saveCandidate(page: Page, address: string, amount: string) {
  await page.getByLabel("Home address").fill(address);
  await page.getByLabel("Asking kind").selectOption("sale");
  await page.getByLabel("Asking amount").fill(amount);
  await page.getByLabel("Price unit").selectOption("gbp-total");
  await page.getByRole("button", { name: "Save home" }).click();
}

test("adds and edits a candidate, opens official history, keeps asking distinct from achieved", async ({ page }) => {
  const panel = await openCandidates(page);

  await page.getByLabel("Home address").fill(KNOWN_ADDRESS);
  await page.getByLabel("Listing link (optional)").fill("https://example.invalid/listing/42");
  await page.getByLabel("Asking kind").selectOption("sale");
  await page.getByLabel("Asking amount").fill("600000");
  await page.getByLabel("Price unit").selectOption("gbp-total");
  await page.getByLabel("Bedrooms (optional)").fill("2");
  await page.getByLabel("Floor area in square metres (optional)").fill("54");
  await page.getByLabel("Private notes (optional)").fill(CANDIDATE_NOTE);
  await page.getByRole("button", { name: "Save home" }).click();
  await expect(page.getByTestId("candidate-status")).toContainText(`Home saved: ${KNOWN_ADDRESS}.`);

  const card = page.getByTestId("user-candidate");
  await expect(card).toContainText("Asking price (you entered, unverified)");
  await expect(card).toContainText("£600,000");
  await expect(card).toContainText("unverified · observed");
  await expect(card).toContainText("Linked to official records via verified-uprn");
  await expect(card).toContainText(CANDIDATE_NOTE);

  const stored = await storedCandidates(page);
  expect(stored.candidates).toHaveLength(1);
  expect(stored.candidates[0].asking.value.amount).toBe(600000);
  expect(stored.candidates[0].asking.verification).toBe("unverified");
  expect(stored.candidates[0].linkage).toMatchObject({ status: "linked", matchMethod: "verified-uprn" });

  await page.getByRole("button", { name: `Show official history for ${KNOWN_ADDRESS}` }).click();
  const history = page.getByTestId("candidate-official-history");
  await expect(history).toContainText("Achieved £570,000 on 2022-11-03 (official record)");
  await expect(history).toContainText("never combined");

  const asking = page.getByTestId("candidate-asking");
  await expect(asking).toContainText("Asking price (you entered, unverified)");
  await expect(asking).not.toContainText("Achieved");
  await expect(history).not.toContainText("Asking price (you entered, unverified)");

  const panelText = (await panel.textContent()) ?? "";
  expect(panelText).not.toMatch(/days on market/i);
  expect(panelText).not.toMatch(/photo/i);

  await page.getByLabel(`Edit asking amount for ${KNOWN_ADDRESS}`).fill("595000");
  await page.getByRole("button", { name: `Save changes for ${KNOWN_ADDRESS}` }).click();
  await expect(card).toContainText("£595,000");
  await expect(page.getByTestId("candidate-status")).toContainText(`Home updated: ${KNOWN_ADDRESS}.`);

  await page.reload();
  const restored = await openCandidates(page);
  await expect(restored).toContainText("£595,000");
  await expect(restored).toContainText("Asking price (you entered, unverified)");
});

test("unknown addresses stay unlinked and invalid entries are rejected with guidance", async ({ page }) => {
  await openCandidates(page);

  await saveCandidate(page, UNKNOWN_ADDRESS, "450000");
  await expect(page.getByTestId("candidate-status")).toContainText(`Home saved: ${UNKNOWN_ADDRESS}.`);
  const card = page.getByTestId("user-candidate");
  await expect(card).toContainText("Not linked to any official record (unknown-address)");
  await expect(card).toContainText("No official history yet");
  const stored = await storedCandidates(page);
  expect(stored.candidates[0].linkage).toMatchObject({ status: "unlinked", reason: "unknown-address" });
  expect(stored.candidates[0].uprn).toBeNull();

  await page.getByLabel("Home address").fill("Another Place, London E2 2AA");
  await page.getByLabel("Listing link (optional)").fill("not a url");
  await page.getByLabel("Asking amount", { exact: true }).fill("450000");
  await page.getByRole("button", { name: "Save home" }).click();
  await expect(page.getByTestId("candidate-status")).toContainText("must be an http(s) URL");

  await page.getByLabel("Listing link (optional)").fill("");
  await page.getByLabel("Price unit").selectOption("gbp-per-month");
  await page.getByRole("button", { name: "Save home" }).click();
  await expect(page.getByTestId("candidate-status")).toContainText("a sale needs £ total");
  expect((await storedCandidates(page)).candidates).toHaveLength(1);
});

// G17: a listing saved from a portal shows on its area page, opening Check a home.
test("a saved listing shows under Saved homes here on its area page", async ({ page }) => {
  const listing = {
    url: "https://www.rightmove.co.uk/properties/1", portal: "rightmove", address: "1 Example Street, London SW1A 1AA",
    market: "buy", askingPrice: 650000, bedrooms: 2, floorAreaSqm: null, geographyId: "uk:lsoa:E01000001",
  };
  const fragment = Buffer.from(JSON.stringify(listing)).toString("base64url");
  await page.goto(`/save-listing#listing=v1.${fragment}`);
  // v3 Fix 17: a short confirmation; the home is in ♡ Saved.
  await expect(page.getByTestId("save-listing-title")).toHaveText("Saved");
  await expect(page.getByTestId("save-listing-line")).toHaveText("1 Example Street, London SW1A 1AA · £650,000 asking · 2 bed is in your Saved list.");
  await expect(page.getByTestId("save-listing-open-saved")).toHaveAttribute("href", "/?saved=1");
  await expect(page.getByTestId("save-listing-area")).toHaveAttribute("href", "/area/lsoa/E01000001");
  // r3 #14: back to the portal's own page.
  await expect(page.getByTestId("save-listing-back")).toHaveAttribute("href", listing.url);
  await expect(page.getByTestId("header-saved-areas")).toHaveAttribute("aria-label", "Saved (1)");
  await page.reload();
  await expect(page.getByTestId("save-listing-title")).toHaveText("Already saved");
  await page.goto("/area/lsoa/E01000001");
  const saved = page.getByTestId("saved-homes-here");
  await expect(saved).toContainText("1 Example Street");
  await expect(saved.getByRole("link")).toHaveAttribute("href", /^\/tools\/check-a-home\?area=uk%3Alsoa%3AE01000001/);
  // Another area shows none.
  await page.goto("/area/lsoa/E01000002");
  await expect(page.getByTestId("area-full-page")).toBeVisible();
  await expect(page.getByTestId("saved-homes-here")).toHaveCount(0);
});
