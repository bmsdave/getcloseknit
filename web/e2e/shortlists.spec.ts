import { expect, test, type Page } from "./fixtures";

import type { PreferenceProfile } from "../src/lib/contracts";
import { encodeSharedProfile } from "../src/lib/profile-state";
import { continueToReview, SEEDED_SEARCH } from "./wizard";
import { openMatchBuilder } from "./top-bar";
import { captureShares, lastShare } from "./share-capture";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

const STORAGE_KEY = "close-knit.saved-shortlists.v1";
const SHORTLIST_NAME = "E2E finalists";
const PRIVATE_NOTE = "E2E private note 48291";
const OFFICE_LABEL = "E2E Office 914";

// A search carrying a commute destination (an older saved search), opened from a share link so it
// works even where storage is denied.
const SEARCH = {
  ...SEEDED_SEARCH,
  commuteDestinations: [{ id: "dest-e2e", label: OFFICE_LABEL, latitude: 51.5, longitude: -0.12, mode: "transit",
    arrivalTime: "09:00", targetMinutes: 45, weight: 3 }],
} as unknown as PreferenceProfile;

async function openMatches(page: Page) {
  await page.goto(`/?layer=personal-match${encodeSharedProfile(SEARCH)}`);
  // The commute destination is routed as a job first: the list follows once it completes.
  await expect(page.getByTestId("match-results")).toBeVisible({ timeout: 30_000 });
  await openSaved(page);
}

/** Shortlists and the decision brief wait behind "Saved areas & costs". */
async function openSaved(page: Page) {
  const saved = page.getByTestId("saved-areas-costs");
  if ((await saved.getAttribute("open")) === null) await saved.locator(":scope > summary").click();
}

async function compareTwo(page: Page) {
  await page.getByRole("checkbox", { name: "Compare North London preview" }).click();
  await page.getByRole("checkbox", { name: "Compare South Bank preview" }).click();
  // The tray's Compare is a link to /compare now (v3 Fix 22); the two stay ticked for the shortlist.
  await expect(page.getByTestId("comparison-tray").getByRole("link", { name: "Compare areas" })).toHaveAttribute("href", /^\/compare\?/);
}

async function saveNamed(page: Page) {
  await page.getByLabel("Shortlist name").fill(SHORTLIST_NAME);
  await page.getByLabel(/Private notes/).fill(PRIVATE_NOTE);
  await page.getByRole("button", { name: /Save shortlist \(2 compared\)/ }).click();
  await expect(page.getByTestId("saved-shortlists")).toContainText(SHORTLIST_NAME);
}

async function storedShortlists(page: Page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw as string);
}

function decodeFragment(hash: string) {
  const encoded = hash.replace(/^#shortlist=v1\./, "");
  return JSON.parse(Buffer.from(encoded.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8"));
}

test("saves a named shortlist and reloads it with its stored payload", async ({ page }) => {
  await openMatches(page);
  await compareTwo(page);
  await saveNamed(page);

  const [entry] = await storedShortlists(page);
  expect(entry.name).toBe(SHORTLIST_NAME);
  expect(entry.candidates).toEqual(["uk:lsoa:E01000002", "uk:lsoa:E01000003"]);
  expect(entry.candidateNames["uk:lsoa:E01000002"]).toBe("North London preview");
  expect(entry.profile.schemaVersion).toBe("preference-profile.v1");
  expect(entry.mode).toBe("demo");
  expect(entry.release).toBe("preview-2026-09");
  expect(entry.notes).toBe(PRIVATE_NOTE);
  expect(entry.evidence).toHaveLength(2);
  expect(entry.evidence[0]).toMatchObject({ geographyId: "uk:lsoa:E01000002" });
  // The row reads like "Saved 10 Oct 2026, 16:27": no ISO time, release id or record id.
  const row = page.getByTestId("saved-shortlists").locator(".shortlist-list > li").first();
  await expect(row).toContainText(/Saved \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/);
  await expect(row).not.toContainText(/\d{4}-\d{2}-\d{2}T|preview-2026-09|demo/);
  await expect(row).not.toContainText(entry.id);

  await page.reload();
  await openMatches(page);
  await expect(page.getByTestId("saved-shortlists")).toContainText(SHORTLIST_NAME);
  const again = await storedShortlists(page);
  expect(again).toHaveLength(1);
  expect(again[0].notes).toBe(PRIVATE_NOTE);
});

// UX-61: repeated per-entry actions resolve by strict accessible name.
test("per-entry shortlist actions carry unique accessible names", async ({ page }) => {
  await openMatches(page);
  await compareTwo(page);
  await saveNamed(page);

  await expect(page.getByRole("button", { name: "Open E2E finalists", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Share E2E finalists", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Open E2E finalists", exact: true }).click();
  await expect(page.getByTestId("shortlist-restore")).toContainText("saved snapshot");
});

test("reload distinguishes the saved snapshot from an opt-in refresh", async ({ page }) => {
  await openMatches(page);
  await compareTwo(page);
  await saveNamed(page);

  await page.getByRole("button", { name: "Open E2E finalists" }).click();
  const restore = page.getByTestId("shortlist-restore");
  await expect(restore).toContainText("saved snapshot");
  await expect(restore).toContainText("preference-profile.v1");
  await expect(restore).toContainText("preview-2026-09");
  await expect(restore).toContainText("North London preview");
  const snapshot = await restore.textContent();
  await page.getByRole("button", { name: "Refresh from current data" }).click();
  await expect(restore).toContainText("saved snapshot");
  expect(await restore.textContent()).not.toBeNull();
  expect(snapshot).not.toBeNull();
});

test("sharing needs confirmation and stays redacted by default", async ({ page }) => {
  await captureShares(page);
  await openMatches(page);
  await compareTwo(page);
  await saveNamed(page);

  await page.getByRole("button", { name: "Share E2E finalists" }).click();
  const preview = page.getByTestId("shortlist-share-preview");
  await expect(preview).toBeVisible();
  // Plain words first; the profile version and release id wait behind "Details".
  await expect(page.getByTestId("shortlist-share-assumptions")).not.toContainText("preference-profile.v1");
  await preview.getByText("Details").click();
  await expect(preview.locator(".shortlist-details")).toContainText("preference-profile.v1");
  await expect(preview.locator(".shortlist-details")).toContainText("preview-2026-09");
  await expect(page.getByTestId("shortlist-share-assumptions")).toContainText("places excluded");
  await expect(page.getByTestId("shortlist-share-assumptions")).toContainText("notes excluded");

  await page.getByRole("button", { name: "Cancel share" }).click();
  expect(new URL(page.url()).hash).not.toMatch(/shortlist=v1/);

  await page.getByRole("button", { name: "Share E2E finalists" }).click();
  await page.getByRole("button", { name: "Confirm shortlist share" }).click();
  // Never silent: the share sheet, the clipboard, or the link to copy, said in words.
  await expect(page.getByTestId("saved-shortlists").getByTestId("share-status")).toContainText(/Link (copied|shared)|Copy it from here/);
  const link = new URL((await lastShare(page))!);

  const payload = decodeFragment(link.hash);
  expect(payload.candidates).toEqual(["uk:lsoa:E01000002", "uk:lsoa:E01000003"]);
  expect(JSON.stringify(payload)).not.toContain(PRIVATE_NOTE);
  expect(JSON.stringify(payload)).not.toContain(OFFICE_LABEL);
});

test("explicit opt-in share carries destinations and notes after preview", async ({ page }) => {
  await captureShares(page);
  await openMatches(page);
  await compareTwo(page);
  await saveNamed(page);

  await page.getByRole("button", { name: "Share E2E finalists" }).click();
  await page.getByLabel("Include exact places (destinations, pinned points, drawn areas) in this share").check();
  await page.getByLabel("Include private notes in this share").check();
  await expect(page.getByTestId("shortlist-share-assumptions")).toContainText("places included");
  await page.getByRole("button", { name: "Confirm shortlist share" }).click();
  await expect.poll(() => lastShare(page)).toMatch(/#shortlist=v1\./);

  const payload = decodeFragment(new URL((await lastShare(page))!).hash);
  expect(JSON.stringify(payload)).toContain(PRIVATE_NOTE);
  // Destinations travel inside the nested profile fragment, still encoded
  // after the outer decode, so decode once more before asserting the label.
  const profile = JSON.parse(Buffer.from(
    (payload.profileFragment as string).replace(/^#profile=v1\./, "").replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  ).toString("utf8"));
  expect(JSON.stringify(profile)).toContain(OFFICE_LABEL);
});

test("a share link imports explicitly and deletes cleanly", async ({ page }) => {
  await captureShares(page);
  await openMatches(page);
  await compareTwo(page);
  await saveNamed(page);
  await page.getByRole("button", { name: "Share E2E finalists" }).click();
  await page.getByRole("button", { name: "Confirm shortlist share" }).click();
  await expect.poll(() => lastShare(page)).toMatch(/#shortlist=v1\./);
  // The link opens the brief; the same fragment on the map offers the import.
  const shared = `/${new URL((await lastShare(page))!).hash}`;

  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.goto(shared);
  // The share URL differs from the current page only by fragment, which browsers
  // open same-document without reloading — reload to exercise a fresh open.
  await page.reload();
  await openMatchBuilder(page);
  await continueToReview(page);
  await openSaved(page);
  const banner = page.getByTestId("shortlist-import");
  await expect(banner).toBeVisible();
  await expect(page.getByTestId("shortlist-import-assumptions")).toContainText(SHORTLIST_NAME);
  await expect(page.getByTestId("shortlist-import-assumptions")).toContainText("Built on demo data");
  await expect(banner.locator(".shortlist-details")).toContainText("preview-2026-09");
  // The import banner (inside the section) names the share — the saved list itself must be empty.
  await expect(page.getByTestId("saved-shortlists")).toContainText("Nothing saved yet");

  await page.getByRole("button", { name: "Import shortlist" }).click();
  await expect(page.getByTestId("saved-shortlists")).toContainText(SHORTLIST_NAME);
  expect(await storedShortlists(page)).toHaveLength(1);

  await page.getByRole("button", { name: `Delete ${SHORTLIST_NAME}` }).click();
  await expect(page.getByTestId("saved-shortlists")).not.toContainText(SHORTLIST_NAME);
  expect(await storedShortlists(page)).toHaveLength(0);
});

test("denied storage keeps every shortlist control usable", async ({ page }) => {
  await page.addInitScript(() => {
    const denied = () => { throw new DOMException("denied", "SecurityError"); };
    Object.defineProperty(window, "localStorage", { value: { getItem: denied, setItem: denied, removeItem: denied } });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await openMatches(page);
  await compareTwo(page);
  await expect(page.getByTestId("saved-shortlists")).toContainText("unavailable");
  await page.getByLabel("Shortlist name").fill(SHORTLIST_NAME);
  await page.getByRole("button", { name: /Save shortlist \(2 compared\)/ }).click();
  await expect(page.getByTestId("saved-shortlists")).toContainText("unavailable");
  expect(errors).toEqual([]);
});

// G07: Share shortlist shares the brief (/brief#shortlist=v1.…) and leaves the map's address alone.
test("Share shortlist shares the brief's link, not the map's", async ({ page }) => {
  await captureShares(page);
  await openMatches(page);
  await compareTwo(page);
  await saveNamed(page);
  const before = page.url();
  await page.getByRole("button", { name: "Share E2E finalists" }).click();
  await page.getByRole("button", { name: "Confirm shortlist share" }).click();
  await expect(page.getByTestId("saved-shortlists").getByTestId("share-status")).toContainText("Link copied");
  const link = new URL((await lastShare(page))!);
  expect(link.pathname).toBe("/brief");
  expect(link.hash.startsWith("#shortlist=v1.")).toBe(true);
  expect(page.url()).toBe(before);
});

// G24: Saved areas show without a search, at desktop and phone widths.
for (const width of [1280, 390]) {
  test(`saved areas show with no profile at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/area/lsoa/E01000001");
    await page.getByTestId("area-save-actions").getByTestId("save-area").click();
    // The heart is the save (v3 Fix 22); it fills once saved.
    await expect(page.getByTestId("area-save-actions").getByTestId("save-area")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("header-saved-areas").click();
    // ♡ N opens Saved on the map: the area is there with no search set.
    const panel = page.getByTestId("saved-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByTestId("saved-block-areas")).toContainText(/Westminster|St James/);
    // My match without a search keeps its three start rows and shows the saved areas too.
    await page.goto("/?layer=personal-match");
    const saved = page.getByTestId("saved-areas-costs");
    await expect(saved).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("match-budget-start")).toBeVisible();
    await saved.locator(":scope > summary").click();
    await expect(saved.getByTestId("saved-shortlists")).toContainText("My shortlist");
  });
}
