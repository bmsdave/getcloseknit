/**
 * Server loader for the area guide and ranking pages. Real mode reads the
 * evidence API (hierarchy, the value packs the map already uses, crime at
 * MSOA and borough level); demo mode builds the same shape from fixtures.
 *
 * The packs are large (≈1.4 MB for £/m²) and change only with a release, so
 * they are kept in this process per release instead of in the Next data cache (2 MB item limit), one
 * English region per load (?region=), up to MAX_REGIONS regions, reloaded hourly behind the pages they
 * keep serving. Pages are not prerendered at build time:
 * the image builds without the API, which would freeze demo numbers into a
 * real deployment.
 */
import { randomUUID } from "node:crypto";

import { demoFriendlyFields } from "./area-labels-fixture";
import { fixtureAreaProfile } from "./area-profile-fixture";
import {
  buildIndex,
  englandRegions,
  LENS_PRESETS,
  PAGE_METRIC_IDS,
  RANKINGS,
  type AreaHierarchyResponse,
  type AreaIndex,
  type AreaPagesData,
  type HierarchyArea,
  type LensPack,
  type LensPreset,
  type PageMetricId,
  type SchoolRanking,
  type SchoolRankingResponse,
} from "./area-pages";
import type { AreaProfileResponse, Carrier, GeographyId, MetricId, ValuePack, ValuePackEntry } from "./contracts";
import { serverDefaults } from "./deployment";
import { clientHeaders, evidenceServiceUrl } from "./evidence-service";
import { areaGeoJson, getMetric, getValuePack, isFixtureSourceVersion, parentGeographyId } from "./fixtures";
import type { DataMode } from "./map-state";
import { LONDON_SCOPE, regionScope, type RankScope } from "./scope-name";
import { currentRender, renderHeaders } from "./server-render";

const TTL_MS = 60 * 60 * 1000;
/** A load with a lens pack missing (the API was still building it) is retried this soon. */
const INCOMPLETE_TTL_MS = 2 * 60 * 1000;
const PACK_TIMEOUT_MS = 20_000;
const PROFILE_TIMEOUT_MS = 4_000;

export interface LoadedAreaPages {
  mode: DataMode;
  index: AreaIndex;
  /** The latest month any page metric has; the profile is asked for this month. */
  latestPeriod: string;
}

/**
 * Regions kept in this process at once: all of England's 9 (London ≈ 5,000 neighbourhoods, ~35,000 areas in all).
 * With 3, a visitor going round the regions evicted the one the next visitor wanted, and every page of an evicted
 * region waited seconds for its data again.
 */
const MAX_REGIONS = 9;

interface Held {
  at: number;
  ttl: number;
  value: Promise<AreaPagesData | null>;
  /** The load answered with data (not still loading, never an outage). */
  ready: boolean;
  /** A stale entry being reloaded behind the pages it still serves. */
  refreshing?: boolean;
}

const memo = new Map<string, Held>();
const indexes = new WeakMap<AreaPagesData, AreaIndex>();

/** The index of one load, built once: every page of the region shares it (it sorts and maps ~35,000 areas). */
function indexOf(data: AreaPagesData): AreaIndex {
  let index = indexes.get(data);
  if (!index) {
    index = buildIndex(data);
    indexes.set(data, index);
  }
  return index;
}

/** Insert as most recently used; the oldest go once there are more than MAX_REGIONS. */
function keep<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_REGIONS) map.delete(map.keys().next().value as string);
}

/** How long a load is kept: the hour, or minutes when a lens pack was missing. */
export function cacheTtlMs(data: AreaPagesData): number {
  return data.incomplete ? INCOMPLETE_TTL_MS : TTL_MS;
}

function startLoad(key: string, load: () => Promise<AreaPagesData | null>): Held {
  const entry: Held = { at: Date.now(), ttl: TTL_MS, value: Promise.resolve(null), ready: false };
  const forget = () => { if (memo.get(key) === entry) memo.delete(key); }; // never keep an outage
  entry.value = load().then((data) => {
    if (data === null) forget();
    else { entry.ttl = cacheTtlMs(data); entry.ready = true; }
    return data;
  }, () => { forget(); return null; });
  return entry;
}

/**
 * One load per key, kept its TTL; past it the old data keeps serving while one reload runs behind it (a page never
 * waits for the hourly reload). A failed reload keeps the old data a few minutes more, then tries again.
 */
function remember(key: string, load: () => Promise<AreaPagesData | null>): Promise<AreaPagesData | null> {
  const hit = memo.get(key);
  if (hit && (!hit.ready || Date.now() - hit.at < hit.ttl)) {
    keep(memo, key, hit);
    return hit.value;
  }
  if (hit) {
    if (!hit.refreshing) {
      hit.refreshing = true;
      const next = startLoad(key, load);
      void next.value.then((data) => {
        if (data && memo.get(key) === hit) keep(memo, key, next);
        hit.at = Date.now();
        hit.ttl = INCOMPLETE_TTL_MS;
        hit.refreshing = false;
      });
    }
    return hit.value;
  }
  const entry = startLoad(key, load);
  keep(memo, key, entry);
  return entry.value;
}

/**
 * Headers for one load of shared data (a region's packs, its tree, the borough list): the viewer's address when
 * there is a request, and one render id for the whole load, so the API's rate limit charges it as one page view
 * (api/area_api/ratelimit.py "render"). Untagged, every load was ~35 reads of the web container's own 120 a minute:
 * a few regions at once ran it out, the region's tree read got a 429 and its borough pages a 404.
 */
async function loadHeaders(): Promise<Record<string, string>> {
  let viewer: Record<string, string> = {};
  try {
    const { headers } = await import("next/headers");
    viewer = clientHeaders(await headers());
  } catch {
    // outside a request (start-up, tests): no viewer
  }
  return { ...viewer, ...renderHeaders(currentRender() ?? randomUUID()) };
}

/** The answer's status (0 when unreachable or timed out) and its JSON on a 200. */
async function getAnswer<T>(url: string, timeout: number, headers: Record<string, string>): Promise<{ status: number; body: T | null }> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeout),
      cache: "no-store",
    });
    return { status: response.status, body: response.ok ? await response.json() as T : null };
  } catch {
    return { status: 0, body: null };
  }
}

async function getJson<T>(url: string, timeout = PACK_TIMEOUT_MS, headers: Record<string, string> = {}): Promise<T | null> {
  return (await getAnswer<T>(url, timeout, headers)).body;
}

/** Real values only: a pack carrying fixture numbers is treated as missing. */
function realValues(pack: ValuePack | null): ValuePackEntry[] | undefined {
  if (!pack || !Array.isArray(pack.values) || isFixtureSourceVersion(pack.sourceVersion)) return undefined;
  return pack.values;
}

/**
 * Every ranking lens per MSOA and borough (/api/v1/area-values/lens/{preset}); a lens whose packs are
 * missing, fixtures or all unknown is left out, so its ranking pages hide. `incomplete` when a pack
 * could not be fetched at all, rather than answered with no figures.
 */
async function loadLenses(base: string, region = "", headers: Record<string, string> = {}): Promise<{ lens: AreaPagesData["lens"]; incomplete: boolean }> {
  type LensResponse = ValuePack & { sources?: LensPack["sources"] };
  const packs = await Promise.all(LENS_PRESETS.map((preset) => Promise.all((["msoa", "lad"] as const).map((carrier) =>
    getJson<LensResponse>(`${base}/api/v1/area-values/lens/${preset}?carrier=${carrier}${region ? `&${region}` : ""}`, PACK_TIMEOUT_MS, headers)))));
  const lens: AreaPagesData["lens"] = {};
  const incomplete = packs.some((pair) => pair.some((pack) => pack === null));
  LENS_PRESETS.forEach((preset, i) => {
    const [msoa, borough] = packs[i];
    const values = { msoa: realValues(msoa) ?? [], borough: realValues(borough) ?? [] };
    if (![...values.msoa, ...values.borough].some((entry) => entry.value !== null)) return;
    lens[preset] = { ...values, sources: [...(msoa?.sources ?? borough?.sources ?? [])] };
  });
  return { lens, incomplete };
}

const SCHOOL_RANKINGS = RANKINGS.filter((ranking): ranking is SchoolRanking => ranking.kind === "school");

/** Every school ranking (/api/v1/school-rankings/{axis}); a missing or malformed answer is left out, so its page hides. */
async function loadSchoolRankings(base: string, headers: Record<string, string> = {}): Promise<AreaPagesData["schoolRankings"]> {
  const answers = await Promise.all(SCHOOL_RANKINGS.map((ranking) =>
    getJson<SchoolRankingResponse>(`${base}/api/v1/school-rankings/${ranking.axis}?phase=${ranking.phase}&limit=100`, PACK_TIMEOUT_MS, headers)));
  return Object.fromEntries(SCHOOL_RANKINGS.flatMap((ranking, i) => {
    const answer = answers[i];
    return answer?.schemaVersion === "school-ranking.v1" && Array.isArray(answer.rows) ? [[ranking.slug, answer]] : [];
  }));
}

/**
 * Real mode for one region: its tree (regionTree), page metric packs, crime per MSOA and borough and the ranking
 * lenses, each cut to the region (?region=); no tree reads the whole hierarchy uncut, as before.
 */
export async function loadRealAreaPages(base: string, tree: RegionTree | null = null, headers: Record<string, string> = {}): Promise<AreaPagesData | null> {
  const region = tree ? `region=${tree.region.code}` : "";
  const [metrics, hierarchy] = await Promise.all([
    getJson<{ metrics: { id: string; defaultPeriod?: string }[] }>(`${base}/api/v1/metrics`, PACK_TIMEOUT_MS, headers),
    tree ? { schemaVersion: "area-hierarchy.v1" as const, areas: tree.areas } : getJson<AreaHierarchyResponse>(`${base}/api/v1/hierarchy`, PACK_TIMEOUT_MS, headers),
  ]);
  if (!metrics || !hierarchy || hierarchy.schemaVersion !== "area-hierarchy.v1") return null;
  const periods: AreaPagesData["periods"] = {};
  for (const metric of metrics.metrics) {
    if ((PAGE_METRIC_IDS as readonly string[]).includes(metric.id) && metric.defaultPeriod) {
      periods[metric.id as PageMetricId] = metric.defaultPeriod;
    }
  }
  const cut = (path: string) => (region ? `${path}${path.includes("?") ? "&" : "?"}${region}` : path);
  const pack = (path: string) => getJson<ValuePack>(`${base}${cut(path)}`, PACK_TIMEOUT_MS, headers).then(realValues);
  const packs = await Promise.all(PAGE_METRIC_IDS.map((metric) =>
    periods[metric] ? pack(`/api/v1/value-packs/${metric}/${periods[metric]}`) : Promise.resolve(undefined)));
  const crimePeriod = periods.crime;
  // The school lists are London's (rankings pages): another region skips them.
  const london = (tree?.region.code ?? LONDON_SCOPE.code) === LONDON_SCOPE.code;
  const [[crimeMsoa, crimeBorough], { lens, incomplete }, schoolRankings] = await Promise.all([
    crimePeriod
      ? Promise.all((["msoa", "lad"] as const).map((carrier) => pack(`/api/v1/area-values/crime/${crimePeriod}?carrier=${carrier}`)))
      : Promise.resolve([undefined, undefined]),
    loadLenses(base, region, headers),
    london ? loadSchoolRankings(base, headers) : Promise.resolve({}),
  ]);
  return {
    mode: "real",
    scope: tree?.region ?? LONDON_SCOPE,
    areas: hierarchy.areas,
    values: Object.fromEntries(PAGE_METRIC_IDS.flatMap((metric, i) => packs[i] ? [[metric, packs[i]]] : [])),
    crime: { msoa: crimeMsoa ?? [], borough: crimeBorough ?? [] },
    periods,
    lens,
    schoolRankings,
    incomplete,
  };
}

/** Preview school lists: made-up schools, labelled demo on the page; too few report cards, so that list hides. */
function demoSchoolRankings(): AreaPagesData["schoolRankings"] {
  const year = (ranking: SchoolRanking) => ranking.axis === "progress-8" ? "2023/24" : ranking.axis === "report-card-exceptional" ? "2025/26" : "2024/25";
  const value = (ranking: SchoolRanking, i: number): number | string => ({
    "grade5-english-maths": 78 - i * 9, "attainment-8": 62.4 - i * 4.1, "progress-8": 0.62 - i * 0.4, "legacy-outstanding": "Outstanding", "report-card-exceptional": 3 - i,
  })[ranking.axis];
  return Object.fromEntries(SCHOOL_RANKINGS.map((ranking) => {
    const ks4 = !["legacy-outstanding", "report-card-exceptional"].includes(ranking.axis);
    const rows = ["Preview Academy", "Preview High School", "Preview Community School"].map((name, i) => ({
      urn: `10000${i + 1}`, name, borough: ["Camden", "Hackney", "Westminster"][i], value: value(ranking, i),
      cohort: ks4 ? 180 - i * 40 : null, year: ranking.axis === "legacy-outstanding" ? ["2023/24", "2019/20", "2014/15"][i] : year(ranking),
    }));
    const answer: SchoolRankingResponse = {
      schemaVersion: "school-ranking.v1", axis: ranking.axis, phase: ranking.phase, measure: ranking.column,
      year: ks4 ? year(ranking) : null, minCohort: ks4 ? 30 : null, eligibleSchools: rows.length, rows,
      ...(ranking.axis === "report-card-exceptional" ? { inspectedSchools: 3 } : {}),
      caveats: ["Preview data: illustrative, not for decisions."],
      attribution: "Contains public sector information licensed under the Open Government Licence v3.0.",
    };
    return [ranking.slug, answer];
  }));
}

const DEMO_SUFFIX: Record<Carrier, string> = { lad: " borough", msoa: " MSOA", lsoa: "" };

/** The fixtures as a tiny London: three boroughs, each with one MSOA and one LSOA. */
export function demoAreaPagesData(): AreaPagesData {
  const carriers: Carrier[] = ["lad", "msoa", "lsoa"];
  const features = Object.fromEntries(carriers.map((carrier) => [carrier, areaGeoJson(carrier).features])) as
    Record<Carrier, ReturnType<typeof areaGeoJson>["features"]>;
  const areas: HierarchyArea[] = carriers.flatMap((carrier) => features[carrier].map((feature) => ({
    geographyId: feature.properties.geography_id,
    name: `${feature.properties.name}${DEMO_SUFFIX[carrier]}`,
    carrier,
    parentId: parentGeographyId(feature.properties.geography_id),
    ...(carrier === "lsoa" ? {} : demoFriendlyFields(feature.properties.geography_id)),
    schools: null,
  })));
  // Fixture packs list the preview areas in order; key each value to the
  // metric's own carrier, as real packs do (a fallback stays a fallback).
  const rekey = (entries: ValuePackEntry[], carrier: Carrier): ValuePackEntry[] => entries.map((entry, i) => {
    const area = areas.find((candidate) => candidate.geographyId === features[carrier][i].properties.geography_id);
    return { ...entry, geographyId: features[carrier][i].properties.geography_id, name: area?.name ?? entry.name, carrier };
  });
  const periods: AreaPagesData["periods"] = {};
  const values: AreaPagesData["values"] = {};
  for (const metric of PAGE_METRIC_IDS) {
    const definition = getMetric(metric);
    periods[metric] = definition.defaultPeriod;
    values[metric] = rekey(getValuePack(metric, definition.defaultPeriod).values, definition.carrier);
  }
  const crime = values.crime ?? [];
  // Preview lens figures: each preview area gets a different made-up count, labelled demo on the page.
  const lensEntry = (preset: LensPreset, carrier: Carrier, i: number): ValuePackEntry => {
    const area = areas.find((candidate) => candidate.geographyId === features[carrier][i].properties.geography_id);
    const value = preset === "markets" ? 4 + i * 5 : preset === "food-variety" ? 24 - i * 7 : Math.round((LENS_PRESETS.indexOf(preset) + 3) * (3 - i) * 6) / 10;
    return {
      geographyId: features[carrier][i].properties.geography_id, name: area?.name ?? "", metricId: `lens:${preset}` as MetricId, period: "",
      value, regionPercentile: null, countryPercentile: null, sampleCount: preset === "markets" ? 1 : 12 + i, quality: "observed",
      sourceVersion: "preview-places", carrier,
    };
  };
  const lens = Object.fromEntries(LENS_PRESETS.map((preset) => [preset, {
    msoa: features.msoa.map((_, i) => lensEntry(preset, "msoa", i)),
    borough: features.lad.map((_, i) => lensEntry(preset, "lad", i)),
    sources: [],
  }]));
  return {
    mode: "demo", areas, values, crime: { msoa: rekey(crime, "msoa"), borough: rekey(crime, "lad") }, periods, lens,
    schoolRankings: demoSchoolRankings(),
  };
}

/**
 * Everything the area and ranking pages need for one region; null when real data is unreachable. `scope` is a
 * region code or any area id (its region); London by default (rankings, /area/london). Demo mode is the
 * fixtures' tiny London whatever the scope.
 */
export async function loadAreaPages(scope: string = LONDON_SCOPE.code): Promise<LoadedAreaPages | null> {
  const defaults = await serverDefaults();
  const mode: DataMode = defaults.mode ?? "demo";
  const base = evidenceServiceUrl();
  let data: AreaPagesData | null;
  if (mode === "demo") data = await remember("demo", async () => demoAreaPagesData());
  else if (!base) data = null;
  else {
    const release = defaults.served?.productReleaseId ?? "unknown";
    // An area the API does not know (404) falls back to London's tree, where it is missing too: the page 404s.
    // An outage (a 429, a timeout) is no answer at all: the page says it could not load, never "not found".
    const found = await findRegionTree(base, release, scope, PACK_TIMEOUT_MS);
    const tree = found === UNKNOWN
      ? (scope === LONDON_SCOPE.code ? null : await regionTree(base, release, LONDON_SCOPE.code, PACK_TIMEOUT_MS))
      : found;
    data = tree
      ? await remember(`${base}|${release}|${tree.region.code}`, async () => loadRealAreaPages(base, tree, await loadHeaders()))
      : null;
  }
  if (!data) return null;
  const latestPeriod = Object.values(data.periods).filter(Boolean).sort().at(-1) ?? "2026-06";
  return { mode, index: indexOf(data), latestPeriod };
}

/** One region's areas (/api/v1/hierarchy?region=), by id. */
export interface RegionTree {
  region: RankScope;
  areas: HierarchyArea[];
  byId: Map<GeographyId, HierarchyArea>;
}

const trees = new Map<string, { at: number; value: Promise<RegionTree | null> }>();

/**
 * A region's tree, kept an hour per release for the last MAX_REGIONS regions. `scope` is a region code or an
 * area id: looked up in the trees already kept, else asked for by id. An API without ?region= answers with
 * every area: that is London, as before. Null on an outage or an unknown area.
 */
export async function regionTree(base: string, release: string, scope: string, timeout = PROFILE_TIMEOUT_MS): Promise<RegionTree | null> {
  const found = await findRegionTree(base, release, scope, timeout);
  return found === UNKNOWN ? null : found;
}

export const UNKNOWN = "unknown" as const;
const treeReads = new Map<string, Promise<RegionTree | typeof UNKNOWN | null>>();

/**
 * regionTree, telling an area the API does not know (UNKNOWN: a 404 or 400) from an outage (null: a 429, a 5xx, a
 * timeout). Pages asking at once for the same scope share one read.
 */
export async function findRegionTree(base: string, release: string, scope: string, timeout = PROFILE_TIMEOUT_MS): Promise<RegionTree | typeof UNKNOWN | null> {
  const prefix = `${base}|${release}|`;
  const code = regionScope(scope)?.code ?? (await keptTree(base, release, scope as GeographyId))?.region.code ?? null;
  const hit = code ? trees.get(`${prefix}${code}`) : undefined;
  if (code && hit && Date.now() - hit.at < TTL_MS) {
    keep(trees, `${prefix}${code}`, hit);
    return hit.value;
  }
  const pending = treeReads.get(`${prefix}${scope}`);
  if (pending) return pending;
  const read = (async () => {
    const { status, body } = await getAnswer<AreaHierarchyResponse>(
      `${base}/api/v1/hierarchy?region=${encodeURIComponent(scope)}`, timeout, await loadHeaders());
    if (status === 404 || status === 400) return UNKNOWN;
    if (body?.schemaVersion !== "area-hierarchy.v1") return null;
    const region = body.region ?? LONDON_SCOPE;
    const tree: RegionTree = { region, areas: body.areas, byId: new Map(body.areas.map((area) => [area.geographyId, area])) };
    keep(trees, `${prefix}${region.code}`, { at: Date.now(), value: Promise.resolve(tree) });
    return tree;
  })().finally(() => treeReads.delete(`${prefix}${scope}`));
  treeReads.set(`${prefix}${scope}`, read);
  return read;
}

/** The kept (unexpired) region tree holding an area, without asking the API; null when none holds it. */
async function keptTree(base: string, release: string, id: GeographyId): Promise<RegionTree | null> {
  const prefix = `${base}|${release}|`;
  for (const [key, hit] of [...trees]) {
    if (!key.startsWith(prefix) || Date.now() - hit.at >= TTL_MS) continue;
    const tree = await hit.value;
    if (tree?.byId.has(id)) return tree;
  }
  return null;
}

/**
 * An area and every area above it, root (borough) first: from a region tree already kept, else from
 * /api/v1/areas/{id}/trail (a few rows). Never the region's whole area list (≈1.5 MB): reading it made the
 * first school or area page after a restart wait seconds. [] on an outage or an unknown area.
 */
export async function areaTrail(base: string, release: string, id: GeographyId): Promise<HierarchyArea[]> {
  const kept = await keptTree(base, release, id);
  if (kept) {
    const trail: HierarchyArea[] = [];
    for (let area = kept.byId.get(id); area; area = area.parentId ? kept.byId.get(area.parentId) : undefined) trail.unshift(area);
    return trail;
  }
  const body = await getJson<AreaHierarchyResponse>(`${base}/api/v1/areas/${encodeURIComponent(id)}/trail`, PROFILE_TIMEOUT_MS, await loadHeaders());
  return body?.schemaVersion === "area-hierarchy.v1" && Array.isArray(body.areas) ? body.areas : [];
}

const boroughMemo = new Map<string, { at: number; value: Promise<HierarchyArea[] | null> }>();

/**
 * Every borough (any English local authority) with its region, kept an hour per release: /area/england, the
 * schools hub and the sitemap. Null when real data is unreachable.
 */
export async function loadBoroughs(): Promise<{ mode: DataMode; boroughs: HierarchyArea[] } | null> {
  const defaults = await serverDefaults();
  const mode: DataMode = defaults.mode ?? "demo";
  if (mode === "demo") {
    const loaded = await loadAreaPages();
    return loaded ? { mode, boroughs: loaded.index.data.areas.filter((area) => area.carrier === "lad") } : null;
  }
  const base = evidenceServiceUrl();
  if (!base) return null;
  const key = `${base}|${defaults.served?.productReleaseId ?? "unknown"}`;
  const hit = boroughMemo.get(key);
  const value = hit && Date.now() - hit.at < TTL_MS ? hit.value
    : loadHeaders().then((headers) => getJson<AreaHierarchyResponse>(`${base}/api/v1/hierarchy?carrier=lad`, PACK_TIMEOUT_MS, headers)).then((body) => {
      if (body?.schemaVersion !== "area-hierarchy.v1") { boroughMemo.delete(key); return null; }
      // An API without ?carrier= answers with every area: keep the boroughs.
      return body.areas.filter((area) => area.carrier === "lad");
    });
  if (value !== hit?.value) keep(boroughMemo, key, { at: Date.now(), value });
  const boroughs = await value;
  return boroughs ? { mode, boroughs } : null;
}

/** The regions the data serves, in ONS order (London alone while CLOSE_KNIT_ENGLAND is off). */
export async function loadRegionsServed(): Promise<RankScope[]> {
  return englandRegions((await loadBoroughs())?.boroughs ?? []).map(({ region }) => region);
}

/** Every area of one region (a code), for its sitemap shard; [] when unknown or unreachable. */
export async function loadRegionAreas(code: string): Promise<HierarchyArea[]> {
  const defaults = await serverDefaults();
  if ((defaults.mode ?? "demo") === "demo") {
    return (await loadAreaPages())?.index.data.areas.filter((area) => (area.regionCode ?? LONDON_SCOPE.code) === code) ?? [];
  }
  const base = evidenceServiceUrl();
  if (!base) return [];
  return (await regionTree(base, defaults.served?.productReleaseId ?? "unknown", code, PACK_TIMEOUT_MS))?.areas ?? [];
}

/**
 * An area and every area above it, root (borough) first, for an entity page's
 * breadcrumbs; [] when the hierarchy cannot be read (the page still opens).
 */
export async function loadAreaTrail(id: GeographyId): Promise<HierarchyArea[]> {
  const defaults = await serverDefaults();
  if ((defaults.mode ?? "demo") !== "demo") {
    const base = evidenceServiceUrl();
    return base ? areaTrail(base, defaults.served?.productReleaseId ?? "unknown", id) : [];
  }
  const byId = (await loadAreaPages())?.index.byId ?? null;
  const trail: HierarchyArea[] = [];
  for (let area = byId?.get(id); area; area = area.parentId ? byId?.get(area.parentId) : undefined) trail.unshift(area);
  return trail;
}

/** The area profile (same endpoint as the Overview scorecard) for one area page. */
export async function loadAreaProfile(loaded: LoadedAreaPages, id: GeographyId): Promise<AreaProfileResponse | null> {
  if (loaded.mode === "demo") return fixtureAreaProfile(id, loaded.latestPeriod);
  const base = evidenceServiceUrl();
  if (!base) return null;
  const { headers } = await import("next/headers");
  const profile = await getJson<AreaProfileResponse>(
    `${base}/api/v1/areas/${encodeURIComponent(id)}/profile?period=${loaded.latestPeriod}`,
    PROFILE_TIMEOUT_MS, clientHeaders(await headers()));
  if (profile?.schemaVersion !== "area-profile.v1" || !Array.isArray(profile.metrics)) return null;
  if (profile.metrics.some((metric) => isFixtureSourceVersion(metric.sourceVersion))) return null;
  return profile;
}
