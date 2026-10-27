"use client";

import { SchoolLink } from "./school/school-link";
import { useEffect, useMemo, useState } from "react";

import type { GeographyId, SchoolSummary } from "@/lib/contracts";
import { schoolPath } from "@/lib/school-card";
import { areaSchoolsPath } from "@/lib/section-seed";
import { useSectionJson } from "./section-seed";

import { ofstedMark, schoolRating } from "./area-schools";
import { OfstedIcon } from "./school/ofsted-icon";

/** The area page counts and lists state schools within the API's 1.5 km (the tile says the same). */
export const AREA_SCHOOL_RADIUS_METRES = 1500;
const ROWS = 5;
const PHASES = [
  { id: "primary", label: "Primary" },
  { id: "secondary", label: "Secondary" },
] as const;
export type SchoolPhase = (typeof PHASES)[number]["id"];

/** State primary and secondary schools within 1.5 km, nearest first; null while loading. */
export function useAreaSchoolList(geographyId: GeographyId): SchoolSummary[] | null | "unavailable" {
  const payload = useSectionJson<{ schools?: SchoolSummary[] }>(areaSchoolsPath(geographyId));
  return useMemo(() => {
    if (payload === undefined) return null;
    const near = payload?.schools?.filter((school) => (school.phase === "primary" || school.phase === "secondary")
      && (typeof school.distanceMetres !== "number" || school.distanceMetres <= AREA_SCHOOL_RADIUS_METRES));
    return near ? [...near].sort((a, b) => (a.distanceMetres ?? Infinity) - (b.distanceMetres ?? Infinity)) : "unavailable";
  }, [payload]);
}

export function outstandingCount(schools: readonly SchoolSummary[]): number {
  return schools.filter((school) => /outstanding/i.test(schoolRating(school.observations)?.text ?? "")).length;
}

const distance = (metres: number | null | undefined) => typeof metres !== "number" ? "distance unknown"
  : metres < 1000 ? `${Math.round(metres).toLocaleString("en-GB")} m` : `${(metres / 1000).toFixed(1)} km`;

/**
 * Primary | Secondary, then the five nearest of that phase as rows (board V3-33b): the Ofsted mark (the
 * school popup's icons, words as its label), name (its page), Top 10% when the school has the London Top
 * badge, then the distance. No distance scale: the distance stays in the row (owner decision).
 * `first` is the phase the household's children are at.
 */
export function SchoolPhaseRows({ schools, geographyId, first = "primary", rows = ROWS }: {
  schools: readonly SchoolSummary[]; geographyId: GeographyId; first?: SchoolPhase;
  /** How many of the phase to list: five on the area card, area360's 16 on a home page. */
  rows?: number;
}) {
  const [phase, setPhase] = useState<SchoolPhase>(first);
  useEffect(() => setPhase(first), [first]);
  const shown = schools.filter((school) => school.phase === phase);
  const meta = PHASES.find((entry) => entry.id === phase)!;
  return (
    <div className="school-phases" data-testid="school-phases">
      <div className="phase-toggle" role="group" aria-label="School phase">
        {(first === "secondary" ? [...PHASES].reverse() : PHASES).map((entry) => (
          <button key={entry.id} type="button" className="chip-button" aria-pressed={phase === entry.id} data-testid={`school-phase-${entry.id}`}
            onClick={() => setPhase(entry.id)}>
            {entry.label} · {schools.filter((school) => school.phase === entry.id).length}
          </button>
        ))}
      </div>
      {shown.length === 0
        ? <p className="area-section__status">No state {meta.label.toLowerCase()} school within 1.5 km</p>
        : (
          <ul className="school-rows" aria-label={`Nearest ${meta.label.toLowerCase()} schools`} data-testid="schools-nearest">
            {shown.slice(0, rows).map((school) => {
              const ofsted = ofstedMark(school.observations);
              return (
                <li key={school.schoolId} className="school-row" data-testid="area-school-row" data-ofsted={ofsted?.mark ?? "none"}>
                  {/* The map cap's top in the grade's colour; not rated: the plain sun top, as on the map. */}
                  <OfstedIcon mark={ofsted?.mark ?? null} label={ofsted?.label ?? "Not rated by Ofsted"} size={22} className="school-row__ofsted" />
                  <SchoolLink href={schoolPath(school.urn, geographyId)} className="school-row__name" data-testid="area-school-link">{school.name}</SchoolLink>
                  {school.topBadge?.isTop && <span className="school-row__top" data-testid="area-school-top" title={school.topBadge.line ?? school.topBadge.criteria}>Top 10%</span>}
                  <span className="school-row__meta">{distance(school.distanceMetres)}</span>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
