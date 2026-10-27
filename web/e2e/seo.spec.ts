import { expect, test, type Page } from "./fixtures";

// Link previews and search readiness (#13): every shareable page has a canonical, an og:title that
// names the site once and an og:image that renders; an unknown area's card is a 404 like its page.
async function meta(page: Page, selector: string): Promise<string | null> {
  return page.locator(selector).first().getAttribute("content");
}

for (const [path, title] of [
  ["/", /^Close Knit: what London homes really sold for/],
  ["/area/lsoa/E01000001", /^St James's · SW1A · Close Knit$/],
  ["/rankings/most-expensive", /^Most expensive areas in London · Close Knit$/],
] as const) {
  test(`${path} has a canonical, og:title and og:image`, async ({ page, baseURL }) => {
    await page.goto(path);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBe(`${baseURL}${path === "/" ? "" : path}`);
    const ogTitle = await meta(page, 'meta[property="og:title"]');
    expect(ogTitle).toMatch(title);
    expect(ogTitle?.match(/Close Knit/g)).toHaveLength(1);
    expect(await meta(page, 'meta[name="twitter:card"]')).toBe("summary_large_image");
    const image = await meta(page, 'meta[property="og:image"]');
    // Absolute, on this site (the dev server names file-based cards on localhost; a build uses metadataBase).
    const url = new URL(image!);
    expect(url.port).toBe(new URL(baseURL!).port);
    const card = await page.request.get(`${url.pathname}${url.search}`);
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    // Still not listed by search engines until the going-public step.
    expect(await meta(page, 'meta[name="robots"]')).toBe("noindex, nofollow");
  });
}

test("the home page describes the site and its postcode search as JSON-LD", async ({ page }) => {
  await page.goto("/");
  const data = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent())!);
  expect(data["@type"]).toBe("WebSite");
  expect(data.potentialAction["@type"]).toBe("SearchAction");
});

test("an area card renders for a known area and 404s for an unknown one", async ({ request }) => {
  const known = await request.get("/area/lsoa/E01000001/opengraph-image");
  expect(known.status()).toBe(200);
  expect(known.headers()["content-type"]).toBe("image/png");
  expect((await request.get("/area/lsoa/E01999999/opengraph-image")).status()).toBe(404);
  expect((await request.get("/area/street/E01000001/opengraph-image")).status()).toBe(404);
});

test("the sitemap lists guide, tools, glossary, agents and the areas", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/guide<", "/guide/glossary<", "/agents<", "/tools<", "/area/london<", "/area/lsoa/E01000001<"]) {
    expect(xml).toContain(path);
  }
});

test("the sitemap lists Places and pack pages; the index leads to postcode, homes and property pages", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/area/lsoa/E01000001/places<", "/area/lsoa/E01000001/pack<"]) expect(xml).toContain(path);
  const index = await request.get("/sitemap-index.xml");
  expect(index.headers()["content-type"]).toContain("application/xml");
  const shards = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
  expect(shards).toEqual(["/sitemap.xml", "/area/sitemap/sectors.xml", "/postcode/sitemap/SW1A-1.xml"]);
  const sectors = await request.get("/area/sitemap/sectors.xml");
  expect(sectors.status()).toBe(200);
  expect(await sectors.text()).toContain("<urlset");
  expect(xml).toContain("/area/england<");
  const shard = await (await request.get(shards[2])).text();
  for (const path of ["/postcode/SW1A-1AB<", "/postcode/SW1A-1AB/homes<", "/property/100000000001<"]) expect(shard).toContain(path);
  expect((await request.get("/postcode/sitemap/W5-1.xml")).status()).toBe(404);
});

test("a home with no page (unknown or hidden) answers 404 with noindex", async ({ page }) => {
  const response = await page.goto("/property/999999999999");
  expect(response?.status()).toBe(404);
  // Next's own noindex on the 404, beside the private preview's layout meta.
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
});

test("area pages carry Place, and the London page Dataset, beside their FAQ", async ({ page }) => {
  const types = async () => (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  await page.goto("/area/lsoa/E01000001");
  expect(await types()).toContain("Place");
  await page.goto("/area/lad/E09000001");
  expect(await types()).toEqual(expect.arrayContaining(["FAQPage", "Place"]));
  await page.goto("/area/london");
  expect(await types()).toEqual(expect.arrayContaining(["FAQPage", "Dataset"]));
});
