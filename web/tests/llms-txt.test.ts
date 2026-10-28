import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GUIDE_SLUGS, guidePath } from "../src/lib/guide-slugs";
import { llmsTxt } from "../src/lib/llms-txt";
import { robotsRules, searchIndexable } from "../src/lib/seo";
import { TOOLS } from "../src/lib/tools";

const origin = "https://getcloseknit.com";
const guides = GUIDE_SLUGS.map((slug) => ({ path: guidePath(slug), title: `Title ${slug}` }));

test("llms.txt follows llmstxt.org: H1, blockquote summary, H2 sections of Markdown links", () => {
  const text = llmsTxt({ origin, guides, hasApi: true });
  const lines = text.split("\n");
  assert.match(lines[0], /^# \S/, "starts with an H1");
  assert.equal(lines.filter((line) => line.startsWith("# ")).length, 1, "one H1");
  assert.match(lines[2], /^> \S/, "a blockquote summary after the title");
  assert.ok(lines.filter((line) => line.startsWith("## ")).length >= 5, "H2 sections");
  const links = [...text.matchAll(/^- \[([^\]]+)\]\(([^)\s]+)\)(?:: .+)?$/gm)];
  assert.ok(links.length >= 40, `many links (${links.length})`);
  for (const [, name, url] of links) {
    assert.ok(name.trim(), "every link is named");
    assert.ok(url.startsWith(`${origin}/`), `absolute on the public origin: ${url}`);
  }
  const urls = new Set(links.map(([, , url]) => url));
  for (const path of ["/", "/guide", "/guide/glossary", "/tools", "/rankings", "/area/london", "/area/lad/E09000001", "/agents",
    "/privacy", "/terms", "/about", "/schools", "/rankings/top-secondary-progress-8", ...guides.map((guide) => guide.path), ...TOOLS.map((tool) => `/tools/${tool.slug}`)]) {
    assert.ok(urls.has(`${origin}${path}`), `links ${path}`);
  }
  assert.ok(!/\]\(https?:\/\/(localhost|127\.0\.0\.1)/.test(text), "no local address");
});

test("llms.txt without the evidence API leaves out the API conduct and optional sections", () => {
  const text = llmsTxt({ origin, guides, hasApi: false });
  assert.ok(!text.includes("## Conduct"));
  assert.ok(!text.includes("## Optional"));
  assert.ok(text.includes(`[AI agents](${origin}/agents)`));
  // Pages that only redirect now (v3 Fix 16/17) are not listed.
  for (const gone of ["/claude", "/explore", "/glossary)"]) assert.ok(!text.includes(`${origin}${gone}`), gone);
});

test("the route builds llms.txt from every guide article's title", () => {
  const route = readFileSync(new URL("../src/app/llms.txt/route.ts", import.meta.url), "utf8");
  assert.match(route, /GUIDE_ARTICLES\[slug\]\.title/);
  assert.match(route, /llmsTxt\(/);
});

test("only CLOSE_KNIT_ACCESS=public is indexable; robots.txt names the sitemap index only then", () => {
  assert.equal(searchIndexable("public"), true);
  assert.equal(searchIndexable(" public\n"), true);
  for (const access of [undefined, "", "private", "PUBLIC-ish"]) assert.equal(searchIndexable(access), false, String(access));
  const open = robotsRules(origin, true);
  assert.equal(open.sitemap, `${origin}/sitemap-index.xml`);
  assert.deepEqual(open.rules.disallow, ["/api/", "/mcp", "/?", "/go/"], "crawl traps: map states on / and click-outs");
  const closed = robotsRules(origin, false);
  assert.equal(closed.sitemap, undefined);
  assert.deepEqual(closed.rules.disallow, ["/api/", "/mcp"]);
  assert.equal(closed.rules.allow, "/", "pages stay crawlable so the noindex is seen");
});

test("Caddy sends the noindex header only for a private site", () => {
  const caddyfile = readFileSync(new URL("../../deploy/Caddyfile", import.meta.url), "utf8");
  const privateAccess = readFileSync(new URL("../../deploy/access-private.caddy", import.meta.url), "utf8");
  const publicAccess = readFileSync(new URL("../../deploy/access-public.caddy", import.meta.url), "utf8");
  // The server's own name (private sites) is never indexed; the public domain's blocks never send it.
  const sitesStart = caddyfile.indexOf("{$CLOSE_KNIT_SITES_HOST");
  const sitesBlock = caddyfile.slice(sitesStart, caddyfile.indexOf("\n}\n", sitesStart));
  assert.match(sitesBlock, /^\s*header X-Robots-Tag "noindex, nofollow"$/m);
  assert.ok(!/^\s*header X-Robots-Tag/m.test(caddyfile.replace(sitesBlock, "")));
  assert.ok(!/^\s*header X-Robots-Tag/m.test(publicAccess));
  assert.match(privateAccess, /^header X-Robots-Tag "noindex, nofollow"$/m);
  const compose = readFileSync(new URL("../../deploy/docker-compose.yml", import.meta.url), "utf8");
  assert.match(compose, /CLOSE_KNIT_ACCESS: \$\{CLOSE_KNIT_ACCESS:-private\}/, "the web container defaults stricter than Caddy: unset means noindex");
});
