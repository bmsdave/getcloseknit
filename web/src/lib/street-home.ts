/**
 * A home with no recorded sale, found through its street: /property/at/{postcode}/{house-slug}.
 * The API (`GET /api/v1/homes/at/{postcode}/{house-slug}`) answers with the home block, with the
 * UPRN when the number is a recorded home (the page redirects), `{ postcodePage: true }` for a
 * recorded home with no UPRN (the page goes to the postcode page), or 404 (outside the street's
 * recorded numbers). A hidden home's number gets the same block as a never-recorded one.
 * Pure helpers only, so the search box can import them; the loader is street-home-server.ts.
 */
import { postcodeSlug } from "./postcode-page";
import type { Withheld } from "./property-profile";

export interface StreetHome {
  label: string;
  postcode: string;
  likelyPostcode: string | null;
  /** House numbers either side whose recorded homes share the likely postcode. */
  neighbours: number[];
  /** "uk:lsoa:E01001209"; null when the postcode has no area. */
  areaId: string | null;
  point: { lat: number; lon: number } | null;
  withheld: Withheld[];
}

/** The answer for a number whose records have no UPRN: show the postcode page instead. */
export interface StreetHomePostcodePage {
  postcodePage: true;
}

/** What the street-level route answers with, unless the number is not found. */
export type StreetHomeAnswer = StreetHome | { uprn: string } | StreetHomePostcodePage;

/** "120 Meadvale Road" -> "120-meadvale-road"; apostrophes drop out ("St John's" -> "st-johns"); "12A" keeps its letter ("12a"). */
export function houseSlug(label: string): string {
  return label.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** "/property/at/W5-1LR/120-meadvale-road". */
export function streetHomePath(postcode: string, label: string): string {
  return `/property/at/${postcodeSlug(postcode)}/${houseSlug(label)}`;
}

/** "No recorded sale; postcode likely W5 1LR (numbers 116 and 124 either side)"; without that evidence, a neutral caution. */
export function streetHomeNote(home: Pick<StreetHome, "postcode" | "likelyPostcode" | "neighbours">): string {
  const { postcode, neighbours } = home;
  if (home.likelyPostcode === postcode) {
    if (neighbours.length === 2) return `No recorded sale; postcode likely ${postcode} (numbers ${neighbours[0]} and ${neighbours[1]} either side)`;
    if (neighbours.length === 1) return `No recorded sale; other homes at number ${neighbours[0]} are in ${postcode}`;
  }
  return "No recorded sale here. We can't confirm the postcode from neighbouring homes; check it before relying on it.";
}
