import { expect, test } from "./fixtures";

import { GUIDE_SLUGS } from "../src/lib/guide-slugs";
import { openMenuGroup } from "./top-bar";

// /guide replaced /methodology: one article per slug, all in one template,
// and every old link still lands on the right article.

test("the guide index links every article", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const slug of GUIDE_SLUGS) {
    await expect(page.getByTestId(`guide-card-${slug}`)).toHaveAttribute("href", `/guide/${slug}`);
  }
});

test("every article has an answer, a diagram, an example and folded fine print", async ({ page }) => {
  // Every page renders per request (its canonical and card name the request's origin): allow the dev server time.
  test.setTimeout(90_000);
  for (const slug of GUIDE_SLUGS) {
    await page.goto(`/guide/${slug}`);
    const article = page.getByTestId("guide-article");
    await expect(article, slug).toHaveAttribute("data-slug", slug);
    await expect(article.getByTestId("guide-answer"), slug).not.toBeEmpty();
    // G19 + v4 Task 34: every article has a "Use it" block under its answer: its layer on the map or its tool.
    await expect(article.getByTestId("guide-use-it").getByTestId(/^guide-(see-on-map|tool-link)$/), slug).toHaveCount(1);
    await expect(article.locator("svg[role=img]"), slug).toBeVisible();
    await expect(article.getByRole("heading", { name: "Example" }), slug).toBeVisible();
    // Schools 101 ranks rather than calculates: its heading is "How we rank" (Menu v5 board).
    await expect(article.locator("#guide-how"), slug).toHaveText(/^How we (calculate it|rank)$/);
    const finePrint = article.getByTestId("guide-fine-print");
    await expect(finePrint, slug).not.toHaveAttribute("open", "");
    await finePrint.locator("summary").click();
    await expect(finePrint, slug).toHaveAttribute("open", "");
  }
});

test("the merged tracks' topics sit in their index group", async ({ page }) => {
  await page.goto("/guide");
  const groups: [string, string[]][] = [
    ["Living here", ["people-and-homes", "getting-around", "local-government"]],
    ["Prices", ["local-market"]],
    ["Buying a home", ["energy-rating", "stamp-duty", "mortgage-rates", "buy-to-let"]],
  ];
  for (const [group, topics] of groups) {
    const section = page.getByRole("region", { name: group });
    for (const slug of topics) await expect(section.getByTestId(`guide-card-${slug}`), slug).toBeVisible();
  }
  // Places, not people: the homes card describes homes, never who lives there.
  await expect(page.getByTestId("guide-card-people-and-homes")).toContainText("Homes here");
  await expect(page.getByTestId("guide-card-people-and-homes")).not.toContainText(/who lives/i);
});

const HELP_LINKS: [string, string, string][] = [
  ["/tools/stamp-duty", "sdlt-first-time-buyer", "stamp-duty"],
  ["/tools/mortgage-rates", "mortgage-rates-ltv", "mortgage-rates"],
  ["/tools/investor", "btl-tax", "buy-to-let"],
  ["/civic?area=uk%3Alsoa%3AE01000001", "council-tax", "local-government"],
];

for (const [path, helpId, slug] of HELP_LINKS) {
  test(`the ${helpId} (?) on ${path} leads to /guide/${slug}`, async ({ page }) => {
    await page.goto(path);
    await page.locator(`button[data-help-id="${helpId}"]`).first().click();
    const more = page.getByTestId(`help-${helpId}`).getByRole("link", { name: "Learn more →" });
    await expect(more).toHaveAttribute("href", `/guide/${slug}`);
    // Follow the link by URL: on the phone project Playwright's click reports
    // the paragraph above as covering this bubble at the page foot, although
    // elementFromPoint finds the link there.
    await page.goto(`/guide/${slug}`);
    await expect(page.getByTestId("guide-article")).toHaveAttribute("data-slug", slug);
  });
}

test("an unknown article is a 404", async ({ page }) => {
  const response = await page.goto("/guide/not-a-topic");
  expect(response?.status()).toBe(404);
});

test("/methodology redirects permanently to the guide", async ({ request }) => {
  const response = await request.get("/methodology", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe("/guide");
});

const OLD_ANCHORS: [string, string][] = [
  ["real-data", "demo-vs-real"],
  ["stock-value", "stock-value"],
  ["personal-match", "your-match"],
  ["sold-prices", "sold-prices"],
  ["price-per-square-metre", "price-per-m2"],
  ["crime", "crime"],
];

for (const [anchor, slug] of OLD_ANCHORS) {
  test(`/methodology#${anchor} opens /guide/${slug}`, async ({ page }) => {
    await page.goto(`/methodology#${anchor}`);
    await expect(page).toHaveURL(new RegExp(`/guide/${slug}$`), { timeout: 15_000 });
    await expect(page.getByTestId("guide-article")).toHaveAttribute("data-slug", slug);
  });
}

test("the header names the guide", async ({ page }) => {
  await page.goto("/");
  await (await openMenuGroup(page, "Learn")).getByRole("navigation", { name: "Site menu" }).getByRole("link", { name: "Guide" }).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByTestId("guide-index")).toBeVisible();
});

// C11: an article ends with its layer on the map, the next article and Share.
test("an article opens its layer on the map, links the next article and shares its link", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  // No system share sheet here, so Share falls back to the clipboard.
  await page.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined }));
  await page.goto("/guide/crime");
  const foot = page.getByTestId("guide-article-foot");
  await expect(page.getByTestId("guide-use-it").getByTestId("guide-see-on-map")).toHaveAttribute("href", "/?layer=crime");
  await expect(page.getByTestId("guide-use-it").getByTestId("guide-use-more")).toHaveAttribute("href", "/rankings/lowest-crime");
  await expect(foot.getByTestId("guide-see-on-map")).toHaveCount(0);
  await expect(foot.getByTestId("guide-next")).toHaveAttribute("href", "/guide/deprivation");
  await expect(foot.getByTestId("guide-next")).toContainText("Next: Deprivation");
  // Retried until the page has hydrated and the click is handled.
  await expect(async () => {
    await foot.getByTestId("guide-share").click();
    await expect(foot.getByTestId("share-status")).toContainText("Link copied", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/guide\/crime$/);
  // A topic with no layer of its own links its tool instead; the related list stays.
  await page.goto("/guide/stamp-duty");
  await expect(page.getByTestId("guide-see-on-map")).toHaveCount(0);
  await expect(page.getByTestId("guide-tool-link")).toHaveAttribute("href", "/tools/stamp-duty");
  await expect(page.getByRole("navigation", { name: "More in this section" })).toBeVisible();
});

// v4 Task 34: Use it sits under the answer and reads the saved areas in London words, never x/10.
test("Use it is under the answer, and names the reader's saved areas in London words", async ({ page }) => {
  // Saved with the area page's ♡, as a reader would.
  await page.goto("/area/lsoa/E01000001");
  const heart = page.getByTestId("area-save-actions").getByTestId("save-area");
  await expect(async () => {
    await heart.click();
    await expect(heart).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.goto("/guide/crime");
  const use = page.getByTestId("guide-use-it");
  const [useBox, figureBox] = await Promise.all([use.boundingBox(), page.locator(".guide-figure").boundingBox()]);
  expect(useBox!.y).toBeLessThan(figureBox!.y);
  const areas = use.getByTestId("guide-your-areas");
  await expect(areas).toContainText(/St James's.*(More crime than|Safer than) \d+%/);
  await expect(areas).not.toContainText("/10");
  await expect(areas.getByRole("link", { name: "St James's" })).toHaveAttribute("href", "/area/lsoa/E01000001");
  // An article without an area tile has no such line.
  await page.goto("/guide/stamp-duty");
  await expect(page.getByTestId("guide-use-it").getByTestId("guide-use-more")).toHaveAttribute("href", "/tools/check-a-home");
  await expect(page.getByTestId("guide-your-areas")).toHaveCount(0);
});

test("the map link opens the article's layer", async ({ page }) => {
  await page.goto("/guide/crime");
  const href = await page.getByTestId("guide-see-on-map").getAttribute("href");
  await page.goto(href ?? "/");
  await expect(page.getByTestId("map-legend")).toContainText("Crimes per 1,000", { timeout: 30_000 });
});

test("the map link followed in-app keeps its layer on a first visit (link params win, v4 Task 18)", async ({ page }) => {
  await page.goto("/guide/crime");
  await page.getByTestId("guide-use-it").getByTestId("guide-see-on-map").click();
  await expect(page).toHaveURL(/layer=crime/);
  await expect(page.getByTestId("map-legend")).toContainText("Crimes per 1,000", { timeout: 30_000 });
});

test("glossary terms link to the guide article that explains them", async ({ page }) => {
  await page.goto("/guide/glossary");
  await expect(page.getByTestId("glossary-guide-sdlt")).toHaveAttribute("href", "/guide/stamp-duty");
  await expect(page.getByTestId("glossary-guide-epc")).toHaveAttribute("href", "/guide/energy-rating");
  await page.getByTestId("glossary-guide-price-paid").click();
  await expect(page.getByTestId("guide-article")).toHaveAttribute("data-slug", "sold-prices", { timeout: 20_000 });
});
