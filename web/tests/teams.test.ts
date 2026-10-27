import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EXPENSIVE_COST, RATE_LIMITS } from "../src/lib/teams-limits";
import { sitemapPaths } from "../src/lib/seo";

const PERIOD_KEY = { minute: "minute", hour: "hour", day: "day" } as const;

test("/teams states the rate-limit defaults of api/area_api/ratelimit.py", () => {
  const source = readFileSync(new URL("../../api/area_api/ratelimit.py", import.meta.url), "utf8");
  const block = /DEFAULT_LIMITS = \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  const defaults = Object.fromEntries([...block.matchAll(/"(\w+)": "([^"]+)"/g)].map(([, name, rates]) => [name, rates]));
  assert.deepEqual(Object.keys(defaults).sort(), RATE_LIMITS.map((row) => row.id).sort());
  for (const row of RATE_LIMITS) {
    const windows = Object.fromEntries(defaults[row.id].split(",").map((part: string) => {
      const [amount, period] = part.split("/");
      return [period, Number(amount)];
    }));
    for (const period of Object.keys(PERIOD_KEY) as (keyof typeof PERIOD_KEY)[]) {
      assert.equal(row[period], windows[period], `${row.id} per ${period}`);
    }
  }
  assert.match(source, new RegExp(`EXPENSIVE: Policy = \\("default", ${EXPENSIVE_COST}\\)`));
});

test("teams live in About (v3 Fix 17): /about is in the sitemap, /teams only redirects", () => {
  assert.ok(sitemapPaths([]).includes("/about"));
  assert.ok(!sitemapPaths([]).includes("/teams"));
});
