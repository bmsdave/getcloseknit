import { useEffect, useState } from "react";

import type { AdmissionEvidence, SchoolObservation, SchoolSearchResponse, SchoolSummary, SchoolSummaryResponse } from "@/lib/contracts";
import { fetchSectionJson } from "@/lib/section-fetch";
import {
  DISTANCE_INSUFFICIENT_EXPLANATION,
  addAdmissionQuestion,
  closureLabel,
  hasAdmissionEvidence,
  inspectionLabel,
  matchesSchoolQuery,
  pilotAdmissionCoverage,
  setAdmissionQuestionAnswered,
  type AdmissionQuestion,
} from "@/lib/school-evidence";

interface SchoolDiscoveryProps {
  /** Schools listed before any search (the demo directory; none in real mode). */
  schools: SchoolSummary[];
  phases: ("primary" | "secondary")[];
  shortlistUrns: string[];
  onToggleShortlist: (urn: string, checked: boolean) => void;
}

const MIN_QUERY = 3;

export function SchoolDiscovery(props: SchoolDiscoveryProps) {
  const [query, setQuery] = useState("");
  const schools = useSchoolDirectory(props.schools, query, props.shortlistUrns);
  const visible = schools.filter(
    (school) => props.phases.includes(school.phase) && matchesSchoolQuery(school, query),
  );
  return (
    <section className="school-discovery" data-testid="school-discovery">
      <label>Search schools
        <input
          aria-label="Search schools"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {visible.length === 0 && (schools.length === 0 && query.trim().length < MIN_QUERY
        ? <p>Type {MIN_QUERY} or more letters of a school&apos;s name to search London schools.</p>
        : <p>No directory schools match this search and phase selection.</p>)}
      {visible.map((school) => (
        <SchoolCard
          key={school.urn}
          school={school}
          shortlisted={props.shortlistUrns.includes(school.urn)}
          onToggleShortlist={props.onToggleShortlist}
        />
      ))}
      {hasAdmissionEvidence(schools) && <AdmissionsPilot schools={schools} shortlistUrns={props.shortlistUrns} />}
      <p className="school-discovery-note">
        Every fact below is a dated observation with its publisher record. Travel times and
        admission cutoffs are separate evidence and never decide what a school teaches.
      </p>
    </section>
  );
}

/**
 * Every school seen so far, by URN: the initial list, /api/v1/schools?q=
 * answers for searches of 3+ letters, and shortlisted schools fetched one by
 * one so they stay listed after a reload.
 */
function useSchoolDirectory(initial: SchoolSummary[], query: string, shortlistUrns: string[]): SchoolSummary[] {
  const [found, setFound] = useState<Record<string, SchoolSummary>>({});
  const remember = (schools: SchoolSummary[]) =>
    setFound((known) => ({ ...known, ...Object.fromEntries(schools.map((school) => [school.urn, school])) }));
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < MIN_QUERY) return;
    let current = true;
    const timeout = window.setTimeout(() => {
      void fetchSectionJson<SchoolSearchResponse>(`/api/v1/schools?q=${encodeURIComponent(needle)}`).then((payload) => {
        if (current && payload?.schools) remember(payload.schools);
      });
    }, 200);
    return () => { current = false; window.clearTimeout(timeout); };
  }, [query]);
  const missing = shortlistUrns.filter((urn) => !initial.some((school) => school.urn === urn)).sort().join(",");
  useEffect(() => {
    let current = true;
    for (const urn of missing.split(",").filter(Boolean)) {
      void fetchSectionJson<SchoolSummaryResponse>(`/api/v1/schools/${encodeURIComponent(urn)}`).then((payload) => {
        if (current && payload?.school) remember([payload.school]);
      });
    }
    return () => { current = false; };
  }, [missing]);
  const byUrn = new Map(initial.map((school) => [school.urn, school]));
  for (const school of Object.values(found)) if (!byUrn.has(school.urn)) byUrn.set(school.urn, school);
  return [...byUrn.values()];
}

function SchoolCard({ school, shortlisted, onToggleShortlist }: {
  school: SchoolSummary;
  shortlisted: boolean;
  onToggleShortlist: (urn: string, checked: boolean) => void;
}) {
  const closure = closureLabel(school);
  return (
    <article data-testid={`school-card-${school.urn}`}>
      <div><strong>{school.name}</strong><span>{school.phase} · {school.type}</span></div>
      {school.previousNames.length > 0 && <small>Previously: {school.previousNames.join(", ")}</small>}
      {closure !== null && <small>{closure}</small>}
      {school.observations.map((observation, index) => (
        <ObservationLine key={`${observation.academicYear}-${observation.measure}-${index}`} observation={observation} />
      ))}
      {school.missingObservations.map((missing) => <small key={missing}>Missing: {missing}.</small>)}
      <label>
        <input
          type="checkbox"
          aria-label={`Shortlist ${school.name}`}
          checked={shortlisted}
          onChange={(event) => onToggleShortlist(school.urn, event.target.checked)}
        />
        Shortlist
      </label>
    </article>
  );
}

function ObservationLine({ observation }: { observation: SchoolObservation }) {
  const text = observation.kind === "performance"
    ? `${observation.measure} ${observation.academicYear}: ${observation.value ?? "not published"}`
    : inspectionLabel(observation);
  return (
    <small>
      {text} {cohortText(observation)}{" "}
      <a href={observation.sourceUrl}>Publisher record ({observation.sourceRelease})</a>
    </small>
  );
}

function cohortText(observation: SchoolObservation): string {
  if (observation.cohortSize === null) return "· cohort not published";
  const suppressed = observation.suppressed ? " · suppressed small sample" : "";
  return `· cohort ${observation.cohortSize}${suppressed}`;
}

export function AdmissionsPilot({ schools, shortlistUrns }: {
  schools: SchoolSummary[];
  shortlistUrns: string[];
}) {
  const [selectedUrn, setSelectedUrn] = useState(schools[0]?.urn ?? "");
  const [year, setYear] = useState<string | null>(null);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const selected = schools.find((school) => school.urn === selectedUrn) ?? schools[0] ?? null;
  if (selected === null) return null;
  const years = admissionYears(selected.admissionEvidence);
  const activeYear = year !== null && years.includes(year) ? year : years[years.length - 1] ?? null;
  const coverage = pilotAdmissionCoverage(selected.admissionEvidence.authorityCode ?? "unpublished");
  return (
    <section className="admissions-pilot" data-testid="admissions-pilot">
      <h3>Admissions evidence pilot</h3>
      <p>{coverage.note}</p>
      <AdmissionSelectors
        schools={schools}
        selectedUrn={selected.urn}
        onSchool={(urn) => { setSelectedUrn(urn); setYear(null); }}
        years={years}
        activeYear={activeYear}
        onYear={setYear}
      />
      <AdmissionCutoffLine evidence={selected.admissionEvidence} year={activeYear} />
      <p>{claimLine(selected.admissionEvidence)}</p>
      <p>{DISTANCE_INSUFFICIENT_EXPLANATION}</p>
      <button type="button" onClick={() => setGuidanceOpen((open) => !open)}>
        {guidanceOpen ? "Hide authority guidance" : "Show authority guidance"}
      </button>
      {guidanceOpen && <AuthorityGuidance evidence={selected.admissionEvidence} />}
      <p>Shortlisted for visits: {shortlistNames(schools, shortlistUrns)}.</p>
      <AdmissionQuestions />
      <p>No child details are collected — record questions only.</p>
    </section>
  );
}

function AdmissionSelectors({ schools, selectedUrn, onSchool, years, activeYear, onYear }: {
  schools: SchoolSummary[];
  selectedUrn: string;
  onSchool: (urn: string) => void;
  years: string[];
  activeYear: string | null;
  onYear: (year: string) => void;
}) {
  return (
    <>
      <label>Admission school
        <select aria-label="Admission school" value={selectedUrn} onChange={(event) => onSchool(event.target.value)}>
          {schools.map((school) => <option key={school.urn} value={school.urn}>{school.name}</option>)}
        </select>
      </label>
      <label>Admission year
        <select aria-label="Admission year" value={activeYear ?? ""} onChange={(event) => onYear(event.target.value)}>
          {years.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </>
  );
}

function AdmissionCutoffLine({ evidence, year }: { evidence: AdmissionEvidence; year: string | null }) {
  if (year === null) return <p data-testid="admission-cutoff">No admission years published for this school.</p>;
  const cutoffs = evidence.cutoffs.filter((cutoff) => cutoff.academicYear === year);
  if (cutoffs.length === 0) {
    return <p data-testid="admission-cutoff">No published cutoff for {year} — a gap in the observations.</p>;
  }
  return (
    <div data-testid="admission-cutoff">
      {cutoffs.map((cutoff) => (
        <p key={`${cutoff.academicYear}-${cutoff.priorityGroup ?? "distance"}`}>
          {cutoff.academicYear} · {cutoff.priorityGroup ?? "distance"}:{" "}
          {cutoff.distanceMetres.toLocaleString("en-GB")} m last distance{" "}
          <a href={cutoff.sourceUrl}>Publisher record ({cutoff.academicYear})</a>
        </p>
      ))}
      {(evidence.missingYears ?? []).length > 0 && (
        <p>Gap: {(evidence.missingYears ?? []).join(", ")} not published.</p>
      )}
    </div>
  );
}

function AuthorityGuidance({ evidence }: { evidence: AdmissionEvidence }) {
  return (
    <div data-testid="authority-guidance">
      <p>Priority rules: {(evidence.priorityRules ?? []).length > 0 ? evidence.priorityRules?.join("; ") : "not published — see guidance"}.</p>
      <p>Measured distance: {evidence.measurementMethod ?? "varies by year — see guidance"}.</p>
      <p>Priority area: {evidence.priorityArea ?? "not published — no circle is inferred"}.</p>
      {evidence.guidanceUrl
        ? <a href={evidence.guidanceUrl}>Authority guidance ({evidence.authorityName ?? "admissions authority"})</a>
        : <p>No guidance link published for this authority.</p>}
    </div>
  );
}

function AdmissionQuestions() {
  const [questions, setQuestions] = useState<AdmissionQuestion[]>([]);
  const [draft, setDraft] = useState("");
  return (
    <div>
      <label>New admissions question
        <input aria-label="New admissions question" value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <button type="button" onClick={() => { setQuestions(addAdmissionQuestion(questions, draft)); setDraft(""); }}>
        Add admissions question
      </button>
      <ul>
        {questions.map((question, index) => (
          <li key={question.id}>
            <span>{question.text}</span> <span>({question.answered ? "answered" : "unanswered"})</span>
            <label>
              <input
                type="checkbox"
                aria-label={`Mark admissions question ${index + 1} answered`}
                checked={question.answered}
                onChange={(event) => setQuestions(setAdmissionQuestionAnswered(questions, question.id, event.target.checked))}
              />
              Answered
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function admissionYears(evidence: AdmissionEvidence): string[] {
  return [...new Set([...evidence.academicYears, ...evidence.cutoffs.map((cutoff) => cutoff.academicYear)])].sort();
}

function claimLine(evidence: AdmissionEvidence): string {
  if (evidence.kind === "historical-reach") {
    return `Historical reach: ${evidence.yearsWithin} of ${evidence.academicYears.length} years — observations, not eligibility.`;
  }
  if (evidence.kind === "verified-boundary") return "Verified priority boundary.";
  return "Evidence unavailable — admission is not implied.";
}

function shortlistNames(schools: SchoolSummary[], shortlistUrns: string[]): string {
  const names = schools.filter((school) => shortlistUrns.includes(school.urn)).map((school) => school.name);
  return names.length > 0 ? names.join(", ") : "none yet — tick Shortlist on a school card";
}
