import { expect, test, type Locator, type Page } from "./fixtures";

import { openEvidenceSection, openLink } from "./evidence";
import { seedClassicSearch } from "./wizard";

// Demo mode: the preview cards (lib/school-card-fixture.ts), labelled demo on the page.

/** The ☰ menu (a native popover) holds every source, definition and method note. */
async function openMenu(page: Page): Promise<Locator> {
  await page.getByTestId("school-sources-button").click();
  const menu = page.getByTestId("school-sources");
  await expect(menu).toBeVisible();
  return menu;
}

test("a secondary's card: Top school badge, Ofsted grade, KPI tiles, chart gap, Ofsted words with the report link", async ({ page }) => {
  await page.goto("/school/100002");
  const card = page.getByTestId("school-card");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("North London Secondary Preview");
  await expect(page).toHaveTitle("North London Secondary Preview – Ofsted Good (2023) · GCSE results 2024/25 · Close Knit");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/school\/100002$/);
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').allTextContents()).find((text) => text.includes("HighSchool")) ?? "{}");
  expect([ld["@type"], ld.name, ld.aggregateRating]).toEqual(["HighSchool", "North London Secondary Preview", undefined]);
  await expect(page.getByText("Demo data · not for decisions")).toBeVisible();

  // Badges: the legacy grade with its date, never mixed; Top school is a plain badge, its criteria in the ☰ menu.
  // No result chips: Results says how high, once.
  const badges = card.getByTestId("school-badges");
  await expect(badges.getByTestId("ofsted-badge")).toHaveText("Ofsted Good · inspected May 2023");
  await expect(badges.getByTestId("top-school-badge")).toHaveText("Top school 2024/25");
  await expect(badges).not.toContainText(/Top 10% results|Strong sixth form/);
  await page.getByTestId("school-sources-button").click();
  await expect(page.getByTestId("school-top-method")).toContainText("Attainment 8: P93 of London secondaries (2024/25)");
  await page.getByTestId("school-sources-close").click();

  // KPI tiles (in the Results section): the real value, the /10 against London, or why there is none.
  const kpis = card.getByTestId("school-kpi");
  await expect(kpis).toHaveCount(5);
  await expect(kpis.first().getByTestId("school-kpi-value")).toHaveText("61.5");
  await expect(kpis.first()).toHaveAttribute("aria-label", /Attainment 8 10 out of 10/);
  await expect(card.locator('[data-measure="ks4-ebacc-aps"]')).toContainText("No results published for 2024/25");
  // A figure from an earlier year keeps its year; why it is not newer is in the menu.
  await expect(card.locator('[data-measure="ks4-progress8"]')).toContainText("2023/24");

  // Results by year (behind "Show by year" on a phone): a labelled gap where no exams were sat.
  await card.getByTestId("school-by-year").evaluate((details) => { (details as HTMLDetailsElement).open = true; });
  const chart = card.locator('[data-testid="school-results-chart"][data-measure="ks4-attainment8"]');
  await expect(chart.getByTestId("school-chart-gap")).toHaveText("No exams");
  await expect(card.getByTestId("school-by-year")).toContainText("No exams 2019/20–21");
  await expect(chart.getByRole("img")).toHaveAttribute("aria-label", /Attainment 8: 52\.1 in 2015\/16 to 61\.5 in 2024\/25; London median 50\.2/);
  // The highest and lowest years are printed on the chart, not only on hover.
  await expect(chart.getByTestId("school-chart-value")).toHaveText(["61.5", "52.1"]);
  // Inspections: each stop links to its report; an ungraded visit says it has no grade.
  const timeline = card.getByTestId("school-timeline");
  await expect(timeline.locator('li[data-tone="none"]')).toContainText("2019");
  // The latest stop's grade is the header badge's: its dot and year only, never the word twice.
  await expect(timeline.locator("li[data-latest] .sc-timeline__grade")).toHaveCount(0);
  await expect(card.getByTestId("school-distance")).toHaveCount(0);
  // Strong and weak areas once, in Inspections, beside the grade's history.
  await expect(card.getByTestId("school-strengths")).toContainText("5 areas graded · safeguarding effective · 1 point to improve");

  // Ofsted's own words (in Inspections), one tap away: short, dated, linked to the report.
  const tldr = card.getByTestId("school-tldr");
  await expect(tldr.locator("summary")).toHaveText("Read what Ofsted said (4)");
  await tldr.locator("summary").click();
  await expect(tldr.getByTestId("school-tldr-report")).toHaveText("From Ofsted report, inspected May 2023");
  await expect(tldr.getByTestId("school-tldr-report")).toHaveAttribute("href", /^https:\/\/reports\.ofsted\.gov\.uk/);
  await expect(tldr.locator("li")).toHaveCount(4);

  // Getting in: the council's last distance offered by year; its credit and link in the menu.
  await expect(card.getByTestId("school-last-offered")).toContainText("1.4 km");
  await expect(card.getByTestId("school-area-link")).toHaveAttribute("href", "/area/lsoa/E01000001");
  // No stars or third-party reviews, ever.
  await expect(card).not.toContainText(/★|stars?\b/i);
  const menu = await openMenu(page);
  await expect(menu.getByTestId("school-offered-source")).toHaveText("Islington Council");
  await expect(menu.getByTestId("school-unpublished")).toHaveText("Progress 8: Not published for 2024/25: Progress 8 returns with 2026/27 results.");
  await expect(menu.getByTestId("school-timeline-key")).toContainText("Ungraded visit, no grade");
});

test("issue #201: a secondary's card shows the combined A-level rank with the selection note", async ({ page }) => {
  await page.goto("/school/100002");
  const card = page.getByTestId("school-card");
  const block = card.getByTestId("school-sixth-form-rank");
  await expect(block).toContainText("A-level results");
  await expect(block).toContainText("#45 of 480 London sixth forms, state and independent, 2024/25");
  await expect(block).toContainText("choose their pupils");
});

test("a primary's card: report-card grid, no Top badge, withheld year and unpublished progress said", async ({ page }) => {
  await page.goto("/school/100001");
  const card = page.getByTestId("school-card");
  // The badge: the report card's date and its lowest area's colour, never an overall word; the areas once, in Inspections.
  const ofsted = card.getByTestId("ofsted-badge");
  await expect(ofsted).toHaveAttribute("data-framework", "report-card");
  await expect(ofsted).toHaveText("Ofsted report card · inspected Feb 2026");
  const areas = card.getByTestId("school-ofsted-areas");
  await expect(areas).toContainText("Personal development and well-being");
  await expect(areas).toContainText("Met");
  await expect(card.getByTestId("school-strengths").locator("ul")).toHaveCount(0);
  // The grid already counts strong and weak areas: no "6 strong · 0 weak" under it.
  await expect(card.getByTestId("school-section").filter({ hasText: "Inspections" })).not.toContainText(/\d+ strong · \d+ weak/);
  await expect(card.getByTestId("top-school-badge")).toHaveCount(0);
  // The arrows' start year is on the card once, so "+12 pts" never reads as a gap to London.
  await expect(card.getByTestId("school-kpi-trend-from")).toHaveText("Arrows: London rank change since 2018/19");
  await card.getByTestId("school-by-year").evaluate((details) => { (details as HTMLDetailsElement).open = true; });
  const chart = card.locator('[data-testid="school-results-chart"][data-measure="ks2-rwm-expected"]');
  await expect(chart).toContainText("Withheld 2023/24");
  await expect(chart).toContainText("Not published 2021/22");
  await expect((await openMenu(page)).getByTestId("school-unpublished")).toContainText("Not published for 2023/24 or 2024/25");
});

test("every link and control on the card has a 44px-tall target", async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    for (const urn of ["100001", "100002"]) {
      await page.goto(`/school/${urn}`);
      const card = page.getByTestId("school-card");
      // Every disclosure and the ☰ menu open, so the links inside are measured too.
      await card.evaluate((root) => root.querySelectorAll("details").forEach((details) => { (details as HTMLDetailsElement).open = true; }));
      await openMenu(page);
      const small = await card.evaluate((root) => [...root.querySelectorAll<HTMLElement>("a[href], summary, button")]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => ({ box: element.getBoundingClientRect(), name: (element.textContent ?? "").trim().slice(0, 40) }))
        .filter(({ box }) => box.height < 44 || box.width < 24)
        .map(({ box, name }) => `${Math.round(box.width)}x${Math.round(box.height)} ${name}`));
      expect(small, `${urn} at ${viewport.width}px`).toEqual([]);
    }
  }
});

test("in demo mode each school's area link opens a demo area page", async ({ page }) => {
  for (const urn of ["100001", "100002"]) {
    await page.goto(`/school/${urn}`);
    const link = page.getByTestId("school-card").getByTestId("school-area-link");
    const href = (await link.getAttribute("href"))!;
    expect((await page.request.get(href)).status()).toBe(200);
    await link.click();
    await page.waitForURL(`**${href}`);
    await expect(page.getByTestId("area-full-page")).toBeVisible();
  }
});

// v4 Task 34: "Homes near this school" under the header, the nearest postcodes with homes as links.
test("Homes near this school sits under the header and links each postcode's homes", async ({ page }) => {
  await page.goto("/school/100001");
  const near = page.getByTestId("school-card").getByTestId("school-homes-near");
  await expect(near.getByRole("heading", { name: "Homes near this school" })).toBeVisible();
  const [nearBox, sectionsBox] = await Promise.all([near.boundingBox(), page.getByTestId("school-sections").boundingBox()]);
  expect(nearBox!.y).toBeLessThan(sectionsBox!.y);
  const postcode = near.getByTestId("school-homes-near-postcode").first();
  await expect(postcode).toHaveAttribute("href", "/postcode/SW1A-1AB/homes");
  await expect(postcode).toContainText(/SW1A 1AB\s*3 homes · 240 m/);
  // What's next points to it; there is no second, different homes link.
  await expect(page.getByTestId("next-homes-near")).toHaveAttribute("href", "#homes-near");
  await expect(page.getByTestId("next-homes")).toHaveCount(0);
  await expect(page.getByText("Homes and area around this school")).toHaveCount(0);
  await postcode.click();
  await page.waitForURL("**/postcode/SW1A-1AB/homes");
  // r3 #34: the count on the school is the count on the list it opens.
  await expect(page.getByTestId("postcode-home")).toHaveCount(3);
});

test("an unknown school is a 404", async ({ page }) => {
  const response = await page.goto("/school/999999");
  expect(response?.status()).toBe(404);
});

test("the sitemap lists the school cards", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/school/100001");
  expect(sitemap).toContain("/school/100002");
});

test("no horizontal scroll at 375px, in both themes", async ({ browser }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme });
    const page = await context.newPage();
    for (const urn of ["100001", "100002"]) {
      await page.goto(`/school/${urn}`);
      await expect(page.getByTestId("school-card")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${urn} ${colorScheme}`).toBeLessThanOrEqual(0);
    }
    await context.close();
  }
});

test("the area's school list links each school to its card, with the Top chip", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");
  await expect(page.getByTestId("selected-area")).toBeVisible();
  const schools = await openEvidenceSection(page, "Schools");
  // Primary | Secondary, then each school as a row with its Top 10% chip, Ofsted badge and distance.
  const list = schools.getByTestId("school-phases");
  await expect(list.getByTestId("area-school-row").filter({ hasText: "Westminster Primary Preview" }).getByTestId("area-school-top")).toHaveCount(0);
  await list.getByTestId("school-phase-secondary").click();
  const secondary = list.getByTestId("area-school-row").filter({ hasText: "North London Secondary Preview" });
  await expect(secondary.getByTestId("area-school-top")).toHaveText("Top 10%");
  await openLink(page, secondary.getByTestId("area-school-link"), /\/school\/100002\?from=uk%3Alsoa%3AE01000001$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("North London Secondary Preview");
  await expect(page.getByTestId("school-back")).toHaveAttribute("href", "/area/lsoa/E01000001");
  // Opened from an area: "You", the straight line from that area's centre (the preview polygon's centroid), on the
  // last-distance scale, with inside or outside the latest distance, labelled approximate.
  await expect(page.getByTestId("school-distance")).toHaveText(/^\d+\.\d km$/);
  await expect(page.getByTestId("school-distance-verdict")).toContainText(/(Inside|Outside) last year's distance · approx\.: from the centre of Westminster preview, not your door/);
});

test("a school on the match map opens its card from the popup", async ({ page }) => {
  await seedClassicSearch(page);
  await page.goto("/?layer=personal-match");
  await page.getByTestId("match-ranking").getByRole("button", { name: /preview/ }).first().click();
  await expect(page.locator('[data-testid="match-map-school"]').first()).toBeAttached({ timeout: 20_000 });
  // The map redraws its markers (and their popups) while it settles: open the popup and follow its link, again if redrawn.
  await expect(async () => {
    await page.locator('[data-testid="match-map-school"]').first().dispatchEvent("click", undefined, { timeout: 2_000 });
    const link = page.getByTestId("map-school-card-link").first();
    await expect(link).toHaveAttribute("href", /^\/school\/10000[12]$/, { timeout: 2_000 });
    await link.dispatchEvent("click", undefined, { timeout: 2_000 });
    await expect(page).toHaveURL(/\/school\/10000[12]$/, { timeout: 5_000 });
  }).toPass({ timeout: 40_000 });
  await expect(page.getByTestId("school-card")).toBeVisible();
});
