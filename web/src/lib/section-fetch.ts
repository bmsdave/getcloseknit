import { politeFetch } from "./polite-fetch";
import { createSectionBatcher, readSectionLines, SECTIONS_PATH, type DeliverSection } from "./section-batch";

/** ≡ debugging and e2e: "off" sends every section on its own, "on" batches whatever the build says. */
export const SECTION_BATCH_KEY = "close-knit.section-batch";

/**
 * Whether an area's section reads go in one request: on unless the build says
 * NEXT_PUBLIC_SECTION_BATCH=off, and a viewer's SECTION_BATCH_KEY overrides either way. The e2e server builds
 * with it on, as production does (e2e/fixtures.ts reads a spec's mocked section URLs on their own).
 */
export function sectionBatchOn(): boolean {
  try {
    const chosen = typeof window === "undefined" ? null : window.localStorage.getItem(SECTION_BATCH_KEY);
    if (chosen === "on" || chosen === "off") return chosen === "on";
  } catch {
    // Storage blocked: the build's default.
  }
  return process.env.NEXT_PUBLIC_SECTION_BATCH !== "off";
}

async function sendBatch(urls: string[], deliver: DeliverSection): Promise<void> {
  const response = await politeFetch(SECTIONS_PATH, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify({ urls }),
  });
  if (!response.ok || !response.body) throw new Error(`sections: http-${response.status}`);
  await readSectionLines(response.body, deliver);
}

const batcher = createSectionBatcher(sendBatch, (url) => politeFetch(url));

/** A section URL's response: batched with the area's other sections when it can be. */
export function sectionFetch(url: string): Promise<Response> {
  return sectionBatchOn() ? batcher.read(url) : politeFetch(url);
}

/**
 * Read-once JSON for evidence sections that mount and unmount as tabs change:
 * the same URL is fetched once per page and shared, so switching tabs never
 * refetches unchanged evidence. Failures are not cached.
 *
 * A 404 is a definite "not here" (null, an empty section). Any other error or a
 * lost connection is a failed read: also null, and recorded here until the URL
 * is read again, so a section can say "Couldn't load" rather than "no data".
 */
const cache = new Map<string, Promise<unknown>>();
const failed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function markFailed(url: string, value: boolean) {
  if (failed.has(url) === value) return;
  if (value) failed.add(url); else failed.delete(url);
  version += 1;
  for (const listener of listeners) listener();
}

export function fetchSectionJson<T>(url: string): Promise<T | null> {
  let pending = cache.get(url) as Promise<T | null> | undefined;
  if (!pending) {
    markFailed(url, false);
    pending = sectionFetch(url)
      .then((response) => {
        if (response.ok) return response.json() as Promise<T>;
        if (response.status !== 404) markFailed(url, true);
        return null;
      })
      .catch(() => { markFailed(url, true); return null; });
    cache.set(url, pending);
    void pending.then((value) => { if (value === null) cache.delete(url); });
  }
  return pending;
}

/** True when the last read of `url` failed (not a 404). */
export function sectionReadFailed(url: string): boolean {
  return failed.has(url);
}

/** Changes whenever a read fails or is tried again, for useSyncExternalStore. */
export function sectionFailureVersion(): number {
  return version;
}

export function subscribeSectionFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
