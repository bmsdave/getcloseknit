"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { GeographyId } from "@/lib/contracts";
import { formatPounds } from "@/lib/evidence-format";
import { askingPrefill, checkHomeHref } from "@/lib/tools";
import { loadUserCandidates, type UserCandidate } from "@/lib/user-candidates";
import { KnitIcon } from "./knit/knit-icon";
import { CANDIDATES_CHANGED } from "./user-candidates";

/**
 * G17: the homes saved on this device that sit in this area (a listing saved
 * from a portal, a home saved on the map), each opening Check a home. Read
 * after hydration and again on every save; hidden when there are none.
 */
export function SavedHomesHere({ geographyId }: { geographyId: GeographyId }) {
  const [homes, setHomes] = useState<UserCandidate[]>([]);
  useEffect(() => {
    const read = () => setHomes(loadUserCandidates().store.candidates.filter((candidate) => candidate.geographyId === geographyId));
    read();
    window.addEventListener(CANDIDATES_CHANGED, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CANDIDATES_CHANGED, read);
      window.removeEventListener("storage", read);
    };
  }, [geographyId]);
  if (homes.length === 0) return null;
  return (
    <section className="saved-homes-here" data-testid="saved-homes-here" aria-labelledby="saved-homes-here-title">
      <h2 id="saved-homes-here-title">Saved homes here</h2>
      <ul>
        {homes.map((home) => {
          // The asking price saved with the listing is the price Check a home starts from.
          const asking = askingPrefill(home);
          return (
            <li key={home.id} data-testid="saved-home-row">
              <Link href={checkHomeHref({ area: geographyId, uprn: home.uprn, ...asking })} data-testid="saved-home-check">
                <KnitIcon name="heart" colour="var(--yarn-cherry)" style={{ width: 18, height: 18 }} />
                <span>
                  {home.address.value}
                  {asking && <span className="saved-homes-here__price"> · {formatPounds(asking.price!)} asking</span>}
                </span>
                {asking && <span className="saved-homes-here__check">Check this price <span aria-hidden="true">→</span></span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
