"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import type { SectionSeed } from "@/lib/section-seed";
import { fetchSectionJson, sectionFailureVersion, sectionReadFailed, subscribeSectionFailures } from "@/lib/section-fetch";

const SeedContext = createContext<SectionSeed>({});

/**
 * The JSON the server read for this page, keyed by the same URLs the page's hooks ask for (the
 * SEO rule): the first paint, crawlers and no-JS readers get every section whole, and the hooks skip
 * the fetch. Outside it (the map sheet) every hook fetches as before.
 */
export function SectionSeedProvider({ seed, children }: { seed: SectionSeed; children: ReactNode }) {
  return <SeedContext value={seed}>{children}</SeedContext>;
}

/** The server's payload for `url`, or undefined when the page carried none. */
export function useSeed(url: string | null | undefined): unknown {
  const seed = useContext(SeedContext);
  return url && Object.hasOwn(seed, url) ? seed[url] : undefined;
}

/**
 * A section's JSON, read once per page: the server's copy when it sent one, else fetched after
 * hydration. undefined while loading; null when there is nothing to read (no url) or it failed.
 */
export function useSectionJson<T = unknown>(url: string | null): T | null | undefined {
  const seeded = useSeed(url) as T | undefined;
  const [entry, setEntry] = useState<{ url: string | null; payload: T | null | undefined }>(() => ({ url, payload: seeded }));
  const have = entry.url === url && entry.payload !== undefined;
  useEffect(() => {
    if (!url || have) return;
    let current = true;
    void fetchSectionJson<T>(url).then((payload) => { if (current) setEntry({ url, payload }); });
    return () => { current = false; };
  }, [url, have]);
  if (!url) return null;
  return entry.url === url ? entry.payload : undefined;
}

/**
 * Whether any of a section's reads failed (an error or a lost connection, never a 404 "not here"), so the
 * section can say "Couldn't load" rather than show an empty state. Always false on the server.
 */
export function useFailedReads(): (urls: readonly (string | null)[]) => boolean {
  const version = useSyncExternalStore(subscribeSectionFailures, sectionFailureVersion, () => 0);
  return useCallback(
    (urls: readonly (string | null)[]) => version > 0 && urls.some((url) => url !== null && sectionReadFailed(url)),
    [version],
  );
}
