import { useSyncExternalStore } from "react";

import type { GeographyId } from "./contracts";
import {
  listShortlists,
  notifySavedChange,
  readSavedAreaCount,
  SAVED_CHANGE_EVENT,
  SAVED_SHORTLISTS_KEY,
  savedAreas,
} from "./saved-shortlists";
import { propertyPath } from "./property-profile";
import { loadUserCandidates, saveUserCandidates, USER_CANDIDATES_KEY } from "./user-candidates";

/**
 * ♡ Saved beyond areas and homes: schools and places (a restaurant, a gym), kept on this device only.
 * Areas stay in the saved shortlists (lib/saved-shortlists.ts) and homes in the user candidates
 * (lib/user-candidates.ts, "Save this home"); useSaved() reads all three. The stored value is one
 * plain, versioned JSON document, so a later login can upload it as it is.
 */
export const SAVED_ITEMS_KEY = "close-knit.saved-items.v1";
export const SAVED_ITEMS_SCHEMA = "saved-items.v1";
export const MAX_SAVED_ITEMS = 200;

export type SavedItemKind = "school" | "place";

export interface SavedItem {
  kind: SavedItemKind;
  /** school: the URN; place: the map's place id. */
  id: string;
  name: string;
  /** One short line under the name: "Primary school", "Restaurant · Hygiene 5/5". */
  meta?: string;
  /** Its own page (/school/…); a place has none. */
  href?: string;
  /** [lon, lat]: where its ♡ sits on the map. */
  at?: [number, number];
  savedAt: string;
}

export type SavedItemInput = Omit<SavedItem, "savedAt">;

interface SavedItemsDocument {
  schemaVersion: typeof SAVED_ITEMS_SCHEMA;
  items: SavedItem[];
}

const KINDS: readonly SavedItemKind[] = ["school", "place"];
const EMPTY: SavedItem[] = [];

function cleanText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** One stored entry, or null when it is not one (dropped, never repaired into something else). */
export function cleanSavedItem(value: unknown): SavedItem | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const kind = entry.kind as SavedItemKind;
  const id = cleanText(entry.id, 64);
  const name = cleanText(entry.name, 120);
  if (!KINDS.includes(kind) || !id || !name) return null;
  const at = Array.isArray(entry.at) && entry.at.length === 2 && entry.at.every((n) => typeof n === "number" && Number.isFinite(n))
    ? [entry.at[0], entry.at[1]] as [number, number] : undefined;
  const href = cleanText(entry.href, 200);
  const meta = cleanText(entry.meta, 120);
  return {
    kind, id, name,
    ...(meta ? { meta } : {}),
    // Only this site's own pages: a stored link never leaves it.
    ...(href && href.startsWith("/") && !href.startsWith("//") ? { href } : {}),
    ...(at ? { at } : {}),
    savedAt: cleanText(entry.savedAt, 40) ?? new Date(0).toISOString(),
  };
}

/** The stored document's items, newest first; junk entries are left out. */
export function parseSavedItems(raw: string | null): SavedItem[] {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedItemsDocument> | null;
    if (!parsed || parsed.schemaVersion !== SAVED_ITEMS_SCHEMA || !Array.isArray(parsed.items)) return EMPTY;
    return parsed.items.map(cleanSavedItem).filter((item): item is SavedItem => item !== null);
  } catch {
    return EMPTY;
  }
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function readSavedItems(): SavedItem[] {
  return parseSavedItems(readRaw(SAVED_ITEMS_KEY));
}

export function isSavedItem(items: SavedItem[], kind: SavedItemKind, id: string): boolean {
  return items.some((item) => item.kind === kind && item.id === id);
}

function writeItems(items: SavedItem[]): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const document: SavedItemsDocument = { schemaVersion: SAVED_ITEMS_SCHEMA, items: items.slice(0, MAX_SAVED_ITEMS) };
    store.setItem(SAVED_ITEMS_KEY, JSON.stringify(document));
  } catch {
    return false;
  }
  notifySavedChange();
  return true;
}

/** ♡ pressed: saves the item, or unsaves it when it is saved. `saved` is the state after the press. */
export function toggleSavedItem(input: SavedItemInput): { ok: boolean; saved: boolean } {
  const items = readSavedItems();
  if (isSavedItem(items, input.kind, input.id)) {
    const ok = removeSavedItem(input.kind, input.id);
    return { ok, saved: !ok };
  }
  const item = cleanSavedItem({ ...input, savedAt: new Date().toISOString() });
  if (!item) return { ok: false, saved: false };
  const ok = writeItems([item, ...items]);
  return { ok, saved: ok };
}

export function removeSavedItem(kind: SavedItemKind, id: string): boolean {
  return writeItems(readSavedItems().filter((item) => !(item.kind === kind && item.id === id)));
}

/** A saved home ("Save this home"): its user candidate, named by the address typed or found. */
export interface SavedHome {
  /** The user candidate's id. */
  id: string;
  uprn: string | null;
  name: string;
  href?: string;
}

// components/user-candidates.tsx CANDIDATES_CHANGED: a home saved or removed.
const CANDIDATES_CHANGED = "close-knit:candidates-changed";

function savedHomes(rawCandidates: string | null): SavedHome[] {
  if (!rawCandidates) return [];
  return loadUserCandidates().store.candidates.map((candidate) => ({
    id: candidate.id,
    uprn: candidate.uprn,
    name: candidate.address.value,
    ...(candidate.uprn ? { href: propertyPath(candidate.uprn) } : {}),
  }));
}

/** Unsave a home: its user candidate (asking price and notes too) leaves this device. */
export function removeSavedHome(id: string): boolean {
  const loaded = loadUserCandidates();
  if (loaded.storageDenied) return false;
  const written = saveUserCandidates({ ...loaded.store, candidates: loaded.store.candidates.filter((candidate) => candidate.id !== id) });
  if (!written.ok) return false;
  window.dispatchEvent(new Event(CANDIDATES_CHANGED));
  notifySavedChange();
  return true;
}

/** How many things are saved: distinct areas plus homes, schools and places (the header's ♡ N). */
export function savedCount(rawShortlists: string | null, rawItems: string | null, homes = 0): number {
  return readSavedAreaCount(rawShortlists) + homes + parseSavedItems(rawItems).length;
}

export interface SavedSnapshot {
  areas: { geographyId: GeographyId; name: string }[];
  homes: SavedHome[];
  items: SavedItem[];
  count: number;
}

const NOTHING: SavedSnapshot = { areas: [], homes: [], items: EMPTY, count: 0 };
let cacheKey: string | null = null;
let cache: SavedSnapshot = NOTHING;

function snapshot(): SavedSnapshot {
  const rawShortlists = readRaw(SAVED_SHORTLISTS_KEY);
  const rawItems = readRaw(SAVED_ITEMS_KEY);
  const rawCandidates = readRaw(USER_CANDIDATES_KEY);
  const key = [rawShortlists, rawItems, rawCandidates].map((raw) => raw ?? "").join("\u0000");
  if (key === cacheKey) return cache;
  cacheKey = key;
  const areas = rawShortlists ? savedAreas(listShortlists().shortlists) : [];
  const homes = savedHomes(rawCandidates);
  const items = parseSavedItems(rawItems);
  // The count reads the stored area ids as they are (as the header always has), even an entry the list cannot open.
  cache = { areas, homes, items, count: savedCount(rawShortlists, rawItems, homes.length) };
  return cache;
}

function subscribe(onChange: () => void): () => void {
  for (const event of [SAVED_CHANGE_EVENT, CANDIDATES_CHANGED, "storage"]) window.addEventListener(event, onChange);
  return () => {
    for (const event of [SAVED_CHANGE_EVENT, CANDIDATES_CHANGED, "storage"]) window.removeEventListener(event, onChange);
  };
}

/** Everything saved on this device, live: any ♡ on the page updates the rest. Empty on the server. */
export function useSaved(): SavedSnapshot {
  return useSyncExternalStore(subscribe, snapshot, () => NOTHING);
}
