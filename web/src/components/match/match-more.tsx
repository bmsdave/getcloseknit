"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { PreferenceProfile } from "@/lib/contracts";
import { SCHOOLS } from "@/lib/fixtures";
import type { DataMode } from "@/lib/map-state";
import { tailorSummary } from "@/lib/tailor";

import { SchoolDiscovery } from "../school-discovery";

// Tailor's steps load when first opened, as on the area page (tailor-card.tsx).
const TailorWizard = dynamic(() => import("../tailor-wizard").then((loaded) => loaded.TailorWizard), { ssr: false });

/**
 * What the old wizard's "More options" kept beside the criteria and My match still offers: Tailor
 * (kids, gym, commute; on this device only) and the schools the household would use or name. Folded, under the ten.
 */
export function MatchMore({ profile, onChange, mode }: { profile: PreferenceProfile; onChange: (profile: PreferenceProfile) => void; mode: DataMode }) {
  const [tailoring, setTailoring] = useState(false);
  const phase = profile.school.phases[0] === "secondary" ? "secondary" : "primary";
  const setPhase = (next: "primary" | "secondary") => onChange({
    ...profile,
    school: { ...profile.school, phases: [next] },
    places: (profile.places ?? []).map((place) => place.target.kind === "school" ? { ...place, target: { ...place.target, phase: next } } : place),
  });
  return (
    <div className="match-more-extra">
      <p className="match-more-tailor">
        {Boolean(profile.household || profile.lifestyle?.length) && (
          <span data-testid="match-tailor-summary">For: {tailorSummary(profile)} (from Tailor, on this device only) · </span>
        )}
        <button type="button" className="link-button" data-testid="match-tailor-open" onClick={() => setTailoring(true)}>Tailor: kids, gym, commute</button>
      </p>
      {tailoring && <TailorWizard open profile={profile} onSave={onChange} onClose={() => setTailoring(false)} />}
      <details className="match-saved" data-testid="refine-schools">
        <summary>Schools you would consider</summary>
        <fieldset className="level-row" data-testid="school-phase">
          <legend><span>Schools you would use</span></legend>
          <div className="segmented" role="radiogroup" aria-label="Schools you would use">
            {(["primary", "secondary"] as const).map((value) => (
              <label key={value}>
                <input type="radio" name="match-school-phase" value={value} checked={phase === value} onChange={() => setPhase(value)} />
                <span>{value === "primary" ? "Primary" : "Secondary"}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <SchoolDiscovery schools={mode === "demo" ? SCHOOLS : []} phases={profile.school.phases} shortlistUrns={profile.school.shortlistUrns}
          onToggleShortlist={(urn, checked) => onChange({ ...profile, school: { ...profile.school, shortlistUrns: checked
            ? [...new Set([...profile.school.shortlistUrns, urn])] : profile.school.shortlistUrns.filter((item) => item !== urn) } })} />
      </details>
    </div>
  );
}
