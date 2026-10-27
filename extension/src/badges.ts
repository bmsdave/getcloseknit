// The background worker's half of the results-page line: one POST for a page's results, each result
// cached for an hour (per portal, listing and saved search).
import type { Badge, Badges, BadgesMessage } from "./adapters/results/types";
import { apiBase, ENABLED_KEY, ext, PROFILE_KEY, profileKey } from "./api";
import { badgesRequestBody, requestHeaders } from "./local";

const CACHE_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 3000;
/** The API takes at most 30 results per request (api/area_api/listing_badges.py MAX_ITEMS). */
export const MAX_BATCH = 30;

const cache = new Map<string, { at: number; badge: Badge }>();

/** The background checks the portal's mode and the user's consent before calling this. */
export async function badges(message: BadgesMessage, analytics: boolean): Promise<Badges | null> {
  const stored = await ext.storage.local.get([PROFILE_KEY, ENABLED_KEY]);
  if (stored[ENABLED_KEY] === false) return null;
  const profile = stored[PROFILE_KEY] ?? null;
  const scale = profile ? "match" : "area";
  const key = (id: string) => `${message.portal}:${id}:${profileKey(profile)}`;
  const now = Date.now();
  const found = new Map<string, Badge>();
  const missing = [];
  for (const item of message.items) {
    const hit = cache.get(key(item.listingId));
    if (hit && now - hit.at < CACHE_MS) found.set(item.listingId, hit.badge);
    else missing.push(item);
  }
  for (let start = 0; start < missing.length; start += MAX_BATCH) {
    const fetched = await post(message.portal, missing.slice(start, start + MAX_BATCH), profile, analytics);
    if (!fetched) break;
    for (const badge of fetched.items) {
      found.set(badge.listingId, badge);
      cache.set(key(badge.listingId), { at: now, badge });
    }
  }
  prune(now);
  return { scale, items: message.items.flatMap((item) => found.get(item.listingId) ?? []) };
}

async function post(portal: BadgesMessage["portal"], items: BadgesMessage["items"], profile: unknown,
  analytics: boolean): Promise<Badges | null> {
  try {
    const response = await fetch(`${apiBase}/api/v1/listing-badges`, {
      method: "POST",
      headers: requestHeaders(analytics),
      body: badgesRequestBody(portal, items, profile),
      credentials: "omit",
    });
    return response.ok ? ((await response.json()) as Badges) : null;
  } catch {
    return null;
  }
}

function prune(now: number): void {
  if (cache.size <= CACHE_LIMIT) return;
  for (const [key, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(key);
  // Still too many fresh ones: the oldest go first (a Map keeps insertion order).
  for (const key of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) break;
    cache.delete(key);
  }
}
