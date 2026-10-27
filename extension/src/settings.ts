// The user's choices from the first-run screen (options page): kept in chrome.storage.sync, or in local
// storage where sync is missing or fails. Docs: docs/superpowers/specs/2026-10-18-extension-legal-strategy.md §3.
import type { BuyerAssumptions, ListingFacts } from "./types";

export type PortalId = ListingFacts["portal"];
/** "side-panel": a panel beside the page; "inline": on the page, under the price. */
export type UserMode = "side-panel" | "inline";

export const PORTALS: PortalId[] = ["rightmove", "zoopla", "onthemarket", "spareroom", "openrent"];
export const PORTAL_NAMES: Record<PortalId, string> = {
  rightmove: "Rightmove", zoopla: "Zoopla", onthemarket: "OnTheMarket", spareroom: "SpareRoom", openrent: "OpenRent",
};
export const SETTINGS_KEY = "settings";

export interface Settings {
  portals: Record<PortalId, UserMode>;
  /** Send the open listing's coordinates and price to show area data. Off: the extension shows nothing. */
  sendListing: boolean;
  /** Help anonymous area-demand statistics (stored only, for now). */
  demandStats: boolean;
  /** Usage analytics, on with opt-out. */
  analytics: boolean;
  /** Mortgage assumptions for the monthly cost, worked out on this device. */
  buyer: BuyerAssumptions;
}

export const DEFAULT_BUYER: BuyerAssumptions = { depositPct: 10, ratePct: 4.5, years: 30, firstTime: false, additionalHome: false };

export const DEFAULT_SETTINGS: Settings = {
  // Owner, 2026-10-18: on the page by default (as the market does), SpareRoom beside it ("integrations" ban).
  portals: { rightmove: "inline", zoopla: "inline", onthemarket: "inline", spareroom: "side-panel", openrent: "inline" },
  sendListing: true,
  demandStats: false,
  analytics: true,
  buyer: DEFAULT_BUYER,
};

/** The release that brought the first-run screen: installs and updates from before it open the settings once. */
export const FIRST_RUN_VERSION = "0.4.0";

export function firstRunDue(reason: string, previousVersion?: string): boolean {
  if (reason === "install") return true;
  if (reason !== "update" || !previousVersion) return false;
  const parts = (version: string) => version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(previousVersion), parts(FIRST_RUN_VERSION)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

/** The slice of a chrome.storage area this needs (a fake in tests). */
export interface Area {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** chrome.storage.sync, falling back to local when sync is missing or refuses (Safari, quota, policy). */
export function settingsArea(storage: { sync?: Area; local: Area }): Area {
  const sync = storage.sync;
  if (!sync) return storage.local;
  return {
    get: (key) => sync.get(key).catch(() => storage.local.get(key)),
    set: (items) => sync.set(items).catch(() => storage.local.set(items)),
  };
}

export async function loadSettings(area: Area): Promise<Settings> {
  try {
    return normalise((await area.get(SETTINGS_KEY))[SETTINGS_KEY]);
  } catch {
    return normalise(null);
  }
}

export async function saveSettings(area: Area, settings: Settings): Promise<Settings> {
  const clean = normalise(settings);
  await area.set({ [SETTINGS_KEY]: clean });
  return clean;
}

/** Stored values over the defaults; anything malformed keeps its default. */
export function normalise(raw: unknown): Settings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const portals = { ...DEFAULT_SETTINGS.portals };
  const stored = (value.portals && typeof value.portals === "object" ? value.portals : {}) as Record<string, unknown>;
  for (const portal of PORTALS) {
    if (stored[portal] === "inline" || stored[portal] === "side-panel") portals[portal] = stored[portal] as UserMode;
  }
  const flag = (key: "sendListing" | "demandStats" | "analytics") =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : DEFAULT_SETTINGS[key];
  return { portals, sendListing: flag("sendListing"), demandStats: flag("demandStats"), analytics: flag("analytics"),
    buyer: buyerOf(value.buyer) };
}

function buyerOf(raw: unknown): BuyerAssumptions {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof BuyerAssumptions, unknown>>;
  const num = (key: "depositPct" | "ratePct" | "years", min: number, max: number) => {
    const n = value[key];
    return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? n : DEFAULT_BUYER[key];
  };
  return {
    depositPct: num("depositPct", 0, 100), ratePct: num("ratePct", 0, 20), years: Math.round(num("years", 1, 40)),
    firstTime: value.firstTime === true, additionalHome: value.additionalHome === true,
  };
}
