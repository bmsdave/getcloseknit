"use client";

import Link from "next/link";

import { nearestLine, placesByPriority, routablePlaces, type AreaCommute } from "@/lib/commute";
import type { GeographyId, PreferenceProfile } from "@/lib/contracts";

import { KeyNumbers, SectionFrame, type KeyRow } from "./area-section-frame";
import { usePageTailor } from "./page-tailor";
import { useTailor } from "./tailor-card";

/**
 * The household's kinds of place (the nearest gym, park, M&S, a top school), each with its nearest match and
 * walk: Local places' own rows (added for them, ▸), in priority order. Pinned addresses are Getting around's trips.
 */
export function nearestRows(profile: PreferenceProfile, commute: AreaCommute | null): KeyRow[] {
  return placesByPriority(profile).filter((place) => place.target.kind !== "point" && place.target.kind !== "any-of").flatMap((place) => {
    const line = nearestLine(commute?.places.find((entry) => entry.placeId === place.id), place.mode);
    return line ? [{ term: place.label, value: line, mine: true, testId: "your-place" }] : [];
  });
}

/**
 * The household's pinned addresses, door to door (added for them, ▸), #1 first. Once the times are in, a place with
 * no time in its own mode still has its row (another mode's time, or "no time yet"): the #1 place is never left out.
 */
export function tripRows(profile: PreferenceProfile, commute: AreaCommute | null): KeyRow[] {
  if (!commute) return [];
  const routable = new Set(routablePlaces(profile.places).map((place) => place.id));
  return placesByPriority(profile).filter((place) => routable.has(place.id)).map((place) => {
    const routed = commute.places.find((entry) => entry.placeId === place.id);
    const own = routed?.modes[place.mode]?.minutes ?? undefined;  // null = untimed (over the cap, outside London)
    const other = own === undefined ? (["transit", "cycle", "walk", "car"] as const).find((mode) => routed?.modes[mode]?.minutes != null) : undefined;
    const route = routed?.routes?.[0];
    // The example route starts from the wider neighbourhood's centre while the minutes are from
    // this area: label its changes as a typical route (#163).
    const changes = place.mode === "transit" && own !== undefined && route
      ? ` · ${route.transfers === 0 ? "no changes" : `${route.transfers} change${route.transfers > 1 ? "s" : ""}`} (typical route)` : "";
    // No hub near the place: the minutes My match scores it with (the row's 12′), said as an estimate.
    const estimate = routed?.estimate ? " · estimate" : "";
    const value = own !== undefined ? `${Math.round(own)} min${changes}${estimate}`
      : other ? `${Math.round(routed!.modes[other]!.minutes!)} min ${MODE_WORDS[other]}${estimate}` : "No time yet";
    return { term: place.label, value, mine: true, testId: "trip-row" };
  });
}

const MODE_WORDS = { transit: "by public transport", cycle: "by bike", walk: "on foot", car: "by car" } as const;

/** The places page's last section: the household's pinned places from this area, or a way to pin one. */
export function YourPlaces({ geographyId }: { geographyId: GeographyId }) {
  const { profile } = useTailor();
  const { commute } = usePageTailor(geographyId, profile);
  const rows = [...tripRows(profile, commute), ...nearestRows(profile, commute)];
  const pinned = (profile.places ?? []).length;
  return (
    <SectionFrame id="your-places" title="Your places" icon="pin"
      headline={pinned > 0 ? `${pinned} pinned` : null}>
      {rows.length > 0
        ? <KeyNumbers testId="your-places-rows" rows={rows} />
        : <p className="area-section__status" data-testid="your-places-empty">{pinned > 0 ? "No trips from here yet." : "No places pinned yet."}</p>}
      <Link className="area-section__more" href="/?layer=personal-match" data-testid="pin-a-place">Pin a place <span aria-hidden="true">→</span></Link>
    </SectionFrame>
  );
}
