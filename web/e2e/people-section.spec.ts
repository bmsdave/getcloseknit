import { expect, test, type Page } from "./fixtures";
import { openEvidenceSection } from "./evidence";
import { longParagraphs } from "./text-density";

// PeopleSection in two sections of the area card, with demo fixtures, never merged (v3 Fix 29):
// Homes (type of home, owned or rented; grey, descriptive) and People (density, households, ages,
// ethnic group, country of birth and religion): one row per category, the area's bar with London's
// tick on the same scale, the share, and a chip only for gaps of 5 points or more. Top four plus
// Other with "Show all n categories"; ages in their natural order; one legend; a plain lead line per
// topic, none for religion. Never qualifications, jobs or work. Real mode refusing demo figures is
// unit-tested (tests/people-profile.test.ts).
const HIDDEN_TOPICS = ["qualification", "occupation", "economic-activity"];

async function openPeople(page: Page, id: string) {
  await page.goto(`/?selected=${encodeURIComponent(id)}&period=2026-06`);
  await expect(page.getByTestId("selected-area")).toBeVisible();
  await openEvidenceSection(page, "People");
}

test("one row per category with a London tick, chips at 5 points, top 4 + Other, ages in order, no jobs", async ({ page }) => {
  await openPeople(page, "uk:lsoa:E01000001");
  const section = page.getByTestId("people-section");
  const homesSection = page.getByTestId("homes-section");
  // Homes and People are separate sections: the homes' topics never sit under People.
  await expect(section.getByTestId("people-topic-accommodation")).toHaveCount(0);
  // Homes shows one chart at a time (board V3-33d): Homes, then Tenure from the toggle.
  await expect(homesSection.getByTestId("people-topic-accommodation")).toHaveCount(1);
  await expect(homesSection.getByTestId("people-topic-tenure")).toHaveCount(0);
  await homesSection.getByTestId("homes-view-tenure").click();
  await expect(homesSection.getByTestId("homes-view-tenure")).toHaveAttribute("aria-pressed", "true");
  await expect(homesSection.getByTestId("people-topic-tenure")).toHaveCount(1);
  await expect(homesSection.getByTestId("people-topic-accommodation")).toHaveCount(0);
  // Facts first, as chips: density in words and households (once, under People), deprivation in deciles.
  await expect(page.getByTestId("people-key-numbers")).toContainText(/households/);
  await expect(page.getByTestId("people-density")).toContainText(/people \/ km² · .*London's density/);
  await expect(page.getByTestId("people-key-numbers")).toContainText(/Deprivation: (among London's (least|most) deprived \d+%|around London's middle)/);
  await expect(page.getByTestId("homes-key-numbers")).toHaveCount(0);
  for (const id of HIDDEN_TOPICS) await expect(page.getByTestId(`people-topic-${id}`), id).toHaveCount(0);
  await expect(section).not.toContainText(/Who lives here|qualification|Jobs/);
  // One legend per section.
  await expect(section.getByTestId("share-legend")).toHaveCount(1);
  await expect(section.getByTestId("share-legend")).toContainText("London");
  await expect(section.getByTestId("people-chart").locator(".share-topic")).toHaveCount(5);

  // Ages keep their natural order, every band shown, no Show all.
  const age = page.getByTestId("people-topic-age");
  await expect(age.locator(".share-row__label")).toHaveText(["0 to 14", "15 to 24", "25 to 44", "45 to 64", "65 and over"]);
  await expect(age.getByTestId("people-show-all")).toHaveCount(0);
  // Each row: the share in words and London's tick on the same scale; chips only for 5+ points.
  const row = age.locator(".share-row").first();
  await expect(row.locator(".share-row__value")).toHaveText(/^(\d+|<1)%$/);
  await expect(row.locator(".share-row__tick")).toHaveCount(1);
  const chips = await page.locator("[data-testid=people-section] .diff-chip").allTextContents();
  for (const chip of chips) expect(Math.abs(Number(chip.replace("−", "-")))).toBeGreaterThanOrEqual(5);
  // A plain lead line per topic, none for religion (descriptive only).
  await expect(page.getByTestId("people-topic-religion").getByTestId("people-lead")).toHaveCount(0);
  await expect(page.getByTestId("people-topic-religion").locator(".share-row").first()).toBeVisible();

  // Unordered topics: the top four and Other, then Show all opens every category.
  const ethnicity = page.getByTestId("people-topic-ethnicity");
  await expect(ethnicity.locator(".share-row")).toHaveCount(5);
  await expect(ethnicity.locator(".share-row").last().locator(".share-row__label")).toHaveText("Other");
  const all = ethnicity.getByTestId("people-show-all");
  await expect(all).toHaveText(/^Show all \d+ categories$/);
  await all.click();
  await expect(all).toHaveAttribute("aria-expanded", "true");
  expect(await ethnicity.locator(".share-row").count()).toBeGreaterThan(5);
  await expect(ethnicity.locator(".share-row__label", { hasText: /^Other$/ })).toHaveCount(0);
  await all.click();
  await expect(ethnicity.locator(".share-row")).toHaveCount(5);
});

test("rows above the fold and no long paragraphs", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPeople(page, "uk:lsoa:E01000001");
  await page.getByTestId("evidence-section-homes").evaluate((node) => node.scrollIntoView({ block: "start" }));
  await expect(page.getByTestId("people-topic-accommodation").locator(".share-row").first()).toBeInViewport();
  expect(await longParagraphs(page)).toEqual([]);
});

test("a topic without figures reads unknown, never 0", async ({ page }) => {
  // The browser reads the section (no server-rendered seed), so the mock applies.
  await page.setExtraHTTPHeaders({ "x-close-knit-seed": "off" });
  await page.route(/\/api\/v1\/areas\/[^/?]+\/people/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const topic of body.topics) {
      if (topic.id !== "tenure") continue;
      topic.total = null;
      for (const category of topic.categories) Object.assign(category, { count: null, share: null });
    }
    await route.fulfill({ response, json: body });
  });
  await openPeople(page, "uk:lsoa:E01000001");
  await page.getByTestId("homes-view-tenure").click();
  const tenure = page.getByTestId("people-topic-tenure");
  await expect(tenure).toContainText("Unknown");
  await expect(tenure).not.toContainText("0%");
  await expect(tenure.locator(".share-row")).toHaveCount(0);
});

test("an unknown area has no people figures", async ({ request }) => {
  const missing = await request.get("/api/v1/areas/uk%3Alsoa%3AE01009999/people");
  expect(missing.status()).toBe(404);
});

test("buttons are styled, at least 44px tall, and the section fits the screen", async ({ page }) => {
  await openPeople(page, "uk:lsoa:E01000002");
  const homes = page.getByTestId("people-topic-accommodation");
  await expect(homes.locator(".share-row").first()).toBeVisible();
  await homes.getByTestId("people-show-all").click();
  await expect(homes.getByTestId("people-show-all")).toHaveText("Show top 4");
  const buttons = page.locator("[data-testid=people-section] button, [data-testid=homes-section] button");
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await button.evaluate((element) => getComputedStyle(element).borderTopStyle)).not.toMatch(/outset|inset/);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
