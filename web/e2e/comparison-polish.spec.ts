import { expect, test, type Page } from "./fixtures";
import { PROFILE_KEY, SEEDED_SEARCH } from "./wizard";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

// Review #1 and #2 (docs/site-review-2026-10): the map, Compare and the brief show the same figures in plain
// words. v4.5: the area card no longer carries a ballpark (.brief-fit went with the old card); the map's pin
// does, and the brief is reached the v4 way (Compare › Brief), not the old "Saved areas & costs" block.

const OFFICE = "Office E2E 41";
const SEARCH = {
  ...SEEDED_SEARCH,
  targetBudget: 480000,
  maximumBudget: 600000,
  places: [{
    id: "work", label: OFFICE, target: { kind: "point", latitude: 51.501, longitude: -0.1416 },
    mode: "transit", targetMinutes: 45, weight: 3, must: false,
  }],
};
const AREA = "North London preview";
const COMPARE = "/compare?kind=places&ids=uk%3Alsoa%3AE01000002,uk%3Alsoa%3AE01000003";

async function seed(page: Page) {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: PROFILE_KEY, value: SEARCH });
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "each test sets its own viewports");
});

test("the map's pin, Compare and the brief show the same price and journey minutes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seed(page);
  await page.goto("/?layer=personal-match");
  // The top result is the area the brief leads with; its pin carries the ballpark.
  const first = page.getByTestId("match-top").getByTestId("match-row").first();
  await expect(first).toContainText(AREA);
  await first.locator(".match-row__main").click();
  const pin = page.locator(".bm-area.bm-selected");
  await expect(pin).toContainText(/~£\d+k/, { timeout: 15_000 });
  const price = (await pin.innerText()).match(/~£\d+k/)![0];

  // Compare: the trip to the place, door to door, as the search scored it.
  await page.goto(COMPARE);
  const trip = page.locator(`[data-row="${OFFICE}"] td`).first();
  await expect(trip).toHaveText(/^\d+ min(Best)?$/, { timeout: 15_000 });
  const minutes = (await trip.innerText()).match(/^(\d+) min/)![1];

  await page.getByTestId("compare-brief").click();
  const preview = page.getByTestId("decision-brief-preview");
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview).toContainText(`${price} · `);
  await expect(preview).toContainText(`Price: ${AREA} ${price}`);
  // AE-09: the place stays "Your place 1" until destinations are included.
  await expect(preview).toContainText(`${minutes} min to Your place 1`);
  await expect(preview).not.toContainText(OFFICE);
  await page.getByLabel("Include precise commute destinations").check();
  await expect(preview).toContainText(`${minutes} min to ${OFFICE}`);
  // Defaults are assumptions, never stated as the household's own.
  await expect(preview).toContainText("Assumed (you didn't set these)");
  await expect(preview).not.toContainText("target budget");
  await expect(preview).not.toContainText("weights you set");
  // Nothing priced yet: the brief asks for a price instead of a £0 total.
  await expect(preview).toContainText("Add a price to see monthly costs.");
  await expect(preview).not.toContainText("Known monthly total £0");
});
