"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useId, useState } from "react";

import { placesByPriority, routablePlaces, type AreaCommute } from "@/lib/commute";
import type { GeographyId, PreferenceProfile } from "@/lib/contracts";
import { isUnsetProfile } from "@/lib/profile-state";
import { pageTailor, tailorLine, type PageTailor, type TailorPlace } from "@/lib/area-tailor";
import { SOFT_MINUTES_FACTOR } from "@/lib/match-model";
import { withoutTailor } from "@/lib/tailor";

import { KnitIcon } from "./knit/knit-icon";
import { useAreaCommute } from "./match/use-area-commute";

const TailorWizard = dynamic(() => import("./tailor-wizard").then((loaded) => loaded.TailorWizard), { ssr: false });

const HOUSE_TYPES = [
  { id: "terraced", label: "Terraced" },
  { id: "semi", label: "Semi" },
  { id: "detached", label: "Detached" },
] as const;

/**
 * The page's tailoring from the household's saved profile, and its places from this area (one request
 * for the page): the tags use the first pinned address, Getting around lists the pinned addresses door
 * to door, Local places the nearest of each kind (a gym, an M&S, a top school).
 */
export function usePageTailor(geographyId: GeographyId, profile: PreferenceProfile): { tailor: PageTailor; commute: AreaCommute | null } {
  const places = profile.places ?? [];
  const commute = useAreaCommute(places.length && geographyId.startsWith("uk:lsoa:") ? geographyId : null, profile);
  // The household's #1 place (My match's order), not merely the first one pinned.
  const routable = new Set(routablePlaces(places).map((place) => place.id));
  const first = placesByPriority(profile).find((place) => routable.has(place.id));
  const minutes = first ? commute?.places.find((entry) => entry.placeId === first.id)?.modes[first.mode]?.minutes ?? null : null;
  // Every place in My match's order, one tag each (CUJ13): an address door to door in its own mode, the
  // nearest of a kind (a gym, a park) as Local places reads it (on foot, or by bike or car when that is its mode).
  const tagged: TailorPlace[] = placesByPriority(profile).map((place) => {
    const entry = commute?.places.find((item) => item.placeId === place.id);
    const local = place.target.kind === "point" ? place.mode : place.mode === "cycle" || place.mode === "car" ? place.mode : "walk";
    return { label: place.label, minutes: entry?.modes[local]?.minutes ?? null, targetMinutes: place.targetMinutes,
      softMinutes: place.softMinutes ?? Math.round(place.targetMinutes * SOFT_MINUTES_FACTOR) };
  });
  return { tailor: { ...pageTailor(profile, !isUnsetProfile(profile), minutes), places: tagged }, commute };
}

/**
 * One chip under the tags: "Tailored to: Buy ≤ £1.2m · 3-bed · Terraced, Semi · King's
 * Cross ✎", or "Tailor this page". It opens a small card: the house types (the profile's houseTypes),
 * the Tailor steps and My match. Tailoring only reorders and highlights; the page stays complete.
 */
export function PageTailorChip({ profile, tailor, onSave }: {
  profile: PreferenceProfile; tailor: PageTailor; onSave: (profile: PreferenceProfile) => void;
}) {
  const [card, setCard] = useState(false);
  const [wizard, setWizard] = useState(false);
  const cardId = useId();
  const line = tailorLine(tailor);
  const chosen = profile.houseTypes ?? [];
  const toggle = (type: (typeof HOUSE_TYPES)[number]["id"]) => {
    const next = chosen.includes(type) ? chosen.filter((entry) => entry !== type) : [...chosen, type];
    const ordered = HOUSE_TYPES.map((entry) => entry.id).filter((entry) => next.includes(entry));
    onSave({ ...profile, houseTypes: ordered.length ? ordered : undefined });
  };
  return (
    <div className="tailor page-tailor" data-testid="page-tailor">
      <button type="button" className="chip-button tailor-chip" data-testid="tailor-chip" aria-expanded={card} aria-controls={cardId}
        onClick={() => setCard(!card)}>
        <KnitIcon name="heart" colour="currentColor" className="tailor-chip__icon" />
        {line ? <span>Tailored to: {line} <span aria-hidden="true">✎</span></span> : <span>Tailor this page</span>}
      </button>
      {card && (
        <div className="tailor-card" id={cardId} role="region" aria-label="Tailor this page" data-testid="tailor-card">
          <p className="tailor-card__title">House types first</p>
          <div className="page-tailor__types" role="group" aria-label="House types">
            {HOUSE_TYPES.map((type) => (
              <button key={type.id} type="button" className="chip-button" aria-pressed={chosen.includes(type.id)}
                data-testid={`tailor-type-${type.id}`} onClick={() => toggle(type.id)}>
                {type.label}
              </button>
            ))}
          </div>
          <p className="tailor-card__note">Kept on this device.</p>
          <div className="tailor-card__actions">
            <button type="button" className="chip-button" data-testid="tailor-edit" onClick={() => { setCard(false); setWizard(true); }}>Who&apos;s moving</button>
            <Link className="chip-button" href="/?layer=personal-match" data-testid="tailor-my-match">My match</Link>
            {(chosen.length > 0 || profile.household || profile.lifestyle?.length) && (
              <button type="button" className="chip-button" data-testid="tailor-reset" onClick={() => {
                const next = withoutTailor(profile);
                delete next.houseTypes;
                onSave(next);
              }}>Reset</button>
            )}
          </div>
        </div>
      )}
      {wizard && <TailorWizard open profile={profile} onSave={onSave} onClose={() => setWizard(false)} />}
    </div>
  );
}
