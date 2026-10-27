import Link from "next/link";

import { withHomeQuery } from "@/lib/map-state";
import { formatMoney } from "@/lib/money-format";
import { homeKey, postcodeHomesPath, propertyPath, type PostcodeHome } from "@/lib/property-profile";

/** Homes shown at the top before "All N homes". */
export const TOP_HOMES = 5;

/** "Flat or maisonette" reads "Flat" in a row; the others as recorded. */
const SHORT_TYPES: Record<string, string> = { "Flat or maisonette": "Flat" };

/** A part that starts with a house number and a street ("14 Sample Street", "1a Parkway"; not "2nd Floor Flat"). */
const NUMBERED_STREET = /^\d+[a-z]?(?:-\d+[a-z]?)?\s+\S/i;

/**
 * The address up to its numbered street ("Flat 3, 14 Sample Street", "31 Sevenoaks Road"), without the
 * town and postcode; a home with no numbered part keeps its first two parts ("Rose Cottage, High Street").
 */
export function shortAddress(address: string): string {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const street = parts.findIndex((part) => NUMBERED_STREET.test(part));
  return parts.slice(0, street >= 0 ? street + 1 : 2).join(", ");
}

/** Homes with a page first, then in the list's own order (the API sorts addresses naturally). */
export function topHomes(homes: readonly PostcodeHome[], limit = TOP_HOMES): PostcodeHome[] {
  return [...homes.filter((home) => home.uprn), ...homes.filter((home) => !home.uprn)].slice(0, limit);
}

/**
 * "Homes here" at the top of the postcode page (board CUJ-02 step 2): the first homes as
 * links to their pages, each with its type and last recorded sale (price and year), then "All N homes".
 */
export function PostcodeHomesHere({ postcode, homes, mapQuery = null }: {
  postcode: string; homes: readonly PostcodeHome[];
  /** The map on the postcode's area (`selected=…&mode=…`): a home with no page of its own opens its card there. */
  mapQuery?: string | null;
}) {
  if (homes.length === 0) return null;
  const shown = topHomes(homes);
  return (
    <section className="postcode-panel postcode-homes-here" data-testid="postcode-homes-here" aria-labelledby="postcode-homes-here-title">
      <div className="postcode-panel__head">
        <h2 id="postcode-homes-here-title">Homes here</h2>
        <Link className="postcode-homes-here__all" href={postcodeHomesPath(postcode)} data-testid="postcode-homes-all">
          {homes.length === 1 ? "The home" : `All ${homes.length} homes`}<span aria-hidden="true">→</span>
        </Link>
      </div>
      <ul className="postcode-homes-here__list">
        {shown.map((home) => {
          const name = shortAddress(home.displayAddress);
          const type = home.propertyType ? SHORT_TYPES[home.propertyType] ?? home.propertyType : "—";
          const sale = home.lastSale ? `${formatMoney(home.lastSale.price)} · ${home.lastSale.date.slice(0, 4)}` : "No recorded sale";
          return (
            <li key={homeKey(home)} data-testid="postcode-home-here">
              {home.uprn
                ? <Link className="postcode-homes-here__name" href={propertyPath(home.uprn)}>{name}</Link>
                : mapQuery
                  // Every row is a link; an address with no UPRN opens the map's card with its sales.
                  ? <a className="postcode-homes-here__name" href={`/?${withHomeQuery(mapQuery, { uprn: null, addressId: home.addressId })}`}
                    data-testid="postcode-home-here-map">{name}</a>
                  : <span className="postcode-homes-here__name">{name}</span>}
              <span className="postcode-homes-here__type">{type}</span>
              <span className="postcode-homes-here__sale">{sale}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
