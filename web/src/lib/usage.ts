/**
 * How Close Knit is used, never who uses it (docs/product-analytics.md; stored by api/area_api/usage.py).
 *
 * A few named events go to our own /api/v1/usage in small batches: no third party, no cookie, no IP
 * address, address, budget or search profile. To count returning people (daily/weekly/monthly users,
 * retention) the browser keeps one random id in localStorage. That is first-party analytics for
 * statistical purposes, which UK law (PECR as amended by the Data (Use and Access) Act 2025) allows
 * with a clear explanation and a simple way to object: "Analytics off" on /privacy. Browsers in an
 * EU or EEA time zone get no id (their visits count, but never as a returning person), and Global
 * Privacy Control or Do Not Track turns it all off.
 */

export type UsageName =
  | "page_view" | "engagement" | "search" | "search_empty" | "match_run" | "area_open"
  | "portal_click" | "brief_share" | "watch_open" | "client_error" | "wizard_open" | "wizard_review" | "wizard_show"
  | "layer_view" | "layer_subview" | "layer_time" | "area_select" | "map_view" | "zone_change" | "section_open"
  | "tailor_saved" | "profile_link" | "match_edit";
export type UsageProps = Record<string, string | number | boolean | null | undefined>;
export type AnalyticsMode = "off" | "anonymous" | "counted";

export const ANALYTICS_STORAGE_KEY = "close-knit.analytics.v1";
export const VISITOR_STORAGE_KEY = "close-knit.visitor.v1";
const SESSION_STORAGE_KEY = "close-knit.session.v1";
// Set by opening any page with ?team=1 (cleared by ?team=0): this browser is Close Knit's own, so its
// batches say team: true and the dashboards leave its visits out of live use (area_api.usage.traffic).
export const TEAM_STORAGE_KEY = "close-knit.team.v1";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const FLUSH_DELAY_MS = 5000;
const MAX_QUEUE = 20;
const ENDPOINT = "/api/v1/usage";

/** Time zones of the EU and EEA, where a stored id would need consent; the UK and Crown dependencies are not. */
const EU_ZONES = new Set([
  "Europe/Amsterdam", "Europe/Athens", "Europe/Berlin", "Europe/Bratislava", "Europe/Brussels", "Europe/Bucharest",
  "Europe/Budapest", "Europe/Busingen", "Europe/Copenhagen", "Europe/Dublin", "Europe/Helsinki", "Europe/Lisbon",
  "Europe/Ljubljana", "Europe/Luxembourg", "Europe/Madrid", "Europe/Malta", "Europe/Mariehamn", "Europe/Oslo",
  "Europe/Paris", "Europe/Prague", "Europe/Riga", "Europe/Rome", "Europe/Sofia", "Europe/Stockholm",
  "Europe/Tallinn", "Europe/Vaduz", "Europe/Vienna", "Europe/Vilnius", "Europe/Warsaw", "Europe/Zagreb",
  "Europe/Nicosia", "Asia/Nicosia", "Asia/Famagusta", "Atlantic/Azores", "Atlantic/Canary", "Atlantic/Madeira",
  "Atlantic/Reykjavik", "Arctic/Longyearbyen", "Africa/Ceuta",
]);

export function isEuTimeZone(zone: string | undefined): boolean {
  return zone !== undefined && EU_ZONES.has(zone);
}

/** Off by choice or browser signal; anonymous (no id) in EU time zones; otherwise counted with an id. */
export function analyticsMode(env: { stored: string | null; gpc: boolean; dnt: boolean; timeZone?: string }): AnalyticsMode {
  if (env.stored === "off" || env.gpc || env.dnt) return "off";
  return isEuTimeZone(env.timeZone) ? "anonymous" : "counted";
}

/** A page's path without anything that could point at a home: a property or postcode becomes a template. */
export function pagePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || "/";
  if (/^\/property\//.test(path)) return "/property/:id";
  if (/^\/postcode\/[^/]+\/homes/.test(path)) return "/postcode/:code/homes";
  if (/^\/postcode\//.test(path)) return "/postcode/:code";
  return path.slice(0, 120);
}

const KNOWN_SOURCES: [RegExp, string][] = [
  [/(^|\.)claude\.ai$/, "claude"], [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, "chatgpt"],
  [/(^|\.)google\./, "google"], [/(^|\.)bing\.com$/, "bing"], [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)perplexity\.ai$/, "perplexity"], [/(^|\.)t\.me$|telegram/, "telegram"], [/whatsapp/, "whatsapp"],
];

/** Where a visit came from: an invite, a utm_source, or the referring site's name; null within the site. */
export function trafficSource(referrer: string, search: string, origin: string): string | null {
  const params = new URLSearchParams(search);
  if (params.has("invite")) return "invite";
  const utm = params.get("utm_source")?.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40);
  if (utm) return utm;
  if (!referrer) return null;
  let host: string;
  try {
    const url = new URL(referrer);
    // An accepted invite posts from /?invite=… and lands on / (api/area_api/invites.py).
    if (url.origin === origin) return url.searchParams.has("invite") ? "invite" : null;
    host = url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return KNOWN_SOURCES.find(([pattern]) => pattern.test(host))?.[1] ?? host.slice(0, 60);
}

/** A shared link's kind from the address fragment (never its contents): a search, a shortlist or a brief. */
export function sharedKind(hash: string): string | null {
  if (hash.startsWith("#profile=")) return "search";
  if (hash.startsWith("#shortlist=")) return "shortlist";
  if (hash.startsWith("#brief=")) return "brief";
  return null;
}

export function deviceClass(width: number): "mobile" | "tablet" | "desktop" {
  return width < 640 ? "mobile" : width < 1024 ? "tablet" : "desktop";
}

/** A map view, coarse: zoom to 0.5, the centre to about a kilometre (two decimals). Where people look, not where they are. */
export function coarseView(zoom: number, lat: number, lng: number): { zoom: number; lat: number; lng: number } {
  return { zoom: Math.round(zoom * 2) / 2, lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

// ---- In the browser ---------------------------------------------------------------------------------

interface QueuedEvent {
  name: UsageName;
  props: UsageProps;
}

let queue: QueuedEvent[] = [];
// The map layer on screen, so engaged time can be split by layer (UsageTracker reads it on each tick).
let currentLayer: string | null = null;
let lastMapView = 0;
const MAP_VIEW_GAP_MS = 2000;

export function setUsageLayer(layer: string | null): void {
  currentLayer = layer;
}

export function usageLayer(): string | null {
  return currentLayer;
}

/** A pan or zoom the reader made (not a programmatic move), at most one every two seconds. */
export function trackMapView(zoom: number, lat: number, lng: number, now = Date.now()): void {
  if (now - lastMapView < MAP_VIEW_GAP_MS) return;
  lastMapView = now;
  track("map_view", { ...coarseView(zoom, lat, lng), layer: currentLayer });
}
let timer: ReturnType<typeof setTimeout> | null = null;
let memorySession: string | null = null;

function storage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return typeof window === "undefined" ? null : window[kind];
  } catch {
    return null;
  }
}

function read(store: Storage | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Storage | null, key: string, value: string | null): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // Storage blocked (a private window): the visit still counts, without an id.
  }
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function currentMode(): AnalyticsMode {
  if (typeof window === "undefined") return "off";
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return analyticsMode({ stored: read(storage("localStorage"), ANALYTICS_STORAGE_KEY), gpc: nav.globalPrivacyControl === true,
    dnt: nav.doNotTrack === "1", timeZone });
}

/** "Analytics off" on /privacy: forget the id, drop anything queued and send nothing from now on. */
export function setAnalyticsEnabled(enabled: boolean): void {
  write(storage("localStorage"), ANALYTICS_STORAGE_KEY, enabled ? null : "off");
  if (!enabled) {
    write(storage("localStorage"), VISITOR_STORAGE_KEY, null);
    write(storage("sessionStorage"), SESSION_STORAGE_KEY, null);
    queue = [];
  }
}

function visitorId(mode: AnalyticsMode): string | null {
  if (mode !== "counted") return null;
  const local = storage("localStorage");
  const known = read(local, VISITOR_STORAGE_KEY);
  if (known) return known;
  const fresh = randomId();
  write(local, VISITOR_STORAGE_KEY, fresh);
  return read(local, VISITOR_STORAGE_KEY);
}

/** A visit: a new one after 30 idle minutes. Kept for the tab only (memory only without an id). */
function sessionId(mode: AnalyticsMode, now: number): string {
  const tab = mode === "counted" ? storage("sessionStorage") : null;
  const [id, last] = (read(tab, SESSION_STORAGE_KEY) ?? memorySession ?? "").split(":");
  const current = id && now - Number(last) < SESSION_IDLE_MS ? id : randomId().replace(/-/g, "").slice(0, 24);
  memorySession = `${current}:${now}`;
  write(tab, SESSION_STORAGE_KEY, memorySession);
  return current;
}

/** Whether this browser is marked as the team's, after applying a ?team=1 or ?team=0 in the address. */
export function teamBrowser(search = window.location.search): boolean {
  const local = storage("localStorage");
  const asked = new URLSearchParams(search).get("team");
  if (asked === "1" || asked === "0") write(local, TEAM_STORAGE_KEY, asked === "1" ? "1" : null);
  return read(local, TEAM_STORAGE_KEY) === "1";
}

/** A browser driven by automation (Playwright, Selenium, Puppeteer set navigator.webdriver): counted as tech. */
export function automatedBrowser(): boolean {
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}

// Read ?team= as soon as the page loads: the map rewrites the address with its own state before the
// first batch goes out, so a check at flush time would never see it.
if (typeof window !== "undefined") teamBrowser();

/** Queue one event; batches go out every few seconds and when the page is hidden. */
export function track(name: UsageName, props: UsageProps = {}): void {
  if (currentMode() === "off") return;
  queue.push({ name, props });
  if (queue.length >= MAX_QUEUE) flushUsage();
  else if (timer === null) timer = setTimeout(() => flushUsage(), FLUSH_DELAY_MS);
}

/** Send what is queued; `leaving` uses sendBeacon, which survives the page closing. */
export function flushUsage(leaving = false): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const mode = currentMode();
  if (!queue.length || mode === "off") {
    queue = [];
    return;
  }
  const events = queue.map(({ name, props }) => ({
    name, props: Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined && value !== null)),
  }));
  queue = [];
  const body = JSON.stringify({ visitor: visitorId(mode), session: sessionId(mode, Date.now()),
    device: deviceClass(window.innerWidth), ...(teamBrowser() ? { team: true } : {}),
    ...(automatedBrowser() ? { automated: true } : {}), events });
  try {
    if (leaving && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => undefined);
  } catch {
    // Usage is never worth an error on the page.
  }
}
