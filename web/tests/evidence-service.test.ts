import assert from "node:assert/strict";
import test from "node:test";

import { clientHeaders, evidenceServiceUrl, fetchEvidence, fetchSharedEvidence, SHARED_EVIDENCE_TTL_MS } from "../src/lib/evidence-service";

const ENV_KEY = "CLOSE_KNIT_API_URL";
const previousEnv = process.env[ENV_KEY];
const previousFetch = globalThis.fetch;

function restore() {
  if (previousEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = previousEnv;
  globalThis.fetch = previousFetch;
}

test("evidence service is opt-in and trims the base URL", async (context) => {
  context.after(restore);
  delete process.env[ENV_KEY];
  assert.equal(evidenceServiceUrl(), null);
  process.env[ENV_KEY] = "http://api:8000///";
  assert.equal(evidenceServiceUrl(), "http://api:8000");
});

test("proxy forwards the abort signal and preserves status", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8000";
  const seen: { url?: string; signal?: AbortSignal | null } = {};
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.signal = init?.signal ?? null;
    return Response.json({ schemaVersion: "area-search.v1", results: [] }, { status: 200 });
  }) as typeof fetch;

  const controller = new AbortController();
  const upstream = await fetchEvidence<{ results: unknown[] }>(
    "/api/v1/search?q=E01000004",
    controller.signal,
  );

  assert.equal(seen.url, "http://api:8000/api/v1/search?q=E01000004");
  assert.equal(seen.signal, controller.signal);
  assert.equal(upstream.status, 200);
  assert.deepEqual((upstream.body as { results: unknown[] }).results, []);
});

test("unreachable service is an explicit 503, cancellation still throws", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8000";
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  const unreachable = await fetchEvidence("/api/v1/metrics", AbortSignal.timeout(1000));
  assert.equal(unreachable.status, 503);
  assert.equal((unreachable.body as { error: string }).error, "evidence-service-unreachable");

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    throw new DOMException("aborted", "AbortError");
  }) as typeof fetch;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchEvidence("/api/v1/metrics", controller.signal), /AbortError|aborted/);
});

test("the caller's address is forwarded as the first X-Forwarded-For hop, never invented", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8000";
  const seen: { headers?: Record<string, string> } = {};
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    seen.headers = init?.headers as Record<string, string>;
    return Response.json({}, { status: 200 });
  }) as typeof fetch;

  const controller = new AbortController();
  await fetchEvidence("/api/v1/metrics", {
    signal: controller.signal,
    headers: new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.2" }),
  });
  assert.equal(seen.headers?.["x-forwarded-for"], "203.0.113.5");

  await fetchEvidence("/api/v1/metrics", { signal: controller.signal, headers: new Headers() });
  assert.equal(seen.headers?.["x-forwarded-for"], undefined);

  assert.deepEqual(clientHeaders(new Headers({ "x-real-ip": "198.51.100.7" })), { "x-forwarded-for": "198.51.100.7" });
  assert.deepEqual(clientHeaders(new Headers()), {});
});

test("a release-wide answer is asked of the API once a minute, and only a 200 is kept", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8000";
  let calls = 0;
  let status = 503;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ n: calls }, { status });
  }) as typeof fetch;
  let clock = 0;
  const now = () => clock;
  const caller = { signal: AbortSignal.timeout(1000), headers: new Headers({ "x-forwarded-for": "203.0.113.9" }) };
  assert.equal((await fetchSharedEvidence("/api/v1/test-shared", caller, now)).status, 503);
  status = 200;
  const first = await fetchSharedEvidence<{ n: number }>("/api/v1/test-shared", caller, now);
  assert.equal(first.body.n, 2, "a failure is asked again");
  clock = SHARED_EVIDENCE_TTL_MS - 1;
  assert.equal((await fetchSharedEvidence<{ n: number }>("/api/v1/test-shared", caller, now)).body.n, 2);
  clock = SHARED_EVIDENCE_TTL_MS + 1;
  assert.equal((await fetchSharedEvidence<{ n: number }>("/api/v1/test-shared", caller, now)).body.n, 3);
  assert.equal(calls, 3);
});
