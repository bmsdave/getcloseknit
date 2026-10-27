// Map popup cards (the card a portal's map pin opens): which listing each shows, and its facts from what the page
// and the listing's own page give. No DOM writes here: src/content/mapPopup.ts draws the line.
import type { ListingFacts } from "../../types";
import type { ResultItem, ResultsAdapter } from "./types";

export interface PopupSlot {
  /** The popup card; the line goes inside it. */
  card: HTMLElement;
  listingId: string;
  /** The card's link to the listing, as written (relative or absolute). */
  href: string;
}

/** Each open popup card under `root` and its listing; a card linking to more than one listing is skipped. */
export function findPopups(root: ParentNode, adapter: ResultsAdapter): PopupSlot[] {
  if (!adapter.popups) return [];
  const slots: PopupSlot[] = [];
  for (const card of root.querySelectorAll<HTMLElement>(adapter.popups.card)) {
    let found: { id: string; href: string } | null = null;
    let mixed = false;
    for (const anchor of card.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const href = anchor.getAttribute("href") ?? "";
      const id = adapter.linkId(href);
      if (!id) continue;
      if (found && found.id !== id) mixed = true;
      found ??= { id, href };
    }
    if (found && !mixed) slots.push({ card, listingId: found.id, href: found.href });
  }
  return slots;
}

/** Whether a link sits in a map popup card (the results line leaves those to the popup line). */
export function inPopup(anchor: Element, adapter: ResultsAdapter): boolean {
  return Boolean(adapter.popups && anchor.closest(adapter.popups.card));
}

/** Enough to ask for a line: a point (or postcode) and the asking price. */
export function complete(item: ResultItem | undefined): item is ResultItem {
  return Boolean(item && (item.lat !== null || item.postcode !== null) && item.askingPrice !== null);
}

/** Results and pins by listing id; a complete copy wins over a partial one (an OnTheMarket pin has no price). */
export function indexItems(...lists: ResultItem[][]): Map<string, ResultItem> {
  const byId = new Map<string, ResultItem>();
  for (const item of lists.flat()) {
    const known = byId.get(item.listingId);
    if (!known || (!complete(known) && complete(item))) byId.set(item.listingId, item);
  }
  return byId;
}

/** A listing page's facts as a result (only what the badges request and the days chip use). */
export function itemFromFacts(facts: ListingFacts): ResultItem {
  return {
    listingId: facts.listingId, url: facts.url, lat: facts.lat, lng: facts.lng, postcode: facts.postcode,
    market: facts.market, askingPrice: facts.askingPrice, bedrooms: facts.bedrooms,
    propertyType: facts.propertyType ?? "unknown", listedOn: facts.listedOn ?? null,
  };
}

/** The listing's page, from the card's link: no query or fragment (Rightmove's `#/?channel=RES_BUY`). */
export function listingUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}
