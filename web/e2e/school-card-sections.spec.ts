import { expect, test, type Locator, type Page } from "./fixtures";

import { THREAD_ICONS } from "../src/lib/thread-icons";

// The full school card (docs/area-card-2026-10/school-card-open-spec.md), in demo mode: the preview cards in
// lib/school-card-fixture.ts stand in for the API. Every section is open; the fine print is in one ☰ menu.

const ORDER = ["Results", "Getting in", "Visit & links", "Inspections", "Pupils", "Parent View", "Workforce", "Financials", "Destinations"];

const section = (card: Locator, id: string) => card.locator(`[data-testid="school-section"][data-section="${id}"]`);

async function openMenu(page: Page): Promise<Locator> {
  await page.getByTestId("school-sources-button").click();
  const menu = page.getByTestId("school-sources");
  await expect(menu).toBeVisible();
  return menu;
}

test("a secondary: every section open in a parent's order, each figure against London, no per-section fine print", async ({ page }) => {
  await page.goto("/school/100002");
  const card = page.getByTestId("school-card");
  await expect(card.getByTestId("school-section").locator("h2")).toHaveText([/^Results · 2024\/25$/, /^Getting in · 2026$/, "Visit & links", /^Inspections · 2019–2023$/,
    /^Pupils · 2024\/25$/, "Parent View", /^Workforce · 2025\/26$/, /^Financials · 2024\/25$/, /^Destinations · 2023\/24 leavers$/]);
  // No rows to tap, no chips, no "How this is measured": disclosures only for long detail.
  await expect(card.locator("details")).toHaveCount(3);
  await expect(card.locator("details > summary")).toHaveText([/Show exam results by year/, /By preference/, /Read what Ofsted said/]);
  await expect(card).not.toContainText(/How this is measured|premium|sign in to see|unlock/i);
  // The header: type tags (sixth form for a secondary), one Ofsted badge; no Details row.
  await expect(card.getByTestId("school-tags").locator("li")).toHaveText(["Academy", "ages 11–18", "Mixed", "Islington", "N1 1AA", "Sixth form"]);

  const results = section(card, "results");
  await expect(results.getByTestId("school-national-rank")).toHaveText("Ranked 162 of 3,280 secondaries in England · top 5%");
  await expect(results.getByTestId("school-rank-chart").getByTestId("school-rank-value")).toHaveText(["14%"]); // the latest (top 5%) is in the line above

  // One comparison graphic everywhere: value, a dot on London's track, "London x" in grey (no borough: under 10 schools).
  const pupils = section(card, "pupils");
  const fsm = pupils.locator('[data-testid="school-compare"][data-measure="fsm6Percent"]');
  await expect(fsm.getByTestId("school-compare-value")).toHaveText("38.4%");
  await expect(fsm.getByTestId("school-compare-ref")).toHaveText("Typical school: London 35.4%");
  await expect(fsm).toHaveAttribute("aria-label", /typical London school 35\.4%; London schools' middle 80% 13\.8% to 56\.7%/);
  await expect(fsm).not.toHaveAttribute("data-tone");
  // Colour only where lower is clearly better: absence better than London's median.
  await expect(pupils.locator('[data-measure="overallAbsencePercent"]')).toHaveAttribute("data-tone", "good");
  // A withheld figure keeps its row with no graphic.
  const withheld = pupils.locator('[data-measure="persistentAbsencePercent"]');
  await expect(withheld.getByTestId("school-compare-value")).toHaveText("Withheld");
  await expect(withheld.locator("svg")).toHaveCount(0);
  await expect(pupils.locator('[data-measure="pupils"]')).toContainText("On roll · Jan 2026");
  await expect(pupils.getByTestId("school-gender-split")).toContainText("Girls 51.2%");

  const gettingIn = section(card, "getting-in");
  await expect(gettingIn.locator('[data-measure="firstChoiceOfferedPercent"] [data-testid="school-compare-value"]')).toHaveText("46.1%");
  await expect(gettingIn.getByTestId("school-got-in-count")).toHaveText("190 of 412 who put it first");
  await expect(gettingIn.getByTestId("school-got-in-trend")).toContainText(/^\d{4} · \d+\.\d%.*2026 · \d+\.\d%$/);
  await gettingIn.getByTestId("school-preferences-more").locator("summary").click();
  await expect(gettingIn.getByTestId("school-preferences")).toContainText("2nd26014");
  // Without ?from= the distances stand alone: no "You".
  await expect(gettingIn.getByTestId("school-last-offered")).toContainText("1.4 km");
  await expect(gettingIn.getByTestId("school-distance")).toHaveCount(0);

  const parentView = section(card, "parent-view");
  await expect(parentView.getByTestId("school-parent-view-survey")).toHaveText("Earlier survey (before Nov 2025) · as at 2 Sep 2024 · 146 responses (13.6% of pupils)");
  await expect(parentView.getByTestId("school-parent-view-questions").locator("li").nth(2)).toContainText("12.3% yes");
  // Agree is of the parents a question applies to; the not-applicable share is said beside it, not in the bar.
  await expect(parentView.getByTestId("school-parent-view-questions").locator("li").nth(4)).toContainText("· 32.3% not applicable");
  await expect(parentView.getByTestId("school-parent-view-questions").locator("li").nth(4)).toContainText("88.2% agree");

  const workforce = section(card, "workforce");
  await expect(workforce.locator('[data-measure="pupilsPerTeacher"] [data-testid="school-compare-value"]')).toHaveText("15.2");
  await expect(workforce.locator('[data-measure="pupilsPerAdult"] [data-testid="school-compare-value"]')).toHaveText("10.5");

  const finance = section(card, "finance");
  await expect(finance.locator('[data-measure="reservePerPupil"] [data-testid="school-compare-value"]')).toHaveText("−£112");
  await expect(finance.locator('[data-number="reserve"]')).toContainText("−£120,000");
  await expect(finance.getByTestId("school-finance-trust")).toContainText("trust reserve £2,400,000");

  const destinations = section(card, "destinations");
  // A plain heading with a graduation cap, not the ↗ that read as a link (v3 Fix 26).
  const heading = destinations.locator("h2");
  await expect(heading.getByRole("link")).toHaveCount(0);
  await expect(heading.locator("svg path").nth(1)).toHaveAttribute("d", THREAD_ICONS.school);
  await expect(destinations.getByTestId("school-destinations-ks4")).toContainText("196 students, followed through 2024/25");
  await expect(destinations.getByTestId("school-destinations-post16").locator('[data-bar="higher"]')).toContainText("72%");

  // The ☰ menu holds the fine print: definitions as separate sentences, the comparison method, the register link.
  const menu = await openMenu(page);
  await expect(menu.getByTestId("school-finance-how").locator("p")).toHaveCount(3);
  await expect(menu.getByTestId("school-finance-accounts")).toHaveText("Academy accounts (AAR) · September 2024 to August 2025.");
  await expect(menu.getByTestId("school-compare-method")).toContainText("Compared only with academies' accounts (AAR), same academic year");
  await expect(menu).toContainText("School workforce census, 2025/26");
  // The GIAS record left ☰ for Visit & links: the menu keeps attribution, never a destination.
  await expect(menu.getByRole("link", { name: "Get Information about Schools" })).toHaveCount(0);
  await expect(menu.getByTestId("school-record")).toContainText("Source: Get Information about Schools, DfE, OGL v3.0 (record under Visit & links).");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Selectable text: nothing on the card switches selection off.
  const unselectable = await card.evaluate((root) => [...root.querySelectorAll("*")].filter((el) => getComputedStyle(el).userSelect === "none").length);
  expect(unselectable).toBe(0);
});

test("a primary: no Destinations section; a section without data says why", async ({ page }) => {
  await page.goto("/school/100001");
  const card = page.getByTestId("school-card");
  await expect(card.getByTestId("school-section").locator("h2")).toHaveText(ORDER.filter((title) => title !== "Destinations").map((title) => new RegExp(`^${title}`)));
  await expect(card.locator('[data-section="destinations"]')).toHaveCount(0);
  await expect(card.getByTestId("school-tags").locator("li")).toHaveText(["Community school", "ages 3–11", "Mixed", "Westminster", "SW1A 2AA"]);
  // A borough with 10+ schools: its median and its tick.
  const fsm = section(card, "pupils").locator('[data-measure="fsm6Percent"]');
  await expect(fsm.getByTestId("school-compare-ref")).toHaveText("Typical school: London 28.3% · Westminster 40.1%");
  await expect(fsm.locator("text")).toHaveText(["W", "L"]);
  const parentView = section(card, "parent-view");
  await expect(parentView).toHaveAttribute("data-empty", "");
  await expect(parentView.getByTestId("school-section-missing")).toHaveText("Ofsted Parent View is not loaded");
  await expect(section(card, "results").getByTestId("school-national-rank")).toHaveText("Ranked 2,950 of 15,057 primaries in England · top 20%");
  // The record sits in the menu.
  const menu = await openMenu(page);
  await expect(menu.getByTestId("school-record")).toContainText("URN 100001 · before conversion URN 100003");
});

test("at phone width: no horizontal scroll in either theme, every control a 44px target, the menu too", async ({ browser }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme });
    const page = await context.newPage();
    for (const urn of ["100001", "100002"]) {
      await page.goto(`/school/${urn}`);
      const card = page.getByTestId("school-card");
      await card.evaluate((root) => root.querySelectorAll("details").forEach((details) => { (details as HTMLDetailsElement).open = true; }));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${urn} ${colorScheme}`).toBeLessThanOrEqual(0);
      await openMenu(page);
      const sheet = await page.getByTestId("school-sources").boundingBox();
      expect(sheet!.width, `${urn} menu width`).toBeLessThanOrEqual(375);
      await page.getByTestId("school-sources-close").click();
      await expect(page.getByTestId("school-sources")).toBeHidden();
    }
    await context.close();
  }
});

test("Visit & links: the website button, admissions and call, then official and guide click-outs through /go", async ({ page }) => {
  await page.goto("/school/100001");
  const links = section(page.getByTestId("school-card"), "links");
  await expect(links.getByTestId("school-website")).toHaveAttribute("href", "/go/school-website?urn=100001&from=web");
  await expect(links.getByTestId("school-website")).toHaveAttribute("target", "_blank");
  await expect(links.getByTestId("school-phone")).toHaveAttribute("href", "tel:+442000000000");
  await expect(links.getByTestId("school-links-official").getByTestId("school-link")).toHaveText([/^Ofsted report/, /^DfE performance tables/, /^Parent View/,
    /^Council admissions.*Westminster primary places/, /^School record/, /^Apply online/]);
  await expect(links.getByTestId("school-links-guides").getByTestId("school-link")).toHaveText([/^Good Schools Guide/, /^Locrating/]);
  for (const href of await links.locator("a[href^='/go/']").evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href")))) {
    expect(href).toMatch(/^\/go\/school-[a-z-]+\?urn=100001&from=web$/);
  }
  // No website on GIAS: a muted line, and Admissions points to the council.
  await page.goto("/school/100002");
  const secondary = section(page.getByTestId("school-card"), "links");
  await expect(secondary.getByTestId("school-website")).toHaveText("No website listed on GIAS");
  await expect(secondary.getByTestId("school-admissions-link")).toContainText("See the council's page");
  await expect(secondary.getByTestId("school-phone")).toHaveCount(0);
});
