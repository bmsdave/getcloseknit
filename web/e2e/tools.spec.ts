import { expect, test, type Page } from "./fixtures";

// /tools: stamp duty, mortgage rates tracker, buy-to-let calculator and Check a home.
// Each page keeps the not-advice notice visible, fits a phone without
// sideways scrolling and draws no browser-default buttons.

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function unstyledButtons(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll("button, summary")]
    .filter((element) => element.getClientRects().length > 0)
    .filter((element) => ["outset", "inset"].includes(getComputedStyle(element).borderTopStyle))
    .map((element) => (element.textContent ?? "").trim()));
}

test("the tools index links every tool and says it is not advice", async ({ page }) => {
  await page.goto("/tools");
  await expect(page.getByTestId("not-advice")).toContainText("A guide, not financial advice");
  for (const name of ["Stamp duty calculator", "Mortgage rates tracker", "Buy-to-let calculator", "Check a home"]) {
    await expect(page.getByRole("main").getByRole("link", { name }).first()).toBeVisible();
  }
  await noSidewaysScroll(page);
});

test("stamp duty: a prefilled price gives the band-by-band tax and reacts to the options", async ({ page }) => {
  await page.goto("/tools/stamp-duty?price=295000&from=Example%20Road");
  await expect(page.getByTestId("not-advice")).toBeVisible();
  await expect(page.getByTestId("tools-prefill")).toContainText("Example Road");
  await expect(page.getByTestId("sdlt-total")).toHaveText("£4,750");
  await expect(page.getByTestId("sdlt-bands")).toContainText("£2,250");

  await page.getByLabel("I will own another home after buying").check();
  // 5% × 125,000 + 7% × 125,000 + 10% × 45,000.
  await expect(page.getByTestId("sdlt-total")).toHaveText("£19,500");

  await page.getByLabel("I will own another home after buying").uncheck();
  await page.getByLabel("I am a first-time buyer").check();
  await expect(page.getByTestId("sdlt-total")).toHaveText("£0");

  await page.getByTestId("sdlt-price").fill("500000");
  await expect(page.getByTestId("sdlt-total")).toHaveText("£10,000");
  await expect(page.getByRole("link", { name: /Residential property rates/ })).toHaveAttribute("href", /gov\.uk/);
  expect(await unstyledButtons(page)).toEqual([]);
  await noSidewaysScroll(page);
});

test("mortgage rates: latest month, chart lines, figures table and source", async ({ page }) => {
  await page.goto("/tools/mortgage-rates");
  await expect(page.getByTestId("not-advice")).toBeVisible();
  await expect(page.getByTestId("rates-latest")).toContainText("4.92%");
  // Four series: Bank Rate as a dashed ink line, the fixed rates in stem stitch, each ending in a dot.
  await expect(page.getByTestId("rates-chart").locator("g[data-rate]")).toHaveCount(4);
  await expect(page.getByTestId("rates-chart").locator(".rates-chart__dot")).toHaveCount(3);
  await page.getByText("Show the figures").click();
  await expect(page.getByTestId("rates-table")).toContainText("Jan 1996");
  await expect(page.getByTestId("rates-table")).toContainText("Not yet published");
  await expect(page.getByRole("main")).toContainText("Open Government Licence");
  expect(await unstyledButtons(page)).toEqual([]);
  await noSidewaysScroll(page);
});

test("stamp duty and buy-to-let show a result on first load, kept in view on a phone while editing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/stamp-duty");
  await expect(page.getByTestId("tools-example")).toBeVisible();
  await expect(page.getByTestId("sdlt-price")).toHaveValue("500,000");
  await expect(page.getByTestId("sdlt-total")).toHaveText("£15,000");
  await page.getByTestId("sdlt-price").fill("400000");
  await expect(page.getByTestId("tools-bar")).toBeInViewport();
  await expect(page.getByTestId("tools-bar")).toContainText("£10,000");
  // The tool nav is one row that scrolls sideways, never a wall of pills.
  const rows = await page.locator(".tools-nav a").evaluateAll((links) => new Set(links.map((link) => link.getBoundingClientRect().top)).size);
  expect(rows).toBe(1);
  await noSidewaysScroll(page);

  await page.goto("/tools/investor");
  await expect(page.getByTestId("btl-deposit")).toHaveValue("125,000");
  await expect(page.getByTestId("btl-monthlyRent")).toHaveValue("2,250");
  await expect(page.getByTestId("btl-monthly-cash-flow")).not.toHaveText("Unknown");
  await expect(page.getByTestId("tools-bar")).toBeInViewport();
  await expect(page.getByTestId("btl-more-costs")).not.toHaveAttribute("open");
  await noSidewaysScroll(page);
});

test("mortgage rates says averages, not offers, and keeps series codes in Sources", async ({ page }) => {
  await page.goto("/tools/mortgage-rates");
  await expect(page.getByTestId("not-advice")).toContainText("Averages, not offers, not financial advice");
  await expect(page.getByRole("main")).not.toContainText("your own numbers");
  await expect(page.getByTestId("rates-sources")).not.toHaveAttribute("open");
  await expect(page.getByText(/IUM[A-Z0-9]+/)).toBeHidden();
});

test("buy-to-let: yields, cash flow and cash needed from the worked example", async ({ page }) => {
  await page.goto("/tools/investor?price=250000");
  await expect(page.getByTestId("not-advice")).toBeVisible();
  await expect(page.getByTestId("btl-deposit")).toHaveValue("63,000");
  await page.getByText("More costs").click();
  const fill = async (key: string, value: string) => page.getByTestId(`btl-${key}`).fill(value);
  await fill("deposit", "62500");
  await fill("annualInterestRatePct", "5");
  await fill("monthlyRent", "1250");
  await fill("voidWeeksPerYear", "2");
  await fill("agentFeePct", "10");
  await fill("serviceChargeMonthly", "0");
  await fill("groundRentAnnual", "0");
  await fill("insuranceAnnual", "300");
  await fill("maintenanceMonthly", "50");
  await fill("legalAndSurvey", "2000");
  await fill("refurbishment", "0");
  await expect(page.getByTestId("btl-gross-yield")).toHaveText("6.00%");
  await expect(page.getByTestId("btl-net-yield")).toHaveText("4.83%");
  await expect(page.getByTestId("btl-monthly-cash-flow")).toHaveText("£225");
  await expect(page.getByTestId("btl-cash-required")).toHaveText("£79,500");
  await expect(page.getByTestId("btl-unknowns")).toHaveCount(0);
  expect(await unstyledButtons(page)).toEqual([]);
  await noSidewaysScroll(page);
});

test("investor calculator: HMO, BRRR and flip tabs each show figures; the price follows across tabs", async ({ page }) => {
  await page.goto("/tools/investor?price=200000");
  const tabs = page.getByRole("tablist", { name: "Kind of investment" });
  await expect(tabs.getByRole("tab")).toHaveText(["Buy-to-let", "HMO", "BRRR", "Flip"]);
  await expect(tabs.getByRole("tab", { name: "Buy-to-let" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("btl-gross-yield")).not.toHaveText("Unknown");

  await tabs.getByRole("tab", { name: "HMO" }).click();
  await expect(page.getByTestId("hmo-price")).toHaveValue("200,000");
  await expect(page.getByTestId("hmo-gross-yield")).not.toHaveText("Unknown");
  await page.getByTestId("hmo-rooms").fill("5");
  await page.getByTestId("hmo-rentPerRoomMonthly").fill("600");
  await page.getByTestId("hmo-billsMonthly").fill("400");
  await expect(page.getByTestId("hmo-gross-yield")).toHaveText("18.00%");

  await tabs.getByRole("tab", { name: "BRRR" }).click();
  await expect(page.getByTestId("brrr-price")).toHaveValue("200,000");
  await page.getByTestId("brrr-refurb").fill("30000");
  await page.getByTestId("brrr-valueAfter").fill("300000");
  await page.getByTestId("brrr-refinanceLtvPct").fill("75");
  await page.getByTestId("brrr-annualInterestRatePct").fill("5");
  await page.getByTestId("brrr-monthlyRent").fill("1500");
  await page.getByTestId("brrr-runningCostsMonthly").fill("0");
  await page.getByTestId("brrr-legalAndSurvey").fill("0");
  await expect(page.getByTestId("brrr-money-left-in")).toHaveText("£16,500");
  await expect(page.getByTestId("brrr-cash-flow")).toHaveText("£563");
  await expect(page.getByTestId("brrr-roi")).toHaveText("40.91%");
  await expect(page.getByTestId("brrr-holding")).toContainText("bridging interest) are not counted");

  await tabs.getByRole("tab", { name: "Flip" }).click();
  await page.getByTestId("flip-price").fill("200000");
  await page.getByTestId("flip-refurb").fill("30000");
  await page.getByTestId("flip-salePrice").fill("300000");
  await page.getByTestId("flip-months").fill("6");
  await page.getByTestId("flip-financeRatePct").fill("8");
  await page.getByTestId("flip-sellingCostsPct").fill("1.5");
  await page.getByTestId("flip-legalAndSurvey").fill("0");
  await expect(page.getByTestId("flip-profit")).toHaveText("£44,800");
  await expect(page.getByTestId("flip-holding")).toContainText("council tax, utilities, insurance");
  await expect(page.getByTestId("flip-roi")).toHaveText("17.87%");

  // The price typed on one tab is the price on the others.
  await page.getByTestId("flip-price").fill("250000");
  await tabs.getByRole("tab", { name: "Buy-to-let" }).click();
  await expect(page.getByTestId("btl-price")).toHaveValue("250,000");
  expect(await unstyledButtons(page)).toEqual([]);
  await noSidewaysScroll(page);
});

test("check a home: the moved area-card tools open without an area", async ({ page }) => {
  await page.goto("/tools/check-a-home");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check a home");
  await expect(page.getByTestId("not-advice")).toBeVisible();
  await expect(page.getByTestId("check-home").getByText("Total housing costs")).toBeVisible();
  await expect(page.getByTestId("viewing-checklist")).toBeVisible();
  await expect(page.getByTestId("leasehold-note")).toBeVisible();
  await expect(page.getByTestId("user-candidates")).toBeVisible();
  // Nothing is guessed without a linked price, area or home.
  await expect(page.getByTestId("cost-prefill")).toHaveCount(0);
  await expect(page.getByTestId("check-home-area")).toHaveCount(0);
  await expect(page.getByTestId("property-tools")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Tools" }).getByRole("link", { name: "Check a home" })).toHaveAttribute("aria-current", "page");
  expect(await unstyledButtons(page)).toEqual([]);
  await noSidewaysScroll(page);
});

// v4 Tasks 44 + 49: a knit card with its result up top, and a home's last sale says when it was.
test("check a home: the worksheet is a card with a big result, and a home's sale price says its date", async ({ page }) => {
  await page.goto("/tools/check-a-home?uprn=100000000001&price=570000&from=10%20Sample%20Street&sold=2022-11");
  const worksheet = page.getByTestId("cost-worksheet");
  await expect(worksheet.getByRole("heading", { name: "Total housing costs" })).toBeVisible();
  await expect(page.locator("fieldset.cost-worksheet, .cost-worksheet legend")).toHaveCount(0);
  await expect(page.getByTestId("cost-prefill")).toContainText("10 Sample Street (£570,000, last sale Nov 2022)");
  const result = worksheet.getByTestId("cost-result");
  await expect(result.getByTestId("cost-monthly-total")).toHaveText(/^£[\d,]+$/);
  await expect(result.getByTestId("cost-cash-needed")).toContainText(/Upfront\s*£[\d,]+/);
  // The result reads big: the month at least 32px.
  const size = await result.getByTestId("cost-monthly-total").evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(size).toBeGreaterThanOrEqual(32);
  await noSidewaysScroll(page);

  // Stamp duty says the sale's month too; a typed price is nobody's sale, so the month leaves the link.
  await page.goto("/tools/stamp-duty?price=570000&from=10%20Sample%20Street&sold=2022-11");
  await expect(page.getByTestId("tools-prefill")).toContainText("from 10 Sample Street, its last sale in Nov 2022.");
  await expect(async () => {
    await page.getByTestId("sdlt-price").fill("600000");
    await expect(page).toHaveURL(/price=600000/, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get("sold")).toBeNull();
});

test("check a home: an area link starts the worksheet from its price and links back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/check-a-home?area=uk:lsoa:E01000001&uprn=100000000001&price=672000&from=the%20area%27s%20typical%2070%20m%C2%B2%20home");
  // r3 #15: the way back names the home first, then its area.
  await expect(page.getByTestId("check-home-back")).toHaveAttribute("href", "/property/100000000001");
  await expect(page.getByTestId("check-home-back")).not.toContainText(/E0\d{7}|Westminster preview/);
  await expect(page.getByTestId("check-home-area-link")).toHaveAttribute("href", "/area/lsoa/E01000001");
  // Second, the area by its name only ("St James's area", not "St James's · SW1A area").
  await expect(page.getByTestId("check-home-area-link")).toHaveText(/^[^·]+ area$/);
  // One "not advice" line: the page's, under the title (v3 Fix 18); none on the worksheet.
  await expect(page.getByTestId("not-advice")).toHaveCount(1);
  await expect(page.getByTestId("cost-worksheet").getByText(/not advice/i)).toHaveCount(0);
  // Two honest prices: the home's money tools use its own last sale; the worksheet keeps the area's typical price.
  const homeTools = page.getByTestId("property-tools");
  await expect(homeTools.getByRole("link", { name: "Stamp duty" })).toHaveAttribute("href", /price=570000&from=1\+Parliament\+Preview/);
  await expect(homeTools.getByRole("link", { name: "Buy-to-let" })).toHaveAttribute("href", /price=570000/);
  await expect(page.getByTestId("cost-prefill")).toContainText("the area's typical 70 m² home (£672,000)");
  await expect(page.getByLabel("Price", { exact: true })).toHaveValue("£672,000");
  await noSidewaysScroll(page);
});

// r3 #32: on a phone the tool tabs open scrolled to the current one.
test("check a home: the current tool tab is in view on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/tools/check-a-home?price=525000");
  const tab = page.getByRole("navigation", { name: "Tools" }).getByRole("link", { name: "Check a home" });
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect.poll(async () => { const box = (await tab.boundingBox())!; return box.x >= 0 && box.x + box.width <= 320; }).toBe(true);
});

test("check a home: a bad area is dropped, not an error", async ({ page }) => {
  const response = await page.goto("/tools/check-a-home?area=uk:lsoa:nope&uprn=abc&price=-1");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("check-home")).toBeVisible();
  await expect(page.getByTestId("check-home-area")).toHaveCount(0);
});

// G12: each tool's answer ends with a way back to areas and homes.
test("stamp duty, mortgage rates and buy-to-let end with Find areas and Check a home", async ({ page }) => {
  for (const slug of ["stamp-duty", "mortgage-rates", "investor"]) {
    await page.goto(`/tools/${slug}`);
    const main = page.getByRole("main");
    await expect(main.getByTestId("tool-find-areas")).toBeVisible();
    await expect(main.getByTestId("tool-check-home")).toHaveAttribute("href", /^\/tools\/check-a-home/);
  }
  await page.goto("/tools/stamp-duty?price=570000&from=1%20Example%20Road");
  const find = page.getByTestId("tool-find-areas");
  await expect(find).toHaveAttribute("href", "/?find=budget&price=570000");
  await expect(page.getByTestId("tool-check-home")).toHaveAttribute("href", /price=570000/);
  await find.click();
  // My match opens with the tool's price applied (v4.4: not just typed): the price is the budget, its stretch fades
  // above it, and the chip says where it came from (v4.6, CUJ06/CUJ11 boards).
  const budget = page.locator('[data-testid="match-item"][data-id="affordability"]');
  await expect(budget).toContainText("Budget ≤ £570k · from Tools", { timeout: 20_000 });
  await expect(page.getByTestId("match-list").getByTestId("areas-left")).toBeVisible();
  await expect(page).not.toHaveURL(/find=budget/);
});
