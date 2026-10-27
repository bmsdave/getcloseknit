import type { ListingFacts, PageSnapshot } from "../types";
import { onthemarket } from "./onthemarket";
import { openrent } from "./openrent";
import { rightmove } from "./rightmove";
import { spareroom } from "./spareroom";
import { zoopla } from "./zoopla";

const ADAPTERS = [rightmove, zoopla, onthemarket, spareroom, openrent];

/** The listing on this page, or null on any other page (searches, the home page, a changed layout). */
export function readListing(page: PageSnapshot): ListingFacts | null {
  for (const adapter of ADAPTERS) {
    try {
      const facts = adapter(page);
      if (facts) return facts;
    } catch {
      // A portal changed its page: show nothing rather than a wrong card.
    }
  }
  return null;
}
