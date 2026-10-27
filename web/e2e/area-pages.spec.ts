import { expect, test, type Page } from "./fixtures";

import { RANKING_TILES, rankingsByGroup } from "../src/lib/area-pages";
import { openLink } from "./evidence";

// Area guide pages (London → borough → MSOA) and London rankings: crawlable
// numbers, "all areas in" navigation, a generated FAQ with FAQPage JSON-LD,
// and method notes behind (?). Demo fixtures: three boroughs, one MSOA each.

// Demo has no school counts and too few report-card inspections, so these pages hide.
const DEMO_HIDDEN = ["secondary-report-card-exceptional", "most-primary-schools", "most-secondary-schools"];

async function faqJsonLd(page: Page) {
  const text = await page.locator('script[type="application/ld+json"]').first().textContent();
  return JSON.parse(text ?? "{}") as { "@type": string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
}

async function noHorizontalScroll(page: Page) {
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]);
}

async function unstyledButtons(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll("button")]
    .filter((button) => button.getClientRects().length > 0 && ["outset", "inset"].includes(getComputedStyle(button).borderTopStyle))
    .map((button) => button.getAttribute("aria-label") ?? button.textContent));
}

test("/area/england lists only the regions the data serves, each local authority a link", async ({ page }) => {
  await page.goto("/area/england");
  await expect(page.getByRole("heading", { level: 1, name: "England" })).toBeVisible();
  // Demo is a tiny London: one region, its boroughs, and the London page beside them.
  const regions = page.getByTestId("england-region");
  await expect(regions).toHaveCount(1);
  await expect(regions.getByRole("heading", { level: 2 })).toHaveText("London");
  await expect(regions.getByRole("link", { name: "Boroughs side by side" })).toHaveAttribute("href", "/area/london");
  await expect(regions.locator('a[href^="/area/lad/"]')).toHaveCount(3);
  await noHorizontalScroll(page);
});

test("the London page lists every borough, compares nothing with itself and answers the FAQ", async ({ page }) => {
  await page.goto("/area/london");
  await expect(page).toHaveTitle(/London boroughs side by side: prices, crime, schools/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("London");
  await expect(page.getByText("Demo data · not for decisions")).toBeVisible();
  const profile = page.getByTestId("area-profile");
  await expect(profile).toContainText("per m²");
  await expect(profile.getByRole("columnheader")).toHaveText(["Topic", "London"]);
  const boroughs = page.getByTestId("area-children").getByRole("link");
  await expect(boroughs).toHaveCount(3);
  await expect(boroughs.first()).toHaveAttribute("href", /^\/area\/lad\/E0900000\d$/);
  const ld = await faqJsonLd(page);
  expect(ld["@type"]).toBe("FAQPage");
  expect(ld.mainEntity.map((question) => question.name)).toEqual([
    "Is London safe?", "How much do homes cost in London?", "How many schools are there in London?", "Is London a deprived area?",
  ]);
  await expect(page.getByTestId("area-faq").locator("details")).toHaveCount(4);
  await noHorizontalScroll(page);
  expect(await unstyledButtons(page)).toEqual([]);
});

// v3 Fix 17: the boroughs side by side, one sortable table (the old "Boroughs by …" rankings land here).
test("the London boroughs table sorts by any figure, and old borough rankings open it sorted", async ({ page }) => {
  await page.goto("/area/london");
  const table = page.getByTestId("borough-table");
  await expect(table.getByRole("columnheader")).toHaveText([/Borough/, /£\/m²/, /Crime/, /Income/, /Schools/, /Families/, /Going out/]);
  // Most expensive first; every borough links to its page.
  await expect(table.getByRole("columnheader", { name: /£\/m²/ })).toHaveAttribute("aria-sort", "descending");
  const names = () => table.locator("tbody th").allInnerTexts();
  const byPrice = await names();
  expect(byPrice).toHaveLength(3);
  // Income sorts like any figure (owner decision 2026-10-18).
  await expect(table.getByRole("columnheader", { name: /Income/ }).getByRole("button")).toHaveCount(1);
  await table.getByTestId("borough-sort-crime").click();
  await expect(table.getByRole("columnheader", { name: /Crime/ })).toHaveAttribute("aria-sort", "descending");
  await table.getByTestId("borough-sort-crime").click();
  await expect(table.getByRole("columnheader", { name: /Crime/ })).toHaveAttribute("aria-sort", "ascending");
  await table.getByTestId("borough-sort-name").click();
  expect(await names()).toEqual([...byPrice].sort((a, b) => a.localeCompare(b, "en-GB")));
  await noHorizontalScroll(page);

  for (const [slug, column] of [["borough-crime", "Crime"], ["borough-price", "£/m²"], ["borough-nightlife", "Going out"], ["borough-places-for-families", "Families"], ["borough-income", "Income"]] as const) {
    await page.goto(`/rankings/${slug}`);
    await expect(page).toHaveURL(/\/area\/london\?sort=/);
    await expect(page.getByTestId("borough-table").getByRole("columnheader", { name: new RegExp(column) })).toHaveAttribute("aria-sort", "descending");
  }
  // Income ranks again (owner decision 2026-10-18): its rankings are pages, not redirects.
  for (const slug of ["highest-income", "lowest-income"]) {
    await page.goto(`/rankings/${slug}`);
    await expect(page).toHaveURL(new RegExp(`/rankings/${slug}$`));
  }
});

// v4 Task 17: the borough page in the area page's frame.
test("a borough page has the area page's header, tiles, chips, its neighbourhoods and an FAQ that opens", async ({ page }) => {
  await page.goto("/area/lad/E09000001");
  // The friendly name heads the page; the official name is in Sources only.
  await expect(page.getByRole("heading", { level: 1 }).getByTestId("area-title-code")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Westminster/);
  await expect(page.getByTestId("area-official-name")).toContainText("Westminster preview borough (E09000001)");
  await expect(page.getByRole("navigation", { name: "Where this area sits" }).getByRole("link", { name: "London" }))
    .toHaveAttribute("href", "/area/london");
  // No old "at a glance" table and no old tabs: the verdict, the 12 tiles and one chip bar.
  await expect(page.getByTestId("area-profile")).toHaveCount(0);
  await expect(page.getByTestId("area-verdict-line")).toBeVisible();
  await expect(page.getByTestId("area-tiles").locator("[data-testid^=area-tile-]")).toHaveCount(12);
  await expect(page.getByTestId("area-tabs").getByRole("link")).toHaveText(
    ["At a glance", "Areas", "Price", "Safety", "Schools", "Getting around", "Green & quiet", "People", "Living costs", "Questions"]);

  // Its neighbourhoods, each linking to its area page.
  const area = page.getByTestId("area-children").getByRole("link", { name: /Westminster preview/ });
  await expect(area).toHaveAttribute("href", "/area/lsoa/E01000001");
  const safety = page.locator('[data-faq="safety"]');
  await safety.locator("summary").click();
  await expect(safety).toHaveAttribute("open", "");
  await expect(safety.locator("p")).toContainText("crimes for every 1,000 residents");
  expect((await faqJsonLd(page)).mainEntity[0].acceptedAnswer.text).toContain("crimes for every 1,000 residents");
  // The area page's actions: ♡ · On map · ⋯ (Watch inside), and What's next.
  await expect(page.getByTestId("open-on-map")).toHaveCount(1);
  await expect(page.getByTestId("open-on-map")).toHaveAttribute("href", "/?selected=uk%3Alad%3AE09000001");
  await expect(page.getByTestId("save-area")).toBeVisible();
  await expect(page.getByTestId("area-more-menu")).toBeVisible();
  // r3 #38 (V4-17 board): ♡ · Compare · On map · ⋯ with Watch new listings, Find similar and the evidence pack.
  await expect(page.getByTestId("area-compare-link")).toHaveAttribute("href", "/compare?kind=places&ids=uk%3Alad%3AE09000001");
  await page.getByTestId("area-more-menu").locator("summary").click();
  const menu = page.getByTestId("area-more-menu");
  await expect(menu.getByRole("button", { name: "Watch new listings" })).toBeVisible();
  await expect(menu.getByTestId("area-find-similar")).toHaveAttribute("href", /^\/\?find=like&area=lsoa:E\d{8}$/);
  await expect(menu.getByTestId("area-pack-link")).toBeVisible();
  await page.getByTestId("area-more-menu").locator("summary").click();
  // r3 #39: the Areas key says Price runs pricier to the right, not "better".
  await expect(page.getByTestId("borough-areas-key")).toContainText("pricier");
  await expect(page.getByTestId("borough-areas-key")).not.toContainText("better to the right");
  await expect(page.getByTestId("whats-next")).toBeVisible();
  await expect(page.getByTestId("whats-next-up").getByRole("link", { name: "London" })).toHaveAttribute("href", "/area/london");
  await noHorizontalScroll(page);
  expect(await unstyledButtons(page)).toEqual([]);
});

// v4.5 (round-2 finding 31): an MSOA's page is the one area page, as its map sheet shows it.
test("an MSOA page is the area page's frame: verdict, tags, 12 tiles and sections", async ({ page }) => {
  await page.goto("/area/msoa/E02000001");
  const full = page.getByTestId("area-full-page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^St James's · SW1A/);
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Westminster preview MSOA");
  await expect(full.getByTestId("area-official-name")).toContainText("(E02000001)");
  const crumbs = page.getByRole("navigation", { name: "Where this area sits" });
  await expect(crumbs.getByRole("link", { name: "Westminster", exact: true })).toHaveAttribute("href", "/area/lad/E09000001");
  await expect(full.getByTestId("area-verdict-line")).not.toBeEmpty();
  await expect(full.getByTestId("area-tags")).toBeVisible();
  await expect(full.getByTestId("area-tiles").locator("li")).toHaveCount(12);
  await expect(full.getByTestId("area-tile-schools")).not.toContainText("No data here");
  await expect(page.getByTestId("open-on-map")).toHaveCount(1);
  await expect(page.getByTestId("area-tabs")).toBeVisible();
  await expect(page.getByTestId("area-guide-page")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/Neighbourhood group|At a glance · Neighbourhoods/i);
});

test("a neighbourhood's full page: friendly name only, one row of actions with a menu, one Like this, no extra text blocks", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  const full = page.getByTestId("area-full-page");
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText("St James's · SW1A");
  await expect(page).toHaveTitle(/^St James's · SW1A/);
  await expect(full.getByTestId("area-tile-price")).toContainText("£");
  // No code, no official name and no jargon above Sources.
  const glance = full.getByTestId("evidence-summary");
  await expect(glance).not.toContainText(/Westminster preview|LSOA|E0\d{7}/);
  await expect(page.getByTestId("area-official-name")).toContainText("Westminster preview (E01000001)");
  // One row: ♡ · Compare · On map (the one primary) · ⋯ with Watch and the evidence pack (Fix 28).
  await expect(full.getByTestId("open-on-map")).toHaveText("On map");
  const menu = full.getByTestId("area-more-menu");
  await menu.locator("summary").click();
  await expect(menu.getByTestId("area-pack-link")).toHaveAttribute("href", "/area/lsoa/E01000001/pack");
  await expect(menu.getByTestId("watch-listings-open")).toBeVisible();
  await expect(menu.getByTestId("find-like")).toHaveCount(0);
  await expect(full.getByTestId("area-home-page")).toHaveCount(0);
  await menu.locator("summary").click();
  // No "Read as text", no quick answers; one "Like this", in What's next › Nearby (v3 Fix 22).
  await expect(full.getByText("Read as text")).toHaveCount(0);
  await expect(full.getByTestId("area-faq")).toHaveCount(0);
  await expect(full.getByTestId("similar-areas")).toHaveCount(0);
  await expect(full.getByRole("link", { name: "Similar areas" })).toHaveCount(0);
  await expect(page.locator("a, button").filter({ hasText: /Find areas like|Find similar/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Like this" })).toHaveCount(1);
  await expect(page.getByTestId("whats-next-nearby").getByTestId("next-like-this")).toHaveAttribute("href", "/?find=like&area=lsoa:E01000001");
  // Section headings are the section's name, always open (no toggle button).
  await expect(full.getByRole("heading", { name: "Safety", exact: true, level: 2 })).toBeVisible();
  await expect(full.getByRole("button", { name: "Safety", exact: true })).toHaveCount(0);
  await noHorizontalScroll(page);
  expect(await unstyledButtons(page)).toEqual([]);
});

test("on a 320px phone the full page shows figures near the top", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/area/lsoa/E01000001");
  const tile = page.getByTestId("area-tile-price");
  await expect(tile).toContainText("£");
  // The verdict and tags come first, then one row of actions, the Tailor chip and the tiles.
  await expect(page.getByTestId("area-verdict-line")).toBeInViewport();
  const top = await tile.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
  expect(top).toBeLessThan(900);
  await noHorizontalScroll(page);
});

// v3 Fix 15: one compact index; mirror pairs and home types are one tile with a switch.
test("the rankings index groups tiles, switches pairs and types, and links every ranking", async ({ page }, testInfo) => {
  await page.goto("/rankings");
  const index = page.getByTestId("rankings-page");
  await expect(index.getByRole("heading", { level: 1 })).toHaveText("Rankings");
  await expect(index.locator(".rankings-group:not(.rankings-group--boroughs) h2")).toHaveText(rankingsByGroup().map((entry) => entry.group));
  const hiddenTiles = RANKING_TILES.filter((tile) => tile.slugs.flat().every((slug) => DEMO_HIDDEN.includes(slug)));
  await expect(index.locator(".rankings-group:not(.rankings-group--boroughs) .rankings-tile")).toHaveCount(RANKING_TILES.length - hiddenTiles.length);
  // Household income and social renting [Highest | Lowest], [Most | Least] under Homes & area (owner decision 2026-10-18).
  await expect(index.locator("#rankings-homes-area")).toContainText("Household income");
  await expect(index.locator("#rankings-homes-area")).toContainText("Social renting");
  // Deprivation [Least | Most] under Homes & area (owner decision 2026-10-17): least deprived first.
  const deprivation = index.getByTestId("ranking-tile-deprivation");
  await expect(index.locator("#rankings-homes-area")).toContainText("Deprivation");
  await expect(deprivation.getByTestId("ranking-tile-link")).toHaveAttribute("href", "/rankings/least-deprived");
  await deprivation.getByRole("button", { name: "Most" }).click();
  await expect(deprivation.getByTestId("ranking-tile-link")).toHaveAttribute("href", "/rankings/most-deprived");
  await expect(deprivation.getByTestId("ranking-tile-link")).toHaveAttribute("title", "Most deprived areas");

  // Recorded crime [Most | Least]: one tile that opens on its good end (v4 Task 42), its link follows the switch.
  const crime = index.getByTestId("ranking-tile-crime");
  await expect(crime.getByTestId("ranking-tile-link")).toHaveAttribute("href", "/rankings/lowest-crime");
  await expect(crime.getByTestId("ranking-tile-link")).toHaveAttribute("title", "Areas with the least recorded crime");
  await crime.getByRole("button", { name: "Most" }).click();
  await expect(crime.getByTestId("ranking-tile-link")).toHaveAttribute("href", "/rankings/highest-crime");
  // Price per m² opens on Lowest (cheapest first).
  await expect(index.getByTestId("ranking-tile-price").getByTestId("ranking-tile-link")).toHaveAttribute("href", "/rankings/least-expensive");
  // Typical price [Highest | Lowest] × [Flat | Terraced | Semi | Detached]: eight rankings, one tile.
  const typical = index.getByTestId("ranking-tile-typical");
  await typical.getByRole("button", { name: "Semi" }).click();
  await typical.getByRole("button", { name: "Lowest" }).click();
  await expect(typical.getByTestId("ranking-tile-link")).toHaveAttribute("href", "/rankings/lowest-semi-detached-prices");
  // r3 #36: desktop and phone are the same page (board CUJ04 step 1): London › Rankings, tiles with the top three
  // (real figures, the ranking's own) and Boroughs as a tile; a desktop only lays the tiles in columns.
  await expect(index.getByTestId("breadcrumbs")).toContainText("Rankings");
  await expect(typical.locator(".rankings-tile__top li").first()).toBeVisible();
  await expect(index.getByTestId("ranking-tile-boroughs").getByTestId("ranking-tile-link")).toHaveAttribute("href", "/area/london");
  if (testInfo.project.name !== "mobile") {
    const [first, second] = await index.locator("#rankings-cost .rankings-tile").evaluateAll((tiles) => tiles.slice(0, 2).map((tile) => tile.getBoundingClientRect().top));
    expect(Math.abs(first - second)).toBeLessThan(2);
  }
  await noHorizontalScroll(page);
  expect(await unstyledButtons(page)).toEqual([]);
});

test("ranking pages rank areas, link to them and explain the method behind (?)", async ({ page }) => {
  await page.goto("/rankings/most-expensive");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Most expensive areas");
  const rows = page.getByTestId("ranking-table").locator("tbody tr");
  await expect(rows).toHaveCount(3);
  // v4 Task 24: rows are named as people say them, never by the official code ("Westminster 013").
  await expect(rows.first()).toContainText("St James's · SW1A");
  await expect(rows.first()).not.toContainText("Westminster preview MSOA");
  await expect(rows.first().getByRole("link", { name: "St James's · SW1A", exact: true })).toHaveAttribute("href", "/area/msoa/E02000001");
  // v4 Task 42: On map ↗ chooses the area and keeps the ranking's layer (v4.4: and its month); Most | Least swaps the end.
  await expect(rows.first().getByTestId("ranking-on-map"))
    .toHaveAttribute("href", /^\/\?selected=uk%3Amsoa%3AE02000001&layer=price-per-square-metre&period=\d{4}-\d{2}$/);
  const order = page.getByTestId("ranking-switch");
  await expect(order.getByRole("link", { name: "Highest" })).toHaveAttribute("aria-current", "page");
  await expect(order.getByRole("link", { name: "Lowest" })).toHaveAttribute("href", "/rankings/least-expensive");
  await page.getByTestId("ranking-method").getByRole("button").click();
  await expect(page.getByTestId("help-ranking-price")).toContainText("middle of its neighbourhoods");
  await noHorizontalScroll(page);
  expect(await unstyledButtons(page)).toEqual([]);

  // Station walk, food hygiene and typical prices by type are the middle of each area's neighbourhoods (demo detached: one area).
  for (const [slug, help, rowCount] of [
    ["closest-to-a-station", "ranking-station", 3], ["highest-food-hygiene", "ranking-food-hygiene", 3], ["lowest-flat-prices", "ranking-typical-price", 3],
    ["highest-detached-prices", "ranking-typical-price", 1]] as const) {
    await page.goto(`/rankings/${slug}`);
    await expect(page.getByTestId("ranking-table").locator("tbody tr")).toHaveCount(rowCount);
    await page.getByTestId("ranking-method").getByRole("button").click();
    await expect(page.getByTestId(`help-${help}`)).toBeVisible();
  }
});

test("a ranking's On map ↗ numbers its top 10 on the map; Areas | Boroughs opens the boroughs table (CUJ-05/10 v4)", async ({ page }) => {
  await page.goto("/rankings/most-expensive");
  await expect(page.getByTestId("breadcrumbs").getByRole("listitem")).toHaveText(["London", "Rankings", "Cost"]);
  const levels = page.getByTestId("ranking-level-switch");
  await expect(levels.getByRole("link", { name: "Areas" })).toHaveAttribute("aria-current", "page");
  await expect(levels.getByTestId("ranking-boroughs")).toHaveAttribute("href", "/area/london?sort=price");
  const onMap = page.getByTestId("ranking-top-on-map");
  await expect(onMap).toHaveAttribute("href", /^\/\?layer=price-per-square-metre&period=\d{4}-\d{2}&rank=most-expensive$/);
  await onMap.click();
  const card = page.getByTestId("ranking-top");
  await expect(card).toContainText("Most expensive · Top 10", { timeout: 20_000 });
  await expect(card.getByRole("listitem").first()).toContainText("St James's");
  await expect(page.getByTestId("ranking-pin").first()).toBeVisible();
  // A ranking opened from its page keeps the first-visit card away (it would sit under the top 10 card).
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
  await expect(card.getByRole("link", { name: /Full ranking/ })).toHaveAttribute("href", "/rankings/most-expensive");
  // A row opens the area; ✕ puts the card and pins away.
  await card.getByRole("listitem").first().getByRole("button").click();
  await expect(page).toHaveURL(/selected=uk%3Amsoa%3AE02000001/);
  await card.getByRole("button", { name: "Close the top 10" }).click();
  await expect(page.getByTestId("ranking-top")).toHaveCount(0);
  await expect(page.getByTestId("ranking-pin")).toHaveCount(0);
});

test("deprivation rankings list areas by their neighbourhoods' average decile, least deprived first", async ({ page }) => {
  await page.goto("/rankings/least-deprived");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Least deprived areas");
  const rows = page.getByTestId("ranking-table").locator("tbody tr");
  await expect(rows).not.toHaveCount(0);
  await expect(rows.first()).toContainText(/average of \d+ neighbourhoods?/);
  await page.getByTestId("ranking-method").getByRole("button").click();
  await expect(page.getByTestId("help-ranking-deprivation")).toContainText("average the tenths");
  await page.goto("/rankings/most-deprived");
  await expect(page).toHaveURL(/\/rankings\/most-deprived$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Most deprived areas");
  await noHorizontalScroll(page);
});

test("lens rankings rank places per km² and explain how the figure is made", async ({ page }) => {
  await page.goto("/rankings/most-places-for-families");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Areas with the most places for families");
  await expect(page.getByTestId("ranking-table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("ranking-table")).toContainText("Places per km²");
  const explainer = page.getByTestId("ranking-explainer");
  await expect(explainer.getByRole("heading", { level: 2 })).toHaveText("How the figure is made");
  for (const words of ["playgrounds and nurseries (childcare and kindergartens)", "12 per km²", "not a score", "places, not people", "fewer than 5"]) {
    await expect(explainer).toContainText(words);
  }
  await expect(page.getByTestId("ranking-sources").getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  await page.getByTestId("ranking-method").getByRole("button").click();
  await expect(page.getByTestId("help-ranking-lens-family")).toContainText("not a score");
  await noHorizontalScroll(page);

  for (const [slug, help] of [["widest-food-variety", "ranking-lens-variety"], ["closest-to-a-market", "ranking-lens-nearest"], ["most-gyms", "ranking-lens"]] as const) {
    await page.goto(`/rankings/${slug}`);
    await expect(page.getByTestId("ranking-table").locator("tbody tr")).toHaveCount(3);
    await expect(page.getByTestId("ranking-explainer")).toContainText("OpenStreetMap");
    await page.getByTestId("ranking-method").getByRole("button").click();
    await expect(page.getByTestId(`help-${help}`)).toBeVisible();
  }
});

test("school rankings link to each school's page, show the year and caveats, and drop rank numbers on Outstanding lists", async ({ page }) => {
  await page.goto("/rankings/top-secondary-progress-8");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Secondary schools with the highest Progress 8");
  const table = page.getByTestId("ranking-table");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  // Phones fold the borough under the name, so only the ends are checked.
  await expect(table.getByRole("columnheader").first()).toHaveText("#");
  await expect(table.getByRole("columnheader").last()).toHaveText("Progress 8 (2023/24)");
  await expect(table.locator("tbody tr").first()).toContainText("+0.62");
  await expect(table.getByRole("link").first()).toHaveAttribute("href", "/school/100001");
  await expect(table.getByTestId("ranking-source-link").first()).toHaveAttribute("href", "https://www.compare-school-performance.service.gov.uk/school/100001");
  await expect(page.getByTestId("ranking-method")).toContainText("30 or more pupils in the year group, 2023/24");
  await expect(page.getByTestId("ranking-sources")).toContainText("Open Government Licence v3.0");
  await page.getByTestId("ranking-method").getByRole("button").click();
  await expect(page.getByTestId("help-ranking-school-progress-8")).toContainText("latest year published");
  await noHorizontalScroll(page);

  await page.goto("/rankings/outstanding-primary-schools");
  await expect(table.getByRole("columnheader").first()).toHaveText("School");
  await expect(table.getByRole("columnheader").last()).toHaveText("Inspected");
  await expect(table.locator("tbody tr").first()).toContainText("2023/24");
  await expect(table.getByRole("link").first()).toHaveAttribute("href", "/school/100001");
  await expect(table.getByTestId("ranking-source-link").first()).toHaveAttribute("href", "https://reports.ofsted.gov.uk/search?q=100001");
  await expect(page.getByTestId("ranking-method")).toContainText("most recently inspected");
});

test("unknown areas and rankings are 404s, and the sitemap lists the new pages", async ({ request }) => {
  expect((await request.get("/area/lad/E09999999")).status()).toBe(404);
  expect((await request.get("/area/msoa/E02999999")).status()).toBe(404);
  expect((await request.get("/rankings/nope")).status()).toBe(404);
  for (const slug of DEMO_HIDDEN) expect((await request.get(`/rankings/${slug}`)).status()).toBe(404);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/area/london", "/rankings/highest-crime", "/rankings/most-places-for-families", "/rankings/top-secondary-attainment-8", "/area/lad/E09000001", "/area/msoa/E02000003"]) {
    expect(sitemap).toContain(`${path}</loc>`);
  }
});

// v3 Fix 28: one sticky chip bar on the area page; /places and /pack keep the breadcrumbs and a way back.
test("the area page's breadcrumbs, What's next, and the way back from Places and the evidence pack", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  const crumbs = page.getByRole("navigation", { name: "Where this area sits" });
  await expect(crumbs.getByRole("link")).toHaveText(["London", "Westminster"]);
  await expect(crumbs.locator("[aria-current=page]")).toHaveText("St James's");
  await expect(page.getByTestId("area-page-tabs")).toHaveCount(0);
  const next = page.getByTestId("whats-next");
  await expect(next.getByTestId("whats-next-up").getByRole("link")).toHaveText(["Westminster", "London"]);
  await expect(next.getByTestId("whats-next-inside")).toContainText("Places");
  await expect(next.getByTestId("footer-check-home")).toHaveAttribute("href", /^\/tools\/check-a-home\?area=uk%3Alsoa%3AE01000001/);
  // Homes goes to the homes list of a postcode in the area once its sales are in.
  await expect(next.getByTestId("next-homes")).toHaveAttribute("href", /^\/postcode\/[A-Z0-9-]+\/homes$/);

  // Followed by address, not a click: under load a client navigation can stall (e2e/evidence.ts › openLink).
  await openLink(page, page.getByTestId("all-places"), /\/area\/lsoa\/E01000001\/places$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("St James's · SW1A");
  await expect(page.getByTestId("places-section")).toBeVisible();
  await expect(page.getByTestId("area-page-tabs")).toHaveCount(0);
  await expect(page.getByTestId("back-to-area")).toHaveText("← St James's");

  await page.goto("/area/lsoa/E01000001/pack");
  await expect(page.getByRole("navigation", { name: "Where this area sits" }).locator("[aria-current=page]")).toHaveText("St James's");
  await expect(page.getByTestId("area-page-tabs")).toHaveCount(0);
  const back = page.getByTestId("back-to-area");
  await expect(back).toHaveAttribute("href", "/area/lsoa/E01000001");
  await openLink(page, back, /\/area\/lsoa\/E01000001$/);
  await page.getByTestId("area-tab-schools").click();
  await expect(page).toHaveURL(/\/area\/lsoa\/E01000001#schools$/);
  await expect(page.getByTestId("evidence-section-schools").locator(".area-section__title")).toBeInViewport();
  await noHorizontalScroll(page);
});

test("postcode, home and school pages share breadcrumbs and What's next", async ({ page }) => {
  await page.goto("/postcode/SW1A-1AB");
  await expect(page.getByTestId("breadcrumbs").getByRole("link")).toHaveText(["London", "Westminster", "St James's"]);
  await expect(page.getByTestId("breadcrumbs").locator("[aria-current=page]")).toHaveText("SW1A 1AB");
  const postcode = page.getByTestId("postcode-area");
  await expect(postcode.getByTestId("next-homes")).toHaveAttribute("href", "/postcode/SW1A-1AB/homes");
  await expect(page.getByTestId("watch-listings-open")).toHaveCount(1);
  await postcode.getByTestId("next-homes").click();
  await expect(page.getByTestId("postcode-homes-page")).toBeVisible();
  await expect(page.getByTestId("breadcrumbs").getByRole("link", { name: "SW1A 1AB" })).toHaveAttribute("href", "/postcode/SW1A-1AB");

  await page.goto("/property/100000000001");
  const crumbs = page.getByTestId("breadcrumbs");
  await expect(crumbs.getByRole("link", { name: "St James's" })).toHaveAttribute("href", "/area/lsoa/E01000001");
  await expect(crumbs.getByRole("link", { name: /^SW1A/ })).toHaveAttribute("href", /^\/postcode\/SW1A-/);
  await expect(page.getByTestId("whats-next-up").getByRole("link").first()).toHaveText(/^SW1A/);

  await page.goto("/school/100001");
  await expect(page.getByTestId("breadcrumbs").getByRole("link", { name: "London" })).toHaveAttribute("href", "/area/london");
  await expect(page.getByTestId("whats-next")).toBeVisible();
  await noHorizontalScroll(page);
});
