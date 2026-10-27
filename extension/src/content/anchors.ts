// Where the inline Close Knit panel goes on each portal's listing page: the element it is inserted after,
// right under the asking price. Found by stable attributes first (test ids, data attributes, class-name
// prefixes that survive builds), then by the price text. Seen on live pages on 2026-10-18; null means
// "not found", and the side card alone is shown as before.
import type { ListingFacts } from "../types";

export type Portal = ListingFacts["portal"];

const PRICE_TEXT = /^£\s?\d[\d,]*(\.\d+)?(\s?(pcm|pw))?$/i;

const FINDERS: Record<Portal, (doc: Document) => Element | null> = {
  // <article> holding [data-testid="primaryPrice"] (price, pcm/pw and its help text): the panel goes after it.
  rightmove: (doc) => {
    const price = doc.querySelector('[data-testid="primaryPrice"]');
    return price ? price.closest("article") ?? price.parentElement : null;
  },
  // The Price_priceWrapper (price and "See monthly cost") in the "Listing details" section.
  zoopla: (doc) => {
    const wrapper = doc.querySelector('[class*="Price_priceWrapper"]');
    if (wrapper) return wrapper;
    const details = doc.querySelector('[aria-label="Listing details"]');
    return details ? priceLeaf(details)?.parentElement ?? null : null;
  },
  // The box holding [data-test="property-price"] and the ownership label above it.
  onthemarket: (doc) => doc.querySelector('[data-test="property-price"]')?.parentElement ?? null,
  // The price section of the room or whole flat (feature--price_room_only, feature--price_whole_property).
  spareroom: (doc) => doc.querySelector('.listing__details section[class*="feature--price"]')
    ?? doc.querySelector('section[class*="feature--price"]'),
  // The price sits in a sticky sidebar (#listingActions), too narrow and fixed for the panel, so it goes under
  // the title block in the main column instead, beside the price on wide screens and just above it on phones.
  openrent: (doc) => (doc.querySelector("#listingActions") ? doc.querySelector(".listing__content h1")?.parentElement ?? null : null),
};

/** The element the inline panel is inserted after, or null when this page's layout is not recognised. */
export function findAnchor(doc: Document, portal: Portal): Element | null {
  try {
    const anchor = FINDERS[portal]?.(doc) ?? null;
    return anchor && anchor.parentNode ? anchor : null;
  } catch {
    return null;
  }
}

/** The first element with no child elements whose text is just a price ("£1,400,000", "£2,150 pcm"). */
export function priceLeaf(scope: ParentNode): Element | null {
  for (const node of scope.querySelectorAll("p, span, div, strong, h2, h3")) {
    if (node.children.length === 0 && PRICE_TEXT.test((node.textContent ?? "").trim())) return node;
  }
  return null;
}

/** Puts ``host`` right after ``anchor`` unless it is already there. */
export function placeAfter(anchor: Element, host: Element): void {
  if (anchor.nextElementSibling !== host) anchor.after(host);
}
