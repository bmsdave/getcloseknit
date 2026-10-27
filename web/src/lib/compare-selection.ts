import { useSyncExternalStore } from "react";

import { MAX_COMPARED_AREAS } from "./area-comparison";
import type { GeographyId } from "./contracts";

/**
 * The areas ticked for comparison, kept on this device so a reload, the area page and the home
 * page all see the same selection. Only area ids are stored (no budget, place or other profile
 * field). Every storage access is guarded: when storage is blocked the selection lives in memory
 * for this page and nothing fails.
 */
export const COMPARE_STORAGE_KEY = "close-knit.compare.v1";
export const COMPARE_CHANGE_EVENT = "close-knit:compare-change";
export const MAX_COMPARE = MAX_COMPARED_AREAS;

const AREA_ID = /^uk:[a-z]+:[A-Z]\d{8}$/;
const EMPTY: GeographyId[] = [];

// The page's own copy: set when storage refused a write, or for a shared link that is shown, not stored.
let memory: GeographyId[] | null = null;
// Snapshot cache so useSyncExternalStore sees one array per stored value.
let snapshotRaw: string | null | undefined;
let snapshot: GeographyId[] = EMPTY;

export function cleanCompared(value: unknown): GeographyId[] {
  if (!Array.isArray(value)) return EMPTY;
  const ids = value.filter((id): id is GeographyId => typeof id === "string" && AREA_ID.test(id));
  return [...new Set(ids)].slice(0, MAX_COMPARE);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  try {
    return storage()?.getItem(COMPARE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The compared areas: the page's own copy when there is one, else what is stored. */
export function readCompared(): GeographyId[] {
  if (memory) return memory;
  const raw = readRaw();
  if (raw === snapshotRaw) return snapshot;
  snapshotRaw = raw;
  try {
    snapshot = raw ? cleanCompared(JSON.parse(raw)) : EMPTY;
  } catch {
    snapshot = EMPTY;
  }
  return snapshot;
}

/** Replaces the selection; returns false when storage refused and only the page's copy holds it. */
export function writeCompared(ids: GeographyId[]): boolean {
  const next = cleanCompared(ids);
  let stored = false;
  try {
    const store = storage();
    if (store) {
      if (next.length) store.setItem(COMPARE_STORAGE_KEY, JSON.stringify(next));
      else store.removeItem(COMPARE_STORAGE_KEY);
      stored = true;
    }
  } catch {
    stored = false;
  }
  memory = stored ? null : next;
  notify();
  return stored;
}

/** A shared link's compared areas: shown on this page, never stored until the user changes them. */
export function showComparedOnly(ids: GeographyId[]): void {
  memory = cleanCompared(ids);
  notify();
}

export interface CompareChange { ids: GeographyId[]; refused: GeographyId | null }

export function toggleCompared(id: GeographyId): CompareChange {
  const current = readCompared();
  if (!current.includes(id)) return addCompared(id);
  const ids = current.filter((item) => item !== id);
  writeCompared(ids);
  return { ids, refused: null };
}

/** Adds an area unless it is already there; a full comparison refuses it (`refused`) and keeps everyone. */
export function addCompared(id: GeographyId): CompareChange {
  const current = readCompared();
  if (current.includes(id)) return { ids: current, refused: null };
  if (current.length >= MAX_COMPARE) return { ids: current, refused: id };
  const ids = [...current, id];
  writeCompared(ids);
  return { ids, refused: null };
}

export function removeCompared(id: GeographyId): GeographyId[] {
  const ids = readCompared().filter((item) => item !== id);
  writeCompared(ids);
  return ids;
}

function notify(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(COMPARE_CHANGE_EVENT));
  } catch {
    // No Event constructor: the next read still sees the change.
  }
}

/** Calls back on any change: this page (custom event) or another tab (storage event). */
export function subscribeCompared(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === COMPARE_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(COMPARE_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(COMPARE_CHANGE_EVENT, listener);
  };
}

const serverSnapshot = () => EMPTY;

/** The compared areas, live; empty on the server and until hydration. */
export function useComparedAreas(): GeographyId[] {
  return useSyncExternalStore(subscribeCompared, readCompared, serverSnapshot);
}

/** Tests only: forget the page's copy and the snapshot cache. */
export function resetCompareMemory(): void {
  memory = null;
  snapshotRaw = undefined;
  snapshot = EMPTY;
}
