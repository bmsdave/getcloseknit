/**
 * The school card (docs/area-card-2026-10/school-spec.md): the school-card.v1 payload served by
 * GET /api/v1/schools/{urn}/card, the server loader for /school/[urn], and the pure helpers the card
 * draws with (the standing Ofsted grade, results by year with labelled gaps, page title). Pure helpers
 * are unit tested in tests/school-card.test.ts; numbers are never made up: a missing figure stays null.
 */
import { carrierOf, type SchoolSummary, type SchoolTopBadge } from "./contracts";
import type { DataMode } from "./map-state";
import type { OfstedMark } from "./school-icons";

export type TopBadge = SchoolTopBadge;

export interface SchoolSeriesPoint {
  academicYear: string;
  value: number | string | null;
  suppressed: boolean;
  cohortSize: number | null;
  sourceRelease?: string;
}

export interface SchoolMeasure {
  id: string;
  label: string;
  unit: string | null;
  series: SchoolSeriesPoint[];
}

export interface SchoolInspection {
  inspectionNumber: string;
  inspectedUrn: string | null;
  startDate: string | null;
  publicationDate: string | null;
  inspectionType: string | null;
  framework: string | null;
  overall: number | null;
  judgements: Record<string, string | number | null>;
  reportUrl: string | null;
  keyFindings?: string | null;
  improveText?: string | null;
  sourceRelease?: string;
}

export interface SchoolDemand {
  entryYear: number;
  entryPoint: string;
  firstPreferences: number | null;
  anyPreferences: number | null;
  offers: number | null;
  firstPreferenceOffers: number | null;
  pan: number | null;
  applicationsPerPlace: number | null;
  firstPreferencesPerPlace: number | null;
  applicationsPerOffer: number | null;
  missingReason: string | null;
  /** 100 × (1 − firstPreferenceOffers ÷ firstPreferences) on national offer day; null when a count is missing. */
  firstChoiceNotOfferedPercent?: number | null;
  secondPreferences?: number | null;
  thirdPreferences?: number | null;
  /** Offers at any school the family listed. */
  preferredOffers?: number | null;
  secondPreferenceOffers?: number | null;
  thirdPreferenceOffers?: number | null;
  sourceRelease?: string;
}

/** One year's England rank (school_national_rank). */
export interface NationalRankPoint {
  academicYear: string;
  rank: number;
  total: number;
  topPercent: number;
  value: number;
  /** KS2: % at the higher standard; null for KS4. */
  tiebreakValue: number | null;
  /** The URN the figure was published under (a predecessor's, before conversion). */
  rankedUrn: string;
  sourceRelease: string;
}

/** "Ranked X of N schools (top N%)" across England; rank fields are null with missingReason when the school is
 * not ranked in the latest year. */
export interface NationalRank {
  rank: number | null;
  total: number | null;
  topPercent: number | null;
  year: string;
  measure: string;
  measureId: "ks2-rwm-expected" | "ks4-attainment8";
  value: number | null;
  tiebreakValue: number | null;
  rankedUrn: string | null;
  sourceRelease: string | null;
  line: string | null;
  missingReason: string | null;
  pool: string;
  history: NationalRankPoint[];
}

/** The combined A-level rank (school_sixth_form_rank, migration 094): one scale for state and
 * independent sixth forms, ranked on A level average points per entry (issue #201). */
export interface SixthFormRank {
  measure: string;
  measureId: "ks5-alevel-aps";
  year: string;
  value: number | null;
  cohortSize: number | null;
  regionRank: number;
  regionPool: number;
  /** The region the place is within (London for London's schools; England coverage, migration 110). */
  scope?: string;
  englandRank: number;
  englandPool: number;
  /** The required selection note: schools that select their pupils. */
  selectionNote: string;
  /** "#12 of 480 London sixth forms, state and independent, 2024/25". */
  line: string;
  sourceRelease: string | null;
}

/** A census or absence share as published for its latest year; value is null when suppressed. */
export interface ProfileFigure {
  measure: string;
  label: string;
  value: number | null;
  suppressed: boolean;
  academicYear: string;
  sourceRelease?: string;
}

export interface SchoolProfile {
  /** GIAS facts; null when not loaded. */
  gias: {
    gender: "Mixed" | "Girls" | "Boys" | null;
    trust: { name: string; code: string | null } | null;
    capacity: number | null;
    pupils: number | null;
    censusDate: string | null;
    /** 100 × pupils ÷ capacity from the same GIAS row. */
    percentFull: number | null;
    /** GIAS LA code / establishment number, "201/3614" (migration 099; absent in older payloads). */
    laestab?: string | null;
    sourceRelease: string;
  } | null;
  girlsPercent: ProfileFigure | null;
  boysPercent: ProfileFigure | null;
  /** Eligible for free school meals at any time in the past 6 years. */
  fsm6Percent: ProfileFigure | null;
  /** First language not English. */
  ealPercent: ProfileFigure | null;
  senSupportPercent: ProfileFigure | null;
  ehcpPercent: ProfileFigure | null;
  overallAbsencePercent: ProfileFigure | null;
  persistentAbsencePercent: ProfileFigure | null;
  /** DfE's ratio from the school workforce census; null when not published. */
  pupilsPerTeacher: { value: number; academicYear: string; sourceRelease: string } | null;
  /**
   * GIAS gender as a label: "Girls · mixed sixth form" (or Boys …) when a single-sex school with a sixth form
   * counts the other sex in the census, which covers Years 12–13 too; null without GIAS.
   */
  intake?: { label: string; mixedSixthForm: boolean } | null;
}

/** The school's intake tag: the API's label, else GIAS gender as published. */
export function intakeLabel(profile: SchoolProfile | null | undefined, fallback: string | null): string | null {
  return profile?.intake?.label ?? profile?.gias?.gender ?? fallback;
}

const SIXTH_FORM_TAG: Record<string, string> = { "Has a sixth form": "Sixth form", "Does not have a sixth form": "No sixth form" };

/**
 * The card header's type tags, one wrapped line. "Girls · mixed sixth form" already says the school has a
 * sixth form, so it stands for the Sixth form tag, as in the map popup.
 */
export function schoolHeaderTags(card: SchoolCard): string[] {
  const { school, details } = card;
  return [
    school.type,
    `ages ${school.ageRange.from}–${school.ageRange.to}`,
    intakeLabel(card.profile, /^(Mixed|Girls|Boys)$/.test(school.gender) ? school.gender : null),
    school.faith,
    school.selectivity === "Selective" ? "Selective" : null,
    details.localAuthority,
    details.postcode,
    school.phase === "secondary" && details.sixthForm && !card.profile?.intake?.mixedSixthForm
      ? SIXTH_FORM_TAG[details.sixthForm] ?? details.sixthForm : null,
  ].filter((tag): tag is string => Boolean(tag));
}

/** Strengths / weaknesses counted from the latest graded inspection's grades; never scored from the text. */
export interface InspectionCounts {
  framework: "report-card" | "legacy";
  graded: number;
  strengths: number;
  weaknesses: number;
  strengthAreas: string[];
  weaknessAreas: string[];
  safeguarding: string | null;
  /** Points in the report's "to improve" text; null when the text is not held. */
  improvePoints: number | null;
  inspectionDate: string | null;
  publicationDate: string | null;
  reportUrl: string | null;
  inspectedUrn: string | null;
  inspectedAsPredecessor: boolean;
  definition: string;
  sourceRelease?: string;
}

export interface LastOfferedRule {
  rule: string;
  criterion: string | null;
  distanceMetres: number | null;
  rawValue: string | null;
  allOffered: boolean | null;
}

export interface LastOffered {
  academicYear: string;
  entryPoint: string;
  site: string;
  council: string;
  licence: string;
  /** "Source: Lambeth Council, 2026/27" (+ the OGL statement for OGL councils). */
  attribution: string;
  sourceUrl: string;
  reuseConfirmed: boolean;
  measurementMethod: string | null;
  distanceMetres: number | null;
  allOffered: boolean | null;
  rules: LastOfferedRule[];
}

export interface SchoolKpi {
  measure: string;
  label: string;
  valueText: string;
  value: number | string | null;
  cohortSize: number | null;
  percentile: number | null;
  score10: number | null;
  trend: { direction: "up" | "down" | "flat"; deltaPoints: number; fromYear: string } | null;
  year: string | null;
  basis: string;
  regionMedian: number | null;
  /** The region the percentile and median are within ("London", "North West"). */
  scope?: string;
  missingReason: string | null;
  note: string | null;
}

export interface SchoolTldr {
  strengths: string[];
  improve: string[];
  inspectionDate: string | null;
  publicationDate: string | null;
  reportUrl: string | null;
  label: string;
  inspectedAsPredecessor: boolean;
  inspectedUrn: string | null;
  attribution: string;
}

/** Ofsted Parent View management information (OGL): null until it is loaded. Never stars. */
/** One Parent View question: every option's % as Ofsted published it. */
export interface ParentViewQuestion {
  id: string;
  question: string;
  answers: Record<string, number>;
  /** agree = strongly agree + agree (of the parents it applies to); yes = Yes; positive = Positive. */
  headline: "agree" | "yes" | "positive";
  headlinePercent: number | null;
  /** The answer for parents it does not apply to ("Not applicable"), as published; left out of headlinePercent. */
  notApplicable?: { option: string; percent: number } | null;
}

/** A follow-up ("Q4b") is asked only of the parents who said Yes to its lead question ("Q4a"): that Yes share, as
 * Ofsted published it, or null for any other question. */
export function followUpShare(question: ParentViewQuestion, questions: readonly ParentViewQuestion[]): number | null {
  const lead = /^Q(\d+)b$/.exec(question.id);
  return (lead ? questions.find((other) => other.id === `Q${lead[1]}a`)?.answers.Yes : undefined) ?? null;
}

/** Ofsted Parent View (schools with 10+ submissions): the newest survey the school has, current (since
 * 10 Nov 2025) or earlier (the questions before it), never both; never stars. */
export interface ParentView {
  /** Absent in preview fixtures from before migration 059. */
  surveyEra?: "current" | "earlier";
  /** "Earlier survey (before Nov 2025)" or "Current survey (since 10 Nov 2025)". */
  surveyLabel?: string;
  responses: number;
  /** Q1 text; agreePercent is its strongly agree + agree share. */
  question: string;
  agreePercent: number;
  period: string;
  sourceUrl: string;
  responseRate?: number | null;
  /** Q1 "My child is happy at this school": strongly agree + agree. */
  happyPercent?: number | null;
  /** The recommend question (Q10 current, Q14 earlier): Yes. */
  recommendPercent?: number | null;
  periodStart?: string;
  asAt?: string;
  survey?: "2025-11" | "pre-2025-11";
  line?: string | null;
  definition?: string;
  questions?: ParentViewQuestion[];
  sourceRelease?: string;
}

/** One figure against London (same phase and year) and its borough (10+ schools only). */
export interface CompareMeasure {
  label: string;
  unit: "count" | "percent" | "ratio" | "pounds";
  value: number;
  year: string;
  london: { p10: number; median: number; p90: number; n: number };
  borough: { name: string; median: number; n: number } | null;
  /** The region `london` describes ("London" for London's schools). */
  scope?: string;
  /** Colour only when a direction is clearly better (absence: lower). */
  betterWhen: "lower" | "higher" | null;
  /** Finance only: compared within the same accounts. */
  accounts?: "CFR" | "AAR";
  accountsNote?: string;
  sourceRelease: string;
}

export type CompareKey =
  | "pupils" | "fsm6Percent" | "ealPercent" | "senSupportPercent" | "ehcpPercent" | "overallAbsencePercent"
  | "persistentAbsencePercent" | "pupilsPerTeacher" | "pupilsPerAdult" | "incomePerPupil" | "spendPerPupil"
  | "staffSpendPerPupil" | "reservePerPupil" | "firstChoiceOfferedPercent";

export interface SchoolCompare {
  phase: "primary" | "secondary";
  pool: string;
  method: string;
  minBoroughSchools: number;
  /** null when the school has no published figure for the measure. */
  measures: Partial<Record<CompareKey, CompareMeasure | null>>;
}

/** School workforce census, as DfE printed it (FTE = full-time equivalent). */
export interface SchoolWorkforce {
  academicYear: string;
  teachersFte: number | null;
  teachingAssistantsFte: number | null;
  /** Teachers in leadership posts: head, deputy and assistant heads. */
  leadershipFte: number | null;
  supportStaffFte: number | null;
  workforceFte: number | null;
  workforceHeadcount: number | null;
  teachersHeadcount: number | null;
  pupilsFte: number | null;
  pupilsPerTeacher: number | null;
  /** DfE: per FTE teacher, teaching assistant, other school support staff and technician (not admin, auxiliary or business staff). */
  pupilsPerAdult: number | null;
  definitions: Record<string, string>;
  sourceRelease: string;
}

/** One CFR (maintained) or AAR (academy) return; the two are never compared. Money in pounds. */
export interface SchoolFinance {
  accounts: "CFR" | "AAR";
  accountsLabel: string;
  period: string;
  periodLabel: string;
  periodMonths: number | null;
  /** Under 12 months: per-pupil income and spend are null. */
  partialYear: boolean;
  pupilsFte: number | null;
  revenueReserve: number | null;
  revenueReservePerPupil: number | null;
  inDeficit: boolean | null;
  inYearBalance: number | null;
  totalIncome: number | null;
  totalExpenditure: number | null;
  incomePerPupil: { grants: number | null; selfGenerated: number | null; total: number | null };
  spendPerPupil: { staff: number | null; premises: number | null; total: number | null };
  missingReason: string | null;
  trust: {
    kind: "MAT" | "SAT";
    name: string | null;
    companyNumber: string | null;
    academies: number | null;
    /** MAT: central services + every academy's reserve. */
    revenueReserve: number | null;
    note: string | null;
  } | null;
  federation: { leadUrn: string; isLead: boolean; note: string } | null;
  perPupilDefinition: string;
  notComparable: string;
  sourceRelease: string;
}

/** DfE destination measures for one stage, all students; null percentages are suppressed. */
export interface SchoolDestination {
  cohortYear: string;
  destinationYear: string;
  cohort: number | null;
  version: "Provisional" | "Revised" | null;
  reportedUrn: string;
  sustainedPercent: number | null;
  educationPercent: number | null;
  /** 16-18 only. */
  higherEducationPercent: number | null;
  apprenticeshipPercent: number | null;
  employmentPercent: number | null;
  notSustainedPercent: number | null;
  unknownPercent: number | null;
  sourceRelease: string;
}

export interface SchoolCardSource {
  id: string;
  licence: string | null;
  attribution: string | null;
  caveats: string[];
}

/** One Visit & links destination: a counted /go click-out; href null when its flag is off (no tile). */
export interface SchoolLink { href: string | null; portal: string }

/** The card's `links` (migration 099, api/area_api/school_links.py): every key present. */
export interface SchoolLinks {
  website: (SchoolLink & { host: string }) | null;
  admissions: SchoolLink & { via: "website" | "council" };
  phone: { href: string; number: string } | null;
  ofstedReport: SchoolLink;
  dfePerformance: SchoolLink;
  parentView: SchoolLink;
  councilAdmissions: SchoolLink & { council: string | null; phase: "primary" | "secondary" };
  gias: SchoolLink;
  eAdmissions: SchoolLink;
  goodSchoolsGuide: SchoolLink;
  locrating: SchoolLink;
}

/** A tile in Visit & links: its title, the one line under it and where it goes. */
export interface LinkTile { key: string; title: string; sub: string; href: string; portal: string }

/**
 * Visit & links in the board's fixed order (official first, guides last). A link without an href (flag off) or
 * without data drops its tile; the website becomes a muted line and Admissions points to the council instead.
 */
export function linkTiles(links: SchoolLinks, standing: OfstedStanding | null = null): { official: LinkTile[]; guides: LinkTile[] } {
  const tile = (key: keyof SchoolLinks, link: SchoolLink | null, title: string, sub: string): LinkTile[] =>
    link?.href ? [{ key, title, sub, href: link.href, portal: link.portal }] : [];
  const year = standing?.date ? standing.date.slice(0, 4) : null;
  const grade = standing?.kind === "legacy" ? `${standing.grade}${year ? `, ${year}` : ""}` : year ? `inspected ${year}` : null;
  const council = links.councilAdmissions;
  return {
    official: [
      ...tile("ofstedReport", links.ofstedReport, "Ofsted report", `reports.ofsted.gov.uk${grade ? ` · ${grade}` : ""}`),
      ...tile("dfePerformance", links.dfePerformance, "DfE performance tables", "compare-school-performance.service.gov.uk"),
      ...tile("parentView", links.parentView, "Parent View", "Ofsted · search for this school"),
      ...tile("councilAdmissions", council, "Council admissions",
        council.council ? `${council.council} ${council.phase} places · GOV.UK` : `Find your council · GOV.UK`),
      ...tile("gias", links.gias, "School record", "Get Information about Schools · DfE"),
      ...tile("eAdmissions", links.eAdmissions, "Apply online", "eAdmissions · all 33 London councils"),
    ],
    guides: [
      ...tile("goodSchoolsGuide", links.goodSchoolsGuide, "Good Schools Guide", "Search by name · full review is paid"),
      ...tile("locrating", links.locrating, "Locrating", "Catchment map and reviews"),
    ],
  };
}

export interface SchoolCard {
  schemaVersion: "school-card.v1";
  productReleaseId: string;
  urn: string;
  areaId: string | null;
  school: SchoolSummary;
  details: {
    localAuthority: string | null;
    postcode: string | null;
    sixthForm: string | null;
    pupils: number | null;
    predecessorUrn: string | null;
    successorUrn: string | null;
  };
  history: {
    schemaVersion: "school-history.v1";
    urn: string;
    measures: SchoolMeasure[];
    inspections: SchoolInspection[];
    demand: unknown[];
    distances: unknown[];
    sources: SchoolCardSource[];
  };
  percentiles: Record<string, { academicYear: string; percentile: number }[]>;
  regionMedian: Record<string, { academicYear: string; value: number; poolSize: number }[]>;
  pool: { description: string; minCohort: number };
  /** The school's region: every "London" figure on the card is this region's (absent before England coverage). */
  rankScope?: { code: string; name: string } | null;
  kpis: SchoolKpi[];
  topBadge: TopBadge;
  tldr: SchoolTldr | null;
  parentView: ParentView | null;
  /** Absent in preview fixtures; null when the API has no comparison pool. */
  compare?: SchoolCompare | null;
  admissions: {
    demand: SchoolDemand[];
    lastOffered: LastOffered[];
    /** Every entry year and entry point, newest first (absent in preview fixtures). */
    byYear?: SchoolDemand[];
    oversubscriptionDefinition?: string;
  };
  /** Absent in preview fixtures; null from the API when no England rank is loaded. */
  nationalRank?: NationalRank | null;
  /** The combined A-level rank (issue #201); null when the school has no ranked sixth form. */
  combinedSixthFormRank?: SixthFormRank | null;
  profile?: SchoolProfile;
  inspectionCounts?: InspectionCounts | null;
  /** Migration 056; absent in preview fixtures, null when not published (missing[] says why). */
  workforce?: SchoolWorkforce | null;
  finance?: SchoolFinance | null;
  /** Secondaries only: ks4 / post16; null for primaries. */
  destinations?: { ks4: SchoolDestination | null; post16: SchoolDestination | null; definition: string } | null;
  /** Visit & links (migration 099); absent from an older API. */
  links?: SchoolLinks;
  missing: { measure: string; reason: string }[];
  sources: SchoolCardSource[];
}

export const URN_PATTERN = /^[0-9]{6}$/;

/** ?school=<urn> on the map: that school's card is open in the side panel (close-knit.tsx). */
export const SCHOOL_PARAM = "school";

/** The school open in the map's panel by the address, or null. */
export function schoolParam(search: string): string | null {
  const urn = new URLSearchParams(search).get(SCHOOL_PARAM);
  return urn && URN_PATTERN.test(urn) ? urn : null;
}

/** The URN of a link to a school's page on this site (/school/<urn>, any ?from=), or null for any other link. */
export function schoolUrnFromHref(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    const urn = url.origin === origin ? /^\/school\/([^/]+)\/?$/.exec(url.pathname)?.[1] : null;
    return urn && URN_PATTERN.test(urn) ? urn : null;
  } catch {
    return null;
  }
}

/** Results charts start here: the first year of the current KS2 tests and of Attainment 8 for all. */
export const FIRST_RESULTS_YEAR = "2015/16";
/** No exams were sat (or no school results published) in these years. */
export const NO_EXAM_YEARS = new Set(["2019/20", "2020/21"]);

export const HEADLINE_MEASURES: Record<SchoolSummary["phase"], readonly string[]> = {
  primary: ["ks2-rwm-expected", "ks2-rwm-higher", "ks2-reading-score", "ks2-maths-score"],
  secondary: ["ks4-attainment8", "ks4-em-grade5", "ks5-alevel-aps"],
};

// ---- Loading -----------------------------------------------------------------------------------------

export interface LoadedSchoolCard {
  mode: DataMode;
  card: SchoolCard | null;
  /** HTTP status from the API (0 in demo mode). */
  status: number;
}

/** /school/[urn]: the demo fixture without an API, the evidence API otherwise (never both). */
export async function loadSchoolCard(urn: string): Promise<LoadedSchoolCard> {
  const { fetchApi, serverDefaults } = await import("./deployment");
  const defaults = await serverDefaults();
  const mode: DataMode = defaults.mode ?? "demo";
  if (mode === "demo") {
    const { demoSchoolCard } = await import("./school-card-fixture");
    return { mode, card: demoSchoolCard(urn), status: 0 };
  }
  const upstream = await retryOnce(() => fetchApi<SchoolCard>(`/api/v1/schools/${encodeURIComponent(urn)}/card`,
    SCHOOL_CARD_TIMEOUT_MS));
  const card = upstream.body?.schemaVersion === "school-card.v1" ? upstream.body : null;
  return { mode, card, status: upstream.status };
}

/**
 * A card answers in ~0.1 s once the API has built its region's pools (at start, then per release); a region
 * still cold takes ~2 s. The 2.5 s default cut such reads off and showed "This school didn't load".
 */
export const SCHOOL_CARD_TIMEOUT_MS = 6000;

/** A failed or timed-out read (5xx; fetchApi's 503) is tried once more before the page gives up; a 429 is not. */
export async function retryOnce<T extends { status: number }>(read: () => Promise<T>): Promise<T> {
  const first = await read();
  return first.status >= 500 ? read() : first;
}

/** The area a card was opened from (?from=): its name and centre [lon, lat], from the area's own geometry. */
export interface AreaCentre { geographyId: string; name: string; center: [number, number] }

type SearchHit = { geographyId: string; label: string; friendlyName?: string | null; uprn?: string | null; addressId?: string | null; center?: [number, number] };

/** Demo: the preview polygon's centroid. Real: the area search row for that id (PostGIS ST_Centroid). */
export async function loadAreaCentre(areaId: string, mode: DataMode): Promise<AreaCentre | null> {
  if (mode === "demo") {
    const { areaGeoJson } = await import("./fixtures");
    const carrier = carrierOf(areaId.split(":")[1] ?? "");
    if (carrier !== "lsoa" && carrier !== "msoa" && carrier !== "lad") return null;
    const feature = areaGeoJson(carrier).features.find((entry) => entry.properties.geography_id === areaId);
    const center = feature ? polygonCentre(feature.geometry) : null;
    return feature && center ? { geographyId: areaId, name: feature.properties.name, center } : null;
  }
  const { fetchApi } = await import("./deployment");
  const { body } = await fetchApi<{ results?: SearchHit[] }>(`/api/v1/search?q=${encodeURIComponent(areaId)}&limit=1`);
  const hit = body?.results?.find((row) => row.geographyId === areaId && !row.uprn && !row.addressId);
  const center = hit?.center;
  return hit && Array.isArray(center) && center.length === 2 && center.every(Number.isFinite)
    ? { geographyId: areaId, name: hit.friendlyName || hit.label, center } : null;
}

// ---- Pure helpers --------------------------------------------------------------------------------------

type Ring = readonly (readonly number[])[];

/** Area-weighted centroid [lon, lat] of a polygon's outer ring (the largest part of a multipolygon). */
export function polygonCentre(geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] }): [number, number] | null {
  const rings = geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((part) => part[0]);
  let best: { area: number; x: number; y: number } | null = null;
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    let area = 0, x = 0, y = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      area += cross; x += (x0 + x1) * cross; y += (y0 + y1) * cross;
    }
    if (area === 0) continue;
    const entry = { area: Math.abs(area / 2), x: x / (3 * area), y: y / (3 * area) };
    if (!best || entry.area > best.area) best = entry;
  }
  return best ? [best.x, best.y] : null;
}

/** Straight-line (great-circle) distance in km between two [lon, lat] points. */
export function straightLineKm([lon1, lat1]: readonly [number, number], [lon2, lat2]: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** "2015/16" → 2015. */
const startYear = (academicYear: string) => Number(academicYear.slice(0, 4));
const academicYear = (start: number) => `${start}/${String((start + 1) % 100).padStart(2, "0")}`;

/** Every academic year from `from` to `to`, inclusive: ["2015/16", …, "2024/25"]. */
export function academicYears(from: string, to: string): string[] {
  const out: string[] = [];
  for (let year = startYear(from); year <= startYear(to); year += 1) out.push(academicYear(year));
  return out;
}

export type ResultsSlot = {
  year: string;
  value: number | null;
  cohortSize: number | null;
  suppressed: boolean;
  median: number | null;
  /** Why there is no value: no exams sat that year, or none published for this school. */
  gap: "no-exams" | "not-published" | null;
};

/**
 * One slot per academic year from FIRST_RESULTS_YEAR (or the measure's first year, if later) to the
 * latest year with a figure or a London median; a year without a figure says why. Suppressed figures
 * keep their slot (hollow dot), never a value.
 */
export function resultsSlots(measure: SchoolMeasure, medians: { academicYear: string; value: number }[] = []): ResultsSlot[] {
  const years = [...measure.series.map((point) => point.academicYear), ...medians.map((median) => median.academicYear)]
    .filter((year) => /^\d{4}\/\d{2}$/.test(year)).sort();
  if (years.length === 0) return [];
  const first = [FIRST_RESULTS_YEAR, measure.series[0]?.academicYear ?? FIRST_RESULTS_YEAR].sort().at(-1)!;
  const last = years.at(-1)!;
  if (first > last) return [];
  const byYear = new Map(measure.series.map((point) => [point.academicYear, point]));
  const medianByYear = new Map(medians.map((median) => [median.academicYear, median.value]));
  return academicYears(first, last).map((year) => {
    const point = byYear.get(year);
    const value = point && !point.suppressed && typeof point.value === "number" ? point.value : null;
    const gap = value !== null || point?.suppressed ? null : NO_EXAM_YEARS.has(year) ? "no-exams" : "not-published";
    return {
      year, value, cohortSize: point?.cohortSize ?? null, suppressed: Boolean(point?.suppressed),
      median: medianByYear.get(year) ?? null, gap,
    };
  });
}

/** "87%", "53.1", "+0.62": the API's units, one style everywhere. */
export function formatMeasure(value: number, unit: string | null, places = 2): string {
  if (unit === "percent") return `${Number(value.toFixed(1))}%`;
  if (unit === "progress") return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
  return `${Number(value.toFixed(places))}`;
}

/** Decimal places a published figure is shown with ("87.3" → 1, "38.45" → 2), at least 1: a median beside it matches it. */
export function shownPlaces(text: string): number {
  return Math.max(1, /\.(\d+)/.exec(text)?.[1].length ?? 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-01-18" → "18 Jan 2024"; anything else stays as it is. */
export function formatDay(date: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!match) return date ?? "";
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** "Jan 2024". */
export function formatMonthYear(date: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})/.exec(date ?? "");
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "";
}

/** "0.6 km": a straight-line distance in kilometres, one decimal. */
export function formatKm(km: number): string {
  return km < 0.05 ? "under 0.1 km" : `${km.toFixed(1)} km`;
}

/** "450 m" under a kilometre, "1.4 km" above. */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres).toLocaleString("en-GB")} m` : `${(metres / 1000).toFixed(1)} km`;
}

export const LEGACY_GRADES: Record<number, string> = { 1: "Outstanding", 2: "Good", 3: "Requires improvement", 4: "Inadequate" };

/** Ofsted renamed grade 3 from "Satisfactory" to "Requires improvement" in September 2012. */
export function legacyGradeLabel(grade: number, date: string | null | undefined): string {
  return grade === 3 && date && date < "2012-09-01" ? "Satisfactory" : LEGACY_GRADES[grade];
}
const REPORT_CARD_GRADES = ["Exceptional", "Strong standard", "Expected standard", "Needs attention", "Urgent improvement"];

export type GradeTone = "good" | "neutral" | "bad";

export type OfstedArea = { name: string; grade: string; tone: GradeTone };

/** The grade that stands today: one framework only, never mixed. */
export type OfstedStanding =
  | { kind: "legacy"; grade: string; overall: number; tone: GradeTone; date: string | null; reportUrl: string | null }
  | {
    kind: "areas";
    /** report-card: the 5-point report card (since Nov 2025); eif-2024: graded areas, no overall grade (Sep 2024–Nov 2025). */
    framework: "report-card" | "eif-2024";
    areas: OfstedArea[];
    safeguarding: "Met" | "Not met" | "Effective" | "Not effective" | null;
    date: string | null;
    reportUrl: string | null;
  };

const isSafeguarding = (name: string) => /safeguarding/i.test(name);
const areaName = (name: string) => {
  const short = name.replace(/\s*\(where applicable\)\s*/i, "").replace(/^Effectiveness of /, "").trim();
  return short ? `${short[0].toUpperCase()}${short.slice(1)}` : short;
};

/** Legacy 1–4 per area: 1–2 good, 3–4 bad. Report card: Exceptional/Strong good, Expected neutral, below bad. */
function legacyTone(grade: number): GradeTone { return grade <= 2 ? "good" : "bad"; }
function reportCardTone(grade: string): GradeTone {
  const rank = REPORT_CARD_GRADES.indexOf(grade);
  return rank < 0 ? "neutral" : rank <= 1 ? "good" : rank === 2 ? "neutral" : "bad";
}
export function legacyGradeTone(overall: number): GradeTone { return legacyTone(overall); }

/**
 * The standing Ofsted grade, newest inspection first (as the API's inspection gate reads it): a report
 * card, a legacy overall grade, or (September 2024 to November 2025) area grades with no overall
 * grade. Ungraded visits (section 8, monitoring) leave the previous grade standing.
 */
export function ofstedStanding(inspections: readonly SchoolInspection[]): OfstedStanding | null {
  for (const inspection of inspections) {
    const framework = inspection.framework ?? "";
    const entries = Object.entries(inspection.judgements ?? {});
    // One Ofsted date everywhere: the day the inspection started (chip, title, timeline, Ofsted's words).
    const date = inspection.startDate ?? inspection.publicationDate;
    if (framework.startsWith("report-card")) {
      const areas = entries.filter(([name, grade]) => !isSafeguarding(name) && typeof grade === "string" && REPORT_CARD_GRADES.includes(grade))
        .map(([name, grade]) => ({ name: areaName(name), grade: String(grade).replace(/ standard$/, ""), tone: reportCardTone(String(grade)) }));
      const safe = entries.find(([name]) => isSafeguarding(name))?.[1];
      return { kind: "areas", framework: "report-card", areas, safeguarding: safe === "Met" ? "Met" : safe === "Not met" ? "Not met" : null, date, reportUrl: inspection.reportUrl };
    }
    if (inspection.overall !== null && LEGACY_GRADES[inspection.overall]) {
      return { kind: "legacy", grade: legacyGradeLabel(inspection.overall, date), overall: inspection.overall, tone: legacyTone(inspection.overall), date, reportUrl: inspection.reportUrl };
    }
    const graded = entries.filter(([name, grade]) => !isSafeguarding(name) && typeof grade === "number" && LEGACY_GRADES[grade]);
    if (framework === "eif-2024-no-overall" && graded.length > 0) {
      const safe = entries.find(([name]) => isSafeguarding(name))?.[1];
      return {
        kind: "areas", framework: "eif-2024", date, reportUrl: inspection.reportUrl,
        areas: graded.map(([name, grade]) => ({ name: areaName(name), grade: LEGACY_GRADES[grade as number], tone: legacyTone(grade as number) })),
        safeguarding: safe === "Yes" ? "Effective" : safe === "No" ? "Not effective" : null,
      };
    }
  }
  return null;
}

/** The weakest graded area of a report card or 2024–25 inspection (grades in Ofsted's own order, best first). */
export function lowestArea(standing: Extract<OfstedStanding, { kind: "areas" }>): OfstedArea | null {
  const order = standing.framework === "report-card"
    ? REPORT_CARD_GRADES.map((grade) => grade.replace(/ standard$/, ""))
    : Object.values(LEGACY_GRADES);
  const ranked = standing.areas.filter((area) => order.includes(area.grade));
  return ranked.reduce<OfstedArea | null>((worst, area) => (!worst || order.indexOf(area.grade) > order.indexOf(worst.grade) ? area : worst), null);
}

/**
 * A missing-data reason as one short line, the full wording kept for the section's disclosure:
 * "Ofsted Parent View: not published for this school (Ofsted lists only …)" → "Not published for this school".
 */
export function missingLine(reason: string): { line: string; detail: string | null } {
  const core = reason.replace(/^[^:()]+:\s*/, "").replace(/\s*\([^()]*\)\s*$/, "").trim();
  if (!core || core === reason) return { line: reason, detail: null };
  return { line: core[0].toUpperCase() + core.slice(1), detail: reason };
}

/**
 * One dot per inspection for the timeline. A graded inspection takes its grade's tone; with area grades
 * and no overall grade (report card, 2024–25), the lowest area's. Ungraded visits stay "none" (no grade).
 */
export function inspectionDot(inspection: SchoolInspection): { label: string; tone: GradeTone | "none" } {
  if (inspection.overall !== null && LEGACY_GRADES[inspection.overall]) {
    return { label: legacyGradeLabel(inspection.overall, inspection.startDate ?? inspection.publicationDate), tone: legacyTone(inspection.overall) };
  }
  const entries = Object.entries(inspection.judgements ?? {}).filter(([name]) => !isSafeguarding(name));
  if ((inspection.framework ?? "").startsWith("report-card")) {
    const ranks = entries.map(([, grade]) => REPORT_CARD_GRADES.indexOf(String(grade))).filter((rank) => rank >= 0);
    if (ranks.length === 0) return { label: "Report card", tone: "neutral" };
    const lowest = REPORT_CARD_GRADES[Math.max(...ranks)];
    return { label: `Report card, lowest ${lowest.replace(/ standard$/, "")}`, tone: reportCardTone(lowest) };
  }
  const outcome = entries.find(([name]) => /^outcomes? for/i.test(name))?.[1];
  if (typeof outcome === "string" && outcome.trim()) return { label: shortOutcome(outcome), tone: "none" };
  if (inspection.framework === "eif-2024-no-overall") {
    const grades = entries.map(([, grade]) => grade).filter((grade): grade is number => typeof grade === "number" && Boolean(LEGACY_GRADES[grade]));
    if (grades.length === 0) return { label: "Areas graded", tone: "none" };
    const lowest = Math.max(...grades);
    const label = grades.every((grade) => grade === lowest) ? `All areas ${LEGACY_GRADES[lowest]}` : `Areas graded, lowest ${LEGACY_GRADES[lowest]}`;
    return { label, tone: legacyTone(lowest) };
  }
  return { label: "Ungraded visit", tone: "none" };
}

const LEGACY_MARK: Record<number, OfstedMark> = { 1: "outstanding", 2: "good", 3: "requires-improvement", 4: "inadequate" };

/**
 * The map cap's Ofsted colour for an inspection: a legacy overall grade, or a report card;
 * null for area grades without an overall grade and ungraded visits (their dot keeps its tone).
 */
export function inspectionMark(inspection: Pick<SchoolInspection, "overall" | "framework">): OfstedMark | null {
  if (inspection.overall !== null && LEGACY_MARK[inspection.overall]) return LEGACY_MARK[inspection.overall];
  return (inspection.framework ?? "").startsWith("report-card") ? "report-card" : null;
}

/** The standing grade as the map's cap shows it: the legacy grade, a report card, or none (2024–25 areas). */
export function standingMark(standing: OfstedStanding | null): OfstedMark | null {
  if (!standing) return null;
  if (standing.kind === "legacy") return LEGACY_MARK[standing.overall] ?? null;
  return standing.framework === "report-card" ? "report-card" : null;
}

/** "School remains Good (Improving) - S5 Next" → "Remains Good"; "Yes - improving (good)" → "Ungraded visit". */
function shortOutcome(outcome: string): string {
  const remains = /remains\s+([A-Za-z ]+?)(\s*\(|\s*-|$)/i.exec(outcome);
  return remains ? `Remains ${remains[1].trim()}` : "Ungraded visit";
}

/** A school has evidence (indexable page, sitemap entry) with any result or inspection. */
export function hasEvidence(card: Pick<SchoolCard, "history">): boolean {
  return card.history.inspections.length > 0
    || card.history.measures.some((measure) => measure.id !== "pupils" && measure.series.some((point) => point.value !== null || point.suppressed));
}

/** KS2 for primaries, GCSE for secondaries: the results the title names. */
export const RESULTS_NAME: Record<SchoolSummary["phase"], string> = { primary: "KS2", secondary: "GCSE" };

/** "Montpelier Primary School – Ofsted Good (2023) · KS2 results 2024/25" (the layout adds the site name): only what is known. */
export function schoolTitle(card: SchoolCard): string {
  const standing = ofstedStanding(card.history.inspections);
  const year = (date: string | null) => (date ?? "").slice(0, 4);
  const ofsted = !standing ? null
    : standing.kind === "legacy" ? `Ofsted ${standing.grade} (${year(standing.date)})`
      : standing.framework === "report-card" ? `Ofsted report card (${year(standing.date)})`
        : `Ofsted inspected ${year(standing.date)}`;
  const headline = HEADLINE_MEASURES[card.school.phase][0];
  const latest = card.history.measures.find((measure) => measure.id === headline)?.series
    .filter((point) => typeof point.value === "number").at(-1)?.academicYear;
  const results = latest ? `${RESULTS_NAME[card.school.phase]} results ${latest}` : null;
  const facts = [ofsted, results].filter(Boolean).join(" · ");
  // The layout's template adds " · Close Knit", as on every other page.
  return `${card.school.name}${facts ? ` – ${facts}` : ""}`;
}

/** The page's description: the facts a search result can show, no adjectives. */
export function schoolDescription(card: SchoolCard): string {
  const parts = [
    `${card.school.phase === "primary" ? "Primary" : "Secondary"} school in ${card.details.localAuthority ?? "London"}${card.details.postcode ? ` (${card.details.postcode})` : ""}`,
    card.topBadge.isTop && card.topBadge.line ? card.topBadge.line : null,
    ...card.kpis.filter((kpi) => kpi.percentile !== null).slice(0, 2).map((kpi) => `${kpi.label} ${kpi.valueText} (${kpi.year})`),
  ];
  return `${parts.filter(Boolean).join(". ")}. Ofsted, exam results by year against London, and last distance offered.`;
}

/** The schema.org type for the JSON-LD: no aggregateRating, ever. */
export function schoolSchemaType(phase: SchoolSummary["phase"] | string): "ElementarySchool" | "HighSchool" | "School" {
  return phase === "primary" ? "ElementarySchool" : phase === "secondary" ? "HighSchool" : "School";
}

/** "/school/101912", with ?from= when an area list opened it. */
export function schoolPath(urn: string, from?: string | null): string {
  return `/school/${encodeURIComponent(urn)}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
}

/** The latest figure of a series (pupils on roll, sixth-form students). */
export function latestPoint(measures: readonly SchoolMeasure[], id: string): SchoolSeriesPoint | null {
  return measures.find((measure) => measure.id === id)?.series.filter((point) => typeof point.value === "number").at(-1) ?? null;
}

/** Last distance offered for one entry point and site, one row per year, newest first. */
export type OfferedGroup = { key: string; council: string; entryPoint: string; site: string; rows: LastOffered[] };

export function offeredGroups(lastOffered: readonly LastOffered[]): OfferedGroup[] {
  const groups = new Map<string, OfferedGroup>();
  for (const row of lastOffered) {
    const key = `${row.council}|${row.entryPoint}|${row.site}`;
    const group = groups.get(key) ?? { key, council: row.council, entryPoint: row.entryPoint, site: row.site, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.rows.sort((a, b) => b.academicYear.localeCompare(a.academicYear));
  return [...groups.values()];
}

export const ENTRY_POINT_LABEL: Record<string, string> = {
  nursery: "Nursery", reception: "Reception", year3: "Year 3", year7: "Year 7", year12: "Year 12",
};

export function entryPointLabel(entryPoint: string): string {
  return ENTRY_POINT_LABEL[entryPoint] ?? entryPoint.replace(/^year(\d+)$/i, "Year $1");
}

// ---- The overview rows (one per section, a value chip on the right) ------------------------------------------

/** "£360,337", "−£202,000": whole pounds as published. */
export function formatPounds(value: number): string {
  return `${value < 0 ? "−" : ""}£${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
}

/** "21.6", "4": full-time equivalents as DfE printed them (at most two decimals), or rounded for reading (decimals = 1). */
export function formatFte(value: number, decimals = 2): string {
  return `${Number(value.toFixed(decimals))}`;
}

/** "£181k", "£7.2k", "£1.2m", "£556" (chips); signed "+£181k" / "−£120k" when `signed`. Full figures stay in the body. */
export function formatPoundsShort(value: number, signed = false): string {
  const size = Math.abs(value);
  const text = size >= 999_500 ? `${Number((size / 1_000_000).toFixed(1))}m`
    : size >= 9_950 ? `${Math.round(size / 1000)}k`
      : size >= 1000 ? `${Number((size / 1000).toFixed(1))}k` : `${Math.round(size)}`;
  return `${value < 0 ? "−" : signed && value > 0 ? "+" : ""}£${text}`;
}

/** "Ark Acton Academy" → "Ark Acton": a secondary's name for a chip, without the generic last word(s). */
export function shortSchoolName(name: string): string {
  const short = name.replace(/\s+(Church of England\s+)?(High School|Secondary School|Community School|School|Academy|College)(\s+for (Girls|Boys))?$/i, "").trim();
  return short || name;
}

/** The last distance offered in one year, or why there is none. */
export function offeredText(row: LastOffered): string {
  if (row.distanceMetres !== null) return formatDistance(row.distanceMetres);
  if (row.allOffered) return "All offered";
  return row.rules.length > 1 ? "Varies by rule" : "Not published";
}

export type OversubscriptionGroup = { entryPoint: string; rows: SchoolDemand[] };

/**
 * First choices not offered on national offer day, by year, one group per entry point still taking
 * pupils in the latest year (a secondary's old reception class is history). Newest year first.
 */
export function oversubscriptionGroups(admissions: SchoolCard["admissions"]): OversubscriptionGroup[] {
  const rows = admissions.byYear ?? admissions.demand;
  if (rows.length === 0) return [];
  const latest = Math.max(...rows.map((row) => row.entryYear));
  const points = [...new Set(rows.filter((row) => row.entryYear === latest).map((row) => row.entryPoint))];
  return points.map((entryPoint) => ({
    entryPoint,
    rows: rows.filter((row) => row.entryPoint === entryPoint).sort((a, b) => b.entryYear - a.entryYear),
  }));
}

/** Share of first-choice families offered a place on national offer day (100 − not offered), whole percent. */
export function firstChoiceOfferedPercent(row: Pick<SchoolDemand, "firstChoiceNotOfferedPercent">): number | null {
  const notOffered = row.firstChoiceNotOfferedPercent;
  return notOffered == null ? null : Math.round(100 - notOffered);
}

/** The England rank by year as results slots (topPercent as the value), so no-exam years keep a labelled gap. */
export function rankSlots(rank: Pick<NationalRank, "history">): ResultsSlot[] {
  const series = [...rank.history].sort((a, b) => a.academicYear.localeCompare(b.academicYear))
    .map((point) => ({ academicYear: point.academicYear, value: point.topPercent, suppressed: false, cohortSize: null }));
  return resultsSlots({ id: "national-rank", label: "England rank", unit: "percent", series });
}

export type SectionId = "results" | "getting-in" | "links" | "inspections" | "pupils" | "parent-view" | "workforce" | "finance" | "destinations";

/** One always-open section of the full card: its heading, the year its figures are from (said once), or why it is empty. */
export interface CardSection {
  id: SectionId;
  title: string;
  year: string | null;
  /** Why there is nothing to show, from the API's missing[] where it says; null when the section has figures. */
  missing: string | null;
}

const missingFor = (card: SchoolCard, measure: string) => card.missing.find((entry) => entry.measure === measure)?.reason ?? null;

/**
 * The full card's sections in the order a parent decides by (school-card-open-spec.md): Results, Getting in
 * (admissions and catchment), Inspections (with strengths), Pupils, Parent View, Workforce, Financials, Destinations
 * (not for primaries: the GLA 2016 Year 6 flows are outdated).
 */
export function cardSections(card: SchoolCard): CardSection[] {
  const { school, profile } = card;
  const section = (id: SectionId, title: string, has: boolean, year: string | null, missing: string | null): CardSection =>
    ({ id, title, year: has ? year : null, missing: has ? null : missing ?? "No data" });
  const rank = card.nationalRank ?? null;
  const demand = card.admissions.demand;
  const staff = card.workforce ?? null;
  const money = card.finance ?? null;
  const ks4 = school.phase === "secondary" ? card.destinations?.ks4 ?? null : null;
  const post16 = school.phase === "secondary" ? card.destinations?.post16 ?? null : null;
  const profileYear = profile?.fsm6Percent?.academicYear ?? profile?.girlsPercent?.academicYear ?? null;
  const pupils = profile?.gias?.pupils ?? latestPoint(card.history.measures, "pupils")?.value ?? card.details.pupils;
  // Inspections: the years the timeline spans (the card shows up to 8, newest first), "2009–2023" or "2023".
  const inspectionYears = card.history.inspections.slice(0, 8).map((inspection) => (inspection.startDate ?? "").slice(0, 4)).filter(Boolean);
  const inspectionSpan = inspectionYears.length === 0 ? null
    : inspectionYears.at(-1) === inspectionYears[0] ? inspectionYears[0] : `${inspectionYears.at(-1)}–${inspectionYears[0]}`;
  const leavers = ks4 ?? post16;
  const sections = [
    section("results", "Results", card.kpis.length > 0 || rank !== null, rank?.year ?? card.kpis.find((kpi) => kpi.year)?.year ?? null,
      rank?.missingReason ?? "No results published"),
    section("getting-in", "Getting in", demand.length > 0 || card.admissions.lastOffered.length > 0,
      demand.length > 0 ? String(Math.max(...demand.map((row) => row.entryYear))) : null, "No admissions figures or last distance offered published"),
    section("links", "Visit & links", Boolean(card.links), null, "Links are not loaded"),
    section("inspections", "Inspections", card.history.inspections.length > 0 || Boolean(card.inspectionCounts) || Boolean(card.tldr), inspectionSpan, "Not inspected yet"),
    section("pupils", "Pupils", Boolean(profile) || typeof pupils === "number", profileYear, null),
    section("parent-view", "Parent View", Boolean(card.parentView), null, missingFor(card, "parent-view")),
    section("workforce", "Workforce", staff !== null, staff?.academicYear ?? null, missingFor(card, "workforce")),
    // "2025-26" (the accounts' own spelling) is written like every other year on the card: "2025/26".
    section("finance", "Financials", money !== null, money?.period.replace(/^(\d{4})-(\d{2})$/, "$1/$2") ?? null, money?.missingReason ?? missingFor(card, "finance")),
    section("destinations", "Destinations", leavers !== null, leavers ? `${leavers.cohortYear} leavers` : null, missingFor(card, "destinations")),
  ];
  return school.phase === "primary" ? sections.filter((entry) => entry.id !== "destinations") : sections;
}

/**
 * A compared figure as the card prints it: "646", "18.7%", "22.4", "£7,246". Percents and ratios always keep one
 * decimal ("12.0", "7.0%"), so the school's figure and the London and borough medians beside it read alike.
 */
export function compareText(value: number, unit: CompareMeasure["unit"]): string {
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "pounds") return formatPounds(value);
  if (unit === "ratio") return value.toFixed(1);
  return Math.round(value).toLocaleString("en-GB");
}

/**
 * Colour only where a direction is clearly better (betterWhen): better than the London median is good, in
 * London's worst 10% is bad, between is neutral; null (no colour) for every other figure.
 */
export function compareTone(measure: Pick<CompareMeasure, "value" | "london" | "betterWhen">): GradeTone | null {
  const { value, london, betterWhen } = measure;
  if (!betterWhen) return null;
  const lower = betterWhen === "lower";
  if (lower ? value < london.median : value > london.median) return "good";
  if (lower ? value > london.p90 : value < london.p10) return "bad";
  return "neutral";
}

/**
 * Where "you" (the straight line from the area the card was opened from) fall against the latest last distance
 * offered: inside or outside it; "inside" when everyone who applied got a place; null when it is not published.
 */
export function distanceVerdict(youMetres: number, latest: Pick<LastOffered, "distanceMetres" | "allOffered">): "inside" | "outside" | null {
  if (latest.distanceMetres === null) return latest.allOffered ? "inside" : null;
  return youMetres <= latest.distanceMetres ? "inside" : "outside";
}

/** The region the card's percentiles, medians and places are within: "London" for London's schools. */
export function scopeName(card: Pick<SchoolCard, "rankScope">): string {
  return card.rankScope?.name ?? "London";
}
