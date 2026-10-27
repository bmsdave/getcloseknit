import { expect, test, type Page } from "./fixtures";
import { openAreaPage, openEvidenceSection } from "./evidence";

// UX-39: area selection alone never implies property-level evidence. The
// home's record appears only when search provides a property identity; its
// workflow tools live on the full area page under "Plan & check a home".
const viewports = [
  { name: "390", size: { width: 390, height: 844 } },
  { name: "1280", size: { width: 1280, height: 720 } },
] as const;

for (const { name, size } of viewports) {
  test(`area selection alone shows no home line, and the brief holds no tools at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/?selected=uk%3Alsoa%3AE01000002");
    const panel = page.getByTestId("evidence-panel");
    await expect(panel.getByTestId("open-area-page")).toBeVisible();
    await expect(panel.getByTestId("brief-home")).toHaveCount(0);
    await expect(panel.getByTestId("user-candidates")).toHaveCount(0);
    await expect(panel.getByTestId("viewing-checklist")).toHaveCount(0);
    await expect(panel.getByTestId("property-history")).toHaveCount(0);
    await expect(panel.getByText("Total housing costs")).toHaveCount(0);
    await expect(panel.getByText("Leasehold due diligence")).toHaveCount(0);
  });

  test(`a chosen home is one line in the brief and travels to the full page at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
    await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
    const home = page.getByTestId("brief-home");
    await expect(home.getByTestId("brief-home-sale")).toContainText("Last sold £570,000");
    await expect(home.getByTestId("stock-value-amount")).toHaveCount(0);
    await expect(home.getByTestId("brief-home-area-prices").getByRole("link")).toHaveAttribute("href", "/property/100000000001");
    await expect(home).not.toContainText(/~£|Now £|Now ~|Estimate|(High|Medium|Low) confidence/);
    await expect(home.getByTestId("brief-home-page")).toHaveAttribute("href", "/property/100000000001");

    await openAreaPage(page);
    await expect(page).toHaveURL(/uprn=100000000001/);
    await expect(page.getByTestId("area-home-page")).toHaveAttribute("href", "/property/100000000001");
    await expect(page.getByTestId("home-last-sale-amount")).toHaveText("Last sold £570,000 · 3 Nov 2022");
    const tools = await openEvidenceSection(page, "Plan & check");
    await expect(tools.getByTestId("user-candidates")).toBeVisible();
    await expect(tools.getByTestId("viewing-checklist")).toBeVisible();
  });

  test(`the home's last recorded sale leads Homes sold nearby, with no value for the home at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/area/lsoa/E01000001?uprn=100000000001");
    const section = await openEvidenceSection(page, "Homes sold nearby");

    const last = section.getByTestId("home-last-sale");
    await expect(last.getByTestId("home-last-sale-amount")).toHaveText("Last sold £570,000 · 3 Nov 2022");
    await expect(last.getByRole("link", { name: "Prices in this area today" })).toHaveAttribute("href", "/property/100000000001");
    await expect(section).not.toContainText(/£668|restated|local market now|in today’s money/i);

    const history = section.getByTestId("property-history");
    await expect(history.getByRole("img")).toHaveCount(0);
    await expect(history.getByRole("list", { name: "Recorded sales" }).getByRole("listitem")).toHaveCount(2);
    await expect(history).toContainText("not property valuations");
    const words = await history.evaluate((section) => [...section.querySelectorAll("p")].map((p) => p.innerText.trim().split(/\s+/).length));
    expect(Math.max(...words)).toBeLessThanOrEqual(25);
  });

  test(`home tools operate under Plan & check, started from real figures at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/area/lsoa/E01000001?uprn=100000000001");
    const tools = await openEvidenceSection(page, "Plan & check");

    await expect(tools.getByText("Total housing costs")).toBeVisible();
    // The worksheet starts from the area's typical home (never a figure for this home), a stated deposit and term.
    await expect(tools.getByTestId("cost-prefill")).toContainText("the area's typical 70 m² home (£672,000)");
    await expect(tools.getByLabel("Price", { exact: true })).toHaveValue("£672,000");
    await expect(tools.getByLabel("Your cash for the deposit")).toHaveValue(/^£\d{2,3},\d{3}$/);
    // The price against the household's maximum, never a negative "remaining budget".
    // No saved budget on a first visit: the example defaults are never "your" max.
    await expect(tools.getByTestId("cost-budget")).toHaveCount(0);
    await expect(tools).not.toContainText("Remaining upfront budget");
    await expect(tools.getByTestId("cost-monthly-total")).toContainText("£");
    await expect(tools.getByTestId("cost-monthly-total")).not.toHaveText("£0");
    await expect(tools.locator(".cost-lines")).not.toContainText("Unknown");
    const before = await tools.getByTestId("cost-monthly-total").innerText();
    await tools.getByText("More costs").click();
    await tools.getByLabel("Utilities (£/month)").fill("200");
    await expect(tools.getByTestId("cost-monthly-total")).not.toHaveText(before);

    // A leasehold home brings a short note and five questions for the agent, not a long form.
    await expect(tools.getByTestId("leasehold-note")).toContainText("solicitor");
    await expect(tools.getByTestId("viewing-checklist").getByRole("checkbox")).toHaveCount(5);
    await expect(tools).not.toContainText(/verification|observed/i);
    await expect(tools.getByTestId("agent-questions-tools").getByRole("link", { name: "stamp duty" })).toHaveAttribute("href", "/tools/stamp-duty");
  });
}

// Wave 1 / feature 5: UK terms open a glossary dialog that links GOV.UK,
// close with Escape, and hand focus back to the term.
test("a glossary term opens its explanation and returns focus on close", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  const panel = await openEvidenceSection(page, "Plan & check");
  const trigger = panel.getByTestId("term-service-charge").first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Service charge" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: /GOV\.UK/ })).toHaveAttribute("href", /^https:\/\/www\.gov\.uk\//);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.goto("/guide/glossary");
  await expect(page.getByTestId("glossary-page").locator("section#gazumping")).toContainText("not legally binding");
});

// Task 6: the home's area (its LSOA) follows home blocks 1–5, every section in the canonical order.
const CANONICAL_SECTIONS = [
  "price", "getting-around", "safety", "schools", "local-places", "environment", "homes", "people", "living-costs",
];
const SOLD_HOME = "/property/100000000001";
const STREET_HOME = "/property/at/W5-1LR/120-meadvale-road";
const FIXTURE_HOMES = [["a sold home", SOLD_HOME], ["a street-level home", STREET_HOME]] as const;
/** The server's seeded read hides browser route mocks: ask for the client-only page (lib/area-page-seed.ts). */
const SEED_OFF = { "x-close-knit-seed": "off" };

for (const [kind, path] of FIXTURE_HOMES) {
  test(`${kind} shows the area sections after the home blocks, in the canonical order`, async ({ page }) => {
    await page.goto(path);
    const sections = page.getByTestId("home-area-sections");
    // A street-level home's sections read their evidence as the reader nears them.
    await sections.scrollIntoViewIfNeeded();
    for (const id of CANONICAL_SECTIONS) {
      // Every section's reads start together. The section's own title: Price holds the home's sale blocks,
      // each with an h2 of its own.
      await expect(sections.getByTestId(`evidence-section-${id}`).getByRole("heading", { level: 2 }).first()).toBeVisible({ timeout: 15_000 });
    }
    const order = await sections.locator("section[data-section]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-section")));
    expect(order.filter((id) => CANONICAL_SECTIONS.includes(id ?? ""))).toEqual(CANONICAL_SECTIONS);
    // No area header or verdict: the home's own header is the page's one h1.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(sections.getByTestId("area-verdict")).toHaveCount(0);
    const below = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
    expect(await below("home-area-sections")).toBeGreaterThan(await below("home-other-homes"));
    expect(await below("home-sources")).toBeGreaterThan(await below("home-area-sections"));
  });
}

test("a sold home's area sections are in its server HTML, in order, for crawlers", async ({ request }) => {
  const html = await (await request.get(SOLD_HOME)).text();
  const at = CANONICAL_SECTIONS.map((id) => html.indexOf(`data-testid="evidence-section-${id}"`));
  expect(at.every((index) => index > 0), `sections in HTML ${at}`).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(html.indexOf('data-testid="evidence-section-price"')).toBeGreaterThan(html.indexOf('data-testid="home-other-homes"'));
  for (const title of ["Getting around", "Local places", "Living costs"]) expect(html).toContain(`<span>${title}</span>`);
});

/** Each read fails alone: only the sections that read it say "Couldn't load", and the home's blocks stay. */
const FAILURES = [
  { what: "places", route: /\/api\/v1\/areas\/[^/?]+\/places\?/, sections: ["getting-around", "local-places"] },
  { what: "prices by type", route: /\/api\/v1\/areas\/[^/?]+\/market-by-type(\?|$)/, sections: ["price"] },
  { what: "schools", route: /\/api\/v1\/areas\/[^/?]+\/schools(\?|$)/, sections: ["schools"] },
  { what: "council tax", route: /\/api\/v1\/areas\/[^/?]+\/civic(\?|$)/, sections: ["living-costs"] },
  { what: "kids", route: /\/api\/v1\/areas\/[^/?]+\/kids(\?|$)/, sections: ["safety", "schools"] },
] as const;

for (const [kind, path] of FIXTURE_HOMES) {
  for (const { what, route, sections: failing } of FAILURES) {
    test(`${kind}: a failed ${what} read shows "Couldn't load" in ${failing.join(" and ")} only`, async ({ page }) => {
      await page.setExtraHTTPHeaders(SEED_OFF);
      await page.route(route, (call) => call.fulfill({ status: 500, json: { error: "boom" } }));
      await page.goto(path);
      const sections = page.getByTestId("home-area-sections");
      await sections.scrollIntoViewIfNeeded();
      for (const id of failing) {
        await expect(sections.getByTestId(`evidence-section-${id}`)).toContainText("Couldn't load", { timeout: 15_000 });
      }
      await expect(sections.getByText("Couldn't load")).toHaveCount(failing.length);
      await expect(page.getByTestId("home-facts")).toBeVisible();
      await expect(sections.getByTestId("evidence-section-people")).toBeVisible();
      if (what !== "places") return;
      // Retry reads it again.
      await page.unroute(route);
      await sections.getByTestId("evidence-section-local-places").getByRole("button", { name: "Retry" }).click();
      await expect(sections.getByTestId("essentials")).toBeVisible({ timeout: 15_000 });
      await expect(sections.getByText("Couldn't load")).toHaveCount(0);
    });
  }
}

test("a failed area read on a home page keeps the home's blocks and offers a retry", async ({ page }) => {
  const area = /\/api\/v1\/areas\/uk(%3A|:)lsoa(%3A|:)E01000001\?/;
  await page.route(area, (call) => call.fulfill({ status: 500, json: { error: "boom" } }));
  await page.goto(STREET_HOME);
  const sections = page.getByTestId("home-area-sections");
  await sections.scrollIntoViewIfNeeded();
  const retry = sections.getByTestId("area-evidence-retry");
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("home-facts")).toBeVisible();
  await page.unroute(area);
  await retry.click();
  await expect(sections.getByTestId("evidence-section-price")).toBeVisible({ timeout: 15_000 });
});

// Task 7: area360's area blocks, each in its own section, on both fixture homes.
const AREA360_BLOCKS = [
  ["price", "market-summary"], ["price", "market-by-type"], ["price", "market-trend"], ["price", "market-box"], ["price", "recent-sales"],
  ["living-costs", "borough-rents"], ["getting-around", "stations-list"], ["safety", "crime-categories"], ["safety", "road-safety"],
  ["schools", "schools-list"], ["local-places", "parks-list"], ["local-places", "amenities-list"],
  ["environment", "flood"], ["environment", "noise"], ["health", "air"], ["environment", "nature"],
  ["homes", "homes-census"], ["homes", "broadband"], ["people", "population"], ["people", "people-census"], ["living-costs", "council-tax"],
] as const;
/** Real-release evidence only: the demo fixtures have none, so these say so (never a 0). */
const NO_DEMO_DATA = ["noise", "air", "nature", "broadband"];

async function expectArea360Blocks(page: Page) {
  const sections = page.getByTestId("home-area-sections");
  await sections.scrollIntoViewIfNeeded();
  for (const [section, id] of AREA360_BLOCKS) {
    const block = sections.getByTestId(`evidence-section-${section}`).getByTestId(id).first();
    await expect(block, id).toBeVisible({ timeout: 15_000 });
    expect((await block.innerText()).trim(), id).not.toMatch(/^£?0$/);
  }
  for (const id of NO_DEMO_DATA) await expect(sections.getByTestId(id), id).toHaveText("No data for this area");
  // The four amenity groups, each its nearest by name and distance; no count to contradict the rows above.
  const amenities = sections.getByTestId("amenities-list");
  await expect(amenities.getByRole("listitem")).toHaveCount(4);
  await expect(amenities.getByRole("listitem").first()).toContainText(/Preview Local 140 m/);
  await expect(amenities).not.toContainText(/\d+ in \d+ min/);
  // Per-type prices once: the table and the spread, not the card's bands as well.
  await expect(sections.getByTestId("price-types")).toHaveCount(0);
  await expect(sections.getByTestId("market-summary")).toContainText(/\/sq ft/);
  await expect(sections.getByTestId("market-by-type").locator("thead")).toContainText("P5P25P75P95");
  await expect(sections.getByTestId("council-tax")).toHaveText(/^A £733 · B £856 · C £978 · D £1,100 · E £1,344 · F £1,589 · G £1,833 · H £2,200$/);
  // Road collisions link to the collisions overlay on the map.
  const collisions = sections.getByTestId("road-safety").getByRole("link", { name: "On map" });
  await expect(collisions).toHaveAttribute("href", /^\/\?.*selected=uk%3Alsoa%3AE01000001.*&collisions=on$/);
  const zeros = await sections.locator("dd, td, strong").evaluateAll((nodes) => nodes
    .map((node) => node.textContent?.trim() ?? "").filter((text) => /^£?0$/.test(text)));
  expect(zeros).toEqual([]);
}

for (const [kind, path] of FIXTURE_HOMES) {
  test(`${kind} shows area360's area blocks, and never a 0 where data is missing`, async ({ page }) => {
    await page.goto(path);
    await expectArea360Blocks(page);
  });
}

test("a street-level home's area360 blocks in the dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(STREET_HOME);
  await expectArea360Blocks(page);
});

test("a home's area blocks say \"No data for this area\" when places and population are absent", async ({ page }) => {
  await page.setExtraHTTPHeaders(SEED_OFF);
  await page.route(/\/api\/v1\/areas\/[^/?]+\/places\?/, async (call) => {
    const response = await call.fetch();
    await call.fulfill({ response, json: { ...(await response.json()), available: false } });
  });
  await page.route(/\/api\/v1\/areas\/[^/?]+\/people(\?|$)/, async (call) => {
    const response = await call.fetch();
    await call.fulfill({ response, json: { ...(await response.json()), population: null } });
  });
  await page.goto(STREET_HOME);
  const sections = page.getByTestId("home-area-sections");
  await sections.scrollIntoViewIfNeeded();
  for (const id of ["amenities-list", "parks-list", "population"]) {
    await expect(sections.getByTestId(id), id).toHaveText("No data for this area", { timeout: 15_000 });
  }
});

test("a home lists up to 16 schools a phase", async ({ page }) => {
  await page.setExtraHTTPHeaders(SEED_OFF);
  await page.route(/\/api\/v1\/areas\/[^/?]+\/schools(\?|$)/, async (call) => {
    const response = await call.fetch();
    const body = await response.json();
    const primary = body.schools.find((school: { phase: string }) => school.phase === "primary");
    const many = Array.from({ length: 20 }, (_, index) => ({
      ...primary, schoolId: `${primary.schoolId}-${index}`, urn: `${primary.urn}${index}`, name: `Primary ${index + 1}`, distanceMetres: 100 + index * 50,
    }));
    await call.fulfill({ response, json: { ...body, schools: [...body.schools, ...many] } });
  });
  await page.goto(STREET_HOME);
  const sections = page.getByTestId("home-area-sections");
  await sections.scrollIntoViewIfNeeded();
  const schools = sections.getByTestId("schools-list");
  await expect(schools.getByTestId("area-school-row")).toHaveCount(16, { timeout: 15_000 });
});
