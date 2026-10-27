import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type Read = { path: string; status: number; ms: number };
type WarmUp = {
  WARM_PATHS: string[];
  SKIPPED_TEMPLATES: Record<string, string>;
  WARM_UP_AGENT: string;
  warm(origin: string, paths: readonly string[], options?: { concurrency?: number; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<Read[]>;
  summary(label: string, results: Read[], ms: number): string;
};
// @ts-expect-error: a plain .mjs script (the container runs it without a build)
const load = async () => (await import("../scripts/warm-up.mjs")) as WarmUp;

const APP = fileURLToPath(new URL("../src/app", import.meta.url));

/** Every page template under src/app ("/area/[carrier]/[code]"), route groups left out. */
function pageTemplates(dir = APP): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...pageTemplates(path));
    else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(entry.name)) {
      const segments = relative(APP, dir).split(sep).filter((segment) => segment && !/^\(.*\)$/.test(segment));
      found.push(`/${segments.join("/")}`);
    }
  }
  return found.sort();
}

/** Whether a URL's path is served by a template: [x] is one segment, [...x] and [[...x]] the rest. */
function matches(template: string, url: string): boolean {
  const path = url.split("?")[0];
  const pattern = template.split("/").map((segment) => {
    if (/^\[\[?\.\.\./.test(segment)) return ".*";
    if (/^\[.+\]$/.test(segment)) return "[^/]+";
    return segment.replace(/[.*+?^${}()|\\]/g, "\\$&");
  }).join("/");
  return new RegExp(`^${pattern || "/"}$`).test(path);
}

/** The most specific template for a URL: static segments win over dynamic ones, as Next routes them. */
function templateOf(templates: string[], url: string): string | undefined {
  const score = (template: string) => template.split("/").filter((segment) => segment && !segment.startsWith("[")).length;
  return templates.filter((template) => matches(template, url)).sort((a, b) => score(b) - score(a))[0];
}

test("the warm-up reads one URL for every page template under src/app", async () => {
  const { WARM_PATHS, SKIPPED_TEMPLATES } = await load();
  const templates = pageTemplates();
  assert.ok(templates.includes("/") && templates.includes("/area/[carrier]/[code]"), "the app's templates are found");
  const warmed = new Set(WARM_PATHS.map((url) => templateOf(templates, url)));
  const missing = templates.filter((template) => !warmed.has(template) && !(template in SKIPPED_TEMPLATES));
  assert.deepEqual(missing, [], `add a URL to WARM_PATHS (web/scripts/warm-up.mjs) for: ${missing.join(", ")}`);
  for (const template of Object.keys(SKIPPED_TEMPLATES)) assert.ok(templates.includes(template), `${template} is skipped but no longer exists`);
});

test("every warm-up URL is a page of the app, read once, and the area page warms each carrier", async () => {
  const { WARM_PATHS } = await load();
  const templates = pageTemplates();
  for (const url of WARM_PATHS) {
    assert.ok(url.startsWith("/"), `${url} is a path`);
    assert.ok(templateOf(templates, url), `${url} matches no page template`);
  }
  assert.equal(new Set(WARM_PATHS).size, WARM_PATHS.length, "no URL twice");
  for (const carrier of ["lsoa", "msoa", "lad"]) {
    assert.ok(WARM_PATHS.some((url) => url.startsWith(`/area/${carrier}/`) && templateOf(templates, url) === "/area/[carrier]/[code]"), carrier);
  }
});

test("warm reads every path at most `concurrency` at a time and never throws", async () => {
  const { warm, summary, WARM_UP_AGENT } = await load();
  let open = 0;
  let peak = 0;
  const seen: { url: string; agent: string | null; redirect: string | undefined }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, agent: new Headers(init?.headers).get("user-agent"), redirect: init?.redirect });
    open += 1;
    peak = Math.max(peak, open);
    await new Promise((resolve) => setTimeout(resolve, 5));
    open -= 1;
    if (url.endsWith("/down")) throw new Error("refused");
    return new Response("ok", { status: url.endsWith("/gone") ? 404 : 200 });
  }) as typeof fetch;
  const paths = ["/", "/a", "/b", "/c", "/gone", "/down", "/d"];
  const results = await warm("http://127.0.0.1:4181", paths, { concurrency: 3, fetchImpl });
  assert.equal(results.length, paths.length);
  assert.equal(peak, 3);
  assert.deepEqual(seen.map((read) => read.url).sort(), paths.map((path) => `http://127.0.0.1:4181${path}`).sort());
  assert.ok(seen.every((read) => read.agent === WARM_UP_AGENT && read.redirect === "manual"));
  const status = Object.fromEntries(results.map((read) => [read.path, read.status]));
  assert.equal(status["/"], 200);
  assert.equal(status["/gone"], 404);
  assert.equal(status["/down"], 0);
  assert.equal(summary("templates", results, 1234), "warm-up: templates 7 pages in 1234 ms; not 200: "
    + results.filter((read) => read.status !== 200).map((read) => `${read.path} ${read.status || "failed"}`).join(", "));
  assert.equal(
    summary("templates", [{ path: "/a", status: 200, ms: 1500 }, { path: "/b", status: 200, ms: 999 }, { path: "/c", status: 200, ms: 4200 }], 5000),
    "warm-up: templates 3 pages in 5000 ms; over 1 s: /c 4200 ms, /a 1500 ms",
  );
});
