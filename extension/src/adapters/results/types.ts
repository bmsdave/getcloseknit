import type { ListingFacts } from "../../types";

/** What a results adapter reads: the page's address, its data scripts and its listings' data-* attributes. */
export interface ResultsSnapshot {
  url: string;
  scripts: string[];
  nextData: string | null;
  /** The data-* attributes of each element marked data-listing-id (SpareRoom keeps its results there). */
  listingData: Record<string, string>[];
}

/** One search result as the page gives it. `listedOn` stays in the browser (days on the market are counted
 * there); the request carries BADGE_FIELDS only (src/local.ts). */
export type ResultItem = Pick<ListingFacts,
  "listingId" | "url" | "lat" | "lng" | "postcode" | "market" | "askingPrice" | "bedrooms" | "propertyType" | "listedOn">;

export interface ResultsPage {
  portal: ListingFacts["portal"];
  items: ResultItem[];
}

export interface ResultsAdapter {
  portal: ListingFacts["portal"];
  /** Whether this address is one of the portal's search pages. */
  matches(url: string): boolean;
  read(page: ResultsSnapshot): ResultItem[];
  /** The listing a link on the page points at, to find each result's card. */
  linkId(href: string): string | null;
  /** The portal's map popup cards (Rightmove, Zoopla, OnTheMarket). */
  popups?: MapPopups;
}

export interface Badge {
  listingId: string;
  score: number | null;
  band: 1 | 2 | 3 | 4 | 5 | null;
  excluded: boolean;
  bucket: 0 | 1 | 2 | 3 | null;
  flag?: string;
  /** Row 1 after the ring, in order (absent from older APIs): missed limits or one flag, minutes to each place,
   * the price position, monthly cost, days on the market and the area's price change over a year. */
  chips?: Chip[];
  /** Row 2: the area's pills, as the card's summary (absent from older APIs). */
  pills?: Pill[];
  /** Row 3: "Before you offer" in a few words (absent from older APIs). */
  offer?: Pill[];
  /** The region the area score is within (API rankScope, absent from older APIs: London). */
  rankScope?: { code: string; name: string } | null;
}

export interface Chip {
  text: string;
  /** 1-5, the site's diverging ramp (bad → good); null: neutral. */
  band: 1 | 2 | 3 | 4 | 5 | null;
  /** "miss", "flag", "commute", "price" (drawn with the 4-segment strip), "cost", "days" or "trend"; others show as text. */
  kind: string;
}

export interface Pill {
  label: string;
  value: string;
  /** 1-5, the site's diverging ramp (bad → good); null: neutral. */
  band: 1 | 2 | 3 | 4 | 5 | null;
}

/** "match": the score is the saved search's fit out of 100; "area": the area's own /10. */
export interface Badges {
  scale: "match" | "area";
  items: Badge[];
}

/** "results": the line under each search result; "map": the line inside a map popup card. */
export type Surface = "results" | "map";

export interface BadgesMessage {
  type: "badges";
  portal: ListingFacts["portal"];
  items: ResultItem[];
  /** Which line asks (each has its own server switch); "results" when left out. */
  surface?: Surface;
}

/** Whether a line may show on this portal now (the portal's mode, the user's consent, the server's switch). */
export interface LineAllowedMessage {
  type: "line-allowed";
  portal: ListingFacts["portal"];
  surface: Surface;
}

/**
 * The card a portal's map pin opens (photo, price, type, beds). The listing comes from the card's link; its facts
 * from the page's data, else from the listing's own page, read in the browser.
 */
export interface MapPopups {
  /** Each popup card that shows one listing; the line goes inside it. */
  card: string;
  /** "append": after the card's content (the popup grows to fit); "below": hung under a card of fixed height. */
  place: "append" | "below";
  /** Pins in the page's own data (the first map load); a pin without a price is completed from its listing page. */
  pins?(page: ResultsSnapshot): ResultItem[];
}
