import assert from "node:assert/strict";
import test from "node:test";

import { GUIDE_ARTICLES, GUIDE_GROUPS } from "../src/components/guide/articles";
import { METRICS, PERSONAL_MATCH_DEFINITION } from "../src/lib/fixtures";
import { LEGACY_ANCHORS, legacyAnchorPath } from "../src/lib/guide-routes";
import { GUIDE_SLUGS } from "../src/lib/guide-slugs";
import { HELP } from "../src/lib/help-texts";

const slugs = GUIDE_SLUGS as readonly string[];

test("every guide slug has a complete article with a one-line answer", () => {
  for (const slug of GUIDE_SLUGS) {
    const article = GUIDE_ARTICLES[slug];
    assert.ok(article, `${slug}: no article`);
    assert.ok(article.title && article.caption && article.example && article.how && article.finePrint, `${slug}: incomplete`);
    assert.ok(GUIDE_GROUPS.includes(article.group), `${slug}: unknown group`);
    assert.ok(article.answer.split(/\s+/).length <= 30, `${slug}: answer over 30 words`);
  }
  assert.deepEqual(Object.keys(GUIDE_ARTICLES).sort(), [...GUIDE_SLUGS].sort());
});

test("every help text links to an existing article", () => {
  for (const [id, help] of Object.entries(HELP)) {
    assert.ok(GUIDE_ARTICLES[help.guide], `${id}: no article for ${help.guide}`);
  }
});

test("every metric's read-more link is a guide article", () => {
  for (const metric of [...METRICS, PERSONAL_MATCH_DEFINITION]) {
    const match = /^\/guide\/([a-z0-9-]+)$/.exec(metric.methodologyPath);
    assert.ok(match && slugs.includes(match[1]), `${metric.id}: ${metric.methodologyPath}`);
  }
});

test("old /methodology anchors map to their article", () => {
  assert.equal(legacyAnchorPath("#real-data"), "/guide/demo-vs-real");
  assert.equal(legacyAnchorPath("#personal-match"), "/guide/your-match");
  assert.equal(legacyAnchorPath("#stock-value"), "/guide/stock-value");
  assert.equal(legacyAnchorPath("#sold-prices"), "/guide/sold-prices");
  assert.equal(legacyAnchorPath("#price-per-square-metre"), "/guide/price-per-m2");
  assert.equal(legacyAnchorPath("#crime"), "/guide/crime");
  for (const metric of METRICS) assert.ok(legacyAnchorPath(`#${metric.id}`), `${metric.id} has no anchor`);
  for (const slug of Object.values(LEGACY_ANCHORS)) assert.ok(slugs.includes(slug));
  assert.equal(legacyAnchorPath(""), null);
  assert.equal(legacyAnchorPath("#nope"), null);
  assert.equal(legacyAnchorPath("#toString"), null);
});

const NEW_TOPICS: Record<string, string> = {
  "people-and-homes": "Living here",
  "clean-air": "Living here",
  "getting-around": "Living here",
  "local-government": "Living here",
  "local-market": "Prices",
  "energy-rating": "Buying a home",
  "stamp-duty": "Buying a home",
  "mortgage-rates": "Buying a home",
  "buy-to-let": "Buying a home",
};

test("the merged tracks' topics have articles in their index group", () => {
  for (const [slug, group] of Object.entries(NEW_TOPICS)) {
    assert.ok(slugs.includes(slug), `${slug}: not a guide slug`);
    assert.equal(GUIDE_ARTICLES[slug as keyof typeof GUIDE_ARTICLES].group, group, slug);
  }
});

function expectedGuide(id: string): string | null {
  if (id.startsWith("people-")) return "people-and-homes";
  if (id.startsWith("places-")) return "getting-around";
  if (id.startsWith("market-")) return "local-market";
  if (id === "property-facts") return "energy-rating";
  if (["civic-place", "civic-codes", "council-tax", "representatives"].includes(id)) return "local-government";
  if (id.startsWith("sdlt-")) return "stamp-duty";
  if (id.startsWith("mortgage-rates")) return "mortgage-rates";
  if (id.startsWith("btl-")) return "buy-to-let";
  return null;
}

test("help texts of the merged tracks point at their own article", () => {
  let checked = 0;
  for (const [id, help] of Object.entries(HELP)) {
    const slug = expectedGuide(id);
    if (slug === null) continue;
    assert.equal(help.guide, slug, id);
    checked += 1;
  }
  assert.ok(checked >= 30, `only ${checked} help texts checked`);
});

test("each map layer's article opens that layer, and only those", async () => {
  const { GLOSSARY_GUIDE, guideMapPath, METRIC_GUIDE, nextGuideSlug } = await import("../src/lib/guide-routes");
  assert.equal(guideMapPath("crime"), "/?layer=crime");
  assert.equal(guideMapPath("price-per-m2"), "/?layer=price-per-square-metre");
  assert.equal(guideMapPath("getting-around"), "/?layer=station-access");
  assert.equal(guideMapPath("your-match"), "/?layer=personal-match");
  assert.equal(guideMapPath("stamp-duty"), null);
  for (const [metricId, slug] of Object.entries(METRIC_GUIDE)) assert.ok(guideMapPath(slug), `${metricId}: ${slug} has no layer link`);
  assert.equal(nextGuideSlug(GUIDE_SLUGS[0]), GUIDE_SLUGS[1]);
  assert.equal(nextGuideSlug(GUIDE_SLUGS[GUIDE_SLUGS.length - 1]), null);
  for (const slug of Object.values(GLOSSARY_GUIDE)) assert.ok(slug && slugs.includes(slug), `glossary links to ${slug}`);
});

test("every article ends with a way to use it: its layer, its tool or the map", async () => {
  const { guideAction } = await import("../src/lib/guide-routes");
  for (const slug of GUIDE_SLUGS) {
    const action = guideAction(slug);
    assert.ok(action && action.href.startsWith("/") && action.label, `${slug} has no action`);
  }
  assert.deepEqual(guideAction("crime"), { href: "/?layer=crime", label: "See this on the map", kind: "map" });
  assert.equal(guideAction("stamp-duty").href, "/tools/stamp-duty");
  assert.equal(guideAction("buy-to-let").href, "/tools/investor");
  assert.equal(guideAction("home-cost").href, "/tools/check-a-home");
  assert.equal(guideAction("sold-prices").href, "/?layer=price-per-square-metre");
  assert.equal(guideAction("schools").href, "/rankings");
  assert.equal(guideAction("noise").href, "/?layer=noise");
  assert.deepEqual(guideAction("demo-vs-real"), { href: "/", label: "Open the map", kind: "map" });
});
