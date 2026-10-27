/**
 * Custom criteria ("kebab shops vs cafés"): a household's own area criterion built from places on
 * the map (the API's unified place table: OpenStreetMap, the FSA food register, Overture, Foursquare), evaluated by the API for every London LSOA (api/area_api/custom_criteria.py).
 * Validation mirrors validate_definition / validate_custom there; places, not people: religion,
 * denomination and any key outside CUSTOM_KEYS are refused.
 */
import type {
  BivariateSquare,
  GeographyId,
  LegendStop,
  MapDefinition,
  PreferenceDirection,
  PreferenceProfile,
  ValuePack,
} from "./contracts";
import { CUSTOM_PRESETS } from "./custom-presets";
import { exploreChipYarn } from "./explore-chips";
import { mapFetch } from "./polite-fetch";
import { metricGuidePath } from "./guide-routes";
import { CUSTOM_DIVERGING, CUSTOM_SEQUENTIAL, yarnLegend, yarnRamp } from "./palettes";

export const CUSTOM_KEYS = [
  "amenity", "shop", "leisure", "tourism", "sport", "cuisine", "healthcare", "craft", "office", "brand",
] as const;
export type CustomKey = (typeof CUSTOM_KEYS)[number];
const PEOPLE_KEYS = ["religion", "denomination", "diet", "ethnic", "language", "community", "origin"];
// Places of worship only through the household's own "nearest X" place (custom_criteria.PEOPLE_VALUES / PEOPLE_WORDS).
const PEOPLE_VALUES: Partial<Record<string, string[]>> = { amenity: ["place_of_worship", "monastery"], shop: ["religion"], office: ["religion"] };
const PEOPLE_WORDS = ["cathedral", "chapel", "christian", "church", "catholic", "gurdwara", "hindu", "islamic", "jewish",
  "mandir", "masjid", "mosque", "muslim", "sikh", "synagogue", "temple", "buddhist"];
export const CUSTOM_FORMULAS = ["count", "density", "per_resident", "balance", "share", "variety", "nearest"] as const;
export type CustomFormula = (typeof CUSTOM_FORMULAS)[number];
const PAIR_FORMULAS: readonly CustomFormula[] = ["balance", "share"];
/** Mirrors custom_criteria.BALANCE_PRIOR: small counts lean towards "even". */
export const BALANCE_PRIOR = 5;
export const CUSTOM_SET_IDS = ["a", "b", "c"] as const;
export type CustomSetId = (typeof CUSTOM_SET_IDS)[number];
export const CUSTOM_RADIUS = { min: 200, max: 2000 } as const;
export const MAX_CUSTOM_MATCHERS = 6;
export const MAX_CUSTOM = 4;
const MAX_VALUES = 12;
const ID_RE = /^[a-z0-9-]{1,24}$/;
const VALUE_RE = /^[\p{L}\p{N}_ &'.+:-]{1,40}$/u;
export const PLACES_NOT_PEOPLE = "This counts places on the map, not who lives in an area; it never describes residents.";

/** One tag test: a value, any of a list, "*" (has the tag) or null (has no such tag). */
export type CustomTagValue = string | string[] | null;
/** An AND of tag tests, e.g. { amenity: "cafe", brand: null } = a café without a chain brand. */
export type CustomMatcher = Partial<Record<CustomKey, CustomTagValue>>;
export interface CustomSet { label: string; any: CustomMatcher[] }

export interface CustomCriterion {
  schemaVersion?: "custom-criterion.v1";
  id: string;
  label: string;
  sets: { a: CustomSet; b?: CustomSet; c?: CustomSet };
  formula: CustomFormula;
  radiusMetres: number;
}

/** A custom criterion in the profile: a factor `custom:<id>` scored by its directed London percentile. */
export interface CustomPreference {
  criterion: CustomCriterion;
  weight: number;
  direction: "higher" | "lower";
  /** v4: a filter with no weight. */
  must?: boolean;
}

export type CustomFactorId = `custom:${string}`;
export type CustomLayerId = `custom:${string}`;

export interface CustomAreaValue {
  geographyId: GeographyId;
  value: number | null;
  /** London percentile of "more of it" (more places, more A, closer for nearest). */
  percentile: number | null;
  counts: Partial<Record<CustomSetId, number>>;
  /** Pair formulas: the colour-square cell, level of A × 4 + level of B from the area's counts (custom_criteria.bivariate_cell). */
  cell?: number | null;
  /** A roll-up (CustomCriterionPack.level): how many LSOAs the area's medians are of. */
  areaCount?: number;
}

export interface CustomSummaryEntry extends CustomAreaValue {
  name: string;
  title?: string | null;
}

/** custom-criterion-pack.v1 */
export interface CustomCriterionPack {
  schemaVersion: "custom-criterion-pack.v1";
  productReleaseId: string;
  sourceReleaseId: string;
  criterion: CustomCriterion;
  unit: string;
  legend: LegendStop[];
  summary: {
    areas: number; regionMedian: number | null; top: CustomSummaryEntry[]; bottom: CustomSummaryEntry[];
    /** How many areas share each end's value (absent from the demo preview). */
    tied?: { top: number; bottom: number };
  };
  sources: { id: string; name: string; licence: string; attribution: string; url: string }[];
  caveats: string[];
  values?: CustomAreaValue[];
  /** Pair formulas (balance, share): the map's colour square from both counts. */
  bivariate?: BivariateSquare | null;
  /**
   * "msoa": the LSOAs rolled up to MSOAs (custom_criteria.roll_up_pack), what the map paints zoomed out: medians of
   * their LSOAs' values, percentiles and (pair formulas) cells, the places inside counted. Absent: every LSOA.
   */
  level?: "msoa";
}

/** Mirrors custom_criteria.bivariate_level: how many thresholds the count reaches. */
export function bivariateLevel(count: number, thresholds: readonly number[]): number {
  return thresholds.filter((threshold) => count >= threshold).length;
}

/** Mirrors custom_criteria.bivariate_cell: level of A × shades + level of B (4 × 4); null without counts. */
export function bivariateCell(counts: CustomAreaValue["counts"], square: BivariateSquare): number | null {
  if (counts.a === undefined || counts.b === undefined) return null;
  return bivariateLevel(counts.a, square.axes.a.thresholds) * square.colours.length + bivariateLevel(counts.b, square.axes.b.thresholds);
}

/** Cell index → colour, as legend stops (flat colours at whole numbers). */
export function bivariateStops(square: BivariateSquare): LegendStop[] {
  return square.colours.flatMap((row, a) => row.map((colour, b) => ({ value: a * square.colours.length + b, colour, label: "" })));
}

/** The legend's axis: one count range per shade, "Cafés in the area: 0–6 → 7–19 → 20–36 → 37+". */
export function bivariateAxisText(square: BivariateSquare, axis: "a" | "b"): string {
  return `${square.axes[axis].label} in the area: ${bivariateRanges(square.axes[axis].thresholds).join(" → ")}`;
}

/** Each level of an axis as a count range: thresholds [1, 2, 4] → "0", "1", "2–3", "4+". */
export function bivariateRanges(thresholds: readonly number[]): string[] {
  const starts = [0, ...thresholds];
  return starts.map((start, index) => {
    if (index === starts.length - 1) return `${start}+`;
    const end = starts[index + 1] - 1;
    return end === start ? `${start}` : `${start}–${end}`;
  });
}

/** Hover lines for one area: "In this area: 4 kebab shops · 37 cafés", then "Places, not people". */
export function customTooltip(pack: CustomCriterionPack): (geographyId: string) => string[] {
  const byId = new Map((pack.values ?? []).map((entry) => [entry.geographyId as string, entry]));
  const criterion = pack.criterion;
  return (geographyId) => {
    const entry = byId.get(geographyId);
    if (!entry) return [];
    const counts = describeCounts(entry.counts, criterion);
    return [...(counts ? [`In this area: ${counts}`] : []), "Places, not people"];
  };
}

export function assertCustomCriterion(value: unknown): asserts value is CustomCriterion {
  const definition = value as CustomCriterion;
  if (typeof definition !== "object" || definition === null) throw new Error("a custom criterion must be an object");
  const unknown = Object.keys(definition).filter((key) => !["schemaVersion", "id", "label", "sets", "formula", "radiusMetres"].includes(key));
  if (unknown.length) throw new Error(`unknown criterion field: ${unknown.sort()[0]}`);
  if ((definition.schemaVersion ?? "custom-criterion.v1") !== "custom-criterion.v1") throw new Error("unsupported criterion version");
  if (!ID_RE.test(String(definition.id ?? ""))) throw new Error("criterion id must be 1-24 lowercase letters, digits or dashes");
  assertLabel(definition.label, "criterion");
  if (!CUSTOM_FORMULAS.includes(definition.formula)) throw new Error(`formula must be one of ${CUSTOM_FORMULAS.join(", ")}`);
  const radius = definition.radiusMetres;
  if (!Number.isInteger(radius) || radius < CUSTOM_RADIUS.min || radius > CUSTOM_RADIUS.max) {
    throw new Error(`radius must be ${CUSTOM_RADIUS.min}-${CUSTOM_RADIUS.max} metres`);
  }
  const sets = definition.sets as Record<string, CustomSet> | undefined;
  const ids = typeof sets === "object" && sets !== null ? Object.keys(sets) : [];
  if (!ids.length || ids.some((id) => !(CUSTOM_SET_IDS as readonly string[]).includes(id))) {
    throw new Error("sets must be an object with keys a, b and c");
  }
  if (!ids.includes("a")) throw new Error("set a is required");
  if (PAIR_FORMULAS.includes(definition.formula) && (ids.length !== 2 || !ids.includes("b"))) {
    throw new Error(`${definition.formula} compares exactly two sets, a and b`);
  }
  for (const id of ids) assertSet(id, sets![id]);
}

function assertLabel(value: unknown, what: string): void {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 60) throw new Error(`${what} label must be 1-60 characters`);
}

function assertSet(id: string, set: CustomSet): void {
  if (typeof set !== "object" || set === null || Object.keys(set).some((key) => key !== "label" && key !== "any")) {
    throw new Error(`set ${id} must have a label and any`);
  }
  assertLabel(set.label, `set ${id}`);
  if (!Array.isArray(set.any) || set.any.length < 1 || set.any.length > MAX_CUSTOM_MATCHERS) {
    throw new Error(`set ${id} needs 1-${MAX_CUSTOM_MATCHERS} matchers`);
  }
  for (const matcher of set.any) {
    const entries = typeof matcher === "object" && matcher !== null && !Array.isArray(matcher) ? Object.entries(matcher) : [];
    if (!entries.length) throw new Error(`set ${id}: a matcher is an object of tag tests`);
    for (const [key, value] of entries) assertTest(id, key, value);
    if (entries.every(([, value]) => value === null)) throw new Error(`set ${id}: a matcher needs at least one tag the place has`);
  }
}

function assertTest(id: string, key: string, value: unknown): void {
  if (PEOPLE_KEYS.includes(key)) throw new Error(`${key} is not accepted: criteria describe places, never who lives in an area`);
  if (!(CUSTOM_KEYS as readonly string[]).includes(key)) throw new Error(`set ${id}: tag '${key}' is not one of ${CUSTOM_KEYS.join(", ")}`);
  if (value === null || value === "*") return;
  const values = Array.isArray(value) ? value : [value];
  if (values.length < 1 || values.length > MAX_VALUES || !values.every((item) => typeof item === "string" && VALUE_RE.test(item))) {
    throw new Error(`set ${id}: invalid value for ${key}`);
  }
  const lowered = (values as string[]).map((item) => item.toLowerCase());
  if (lowered.some((item) => PEOPLE_VALUES[key]?.includes(item))
    || (key === "brand" && lowered.some((item) => PEOPLE_WORDS.some((word) => item.includes(word))))) {
    throw new Error(`${key}=${values[0]} is not accepted: criteria describe places, never who lives in an area`);
  }
}

/** Mirrors validate_custom in custom_criteria.py: absent means none. */
export function assertCustomPreferences(entries: unknown): asserts entries is CustomPreference[] | undefined {
  if (entries === undefined) return;
  if (!Array.isArray(entries) || entries.length > MAX_CUSTOM) throw new Error(`at most ${MAX_CUSTOM} custom criteria`);
  const seen = new Set<string>();
  for (const entry of entries as CustomPreference[]) {
    if (typeof entry !== "object" || entry === null || Object.keys(entry).some((key) => !["criterion", "weight", "direction", "must"].includes(key))) {
      throw new Error("a custom criterion entry has criterion, weight and direction");
    }
    assertCustomCriterion(entry.criterion);
    if (seen.has(entry.criterion.id)) throw new Error("duplicate custom criterion id");
    seen.add(entry.criterion.id);
    if (!Number.isInteger(entry.weight) || entry.weight < 1 || entry.weight > 5) throw new Error("custom criterion weight must be 1-5");
    if (entry.direction !== "higher" && entry.direction !== "lower") throw new Error("custom criterion direction must be higher or lower");
    if (entry.must !== undefined && typeof entry.must !== "boolean") throw new Error("custom criterion must is true or false");
  }
}

export interface CustomPreferenceFactor {
  factorId: CustomFactorId;
  weight: number;
  direction: PreferenceDirection;
  minimumUtility: null;
  maximumUtility: null;
}

/** Mirrors matching.custom_preferences. */
export function customPreferences(profile: PreferenceProfile): CustomPreferenceFactor[] {
  return (profile.custom ?? []).map((entry) => ({
    factorId: `custom:${entry.criterion.id}` as CustomFactorId, weight: entry.weight, direction: entry.direction,
    minimumUtility: null, maximumUtility: null,
  }));
}

export function isCustomLayerId(id: string): id is CustomLayerId {
  return /^custom:[a-z0-9-]{1,24}$/.test(id);
}

export function customLayerId(criterion: CustomCriterion): CustomLayerId {
  return `custom:${criterion.id}`;
}

/** Add or replace a criterion in the profile (weight 3 by default), keeping the others in order. */
export function withCustom(profile: PreferenceProfile, entry: CustomPreference): PreferenceProfile {
  const current = profile.custom ?? [];
  const index = current.findIndex((item) => item.criterion.id === entry.criterion.id);
  const custom = index >= 0 ? current.map((item, i) => (i === index ? entry : item)) : [...current, entry].slice(-MAX_CUSTOM);
  return { ...profile, custom };
}

export function withoutCustom(profile: PreferenceProfile, id: string): PreferenceProfile {
  const custom = (profile.custom ?? []).filter((item) => item.criterion.id !== id);
  const { custom: _previous, ...rest } = profile;
  return custom.length ? { ...rest, custom } : rest;
}

/** The pack's unit per formula (custom_criteria.UNITS). */
export const CUSTOM_UNITS: Record<CustomFormula, string> = {
  count: "places", density: "places per km²", per_resident: "places per 1,000 residents", balance: "balance (-1 to +1)", share: "share of A",
  variety: "kinds", nearest: "minutes",
};

const UNIT_WORDS: Record<CustomFormula, string> = {
  count: "places", density: "places per km²", per_resident: "per 1,000 residents", balance: "balance", share: "share", variety: "kinds",
  nearest: "min walk",
};

export function formatCustomValue(value: number | null, formula: CustomFormula): string {
  if (value === null) return "No places nearby";
  if (formula === "share") return `${Math.round(value * 100)}%`;
  if (formula === "balance") return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
  if (formula === "nearest") return `${Math.round(value)} min walk`;
  if (formula === "density") return `${value} per km²`;
  if (formula === "per_resident") return `${value} per 1,000 residents`;
  return `${Math.round(value)} ${UNIT_WORDS[formula]}`;
}

/** A set's label inside a sentence: "kebabs & Turkish grills" (first letter only, like the API's _set_word). */
function setWord(label: string): string {
  return label.slice(0, 1).toLowerCase() + label.slice(1);
}

/** "4 kebab shops, no cafés", "1 café": counts in words, a brand (Pret, Greggs) kept as written. */
export function describeCounts(counts: CustomAreaValue["counts"], criterion: CustomCriterion): string {
  return CUSTOM_SET_IDS.flatMap((id) => {
    const set = criterion.sets[id];
    const count = counts[id];
    return set && count !== undefined ? [countWords(Math.round(count), set)] : [];
  }).join(", ");
}

/**
 * An end tied beyond its list in one line: "312 areas have no gyms" rather than five rows of
 * look-alikes all at 0. Null while the rows tell it honestly (the tie fits the list, or no tie count).
 */
export function tiedEndWords(pack: CustomCriterionPack, end: "top" | "bottom", shown: number): string | null {
  const tied = pack.summary.tied?.[end] ?? 0;
  const first = pack.summary[end][0];
  if (!first || tied <= shown) return null;
  const areas = `${tied.toLocaleString("en-GB")} areas`;
  const { formula } = pack.criterion;
  const counts = describeCounts(first.counts, pack.criterion);
  return counts && formula !== "nearest" && formula !== "share"
    ? `${areas} have ${counts}`
    : `${areas} tie at ${formatCustomValue(first.value, formula)}`;
}

function countWords(count: number, set: CustomSet): string {
  const brand = set.any.some((matcher) => typeof matcher.brand === "string" && matcher.brand !== "*");
  const plural = brand ? set.label : setWord(set.label);
  if (count === 0) return `no ${plural}`;
  if (count === 1) return brand ? `1 ${plural}` : isList(plural) ? `1 place (${plural})` : `1 ${singular(plural)}`;
  return `${count.toLocaleString("en-GB")} ${plural}`;
}

/** A label naming several kinds ("bars, pubs and clubs", "kebabs & Turkish grills") has no singular. */
function isList(words: string): boolean {
  return /,| and | or | & /.test(words);
}

/** "cafés" → "café", "bakeries" → "bakery"; a list stays as it is. */
function singular(words: string): string {
  if (isList(words)) return words;
  if (/ies$/.test(words)) return words.replace(/ies$/, "y");
  if (/(ch|sh|ss|x)es$/.test(words)) return words.replace(/es$/, "");
  return /[^s]s$/.test(words) ? words.slice(0, -1) : words;
}

/** What the formula measures, in one line: places inside the area's boundary, except nearest (a distance). */
export function describeFormula(criterion: CustomCriterion): string {
  const a = setWord(criterion.sets.a.label);
  const b = criterion.sets.b ? setWord(criterion.sets.b.label) : "";
  switch (criterion.formula) {
    case "balance": return `More ${a} (+1) or more ${b} (−1) in the area`;
    case "share": return `Share of ${a} among ${a} and ${b} in the area`;
    case "variety": return `Different kinds among ${a} in the area`;
    case "nearest": return `Walking minutes to the nearest of ${a}`;
    case "density": return `Places per km² of the area`;
    case "per_resident": return `Places per 1,000 residents of the area`;
    default: return `Places in the area`;
  }
}

/** One matcher as OpenStreetMap tags: "amenity=cafe", "amenity=cafe + no brand", "cuisine=kebab". */
function matcherTags(matcher: CustomMatcher): string {
  return Object.entries(matcher).map(([key, value]) => {
    if (value === null) return `no ${key}`;
    if (value === "*") return `any ${key}`;
    return `${key}=${Array.isArray(value) ? value.join("/") : value}`;
  }).join(" + ");
}

/**
 * Where each set's places come from, as OpenStreetMap tags (the card's source line): "Kebabs & Turkish
 * grills: cuisine=kebab or cuisine=turkish · Cafés: amenity=cafe".
 */
export function describeTags(criterion: CustomCriterion): string {
  return CUSTOM_SET_IDS.flatMap((id) => {
    const set = criterion.sets[id];
    return set ? [`${set.label}: ${set.any.map(matcherTags).join(" or ")}`] : [];
  }).join(" · ");
}

/** What the criterion counts, in words (the legend "?"): "Counted from OpenStreetMap: gyms and sports centres". */
export function describeCounted(criterion: CustomCriterion): string {
  const sets = CUSTOM_SET_IDS.flatMap((id) => {
    const set = criterion.sets[id];
    return set ? [endWord(set)] : [];
  });
  return `Counted from OpenStreetMap: ${sets.join(", ")}`;
}

/** A set inside a heading: "kebabs & Turkish grills" (first letter only), a brand as written ("Greggs"). */
function endWord(set: CustomSet): string {
  return set.any.some((matcher) => typeof matcher.brand === "string" && matcher.brand !== "*") ? set.label : setWord(set.label);
}

/** What the two ends of the ranking mean for this measure ("Most kebabs & Turkish grills", "Fewest"). */
export function lensEnds(criterion: CustomCriterion): [string, string] {
  const a = endWord(criterion.sets.a);
  const b = criterion.sets.b ? endWord(criterion.sets.b) : "";
  switch (criterion.formula) {
    case "balance": return [`Most ${a}`, `Most ${b}`];
    case "share": return [`Highest share of ${a}`, `Lowest share of ${a}`];
    case "nearest": return ["Closest", "Furthest"];
    case "variety": return ["Most variety", "Least variety"];
    default: return ["Most", "Fewest"];
  }
}

// ---- Map layer -------------------------------------------------------------------------------

/** The ramp a criterion paints in: an Explore chip's own yarn, else the API's default (cobalt). */
export function customRamp(criterion: CustomCriterion): readonly string[] {
  return yarnRamp(exploreChipYarn(criterion.id));
}

/** The pack with its legend in the criterion's ramp (the panel's key, the map and the layer pill all read it). */
export function customPackInYarn(criterion: CustomCriterion, pack: CustomCriterionPack): CustomCriterionPack {
  const pair = criterion.formula === "balance" || criterion.formula === "share";
  return pair ? pack : { ...pack, legend: readableCustomLegend(yarnLegend(pack.legend, customRamp(criterion)), criterion.formula) };
}

const CUSTOM_STOP = new Intl.NumberFormat("en-GB", { notation: "compact", maximumSignificantDigits: 2 });
const CUSTOM_STOP_UNITS: Partial<Record<CustomFormula, string>> = { density: " per km²", per_resident: " per 1,000" };

/** One stop of a criterion's ramp in a few characters: "0", "0.85", "12", "8 min", "40%". */
function customStopText(value: number, formula: CustomFormula): string {
  if (formula === "share") return `${Math.round(value * 100)}%`;
  if (formula === "nearest") return `${Math.round(value)} min`;
  if (formula === "count" || formula === "variety") return String(Math.round(value));
  // A median of 0 is nudged to 0.001 to keep the stops increasing (custom_criteria.legend): it reads as 0.
  return CUSTOM_STOP.format(Math.abs(value) < 0.005 ? 0 : value);
}

/**
 * The ramp's labels made readable: the API's "0 · 0.001 · 0.85+" (a nudged median of 0, no unit) reads "0 · 0.85+
 * per km²". Only the stops the API labelled keep a label; a middle that reads like the lowest is dropped; the top
 * keeps its "+" and gains the unit. Balance and share keep their words ("more cafés").
 */
export function readableCustomLegend(stops: readonly LegendStop[], formula: CustomFormula): LegendStop[] {
  if (formula === "balance" || formula === "share" || stops.length < 2) return stops.map((stop) => ({ ...stop }));
  const last = stops.length - 1;
  const first = customStopText(stops[0].value, formula);
  return stops.map((stop, index) => {
    if (!stop.label) return { ...stop };
    if (index === 0) return { ...stop, label: first };
    const text = customStopText(stop.value, formula);
    if (index === last) return { ...stop, label: `${text}${stop.label.includes("+") ? "+" : ""}${CUSTOM_STOP_UNITS[formula] ?? ""}` };
    return { ...stop, label: text === first ? "" : text };
  });
}

/** The criterion as a map layer: the pack's own legend (diverging for balance and share), in the chip's yarn. */
export function customMapDefinition(criterion: CustomCriterion, pack: CustomCriterionPack | null): MapDefinition {
  const square = pack?.bivariate ?? null;
  const source = pack?.sources[0];
  const pair = criterion.formula === "balance" || criterion.formula === "share";
  const ramp = pair ? CUSTOM_DIVERGING : customRamp(criterion);
  const fallback = [{ value: 0, colour: ramp[0], label: "" }, { value: 1, colour: ramp[ramp.length - 1], label: "" }];
  const legend = square ? bivariateStops(square) : pair ? pack?.legend ?? fallback
    : readableCustomLegend(yarnLegend(pack?.legend ?? fallback, ramp), criterion.formula);
  return {
    id: customLayerId(criterion),
    label: criterion.label,
    shortLabel: criterion.label,
    description: `${describeFormula(criterion)}. ${PLACES_NOT_PEOPLE}`,
    carrier: "lsoa",
    unit: pack?.unit ?? "",
    direction: "neutral",
    periods: ["2026-09"],
    defaultPeriod: "2026-09",
    legend,
    bivariate: square,
    provenance: {
      sourceId: "osm-places",
      sourceName: source?.name ?? "OpenStreetMap (Geofabrik England extract)",
      sourceUrl: source?.url ?? "https://www.openstreetmap.org/copyright",
      release: pack?.sourceReleaseId ?? "",
      checksum: "",
      licence: source?.licence ?? "ODbL-1.0",
      attribution: source?.attribution ?? "© OpenStreetMap contributors",
      transformationVersion: "custom-criterion-v1",
    },
    freshness: "Calculated on request",
    methodologyPath: metricGuidePath("personal-match"),
    caveats: pack?.caveats ?? [PLACES_NOT_PEOPLE],
  };
}

/** The pack as the map's value pack (the same seam My match uses). */
export function customValuePack(pack: CustomCriterionPack): ValuePack {
  const square = pack.bivariate ?? null;
  return {
    schemaVersion: "area-value-pack.v1",
    metricId: "price-per-square-metre",
    period: "2026-09",
    sourceVersion: pack.sourceReleaseId,
    values: (pack.values ?? []).map((entry) => ({
      geographyId: entry.geographyId,
      name: "",
      metricId: "price-per-square-metre",
      period: "2026-09",
      value: square ? entry.cell ?? bivariateCell(entry.counts, square) : entry.value,
      regionPercentile: entry.percentile,
      countryPercentile: null,
      sampleCount: null,
      quality: "observed",
      sourceVersion: pack.sourceReleaseId,
      carrier: pack.level ?? "lsoa",
    })),
  };
}

// ---- Client ----------------------------------------------------------------------------------

const packs = new Map<string, Promise<CustomCriterionPack | null>>();

/** A key-order-free JSON form, so a criterion read back from a profile still matches its preset. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The ready-made criterion this one is exactly (Gyms, Cafés …), or null for a household's own. */
export function presetIdOf(criterion: CustomCriterion): string | null {
  const own = canonical(criterion);
  return CUSTOM_PRESETS.find((preset) => preset.criterion.id === criterion.id && canonical(preset.criterion) === own)?.criterion.id ?? null;
}

/**
 * A criterion's pack, one request per definition. A ready-made one is the same for everyone: a cacheable GET
 * (/api/v1/custom-criteria/presets/<id>/pack, built once per release on the server). A household's own is private:
 * POST /api/v1/custom-criteria/evaluate, never in a URL.
 */
export function evaluateCustomCriterion(criterion: CustomCriterion, level?: "msoa"): Promise<CustomCriterionPack | null> {
  const body = JSON.stringify({ criterion });
  const key = level ? `${body}|${level}` : body;
  if (!packs.has(key)) {
    const preset = presetIdOf(criterion);
    // Rolled up (the map zoomed out): only a ready-made criterion has one; a household's own paints its LSOAs.
    if (level && !preset) return Promise.resolve(null);
    const query = level ? `?level=${level}` : "";
    const request = preset
      ? mapFetch(`/api/v1/custom-criteria/presets/${encodeURIComponent(preset)}/pack${query}`, { headers: { accept: "application/json" } })
      : fetch("/api/v1/custom-criteria/evaluate", {
        method: "POST", body, headers: { accept: "application/json", "content-type": "application/json" },
      });
    packs.set(key, request.then(async (response) => (response.ok ? customPackInYarn(criterion, (await response.json()) as CustomCriterionPack) : null)).catch(() => null));
    if (packs.size > 12) packs.delete(packs.keys().next().value!);
  }
  return packs.get(key)!;
}

/** The map's zoomed-out pack for a criterion (its MSOAs) and their hover lines; null for a household's own. */
export async function customRollup(criterion: CustomCriterion): Promise<CustomRollup | null> {
  const pack = await evaluateCustomCriterion(criterion, "msoa");
  return pack?.level === "msoa" ? { pack: customValuePack(pack), tooltip: customTooltip(pack) } : null;
}

export interface CustomRollup {
  pack: ValuePack;
  tooltip: (geographyId: string) => string[];
}

// ---- Preview (no evidence service) -------------------------------------------------------------

// Fixed demo counts for the three preview areas (lib/matching.ts AREAS), per set: never real places.
const PREVIEW_IDS: GeographyId[] = ["uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003"];
const PREVIEW_COUNTS: Record<CustomSetId, number[]> = { a: [12, 3, 7], b: [40, 9, 22], c: [5, 1, 2] };
const PREVIEW_KINDS = [24, 6, 13];
const PREVIEW_NEAREST_MINUTES = [4, 14, 8];
const PREVIEW_KM2 = 0.25; // a typical London LSOA
const PREVIEW_RESIDENTS = 1600; // likewise

function previewValue(criterion: CustomCriterion, index: number): CustomAreaValue {
  const counts: CustomAreaValue["counts"] = {};
  for (const id of CUSTOM_SET_IDS) if (criterion.sets[id]) counts[id] = PREVIEW_COUNTS[id][index];
  const a = counts.a ?? 0;
  const b = counts.b ?? 0;
  const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
  const value = {
    count: total, density: Math.round(total / PREVIEW_KM2 * 10) / 10, per_resident: Math.round(total / PREVIEW_RESIDENTS * 100000) / 100,
    balance: Math.round((a - b) / (a + b + BALANCE_PRIOR) * 1000) / 1000,
    share: a + b ? Math.round(a / (a + b) * 1000) / 1000 : null, variety: PREVIEW_KINDS[index],
    nearest: PREVIEW_NEAREST_MINUTES[index],
  }[criterion.formula];
  return { geographyId: PREVIEW_IDS[index], value, percentile: null, counts };
}

/** Mid-rank London percentile of "more of it" (custom_criteria.percentiles). */
export function customPercentiles(values: (number | null)[], formula: CustomFormula): (number | null)[] {
  const present = values.filter((value): value is number => value !== null);
  return values.map((value) => {
    if (value === null) return null;
    const below = present.filter((other) => other < value).length;
    const equal = present.filter((other) => other === value).length;
    const percentile = Math.round((below + equal / 2) / present.length * 100);
    return formula === "nearest" ? 100 - percentile : percentile;
  });
}

/** Demo values for the preview areas, so the preview match and map work without the API. */
export function previewCustomValues(criterion: CustomCriterion): CustomAreaValue[] {
  const values = PREVIEW_IDS.map((_, index) => previewValue(criterion, index));
  const ranks = customPercentiles(values.map((entry) => entry.value), criterion.formula);
  return values.map((entry, index) => ({ ...entry, percentile: ranks[index] }));
}

export function previewCustomPack(criterion: CustomCriterion): CustomCriterionPack {
  const values = previewCustomValues(criterion);
  const ordered = [...values].filter((entry) => entry.value !== null).sort((x, y) => (y.percentile ?? 0) - (x.percentile ?? 0));
  const names = ["Westminster preview", "North London preview", "South Bank preview"];
  const named = (entry: CustomAreaValue) => ({ ...entry, name: names[PREVIEW_IDS.indexOf(entry.geographyId)], title: null });
  const pair = criterion.formula === "balance" || criterion.formula === "share";
  const low = criterion.formula === "balance" ? -1 : 0;
  return {
    schemaVersion: "custom-criterion-pack.v1", productReleaseId: "preview", sourceReleaseId: "preview-osm-2026-09",
    criterion, unit: CUSTOM_UNITS[criterion.formula],
    legend: pair
      ? [{ value: low, colour: CUSTOM_DIVERGING[0], label: `more ${setWord(criterion.sets.b?.label ?? "")}` },
        { value: 1, colour: CUSTOM_DIVERGING[CUSTOM_DIVERGING.length - 1], label: `more ${setWord(criterion.sets.a.label)}` }]
      // Every step of the ramp, as the API sends, so the map passes through the yarn rather than straight to its end.
      : CUSTOM_SEQUENTIAL.map((colour, step) => ({ value: step * 12.5, colour, label: step === 0 ? "0" : step === 4 ? "50" : "" })),
    summary: { areas: ordered.length, regionMedian: null, top: ordered.map(named), bottom: [...ordered].reverse().map(named) },
    sources: [], caveats: ["Preview: fixed demo counts, not real places.", PLACES_NOT_PEOPLE], values,
  };
}
