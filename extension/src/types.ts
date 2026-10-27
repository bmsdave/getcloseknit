/**
 * The public facts of one portal listing, read from the page. Only LISTING_FIELDS (src/local.ts) are sent; the rest
 * (costs, lease, EPC, dates, price history) stay in the browser.
 */
export interface ListingFacts {
  portal: "rightmove" | "zoopla" | "onthemarket" | "spareroom" | "openrent";
  listingId: string;
  url: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  postcode: string | null;
  market: "buy" | "rent";
  askingPrice: number | null;
  bedrooms: number | null;
  floorAreaSqm: number | null;
  tenure: "freehold" | "leasehold" | "share-of-freehold" | "unknown";
  /** The page gives only an approximate point (SpareRoom): the card is about the area around it. */
  locationApproximate?: boolean;
  // Listing facts v2 (docs/superpowers/specs/2026-10-18-extension-gaps.md): optional, read from the page.
  propertyType?: "flat" | "terraced" | "semi-detached" | "detached" | "bungalow" | "other" | "unknown";
  councilTaxBand?: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | null;
  serviceChargeYearly?: number | null;
  groundRentYearly?: number | null;
  leaseYearsRemaining?: number | null;
  /** As the listing shows it; no EPC lookup. */
  epcRating?: "A" | "B" | "C" | "D" | "E" | "F" | "G" | null;
  /** YYYY-MM-DD, when the page says the listing was added. */
  listedOn?: string | null;
  /** Price changes the page itself shows, oldest first (max 20). */
  priceChanges?: PricePoint[];
  /** From the extension's memory on this device. */
  firstSeen?: PricePoint | null;
  buyer?: BuyerAssumptions | null;
}

export interface PricePoint {
  date: string;
  price: number;
}

/** The user's own mortgage assumptions, kept on their device. */
export interface BuyerAssumptions {
  depositPct: number;
  ratePct: number;
  years: number;
  firstTime: boolean;
  additionalHome: boolean;
}

/** What an adapter reads: the page's address and the text of its data scripts, never its layout. */
export interface PageSnapshot {
  url: string;
  scripts: string[];
  jsonLd: string[];
  nextData: string | null;
  title: string;
  /** The data-* attributes of the page's #map element (OpenRent keeps the listing's point there). */
  mapData: Record<string, string> | null;
}

export type Tone = "good" | "bad" | "neutral";

export type CardBlock =
  | { type: "header"; title: string; subtitle?: string; href?: string }
  | { type: "cta"; text: string; label: string; href: string }
  | { type: "match"; score: number | null; pros: string[]; cons: string[]; excluded: boolean; rankText?: string }
  | { type: "facts"; rows: { label: string; value: string; tone: Tone }[] }
  | { type: "price"; verdict: string; text: string; detail?: string | null }
  | { type: "actions"; items: { kind: "save" | "link"; label: string; href: string; primary?: boolean }[] }
  | { type: "footnote"; text: string; href?: string; label?: string }
  | { type: "pricePosition"; homeType: string; bucket: 0 | 1 | 2 | 3 | null; label: string; sales: number;
      q1: number; median: number; q3: number; perSqm?: { asking: number; area: number; band: string } }
  | { type: "priceStory"; listedOn?: string; daysOnMarket?: number; changes: PricePoint[]; firstSeen?: PricePoint;
      areaTurnoverPct?: number; text: string }
  | { type: "costs"; monthly: number; parts: { label: string; amount: number }[];
      upfront: { label: string; amount: number }[]; assumptions: BuyerAssumptions; chips: string[] }
  | { type: "flags"; items: { text: string; tone: Tone }[] }
  | { type: "sections"; columns: { title: string; rows: { label: string; value: string; tone?: Tone }[] }[] }
  | { type: "home"; address?: string; confidence: string;
      epc?: string | { rating?: string | null; floorAreaSqm?: number | null; date?: string | null }; sales?: PricePoint[];
      value?: { low: number; high: number; method: string } }
  | { type: "summary";
      groups: { title: string; only: boolean; rows: { label: string; value: string; tone?: Tone; pending?: boolean }[] }[];
      pills: { label: string; value: string; band: 1 | 2 | 3 | 4 | 5 | null; pending?: boolean }[] }
  | { type: string; [key: string]: unknown };

export interface Card {
  v: 1;
  status: "ok" | "outside-coverage" | "error";
  blocks: CardBlock[];
  /** The placeholder drawn while the first card loads (src/swr.ts skeletonCard). */
  pending?: boolean;
}

/** The background's answer to a listing page: where to show it, whether the user lets it send, and the card. */
export interface ListingView {
  mode: "inline" | "side-panel" | "side-card" | "off";
  consent: boolean;
  /** The kept card (or a neighbour's area-only one) to show at once; null when there is none. */
  card: Card | null;
  /** Ask for the up-to-date card ("listing-card") and redraw it if it differs. */
  refresh?: boolean;
}

/** What the side panel shows for the active tab. */
export interface PanelView {
  state: "ok" | "no-listing" | "off" | "disabled" | "no-consent" | "error";
  card?: Card;
  notice?: string | null;
}

export type Message =
  | { type: "listing"; facts: ListingFacts | null }
  | { type: "listing-card"; facts: ListingFacts }
  | { type: "open-side-panel" }
  | { type: "panel-card"; tabId: number }
  | { type: "offer-profile"; profile: unknown }
  | { type: "set-profile"; profile: unknown }
  | { type: "dismiss-profile"; profile: unknown }
  | { type: "state" }
  | { type: "forget-profile" }
  | { type: "opt-in" }
  | { type: "set-enabled"; enabled: boolean };

export interface ExtensionState {
  enabled: boolean;
  hasProfile: boolean;
  optedOut: boolean;
  profileSavedAt: string | null;
  apiBase: string;
}
