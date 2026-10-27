"use client";

import { useId } from "react";

import { LISTING_LINKS_NOTE, type HomeCardLinks } from "@/lib/listing-links";
import { track } from "@/lib/usage";

/**
 * "View listing photos": links out to the portals for the home's postcode, on
 * the map's home card and the property page. Photos stay on the portals, never
 * copied or hosted here; no value, £/m² or floor area for the home.
 */
export function ListingPhotoLinks({ links, testId, className, heading: Heading = "h3" }: {
  links: HomeCardLinks; testId: string; className?: string; heading?: "h2" | "h3";
}) {
  const titleId = useId();
  return (
    <section className={className ? `listing-photos ${className}` : "listing-photos"} data-testid={testId} aria-labelledby={titleId}>
      <Heading id={titleId} className="listing-photos__title">View listing photos</Heading>
      <ul className="listing-photos__portals">
        {links.portals.map(({ portal, label, href }) => (
          <li key={portal}>
            <a className="listing-photos__portal" href={href} target="_blank" rel="noopener noreferrer"
              onClick={() => track("portal_click", { portal, kind: portal === "rightmove" ? "sold" : "listings", from: "home",
                outcode: links.postcode.split(" ")[0] })}>
              {label}<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="listing-photos__note">{LISTING_LINKS_NOTE}</p>
    </section>
  );
}
