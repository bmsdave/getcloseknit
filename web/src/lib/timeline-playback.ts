/**
 * Timeline playback plumbing: which periods to fetch ahead, and a small LRU
 * of value packs shared by the map and the timeline's prefetch, so playback
 * paints from memory and a pack is only fetched once.
 */
import type { ValuePack } from "./contracts";
import { mapFetch } from "./polite-fetch";
import { readValuePack } from "./value-pack-compact";

/** Packs fetched ahead of the shown step while the timeline plays: about a second of monthly steps. */
export const PREFETCH_AHEAD = 6;
/** Packs kept in memory (each ~1.4 MB of JSON for 5k LSOAs): the ones ahead, the shown one and a change base. */
export const PACK_CACHE_SIZE = 12;

/** Up to `count` steps after the one a period sits on; playback stops at the last. */
export function upcomingPeriods(steps: readonly string[], period: string, count = PREFETCH_AHEAD): string[] {
  const exact = steps.indexOf(period);
  const after = exact >= 0 ? exact + 1 : steps.findIndex((step) => step > period);
  return after < 0 ? [] : steps.slice(after, after + count);
}

/** Wall time to play every step once at a given interval. */
export function playbackDurationMs(steps: readonly string[], intervalMs: number): number {
  return steps.length * intervalMs;
}

/**
 * Playback hands each step to the app this long before the map should start
 * morphing to it, so the step's render, refresh and feature-state writes are
 * done in time and the morphs run back to back on the beat.
 */
export const PLAY_LEAD_MS = 120;

/**
 * When the step after one due at `due` (the map starts morphing to it then)
 * is due, given the step was handed over at `landed`: one interval after the
 * beat, so timer and render latency never pile up. A step handed over more
 * than half an interval late (a slow pack) restarts the beat from then, so
 * playback never races to catch up.
 */
export function nextStepDue(due: number, landed: number, intervalMs: number, leadMs = PLAY_LEAD_MS): number {
  const late = landed - (due - leadMs) > intervalMs / 2;
  return (late ? landed + leadMs : due) + intervalMs;
}

let beat: { period: string; startAt: number } | null = null;

/**
 * The step playback handed over last and when its morph should start
 * (performance.now() ms), shared by the timeline and the map like the pack
 * cache. Any other period change (a slider move) has no start time: it
 * morphs at once.
 */
export const playbackBeat = {
  set(period: string, startAt: number) {
    beat = { period, startAt };
  },
  clear() {
    beat = null;
  },
  startFor(period: string): number | null {
    return beat?.period === period ? beat.startAt : null;
  },
};

export interface LruCache<Value> {
  get(key: string): Value | undefined;
  set(key: string, value: Value): void;
  delete(key: string): void;
  keys(): string[];
}

/** Least-recently-used map: a get refreshes an entry; a set past capacity drops the oldest. */
export function createLruCache<Value>(capacity: number): LruCache<Value> {
  const entries = new Map<string, Value>();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key)!;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > capacity) entries.delete(entries.keys().next().value!);
    },
    delete(key) {
      entries.delete(key);
    },
    keys() {
      return [...entries.keys()];
    },
  };
}

export type PackLoader<Pack> = (path: string, signal?: AbortSignal) => Promise<Pack | null>;

export interface PackCache<Pack> {
  /** The pack for a path: from memory, from a request already in flight, or a new request. */
  get(path: string, signal?: AbortSignal): Promise<Pack | null>;
  /** Start requests for paths not yet held (no abort: a prefetch is wanted whoever asks next). */
  prefetch(paths: readonly string[]): void;
  /** Whether a path is held or in flight. */
  has(path: string): boolean;
}

/**
 * Requests share one promise per path. A failed or aborted request is
 * forgotten so the next ask retries; null (not found) is cached like a pack.
 */
export function createPackCache<Pack>(load: PackLoader<Pack>, capacity = PACK_CACHE_SIZE): PackCache<Pack> {
  const cache = createLruCache<Promise<Pack | null>>(capacity);
  function request(path: string, signal?: AbortSignal): Promise<Pack | null> {
    const pending = load(path, signal);
    cache.set(path, pending);
    pending.catch(() => {
      if (cache.get(path) === pending) cache.delete(path);
    });
    return pending;
  }
  return {
    get(path, signal) {
      return cache.get(path) ?? request(path, signal);
    },
    prefetch(paths) {
      for (const path of paths) {
        if (cache.get(path) === undefined) request(path).catch(() => undefined);
      }
    },
    has(path) {
      return cache.keys().includes(path);
    },
  };
}

/** Null when the server has no such pack (404); throws on any other failure or abort, so the cache forgets it. */
async function fetchPack(path: string, signal?: AbortSignal): Promise<ValuePack | null> {
  const response = await mapFetch(path, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`value pack ${response.status}`);
  return readValuePack(await response.json());
}

/** Small packs kept for England's map pieces (lib/map-coverage.ts): one LAD's areas or one region's MSOAs each. */
export const PIECE_CACHE_SIZE = 96;

/** Whether a pack path is one of England's small pieces (a LAD or region chunk, or a roll-up), not London whole. */
export function isPiecePackPath(path: string): boolean {
  const query = new URLSearchParams(path.split("?")[1] ?? "");
  const chunk = query.get("chunk");
  return query.has("level") || (chunk !== null && chunk !== "E12000007");
}

/**
 * Two caches behind one: London-sized packs (London whole, an unchunked pack) in the PACK_CACHE_SIZE one, England's
 * small pieces in their own, so a view of twenty LADs never pushes out the months the timeline fetched ahead.
 */
export function createSplitPackCache<Pack>(load: PackLoader<Pack>): PackCache<Pack> {
  const whole = createPackCache(load);
  const pieces = createPackCache(load, PIECE_CACHE_SIZE);
  const pick = (path: string) => (isPiecePackPath(path) ? pieces : whole);
  return {
    get: (path, signal) => pick(path).get(path, signal),
    prefetch: (paths) => {
      whole.prefetch(paths.filter((path) => !isPiecePackPath(path)));
      pieces.prefetch(paths.filter(isPiecePackPath));
    },
    has: (path) => pick(path).has(path),
  };
}

/** The page's value-pack cache, shared by the map and the timeline. */
export const valuePackCache = createSplitPackCache<ValuePack>(fetchPack);
