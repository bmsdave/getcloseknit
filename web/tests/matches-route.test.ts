import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST } from "../src/app/api/v1/matches/route";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { searchKey } from "../src/lib/match-search";

const ENV_KEY = "CLOSE_KNIT_API_URL";
const previousEnv = process.env[ENV_KEY];
const previousFetch = globalThis.fetch;

function restore() {
  if (previousEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = previousEnv;
  globalThis.fetch = previousFetch;
}

function post(body: string) {
  return POST(new NextRequest("http://web.test/api/v1/matches?mode=real&release=rel-1", { method: "POST", body }));
}

const PROFILE = searchKey(DEFAULT_PROFILE);

test("a body that is not a preference profile is a 400, before any upstream work", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8080";
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response("{}"); }) as typeof fetch;
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post(JSON.stringify({ schemaVersion: "preference-profile.v9" }))).status, 400);
  assert.equal(calls, 0);
});

// CUJ01 on prod (2026-10-19): the API restarting made the proxy's fetch throw, and the route answered 400
// "invalid-preference-profile" for a valid search, so the client dropped it instead of showing it was offline.
test("an API that cannot be reached is a 502, not the caller's 400", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8080";
  globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  const response = await post(PROFILE);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "match-service-unavailable" });
});

test("an API answer that is not JSON is a 502", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8080";
  globalThis.fetch = (async () => new Response("<html>bad gateway</html>", { status: 200 })) as typeof fetch;
  assert.equal((await post(PROFILE)).status, 502);
});

test("the API's own status passes through, and a valid search reaches it with the query", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8080";
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ detail: "No validated factor release is loaded" }), { status: 503 });
  }) as typeof fetch;
  assert.equal((await post(PROFILE)).status, 503);
  assert.deepEqual(urls, ["http://api:8080/api/v1/matches?mode=real&release=rel-1"]);
});
