"use client";

import { useEffect, useState } from "react";

import { ChartFrame, ChartIcon } from "@/components/charts";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import {
  AMENITY_LABELS, SIZE_LABELS, amenityKind, amenityName, formatDistance, groupPlaces, placesPath, readAreaPlaces, walkMinutes,
  type AmenityGroup, type AmenityGroupSummary, type AreaPlacesResponse, type AreaPlacesState,
} from "@/lib/places";
import { fetchSectionJson } from "@/lib/section-fetch";

import { KeyNumbers, SectionFrame } from "./area-section-frame";
import { YourPlaces } from "./your-places";

/** Short plural labels and icons for the everyday-place counts. */
export const AMENITY_COUNT: Record<AmenityGroup, { label: string; icon: string }> = {
  groceries: { label: "shops", icon: "shopping-cart" },
  pubs: { label: "pubs and bars", icon: "beer" },
  food: { label: "places to eat", icon: "tools-kitchen" },
  pharmacies: { label: "pharmacies", icon: "pill" },
  gps: { label: "GPs", icon: "stethoscope" },
  gyms: { label: "gyms", icon: "barbell" },
  pools: { label: "pools", icon: "swimming" },
  cafes: { label: "cafés", icon: "coffee" },
  bars: { label: "bars", icon: "glass-cocktail" },
};

/** The places page's groups, in order; Your places comes last. */
export const PLACE_GROUPS: readonly { id: string; title: string; icon: string; groups: readonly AmenityGroup[]; parks?: true }[] = [
  { id: "food-drink", title: "Food & drink", icon: "place-food", groups: ["food", "cafes"] },
  { id: "going-out", title: "Going out", icon: "place-pub", groups: ["pubs", "bars"] },
  { id: "everyday", title: "Everyday", icon: "place-shop", groups: ["groceries", "pharmacies", "gps", "gyms", "pools"], parks: true },
];

/** How many of a section's nearest places it lists, nearest first. */
const LISTED = 12;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The places page: the full list behind the area page's "All places →", in the area
 * page's section frame. Food & drink · Going out · Everyday (with parks) · Your places, each with its
 * counts within the walk and every nearest place by name. Getting around lives on the area page.
 * Measured from the middle of the area, or from the chosen home when `uprn` is set.
 */
export function PlacesSection({ geographyId, uprn = null, mode, release, initial = null }: {
  geographyId: GeographyId;
  uprn?: string | null;
  mode: DataMode;
  release: string;
  /** Read on the server, so the page paints whole (no layout shift) and crawlers get every place. */
  initial?: AreaPlacesState | null;
}) {
  const [state, setState] = useState<AreaPlacesState | null>(initial);
  useEffect(() => {
    if (initial) return;
    let current = true;
    setState(null);
    void fetchSectionJson<unknown>(placesPath({ selected: geographyId, uprn, mode, release }))
      .then((payload) => {
        if (current) setState(payload === null ? { status: "unavailable", reason: "places-unreachable" } : readAreaPlaces(payload, mode));
      });
    return () => { current = false; };
  }, [geographyId, uprn, mode, release, initial]);

  const places = state?.status === "available" ? state.places : null;
  return (
    <div className="places places-page__sections" data-testid="places-section">
      {state === null && <p className="places__status">Loading places…</p>}
      {state?.status === "unavailable" && (
        <p className="places__status" data-testid="places-unknown" role="status">
          Unknown: place data is not available for this area yet.
        </p>
      )}
      {places && (
        <>
          <p className="places__origin">
            Straight-line distances from {places.origin.kind === "home" ? "this home" : "the middle of the area"}.
          </p>
          {PLACE_GROUPS.map((group) => <PlaceGroupSection key={group.id} places={places} group={group} />)}
        </>
      )}
      <YourPlaces geographyId={geographyId} />
    </div>
  );
}

function PlaceGroupSection({ places, group }: { places: AreaPlacesResponse; group: (typeof PLACE_GROUPS)[number] }) {
  const entries = group.groups
    .map((id) => places.amenities.find((entry) => entry.group === id))
    .filter((entry): entry is AmenityGroupSummary => entry !== undefined);
  const walk = walkMinutes(places.walkRadiusMetres);
  const { total, nearest } = groupPlaces(entries, LISTED);
  return (
    <SectionFrame id={group.id} title={group.title} icon={group.icon}
      headline={entries.length > 0 ? `${total} within a ${walk}-minute walk` : null}
      about={(
        <>
          <ul>{places.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
          {places.sources.map((source) => <p key={source.id} className="licence-note">{source.attribution}</p>)}
        </>
      )}>
      {entries.length === 0
        ? <p className="area-section__status">No data for this area</p>
        : (
          <KeyNumbers testId={`places-${group.id}-rows`} rows={entries.map((entry) => {
            const first = entry.nearest[0];
            // "None within 1.5 km" only when nothing is counted either: a count without a listed nearest
            // (the list is capped) must never read "24 within 10 min · none within 1.5 km".
            const nearestText = first
              ? ` · nearest ${amenityName(first)} ${formatDistance(first.distanceMetres)}`
              : entry.countWithinWalk === 0 ? " · none within 1.5 km" : "";
            return {
              term: capital(AMENITY_COUNT[entry.group].label),
              value: `${entry.countWithinWalk} within ${walk} min${nearestText}`,
              testId: `places-count-${entry.group}`,
            };
          })} />
        )}
      {nearest.length > 0 && (
        <ul className="et-list" data-testid={`places-${group.id}-list`} aria-label={`Nearest ${group.title.toLowerCase()}`}>
          {nearest.map((amenity, index) => (
            <li key={`${amenity.group}-${amenity.name}-${index}`}>
              <span className="et-list__icon"><ChartIcon name={AMENITY_COUNT[amenity.group].icon} /></span>
              <span className="et-list__text">
                <strong>{amenityName(amenity)}</strong>
                <small>{amenityKind(amenity.kind)}</small>
              </span>
              <span className="et-list__distance">{formatDistance(amenity.distanceMetres)}</span>
            </li>
          ))}
        </ul>
      )}
      {group.parks && <div data-testid="parks-list"><Parks places={places} /></div>}
    </SectionFrame>
  );
}

export function Parks({ places }: { places: AreaPlacesResponse }) {
  return (
    <ChartFrame title="Parks and green spaces" help="places-parks">
      {places.parks.length === 0
        ? <p className="places__empty">No public park within 2 km.</p>
        : (
          <ul className="et-list" data-testid="places-parks">
            {places.parks.map((park) => (
              <li key={park.name}>
                <span className="et-list__icon" data-chart-tone="good"><ChartIcon name="tree" /></span>
                <span className="et-list__text">
                  <strong>{park.name}</strong>
                  <small>{SIZE_LABELS[park.sizeClass]} · {formatHectares(park.areaHectares)}</small>
                </span>
                <span className="et-list__distance">{park.distanceMetres === 0 ? "Inside" : formatDistance(park.distanceMetres)}</span>
              </li>
            ))}
          </ul>
        )}
    </ChartFrame>
  );
}

/** area360's four everyday groups. */
const HOME_GROUPS = ["groceries", "pubs", "food", "pharmacies"] as const;

/** The home page's everyday places: each group's nearest three, by name and distance (the counts are the section's rows). */
export function AmenityGroups({ places }: { places: AreaPlacesResponse }) {
  return (
    <ul className="et-list" data-testid="amenities-list" aria-label="Everyday places nearby">
      {HOME_GROUPS.map((group) => {
        const entry = places.amenities.find((item) => item.group === group);
        const nearest = entry?.nearest.slice(0, 3) ?? [];
        return (
          <li key={group} data-group={group}>
            <span className="et-list__icon"><ChartIcon name={AMENITY_COUNT[group].icon} /></span>
            <span className="et-list__text">
              <strong>{AMENITY_LABELS[group]}</strong>
              <small>{!entry ? "No data for this area" : nearest.length === 0 ? "None within 1.5 km"
                : nearest.map((amenity) => `${amenityName(amenity)} ${formatDistance(amenity.distanceMetres)}`).join(" · ")}</small>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function formatHectares(hectares: number): string {
  return hectares < 10 ? `${hectares.toFixed(1)} ha` : `${Math.round(hectares)} ha`;
}
