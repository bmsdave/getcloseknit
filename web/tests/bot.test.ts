import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BOT_USER_AGENT } from "../src/lib/bot";

test("the /bot page names the same user agent the crawler sends", () => {
  const python = readFileSync(
    new URL("../../pipelines/area-analytics-ingest/area_analytics/agency_crawl/fetch.py", import.meta.url), "utf8");
  const match = python.match(/^USER_AGENT = "([^"]+)"$/m);
  assert.ok(match, "fetch.py defines USER_AGENT");
  assert.equal(BOT_USER_AGENT, match[1]);
  assert.equal(BOT_USER_AGENT, "CloseKnitBot/1.0 (+https://getcloseknit.com/bot)");
});

test("the /bot page is static, shows the user agent and builds its opt-out link from contact.ts", () => {
  const source = readFileSync(new URL("../src/app/bot/page.tsx", import.meta.url), "utf8");
  assert.match(source, /BOT_USER_AGENT/);
  assert.match(source, /contactMailto\(/);
  assert.ok(!source.includes("force-dynamic"), "no request-time rendering");
  assert.ok(!/fetch\(|fetchApi/.test(source), "no data fetches");
});
