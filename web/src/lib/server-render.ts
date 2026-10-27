/**
 * Server only. A server render of a page is one page view for the API's rate limit, not one charge
 * per read: every API read the render makes carries CLOSE_KNIT_INTERNAL_KEY (shared with the API) and
 * the render's id, and the API charges the viewer's "render" class once per id
 * (api/area_api/ratelimit.py). Without the key nothing is sent and each read is charged as before.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { cache } from "react";

export const INTERNAL_KEY_HEADER = "x-close-knit-internal";
export const RENDER_ID_HEADER = "x-close-knit-render";

type HeaderReader = { get(name: string): string | null };

// One object per request inside a React server render (generateMetadata and the page share it);
// outside one (route handlers, tests) React's cache does not memoize, so each call gets a new object.
const renderScope = cache((): { id: string | null } => ({ id: null }));

/** Marks this request as a page render and returns its id (the same id for every call in it). */
export function beginRender(): string {
  const scope = renderScope();
  scope.id ??= randomUUID();
  return scope.id;
}

/** The id of the page render this request began, or null (no render began; always outside one). */
export function currentRender(): string | null {
  return renderScope().id;
}

function internalKey(): string | null {
  return process.env.CLOSE_KNIT_INTERNAL_KEY?.trim() || null;
}

/** The headers that put an API read into render `id`; none without the key or an id. */
export function renderHeaders(id: string | null): Record<string, string> {
  const key = internalKey();
  return key && id ? { [INTERNAL_KEY_HEADER]: key, [RENDER_ID_HEADER]: id } : {};
}

/**
 * The render headers of an incoming request, passed on only when they carry this server's own key:
 * the area page's in-process section reads (lib/area-page-seed.ts) have it, a browser cannot.
 */
export function trustedRenderHeaders(headers: HeaderReader): Record<string, string> {
  const key = internalKey();
  const sent = headers.get(INTERNAL_KEY_HEADER);
  if (!key || !sent || !sameSecret(sent, key)) return {};
  return renderHeaders(headers.get(RENDER_ID_HEADER));
}

/** Constant time, whatever the lengths: the digests are compared. */
function sameSecret(sent: string, key: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(sent), digest(key));
}
