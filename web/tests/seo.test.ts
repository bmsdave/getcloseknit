import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  datasetJsonLd, fullTitle, homeSitemapPath, homeSitemapPaths, jsonLd, pageMetadata, placeJsonLd, publicOrigin, SITE_CARD,
  siteRobots, sitemapIndexXml, sitemapPaths, websiteJsonLd,
} from "../src/lib/seo";
import { RANKINGS } from "../src/lib/area-pages";
import { DEMO_HOME_INDEX } from "../src/lib/property-profile-fixture";

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

test("the public origin is the configured URL, else the request's own, never a baked-in local address", () => {
  assert.equal(publicOrigin(" https://getcloseknit.com/ ", headers({ host: "127.0.0.1:8080" })), "https://getcloseknit.com");
  assert.equal(publicOrigin(undefined, headers({ host: "getcloseknit.com" })), "https://getcloseknit.com");
  assert.equal(publicOrigin("", headers({ host: "web:4180", "x-forwarded-host": "getcloseknit.com, proxy", "x-forwarded-proto": "https" })),
    "https://getcloseknit.com");
  assert.equal(publicOrigin(undefined, headers({ host: "localhost:4858" })), "http://localhost:4858", "a local dev server keeps http");
  assert.equal(publicOrigin(undefined, null), null);
  assert.equal(publicOrigin(undefined, headers({})), null);
});

test("titles name the site once under the layout's template", () => {
  assert.equal(fullTitle("Rankings"), "Rankings · Close Knit");
  assert.equal(fullTitle("Close Knit: homes"), "Close Knit: homes");
  const page = pageMetadata({ title: "Guide", description: "Short articles.", path: "/guide" });
  assert.equal(page.title, "Guide", "the template adds the name");
  assert.deepEqual(page.alternates, { canonical: "/guide" });
  const og = page.openGraph as { title: string; url: string; images: { url: string }[] };
  assert.equal(og.title, "Guide · Close Knit");
  assert.equal(og.url, "/guide");
  assert.equal(og.images[0].url, SITE_CARD);
  const named = pageMetadata({ title: "Close Knit: homes", description: "d", path: "/" });
  assert.deepEqual(named.title, { absolute: "Close Knit: homes" }, "never \"Close Knit\" twice");
});

test("a page whose segment has its own card leaves og:image to it", () => {
  const og = pageMetadata({ title: "St James's", description: "d", path: "/area/lsoa/E01000001", image: null }).openGraph as Record<string, unknown>;
  assert.equal("images" in og, false);
});

test("JSON-LD is schema.org and cannot close its script early", () => {
  const data = JSON.parse(jsonLd({ "@type": "Thing", name: "</script><b>" }));
  assert.equal(data["@context"], "https://schema.org");
  assert.doesNotMatch(jsonLd({ name: "</script>" }), /<\/script>/);
  const site = JSON.parse(websiteJsonLd("https://getcloseknit.com"));
  assert.equal(site["@type"], "WebSite");
  assert.equal(site.potentialAction["@type"], "SearchAction");
  assert.equal(site.potentialAction.target.urlTemplate, "https://getcloseknit.com/postcode/{postcode}");
  const place = JSON.parse(placeJsonLd("https://x.test", { name: "St James's", path: "/area/lsoa/E01000001", description: "d" }));
  assert.deepEqual([place["@type"], place.url, place.containedInPlace.name], ["Place", "https://x.test/area/lsoa/E01000001", "London"]);
  const dataset = JSON.parse(datasetJsonLd("https://x.test", { description: "d", period: "2026-06" }));
  assert.deepEqual([dataset["@type"], dataset.url, dataset.temporalCoverage], ["Dataset", "https://x.test/area/london", "2026-06"]);
});

test("the sitemap lists guide, glossary, tools, agents and every area; never a page that only redirects", () => {
  const paths = sitemapPaths([{ geographyId: "uk:lad:E09000033" }, { geographyId: "uk:lsoa:E01000001" }]);
  for (const path of ["/", "/guide", "/guide/glossary", "/agents", "/agents/chatgpt", "/agents/any", "/agents/gemini", "/agents/claude-code", "/agents/le-chat", "/tools", "/tools/stamp-duty", "/tools/check-a-home", "/area/london", "/rankings",
    "/area/lad/E09000033", "/area/lsoa/E01000001"]) assert.ok(paths.includes(path), path);
  assert.ok(paths.some((path) => path.startsWith("/guide/")), "guide articles");
  assert.equal(new Set(paths).size, paths.length, "no duplicates");
  // v3 Fix 16/17: these 308 to the page that holds them now.
  for (const gone of ["/claude", "/glossary", "/teams", "/explore", "/explore/kebab-shops-vs-cafes"]) assert.ok(!paths.includes(gone), gone);
  for (const gone of ["borough-price", "borough-crime", "borough-income"]) assert.ok(!paths.includes(`/rankings/${gone}`), gone);
  // Income and social renting rank (owner decision 2026-10-18): their rankings are pages.
  for (const slug of ["highest-income", "most-social-renting"]) assert.ok(paths.includes(`/rankings/${slug}`), slug);
  assert.ok(paths.every((path) => !path.startsWith("/property/at/")), "street-level homes are never listed");
});

test("the sitemap lists each neighbourhood's Places and pack, and school rankings when shown", () => {
  const school = RANKINGS.find((ranking) => ranking.kind === "school")!;
  const paths = sitemapPaths([{ geographyId: "uk:msoa:E02000001" }, { geographyId: "uk:lsoa:E01000001" }], [school]);
  for (const path of ["/area/lsoa/E01000001/places", "/area/lsoa/E01000001/pack", `/rankings/${school.slug}`]) {
    assert.ok(paths.includes(path), path);
  }
  assert.ok(!paths.includes("/area/msoa/E02000001/places"), "Places and pack per neighbourhood only");
});

test("per-address pages go in one shard per postcode sector, named by the sitemap index", () => {
  const paths = homeSitemapPaths(DEMO_HOME_INDEX.postcodes, DEMO_HOME_INDEX.uprns);
  for (const path of ["/postcode/SW1A-1AB", "/postcode/SW1A-1AB/homes", "/property/100000000001"]) assert.ok(paths.includes(path), path);
  // A street-level home is found, never listed: no address lists.
  assert.ok(paths.every((path) => !path.startsWith("/property/at/")));
  assert.equal(homeSitemapPath("W5 1"), "/postcode/sitemap/W5-1.xml");
  const xml = sitemapIndexXml(["https://x.test/sitemap.xml", "https://x.test/postcode/sitemap/W5-1.xml?a=1&b=2"]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<sitemapindex xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.equal(xml.match(/<sitemap><loc>/g)?.length, 2);
  assert.match(xml, /W5-1\.xml\?a=1&amp;b=2</);
});

test("meta robots: none when public (a 404 keeps only Next's noindex), noindex when private", () => {
  assert.equal(siteRobots(true), undefined);
  assert.deepEqual(siteRobots(false), { index: false, follow: false });
});

test("per-address pages are indexable on a public site; hidden homes 404 (API filters suppressed_dwelling)", () => {
  assert.equal(siteRobots(true), undefined);
});

test("the unlisted tool pages stay noindex, follow (RELEASE-CHECKLIST: Going public)", () => {
  for (const page of ["brief", "civic", "compare", "save-listing"]) {
    const source = readFileSync(new URL(`../src/app/${page}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, /robots: \{ index: false, follow: true \}/, page);
  }
});
