import type { SchoolPoint } from "./map-school-layer";
import {
  DEFAULT_SCHOOL_FILTER, parseSchoolFilter, schoolFilterText, schoolShown,
  type OfstedFilter, type SchoolChipRowId, type SchoolFilter,
} from "./school-filter";
import type { OfstedMark } from "./school-icons";

/**
 * /schools (Menu v5 board): the filters, the borough list and the joins behind them. Pure, so
 * tests/schools-hub.test.ts can check them; app/schools/page.tsx fetches /api/v1/schools/index (borough) and
 * /api/v1/schools/points (Ofsted mark, top %) and joins them here.
 */
export interface LondonBorough {
  code: string;
  name: string;
  slug: string;
}

/** "Hammersmith and Fulham" -> "hammersmith-and-fulham"; GIAS local-authority names slug the same way. */
export function boroughSlug(name: string): string {
  return name.toLocaleLowerCase("en-GB").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const BOROUGH_NAMES: readonly [string, string][] = [
  ["E09000002", "Barking and Dagenham"], ["E09000003", "Barnet"], ["E09000004", "Bexley"], ["E09000005", "Brent"],
  ["E09000006", "Bromley"], ["E09000007", "Camden"], ["E09000001", "City of London"], ["E09000008", "Croydon"],
  ["E09000009", "Ealing"], ["E09000010", "Enfield"], ["E09000011", "Greenwich"], ["E09000012", "Hackney"],
  ["E09000013", "Hammersmith and Fulham"], ["E09000014", "Haringey"], ["E09000015", "Harrow"], ["E09000016", "Havering"],
  ["E09000017", "Hillingdon"], ["E09000018", "Hounslow"], ["E09000019", "Islington"], ["E09000020", "Kensington and Chelsea"],
  ["E09000021", "Kingston upon Thames"], ["E09000022", "Lambeth"], ["E09000023", "Lewisham"], ["E09000024", "Merton"],
  ["E09000025", "Newham"], ["E09000026", "Redbridge"], ["E09000027", "Richmond upon Thames"], ["E09000028", "Southwark"],
  ["E09000029", "Sutton"], ["E09000030", "Tower Hamlets"], ["E09000031", "Waltham Forest"], ["E09000032", "Wandsworth"],
  ["E09000033", "Westminster"],
];

/** London's 33 local authorities (32 boroughs and the City), A to Z. */
export const LONDON_BOROUGHS: readonly LondonBorough[] = BOROUGH_NAMES.map(([code, name]) => ({ code, name, slug: boroughSlug(name) }));

export function boroughBySlug(slug: string | null | undefined, boroughs: readonly LondonBorough[] = LONDON_BOROUGHS): LondonBorough | null {
  return boroughs.find((borough) => borough.slug === slug) ?? null;
}

/**
 * The hub's "By borough" list: London's 33, then every other local authority the school index names (GIAS:
 * a county for two-tier areas), A to Z. Only London's without England data (FLAGS.md CLOSE_KNIT_ENGLAND).
 */
export function hubBoroughs(schools: readonly { borough: string | null }[]): LondonBorough[] {
  const bySlug = new Map(LONDON_BOROUGHS.map((borough) => [borough.slug, borough]));
  for (const school of schools) {
    const name = school.borough?.trim();
    if (name && !bySlug.has(boroughSlug(name))) bySlug.set(boroughSlug(name), { code: "", name, slug: boroughSlug(name) });
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

/** "England" once the list goes beyond London's 33, else "London". */
export function hubScope(boroughs: readonly LondonBorough[]): "England" | "London" {
  return boroughs.length > LONDON_BOROUGHS.length ? "England" : "London";
}

/**
 * The hub's filters: Schools filter v2 (lib/school-filter.ts, the same object and `?schools=` text as the map's
 * Show › Schools and My match), plus the borough and a name search.
 */
export interface SchoolFilters {
  school: SchoolFilter;
  borough: LondonBorough | null;
  /** A school's name, or part of it (the page's search field). */
  q: string;
}

export const NO_FILTERS: SchoolFilters = { school: DEFAULT_SCHOOL_FILTER, borough: null, q: "" };

/** The hub's chip rows, in order (components/schools/school-filter-chips.tsx). */
export const HUB_CHIP_ROWS: readonly SchoolChipRowId[] = ["phase", "ofsted", "results", "type", "intake", "faith"];

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Older hub links (?phase=&ofsted=&top=) as the filter. */
function legacyFilter(params: Params): SchoolFilter {
  const phase = first(params.phase);
  const ofsted = first(params.ofsted);
  const top = first(params.top);
  const grades: Record<string, OfstedFilter[]> = { outstanding: ["out"], good: ["out", "good"], "report-card": ["rc"] };
  return {
    ...DEFAULT_SCHOOL_FILTER,
    ...(phase === "primary" || phase === "secondary" ? { phases: [phase] } : {}),
    ...(ofsted && grades[ofsted] ? { ofsted: grades[ofsted] } : {}),
    ...(top === "10" || top === "25" ? { measure: { id: "englandTopPercent" as const, threshold: Number(top) } } : {}),
  };
}

/** ?q=&borough=&schools= -> filters (older ?phase=&ofsted=&top= links still read); anything unknown is "no filter". */
export function readSchoolFilters(params: Params, boroughs: readonly LondonBorough[] = LONDON_BOROUGHS): SchoolFilters {
  const text = first(params.schools);
  return {
    school: text ? parseSchoolFilter(text) ?? DEFAULT_SCHOOL_FILTER : legacyFilter(params),
    borough: boroughBySlug(first(params.borough), boroughs),
    q: (first(params.q) ?? "").trim().slice(0, 80),
  };
}

/** The /schools link for these filters with `change` applied; defaults are left out ("/schools" for none). */
export function schoolsHref(filters: SchoolFilters, change: Partial<SchoolFilters> = {}): string {
  const next = { ...filters, ...change };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.borough) query.set("borough", next.borough.slug);
  const text = schoolFilterText(next.school);
  if (text !== "on") query.set("schools", text);
  const words = query.toString();
  return words ? `/schools?${words}` : "/schools";
}

/** The phase the top lists narrow to: one phase picked, else all. */
export function hubPhase(filters: SchoolFilters): "all" | "primary" | "secondary" {
  const [only, ...rest] = filters.school.phases;
  return rest.length === 0 && (only === "primary" || only === "secondary") ? only : "all";
}

/** Whether the page lists schools: a search, a borough or any filter but the phase (the phase alone only narrows the top lists). */
export function listsSchools(filters: SchoolFilters): boolean {
  return filters.q !== "" || filters.borough !== null
    || schoolFilterText({ ...filters.school, phases: DEFAULT_SCHOOL_FILTER.phases }) !== "on";
}

const fold = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-GB")
  .replace(/[^a-z0-9]+/g, " ").trim();

/** school-index.v1 rows (api school_card.py school_index); borough is the GIAS local authority. */
export interface SchoolIndexRow {
  urn: string;
  name: string;
  phase: string;
  borough?: string | null;
  successorUrn: string | null;
  hasEvidence: boolean;
}

/** One row of the hub's list: an open state school with its borough, Ofsted mark and top %, and its map point
 * (null without the points feed) for the shared filter. */
export interface DirectorySchool {
  urn: string;
  name: string;
  phase: "primary" | "secondary";
  borough: string | null;
  ofsted: OfstedMark | null;
  topPercent: number | null;
  point: SchoolPoint | null;
}

/**
 * The open state schools: the points feed (open schools, Ofsted mark, top %) joined to the index (borough).
 * Without points, the index's schools that have no successor; independent schools are left out (no Ofsted mark).
 */
export function joinDirectory(index: readonly SchoolIndexRow[], points: readonly SchoolPoint[]): DirectorySchool[] {
  const boroughs = new Map(index.map((row) => [row.urn, row.borough ?? null]));
  const phase = (value: string): DirectorySchool["phase"] => (value === "primary" ? "primary" : "secondary");
  if (points.length === 0) {
    return index.filter((row) => !row.successorUrn).map((row) => ({
      urn: row.urn, name: row.name, phase: phase(row.phase), borough: row.borough ?? null, ofsted: null, topPercent: null, point: null,
    }));
  }
  return points.filter((point) => (point.kind ?? "state") === "state").map((point) => ({
    urn: point.urn, name: point.name, phase: phase(point.phase), borough: boroughs.get(point.urn) ?? null,
    ofsted: point.ofsted ?? null, topPercent: point.topPercent ?? null, point,
  }));
}

/** The schools these filters keep (the map's schoolShown on each point): best top % first, then A to Z.
 * Without a point (no points feed) only the phase can be checked. */
export function filterSchools(schools: readonly DirectorySchool[], filters: SchoolFilters): DirectorySchool[] {
  const words = fold(filters.q).split(" ").filter(Boolean);
  return schools
    .filter((school) => words.every((word) => fold(school.name).includes(word)))
    .filter((school) => !filters.borough || (school.borough !== null && boroughSlug(school.borough) === filters.borough.slug))
    .filter((school) => (school.point ? schoolShown(school.point, filters.school) : filters.school.phases.includes(school.phase)))
    .sort((a, b) => (a.topPercent ?? 101) - (b.topPercent ?? 101) || a.name.localeCompare(b.name, "en-GB"));
}