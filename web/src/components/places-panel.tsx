"use client";

import Link from "next/link";
import { useState } from "react";

import { PLACE_ATTRIBUTION, PLACE_GROUPS, PLACE_MIN_ZOOM, placeBadgeMarkup, togglePlaceGroup, type PlaceCardData, type PlaceGroup, type PlaceView } from "@/lib/map-place-layers";
import { KnitIcon } from "./knit/knit-icon";
import { SaveItemButton } from "./save-item-button";

/** A group's key: the badge the map draws for it (felt disc, stitched ring, icon in white yarn). */
export function PlaceGroupIcon({ group }: { group: PlaceGroup }) {
  return <svg className="place-badge" viewBox="0 0 26 27" width="20" height="20" aria-hidden="true" focusable="false"
    dangerouslySetInnerHTML={{ __html: placeBadgeMarkup(group) }} />;
}

/**
 * The Places overlay's own controls under its "Show on map" checkbox, the one
 * place to choose them: one checkbox per group, keyed by its map badge. How
 * places are chosen, the confidence note and the licences sit behind "?".
 */
export function PlacesPanel({ view, zoom, onChange }: { view: PlaceView; zoom: number; onChange: (view: PlaceView) => void }) {
  return (
    <section className="places-panel" data-testid="places-panel" aria-label="Places">
      <div className="places-groups" role="group" aria-label="Place types">
        {PLACE_GROUPS.map((group) => (
          <label key={group.id} data-testid={`places-group-${group.id}`}>
            <input type="checkbox" checked={view.groups.includes(group.id)}
              onChange={() => onChange(togglePlaceGroup(view, group.id))} />
            <PlaceGroupIcon group={group.id} />
            {group.label}
          </label>
        ))}
      </div>
      {zoom < PLACE_MIN_ZOOM && <p className="places-hint">Zoom in to street level to see places.</p>}
      <details className="places-about" data-testid="places-about">
        <summary>How places are chosen <span aria-hidden="true"><KnitIcon name="help" colour="var(--icon-yarn, currentColor)" className="knit-glyph" style={{ width: 12, height: 12 }} /></span></summary>
        <p className="places-hint" data-testid="places-ranking-note">
          The map shows the main places first (landmarks, then places several sources agree on) and more as you zoom in;
          names appear when you zoom right in. Hover or tap a place for its details.
        </p>
        <p className="licence-note">
          Named places with a source-agreement confidence of 0.6 or more; not checked on the ground, so some may have
          closed. {PLACE_ATTRIBUTION}.
        </p>
      </details>
    </section>
  );
}

/**
 * A tapped place, in the sheet: "Pizza East", "Restaurant · Hygiene 5/5"
 * and a close control. Which sources list it waits behind "?" (rendered
 * only when asked for).
 */
export function PlaceCard({ place, onClose }: { place: PlaceCardData; onClose: () => void }) {
  const [sources, setSources] = useState(false);
  return (
    <section className="place-card" data-testid="place-card" aria-label={`Place: ${place.name}`}>
      <div className="place-card__text">
        <strong>{place.name}</strong>
        {place.detail && <span>{place.detail}</span>}
        {sources && place.sources && <small data-testid="place-card-sources">Listed by: {place.sources}</small>}
        {place.href && <Link href={place.href} data-testid="place-card-link">{place.linkLabel ?? "Open"}</Link>}
      </div>
      {place.save && <SaveItemButton item={place.save} testId="place-card-save" />}
      {place.sources && (
        <button type="button" className="place-card__more" aria-expanded={sources} aria-label="Where this place comes from"
          onClick={() => setSources(!sources)}>
          <span aria-hidden="true"><KnitIcon name="help" colour="var(--icon-yarn, currentColor)" className="knit-glyph" style={{ width: 16, height: 16 }} /></span>
        </button>
      )}
      <button type="button" className="place-card__close" data-testid="place-card-close" aria-label="Close place" onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
    </section>
  );
}
