// Where the extension shows a portal's card: the server's per-portal switch (GET /api/v1/extension-config,
// changed without a release) over the user's own choice. Docs: 2026-10-18-extension-legal-strategy.md §1.
import type { Surface } from "./adapters/results/types";
import type { PortalId, UserMode } from "./settings";
import { PORTALS } from "./settings";

export type ServerMode = "inline" | "side-panel" | "off";
/**
 * "inline": the summary under the price plus the floating side card; "side-panel": Chrome's side panel and a
 * small pill on the page; "side-card": the floating side card alone (Safari, which has no side panel); "off": nothing.
 */
export type EffectiveMode = "inline" | "side-panel" | "side-card" | "off";

/** Where the legal position is still open (owner, 2026-10-19): on unless the server switches them off. */
export interface Features {
  /** The line under each search result. */
  resultsLine: boolean;
  /** The line inside a portal's map popup card. */
  mapPopup: boolean;
}
export const FEATURES: (keyof Features)[] = ["resultsLine", "mapPopup"];

export interface ExtensionConfig {
  v: 1;
  portals: Record<PortalId, { mode: ServerMode }>;
  features: Features;
  notice: string | null;
}

export const CONFIG_CACHE_MS = 5 * 60 * 1000;

/** When the server cannot be reached: on the page everywhere except SpareRoom (its terms ban integrations). */
export const FALLBACK_CONFIG: ExtensionConfig = {
  v: 1,
  portals: {
    rightmove: { mode: "inline" }, zoopla: { mode: "inline" }, onthemarket: { mode: "inline" },
    spareroom: { mode: "side-panel" }, openrent: { mode: "inline" },
  },
  features: { resultsLine: true, mapPopup: true },
  notice: null,
};

/** Server `off` → nothing; `side-panel` → the panel even if the user chose the page; `inline` → the user's choice. */
export function resolveMode(server: ServerMode, user: UserMode, sidePanel: boolean): EffectiveMode {
  if (server === "off") return "off";
  const wanted = server === "side-panel" ? "side-panel" : user;
  if (wanted === "inline") return "inline";
  return sidePanel ? "side-panel" : "side-card";
}

/**
 * The results and map popup lines show wherever the portal is not off (whatever the user chose for listing pages),
 * the user agreed to send listings and the server's feature switch is on.
 */
export function lineAllowed(mode: EffectiveMode, consent: boolean, features: Features, surface: Surface): boolean {
  return mode !== "off" && consent && features[surface === "map" ? "mapPopup" : "resultsLine"];
}

/** A config from the server's JSON; a portal or feature it leaves out or garbles keeps the fallback's value. */
export function parseConfig(raw: unknown): ExtensionConfig {
  const value = (raw && typeof raw === "object" ? raw : {}) as { portals?: unknown; features?: unknown; notice?: unknown };
  const portals = { ...FALLBACK_CONFIG.portals };
  const stored = (value.portals && typeof value.portals === "object" ? value.portals : {}) as Record<string, { mode?: unknown }>;
  for (const portal of PORTALS) {
    const mode = stored[portal]?.mode;
    if (mode === "inline" || mode === "side-panel" || mode === "off") portals[portal] = { mode };
  }
  const features = { ...FALLBACK_CONFIG.features };
  const flags = (value.features && typeof value.features === "object" ? value.features : {}) as Record<string, unknown>;
  for (const feature of FEATURES) if (typeof flags[feature] === "boolean") features[feature] = flags[feature] as boolean;
  return { v: 1, portals, features, notice: typeof value.notice === "string" && value.notice ? value.notice : null };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Fetches the config at most once every 5 minutes; an unreachable server gives the fallback (also kept 5 minutes). */
export function configLoader(apiBase: string, fetcher: Fetch, clock: () => number = Date.now): () => Promise<ExtensionConfig> {
  let cached: { at: number; config: ExtensionConfig } | null = null;
  let pending: Promise<ExtensionConfig> | null = null;
  return async () => {
    if (cached && clock() - cached.at < CONFIG_CACHE_MS) return cached.config;
    pending ??= (async () => {
      let config = FALLBACK_CONFIG;
      try {
        const response = await fetcher(`${apiBase}/api/v1/extension-config`, { headers: { accept: "application/json" }, credentials: "omit" });
        if (response.ok) config = parseConfig(await response.json());
      } catch {
        // Unreachable: the fallback.
      }
      cached = { at: clock(), config };
      pending = null;
      return config;
    })();
    return pending;
  };
}
