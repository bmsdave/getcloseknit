import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { RANKING_TILES, rankingBySlug, rankingForLayer, rankingMapHref, rankingPairSwitch, tileGoodPair } from "../src/lib/area-pages";
import { savedMapHref } from "../src/lib/map-state";
import { currentLink, isNavGroup, SITE_NAV, SITE_NAV_FOOTER, SITE_NAV_GROUPS, siteNavHrefs, siteNavLinks } from "../src/lib/site-nav";
import { TOOLS } from "../src/lib/tools";

const APP = join(import.meta.dirname, "../src/app");

/** The app/**\/page.tsx a path is served by: a literal folder first, else one [param] folder. */
function pageFor(path: string): string | null {
  let dir = APP;
  for (const segment of path.split("/").filter(Boolean)) {
    if (existsSync(join(dir, segment))) { dir = join(dir, segment); continue; }
    const dynamic = readdirSync(dir).find((name) => /^\[[^.\]]+\]$/.test(name));
    if (!dynamic) return null;
    dir = join(dir, dynamic);
  }
  const page = join(dir, "page.tsx");
  return existsSync(page) ? page : null;
}

test("every ≡ menu link opens a page of this app", () => {
  for (const href of siteNavHrefs()) {
    const path = new URL(href, "https://example.test").pathname;
    assert.ok(pageFor(path), `${href} has no app/**/page.tsx`);
  }
});

test("ranking links name a ranking that exists", () => {
  for (const href of siteNavHrefs().filter((entry) => entry.startsWith("/rankings/"))) {
    assert.ok(rankingBySlug(href.slice("/rankings/".length)), href);
  }
});

test("the menu reaches the rankings, schools and agents, and keeps the legal test ids", () => {
  const top = (label: string) => siteNavLinks().find((link) => link.label === label)?.href;
  assert.equal(top("Rankings"), "/rankings");
  assert.equal(top("Schools"), "/schools");
  assert.equal(top("AI agents"), "/agents");
  assert.deepEqual(SITE_NAV_FOOTER.map((link) => link.testId), ["privacy-link", "terms-link", "feedback-link"]);
});

test("menu v5: five plain links, then Tools and Learn as folds (owner board 2026-10-20)", () => {
  assert.deepEqual(SITE_NAV.map((entry) => entry.label),
    ["Find a place", "My match", "Rankings", "Schools", "AI agents", "Tools", "Learn"]);
  assert.deepEqual(SITE_NAV.filter((entry) => !isNavGroup(entry)).map((entry) => !isNavGroup(entry) && entry.href),
    ["/", "/?layer=personal-match", "/rankings", "/schools", "/agents"]);
  assert.deepEqual(SITE_NAV_GROUPS.map((group) => [group.label, group.links.map((link) => link.label)]), [
    ["Tools", ["Check a home", "Stamp duty", "Mortgage rates", "Buy-to-let"]],
    ["Learn", ["Guide", "Boroughs", "About"]],
  ]);
  // No duplicates in one menu; gone: Search (the pill), Explore, All tools, Glossary (in the Guide), Teams (in About).
  const hrefs = siteNavHrefs();
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const gone of ["/explore", "/tools", "/glossary", "/teams"]) assert.ok(!hrefs.includes(gone), gone);
});

test("Back to the map returns to the saved view, inventing no camera", () => {
  assert.equal(savedMapHref(null), "/");
  const back = new URLSearchParams(savedMapHref("lat=51.5&lng=-0.1&zoom=12.6&layer=crime&selected=uk%3Alsoa%3AE01000001").slice(2));
  assert.equal(back.get("layer"), "crime");
  assert.equal(back.get("zoom"), "12.6");
  assert.equal(back.get("selected"), "uk:lsoa:E01000001");
  const unsettled = new URLSearchParams(savedMapHref("layer=crime&selected=uk%3Alsoa%3AE01000001").slice(2));
  assert.equal(unsettled.get("layer"), "crime");
  assert.equal(unsettled.has("zoom"), false);
  assert.equal(unsettled.has("lat"), false);
});

test("a layer's Top 10 opens its own ranking on its good end, and only when it has one", () => {
  // v4 Task 42: least crime, cheapest first.
  assert.equal(rankingForLayer("crime"), "/rankings/lowest-crime");
  assert.equal(rankingForLayer("price-per-square-metre"), "/rankings/least-expensive");
  assert.equal(rankingForLayer("typical-price-flat"), "/rankings/lowest-flat-prices");
  assert.equal(rankingForLayer("noise"), null);
  assert.equal(rankingForLayer("personal-match"), null);
  const href = rankingForLayer("typical-price-flat");
  assert.ok(href && pageFor(href));
  // Deprivation (owner decision 2026-10-17) and income (2026-10-18) rank like any layer; income has no good end.
  assert.equal(rankingForLayer("income"), "/rankings/highest-income");
  assert.equal(rankingForLayer("social-renting"), "/rankings/most-social-renting");
  assert.equal(rankingForLayer("deprivation"), "/rankings/least-deprived");
});

test("rankings tiles open on the good end and a ranking page switches Most | Least (v4 Task 42)", () => {
  const opens = (id: string) => {
    const tile = RANKING_TILES.find((entry) => entry.id === id)!;
    return tile.slugs[tileGoodPair(tile)][0];
  };
  assert.equal(opens("crime"), "lowest-crime");
  assert.equal(opens("price"), "least-expensive");
  assert.equal(opens("typical"), "lowest-flat-prices");
  assert.equal(opens("deprivation"), "least-deprived");
  // No good end: income and social renting keep their first choice; a tile without a pair has one.
  assert.equal(opens("income"), "highest-income");
  assert.equal(opens("social-renting"), "most-social-renting");
  assert.equal(opens("gyms"), "most-gyms");

  assert.deepEqual(rankingPairSwitch("highest-crime"), {
    label: "Recorded crime",
    options: [{ label: "Most", slug: "highest-crime", current: true }, { label: "Least", slug: "lowest-crime", current: false }],
  });
  assert.deepEqual(rankingPairSwitch("lowest-semi-detached-prices")?.options.map((option) => [option.slug, option.current]),
    [["highest-semi-detached-prices", false], ["lowest-semi-detached-prices", true]]);
  assert.equal(rankingPairSwitch("lowest-semi-detached-prices")?.label, "Typical semi price");
  assert.equal(rankingPairSwitch("most-gyms"), null);
});

test("a ranking row's On map keeps the ranking's layer (v4 Task 42)", () => {
  const crime = rankingBySlug("lowest-crime")!;
  const gyms = rankingBySlug("most-gyms")!;
  assert.ok(crime.kind === "metric" && gyms.kind === "lens");
  assert.equal(rankingMapHref(crime, "uk:msoa:E02000001"), "/?selected=uk%3Amsoa%3AE02000001&layer=crime");
  // A lens has no map layer of its own: the area only.
  assert.equal(rankingMapHref(gyms, "uk:msoa:E02000001"), "/?selected=uk%3Amsoa%3AE02000001");
});

test("menu tool names are the tool tabs' names, and the page shown is marked (v4 Tasks 46, 50)", () => {
  const tools = SITE_NAV_GROUPS.find((group) => group.id === "tools")!;
  for (const link of tools.links) {
    const tool = TOOLS.find((entry) => link.href === `/tools/${entry.slug}`);
    assert.equal(link.label, tool?.label, link.href);
  }
  assert.equal(currentLink("/")?.label, undefined);
  assert.equal(currentLink("/tools/investor")?.label, "Buy-to-let");
  assert.equal(currentLink("/guide/reading-the-map")?.label, "Guide");
  assert.equal(currentLink("/rankings/lowest-crime")?.label, "Rankings");
  assert.equal(currentLink("/area/london")?.label, "Boroughs");
  assert.equal(currentLink("/schools")?.label, "Schools");
  assert.equal(currentLink("/school/100001")?.label, "Schools");
  assert.equal(currentLink("/agents/chatgpt")?.label, "AI agents");
  assert.equal(currentLink("/area/msoa/E02000001"), null);
  assert.equal(currentLink("/guidebook"), null);
});
