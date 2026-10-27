// Per-listing memory on this device: when the extension first saw a listing, at what price, and the price
// changes it saw since. It never leaves the device except as a card request's `firstSeen` and `priceChanges`.
import type { ListingFacts, PricePoint } from "./types";

export const MEMORY_KEY = "listingMemory";
export const MEMORY_LIMIT = 500;
const MAX_CHANGES = 20;

interface Entry {
  firstSeen: PricePoint;
  /** Observed price changes, oldest first. */
  changes: PricePoint[];
  /** When it was last seen (ms), for dropping the oldest listings. */
  seenAt: number;
}

/** The slice of chrome.storage.local this needs (a fake in tests). */
export interface Store {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Notes this view of the listing and returns what the card request carries: the first sighting and the page's
 * price changes merged with the ones seen here. Views are handled one at a time so none is lost.
 */
export function remember(
  store: Store, facts: ListingFacts, now: number = Date.now(),
): Promise<Pick<ListingFacts, "firstSeen" | "priceChanges">> {
  const next = queue.then(() => update(store, facts, now));
  queue = next.catch(() => undefined);
  return next;
}

async function update(store: Store, facts: ListingFacts, now: number): Promise<Pick<ListingFacts, "firstSeen" | "priceChanges">> {
  const today = localDate(now);
  const memory = ((await store.get(MEMORY_KEY))[MEMORY_KEY] ?? {}) as Record<string, Entry>;
  const key = `${facts.portal}:${facts.listingId}`;
  let entry = memory[key];
  const price = facts.askingPrice;
  if (price !== null) {
    if (!entry) entry = { firstSeen: { date: today, price }, changes: [], seenAt: now };
    const last = entry.changes.at(-1)?.price ?? entry.firstSeen.price;
    if (price !== last) entry.changes = mergeChanges(entry.changes, [{ date: today, price }]);
    entry.seenAt = now;
    memory[key] = entry;
    await store.set({ [MEMORY_KEY]: trim(memory) });
  }
  return {
    firstSeen: entry?.firstSeen ?? null,
    priceChanges: mergeChanges(facts.priceChanges ?? [], entry?.changes ?? []),
  };
}

/** One change a day (the page's own wins over one seen here), oldest first, the latest 20. */
export function mergeChanges(page: PricePoint[], seen: PricePoint[]): PricePoint[] {
  const byDate = new Map<string, PricePoint>();
  for (const point of [...seen, ...page]) byDate.set(point.date, point);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_CHANGES);
}

/** At most 500 listings: the ones seen longest ago go first. */
function trim(memory: Record<string, Entry>): Record<string, Entry> {
  const keys = Object.keys(memory);
  if (keys.length <= MEMORY_LIMIT) return memory;
  const keep = keys.sort((a, b) => memory[b].seenAt - memory[a].seenAt).slice(0, MEMORY_LIMIT);
  return Object.fromEntries(keep.map((key) => [key, memory[key]]));
}

/** YYYY-MM-DD on this device's calendar. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, "0")).join("-");
}
