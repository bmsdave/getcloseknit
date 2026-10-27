import {
  apiBase, DISMISSED_KEY, ENABLED_KEY, ext, LINKED_KEY, OPTED_OUT_KEY, PROFILE_KEY, PROFILE_SAVED_AT_KEY, profileKey,
} from "./api";
import { localDate, remember } from "./memory";
import type { BadgesMessage, LineAllowedMessage, Surface } from "./adapters/results/types";
import { badges } from "./badges";
import { cardRequestBody, enrichCard, requestHeaders } from "./local";
import { configLoader, lineAllowed, resolveMode, type EffectiveMode, type Features } from "./mode";
import { firstRunDue, loadSettings, settingsArea, type Area, type Settings } from "./settings";
import { CardMemory, REVALIDATE_MS } from "./swr";
import type { Card, ExtensionState, ListingFacts, ListingView, Message, PanelView } from "./types";

/** Server cards for an hour, before the listing-only facts are merged in (those change with the device's memory and settings). */
const memory = new CardMemory();
const sidePanel = (ext as { sidePanel?: typeof chrome.sidePanel }).sidePanel;
/** Safari has no side panel: the floating side card stands in for it. */
const hasSidePanel = typeof sidePanel?.open === "function";
const loadConfig = configLoader(apiBase, (url, init) => fetch(url, init));
const settingsStore = settingsArea(ext.storage as unknown as { sync?: Area; local: Area });

ext.runtime.onInstalled.addListener((details) => {
  if (firstRunDue(details.reason, details.previousVersion)) void ext.runtime.openOptionsPage();
});

ext.runtime.onMessage.addListener((message: Message | BadgesMessage | LineAllowedMessage, sender, reply) => {
  if (message.type === "open-side-panel") {
    // sidePanel.open must run inside the click's user gesture: nothing is awaited before it.
    const tabId = sender.tab?.id;
    if (hasSidePanel && tabId !== undefined) sidePanel!.open({ tabId }).then(() => reply(true), () => reply(false));
    else reply(false);
    return true;
  }
  const answer = message.type === "badges" ? gatedBadges(message)
    : message.type === "line-allowed" ? allowsLine(message.portal, message.surface) : handle(message, sender);
  answer.then(reply, () => reply(null));
  return true; // the reply comes later
});

ext.tabs?.onRemoved.addListener((tabId) => void setTabFacts(tabId, null));

async function handle(message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "listing":
      return listing(message.facts, sender);
    case "listing-card":
      return freshCard(message.facts);
    case "panel-card":
      return panelCard(message.tabId);
    case "offer-profile":
      return offerProfile(message.profile, sender);
    case "set-profile":
      if (!fromCloseKnit(sender)) return null;
      await saveProfile(message.profile);
      await ext.storage.local.set({ [LINKED_KEY]: true, [OPTED_OUT_KEY]: false });
      return state();
    case "dismiss-profile":
      await ext.storage.local.set({ [DISMISSED_KEY]: profileKey(message.profile) });
      return null;
    case "forget-profile":
      await ext.storage.local.remove([PROFILE_KEY, PROFILE_SAVED_AT_KEY, DISMISSED_KEY]);
      await ext.storage.local.set({ [LINKED_KEY]: false, [OPTED_OUT_KEY]: true });
      memory.clear();
      return state();
    case "opt-in":
      await ext.storage.local.set({ [OPTED_OUT_KEY]: false });
      return state();
    case "set-enabled":
      await ext.storage.local.set({ [ENABLED_KEY]: message.enabled });
      return state();
    case "state":
      return state();
  }
  return null;
}

async function state(): Promise<ExtensionState> {
  const stored = await ext.storage.local.get([PROFILE_KEY, PROFILE_SAVED_AT_KEY, ENABLED_KEY, OPTED_OUT_KEY]);
  return {
    enabled: stored[ENABLED_KEY] !== false,
    hasProfile: stored[PROFILE_KEY] != null,
    optedOut: stored[OPTED_OUT_KEY] === true,
    profileSavedAt: (stored[PROFILE_SAVED_AT_KEY] as string | undefined) ?? null,
    apiBase,
  };
}

interface Gate {
  mode: EffectiveMode;
  disabled: boolean;
  consent: boolean;
  settings: Settings;
  features: Features;
  notice: string | null;
}

/** The portal's mode (the server's switch over the user's choice) and the user's consent to send. */
async function gate(portal: ListingFacts["portal"]): Promise<Gate> {
  const [settings, config, stored] = await Promise.all([loadSettings(settingsStore), loadConfig(), ext.storage.local.get(ENABLED_KEY)]);
  const disabled = stored[ENABLED_KEY] === false;
  const mode = disabled ? "off" : resolveMode(config.portals[portal].mode, settings.portals[portal], hasSidePanel);
  return { mode, disabled, consent: settings.sendListing, settings, features: config.features, notice: config.notice };
}

/**
 * A listing page reports what it shows (or null): kept for the side panel. Unless the card goes there, the kept
 * card comes back at once (or a neighbour's area-only one, or none), with ``refresh`` when the page should ask
 * for the up-to-date one ("listing-card").
 */
async function listing(facts: ListingFacts | null, sender: chrome.runtime.MessageSender): Promise<ListingView | null> {
  const tabId = sender.tab?.id;
  if (tabId !== undefined) {
    await setTabFacts(tabId, facts);
    void ext.runtime.sendMessage({ type: "panel-update", tabId }).catch(() => undefined);
  }
  if (!facts) return null;
  const { mode, consent, settings } = await gate(facts.portal);
  if (mode === "off" || mode === "side-panel" || !consent) return { mode, consent, card: null };
  const context = await cardContext(facts, settings);
  const kept = memory.get(facts, profileKey(context.profile));
  if (!kept) return { mode, consent, card: null, refresh: true };
  return { mode, consent, card: enrichCard(kept.card, facts, context.local),
    refresh: kept.provisional || kept.age >= REVALIDATE_MS };
}

/** The up-to-date card for a listing page, when its portal still shows the card there and the user lets it send. */
async function freshCard(facts: ListingFacts): Promise<Card | null> {
  const { mode, consent, settings } = await gate(facts.portal);
  if (mode === "off" || mode === "side-panel" || !consent) return null;
  return fetchCard(facts, settings, await cardContext(facts, settings));
}

async function panelCard(tabId: number): Promise<PanelView> {
  const facts = await tabFacts(tabId);
  if (!facts) return { state: "no-listing" };
  const { mode, disabled, consent, settings, notice } = await gate(facts.portal);
  if (disabled) return { state: "disabled" };
  if (mode === "off") return { state: "off", notice };
  if (!consent) return { state: "no-consent" };
  const context = await cardContext(facts, settings);
  const kept = memory.get(facts, profileKey(context.profile));
  const result = kept && !kept.provisional ? enrichCard(kept.card, facts, context.local)
    : await fetchCard(facts, settings, context);
  return result.status === "error" ? { state: "error" } : { state: "ok", card: result };
}

/** The results and map popup lines: wherever the portal is not off, whatever the user chose for listing pages. */
async function gatedBadges(message: BadgesMessage) {
  const { mode, consent, settings, features } = await gate(message.portal);
  if (!lineAllowed(mode, consent, features, message.surface ?? "results")) return null;
  return badges(message, settings.analytics);
}

async function allowsLine(portal: ListingFacts["portal"], surface: Surface): Promise<boolean> {
  const { mode, consent, features } = await gate(portal);
  return lineAllowed(mode, consent, features, surface);
}

interface CardContext {
  profile: unknown;
  local: Parameters<typeof enrichCard>[2];
}

/** The saved search and what this device adds to the card. Every view is remembered, even one served from memory. */
async function cardContext(facts: ListingFacts, settings: Settings): Promise<CardContext> {
  const stored = await ext.storage.local.get([PROFILE_KEY]);
  const seen = await remember(ext.storage.local, facts)
    .catch(() => ({ firstSeen: null, priceChanges: facts.priceChanges }));
  return {
    profile: stored[PROFILE_KEY] ?? null,
    local: { firstSeen: seen.firstSeen ?? null, priceChanges: seen.priceChanges ?? [], buyer: settings.buyer,
      today: localDate(Date.now()) },
  };
}

/** The card from the server: it sees the minimum; costs, price story and lease are added here. */
async function fetchCard(facts: ListingFacts, settings: Settings, context: CardContext): Promise<Card> {
  try {
    const response = await fetch(`${apiBase}/api/v1/listing-card`, {
      method: "POST",
      headers: requestHeaders(settings.analytics),
      body: cardRequestBody(facts, context.profile),
      credentials: "omit",
    });
    if (!response.ok) return { v: 1, status: "error", blocks: [] };
    const result = (await response.json()) as Card;
    memory.set(facts, profileKey(context.profile), result);
    return enrichCard(result, facts, context.local);
  } catch {
    return { v: 1, status: "error", blocks: [] };
  }
}

// What each tab's listing is, for the side panel. Session storage outlives the worker's restarts.
const tabMemory = new Map<number, ListingFacts>();
const session = (ext.storage as { session?: chrome.storage.StorageArea }).session;

async function setTabFacts(tabId: number, facts: ListingFacts | null): Promise<void> {
  if (facts) tabMemory.set(tabId, facts);
  else tabMemory.delete(tabId);
  if (!session) return;
  await (facts ? session.set({ [`tab:${tabId}`]: facts }) : session.remove(`tab:${tabId}`)).catch(() => undefined);
}

async function tabFacts(tabId: number): Promise<ListingFacts | null> {
  const known = tabMemory.get(tabId);
  if (known || !session) return known ?? null;
  const stored = await session.get(`tab:${tabId}`).catch(() => ({} as Record<string, unknown>));
  return (stored[`tab:${tabId}`] as ListingFacts | undefined) ?? null;
}

/**
 * The Close Knit page found a saved search. Once linked ("Use it"), a changed search is kept in step
 * quietly; otherwise the page offers it, unless it was turned down.
 */
async function offerProfile(profile: unknown, sender: chrome.runtime.MessageSender): Promise<"offer" | "same" | "synced" | "dismissed"> {
  if (!fromCloseKnit(sender)) return "dismissed";
  const stored = await ext.storage.local.get([PROFILE_KEY, DISMISSED_KEY, LINKED_KEY, OPTED_OUT_KEY]);
  if (profileKey(stored[PROFILE_KEY]) === profileKey(profile)) return "same";
  if (stored[LINKED_KEY] === true) {
    await saveProfile(profile);
    return "synced";
  }
  if (stored[OPTED_OUT_KEY] === true || stored[DISMISSED_KEY] === profileKey(profile)) return "dismissed";
  return "offer";
}

async function saveProfile(profile: unknown): Promise<void> {
  await ext.storage.local.set({ [PROFILE_KEY]: profile, [PROFILE_SAVED_AT_KEY]: new Date().toISOString() });
  memory.clear();
}

/** Only the Close Knit site may hand over a saved search. */
function fromCloseKnit(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.url?.startsWith(`${apiBase}/`));
}
