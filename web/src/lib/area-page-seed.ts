/**
 * Server only: reads the area page's sections for its server render (the SEO rule). Each URL
 * goes through the same route handler the browser would call, in process, so demo fixtures and the
 * real API answer exactly as they would to the client. The viewer's address and the render's headers
 * (lib/server-render.ts) are forwarded, so the API charges the viewer one page view for the whole
 * render. Answers from the API are kept SEED_CACHE_TTL_MS per release: an area viewed again soon costs
 * the API nothing. A section that fails or times out is left out (and not kept) and the page reads it
 * after hydration; a 404 is kept as null ("not served here").
 */
import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import * as areaRoute from "@/app/api/v1/areas/[id]/route";
import * as civicRoute from "@/app/api/v1/areas/[id]/civic/route";
import * as councilTaxRoute from "@/app/api/v1/areas/[id]/council-tax/route";
import * as floodRoute from "@/app/api/v1/areas/[id]/flood/route";
import * as futureTransportRoute from "@/app/api/v1/areas/[id]/future-transport/route";
import * as healthRoute from "@/app/api/v1/areas/[id]/health/route";
import * as hmoRoute from "@/app/api/v1/areas/[id]/hmo/route";
import * as homeRoute from "@/app/api/v1/areas/[id]/home/route";
import * as hpiRoute from "@/app/api/v1/areas/[id]/hpi/route";
import * as kidsRoute from "@/app/api/v1/areas/[id]/kids/route";
import * as layersRoute from "@/app/api/v1/areas/[id]/layers/route";
import * as locationRoute from "@/app/api/v1/areas/[id]/location/route";
import * as marketRoute from "@/app/api/v1/areas/[id]/market/route";
import * as marketByTypeRoute from "@/app/api/v1/areas/[id]/market-by-type/route";
import * as mobileRoute from "@/app/api/v1/areas/[id]/mobile/route";
import * as natureRoute from "@/app/api/v1/areas/[id]/nature/route";
import * as noiseRoute from "@/app/api/v1/areas/[id]/noise/route";
import * as ownershipRoute from "@/app/api/v1/areas/[id]/ownership/route";
import * as peopleRoute from "@/app/api/v1/areas/[id]/people/route";
import * as pipelineRoute from "@/app/api/v1/areas/[id]/pipeline/route";
import * as placesRoute from "@/app/api/v1/areas/[id]/places/route";
import * as profileRoute from "@/app/api/v1/areas/[id]/profile/route";
import * as recentSalesRoute from "@/app/api/v1/areas/[id]/recent-sales/route";
import * as rentTrendRoute from "@/app/api/v1/areas/[id]/rent-trend/route";
import * as rentsRoute from "@/app/api/v1/areas/[id]/rents/route";
import * as safetyRoute from "@/app/api/v1/areas/[id]/safety/route";
import * as schoolsRoute from "@/app/api/v1/areas/[id]/schools/route";
import * as shortLetsRoute from "@/app/api/v1/areas/[id]/short-lets/route";
import * as standoutsRoute from "@/app/api/v1/areas/[id]/standouts/route";
import * as serviceHealthRoute from "@/app/api/v1/health/route";
import * as metricsRoute from "@/app/api/v1/metrics/route";
import type { MetricDefinition } from "./contracts";
import { evidenceServiceUrl } from "./evidence-service";
import type { AreaSafety } from "./area-safety";
import { areaSafetyPath } from "./area-safety";
import {
  areaSeedFollowUps, areaSeedPaths, FOOD_HYGIENE_METRIC, HEALTH_PATH, METRICS_PATH, PAGE_METRICS,
  type AreaSeedQuery, type SectionSeed,
} from "./section-seed";
import type { BatchPart } from "./section-batch";
import { beginRender, renderHeaders } from "./server-render";
import { TtlCache } from "./ttl-cache";

type AreaHandler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
type RootHandler = (request: NextRequest) => Promise<Response>;

/** /api/v1/areas/{id}[/part] → its route handler ("" is the area itself); every BATCH_PART has one. */
export const AREA_ROUTES: Record<BatchPart, AreaHandler> = {
  "": areaRoute.GET, civic: civicRoute.GET, "council-tax": councilTaxRoute.GET, flood: floodRoute.GET,
  "future-transport": futureTransportRoute.GET, health: healthRoute.GET, hmo: hmoRoute.GET, home: homeRoute.GET, hpi: hpiRoute.GET,
  kids: kidsRoute.GET, layers: layersRoute.GET, location: locationRoute.GET, market: marketRoute.GET, "market-by-type": marketByTypeRoute.GET,
  mobile: mobileRoute.GET, nature: natureRoute.GET, noise: noiseRoute.GET, ownership: ownershipRoute.GET, people: peopleRoute.GET,
  pipeline: pipelineRoute.GET, places: placesRoute.GET, profile: profileRoute.GET, "recent-sales": recentSalesRoute.GET,
  "rent-trend": rentTrendRoute.GET, rents: rentsRoute.GET, safety: safetyRoute.GET, schools: schoolsRoute.GET as AreaHandler,
  "short-lets": shortLetsRoute.GET, standouts: standoutsRoute.GET,
};
const ROOT_ROUTES: Record<string, RootHandler> = { [METRICS_PATH]: metricsRoute.GET, [HEALTH_PATH]: serviceHealthRoute.GET };
const AREA_URL = /^\/api\/v1\/areas\/([^/]+)(?:\/([a-z-]+))?$/;

/** Each read gives up after this; the page then reads that section itself. */
const SEED_TIMEOUT_MS = 2500;
/** Tests (and debugging) can ask for the client-only page, so route mocks in the browser still apply. */
export const SEED_OFF_HEADER = "x-close-knit-seed";
/** About 110 areas' worth of reads (18-22 each); demo fixtures are read in process and not kept. */
const SEED_CACHE_ENTRIES = 2000;
const SEED_CACHE_TTL_MS = 10 * 60_000;
export const seedCache = new TtlCache<unknown>(SEED_CACHE_ENTRIES, SEED_CACHE_TTL_MS);

/** One URL through its route handler: the JSON body, null for a 404, undefined to leave it to the client. */
async function readLocal(path: string, forwarded: Headers, timeoutMs = SEED_TIMEOUT_MS): Promise<unknown> {
  const url = new URL(path, "http://seed.local");
  const match = AREA_URL.exec(url.pathname);
  const area = match ? (AREA_ROUTES as Record<string, AreaHandler | undefined>)[match[2] ?? ""] : undefined;
  const root = ROOT_ROUTES[url.pathname];
  if (!area && !root) return undefined;
  try {
    const request = new NextRequest(url, { headers: forwarded, signal: AbortSignal.timeout(timeoutMs) });
    const response = area
      ? await area(request, { params: Promise.resolve({ id: decodeURIComponent(match![1]) }) })
      : await root(request);
    if (response.status === 404) return null;
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Only the definitions the page reads: the release's whole list is close to a megabyte. */
function trimMetrics(payload: unknown): unknown {
  const body = payload as { metrics?: MetricDefinition[] } | null;
  if (!body || !Array.isArray(body.metrics)) return payload;
  return { ...body, metrics: body.metrics.filter((metric) => PAGE_METRICS.includes(metric.id)) };
}

/** Food hygiene's evidence: the page reads its summary only (the timeline is the map's). */
function trimFoodHygiene(payload: unknown): unknown {
  const body = payload as { summary?: unknown } | null;
  return body && typeof body === "object" && "summary" in body ? { summary: body.summary } : payload;
}

/** The headers of one render's in-process reads: its id (one page view for the API) and the viewer's address. */
function renderReadHeaders(render: string, requestHeaders: Headers): Headers {
  const forwarded = new Headers(renderHeaders(render));
  for (const name of ["x-forwarded-for", "x-real-ip"]) {
    const value = requestHeaders.get(name);
    if (value) forwarded.set(name, value);
  }
  return forwarded;
}

/** A batch streams each section as it is read, so it can wait longer than a page render (which holds the HTML). */
export const BATCH_READ_TIMEOUT_MS = 10_000;

/**
 * One area view's section reads in one go (app/api/v1/sections/route.ts): each URL through its
 * route handler, all as one render, so the API charges the viewer one page view rather than one per section.
 * The URLs are checked by the caller (one area, BATCH_PARTS only). Streamed as NDJSON, one line per URL as
 * it is read ({url, body}, body null for a 404), so a slow section never holds back the rest; a read that
 * failed or timed out has no line and the browser reads it on its own.
 */
export function streamSections(paths: readonly string[], requestHeaders: Headers, timeoutMs = BATCH_READ_TIMEOUT_MS): ReadableStream<Uint8Array> {
  const forwarded = renderReadHeaders(randomUUID(), requestHeaders);
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      await Promise.all(paths.map(async (path) => {
        const body = await readLocal(path, forwarded, timeoutMs);
        if (body !== undefined) controller.enqueue(encoder.encode(`${JSON.stringify({ url: path, body })}\n`));
      }));
      controller.close();
    },
  });
}

/**
 * Every payload the default page shows for this neighbourhood, keyed by the URL its hook asks for.
 * Two rounds: the sections, then food hygiene (its period is in the metrics) and the crime line
 * (drawn only when the rate moved).
 */
export async function readAreaPageSeed(query: AreaSeedQuery, requestHeaders: Headers): Promise<SectionSeed> {
  if (requestHeaders.get(SEED_OFF_HEADER) === "off") return {};
  // Real mode with no evidence API here (a demo deployment opened with ?mode=real): the routes would
  // answer with fixtures, which real mode refuses; the page reads (and reports) for itself.
  if (query.mode === "real" && !evidenceServiceUrl()) return {};
  const forwarded = renderReadHeaders(beginRender(), requestHeaders);
  const keep = evidenceServiceUrl() !== null;
  const seed: Record<string, unknown> = {};
  const asked = new Set<string>();
  const readOne = async (path: string) => {
    const key = `${query.mode}|${query.release}|${path}`;
    const kept = keep ? seedCache.get(key) : undefined;
    if (kept !== undefined) return kept;
    const body = await readLocal(path, forwarded);
    if (keep && body !== undefined) seedCache.set(key, body);
    return body;
  };
  const read = async (paths: readonly string[]) => {
    paths.forEach((path) => asked.add(path));
    const bodies = await Promise.all(paths.map(readOne));
    paths.forEach((path, index) => { if (bodies[index] !== undefined) seed[path] = bodies[index]; });
  };
  await read(areaSeedPaths(query));
  const metrics = (seed[METRICS_PATH] as { metrics?: MetricDefinition[] } | null | undefined)?.metrics ?? null;
  const safety = seed[areaSafetyPath(query.geographyId)] as AreaSafety | null | undefined;
  const followUps = areaSeedFollowUps(query, metrics, !!safety?.trend && !safety.trend.stable).filter((path) => !(path in seed));
  await read(followUps);
  const missing = [...asked].filter((path) => !(path in seed));
  // The page shows those sections as loading and reads them after hydration (components/section-seed.tsx).
  if (missing.length) console.warn(`area seed: ${missing.length} of ${asked.size} reads left to the browser for ${query.geographyId}`);
  if (seed[METRICS_PATH]) seed[METRICS_PATH] = trimMetrics(seed[METRICS_PATH]);
  for (const path of followUps) {
    if (path.includes(`metric=${FOOD_HYGIENE_METRIC}`) && seed[path]) seed[path] = trimFoodHygiene(seed[path]);
  }
  shareTimelines(Object.values(seed));
  return seed;
}

/**
 * Every area evidence body carries the price timeline, and the price layer's metric timeline is the
 * same list: equal lists become one object, which the server payload then sends once.
 */
function shareTimelines(bodies: readonly unknown[]) {
  const seen = new Map<string, unknown[]>();
  const shared = (list: unknown[]) => {
    const key = JSON.stringify(list);
    const known = seen.get(key);
    if (known) return known;
    seen.set(key, list);
    return list;
  };
  for (const body of bodies) {
    const area = body as { priceTimeline?: unknown; metricTimeline?: unknown } | null;
    if (!area || typeof area !== "object") continue;
    if (Array.isArray(area.priceTimeline)) area.priceTimeline = shared(area.priceTimeline);
    if (Array.isArray(area.metricTimeline)) area.metricTimeline = shared(area.metricTimeline);
  }
}
