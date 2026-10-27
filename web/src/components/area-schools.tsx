"use client";

import { SchoolLink } from "./school/school-link";
import { useEffect, useState } from "react";

import { ChartIcon, ChartUnknown, type ChartTone } from "@/components/charts";
import type { BestPrimaryRank, GeographyId, SchoolObservation, SchoolSummary } from "@/lib/contracts";
import { SCHOOL_RADIUS_METRES } from "@/lib/overview-scorecard";
import { schoolPath } from "@/lib/school-card";
import { inspectionLabel } from "@/lib/school-evidence";
import type { OfstedMark } from "@/lib/school-icons";
import { fetchSectionJson } from "@/lib/section-fetch";


type SchoolsState = { status: "loading" } | { status: "unavailable" } | { status: "ready"; schools: SchoolSummary[] };

/** Every school count (tile, card, brief) uses one radius. */
const COMPARABILITY_NOTE = "Older Ofsted grades and the new report cards are not comparable.";
const PHASES = [
  { id: "primary", label: "primary", icon: "building-school", tone: "c1" },
  { id: "secondary", label: "secondary", icon: "school", tone: "c2" },
] as const satisfies ReadonlyArray<{ id: SchoolSummary["phase"]; label: string; icon: string; tone: ChartTone }>;

/**
 * State-funded schools within 1 km of the area (the same radius as the tile
 * and the brief), for the area card: the best primary and secondary by London
 * rank, the nearest as one-line rows, then a card per school behind "All N
 * schools". Report-card grades and older judgements are never merged; each
 * badge names which it is and its year. Distance is not a catchment.
 */
export function AreaSchoolsSection({ geographyId, best }: {
  geographyId: GeographyId;
  /** The best nearby primary and secondary by London rank (null: no rank yet). */
  best: { primary: BestPrimaryRank | null; secondary: BestPrimaryRank | null };
}) {
  const [state, setState] = useState<SchoolsState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void fetchSectionJson<{ schools?: SchoolSummary[] }>(
      `/api/v1/areas/${encodeURIComponent(geographyId)}/schools`,
    ).then((payload) => {
      if (!current) return;
      if (!payload?.schools) { setState({ status: "unavailable" }); return; }
      // The API searches wider; the page counts only the schools within the shared radius.
      const near = payload.schools.filter((school) => typeof school.distanceMetres !== "number" || school.distanceMetres <= SCHOOL_RADIUS_METRES);
      setState({ status: "ready", schools: near });
    });
    return () => { current = false; };
  }, [geographyId]);

  return (
    <section className="area-schools" data-testid="area-schools" aria-label="Nearby schools">
      {state.status === "loading" && <p>Loading schools…</p>}
      {state.status === "unavailable" && <p>School evidence is unavailable for this area.</p>}
      {state.status === "ready" && <CardSchools schools={state.schools} geographyId={geographyId} best={best} />}
    </section>
  );
}

/** One-line nearest rows in the area card, before "All N schools". */
const CARD_NEAREST = 3;

const byDistance = (a: SchoolSummary, b: SchoolSummary) =>
  (typeof a.distanceMetres === "number" ? a.distanceMetres : Infinity) - (typeof b.distanceMetres === "number" ? b.distanceMetres : Infinity);

/**
 * The area card's schools: the best nearby primary and secondary by their London
 * rank (name links to the school's page, then distance and Ofsted badge; the rank
 * itself is the Schools rating, so no % repeats here), the three nearest
 * other schools as one-line rows (name · phase · distance), then every school
 * folded behind "All N schools".
 */
function CardSchools({ schools, geographyId, best }: {
  schools: SchoolSummary[]; geographyId: GeographyId; best: { primary: BestPrimaryRank | null; secondary: BestPrimaryRank | null };
}) {
  const nearest = [...schools].sort(byDistance);
  // The best schools have their own rows: the nearest list never repeats them.
  const bestUrns = new Set([best.primary?.school.urn, best.secondary?.school.urn]);
  const others = nearest.filter((school) => !bestUrns.has(school.urn));
  return (
    <>
      <dl className="key-numbers" data-testid="schools-key-numbers">
        {PHASES.map((phase) => {
          const rank = best[phase.id];
          const school = rank ? schools.find((entry) => entry.urn === rank.school.urn) ?? null : null;
          return (
            <div key={phase.id} data-testid={`best-school-${phase.id}`}>
              <dt>Best {phase.label} nearby</dt>
              <dd className="school-best">
                {rank ? (
                  <>
                    <SchoolLink href={schoolPath(rank.school.urn, geographyId)} data-testid="best-school-link">{rank.school.name ?? school?.name ?? `School ${rank.school.urn}`}</SchoolLink>
                    <span className="school-best__distance">{distanceText(rank.school.distanceMetres ?? school?.distanceMetres)}</span>
                    {school && <RatingBadge rating={schoolRating(school.observations)} />}
                  </>
                ) : "No rank yet"}
              </dd>
            </div>
          );
        })}
      </dl>
      {nearest.length === 0 && <p className="schools-caption">No state school recorded within {SCHOOL_RADIUS_METRES / 1000} km</p>}
      {others.length > 0 && (
        <ul className="school-rows" aria-label="Nearest schools" data-testid="schools-nearest">
          {others.slice(0, CARD_NEAREST).map((school) => <SchoolRow key={school.schoolId} school={school} geographyId={geographyId} />)}
        </ul>
      )}
      {nearest.length > 0 && (
        <details className="area-disclosure" data-testid="area-schools-all">
          <summary>All {nearest.length} schools</summary>
          <ol className="area-schools-list">
            {nearest.map((school) => <SchoolItem key={school.schoolId} school={school} geographyId={geographyId} />)}
          </ol>
        </details>
      )}
    </>
  );
}

/** One line: phase icon, name (a link to its page), phase and straight-line distance; the badge is in "All N schools". */
/** Straight-line distance: metres under 1 km, else km to one decimal. */
function distanceText(metres: number | null | undefined): string {
  if (typeof metres !== "number") return "distance unknown";
  return metres < 1000 ? `${Math.round(metres).toLocaleString("en-GB")} m` : `${(metres / 1000).toFixed(1)} km`;
}

function SchoolRow({ school, geographyId }: { school: SchoolSummary; geographyId: GeographyId }) {
  const phase = PHASES.find((item) => item.id === school.phase) ?? PHASES[0];
  const distance = distanceText(school.distanceMetres);
  return (
    <li className="school-row" data-testid="area-school-row">
      <span className="school-card__phase" data-chart-tone={phase.tone} title={school.phase}><ChartIcon name={phase.icon} /></span>
      <SchoolLink href={schoolPath(school.urn, geographyId)} className="school-row__name" data-testid="area-school-link">{school.name}</SchoolLink>
      <span className="school-row__meta">{school.phase} · {distance}</span>
    </li>
  );
}

function SchoolItem({ school, geographyId }: { school: SchoolSummary; geographyId: GeographyId }) {
  const inspections = school.observations.filter((o) => o.kind !== "performance");
  const results = school.observations.filter((o) => o.kind === "performance");
  const phase = PHASES.find((item) => item.id === school.phase) ?? PHASES[0];
  const rating = schoolRating(school.observations);
  const details = inspections.length + results.length + school.missingObservations.length;
  return (
    <li className="school-card" data-testid="area-school">
      <span className="school-card__phase" data-chart-tone={phase.tone} title={school.phase}>
        <ChartIcon name={phase.icon} />
      </span>
      <div className="school-card__body">
        <div className="school-card__head">
          <strong className="school-card__name">
            <SchoolLink href={schoolPath(school.urn, geographyId)} data-testid="area-school-link">{school.name}</SchoolLink>
          </strong>
          {school.topBadge?.isTop && (
            <span className="school-card__top" data-testid="area-school-top" title={school.topBadge.line ?? school.topBadge.criteria}>
              Top school
            </span>
          )}
          <RatingBadge rating={rating} />
        </div>
        <small className="school-card__meta">
          {school.phase} · ages {school.ageRange.from}–{school.ageRange.to} · {school.type}
          {school.faith ? ` · ${school.faith}` : ""}
        </small>
        <SchoolDistance name={school.name} distance={school.distanceMetres} />
        {details > 0 && (
          <details className="school-card__more">
            <summary>Inspections and results</summary>
            <div className="school-card__evidence">
              {inspections.map((observation) => (
                <small key={`${observation.measure}-${observation.academicYear}`}>
                  <a href={observation.sourceUrl}>{inspectionLabel(observation)}</a>
                </small>
              ))}
              {results.map((observation) => <small key={observation.measure}>{resultText(observation)}</small>)}
              {school.missingObservations.map((missing) => <small key={missing}>Missing: {missing}.</small>)}
            </div>
          </details>
        )}
      </div>
    </li>
  );
}

/** "285 m" in a straight line: plain text, no scale. */
function SchoolDistance({ name, distance }: { name: string; distance: number | null | undefined }) {
  if (typeof distance !== "number") return <ChartUnknown>Distance unknown</ChartUnknown>;
  const text = distance < 1000 ? `${Math.round(distance).toLocaleString("en-GB")} m` : `${(distance / 1000).toFixed(1)} km`;
  return (
    <p className="school-card__distance">
      <span className="school-card__metres" aria-label={`${name}: ${text} away in a straight line`}>{text}</span>
    </p>
  );
}

type Rating = { text: string; tag: string | null; tone: ChartTone; detail: string } | null;

const GOOD = /outstanding|exceptional|strong/i;
const BAD = /inadequate|requires improvement|needs attention|urgent/i;
/** Ofsted report-card grades, best first. */
const GRADE_ORDER = [/exceptional/i, /strong/i, /expected/i, /needs attention/i, /urgent/i];

/** "2022/23" -> "2023": the calendar year an academic year ends. */
function inspectionYear(academicYear: string | null | undefined): string | null {
  const match = /(\d{4})\D+(\d{2,4})$/.exec(academicYear ?? "");
  if (!match) return /^\d{4}$/.test(academicYear ?? "") ? academicYear! : null;
  return match[2].length === 4 ? match[2] : `${match[1].slice(0, 2)}${match[2]}`;
}

const capitalise = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

/**
 * One badge per school without merging frameworks: a new report card reads
 * its most common grade, "Strong (new report card)"; otherwise the older
 * overall grade and its year, "Good (2023)". The full tally and the
 * comparability note sit in one tooltip. No rating reads "Not rated", never
 * a score.
 */
export function schoolRating(observations: SchoolObservation[]): Rating {
  const current = observations.filter((o) => o.kind === "inspection-current" && o.value !== null);
  if (current.length > 0 && current.some((o) => typeof o.value !== "string")) {
    return { text: "New report card", tag: null, tone: "neutral", detail: `Ofsted report card ${current[0].academicYear}. ${COMPARABILITY_NOTE}` };
  }
  if (current.length > 0) {
    const tally = new Map<string, number>();
    for (const o of current) {
      const grade = String(o.value).trim().replace(/ standard$/i, "").toLowerCase();
      tally.set(grade, (tally.get(grade) ?? 0) + 1);
    }
    const values = current.map((o) => String(o.value));
    const tone: ChartTone = values.some((v) => BAD.test(v)) ? "bad" : values.some((v) => GOOD.test(v)) ? "good" : "neutral";
    const rank = (grade: string) => { const at = GRADE_ORDER.findIndex((pattern) => pattern.test(grade)); return at < 0 ? GRADE_ORDER.length : at; };
    const ordered = [...tally].sort(([a, countA], [b, countB]) => countB - countA || rank(a) - rank(b));
    const summary = [...tally].sort(([a], [b]) => rank(a) - rank(b)).map(([grade, count]) => `${count} ${grade}`).join(" · ");
    return {
      text: `${capitalise(ordered[0][0])} (new report card)`, tag: null, tone,
      detail: `Ofsted report card ${current[0].academicYear}: ${summary}. ${COMPARABILITY_NOTE}`,
    };
  }
  // The overall judgement first; an ungraded inspection confirms the previous grade ("School remains Good").
  const legacies = observations.filter((o) => o.kind === "inspection-legacy" && o.value !== null);
  const legacy = legacies.find((o) => !o.measure || /overall/i.test(o.measure)) ?? legacies[0];
  if (legacy) {
    const raw = String(legacy.value).trim();
    const value = /^school remains /i.test(raw) ? raw.replace(/^school remains /i, "") : raw;
    const tone: ChartTone = BAD.test(value) ? "bad" : /outstanding|good/i.test(value) ? "good" : "neutral";
    const year = inspectionYear(legacy.academicYear);
    return {
      text: year ? `${capitalise(value)} (${year})` : capitalise(value), tag: null, tone,
      detail: `Older Ofsted ${(legacy.measure || "judgement").toLowerCase()} ${legacy.academicYear}: ${raw}. ${COMPARABILITY_NOTE}`,
    };
  }
  return null;
}

const LEGACY_MARKS: [RegExp, OfstedMark][] = [
  [/outstanding/i, "outstanding"], [/good/i, "good"],
  [/requires improvement|satisfactory/i, "requires-improvement"], [/inadequate|special measures|serious weaknesses/i, "inadequate"],
];

/**
 * The school's Ofsted mark for an icon (lib/school-icons.ts, the map popup's set): a new report card,
 * else the older overall grade; null when not rated. The label is the badge's words ("Ofsted: Good (2023)").
 */
export function ofstedMark(observations: SchoolObservation[]): { mark: OfstedMark; label: string } | null {
  const rating = schoolRating(observations);
  if (!rating) return null;
  if (/report card/i.test(rating.text)) {
    const grade = rating.text.replace(/ \(new report card\)$/i, "");
    return { mark: "report-card", label: grade === rating.text ? "New Ofsted report card" : `New Ofsted report card: ${grade}` };
  }
  const mark = LEGACY_MARKS.find(([pattern]) => pattern.test(rating.text))?.[1];
  return mark ? { mark, label: `Ofsted: ${rating.text}` } : null;
}

export function RatingBadge({ rating }: { rating: Rating }) {
  if (!rating) return <span className="school-badge" data-chart-tone="neutral" data-empty="">Not rated</span>;
  return (
    <span className="school-badge" data-chart-tone={rating.tone} title={rating.detail}>
      <span className="sr-only">{rating.detail}</span>
      <span className="school-badge__dot" aria-hidden="true" />
      <span aria-hidden="true">{rating.text}</span>
      {rating.tag && <small aria-hidden="true">{rating.tag}</small>}
    </span>
  );
}

function resultText(observation: SchoolObservation): string {
  const value = observation.value === null ? "not published" : observation.value;
  const cohort = observation.cohortSize ? ` (${observation.cohortSize} pupils)` : "";
  return `${observation.measure} ${observation.academicYear}: ${value}${cohort}`;
}
