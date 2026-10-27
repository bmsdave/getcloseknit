import { expect, test, type Page } from "./fixtures";
import { openEvidenceSection } from "./evidence";

// "Plan & check a home": five questions to ask the agent, ticked on this
// device, with links to the money tools. It replaced the long viewing and
// leasehold diligence forms.

const STORAGE_KEY = "close-knit.agent-questions.v1";
const PROFILE_KEY = "close-knit.preference-profile.v1";

const SEEDED_PROFILE = {
  schemaVersion: "preference-profile.v1",
  market: "buy",
  targetBudget: 500000,
  maximumBudget: 650000,
  bedrooms: 2,
  forecastHorizon: "1y",
  factors: [],
  commuteDestinations: [],
  school: {
    phases: ["primary"], characteristics: [],
    facetWeights: { progress: 3, attainment: 2, attendance: 1 },
    shortlistUrns: [], desiredSchoolCount: 3,
  },
  analyticsConsent: false,
};

async function seedProfile(page: Page, profile: object = SEEDED_PROFILE) {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: PROFILE_KEY, value: profile },
  );
}

async function openChecklist(page: Page) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await openEvidenceSection(page, "Plan & check");
  const checklist = page.getByTestId("viewing-checklist");
  await expect(checklist).toBeVisible();
  return checklist;
}

test("five questions for the agent; a tick is kept after reload", async ({ page }) => {
  await seedProfile(page);
  const checklist = await openChecklist(page);
  await expect(checklist.getByRole("checkbox")).toHaveCount(5);
  for (const words of ["lease", "service charge", "ground rent", "major works", "energy certificate"]) {
    await expect(checklist).toContainText(words);
  }
  await expect(page.getByTestId("viewing-progress")).toContainText("0 of 5 asked");

  await checklist.getByTestId("agent-question-ground-rent").check();
  await expect(page.getByTestId("viewing-progress")).toContainText("1 of 5 asked");
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(stored).toContain("ground-rent");

  await page.reload();
  const restored = await openChecklist(page);
  await expect(restored.getByTestId("agent-question-ground-rent")).toBeChecked();
  await expect(restored.getByTestId("agent-questions-tools").getByRole("link")).toHaveCount(3);
});

test("the checklist never claims surveyed, safe, or legally verified", async ({ page }) => {
  await seedProfile(page);
  const checklist = await openChecklist(page);
  for (const box of await checklist.getByRole("checkbox").all()) await box.check();
  await expect(page.getByTestId("viewing-progress")).toContainText("5 of 5 asked");
  const text = (await checklist.textContent()) ?? "";
  expect(text).not.toMatch(/\b(surveyed|safe|legally|verified)\b/i);
  await expect(checklist).toContainText("your own note");
  await expect(page.getByRole("button", { name: /book/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /contact an agent|contact the agent/i })).toHaveCount(0);
});

test("denied storage keeps every checklist control usable", async ({ page }) => {
  await page.addInitScript(() => {
    const denied = () => { throw new DOMException("denied", "SecurityError"); };
    Object.defineProperty(window, "localStorage", { value: { getItem: denied, setItem: denied, removeItem: denied } });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const checklist = await openChecklist(page);
  await expect(checklist).toContainText("will not survive reload");
  await checklist.getByRole("checkbox").first().check();
  await expect(checklist.getByRole("checkbox").first()).toBeChecked();
  expect(errors).toEqual([]);
});

// Renters get the referencing check (seeded from the monthly rent target), the
// Renters' Rights Act note, and renter questions starting with damp and mould.
test("renters get a referencing check and a damp-mould question", async ({ page }) => {
  await seedProfile(page, { ...SEEDED_PROFILE, market: "rent", targetBudget: 2000, maximumBudget: 2400 });
  const checklist = await openChecklist(page);
  await expect(checklist).toContainText("damp and mould");

  const check = page.getByTestId("referencing-check");
  await expect(check.getByLabel("Monthly rent (£/month)")).toHaveValue("2,000");
  await expect(check.getByTestId("referencing-required")).toHaveText("£60,000");
  await check.getByLabel("Your gross income (£/year)").fill("35000");
  await expect(check.getByTestId("referencing-verdict")).toContainText("£25,000 short");
  await check.getByLabel("Co-tenant gross income (£/year)").fill("28000");
  await expect(check.getByTestId("referencing-verdict")).toContainText("meets the usual threshold");
  await expect(check.getByTestId("referencing-guarantor")).toHaveText("£72,000");
  await check.getByLabel("No UK credit history yet").check();
  await expect(check.getByTestId("referencing-notes")).toContainText("guarantor services");
  await expect(check.getByTestId("renters-rights")).toContainText("2026-05-01");
});
