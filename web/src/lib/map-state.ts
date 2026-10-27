import type {
  AddressId,
  AreaSummary,
  GeographyId,
  MapLayerId,
} from "./contracts";
import { canonicalAreaId } from "./contracts";
import { CENSUS_METRIC_IDS } from "./census-layers";
import { NATURE_METRIC_IDS, DETAIL_LAYER_IDS } from "./nature-layers";
import { isFixtureSourceVersion, realPilotUnavailableReason } from "./fixtures";
import { type MatchList, parseMatchList } from "./match-map";

export type DataMode = "demo" | "real";

export type ConnectionStatus = "online" | "offline";

export interface MapState {
  latitude: number;
  longitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  layer: MapLayerId;
  period: string;
  selected: GeographyId | null;
  mode: DataMode;
  release: string;
  /**
   * Which ten My match lists, its best ("top") or the ten least like the search ("bottom"); the map
   * pins the same ten. Absent = top. In the address as `list=bottom` only (per user: never on public pages).
   */
  matchList?: MatchList;
}

export type { MatchList };

export interface MapStateParse {
  state: MapState;
  appliedLegacyDefault: boolean;
  rejectedConflict: boolean;
}

export interface LayerTransition {
  layer: MapLayerId;
  period: string;
  notice: string | null;
}

export interface ModeTransition {
  mode: DataMode;
  release: string;
  notice: string | null;
}

export type EvidenceRequest =
  | { kind: "idle" }
  | { kind: "unavailable"; reason: string }
  | { kind: "fetch"; path: string };

export interface ModeEvidencePayload {
  summary: AreaSummary;
  priceTimeline: AreaSummary[];
  metricTimeline: AreaSummary[];
  /** Friendly name and postcode district (null when the API has none). */
  friendlyName?: string | null;
  postcodeDistrict?: string | null;
  /** The area's parent (an LSOA's MSOA) as the API reports it; null when none. */
  parentId?: GeographyId | null;
  /** The region the area's ranks are within (the card's breadcrumb root); null: London, as before England. */
  rankScope?: { code: string; name: string } | null;
  /** The area's shape's box [west, south, east, north]; null when the API has none. */
  bbox?: [number, number, number, number] | null;
}

export interface EvidencePayloadLike {
  summary: { sourceVersion: string };
  priceTimeline?: Array<{ sourceVersion?: string }>;
  metricTimeline?: Array<{ sourceVersion?: string }>;
}

export function isFixturePayload(payload: EvidencePayloadLike): boolean {
  if (isFixtureSourceVersion(payload.summary.sourceVersion)) return true;
  const entries = [...(payload.priceTimeline ?? []), ...(payload.metricTimeline ?? [])];
  return entries.some(
    (entry) => typeof entry.sourceVersion === "string" && isFixtureSourceVersion(entry.sourceVersion),
  );
}

export type ModeEvidenceResult =
  | { status: "available"; payload: ModeEvidencePayload }
  | { status: "unavailable"; reason: string; sourceVersion?: string }
  | { status: "connection-lost"; reason: string }
  | { status: "stale" };

/** A result for a request still current (not superseded). */
export type SettledEvidenceResult = Exclude<ModeEvidenceResult, { status: "stale" }>;

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface FetchOptions {
  signal?: AbortSignal;
  scope?: EvidenceRequestScope;
  sequence?: number;
  onConnection?: (status: ConnectionStatus) => void;
}

export interface EvidenceRequestScope {
  issue(): number;
  isCurrent(sequence: number): boolean;
}

/**
 * Documented defaults for links shared before AE-07: demo fixtures, never
 * real data. Conflicting mode/release combinations fall back here too and
 * report rejectedConflict so the UI can say so explicitly.
 */
export const DEMO_RELEASE = "preview-2026-09";
export const REAL_PILOT_RELEASE = "official-2026-06";
export const LEGACY_DEFAULT_MODE: DataMode = "demo";
export const LEGACY_DEFAULT_RELEASE = DEMO_RELEASE;
export const SAVED_MAP_STATE_KEY = "close-knit.map-state.v2";
const DEMO_SHORT = "Demo data";
const DEMO_REST = " · not for decisions";

export const DATA_MODE_LABELS: Record<DataMode, string> = {
  demo: `${DEMO_SHORT}${DEMO_REST}`,
  real: "Real data",
};

export function describeDataStatus(args: {
  mode: DataMode;
  release: string;
  connection: ConnectionStatus;
}): string {
  const online = `${DATA_MODE_LABELS[args.mode]} · ${args.release}`;
  return args.connection === "offline" ? `Offline · ${online}` : online;
}

/**
 * The footer line outside ?dev=1: only what changes how to read the map —
 * offline, and demo data that is not for decisions. Null when there is
 * nothing to say (the real pilot online); the release id stays in dev.
 */
export function describePublicDataStatus(args: { mode: DataMode; connection: ConnectionStatus }): string | null {
  const parts = [
    ...(args.connection === "offline" ? ["Offline"] : []),
    ...(args.mode === "demo" ? [DATA_MODE_LABELS.demo] : []),
  ];
  return parts.length ? parts.join(" · ") : null;
}
/**
 * The public status as the footer shows it on one line: "Demo data" in view, the rest of the
 * warning (" · not for decisions") for screen readers and the tooltip. Shown + hidden read as the full text.
 */
export function compactDataStatus(status: string): { shown: string; hidden: string } {
  return status.endsWith(DATA_MODE_LABELS.demo)
    ? { shown: status.slice(0, -DEMO_REST.length), hidden: DEMO_REST }
    : { shown: status, hidden: "" };
}
export const REAL_PUBLISHED_LAYERS: readonly MapLayerId[] = ["crime", "price-per-square-metre", "deprivation", "income", "social-renting", "stock-value-per-square-metre", "station-access", "food-hygiene", "road-collisions", "noise", "air-no2", "typical-price", "typical-price-flat", "typical-price-terraced", "typical-price-semi", "typical-price-detached", ...CENSUS_METRIC_IDS, ...NATURE_METRIC_IDS, "hpi-change-5y", "hpi-change-10y", ...DETAIL_LAYER_IDS, "personal-match", "mobile-4g-indoor", "mobile-5g-outdoor", "future-station-distance", "rent-change-1y", "rent-change-5y", "council-tax-band-mean", "short-lets-per-1000", "pipeline-homes-per-1000", "hmo-per-1000", "typical-rent", "typical-rent-1-bed", "typical-rent-3-bed", "flood-risk", "good-schools-nearby", "good-schools-nearby-secondary", "student-share", "supermarket-walk", "gp-walk", "broadband-gigabit"];

const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The map never leaves London: Greater London's extent plus a margin for the
 * panels ([west, south], [east, north]), and no zoom wide enough to show more.
 */
export const LONDON_BOUNDS: [[number, number], [number, number]] = [[-0.85, 51.15], [0.65, 51.83]];
export const MIN_MAP_ZOOM = 9;
/** A link may ask for England's widest view (lib/map-coverage.ts ENGLAND_MIN_ZOOM); the London map still stops at MIN_MAP_ZOOM. */
export const MIN_LINK_ZOOM = 5;
/**
 * The closest the map goes. The area tiles stop at zoom 12 and are overzoomed from there: built near-lossless
 * (8192 units a tile, no simplification; api migration 119), a border is off by at most 0.6 m, about 2 px here.
 */
export const MAX_MAP_ZOOM = 18;

/**
 * A link's own pitch wins (the address carries it after load, so a reload
 * keeps the view), then the viewer's 2D/3D choice from Map settings
 * (`chosen`, remembered on this device). Otherwise the Places overlay (on
 * unless ?places=off) is read flat at any width, so the area colours stay
 * visible between its icons, and phones (≤ 800px) open flat: a tilted map
 * wastes the strip above the sheet and hides the colours behind buildings.
 */
export function initialPitch(search: string, width: number, pitch: number, chosen: number | null): number {
  const parameters = new URLSearchParams(search);
  if (parameters.has("pitch")) return pitch;
  if (chosen !== null) return chosen;
  if (parameters.get("places")?.trim() !== "off") return 0;
  return width > 800 ? pitch : 0;
}

export const DEFAULT_MAP_STATE: MapState = {
  latitude: 51.5074,
  longitude: -0.1278,
  zoom: 11,
  pitch: 45,
  bearing: 0,
  layer: "price-per-square-metre",
  period: "2026-06",
  selected: null,
  mode: LEGACY_DEFAULT_MODE,
  release: LEGACY_DEFAULT_RELEASE,
};

export function isPreviewRelease(release: string): boolean {
  return release.startsWith("preview-");
}

export function isModeReleaseConflict(mode: DataMode, release: string): boolean {
  return mode === "demo" ? !isPreviewRelease(release) : isPreviewRelease(release);
}

/**
 * Seeds a bare review-stack URL with the deployment's default mode and
 * release (NEXT_PUBLIC_AE_DEFAULT_*): an explicit link always wins, an
 * invalid default falls back to the documented demo default through the
 * normal conflict path, and no deployment default keeps local behaviour.
 */
export function applyEnvDefaults(
  parameters: URLSearchParams,
  env: { mode?: string; release?: string },
): void {
  if (!isDemoAllowed(parameters, env.mode)) {
    // Anything but a well-formed real choice falls back to the deployment's own
    // defaults: an unparseable mode or release would otherwise land on the legacy
    // demo default.
    const mode = parameters.get("mode");
    const release = parameters.get("release");
    const badMode = mode !== null && mode !== "real";
    const badRelease = release !== null && (!RELEASE_PATTERN.test(release) || isPreviewRelease(release));
    if (badMode || badRelease) {
      parameters.delete("mode");
      parameters.delete("release");
    }
  }
  if (!parameters.has("mode") && (env.mode === "demo" || env.mode === "real")) {
    parameters.set("mode", env.mode);
  }
  if (!parameters.has("release") && env.release && RELEASE_PATTERN.test(env.release)) {
    parameters.set("release", env.release);
  }
}

/**
 * A real deployment serves real data: ?mode=demo (or a preview release) is a
 * developer switch, honoured only with ?dev=1.
 */
export function isDemoAllowed(parameters: URLSearchParams, deploymentMode: string | undefined): boolean {
  return deploymentMode !== "real" || parameters.get(DEV_QUERY_PARAM) === "1";
}

export function modeConflictNotice(parameters: URLSearchParams): string | null {
  if (!parseMapStateWithStatus(parameters).rejectedConflict) return null;
  const mode = parameters.get("mode") ?? "missing";
  const release = parameters.get("release") ?? "missing";
  return `Conflicting data request (mode ${mode}, release ${release}); reset to demo defaults.`;
}

/**
 * The notice for a link's ?mode=/&release=, or null. A real deployment ignores them without ?dev=1 (isDemoAllowed)
 * and stays on real data, so a visitor is told nothing (RELEASE-CHECKLIST: /?mode=demo stays on Real data).
 */
export function urlModeNotice(search: string, demoAllowed: boolean): string | null {
  return demoAllowed ? modeConflictNotice(new URLSearchParams(search)) : null;
}

export function normalizeModeRelease(
  mode: string | null,
  release: string | null,
): { mode: DataMode; release: string; appliedLegacyDefault: boolean; rejectedConflict: boolean } {
  const cleanMode = (mode ?? "").trim();
  const cleanRelease = (release ?? "").trim();
  if (cleanMode === "" && cleanRelease === "") return modeDefault(false);
  const validMode = cleanMode === "demo" || cleanMode === "real" ? cleanMode : null;
  const validRelease = RELEASE_PATTERN.test(cleanRelease) ? cleanRelease : null;
  if (!validMode || !validRelease || isModeReleaseConflict(validMode, validRelease)) {
    return modeDefault(true);
  }
  return { mode: validMode, release: validRelease, appliedLegacyDefault: false, rejectedConflict: false };
}

export function parseMapStateWithStatus(parameters: URLSearchParams): MapStateParse {
  const normalized = normalizeModeRelease(parameters.get("mode"), parameters.get("release"));
  const state: MapState = {
    latitude: numberParameter(parameters, "lat", DEFAULT_MAP_STATE.latitude, -90, 90),
    longitude: numberParameter(parameters, "lng", DEFAULT_MAP_STATE.longitude, -180, 180),
    zoom: numberParameter(parameters, "zoom", DEFAULT_MAP_STATE.zoom, MIN_LINK_ZOOM, 18),
    pitch: numberParameter(parameters, "pitch", DEFAULT_MAP_STATE.pitch, 0, 60),
    bearing: numberParameter(parameters, "bearing", DEFAULT_MAP_STATE.bearing, -180, 180),
    layer: metricParameter(parameters.get("layer")),
    period: periodParameter(parameters.get("period")),
    selected: geographyParameter(parameters.get("selected")),
    mode: normalized.mode,
    release: normalized.release,
  };
  if (parseMatchList(parameters.get("list")) === "bottom") state.matchList = "bottom";
  return { state, appliedLegacyDefault: normalized.appliedLegacyDefault, rejectedConflict: normalized.rejectedConflict };
}

export function parseMapState(parameters: URLSearchParams): MapState {
  return parseMapStateWithStatus(parameters).state;
}

/**
 * A link that names an area but no map position should open on that area,
 * not on the default London view: the map fits the area once on load. Any
 * usable lat, lng or zoom is an explicit position and wins.
 */
export function shouldFitSelectedArea(parameters: URLSearchParams): boolean {
  if (!geographyParameter(parameters.get("selected"))) return false;
  return !["lat", "lng", "zoom"].some((key) => {
    const raw = parameters.get(key);
    return raw !== null && raw.trim() !== "" && Number.isFinite(Number(raw));
  });
}

export function serializeMapState(state: MapState): string {
  const parameters = new URLSearchParams({
    lat: String(state.latitude),
    lng: String(state.longitude),
    zoom: String(state.zoom),
    pitch: String(state.pitch),
    bearing: String(state.bearing),
    layer: state.layer,
    period: state.period,
    mode: state.mode,
    release: state.release,
  });
  if (state.selected) parameters.set("selected", state.selected);
  if (state.matchList === "bottom" && state.layer === "personal-match") parameters.set("list", "bottom");
  return parameters.toString();
}

/** The home chosen on the map: its UPRN and its address id, either of which may be unknown. */
export interface MapHome { uprn: string | null; addressId: AddressId | null }

const UPRN_PARAMETER = /^\d{1,12}$/;
const ADDRESS_PARAMETER = /^uk:addr:[A-Za-z0-9_-]{1,64}$/;

/**
 * `uprn=…&address=uk:addr:…` reselect a home when the map opens (the property
 * page's "Open on the map"), with the same names as the area page's link.
 * They travel in the address only, never in the saved view. Null when neither is usable.
 */
export function homeFromQuery(search: string): MapHome | null {
  const parameters = new URLSearchParams(search);
  const uprn = parameters.get("uprn");
  const address = parameters.get("address");
  const home: MapHome = {
    uprn: uprn && UPRN_PARAMETER.test(uprn) ? uprn : null,
    addressId: address && ADDRESS_PARAMETER.test(address) ? (address as AddressId) : null,
  };
  return home.uprn || home.addressId ? home : null;
}

export function withHomeQuery(query: string, home: MapHome | null): string {
  const parameters = new URLSearchParams(query);
  parameters.delete("uprn");
  parameters.delete("address");
  if (home?.uprn && UPRN_PARAMETER.test(home.uprn)) parameters.set("uprn", home.uprn);
  if (home?.addressId && ADDRESS_PARAMETER.test(home.addressId)) parameters.set("address", home.addressId);
  return parameters.toString();
}

export function buildShareUrl(origin: string, state: MapState): string {
  return `${origin.replace(/\/+$/, "")}/?${serializeMapState(state)}`;
}

export const DIAGNOSTICS_QUERY_PARAM = "diagnostics";
/** ?dev=1 shows the data mode switch and release ids (internals) in the UI. */
export const DEV_QUERY_PARAM = "dev";

/** A ranking's top 10 on the map (lib/ranking-top.ts RANK_PARAM): kept until its card's ✕ drops it. */
const RANK_QUERY_PARAM = "rank";
const RANK_SLUG = /^[a-z0-9-]{1,80}$/;

/** ?saved=1: the Saved panel is open (lib/saved-panel.ts SAVED_PARAM). */
const SAVED_QUERY_PARAM = "saved";

/** ?school=<urn>: a school's card is open in the side panel (lib/school-card.ts SCHOOL_PARAM). */
const SCHOOL_QUERY_PARAM = "school";
const SCHOOL_URN = /^[0-9]{6}$/;

/**
 * Keeps ?diagnostics=1, ?dev=1 and ?saved=1 in the address when the map rewrites it, and a ranking's
 * ?rank=<slug> (CUJ10): a reload or a shared address shows the same numbered top 10 the ranking's "On map ↗" opened.
 * An open school's ?school=<urn> stays too (close-knit.tsx drops it when the panel goes back to the area).
 */
export function preserveDiagnosticsQuery(serialized: string, search: string): string {
  const current = new URLSearchParams(search);
  const flags = [DIAGNOSTICS_QUERY_PARAM, DEV_QUERY_PARAM, SAVED_QUERY_PARAM].filter((flag) => current.get(flag) === "1");
  const rank = current.get(RANK_QUERY_PARAM);
  const keepRank = rank !== null && RANK_SLUG.test(rank);
  const school = current.get(SCHOOL_QUERY_PARAM);
  const keepSchool = school !== null && SCHOOL_URN.test(school);
  if (flags.length === 0 && !keepRank && !keepSchool) return serialized;
  const preserved = new URLSearchParams(serialized);
  if (keepRank) preserved.set(RANK_QUERY_PARAM, rank);
  if (keepSchool) preserved.set(SCHOOL_QUERY_PARAM, school);
  for (const flag of flags) preserved.set(flag, "1");
  return preserved.toString();
}

export function isLayerAvailableInMode(layer: MapLayerId, mode: DataMode): boolean {
  // Custom criteria are evaluated on request in either mode (preview counts without the API).
  if (mode === "demo" || /^custom:[a-z0-9-]{1,24}$/.test(layer)) return true;
  return (REAL_PUBLISHED_LAYERS as readonly string[]).includes(layer);
}

export function areSchoolsAvailableInMode(mode: DataMode): boolean {
  return mode === "demo";
}

export function areJourneysAvailableInMode(mode: DataMode): boolean {
  return mode === "demo";
}

export function areForecastsAvailableInMode(mode: DataMode): boolean {
  return mode === "demo";
}

export function applyLayerSelection(
  current: { layer: MapLayerId; period: string; mode: DataMode; release: string },
  next: MapLayerId,
  nextDefaultPeriod: string,
  nextLabel: string,
): LayerTransition {
  if (!isLayerAvailableInMode(next, current.mode)) {
    return { layer: current.layer, period: current.period, notice: realPilotUnavailableReason(nextLabel, current.release) };
  }
  return { layer: next, period: nextDefaultPeriod, notice: null };
}

export function applyModeSwitch(
  current: { mode: DataMode; release: string },
  next: DataMode,
): ModeTransition {
  if (next === current.mode) return { mode: current.mode, release: current.release, notice: null };
  if (next === "real") {
    const release = isPreviewRelease(current.release) ? REAL_PILOT_RELEASE : current.release;
    return { mode: "real", release, notice: `Real data (${release}): crime, deprivation, income, social renting and market level are published; other match factors stay unavailable.` };
  }
  const release = isPreviewRelease(current.release) ? current.release : DEMO_RELEASE;
  return { mode: "demo", release, notice: `Demo data (${release}) is for product exploration.` };
}

export function shouldAdoptSavedState(search: string): boolean {
  const parameters = new URLSearchParams(search);
  return parameters.get("mode") === null && parameters.get("release") === null;
}

/**
 * What a returning visitor's saved mode/release become once the server has
 * said what it serves today: a saved real release is replaced by the served
 * real release (the API only ever serves one active release, so a stale label
 * would lie), a saved demo choice on a real deployment is ignored unless demo
 * is allowed (?dev=1), and demo deployments restore as saved.
 */
export function adoptSavedState(
  saved: Pick<MapState, "mode" | "release">,
  initial: Pick<MapState, "mode" | "release">,
  demoAllowed = true,
): Pick<MapState, "mode" | "release"> {
  if (saved.mode === "demo" && initial.mode === "real" && !demoAllowed) return { mode: "real", release: initial.release };
  if (saved.mode === "real" && initial.mode === "real") return { mode: "real", release: initial.release };
  return { mode: saved.mode, release: saved.release };
}

export function restoreSavedMapState(raw: string | null): MapState | null {
  if (!raw) return null;
  try {
    const parsed = parseMapStateWithStatus(new URLSearchParams(raw));
    return parsed.rejectedConflict ? null : parsed.state;
  } catch {
    return null;
  }
}

/**
 * The map at the view last saved on this device ("Back to the map"), or a bare map. A view saved
 * before the camera settled has no lat/lng/zoom: none are invented, so the map still fits the area.
 */
export function savedMapHref(raw: string | null): string {
  const saved = restoreSavedMapState(raw);
  if (!saved) return "/";
  const parameters = new URLSearchParams(serializeMapState(saved));
  const given = new URLSearchParams(raw ?? "");
  for (const key of ["lat", "lng", "zoom"]) if (!given.has(key)) parameters.delete(key);
  return `/?${parameters.toString()}`;
}

/**
 * The last saved view's place and layer, for a link that opens the map on an area (the area page's
 * "Open on map"). Null when nothing usable was saved or it has no settled camera.
 */
export function savedMapView(raw: string | null): { latitude: number; longitude: number; zoom: number; layer: string } | null {
  const saved = restoreSavedMapState(raw);
  const given = new URLSearchParams(raw ?? "");
  if (!saved || !["lat", "lng", "zoom"].every((key) => given.has(key))) return null;
  return { latitude: saved.latitude, longitude: saved.longitude, zoom: saved.zoom, layer: saved.layer };
}

/** A published month, "2026-06": the only period the API accepts. */
export const PERIOD_PATTERN = /^\d{4}-\d{2}$/;

export function areaEvidencePath(query: {
  selected: GeographyId;
  metric: string;
  period: string;
  mode: DataMode;
  release: string;
}): string {
  const parameters = new URLSearchParams({
    metric: query.metric,
    period: query.period,
    mode: query.mode,
    release: query.release,
  });
  return `/api/v1/areas/${encodeURIComponent(query.selected)}?${parameters.toString()}`;
}

export function valuePackPath(query: { metric: string; period: string; mode: DataMode; release: string }): string {
  const parameters = new URLSearchParams({ mode: query.mode, release: query.release });
  return `/api/v1/value-packs/${encodeURIComponent(query.metric)}/${encodeURIComponent(query.period)}?${parameters.toString()}`;
}

export function matchRequestPath(mode: DataMode, release: string): string {
  const parameters = new URLSearchParams({ mode, release });
  return `/api/v1/matches?${parameters.toString()}`;
}

/**
 * The month to ask a metric for: the map's month when the metric is published for it
 * (a deep link's ?period=2025-01 is honoured), else the metric's latest month on or before it, else its
 * default. Deprivation is published for 2025-01 only, so the map's 2026-06 asks for 2025-01, never a 404.
 * A definition without months yet (the real-mode placeholder) keeps the map's month.
 */
export function periodForMetric(metric: { periods: readonly string[]; defaultPeriod: string }, period: string): string {
  if (metric.periods.length === 0 || metric.periods.includes(period)) return period;
  const earlier = metric.periods.filter((candidate) => candidate <= period).sort();
  return earlier.at(-1) ?? (metric.defaultPeriod || period);
}

export function planEvidenceRequest(args: {
  selected: GeographyId | null;
  layer: MapLayerId;
  layerLabel: string;
  metric: string;
  period: string;
  mode: DataMode;
  release: string;
}): EvidenceRequest {
  if (!args.selected || args.layer === "personal-match") return { kind: "idle" };
  // No month yet (a real-mode placeholder before /api/v1/metrics answers): never "?period=" (a 400 on
  // every selection); the release's own definition asks again with its month in a moment.
  if (!PERIOD_PATTERN.test(args.period)) return { kind: "idle" };
  if (!isLayerAvailableInMode(args.layer, args.mode)) {
    return { kind: "unavailable", reason: realPilotUnavailableReason(args.layerLabel, args.release) };
  }
  const path = areaEvidencePath({
    selected: args.selected,
    metric: args.metric,
    period: args.period,
    mode: args.mode,
    release: args.release,
  });
  return { kind: "fetch", path };
}

export function createEvidenceRequestScope(): EvidenceRequestScope {
  let latest = 0;
  return {
    issue() {
      latest += 1;
      return latest;
    },
    isCurrent(sequence: number) {
      return sequence === latest;
    },
  };
}

/**
 * Single client-side routing boundary for area evidence (AE-07): real mode
 * never surfaces fixture releases, a lost connection stays explicit, and a
 * response from a superseded mode/selection reports stale instead of
 * overwriting current state. There is no fallback to demo fixtures here.
 */
export async function requestAreaEvidence(
  request: { path: string; mode: DataMode; release: string },
  fetchImpl: FetchLike,
  options: FetchOptions = {},
): Promise<ModeEvidenceResult> {
  if (isStale(options)) return { status: "stale" };
  let response;
  try {
    response = await fetchImpl(request.path, { signal: options.signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    options.onConnection?.("offline");
    return { status: "connection-lost", reason: "evidence-service-unreachable" };
  }
  if (isStale(options)) return { status: "stale" };
  // Any answer, a 502 during a deploy included, means the connection is there: only a request that
  // never returns is "offline". A 5xx still reads as connection-lost below, so the area offers Try again.
  options.onConnection?.("online");
  if (!response.ok) return failedResponse(response.status);
  return readAreaEvidenceBody(await response.json(), request);
}

/**
 * An area evidence body's verdict, the same as requestAreaEvidence gives once the body is in; the area
 * page reads the server's copy through it (null: the server got a 404).
 */
export function readAreaEvidenceBody(body: unknown, request: { mode: DataMode; release: string }): SettledEvidenceResult {
  if (body === null) return failedResponse(404);
  const payload = parseEvidencePayload(body);
  if (!payload) return { status: "unavailable", reason: "invalid-evidence-response" };
  if (request.mode === "real" && isFixturePayload(payload)) {
    return {
      status: "unavailable",
      reason: `fixture-release-unavailable-in-real-mode (${request.release})`,
      sourceVersion: payload.summary.sourceVersion,
    };
  }
  return { status: "available", payload };
}

function modeDefault(rejected: boolean) {
  return {
    mode: LEGACY_DEFAULT_MODE,
    release: LEGACY_DEFAULT_RELEASE,
    appliedLegacyDefault: !rejected,
    rejectedConflict: rejected,
  };
}

function numberParameter(
  parameters: URLSearchParams,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = parameters.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const candidate = Number(raw);
  if (!Number.isFinite(candidate)) return fallback;
  return Math.min(maximum, Math.max(minimum, candidate));
}

/** Map layers that were merged into another; old links open the layer that replaced them. */
export const MERGED_LAYERS: Partial<Record<MapLayerId, MapLayerId>> = {
  // Old stock-value links open the price layer (homes there show their recorded sale).
  "stock-value-per-square-metre": "price-per-square-metre",
  // Layers v5 (PR 1): Kebab shops vs cafés was the inverse of Cafés › Coffee vs kebab; Fewer bars & pubs is Nightlife set to lower.
  "custom:kebab-cafe": "custom:good-coffee-kebab",
  "custom:quiet-nights": "custom:nightlife",
  // Layers v5 (PR 3): Universities and colleges became Student areas (its points draw at street zoom).
  "custom:universities": "student-share",
};

function metricParameter(value: string | null): MapLayerId {
  const valid: MapLayerId[] = [
    "price-per-square-metre",
    "crime",
    "deprivation",
    "income",
    "social-renting",
    "station-access",
    "food-hygiene",
    "noise",
    "road-collisions",
    "air-no2",
    "typical-price",
    "typical-price-flat",
    "typical-price-terraced",
    "typical-price-semi",
    "typical-price-detached",
    ...CENSUS_METRIC_IDS,
    ...NATURE_METRIC_IDS,
    ...DETAIL_LAYER_IDS,
    "hpi-change-5y",
    "hpi-change-10y",
    "personal-match",
    "ownership-company-share",
    "ownership-overseas-share",
    "short-lets-per-1000",
    "mobile-4g-indoor",
    "mobile-5g-outdoor",
    "future-station-distance",
    "rent-change-1y",
    "rent-change-5y",
    "council-tax-band-mean",
    "pipeline-homes-per-1000",
    "hmo-per-1000",
    "typical-rent",
    "typical-rent-1-bed",
    "typical-rent-3-bed",
    "flood-risk",
    "good-schools-nearby",
    "good-schools-nearby-secondary",
    "student-share",
    "supermarket-walk",
    "gp-walk",
    "broadband-gigabit",
  ];
  const merged = MERGED_LAYERS[value as MapLayerId];
  if (merged) return merged;
  // A custom criterion's layer; the explorer falls back to My match when the profile lacks it.
  if (value && /^custom:[a-z0-9-]{1,24}$/.test(value)) return value as MapLayerId;
  return valid.includes(value as MapLayerId) ? (value as MapLayerId) : DEFAULT_MAP_STATE.layer;
}

function periodParameter(value: string | null): string {
  return value && PERIOD_PATTERN.test(value) ? value : DEFAULT_MAP_STATE.period;
}

function geographyParameter(raw: string | null): GeographyId | null {
  const value = raw && canonicalAreaId(raw);  // an old uk:borough: id (before step R2) as its uk:lad: one
  return value && /^uk:(lsoa|msoa|lad):E\d{8}$/.test(value)
    ? (value as GeographyId)
    : null;
}

function isStale(options: FetchOptions): boolean {
  return !!options.scope && options.sequence !== undefined && !options.scope.isCurrent(options.sequence);
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error as { name: unknown }).name === "AbortError";
}

function failedResponse(status: number): SettledEvidenceResult {
  return status >= 500
    ? { status: "connection-lost", reason: `evidence-service-unreachable (status ${status})` }
    : { status: "unavailable", reason: `evidence-unavailable (status ${status})` };
}

function parseEvidencePayload(body: unknown): ModeEvidencePayload | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as {
    summary?: unknown; priceTimeline?: unknown; metricTimeline?: unknown;
    friendlyName?: unknown; postcodeDistrict?: unknown; parentId?: unknown; rankScope?: unknown; bbox?: unknown;
  };
  const scope = candidate.rankScope as { code?: unknown; name?: unknown } | null | undefined;
  if (!candidate.summary || typeof candidate.summary !== "object") return null;
  const summary = candidate.summary as AreaSummary;
  if (typeof summary.sourceVersion !== "string") return null;
  return {
    summary,
    priceTimeline: Array.isArray(candidate.priceTimeline) ? candidate.priceTimeline as AreaSummary[] : [],
    metricTimeline: Array.isArray(candidate.metricTimeline) ? candidate.metricTimeline as AreaSummary[] : [],
    friendlyName: typeof candidate.friendlyName === "string" ? candidate.friendlyName : null,
    postcodeDistrict: typeof candidate.postcodeDistrict === "string" ? candidate.postcodeDistrict : null,
    parentId: typeof candidate.parentId === "string" && /^uk:(lsoa|msoa|lad):E\d{8}$/.test(candidate.parentId)
      ? candidate.parentId as GeographyId : null,
    rankScope: scope && typeof scope.code === "string" && typeof scope.name === "string" && scope.name
      ? { code: scope.code, name: scope.name } : null,
    bbox: Array.isArray(candidate.bbox) && candidate.bbox.length === 4 && candidate.bbox.every((value) => typeof value === "number")
      ? candidate.bbox as [number, number, number, number] : null,
  };
}
