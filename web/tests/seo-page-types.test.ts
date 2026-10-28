import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isCrawler } from "../src/lib/crawler";
import { schoolDescription, schoolTitle } from "../src/lib/school-card";
import { demoSchoolCard } from "../src/lib/school-card-fixture";
import {
  addressJsonLd, areaSearchDescription, areaSearchTitle, breadcrumbJsonLd, DESCRIPTION_MAX, homeDescription, homeTitle,
  pageMetadata, placeJsonLd, releaseDate, searchDescription, searchTitle, SITEMAP_LIMIT, sitemapEntries, sitemapPaths,
  TITLE_MAX, ukPoint,
} from "../src/lib/seo";

/** The <title> a page gets: its title, with the layout's " · Close Knit" when the metadata is not absolute. */
function renderedTitle(title: string): string {
  const meta = pageMetadata({ title, description: "d", path: "/x" }).title;
  return typeof meta === "string" ? `${meta} · Close Knit` : (meta as { absolute: string }).absolute;
}

const LONG_NAMES = ["Lambeth", "Kensington and Chelsea", "Bristol, City of", "Clapham South · SW4",
  "Central Park & Frizlands Lane · RM10", "Brent Cross & Staples Corner · NW2", "City of London · EC1A"];

test("every title fits a search result and names the site only when there is room", () => {
  assert.equal(searchTitle("Rankings"), "Rankings · Close Knit");
  assert.equal(renderedTitle("Rankings"), "Rankings · Close Knit");
  const long = "Central Park & Frizlands Lane · RM10: house prices, crime and schools";
  assert.equal(renderedTitle(long), long, "no site name past 60 characters");
  assert.ok(renderedTitle(homeTitle()).length <= TITLE_MAX, renderedTitle(homeTitle()));
  assert.match(renderedTitle(homeTitle()), /^Close Knit: /);
});

test("descriptions fit 155 characters: whole sentences first, else a word cut with an ellipsis", () => {
  assert.equal(searchDescription("Short."), "Short.");
  const sentences = `${"A sentence that runs on for a while. ".repeat(5)}`;
  const cut = searchDescription(sentences);
  assert.ok(cut.length <= DESCRIPTION_MAX && cut.endsWith("."), cut);
  const words = searchDescription("word ".repeat(60));
  assert.ok(words.length <= DESCRIPTION_MAX && words.endsWith("…"), words);
  for (const england of [false, true]) assert.ok(homeDescription(england).length <= DESCRIPTION_MAX, homeDescription(england));
  const page = pageMetadata({ title: "t", description: "x ".repeat(200), path: "/x" });
  assert.ok(String(page.description).length <= DESCRIPTION_MAX, "pageMetadata clamps any page's description");
});

test("area titles put the place first, in the words people search with", () => {
  assert.equal(areaSearchTitle("Lambeth", "lad", "London"), "Lambeth, London: house prices, crime and schools");
  assert.equal(areaSearchTitle("Clapham South · SW4", "msoa", "London"), "Clapham South · SW4: house prices, crime and schools");
  assert.equal(areaSearchTitle("City of London · EC1A", "lsoa", ""), "City of London · EC1A: house prices, crime and schools");
  for (const name of LONG_NAMES) {
    for (const carrier of ["lad", "msoa", "lsoa"] as const) {
      const title = renderedTitle(areaSearchTitle(name, carrier, "London"));
      assert.ok(title.startsWith(name), title);
      const description = areaSearchDescription(name, carrier, "London", carrier === "lsoa" ? "£11,100/m²" : null);
      assert.ok(description.startsWith(name), description);
      assert.ok(description.length <= DESCRIPTION_MAX, `${description.length}: ${description}`);
      assert.match(description, /house prices, crime, schools/, `what the page holds always fits: ${description}`);
    }
  }
  assert.equal(areaSearchDescription("Lambeth", "lad", "London"),
    "Lambeth, London: is it a good place to live? See house prices, crime, schools, deprivation and income, and every area inside it.");
  assert.match(areaSearchDescription("Kingston upon Hull, City of", "lad", "Yorkshire and The Humber"), /^Kingston upon Hull, City of, Yorkshire and The Humber: house prices/);
  assert.match(areaSearchDescription("Bristol", "lad", "South West"), /^Bristol, South West: /);
});

test("school titles keep the name and Ofsted standing within 60 characters; the description within 155", () => {
  for (const urn of ["100001", "100002"]) {
    const card = demoSchoolCard(urn)!;
    const title = renderedTitle(schoolTitle(card));
    assert.ok(title.length <= TITLE_MAX, title);
    assert.ok(title.startsWith(card.school.name), title);
    assert.match(title, /Ofsted/);
    assert.ok(schoolDescription(card).length <= DESCRIPTION_MAX, schoolDescription(card));
  }
});

test("canonicals are the page's own path, never its query", () => {
  const page = pageMetadata({ title: "W5 1AA house prices, Hanger Hill East", description: "d", path: "/postcode/W5-1AA" });
  assert.deepEqual(page.alternates, { canonical: "/postcode/W5-1AA" });
  assert.equal((page.openGraph as { url: string }).url, "/postcode/W5-1AA");
  // The static pages that once had none now set one through pageMetadata.
  for (const [file, path] of [["about", "/about"], ["bot", "/bot"], ["feedback", "/feedback"], ["privacy/legitimate-interests", "/privacy/legitimate-interests"]]) {
    const source = readFileSync(new URL(`../src/app/${file}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`pageMetadata\\(\\{[\\s\\S]*path: "${path.replace(/\//g, "\\/")}"`), file);
  }
});

test("BreadcrumbList mirrors the visible crumbs, every item an absolute URL, the last this page", () => {
  const raw = breadcrumbJsonLd("https://x.test", [
    { label: "London", href: "/area/london" }, { label: "Lambeth", href: "/area/lad/E09000022" }, { label: "Brixton", href: null },
  ], "/area/msoa/E02000617")!;
  const data = JSON.parse(raw);
  assert.equal(data["@context"], "https://schema.org");
  assert.equal(data["@type"], "BreadcrumbList");
  assert.deepEqual(data.itemListElement.map((item: { position: number }) => item.position), [1, 2, 3]);
  assert.deepEqual(data.itemListElement.map((item: { item: string }) => item.item),
    ["https://x.test/area/london", "https://x.test/area/lad/E09000022", "https://x.test/area/msoa/E02000617"]);
  assert.equal(breadcrumbJsonLd("https://x.test", [{ label: "Only", href: null }], "/x"), null, "a lone crumb is no trail");
});

test("a local authority is an AdministrativeArea; a 0,0 point is never published", () => {
  const lad = JSON.parse(placeJsonLd("https://x.test", { name: "Lambeth", path: "/area/lad/E09000022", description: "d", administrative: true }));
  assert.equal(lad["@type"], "AdministrativeArea");
  assert.equal(ukPoint(0, 0), null);
  assert.deepEqual(ukPoint(51.5, -0.1), { latitude: 51.5, longitude: -0.1 });
  const postcode = JSON.parse(addressJsonLd("https://x.test", {
    type: "Place", name: "W5 1AA", path: "/postcode/W5-1AA", postcode: "W5 1AA", latitude: 0, longitude: 0, area: null,
  }));
  assert.equal("geo" in postcode, false, "the live W5 1AA page published 0,0");
});

test("sitemap entries: absolute https URLs, a data page's lastmod the day of its release, fixed pages none", () => {
  assert.equal(releaseDate("rel-202610280650-prices-england"), "2026-10-28");
  assert.equal(releaseDate("demo"), null);
  const entries = sitemapEntries("https://getcloseknit.com", ["/about", "/area/lad/E09000022", "/school/100000", "/schools?borough=lambeth", "/guide/crime"],
    "rel-202610280650-prices-england");
  assert.ok(entries.every((entry) => entry.url.startsWith("https://getcloseknit.com/")));
  assert.deepEqual(entries.map((entry) => entry.lastModified ?? null), [null, "2026-10-28", "2026-10-28", "2026-10-28", null]);
  assert.ok(sitemapEntries("https://x.test", ["/area/lad/E09000022"], null).every((entry) => !("lastModified" in entry)));
});

test("the sitemap lists each council's schools list and never a noindex page", () => {
  const paths = sitemapPaths([{ geographyId: "uk:lad:E09000022" }], undefined, ["100000"], [], [], ["lambeth", "barking-and-dagenham"]);
  for (const path of ["/schools", "/schools?borough=lambeth", "/schools?borough=barking-and-dagenham", "/school/100000"]) assert.ok(paths.includes(path), path);
  for (const noindex of ["/brief", "/compare", "/save-listing", "/civic"]) assert.ok(!paths.some((path) => path.startsWith(noindex)), noindex);
  assert.ok(paths.every((path) => !path.startsWith("/?") && !path.startsWith("/go/")), "never a crawl trap robots.txt keeps out");
  assert.ok(paths.length <= SITEMAP_LIMIT);
});

test("search and AI crawlers are told by their user agent; people are not", () => {
  for (const agent of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0 Safari/537.36",
    "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
  ]) assert.ok(isCrawler(agent), agent);
  for (const agent of [null, "", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"]) {
    assert.ok(!isCrawler(agent), String(agent));
  }
});

test("a page that did not load is a 500 for crawlers on every page type that has one", () => {
  for (const file of ["area/[carrier]/[code]/page.tsx", "area/[carrier]/[code]/places/page.tsx", "school/[urn]/page.tsx",
    "property/[uprn]/page.tsx", "postcode/[code]/homes/page.tsx", "postcode/[code]/page.tsx"]) {
    const source = readFileSync(new URL(`../src/app/${file}`, import.meta.url), "utf8");
    assert.match(source, /unavailablePage\(/, file);
    assert.doesNotMatch(source, /<PageUnavailable /, file);
  }
  for (const file of ["../src/app/sector/[slug]/page.tsx", "../src/app/area/[carrier]/[code]/pack/page.tsx", "../src/components/borough-page.tsx"]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /retryLaterForCrawlers\(/, file);
  }
});
