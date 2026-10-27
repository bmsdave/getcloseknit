/**
 * Server-side deployment defaults. A deployment that points at the evidence
 * API opens in real mode on the release that API is actually serving, so the
 * mode/release label in the UI can never drift from the data behind it.
 * Pure helpers stay unit-testable; only `serverDefaults`/`serverArea` touch
 * the network.
 */
import { cache } from "react";

import type { DataMode } from "./map-state";
import { REAL_PILOT_RELEASE } from "./map-state";
import { clientHeaders, evidenceServiceUrl, SHARED_EVIDENCE_TTL_MS } from "./evidence-service";
import { currentRender, renderHeaders } from "./server-render";
import type { AddressHistory, AreaEvidencePack, AreaSummary, Carrier, EvidenceEnvelope, GeographyId, SectorListItem, SectorValue } from "./contracts";
import { isCoverage, type MapCoverage } from "./map-coverage";
import { coversEngland, isScope, LONDON_SCOPE, type ServedScope } from "./scope";
import type { CatalogueLayer } from "./map-preload";
import { getAddressHistory, getAreaPack, getAreaSummary, searchFixtures, type SearchResult } from "./fixtures";
import { lookupPostcode } from "./postcode-search";
import type { FriendlyAreaFields } from "./area-labels";
import { demoFriendlyFields } from "./area-labels-fixture";
import { planPostcodePage, type PostcodePlan } from "./postcode-page";
import type { PostcodeHome, PostcodeHomesResponse } from "./property-profile";
import { demoPostcodeHomes } from "./property-profile-fixture";
import { readSector, readSectorList } from "./sector";
import { readStandouts, type AreaStandouts } from "./standouts";
import { fixtureStandouts } from "./standouts-fixture";
import { demoSector, demoSectorList } from "./sector-fixture";

export interface ServedRelease {
  productReleaseId: string;
  defaultPeriod: string | null;
  /** Each map layer's carrier and months (the map's first pack is named in the page's head: lib/map-preload.ts). */
  layers?: Record<string, CatalogueLayer>;
}

export interface DeploymentDefaults {
  mode: DataMode | undefined;
  release: string | undefined;
}

interface DeploymentEnv {
  api: string | null;
  env: Record<string, string | undefined>;
}

const PRICE_METRIC = "price-per-square-metre";
const FETCH_TIMEOUT_MS = 2500;
/**
 * The sitemap's sector list with homes probes the address index once per sector: about 0.6 s warm, 3.5 s from a
 * cold cache on prod. A sitemap is read by crawlers, not people: it waits rather than drop every per-address shard.
 */
const SITEMAP_FETCH_TIMEOUT_MS = 20_000;
const POSTCODE_ADDRESS_LIMIT = 25;

export function deploymentDefaults(deployment: DeploymentEnv, served: ServedRelease | null): DeploymentDefaults {
  const envMode = deployment.env.NEXT_PUBLIC_AE_DEFAULT_MODE;
  const envRelease = deployment.env.NEXT_PUBLIC_AE_DEFAULT_RELEASE;
  if (!deployment.api) return { mode: envMode as DataMode | undefined, release: envRelease };
  return {
    mode: (envMode as DataMode | undefined) ?? "real",
    release: envRelease ?? served?.productReleaseId ?? REAL_PILOT_RELEASE,
  };
}

export function parseMetricsRelease(payload: unknown): ServedRelease | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { productReleaseId?: unknown; metrics?: unknown };
  if (typeof record.productReleaseId !== "string") return null;
  const metrics = Array.isArray(record.metrics) ? record.metrics as { id?: unknown; defaultPeriod?: unknown }[] : [];
  const price = metrics.find((metric) => metric.id === PRICE_METRIC);
  const defaultPeriod = typeof price?.defaultPeriod === "string" && price.defaultPeriod ? price.defaultPeriod : null;
  const layers: Record<string, CatalogueLayer> = {};
  for (const metric of metrics as { id?: unknown; carrier?: unknown; defaultPeriod?: unknown; periods?: unknown }[]) {
    if (typeof metric.id !== "string" || typeof metric.carrier !== "string" || typeof metric.defaultPeriod !== "string") continue;
    const periods = Array.isArray(metric.periods) ? metric.periods.filter((period): period is string => typeof period === "string") : [];
    layers[metric.id] = { carrier: metric.carrier as Carrier, defaultPeriod: metric.defaultPeriod, periods };
  }
  return { productReleaseId: record.productReleaseId, defaultPeriod, layers };
}

/** Whether a permanent area link should render or 404. */
export function isKnownArea(args: { mode: DataMode; fixture: boolean; upstreamStatus: number | null }): boolean {
  if (args.mode === "demo") return args.fixture;
  return args.upstreamStatus !== 404;
}

/** Server-rendered pages forward the viewer's address too (see clientHeaders), and a page that began a
 *  render (lib/server-render.ts) its render headers; outside a request (unit tests, build) there is none. */
async function viewerHeaders(): Promise<Record<string, string>> {
  try {
    const { headers } = await import("next/headers");
    return { ...clientHeaders(await headers()), ...renderHeaders(currentRender()) };
  } catch {
    return {};
  }
}

export async function fetchApi<T>(path: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<{ status: number; body: T | null }> {
  const base = evidenceServiceUrl();
  if (!base) return { status: 0, body: null };
  try {
    const response = await fetch(`${base}${path}`, {
      headers: { accept: "application/json", ...(await viewerHeaders()) },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const body = response.ok ? (await response.json() as T) : null;
    return { status: response.status, body };
  } catch {
    return { status: 503, body: null };
  }
}

/**
 * A release-wide read every page render makes (the ~1.4 MB metric list, the coverage), kept SHARED_EVIDENCE_TTL_MS
 * in this process as the BFF keeps them (lib/evidence-service.ts fetchSharedEvidence): a render no longer waits on
 * the API for them, nor parses the list again. Only a 200 is kept.
 */
const sharedReads = new Map<string, { at: number; read: Promise<{ status: number; body: unknown }> }>();
function sharedApi(path: string): Promise<{ status: number; body: unknown }> {
  const held = sharedReads.get(path);
  if (held && Date.now() - held.at < SHARED_EVIDENCE_TTL_MS) return held.read;
  const read = fetchApi<unknown>(path).then((answer) => {
    if (answer.status !== 200) sharedReads.delete(path);
    return answer;
  });
  sharedReads.set(path, { at: Date.now(), read });
  return read;
}

/** Once per request (React cache): a school page's loaders each read the ~1.4 MB metric list for it. */
export const servedRelease = cache(async (): Promise<ServedRelease | null> => {
  const { body } = await sharedApi("/api/v1/metrics");
  return parseMetricsRelease(body);
});

/**
 * The places the API serves this site (FLAGS.md CLOSE_KNIT_ENGLAND, GET /api/v1/scope), once per request: the layout
 * hands it to every page (components/scope-context.tsx). Null with no API, in demo and when the API does not answer:
 * the browser then asks the site's /api/v1/scope.
 */
export const serverScope = cache(async (): Promise<ServedScope | null> => {
  const api = evidenceServiceUrl();
  if (!api || deploymentDefaults({ api, env: process.env }, null).mode !== "real") return null;
  const { body } = await sharedApi("/api/v1/scope");
  return isScope(body) ? body : null;
});

/**
 * Whether the API covers all of England, once per request: the first view's and the site's words follow it. False
 * (London's words, as before) when the server does not know.
 */
export const serverCoversEngland = cache(async (): Promise<boolean> => coversEngland((await serverScope()) ?? LONDON_SCOPE));

/** The map's coverage (/api/v1/map/coverage) once per request; null with no API, in demo or when it does not answer. */
export const serverCoverage = cache(async (): Promise<MapCoverage | null> => {
  // The mode without the release: no metrics read just for this (every page's layout asks).
  const api = evidenceServiceUrl();
  if (!api || deploymentDefaults({ api, env: process.env }, null).mode !== "real") return null;
  const { body } = await sharedApi("/api/v1/map/coverage");
  return isCoverage(body) ? body : null;
});

export async function serverDefaults(): Promise<DeploymentDefaults & { served: ServedRelease | null }> {
  const api = evidenceServiceUrl();
  const served = api ? await servedRelease() : null;
  return { ...deploymentDefaults({ api, env: process.env }, served), served };
}

export interface ServerArea {
  mode: DataMode;
  release: string | undefined;
  summary: AreaSummary | null;
  /** Friendly name and postcode district (null fields when unknown). */
  friendly: FriendlyAreaFields;
  known: boolean;
  /** The API's answer (200, 404, 429, 503…; 200 in demo): a page tells "no such area" from "try again". */
  status: number;
}

/**
 * Resolves a geography for a permanent page: fixtures in demo, the API in real mode. One read per
 * request: the page and its metadata share it (React cache), so a render never pays for it twice.
 */
export const serverArea = cache(async (geography: GeographyId): Promise<ServerArea> => {
  const defaults = await serverDefaults();
  const mode: DataMode = defaults.mode ?? "demo";
  const period = defaults.served?.defaultPeriod ?? "2026-06";
  const fixture = getAreaSummary(geography, PRICE_METRIC, "2026-06");
  if (mode === "demo") {
    const friendly = fixture ? demoFriendlyFields(fixture.geographyId) : {};
    return { mode, release: defaults.release, summary: fixture, friendly, known: fixture !== null, status: fixture ? 200 : 404 };
  }
  const upstream = await fetchApi<{ summary: AreaSummary } & FriendlyAreaFields>(
    `/api/v1/areas/${encodeURIComponent(geography)}?metric=${PRICE_METRIC}&period=${period}`);
  return {
    mode, release: defaults.release, summary: upstream.body?.summary ?? null,
    friendly: { friendlyName: upstream.body?.friendlyName ?? null, postcodeDistrict: upstream.body?.postcodeDistrict ?? null },
    known: isKnownArea({ mode, fixture: fixture !== null, upstreamStatus: upstream.status }),
    status: upstream.status,
  };
});

/** An upstream answer worth a "try again" (rate limited, unavailable or unreachable: fetchApi's 503),
 *  never a 404; 0 (no API, demo) is not one. */
export function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface ServerAreaPack {
  mode: DataMode;
  /** 200 with a pack; 400 address outside the area or malformed; 404 unknown; 503 unreachable. */
  status: number;
  pack: AreaEvidencePack | null;
}

/** The area evidence pack: fixtures in demo, the API's envelope value in real mode. */
export async function serverAreaPack(geography: GeographyId, address?: string): Promise<ServerAreaPack> {
  const defaults = await serverDefaults();
  const mode: DataMode = defaults.mode ?? "demo";
  if (mode === "demo") {
    const pack = getAreaPack(geography, address);
    if (pack === "address-outside") return { mode, status: 400, pack: null };
    return { mode, status: pack ? 200 : 404, pack };
  }
  const query = address ? `?address=${encodeURIComponent(address)}` : "";
  const upstream = await fetchApi<EvidenceEnvelope<AreaEvidencePack>>(
    `/api/v1/areas/${encodeURIComponent(geography)}/pack${query}`);
  return { mode, status: upstream.status, pack: upstream.body?.value ?? null };
}

/**
 * A neighbourhood's verdict, tags and 12 tiles for the server render (so crawlers and the first paint
 * get them whole): the demo fixture in demo mode, the API otherwise; null when it does not answer in
 * time (the page then reads them itself).
 */
export async function serverStandouts(geography: GeographyId, mode: DataMode): Promise<AreaStandouts | null> {
  // Neighbourhoods, wider neighbourhoods (the MSOA page is the area page) and boroughs.
  if (!/^uk:(lsoa|msoa|lad):/.test(geography)) return null;
  if (mode === "demo") return fixtureStandouts(geography);
  const upstream = await fetchApi<unknown>(`/api/v1/areas/${encodeURIComponent(geography)}/standouts`);
  return upstream.status === 200 ? readStandouts(upstream.body, mode) : null;
}

export interface ServerSector {
  mode: DataMode;
  /** 200 with a sector; 404 unknown; 503 unreachable (0 with no API configured). */
  status: number;
  sector: SectorValue | null;
}

/** A postcode sector page (/sector/W5-1): the demo fixture in demo, the API's envelope value in real mode. */
export async function serverSector(slug: string): Promise<ServerSector> {
  const defaults = await serverDefaults();
  const mode: DataMode = defaults.mode ?? "demo";
  if (mode === "demo") {
    const sector = readSector(demoSector(slug));
    return { mode, status: sector ? 200 : 404, sector };
  }
  const upstream = await fetchApi<unknown>(`/api/v1/sectors/${encodeURIComponent(slug)}`);
  const sector = readSector(upstream.body);
  return { mode, status: upstream.status === 200 && !sector ? 502 : upstream.status, sector };
}

/** GET /api/v1/sectors?q= (code prefix, at most 20): the demo list in demo, [] when unreachable. */
/** Sectors whose code starts with `query`, or every London sector when it is omitted. */
export async function serverSectorList(query?: string): Promise<SectorListItem[]> {
  if (!evidenceServiceUrl()) return demoSectorList(query ?? "");
  const { body } = await fetchApi<unknown>(query === undefined ? "/api/v1/sectors" : `/api/v1/sectors?q=${encodeURIComponent(query)}`);
  return readSectorList(body);
}

/** The sectors with recorded homes (per-home data is London's): the per-address sitemap shards, never an empty one. */
export const SECTORS_WITH_HOMES_PATH = "/api/v1/sectors?homes=1";

export async function serverSectorsWithHomes(): Promise<SectorListItem[]> {
  if (!evidenceServiceUrl()) return demoSectorList("");
  const { body } = await fetchApi<unknown>(SECTORS_WITH_HOMES_PATH, SITEMAP_FETCH_TIMEOUT_MS);
  return readSectorList(body);
}

export interface ServerPostcode extends PostcodePlan {
  mode: DataMode;
  release: string | undefined;
  histories: AddressHistory[];
  /** Every recorded home in the postcode (type, tenure, size, energy rating); null when unavailable. */
  homes: PostcodeHome[] | null;
}

interface UpstreamSearchResult extends Omit<SearchResult, "id" | "addressId"> {
  addressId?: SearchResult["addressId"];
}

async function searchAddresses(mode: DataMode, postcode: string): Promise<SearchResult[]> {
  if (mode === "demo") return searchFixtures(postcode);
  const upstream = await fetchApi<{ results: UpstreamSearchResult[] }>(
    `/api/v1/search?q=${encodeURIComponent(postcode)}&limit=${POSTCODE_ADDRESS_LIMIT}`);
  return (upstream.body?.results ?? []).map((result, index) => ({
    ...result, id: `${result.geographyId}-${index}`, addressId: result.addressId ?? null,
  }));
}

async function addressHistory(mode: DataMode, addressId: string): Promise<AddressHistory | null> {
  if (mode === "demo") return getAddressHistory(addressId);
  const upstream = await fetchApi<{ history: AddressHistory }>(`/api/v1/addresses/${encodeURIComponent(addressId)}/history`);
  return upstream.body?.history ?? null;
}

/** Homes listed for one postcode: one exact-postcode lookup (fast), unlike the fuzzy search. */
async function postcodeHomes(mode: DataMode, postcode: string): Promise<PostcodeHomesResponse | null> {
  if (mode === "demo") return demoPostcodeHomes(postcode);
  const upstream = await fetchApi<PostcodeHomesResponse>(`/api/v1/postcodes/${encodeURIComponent(postcode)}/homes?sales=true`);
  return upstream.body;
}

/**
 * Address histories are one API call each and the API allows 120 calls a
 * minute per viewer, so a page reads at most POSTCODE_ADDRESS_LIMIT of them
 * (the homes with the most sales), this many at a time.
 */
const HISTORY_BATCH = 12;

async function addressHistories(mode: DataMode, addressIds: string[]): Promise<(AddressHistory | null)[]> {
  const histories: (AddressHistory | null)[] = [];
  for (let start = 0; start < addressIds.length; start += HISTORY_BATCH) {
    histories.push(...await Promise.all(addressIds.slice(start, start + HISTORY_BATCH)
      .map((addressId) => addressHistory(mode, addressId))));
  }
  return histories;
}

/** Real-mode homes as the search results the page plan reads (their addresses carry the postcode). */
export function homesAsResults(response: PostcodeHomesResponse): SearchResult[] {
  const geographyId = response.geographyId;
  if (!geographyId) return [];
  const sold = response.homes.filter((home) => home.saleCount > 0);
  const kept = new Set([...sold].sort((a, b) => b.saleCount - a.saleCount).slice(0, POSTCODE_ADDRESS_LIMIT));
  return sold.filter((home) => kept.has(home)).map((home, index) => ({
    id: `${geographyId}-${index}`, label: home.displayAddress, secondaryLabel: response.postcode,
    geographyId, uprn: home.uprn, addressId: home.addressId, center: [0, 0],
  }));
}

/**
 * Real-mode address histories straight from the homes response (?sales=true):
 * every sold home's sales in the one call, instead of one history call per
 * address. A page costing ~35 API calls emptied itself after three or four
 * postcodes a minute (the 120-a-minute limit); now it costs ~10. Null when
 * the API did not include the sales (an older API), so the caller falls back.
 */
export function homesAsHistories(response: PostcodeHomesResponse): AddressHistory[] | null {
  const { geographyId, salesDisclaimer } = response;
  if (!geographyId || !salesDisclaimer) return null;
  const sold = response.homes.filter((home) => home.saleCount > 0);
  if (sold.some((home) => !home.sales)) return null;
  // A sold home always has an address id; only an EPC-only home (no sale) has none.
  return sold.flatMap(({ addressId, displayAddress, sales }) => (addressId && sales!.length > 0 ? [{
    addressId, displayAddress, postcode: response.postcode, geographyId,
    saleCount: sales!.length, coordinatesPrecision: "postcode" as const, transactions: sales!,
    estimateDisclaimer: salesDisclaimer, sourceVersion: response.productReleaseId,
  }] : []));
}

/**
 * Resolves a permanent postcode page: its addresses (with recorded sales), its
 * homes and the area it sits in. Real mode lists addresses by exact postcode
 * (postcode homes with their sales, one indexed call); the fuzzy search is the fallback for a
 * postcode with no recorded homes, and the postcode lookup the last resort.
 */
export async function serverPostcode(postcode: string): Promise<ServerPostcode> {
  const defaults = await serverDefaults();
  const mode: DataMode = defaults.mode ?? "demo";
  const homes = await postcodeHomes(mode, postcode);
  const listed = mode === "real" && homes ? homesAsResults(homes) : [];
  const batched = mode === "real" && homes ? homesAsHistories(homes) : null;
  const results = listed.length > 0 ? listed : await searchAddresses(mode, postcode);
  const needsLookup = results.length === 0 && mode === "real";
  const lookup = needsLookup ? await lookupPostcode(postcode) : null;
  const plan = planPostcodePage(postcode, results, lookup ? { area: lookup.area, areaName: lookup.areaName } : null);
  const [histories, areaName] = await Promise.all([
    batched ?? addressHistories(mode, plan.addresses.map((address) => address.addressId as string)),
    plan.areaName ?? (plan.geography ? serverArea(plan.geography).then((area) => area.summary?.name ?? null) : null),
  ]);
  return {
    ...plan, areaName, mode, release: defaults.release,
    histories: (histories as (AddressHistory | null)[]).filter((h): h is AddressHistory => h !== null),
    homes: homes?.homes ?? null,
  };
}
