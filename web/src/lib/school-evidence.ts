// AE-21: reviewed school directory plus dated URN-keyed observations.
//
// Every observation keeps its publication year and publisher record. Current
// report-card facets and legacy overall judgements are never merged: a legacy
// grade is labelled legacy and incomparable. There is no universal school
// quality score here — scoring runs only on caller-supplied parent
// priorities. Distances and admission eligibility stay out of this module;
// they live with journeys and the school_admissions evidence.
export type SchoolStatus = "open" | "closed";

export type ObservationKind = "performance" | "inspection-current" | "inspection-legacy";

export interface SchoolObservation {
  kind: ObservationKind;
  academicYear: string;
  measure: string;
  value: number | string | null;
  cohortSize: number | null;
  suppressed: boolean;
  sourceUrl: string;
  sourceRelease: string;
}

export interface LinkedSchool {
  urn: string;
  name: string;
  previousNames: string[];
  phase: "primary" | "secondary";
  status: SchoolStatus;
  closedDate: string | null;
  predecessorUrn: string | null;
  successorUrn: string | null;
}

export interface ReviewedSchool extends LinkedSchool {
  observations: SchoolObservation[];
  missingObservations: string[];
  sourceRelease: string;
}

export interface ParentPriorityScore {
  value: number | null;
  evidenceCompleteness: number;
}

export function resolveCurrentSchool(schools: LinkedSchool[], urn: string): LinkedSchool {
  let current = requireSchool(schools, urn);
  const seen = new Set([current.urn]);
  while (current.successorUrn !== null) {
    current = requireSchool(schools, current.successorUrn);
    if (seen.has(current.urn)) throw new Error(`URN successor cycle at ${current.urn}`);
    seen.add(current.urn);
  }
  return current;
}

export function schoolHistory(schools: LinkedSchool[], urn: string): LinkedSchool[] {
  const current = resolveCurrentSchool(schools, urn);
  const history = [current];
  while (history[history.length - 1].predecessorUrn !== null) {
    history.push(requireSchool(schools, history[history.length - 1].predecessorUrn as string));
  }
  return history.reverse();
}

export function inspectionLabel(observation: SchoolObservation): string {
  if (observation.kind === "inspection-legacy") {
    const what = !observation.measure || /overall/i.test(observation.measure)
      ? "Legacy overall judgement"
      : `Legacy judgement, ${observation.measure.toLowerCase()}`;
    return `${what} ${observation.academicYear}: ${observation.value} — ` +
      "not comparable with current report-card facets.";
  }
  return `${observation.measure} ${observation.academicYear}: ${observation.value}`;
}

export function parentPriorityScore(
  facets: Record<string, number | null>,
  weights: Record<string, number>,
): ParentPriorityScore {
  const active = Object.entries(weights).filter(([, weight]) => weight > 0);
  if (active.length === 0) throw new Error("parent priorities required: no universal school score exists");
  const total = active.reduce((sum, [, weight]) => sum + weight, 0);
  const available = active.filter(([facet]) => facets[facet] !== null && facets[facet] !== undefined);
  const covered = available.reduce((sum, [, weight]) => sum + weight, 0);
  const completeness = Math.round((covered / total) * 100);
  if (available.length === 0) return { value: null, evidenceCompleteness: completeness };
  const weighted = available.reduce((sum, [facet, weight]) => sum + (facets[facet] as number) * weight, 0);
  return { value: Math.round(weighted / covered), evidenceCompleteness: completeness };
}

export function matchesSchoolQuery(school: LinkedSchool, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  if (!needle) return true;
  return `${school.name} ${school.previousNames.join(" ")} ${school.phase}`
    .toLocaleLowerCase("en-GB").includes(needle);
}

export function closureLabel(school: LinkedSchool): string | null {
  if (school.status === "open") return null;
  const successor = school.successorUrn === null ? "no successor recorded" : `succeeded by URN ${school.successorUrn}`;
  return `Closed ${school.closedDate ?? "date unknown"} — ${successor}.`;
}

function requireSchool(schools: LinkedSchool[], urn: string): LinkedSchool {
  const found = schools.find((candidate) => candidate.urn === urn);
  if (!found) throw new Error(`unknown URN: ${urn}`);
  return found;
}

// AE-22: bounded admissions-evidence pilot. Historical cutoffs are
// observations with gaps, never eligibility: a home within a past cutoff
// never becomes a guaranteed place, and probabilities stay unsupported.
export const DISTANCE_PRIORITY_GROUP = "distance";

export const DISTANCE_INSUFFICIENT_EXPLANATION =
  "A home distance alone is insufficient: past cutoffs vary by year and " +
  "priority group, so being within a historical distance never guarantees " +
  "a place. Check the current authority guidance before relying on it.";

export interface AdmissionAuthority {
  code: string;
  name: string;
}

export const PILOT_ADMISSION_AUTHORITIES: AdmissionAuthority[] = [
  { code: "E09000033", name: "Westminster" },
  { code: "E09000007", name: "Camden" },
  { code: "E09000019", name: "Islington" },
];

export interface PriorityCutoff {
  academicYear: string;
  priorityGroup: string;
  distanceMetres: number | null;
  measurementMethod: string;
  sourceUrl: string;
  sourceRelease: string;
}

export interface AuthorityGuide {
  authorityCode: string;
  authorityName: string;
  academicYear: string;
  priorityRules: string[];
  measurementMethod: string;
  priorityArea: string;
  guidanceUrl: string;
  sourceRelease: string;
}

export interface AdmissionQuestion {
  id: string;
  text: string;
  url: string | null;
  answered: boolean;
}

export type AdmissionClaim = "historical-only" | "unavailable";

export interface AdmissionAssessment {
  claim: AdmissionClaim;
  explanation: string;
  yearsObserved: number;
  yearsWithin: number;
  missingYears: string[];
  conflicting: boolean;
  isProbability: false;
}

export interface PilotCoverage {
  authorityCode: string;
  covered: boolean;
  pilotCodes: string[];
  note: string;
}

export function assessPilotAdmissions(
  cutoffs: PriorityCutoff[],
  homeDistanceMetres: number,
  guide: AuthorityGuide | null = null,
  expectedYears: string[] = [],
): AdmissionAssessment {
  const distance = cutoffs.filter((cut) => cut.priorityGroup === DISTANCE_PRIORITY_GROUP);
  const others = [...new Set(cutoffs.map((cut) => cut.priorityGroup))].filter((group) => group !== DISTANCE_PRIORITY_GROUP).sort();
  const observed = new Set(distance.map((cut) => cut.academicYear));
  const missing = expectedYears.filter((year) => !observed.has(year));
  const methods = new Set(distance.map((cut) => cut.measurementMethod));
  if (guide !== null) methods.add(guide.measurementMethod);
  if (methods.size > 1) return conflictAssessment(distance, missing, others);
  if (missing.length > 0 && missing[missing.length - 1] === expectedYears[expectedYears.length - 1]) {
    return recentGapAssessment(distance, missing, others);
  }
  return historicalAssessment(distance, homeDistanceMetres, missing, others);
}

export function estimateAdmissionProbability(..._args: unknown[]): never {
  throw new Error("admission probabilities are unsupported: show historical cutoffs, never a chance");
}

/** The admissions pilot shows only when some school has cutoff evidence; real releases publish none yet. */
export function hasAdmissionEvidence(schools: { admissionEvidence: { kind: string } }[]): boolean {
  return schools.some((school) => school.admissionEvidence.kind !== "unavailable");
}

export function pilotAdmissionCoverage(authorityCode: string): PilotCoverage {
  const pilotCodes = PILOT_ADMISSION_AUTHORITIES.map((authority) => authority.code);
  const covered = pilotCodes.includes(authorityCode);
  const pilotNames = PILOT_ADMISSION_AUTHORITIES.map((authority) => authority.name).join(", ");
  const note = covered
    ? `${authorityCode} is inside the admissions pilot (${pilotNames}).`
    : `${authorityCode} is outside the admissions pilot (${pilotNames}); treat access as unknown.`;
  return { authorityCode, covered, pilotCodes, note };
}

export function addAdmissionQuestion(questions: AdmissionQuestion[], text: string): AdmissionQuestion[] {
  const trimmed = text.trim();
  if (trimmed === "") return questions;
  return [...questions, { id: nextAdmissionQuestionId(questions), text: trimmed, url: null, answered: false }];
}

export function setAdmissionQuestionAnswered(
  questions: AdmissionQuestion[],
  id: string,
  answered: boolean,
): AdmissionQuestion[] {
  return questions.map((question) => question.id === id ? { ...question, answered } : question);
}

function conflictAssessment(
  distance: PriorityCutoff[],
  missing: string[],
  others: string[],
): AdmissionAssessment {
  return {
    claim: "unavailable",
    explanation: `Admission rules conflict across years${otherGroupsNote(others)}; ` +
      "treat eligibility as unknown until the current guidance is checked.",
    yearsObserved: new Set(distance.map((cut) => cut.academicYear)).size,
    yearsWithin: 0,
    missingYears: missing,
    conflicting: true,
    isProbability: false,
  };
}

function recentGapAssessment(
  distance: PriorityCutoff[],
  missing: string[],
  others: string[],
): AdmissionAssessment {
  return {
    claim: "unavailable",
    explanation: `Recent cutoff gap (${missing.join(", ")} not published)${otherGroupsNote(others)}; ` +
      "historical cutoffs are observations with gaps, never eligibility.",
    yearsObserved: new Set(distance.map((cut) => cut.academicYear)).size,
    yearsWithin: 0,
    missingYears: missing,
    conflicting: false,
    isProbability: false,
  };
}

function historicalAssessment(
  distance: PriorityCutoff[],
  homeDistanceMetres: number,
  missing: string[],
  others: string[],
): AdmissionAssessment {
  const years = [...new Set(distance.map((cut) => cut.academicYear))].sort();
  const yearsWithin = years.filter((year) => withinYear(distance, year, homeDistanceMetres)).length;
  const gap = missing.length > 0 ? ` Gap years not published: ${missing.join(", ")}.` : "";
  return {
    claim: "historical-only",
    explanation: `${DISTANCE_INSUFFICIENT_EXPLANATION}${otherGroupsNote(others)}${gap}`,
    yearsObserved: years.length,
    yearsWithin,
    missingYears: missing,
    conflicting: false,
    isProbability: false,
  };
}

function withinYear(distance: PriorityCutoff[], year: string, home: number): boolean {
  const published = distance
    .filter((cut) => cut.academicYear === year && cut.distanceMetres !== null)
    .map((cut) => cut.distanceMetres as number);
  return published.length > 0 && home <= Math.min(...published);
}

function otherGroupsNote(others: string[]): string {
  if (others.length === 0) return "";
  return ` Other priority groups (${others.join(", ")}) use separate cutoffs and are never merged.`;
}

function nextAdmissionQuestionId(questions: AdmissionQuestion[]): string {
  const numbers = questions
    .map((question) => Number(question.id.replace(/^q-/, "")))
    .filter((value) => Number.isInteger(value));
  return `q-${(numbers.length === 0 ? 0 : Math.max(...numbers)) + 1}`;
}
