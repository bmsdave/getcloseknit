"use client";

import { useEffect, useState } from "react";

import { PLACE_MODES, type PlaceMode, type PlacePreference, type PlaceTarget, type PreferenceProfile } from "@/lib/contracts";
import { addPlace } from "@/lib/match-brief";

import { TripChips } from "./match/criterion-cards";
import { usePlaceOptions } from "./match/use-place-options";

/** The commute Tailor asks for: the first place pinned to a point (a station, postcode or address). */
export function commutePlace(profile: PreferenceProfile): PlacePreference | undefined {
  return (profile.places ?? []).find((place) => place.target.kind === "point");
}

/**
 * Tailor's "Where do you go most?" (the place travelled to most): a station, postcode or address picked from a
 * search, so it is routed, its trip as chips and Must. (It was the old match wizard's first step; My match now adds
 * places in its Travel to row.)
 */
export function CommuteField({ profile, onChange, onPending, idBase = "commute" }: {
  profile: PreferenceProfile;
  onChange: (profile: PreferenceProfile) => void;
  onPending: (pending: boolean) => void;
  /** Its own ids where another picker may be on the page. */
  idBase?: string;
}) {
  const place = commutePlace(profile);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState({ minutes: 30, mode: "transit" as PlaceMode, must: false });
  const options = usePlaceOptions(query);
  const showSearch = !place || searching;
  useEffect(() => { onPending(showSearch && query.trim().length > 0); }, [showSearch, query, onPending]);
  const settings = place ? { minutes: place.targetMinutes, mode: place.mode, must: place.must } : draft;
  const update = (change: Partial<typeof draft>) => {
    if (!place) { setDraft({ ...draft, ...change }); return; }
    const next: Partial<PlacePreference> = {};
    if (change.minutes !== undefined) next.targetMinutes = change.minutes;
    if (change.mode !== undefined) next.mode = change.mode;
    if (change.must !== undefined) next.must = change.must;
    onChange(replacePlace(profile, place.id, next));
  };
  const pick = (label: string, latitude: number, longitude: number) => {
    const target: PlaceTarget = { kind: "point", latitude, longitude };
    const base = { label: label.slice(0, 60), target, mode: settings.mode, targetMinutes: settings.minutes, weight: 4, must: settings.must };
    onChange(place ? replacePlace(profile, place.id, base) : addPlace(profile, base));
    setQuery("");
    setSearching(false);
  };
  return (
    <fieldset className="commute-fields" data-testid="commute-fields">
      <legend>Where do you travel to most?</legend>
      <div className="commute-destination">
        {showSearch ? (
          <div className="commute-search">
            <label htmlFor={`${idBase}-place`}>Place</label>
            <input id={`${idBase}-place`} type="search" value={query} autoComplete="off" placeholder="Station, postcode or address"
              aria-label="Where do you travel to most? Station, postcode or address" aria-autocomplete="list" aria-controls={options.length > 0 ? `${idBase}-options` : undefined}
              onChange={(event) => setQuery(event.target.value)} />
            {options.length > 0 && (
              <ul id={`${idBase}-options`} className="add-place-options" role="listbox" aria-label="Places found">
                {options.map((option) => (
                  <li key={option.key} role="option" aria-selected={false}>
                    <button type="button" onClick={() => pick(option.label, option.latitude, option.longitude)}>{option.text}</button>
                  </li>
                ))}
              </ul>
            )}
            {place && <button type="button" className="link-button" onClick={() => { setSearching(false); setQuery(""); }}>Keep {place.label}</button>}
          </div>
        ) : (
          <div className="commute-picked" data-testid="commute-picked">
            <span><small>Place</small>{place!.label}</span>
            <button type="button" className="link-button" onClick={() => setSearching(true)}>Change</button>
            <button type="button" className="link-button" aria-label={`Remove ${place!.label}`}
              onClick={() => onChange(removeCommute(profile, place!.id))}>Remove</button>
          </div>
        )}
        <TripChips name={place?.label ?? "your place"} minutes={settings.minutes} mode={settings.mode} modes={PLACE_MODES}
          onMinutes={(minutes) => update({ minutes })} onMode={(mode) => update({ mode })}>
          <button type="button" className="criterion-must" aria-pressed={settings.must} title="Must: leave out areas over this time"
            onClick={() => update({ must: !settings.must })}>Must</button>
        </TripChips>
      </div>
    </fieldset>
  );
}

function replacePlace(profile: PreferenceProfile, id: string, change: Partial<Omit<PlacePreference, "id">>): PreferenceProfile {
  return { ...profile, places: (profile.places ?? []).map((place) => (place.id === id ? { ...place, ...change } : place)) };
}

function removeCommute(profile: PreferenceProfile, id: string): PreferenceProfile {
  const places = (profile.places ?? []).filter((place) => place.id !== id);
  return { ...profile, places: places.length ? places : undefined };
}
