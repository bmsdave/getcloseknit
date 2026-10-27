import type { SchoolPoint } from "./map-school-layer";
import type { OfstedMark } from "./school-icons";

/**
 * Schools filter v2 (board "School filter · 5 UI options", options 2 + 4): one filter object for the map's school
 * markers (Show › Schools), the /schools hub list and My match's "near a school like this" place. It travels as one
 * compact text, `?schools=…` in the address and `filter` in a My match place; api/area_api/school_filter.py reads
 * the same text (tests/school-filter.test.ts and api tests/test_school_filter.py hold the same cases):
 *
 *   on            every school
 *   t.p.s         phases: p primary, s secondary, a all-through, x private (absent = all)
 *   o.out.good    Ofsted standing: out, good, ri, inad, rc, none (absent = all; state schools only)
 *   e.academy     type of establishment (absent = any)
 *   g.girls       intake: mixed, girls, boys
 *   f.faith       faith: faith, none
 *   m.ks2.75      a measure (it colours the markers) and its threshold (absent = colour only): at least the
 *                 threshold, at most for England top % and free school meals
 *   a             sixth forms by A-level results only (every sector)
 *
 * Segments are joined by "_" in that order. Pupil-mix measures (ethnicity and the like) are never filters.
 */

export type SchoolType = "primary" | "secondary" | "all-through" | "private";
export type OfstedFilter = "out" | "good" | "ri" | "inad" | "rc" | "none";
export type EstablishmentGroup = "academy" | "free" | "community" | "voluntary" | "foundation";
export type SchoolGender = "mixed" | "girls" | "boys";
export type SchoolFaith = "faith" | "none";
export type SchoolMeasureId = "englandTopPercent" | "progress8" | "attainment8" | "grade5EngMaths" | "ks2RwmExpected" | "fsm6Share";

export interface SchoolFilter {
  /** Phase (and private schools as a fourth). */
  phases: readonly SchoolType[];
  /** Ofsted standing, state schools only: a private school has no Ofsted grade here. */
  ofsted: readonly OfstedFilter[];
  /** GIAS type of establishment; empty = any. */
  establishments: readonly EstablishmentGroup[];
  gender: SchoolGender | null;
  faith: SchoolFaith | null;
  /** The chosen measure colours the markers (option 4); a threshold also keeps only the schools that reach it. */
  measure: { id: SchoolMeasureId; threshold: number | null } | null;
  /** Sixth forms by A-level results, every sector (issue #201): only schools with a combined A-level rank. */
  aLevelOnly: boolean;
}

export const SCHOOL_TYPES: readonly { id: SchoolType; label: string; code: string }[] = [
  { id: "primary", label: "Primary", code: "p" }, { id: "secondary", label: "Secondary", code: "s" },
  { id: "all-through", label: "All-through", code: "a" }, { id: "private", label: "Private", code: "x" },
];
export const OFSTED_FILTERS: readonly { id: OfstedFilter; mark: OfstedMark | null; label: string }[] = [
  { id: "out", mark: "outstanding", label: "Outstanding" }, { id: "good", mark: "good", label: "Good" },
  { id: "ri", mark: "requires-improvement", label: "Requires improvement" }, { id: "inad", mark: "inadequate", label: "Inadequate" },
  { id: "rc", mark: "report-card", label: "Report card" }, { id: "none", mark: null, label: "Not inspected" },
];
export const ESTABLISHMENTS: readonly { id: EstablishmentGroup; label: string }[] = [
  { id: "academy", label: "Academy" }, { id: "free", label: "Free school" }, { id: "community", label: "Community" },
  { id: "voluntary", label: "Voluntary" }, { id: "foundation", label: "Foundation" },
];
export const GENDERS: readonly { id: SchoolGender; label: string }[] = [
  { id: "mixed", label: "Mixed" }, { id: "girls", label: "Girls" }, { id: "boys", label: "Boys" },
];
export const FAITHS: readonly { id: SchoolFaith; label: string }[] = [{ id: "faith", label: "Faith" }, { id: "none", label: "No faith" }];

export interface SchoolMeasure {
  id: SchoolMeasureId;
  /** Its word in the compact text. */
  short: string;
  label: string;
  /** "%" or nothing (a score). */
  unit: "%" | "";
  /** At most the threshold (England top %, free school meals), else at least. */
  atMost: boolean;
  min: number;
  max: number;
  step: number;
  /** The slider's first threshold. */
  initial: number;
  /** Three stops make the four colour steps; `darker` says which end is the darkest step. */
  stops: readonly [number, number, number];
  darker: "higher" | "lower";
  /** The legend's four steps, light to dark. */
  legend: readonly [string, string, string, string];
  /** The phase the measure is published for (null = every state school). */
  phase: "primary" | "secondary" | null;
  source: string;
}

export const SCHOOL_MEASURES: readonly SchoolMeasure[] = [
  { id: "englandTopPercent", short: "top", label: "England top %", unit: "%", atMost: true, min: 1, max: 50, step: 1, initial: 10,
    stops: [5, 10, 25], darker: "lower", legend: ["below top 25%", "top 10–25%", "top 5–10%", "top 5%"], phase: null,
    source: "DfE results, England rank" },
  { id: "progress8", short: "p8", label: "Progress 8", unit: "", atMost: false, min: -1, max: 1, step: 0.1, initial: 0,
    stops: [-0.5, 0, 0.5], darker: "higher", legend: ["below −0.5", "−0.5 to 0", "0 to +0.5", "+0.5 and above"], phase: "secondary",
    source: "DfE KS4" },
  { id: "attainment8", short: "a8", label: "Attainment 8", unit: "", atMost: false, min: 20, max: 80, step: 1, initial: 50,
    stops: [40, 50, 60], darker: "higher", legend: ["below 40", "40–50", "50–60", "60 and above"], phase: "secondary",
    source: "DfE KS4" },
  { id: "grade5EngMaths", short: "g5", label: "Grade 5+ English & maths", unit: "%", atMost: false, min: 0, max: 100, step: 5, initial: 50,
    stops: [40, 55, 70], darker: "higher", legend: ["below 40%", "40–55%", "55–70%", "70% and above"], phase: "secondary",
    source: "DfE KS4" },
  { id: "ks2RwmExpected", short: "ks2", label: "KS2 expected standard", unit: "%", atMost: false, min: 0, max: 100, step: 5, initial: 75,
    stops: [55, 70, 85], darker: "higher", legend: ["below 55%", "55–70%", "70–85%", "85% and above"], phase: "primary",
    source: "DfE KS2, reading, writing and maths" },
  { id: "fsm6Share", short: "fsm", label: "Free school meals %", unit: "%", atMost: true, min: 0, max: 60, step: 5, initial: 30,
    stops: [10, 25, 40], darker: "higher", legend: ["below 10%", "10–25%", "25–40%", "40% and above"], phase: null,
    source: "DfE school census, FSM in the past 6 years" },
];

export function schoolMeasure(id: SchoolMeasureId): SchoolMeasure {
  return SCHOOL_MEASURES.find((measure) => measure.id === id)!;
}

export const DEFAULT_SCHOOL_FILTER: SchoolFilter = {
  phases: SCHOOL_TYPES.map((type) => type.id), ofsted: OFSTED_FILTERS.map((grade) => grade.id), establishments: [],
  gender: null, faith: null, measure: null, aLevelOnly: false,
};

// ---- One school against the filter --------------------------------------------------------------------

type FilterPoint = Pick<SchoolPoint, "kind" | "stage" | "phase" | "ofsted" | "intake" | "faith" | "group" | "measures" | "aLevelRank" | "topPercent" | "rankYear">;

export function schoolType(point: Pick<SchoolPoint, "kind" | "stage" | "phase">): SchoolType {
  if (point.kind === "independent") return "private";
  return point.stage ?? (point.phase === "primary" ? "primary" : "secondary");
}

export function ofstedFilterOf(point: Pick<SchoolPoint, "ofsted">): OfstedFilter {
  return OFSTED_FILTERS.find((grade) => grade.mark === (point.ofsted ?? null))?.id ?? "none";
}

export function schoolGender(point: Pick<SchoolPoint, "intake">): SchoolGender {
  const intake = point.intake ?? "";
  return intake.startsWith("Girls") ? "girls" : intake.startsWith("Boys") ? "boys" : "mixed";
}

const NO_FAITH = /^(none|unknown|does not apply|not applicable)$/i;
export function hasFaith(point: Pick<SchoolPoint, "faith">): boolean {
  const text = (point.faith ?? "").trim();
  return text !== "" && !NO_FAITH.test(text);
}

/** The point's latest value of a measure and its year, or null (suppressed, a small cohort, another phase). */
export function schoolMeasureValue(point: Pick<SchoolPoint, "kind" | "measures" | "topPercent" | "rankYear">, id: SchoolMeasureId): { value: number; year: string } | null {
  if (point.kind === "independent") return null;
  const pair = point.measures?.[id];
  if (pair) return { value: pair[0], year: pair[1] };
  // Older points (and the preview) carry England top % only as topPercent (Top 25% or better).
  if (id === "englandTopPercent" && typeof point.topPercent === "number" && point.topPercent > 0) {
    return { value: point.topPercent, year: point.rankYear ?? "" };
  }
  return null;
}

/** Whether a value reaches the threshold (at most for the "lower" measures). */
export function passesThreshold(measure: SchoolMeasure, value: number, threshold: number): boolean {
  return measure.atMost ? value <= threshold : value >= threshold;
}

/**
 * Whether the filter keeps a school (the map, the hub and, in Python, My match). A threshold drops schools
 * without the measure: the filter cannot vouch for them. With a measure and no threshold, nobody is dropped.
 */
export function schoolShown(point: FilterPoint, filter: SchoolFilter): boolean {
  if (!filter.phases.includes(schoolType(point))) return false;
  if (filter.gender && schoolGender(point) !== filter.gender) return false;
  if (filter.faith && hasFaith(point) !== (filter.faith === "faith")) return false;
  // Sixth forms by A-level results is its own mode: only ranked sixth forms, every sector.
  if (filter.aLevelOnly) return point.aLevelRank !== undefined;
  if (filter.establishments.length && (!point.group || !filter.establishments.includes(point.group))) return false;
  if (point.kind !== "independent" && !filter.ofsted.includes(ofstedFilterOf(point))) return false;
  if (filter.measure && filter.measure.threshold !== null) {
    const found = schoolMeasureValue(point, filter.measure.id);
    return found !== null && passesThreshold(schoolMeasure(filter.measure.id), found.value, filter.measure.threshold);
  }
  return true;
}

/** The colour step (0 light … 3 dark) of a value on the measure's ramp. */
export function measureStep(measure: SchoolMeasure, value: number): 0 | 1 | 2 | 3 {
  const above = measure.stops.filter((stop) => (measure.darker === "higher" ? value >= stop : value > stop)).length;
  return (measure.darker === "higher" ? above : 3 - above) as 0 | 1 | 2 | 3;
}

export function isDefaultSchoolFilter(filter: SchoolFilter): boolean {
  return schoolFilterText(filter) === "on";
}

// ---- The compact text -----------------------------------------------------------------------------------

/** 75, 0.5, -0.5: two decimals at most (school_filter._format prints the same). */
function formatThreshold(value: number): string {
  return String(Math.round(value * 100) / 100 || 0);
}

/** The filter's canonical compact text ("on" for every school). */
export function schoolFilterText(filter: SchoolFilter): string {
  const segments: string[] = [];
  if (filter.phases.length !== SCHOOL_TYPES.length) {
    segments.push(["t", ...SCHOOL_TYPES.filter((type) => filter.phases.includes(type.id)).map((type) => type.code)].join("."));
  }
  if (filter.ofsted.length !== OFSTED_FILTERS.length) {
    segments.push(["o", ...OFSTED_FILTERS.filter((grade) => filter.ofsted.includes(grade.id)).map((grade) => grade.id)].join("."));
  }
  if (filter.establishments.length) {
    segments.push(["e", ...ESTABLISHMENTS.filter((group) => filter.establishments.includes(group.id)).map((group) => group.id)].join("."));
  }
  if (filter.gender) segments.push(`g.${filter.gender}`);
  if (filter.faith) segments.push(`f.${filter.faith}`);
  if (filter.measure) {
    const short = schoolMeasure(filter.measure.id).short;
    segments.push(filter.measure.threshold === null ? `m.${short}` : `m.${short}.${formatThreshold(filter.measure.threshold)}`);
  }
  if (filter.aLevelOnly) segments.push("a");
  return segments.join("_") || "on";
}

/**
 * The filter from its compact text. Lenient (the address): unknown words are dropped. Strict (a My match place):
 * null for anything unknown, repeated, out of order or out of range.
 */
export function parseSchoolFilter(text: string, strict = false): SchoolFilter | null {
  if (typeof text !== "string" || text.length < 1 || text.length > 160) return strict ? null : { ...DEFAULT_SCHOOL_FILTER };
  if (text === "on") return { ...DEFAULT_SCHOOL_FILTER };
  const filter: SchoolFilter = { ...DEFAULT_SCHOOL_FILTER };
  const order = ["t", "o", "e", "g", "f", "m", "a"];
  let last = -1;
  const unique = (values: string[]) => new Set(values).size === values.length;
  for (const segment of text.split("_")) {
    const [key, ...values] = segment.split(".");
    const at = order.indexOf(key);
    if (at <= last) {
      if (strict) return null;
      continue;
    }
    last = at;
    if (key === "t") {
      const known = SCHOOL_TYPES.filter((type) => values.includes(type.code));
      if (strict && (known.length !== values.length || !unique(values))) return null;
      filter.phases = known.map((type) => type.id);
    } else if (key === "o") {
      const known = OFSTED_FILTERS.filter((grade) => values.includes(grade.id));
      if (strict && (known.length !== values.length || !unique(values))) return null;
      filter.ofsted = known.map((grade) => grade.id);
    } else if (key === "e") {
      const known = ESTABLISHMENTS.filter((group) => values.includes(group.id));
      if (strict && (!values.length || known.length !== values.length || !unique(values))) return null;
      filter.establishments = known.map((group) => group.id);
    } else if (key === "g") {
      const gender = GENDERS.find((item) => item.id === values[0] && values.length === 1);
      if (strict && !gender) return null;
      filter.gender = gender?.id ?? null;
    } else if (key === "f") {
      const faith = FAITHS.find((item) => item.id === values[0] && values.length === 1);
      if (strict && !faith) return null;
      filter.faith = faith?.id ?? null;
    } else if (key === "m") {
      const measure = SCHOOL_MEASURES.find((item) => item.short === values[0]);
      const raw = values.slice(1).join(".");
      const threshold = raw === "" ? null : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
      const inRange = threshold === null || (Number.isFinite(threshold) && (!measure || (threshold >= strictBounds(measure)[0] && threshold <= strictBounds(measure)[1])));
      if (strict && (!measure || !inRange)) return null;
      filter.measure = measure ? { id: measure.id, threshold: inRange ? threshold : null } : null;
    } else if (key === "a") {
      if (strict && values.length) return null;
      filter.aLevelOnly = true;
    } else if (strict) {
      return null;
    }
  }
  return filter;
}

/** The thresholds a My match place may carry (school_filter.MEASURES bounds). */
function strictBounds(measure: SchoolMeasure): [number, number] {
  return ({ top: [1, 100], p8: [-3, 3], a8: [0, 90], g5: [0, 100], ks2: [0, 100], fsm: [0, 100] } as Record<string, [number, number]>)[measure.short];
}

/** A valid My match place filter: strict and canonical (matching._validate_school_filter does the same). */
export function isSchoolFilterText(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const filter = parseSchoolFilter(text, true);
  return filter !== null && schoolFilterText(filter) === text;
}

const LEGACY_TYPES = new Set(SCHOOL_TYPES.map((type) => type.id as string));

/**
 * The filter from the address: `?schools=on` or the compact text. Older addresses still read:
 * ?schools=primary,secondary ("none" for none), ?ofsted=out,good, ?top10=1, ?alevel=1.
 */
export function schoolFilterFromQuery(search: string): SchoolFilter {
  const parameters = new URLSearchParams(search);
  const raw = parameters.get("schools");
  const words = raw?.split(",") ?? [];
  const legacy = raw === null || raw === "off" || raw === "none" || words.every((word) => LEGACY_TYPES.has(word));
  if (!legacy) return parseSchoolFilter(raw!) ?? { ...DEFAULT_SCHOOL_FILTER };
  const filter: SchoolFilter = { ...DEFAULT_SCHOOL_FILTER };
  if (raw === "none") filter.phases = [];
  else if (raw && raw !== "on" && raw !== "off") filter.phases = SCHOOL_TYPES.filter((type) => words.includes(type.id)).map((type) => type.id);
  const ofsted = parameters.get("ofsted");
  if (ofsted !== null) filter.ofsted = ofsted === "none" ? [] : OFSTED_FILTERS.filter((grade) => ofsted.split(",").includes(grade.id)).map((grade) => grade.id);
  if (parameters.get("top10") === "1") filter.measure = { id: "englandTopPercent", threshold: 10 };
  if (parameters.get("alevel") === "1") filter.aLevelOnly = true;
  return filter;
}

/** Writes the filter as ?schools= ("on" for every school); off drops it (and any older parameters). */
export function withSchoolFilterQuery(query: string, on: boolean, filter: SchoolFilter): string {
  const parameters = new URLSearchParams(query);
  for (const key of ["ofsted", "top10", "alevel"]) parameters.delete(key);
  if (on) parameters.set("schools", schoolFilterText(filter));
  else parameters.delete("schools");
  return parameters.toString();
}

// ---- Words ------------------------------------------------------------------------------------------------

export function formatMeasureValue(measure: SchoolMeasure, value: number): string {
  if (measure.id === "englandTopPercent") return `top ${Math.round(value * 10) / 10}%`;
  if (measure.id === "progress8") return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value * 100) / 100)}`;
  return `${Math.round(value * 10) / 10}${measure.unit}`;
}

/** "KS2 expected standard ≥ 75%", "England top % ≤ 10%". */
export function thresholdLabel(measure: SchoolMeasure, threshold: number): string {
  const shown = measure.id === "progress8" ? formatMeasureValue(measure, threshold) : `${formatThreshold(threshold)}${measure.unit}`;
  return `${measure.label} ${measure.atMost ? "≤" : "≥"} ${shown}`;
}

/** The filter read back for a chip or a My match row: "Primary · Outstanding or Good · KS2 expected standard ≥ 75%". */
export function describeSchoolFilter(filter: SchoolFilter): string {
  const words: string[] = [];
  const or = (labels: string[]) => labels.join(" or ");
  if (filter.phases.length !== SCHOOL_TYPES.length) words.push(or(SCHOOL_TYPES.filter((t) => filter.phases.includes(t.id)).map((t) => t.label)) || "No school");
  if (filter.ofsted.length !== OFSTED_FILTERS.length) words.push(or(OFSTED_FILTERS.filter((g) => filter.ofsted.includes(g.id)).map((g) => g.label)) || "No Ofsted grade");
  if (filter.establishments.length) words.push(or(ESTABLISHMENTS.filter((g) => filter.establishments.includes(g.id)).map((g) => g.label)));
  if (filter.gender) words.push(GENDERS.find((item) => item.id === filter.gender)!.label);
  if (filter.faith) words.push(filter.faith === "faith" ? "Faith school" : "No faith");
  if (filter.measure?.threshold !== null && filter.measure) words.push(thresholdLabel(schoolMeasure(filter.measure.id), filter.measure.threshold!));
  if (filter.aLevelOnly) words.push("Sixth forms by A level");
  return words.join(" · ") || "Any school";
}

// ---- The chips (map Show › Schools and the /schools hub) -----------------------------------------------------

export type SchoolChipRowId = "phase" | "ofsted" | "results" | "type" | "intake" | "faith";
export interface SchoolChip { id: string; label: string; current: boolean; next: SchoolFilter }
export interface SchoolChipRow { id: SchoolChipRowId; label: string; chips: SchoolChip[] }

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item) => b.includes(item));
const toggle = <T,>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/**
 * The filter as rows of chips, each chip the filter it leads to: the hub draws them as links (?schools=…), the
 * map's Schools filter as buttons. The first chip of a row is "no filter". A measure set elsewhere (the map's
 * slider) shows as its own chosen chip in Results, so the hub reads back what the map chose.
 */
export function schoolFilterChipRows(filter: SchoolFilter, rows: readonly SchoolChipRowId[]): SchoolChipRow[] {
  const all = DEFAULT_SCHOOL_FILTER;
  const build: Record<SchoolChipRowId, () => SchoolChipRow> = {
    phase: () => ({ id: "phase", label: "Phase", chips: [
      { id: "all", label: "All", current: same(filter.phases, all.phases), next: { ...filter, phases: all.phases } },
      ...SCHOOL_TYPES.filter((type) => type.id !== "private").map((type) => ({
        id: type.id, label: type.label, current: same(filter.phases, [type.id]), next: { ...filter, phases: [type.id] },
      })),
    ] }),
    ofsted: () => {
      const choice = (id: string, label: string, grades: OfstedFilter[]): SchoolChip => ({
        id, label, current: same(filter.ofsted, grades), next: { ...filter, ofsted: grades } });
      return { id: "ofsted", label: "Ofsted", chips: [
        choice("any", "Any", [...all.ofsted]), choice("outstanding", "Outstanding", ["out"]),
        choice("good", "Good or better", ["out", "good"]), choice("report-card", "Report card", ["rc"]),
      ] };
    },
    results: () => {
      const top = (percent: number): SchoolChip => ({
        id: `top${percent}`, label: `Top ${percent}%`,
        current: filter.measure?.id === "englandTopPercent" && filter.measure.threshold === percent,
        next: { ...filter, measure: { id: "englandTopPercent", threshold: percent } },
      });
      const chips = [{ id: "any", label: "Any", current: !filter.measure || filter.measure.threshold === null, next: { ...filter, measure: null } },
        top(10), top(25)];
      if (filter.measure && filter.measure.threshold !== null && !chips.some((chip) => chip.current)) {
        chips.push({ id: "measure", label: thresholdLabel(schoolMeasure(filter.measure.id), filter.measure.threshold), current: true, next: filter });
      }
      return { id: "results", label: "Results", chips };
    },
    type: () => ({ id: "type", label: "Type", chips: [
      { id: "any", label: "Any", current: filter.establishments.length === 0, next: { ...filter, establishments: [] } },
      ...ESTABLISHMENTS.map((group) => ({
        id: group.id, label: group.label, current: filter.establishments.includes(group.id),
        next: { ...filter, establishments: toggle(filter.establishments, group.id) },
      })),
    ] }),
    intake: () => ({ id: "intake", label: "Intake", chips: [
      { id: "any", label: "Any", current: filter.gender === null, next: { ...filter, gender: null } },
      ...GENDERS.map((gender) => ({ id: gender.id, label: gender.label, current: filter.gender === gender.id, next: { ...filter, gender: gender.id } })),
    ] }),
    faith: () => ({ id: "faith", label: "Faith", chips: [
      { id: "any", label: "Any", current: filter.faith === null, next: { ...filter, faith: null } },
      ...FAITHS.map((faith) => ({ id: faith.id, label: faith.label, current: filter.faith === faith.id, next: { ...filter, faith: faith.id } })),
    ] }),
  };
  return rows.map((row) => build[row]());
}
