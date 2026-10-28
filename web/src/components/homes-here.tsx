"use client";

import { useEffect, useState } from "react";

import { formatPrice } from "@/lib/brief-model";
import type { GeographyId, PreferenceProfile } from "@/lib/contracts";
import { DEFAULT_PROFILE } from "@/lib/fixtures";
import { areaListingLinks, districtSoldPricesUrl, type AreaListingFilter } from "@/lib/listing-links";
import { findLikeHref, isUnsetProfile, loadLocalProfile } from "@/lib/profile-state";
import { track } from "@/lib/usage";

type From = "shortlist" | "area_page" | "postcode_page";

interface HomesHereProps {
  geographyId: GeographyId;
  from: From;
  /** The area's postcode districts, most homes first (known when the page renders: nothing shifts later). */
  outcodes: string[];
  /** The search the shortlist was made with; on the area page, the saved one if there is one. */
  profile?: PreferenceProfile | null;
  /** Opens the search editor (the shortlist card's "change"). */
  onEdit?: () => void;
}

/**
 * From a chosen area to the homes on sale (or to rent) there: the portals' own searches for its postcode
 * district, filtered by the search, and Rightmove's sold prices. Links only (DESIGN › one action per
 * screen stays the card's own button); every tap is a portal_click for lib/usage.ts.
 */
export function HomesHere({ geographyId, from, outcodes: all, profile: givenProfile, onEdit }: HomesHereProps) {
  const outcodes = all.slice(0, 3);
  const saved = useSavedSearch(givenProfile);
  const [chosen, setChosen] = useState(0);
  const [openMarket, setOpenMarket] = useState<"buy" | "rent">("buy");
  const outcode = outcodes[Math.min(chosen, outcodes.length - 1)];
  if (!outcode) return null;
  const filter: AreaListingFilter = saved
    ? { market: saved.market, maxPrice: saved.maximumBudget, minBedrooms: saved.bedrooms }
    : { market: openMarket, maxPrice: null, minBedrooms: null };
  const links = areaListingLinks(outcode, filter);
  const sold = districtSoldPricesUrl(outcode);
  const click = (portal: string, kind: "listings" | "sold") =>
    track("portal_click", { portal, kind, from, market: filter.market, outcode, area: geographyId });
  const heading = filter.market === "rent" ? "Homes to rent here" : "Homes for sale here";
  return (
    <section className="homes-here" aria-labelledby={`homes-here-${from}`} data-testid="homes-here">
      <h3 id={`homes-here-${from}`}>{heading}</h3>
      {saved ? (
        <p className="homes-here__filters">
          {filterWords(saved)}
          {onEdit && <> · <button type="button" className="link-button" onClick={onEdit}>change</button></>}
        </p>
      ) : (
        <>
          <div className="homes-here__switch" role="group" aria-label="Buy or rent">
            {(["buy", "rent"] as const).map((market) => (
              <button key={market} type="button" className="chip-button" aria-pressed={openMarket === market}
                onClick={() => setOpenMarket(market)}>{market === "buy" ? "Buy" : "Rent"}</button>
            ))}
          </div>
          <p className="homes-here__filters">
            Any price · any size · <a href={findLikeHref(geographyId)}>add your budget and bedrooms</a>
          </p>
        </>
      )}
      {outcodes.length > 1 && (
        <div className="homes-here__switch" role="group" aria-label="Postcode district">
          {outcodes.map((code, index) => (
            <button key={code} type="button" className="chip-button" aria-pressed={code === outcode}
              onClick={() => setChosen(index)}>{code}</button>
          ))}
        </div>
      )}
      <ul className={`homes-here__portals${links.length > 3 ? " homes-here__portals--four" : ""}`}>
        {links.map(({ portal, label, href }) => (
          <li key={portal}>
            <a className="homes-here__portal" href={href} target="_blank" rel="noopener noreferrer"
              data-testid={`homes-here-${portal}`} onClick={() => click(portal, "listings")}>
              {label}<span aria-hidden="true"> ↗</span>
            </a>
          </li>
        ))}
      </ul>
      {sold && (
        <p className="homes-here__sold">
          Sold prices in {outcode}:{" "}
          <a href={sold} target="_blank" rel="noopener noreferrer" onClick={() => click("rightmove", "sold")}>Rightmove</a>
        </p>
      )}
      <p className="homes-here__note">A postcode district is wider than the area. Close Knit doesn&apos;t host listings.</p>
    </section>
  );
}

function filterWords(profile: PreferenceProfile): string {
  const price = profile.market === "rent" ? `Up to ${formatPrice(profile.maximumBudget)} a month` : `Up to ${formatPrice(profile.maximumBudget)}`;
  return profile.bedrooms > 0 ? `${price} · ${profile.bedrooms}+ beds` : price;
}

/** The search to filter by: the one given, else the one saved in this browser (none if never saved). */
function useSavedSearch(given: PreferenceProfile | null | undefined): PreferenceProfile | null {
  const [saved, setSaved] = useState<PreferenceProfile | null>(given ?? null);
  useEffect(() => {
    if (given !== undefined) {
      setSaved(given);
      return;
    }
    const local = loadLocalProfile(DEFAULT_PROFILE);
    setSaved(isUnsetProfile(local) ? null : local);
  }, [given]);
  return saved;
}
