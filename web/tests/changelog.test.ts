import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  entryHtml, entryLinks, formatEntryDate, isoWeek, mastodonHost, mastodonShareUrl, parseEntry, parseInline, postText,
  rssXml, shareUrls, sortEntries, withoutLinks,
} from "../src/lib/changelog";
import { CHANGELOG_DIR, loadChangelog } from "../src/lib/changelog-files";
import { sitemapPaths } from "../src/lib/seo";

const origin = "https://getcloseknit.com";

function file({ head = "", body = "- One.\n- Two.\n- Three.\n" } = {}): string {
  return `---\ndate: 2026-11-03\ntitle: A week\nslug: a-week\n${head}---\n${body}`;
}

test("an entry parses its frontmatter, number and bullets", () => {
  const entry = parseEntry(file({
    head: "number:\n  value: 296\n  label: local authorities\n  source: Close Knit, England page\n  url: /area/england\n  parts: South East 64; North East 12\nnext: \"More maps\"\n",
    body: "- **Open.** No sign-in. [Open the map](/)\n- Two [A](/a) · [B](/b)\n- Three.\n",
  }), "2026-11-03-a-week.md");
  assert.deepEqual([entry.date, entry.title, entry.slug, entry.next], ["2026-11-03", "A week", "a-week", "More maps"]);
  assert.deepEqual(entry.number, {
    value: "296", label: "local authorities", source: "Close Knit, England page", url: "/area/england",
    parts: [{ name: "South East", value: 64 }, { name: "North East", value: 12 }],
  });
  assert.deepEqual(entry.bullets[0], [
    { kind: "bold", text: "Open." }, { kind: "text", text: " No sign-in. " }, { kind: "link", text: "Open the map", href: "/" },
  ]);
  assert.deepEqual(entryLinks(entry).map((link) => link.href), ["/", "/a", "/b"]);
  assert.deepEqual(withoutLinks(entry.bullets[1]), [{ kind: "text", text: "Two " }]);
});

test("number and next are optional", () => {
  const entry = parseEntry(file(), "2026-11-03-a-week.md");
  assert.equal(entry.number, null);
  assert.equal(entry.next, null);
});

test("the build checks reject a bad entry", () => {
  const bad: [string, string, RegExp][] = [
    ["no frontmatter", "- a\n- b\n- c\n", /frontmatter/],
    ["missing title", "---\ndate: 2026-11-03\nslug: a-week\n---\n- a\n- b\n- c\n", /title is required/],
    ["bad date", file().replace("2026-11-03", "3 Nov 2026"), /date is YYYY-MM-DD/],
    ["bad slug", file().replace("slug: a-week", "slug: A Week"), /slug/],
    ["two bullets", file({ body: "- a\n- b\n" }), /3 to 5 bullets/],
    ["six bullets", file({ body: "- a\n- b\n- c\n- d\n- e\n- f\n" }), /3 to 5 bullets/],
    ["a half number", file({ head: "number:\n  value: 1\n  label: x\n" }), /together, or none/],
    ["off-site link", file({ body: "- [x](https://example.com)\n- b\n- c\n" }), /stay on the site/],
    ["prose line", file({ body: "Hello\n- a\n- b\n- c\n" }), /bullets/],
  ];
  for (const [name, source, error] of bad) assert.throws(() => parseEntry(source, "2026-11-03-a-week.md"), error, name);
  assert.throws(() => parseEntry(file(), "2026-11-04-a-week.md"), /file name is 2026-11-03-a-week\.md/);
  assert.throws(() => parseInline("[x](//evil.test)"), /stay on the site/);
});

test("entries sort newest first and a slug is used once", () => {
  const one = parseEntry(file(), "2026-11-03-a-week.md");
  const older = { ...one, date: "2026-10-27", slug: "older" };
  assert.deepEqual(sortEntries([older, one]).map((entry) => entry.slug), ["a-week", "older"]);
  assert.throws(() => sortEntries([one, { ...one }]), /used twice/);
});

test("weeks and dates read as on the board", () => {
  assert.equal(isoWeek("2026-10-27"), 44);
  assert.equal(isoWeek("2026-01-01"), 1);
  assert.equal(isoWeek("2027-01-01"), 53);
  assert.equal(formatEntryDate("2026-10-27"), "27 Oct 2026");
});

test("the RSS feed is RSS 2.0 with one escaped item per entry, newest 20", () => {
  const entry = parseEntry(file({
    head: "number:\n  value: 296\n  label: local authorities\n  source: England page\n  url: /area/england\n",
    body: "- **A & B.** <x> [Map](/?layer=a&b=1)\n- Two.\n- Three.\n",
  }), "2026-11-03-a-week.md");
  const xml = rssXml([entry], origin);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0" xmlns:atom="http:\/\/www.w3.org\/2005\/Atom">/);
  assert.match(xml, /<atom:link href="https:\/\/getcloseknit.com\/changelog\/rss.xml" rel="self" type="application\/rss\+xml"\/>/);
  assert.match(xml, /<link>https:\/\/getcloseknit.com\/changelog<\/link>/);
  assert.equal(xml.match(/<item>/g)?.length, 1);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/getcloseknit.com\/changelog\/a-week<\/guid>/);
  assert.match(xml, /<pubDate>Tue, 03 Nov 2026 00:00:00 GMT<\/pubDate>/);
  // The description is HTML, escaped once more for XML; links are absolute.
  assert.ok(!/<x>/.test(xml), "raw markup is escaped");
  assert.match(xml, /&lt;strong&gt;A &amp;amp; B\.&lt;\/strong&gt;/);
  assert.match(entryHtml(entry, origin), /href="https:\/\/getcloseknit.com\/\?layer=a&amp;b=1"/);
  assert.match(entryHtml(entry, origin), /Number of the week: <strong>296<\/strong> local authorities/);
  const many = Array.from({ length: 25 }, (_, i) => ({ ...entry, slug: `s-${i}` }));
  assert.equal(rssXml(many, origin).match(/<item>/g)?.length, 20);
  assert.ok(!rssXml([], origin).includes("<item>"));
});

test("share links: X, Bluesky and the reader's Mastodon server, no Meta", () => {
  const url = `${origin}/changelog/a-week`;
  const links = shareUrls("Week 45: A week.", url);
  assert.ok(links.x.startsWith("https://x.com/intent/post?text=Week%2045"));
  assert.ok(links.x.endsWith(`&url=${encodeURIComponent(url)}`));
  assert.ok(links.bluesky.startsWith("https://bsky.app/intent/compose?text="));
  assert.ok(decodeURIComponent(links.bluesky).endsWith(url));
  assert.ok(!JSON.stringify(links).match(/facebook|instagram|threads|whatsapp|meta\./i));
  assert.equal(mastodonHost(" https://Fosstodon.org/@me "), "fosstodon.org");
  assert.equal(mastodonHost("@me@mastodon.social"), "mastodon.social");
  assert.equal(mastodonHost("not a server"), null);
  assert.equal(mastodonHost("localhost"), null);
  assert.equal(mastodonShareUrl("mastodon.social", "Hi", url), `https://mastodon.social/share?text=${encodeURIComponent(`Hi ${url}`)}`);
});

test("the real entries parse; the first is the public launch with its number", () => {
  const entries = loadChangelog();
  assert.ok(entries.length >= 1);
  const launch = entries.find((entry) => entry.slug === "close-knit-is-public");
  assert.ok(launch, "first entry");
  assert.equal(launch.date, "2026-10-27");
  assert.equal(launch.number?.value, "296");
  assert.equal(launch.number?.parts.reduce((sum, part) => sum + part.value, 0), 296);
  assert.equal(launch.number?.parts.length, 9);
  assert.match(JSON.stringify(launch.bullets), /submitted to the Claude directory and 30\+ catalogues/);
  assert.ok(!JSON.stringify(launch.bullets).includes("listed in"));
  assert.equal(postText(launch), "Week 44: Close Knit is public. 296 local authorities with area data, in 9 regions.");
  assert.ok(CHANGELOG_DIR.endsWith(join("content", "changelog")));
});

test("loadChangelog reads a folder of entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "changelog-"));
  writeFileSync(join(dir, "2026-11-03-a-week.md"), file());
  writeFileSync(join(dir, "2026-10-27-older.md"), file().replace("2026-11-03", "2026-10-27").replace("a-week", "older"));
  writeFileSync(join(dir, "README.txt"), "not an entry");
  assert.deepEqual(loadChangelog(dir).map((entry) => entry.slug), ["a-week", "older"]);
});

test("the sitemap lists /changelog and every entry", () => {
  const paths = sitemapPaths([], undefined, [], [], ["close-knit-is-public"]);
  assert.ok(paths.includes("/changelog"));
  assert.ok(paths.includes("/changelog/close-knit-is-public"));
  assert.ok(sitemapPaths([]).includes("/changelog"), "the list page even before any entry");
});
