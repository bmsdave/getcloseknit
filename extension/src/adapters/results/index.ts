// Search-results pages: which listings the page shows, read from its data, never its layout.
import { onthemarket } from "./onthemarket";
import { openrent } from "./openrent";
import { rightmove } from "./rightmove";
import { spareroom } from "./spareroom";
import type { ResultsAdapter, ResultsPage, ResultsSnapshot } from "./types";
import { zoopla } from "./zoopla";

export const RESULTS_ADAPTERS: ResultsAdapter[] = [rightmove, zoopla, onthemarket, spareroom, openrent];

export function resultsAdapter(url: string): ResultsAdapter | null {
  return RESULTS_ADAPTERS.find((adapter) => adapter.matches(url)) ?? null;
}

/** The results on this page, or null when it is not a search page (or its data is not there yet). */
export function readResults(page: ResultsSnapshot): ResultsPage | null {
  const adapter = resultsAdapter(page.url);
  if (!adapter) return null;
  try {
    const items = adapter.read(page);
    return items.length ? { portal: adapter.portal, items } : null;
  } catch {
    // A portal changed its page: show nothing rather than wrong badges.
    return null;
  }
}

export function resultsSnapshot(doc: Document, url: string): ResultsSnapshot {
  const scripts = [...doc.scripts];
  return {
    url,
    scripts: scripts.filter((s) => !s.type || s.type === "text/javascript").map((s) => s.textContent ?? ""),
    nextData: doc.getElementById("__NEXT_DATA__")?.textContent ?? null,
    listingData: [...doc.querySelectorAll<HTMLElement>("[data-listing-id]")].map((el) => ({ ...el.dataset }) as Record<string, string>),
  };
}
