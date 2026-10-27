/**
 * Area guide pages (/area/england, /area/london, /area/lad/…, /area/msoa/…) and London
 * rankings (/rankings/*): the borough → MSOA → LSOA tree, figures rolled up
 * from the same value packs the map paints, a generated FAQ and its JSON-LD.
 * Pure: the server loader (area-pages-data.ts) fetches, this file decides.
 * Missing data is null ("unknown"), never zero.
 */
import { areaDisplayName, type FriendlyAreaFields } from "./area-labels";
import type { AreaProfileResponse, Carrier, GeographyId, ValuePackEntry } from "./contracts";
import { presetBySlug } from "./custom-presets";
import { formatPounds } from "./evidence-format";
import type { HelpId } from "./help-texts";
import type { DataMode } from "./map-state";
import { formatMoney } from "./money-format";
import { schoolPath } from "./school-card";
import { LONDON_REGION, REGIONS, regionSlug, scopeName, type RankScope } from "./scope-name";
import { DEFAULT_SCHOOL_FILTER, schoolFilterText, type SchoolFilter } from "./school-filter";
import { sortByTopic, type TopicId } from "./topic-order";
import { isTypicalPriceLayer } from "./typical-price";

/** The root of one loaded region (area-pages-data.ts loads a region at a time): London for the London one. */
export const LONDON = "london";
export type PageAreaId = GeographyId | typeof LONDON;

export const PAGE_METRIC_IDS = [
  "price-per-square-metre", "crime", "deprivation", "income", "social-renting", "station-access", "food-hygiene",
  "typical-price-flat", "typical-price-terraced", "typical-price-semi", "typical-price-detached",
] as const;
export type PageMetricId = (typeof PAGE_METRIC_IDS)[number];

/** Published per neighbourhood (LSOA) only: a bigger area's figure is the middle of its neighbourhoods'. */
const NEIGHBOURHOOD_METRICS: readonly PageMetricId[] = [
  "price-per-square-metre", "social-renting", "station-access", "food-hygiene",
  "typical-price-flat", "typical-price-terraced", "typical-price-semi", "typical-price-detached",
];

export interface HierarchyArea extends FriendlyAreaFields {
  geographyId: GeographyId;
  name: string;
  carrier: Carrier;
  parentId: GeographyId | null;
  /** ONS region code (E12000007 London); absent from older APIs (London). */
  regionCode?: string | null;
  /** State schools inside the boundary; null for LSOAs and when schools are not loaded. */
  schools: { primary: number; secondary: number } | null;
}

export interface AreaHierarchyResponse {
  schemaVersion: "area-hierarchy.v1";
  productReleaseId?: string;
  /** With ?region=: the region kept. */
  region?: RankScope;
  areas: HierarchyArea[];
}

/** The custom presets ranked by area (api custom_criteria.LENS_PRESETS), each rolled up per MSOA and borough at release time. */
export const LENS_PRESETS = [
  "gyms", "nightlife", "late-night-food", "culture", "food-variety", "good-coffee", "markets",
  "family", "dog-friendly", "coworking", "universities", "cycling", "ev-charging",
] as const;
export type LensPreset = (typeof LENS_PRESETS)[number];

/** Where a lens pack's places come from, as the API cites them. */
export interface LensSource {
  name: string;
  licence: string;
  attribution: string;
  url: string;
}

/** One lens, already rolled up to each carrier (an area under the minimum count, or the City among boroughs, is null). */
export interface LensPack {
  msoa: ValuePackEntry[];
  borough: ValuePackEntry[];
  sources: LensSource[];
}

export interface AreaPagesData {
  mode: DataMode;
  /** The region these areas are in (root = LONDON key); absent = London. */
  scope?: RankScope;
  areas: HierarchyArea[];
  /** Each metric at its own carrier and latest month (LSOA, income MSOA). */
  values: Partial<Record<PageMetricId, ValuePackEntry[]>>;
  /** Crime per 1,000 residents published for whole MSOAs and boroughs. */
  crime: { msoa: ValuePackEntry[]; borough: ValuePackEntry[] };
  periods: Partial<Record<PageMetricId, string>>;
  /** Ranking lenses with at least one value; a lens left out has no pages. */
  lens?: Partial<Record<LensPreset, LensPack>>;
  /** School rankings by slug, as /api/v1/school-rankings serves them; one left out has no page. */
  schoolRankings?: Partial<Record<string, SchoolRankingResponse>>;
  /** Some lens pack could not be fetched (a timeout while the API builds it): cache this briefly. */
  incomplete?: boolean;
}

export interface AreaIndex {
  data: AreaPagesData;
  byId: Map<GeographyId, HierarchyArea>;
  children: Map<PageAreaId, HierarchyArea[]>;
  values: Record<PageMetricId, Map<GeographyId, ValuePackEntry>>;
  /** Each lens's MSOA and borough figures, keyed by area (known values only). */
  lenses: Record<LensPreset, Map<GeographyId, ValuePackEntry>>;
}

/**
 * One collator for every name sort: localeCompare with a locale builds a collator on each call, and sorting a
 * region's ~35,000 areas that way took ~300 ms of every borough and MSOA page (profiled).
 */
export const NAME_ORDER = new Intl.Collator("en-GB", { numeric: true });
const PLAIN_NAME_ORDER = new Intl.Collator("en-GB");
const byName = (a: HierarchyArea, b: HierarchyArea) => NAME_ORDER.compare(a.name, b.name);

export function buildIndex(data: AreaPagesData): AreaIndex {
  const byId = new Map(data.areas.map((area) => [area.geographyId, area]));
  const children = new Map<PageAreaId, HierarchyArea[]>();
  for (const area of data.areas) {
    const parent: PageAreaId | null = area.carrier === "lad" ? LONDON : area.parentId;
    if (!parent) continue;
    const list = children.get(parent);
    if (list) list.push(area);
    else children.set(parent, [area]);
  }
  for (const list of children.values()) list.sort(byName);
  const values = Object.fromEntries(PAGE_METRIC_IDS.map((metric) => {
    const entries = [...(data.values[metric] ?? []), ...(metric === "crime" ? [...data.crime.msoa, ...data.crime.borough] : [])];
    return [metric, new Map(entries.filter((entry) => entry.value !== null).map((entry) => [entry.geographyId, entry]))];
  })) as AreaIndex["values"];
  const lenses = Object.fromEntries(LENS_PRESETS.map((preset) => {
    const pack = data.lens?.[preset];
    const entries = pack ? [...pack.msoa, ...pack.borough] : [];
    return [preset, new Map(entries.filter((entry) => entry.value !== null).map((entry) => [entry.geographyId, entry]))];
  })) as AreaIndex["lenses"];
  return { data, byId, children, values, lenses };
}

export function childrenOf(index: AreaIndex, id: PageAreaId): HierarchyArea[] {
  return index.children.get(id) ?? [];
}

/** Every area of one carrier inside `id` (London: all of them). */
export function descendants(index: AreaIndex, id: PageAreaId, carrier: Carrier): HierarchyArea[] {
  const out: HierarchyArea[] = [];
  const walk = (parent: PageAreaId) => {
    for (const child of childrenOf(index, parent)) {
      if (child.carrier === carrier) out.push(child);
      else walk(child.geographyId);
    }
  };
  walk(id);
  return out;
}

/** London › borough › MSOA, root first, ending with the area itself. */
export function breadcrumb(index: AreaIndex, id: GeographyId): HierarchyArea[] {
  const trail: HierarchyArea[] = [];
  for (let area = index.byId.get(id); area; area = area.parentId ? index.byId.get(area.parentId) : undefined) trail.unshift(area);
  return trail;
}

/** The loaded region's name: "London", "North West", … */
export function indexScopeName(index: AreaIndex): string {
  return scopeName(index.data.scope);
}

/** /area/england: each region with boroughs (any English local authority), in ONS order; a region without any is left out. */
export function englandRegions(boroughs: readonly HierarchyArea[]): { region: RankScope; slug: string; boroughs: HierarchyArea[] }[] {
  return REGIONS.flatMap((region) => {
    const inside = boroughs.filter((borough) => (borough.regionCode ?? LONDON_REGION) === region.code).sort(byName);
    return inside.length > 0 ? [{ region, slug: regionSlug(region), boroughs: inside }] : [];
  });
}

/** The region root's page: /area/london, else the region's list on /area/england. */
export function regionPath(scope: RankScope | null | undefined): string {
  return !scope || scope.code === LONDON_REGION ? "/area/london" : `/area/england#${regionSlug(scope)}`;
}

export function areaPath(area: { geographyId: GeographyId } | typeof LONDON): string {
  if (area === LONDON) return "/area/london";
  const [, carrier, code] = area.geographyId.split(":");
  return `/area/${carrier}/${code}`;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** "own": published for this very area; "middle": the middle of its smaller areas' figures; "pooled": all crimes ÷ all residents. */
export type FigureBasis = "own" | "middle" | "pooled";

export interface Figure {
  value: number;
  basis: FigureBasis;
  /** How many smaller areas a "middle" figure rests on. */
  count: number;
  period: string | null;
}

export interface DeprivationFigure {
  /** Share (0–1) of the area's neighbourhoods among England's most deprived fifth (deciles 1–2). */
  mostDeprived: number;
  /** Share among England's least deprived fifth (deciles 9–10). */
  leastDeprived: number;
  /** Average decile of its neighbourhoods: 1 = most deprived tenth of England, 10 = least. */
  meanDecile: number;
  count: number;
  period: string | null;
}

export interface AreaFacts {
  id: PageAreaId;
  name: string;
  level: "region" | Carrier;
  neighbourhoods: number;
  price: Figure | null;
  crime: Figure | null;
  income: Figure | null;
  socialRenting: Figure | null;
  deprivation: DeprivationFigure | null;
  schools: { primary: number; secondary: number } | null;
  /** Share (0–1) of homes at 55 dB or more from road or rail; only from the area's own profile. */
  noise: number | null;
}

function middleOf(index: AreaIndex, metric: PageMetricId, areas: HierarchyArea[]): Figure | null {
  const values = areas.flatMap((area) => {
    const value = index.values[metric].get(area.geographyId)?.value;
    return value == null ? [] : [value];
  });
  const value = median(values);
  return value === null ? null : { value, basis: "middle", count: values.length, period: index.data.periods[metric] ?? null };
}

function ownFigure(entry: { value: number | null; period: string } | undefined): Figure | null {
  return entry && entry.value !== null ? { value: entry.value, basis: "own", count: 1, period: entry.period } : null;
}

/** London's crime rate: every borough's crimes over every borough's residents (crimes ÷ rate). */
export function pooledCrime(boroughs: ValuePackEntry[]): Figure | null {
  const usable = boroughs.filter((entry) => entry.value !== null && entry.value > 0 && (entry.sampleCount ?? 0) > 0);
  if (usable.length === 0 || usable.length !== boroughs.length) return null;
  const crimes = usable.reduce((sum, entry) => sum + (entry.sampleCount as number), 0);
  const residents = usable.reduce((sum, entry) => sum + (entry.sampleCount as number) / (entry.value as number) * 1000, 0);
  return { value: crimes / residents * 1000, basis: "pooled", count: usable.length, period: usable[0].period };
}

function deprivationOf(index: AreaIndex, lsoas: HierarchyArea[]): DeprivationFigure | null {
  const deciles = lsoas.flatMap((area) => {
    const value = index.values.deprivation.get(area.geographyId)?.value;
    return value == null ? [] : [value];
  });
  if (deciles.length === 0) return null;
  return {
    mostDeprived: deciles.filter((decile) => decile <= 2).length / deciles.length,
    leastDeprived: deciles.filter((decile) => decile >= 9).length / deciles.length,
    meanDecile: deciles.reduce((sum, decile) => sum + decile, 0) / deciles.length,
    count: deciles.length,
    period: index.data.periods.deprivation ?? null,
  };
}

/**
 * One area's page figures. Crime and income come from the area's own
 * published figure when there is one (the area profile first); price,
 * social renting and anything without its own figure is the middle value of
 * the smaller areas inside it.
 */
export function areaFacts(index: AreaIndex, id: PageAreaId, profile: AreaProfileResponse | null = null): AreaFacts | null {
  // The region's own facts (every page compares with them) walk all its areas: once per loaded region.
  if (id === LONDON && !profile) {
    if (!regionFacts.has(index)) regionFacts.set(index, computeAreaFacts(index, id, null));
    return regionFacts.get(index) ?? null;
  }
  return computeAreaFacts(index, id, profile);
}

const regionFacts = new WeakMap<AreaIndex, AreaFacts | null>();

function computeAreaFacts(index: AreaIndex, id: PageAreaId, profile: AreaProfileResponse | null): AreaFacts | null {
  const area = id === LONDON ? null : index.byId.get(id);
  if (id !== LONDON && !area) return null;
  const lsoas = area?.carrier === "lsoa" ? [area] : descendants(index, id, "lsoa");
  const msoas = area?.carrier === "msoa" ? [area] : descendants(index, id, "msoa");
  const own = (metric: PageMetricId) => ownFigure(
    profile?.metrics.find((entry) => entry.metricId === metric && entry.geographyId === id)
    ?? (id === LONDON ? undefined : index.values[metric].get(id)));
  const boroughs = childrenOf(index, LONDON);
  const londonCrime = pooledCrime(boroughs.flatMap((borough) => {
    const entry = index.values.crime.get(borough.geographyId);
    return entry ? [entry] : [];
  })) ?? middleOf(index, "crime", boroughs);
  const schoolAreas = area ? [area] : boroughs;
  const schools = schoolAreas.length > 0 && schoolAreas.every((candidate) => candidate.schools)
    ? schoolAreas.reduce((sum, candidate) => ({
      primary: sum.primary + (candidate.schools?.primary ?? 0), secondary: sum.secondary + (candidate.schools?.secondary ?? 0),
    }), { primary: 0, secondary: 0 })
    : null;
  return {
    id,
    name: area ? areaDisplayName(area) ?? area.name : indexScopeName(index),
    level: area?.carrier ?? "region",
    neighbourhoods: lsoas.length,
    price: own("price-per-square-metre") ?? middleOf(index, "price-per-square-metre", lsoas),
    crime: own("crime") ?? (id === LONDON ? londonCrime : middleOf(index, "crime", lsoas)),
    income: own("income") ?? middleOf(index, "income", msoas),
    socialRenting: own("social-renting") ?? middleOf(index, "social-renting", lsoas),
    deprivation: deprivationOf(index, lsoas),
    schools,
    noise: profile?.geographyId === id && profile.noise?.available ? profile.noise.any55Share : null,
  };
}

/** Typical price for a list entry: a neighbourhood's own figure, otherwise the middle of its neighbourhoods. */
export function listPrice(index: AreaIndex, area: HierarchyArea): { value: number; wider: boolean } | null {
  if (area.carrier === "lsoa") {
    const entry = index.values["price-per-square-metre"].get(area.geographyId);
    return entry?.value == null ? null : { value: entry.value, wider: entry.quality === "fallback" };
  }
  const figure = middleOf(index, "price-per-square-metre", descendants(index, area.geographyId, "lsoa"));
  return figure ? { value: figure.value, wider: false } : null;
}

/**
 * "181 · 179 with a price": a borough's neighbourhoods and how many have their own £/m², counted over
 * the neighbourhoods themselves (never the borough's own figure, which counts as one); "181" when all do.
 */
export function neighbourhoodsWithPrice(index: AreaIndex, lsoas: readonly { geographyId: GeographyId }[]): string {
  const priced = lsoas.filter((area) => index.values["price-per-square-metre"].get(area.geographyId)?.value != null).length;
  const all = lsoas.length.toLocaleString("en-GB");
  return priced === lsoas.length ? all : `${all} · ${priced.toLocaleString("en-GB")} with a price`;
}

// ---------------------------------------------------------------- wording

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(period: string | null): string {
  if (!period) return "the latest month";
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

export function formatPerSquareMetre(value: number): string {
  return `${formatPounds(Math.round(value / 10) * 10)} per m²`;
}

export function formatCrimeRate(value: number): string {
  return value >= 100 ? Math.round(value).toLocaleString("en-GB") : value.toFixed(1);
}

export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A home of `squareMetres` at the typical price, rounded to the nearest £5,000. */
export function roughHomePrice(pricePerSquareMetre: number, squareMetres = 70): string {
  return formatPounds(Math.round(pricePerSquareMetre * squareMetres / 5000) * 5000);
}

/** "1 neighbourhood", "2 neighbourhoods", "0 neighbourhoods": a count with its noun. */
export function countOf(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
}

/** A ranking's reach: "All 33 boroughs", "Top 50 of 983 areas (MSOAs)", "Top 1 of 1 area (MSOA)". */
export function rankingScope(level: RankingLevel, shown: number, ranked: number): string {
  if (level === "lad") return ranked > 1 ? `All ${countOf(ranked, "borough")}` : countOf(ranked, "borough");
  return `Top ${shown.toLocaleString("en-GB")} of ${countOf(ranked, "area (MSOA)", "areas (MSOAs)")}`;
}

export function basisNote(figure: Figure | null, unitName = "smaller area"): string {
  if (!figure) return "";
  if (figure.basis === "middle") return `middle of ${countOf(figure.count, unitName)}`;
  if (figure.basis === "pooled") return figure.count === 1 ? "1 borough" : `all ${countOf(figure.count, "borough")} together`;
  return "";
}

function comparison(value: number, london: number): string {
  const ratio = value / london;
  if (ratio > 1.1) return "higher than";
  if (ratio < 0.9) return "lower than";
  return "about the same as";
}

export interface FaqItem {
  id: "safety" | "price" | "schools" | "deprivation";
  question: string;
  answer: string;
}

/** Four plain questions answered from the page's own figures; unknown stays unknown. */
export function buildFaq(facts: AreaFacts, london: AreaFacts | null): FaqItem[] {
  const name = facts.name;
  const isLondon = facts.id === LONDON;
  const vsLondon = (value: number, londonValue: number | undefined, format: (value: number) => string) =>
    !isLondon && londonValue !== undefined ? `, ${comparison(value, londonValue)} ${london?.name ?? "London"} as a whole (${format(londonValue)})` : "";
  const unknown = (what: string) => `We don't have ${what} for ${name} yet.`;

  const crime = facts.crime;
  const safety = crime
    ? `Police recorded about ${formatCrimeRate(crime.value)} crimes for every 1,000 residents in the 12 months to ${monthLabel(crime.period)}`
      + `${vsLondon(crime.value, london?.crime?.value, formatCrimeRate)}. `
      + "Figures run high in busy centres where few people live, and they can't tell you how one street feels, so visit at different times of day."
    : unknown("recorded crime figures");

  const price = facts.price;
  const priceAnswer = price
    ? `Homes sold for a typical ${formatPerSquareMetre(price.value)} in the year to ${monthLabel(price.period)}`
      + `${vsLondon(price.value, london?.price?.value, formatPerSquareMetre)}. `
      + `At that rate a 70 m² two-bedroom flat would cost roughly ${roughHomePrice(price.value)}. This is a rough guide, not a valuation.`
    : unknown("enough recorded sales");

  const schools = facts.schools;
  const schoolsAnswer = schools
    ? `There are ${schools.primary} state primary and ${schools.secondary} state secondary schools inside ${isLondon ? (name === "London" ? "Greater London" : name) : `${name}'s boundary`}. `
      + "Living nearby doesn't guarantee a place, so check each school's admissions rules."
    : unknown("school counts");

  const deprivation = facts.deprivation;
  const deprivationAnswer = deprivation
    ? deprivation.count === 1
      ? deprivation.mostDeprived === 1
        ? `${name} is among the most deprived fifth of neighbourhoods in England on the official Index of Multiple Deprivation.`
        : deprivation.leastDeprived === 1
          ? `${name} is among the least deprived fifth of neighbourhoods in England on the official Index of Multiple Deprivation.`
          : `${name} sits in the middle range of neighbourhoods in England on the official Index of Multiple Deprivation.`
      : `${formatPercent(deprivation.mostDeprived)} of ${name}'s ${deprivation.count} neighbourhoods are among the most deprived fifth in England, `
        + `and ${formatPercent(deprivation.leastDeprived)} among the least deprived fifth, on the official Index of Multiple Deprivation. `
        + "It combines income, jobs, health, education, crime, housing and living environment."
    : unknown("deprivation figures");

  return [
    { id: "safety", question: `Is ${name} safe?`, answer: safety },
    { id: "price", question: `How much do homes cost in ${name}?`, answer: priceAnswer },
    { id: "schools", question: `How many schools are there in ${name}?`, answer: schoolsAnswer },
    { id: "deprivation", question: `Is ${name} a deprived area?`, answer: deprivationAnswer },
  ];
}

/** schema.org FAQPage, serialised safely for a <script type="application/ld+json">. */
export function faqJsonLd(items: FaqItem[]): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  }).replace(/</g, "\\u003c");
}

// ---------------------------------------------------------------- rankings

/**
 * The /rankings index sections, in page order; a group with no rankings yet is left out.
 * Deprivation (owner decision), household income and social renting rank under
 * Homes & area, their group on the map; the Census stays descriptive only, never ranked.
 * Boroughs side by side are one sortable table on /area/london (BOROUGH_COLUMNS), not rankings.
 */
const RANKING_GROUP_LIST = ["Cost", "Safety", "Schools", "Getting around", "Going out", "Everyday life", "Homes & area"] as const;
export type RankingGroup = (typeof RANKING_GROUP_LIST)[number];

const RANKING_TOPIC: Record<RankingGroup, TopicId> = {
  Cost: "price", Safety: "safety", Schools: "schools", "Getting around": "getting-around",
  "Going out": "local-places", "Everyday life": "local-places", "Homes & area": "homes",
};

/** The rankings index's groups in the one topic order (lib/topic-order.ts). */
export const RANKING_GROUPS: readonly RankingGroup[] = sortByTopic(RANKING_GROUP_LIST, (group) => RANKING_TOPIC[group]);
export type RankingLevel = "msoa" | "lad";

interface RankingBase {
  slug: string;
  title: string;
  lead: string;
  group: RankingGroup;
  order: "desc" | "asc";
  help: HelpId;
  column: string;
}

/** Areas ranked by a page metric's own values (the only kind with pages today). */
export interface MetricRanking extends RankingBase {
  kind: "metric";
  level: RankingLevel;
  metric: PageMetricId;
}

/** Areas ranked by a custom preset's places, rolled up per carrier at release time. */
export interface LensRanking extends RankingBase {
  kind: "lens";
  level: RankingLevel;
  preset: LensPreset;
}

/** The axes /api/v1/school-rankings serves (KS2 and EBacc are not loaded, so they have none). */
export type SchoolAxis = "grade5-english-maths" | "attainment-8" | "progress-8" | "legacy-outstanding" | "report-card-exceptional";

/** Schools ranked on one axis of their published results. */
export interface SchoolRanking extends RankingBase {
  kind: "school";
  phase: "primary" | "secondary";
  axis: SchoolAxis;
}

/** One phase's schools on one axis (api schools.py school_ranking). */
export interface SchoolRankingResponse {
  schemaVersion: "school-ranking.v1";
  axis: SchoolAxis;
  phase: "primary" | "secondary";
  measure: string;
  /** The KS4 year shown; null for the inspection lists, whose rows carry their own. */
  year: string | null;
  minCohort: number | null;
  /** Schools that qualify, of which `rows` holds at most 100. */
  eligibleSchools: number;
  /** Report cards only: schools of the phase inspected under them so far. */
  inspectedSchools?: number;
  rows: { urn: string; name: string; borough: string | null; value: number | string; cohort: number | null; year: string | null }[];
  caveats: string[];
  attribution: string;
}

/** Areas ranked by how many schools of a phase they hold. */
export interface CountRanking extends RankingBase {
  kind: "count";
  level: RankingLevel;
  phase: "primary" | "secondary";
}

export type RankingDefinition = MetricRanking | LensRanking | SchoolRanking | CountRanking;
/** The kinds that rank areas through buildRanking. */
export type AreaRanking = MetricRanking | LensRanking | CountRanking;
/** What an area's figure is made from: a page metric, a lens's places or a phase's schools. */
export type AreaFigure = Pick<MetricRanking, "kind" | "metric"> | Pick<LensRanking, "kind" | "preset"> | Pick<CountRanking, "kind" | "phase">;

/**
 * How each lens's figure is made. density: places inside the boundary per km² of land; variety: kinds
 * of cuisine across the area, each counted once; nearest: the middle of its neighbourhoods' walks.
 * `places` names what is counted, in the figure's words; `counts` says which places count.
 */
export const LENSES: Record<LensPreset, { formula: "density" | "variety" | "nearest"; places: string; counts: string }> = {
  gyms: { formula: "density", places: "gyms and sports centres", counts: "gyms, fitness studios and sports centres" },
  nightlife: { formula: "density", places: "bars, pubs and clubs", counts: "bars, pubs and nightclubs" },
  "late-night-food": { formula: "density", places: "takeaways", counts: "takeaways and fast-food places (opening hours are not checked)" },
  culture: { formula: "density", places: "cinemas, theatres, museums and galleries", counts: "cinemas, theatres, arts centres, museums and galleries" },
  "food-variety": { formula: "variety", places: "kinds of cuisine", counts: "cafés, restaurants and fast-food places that list a cuisine" },
  "good-coffee": { formula: "density", places: "specialty coffee shops", counts: "specialty coffee shops and roasters, not every café that serves coffee" },
  markets: { formula: "nearest", places: "markets", counts: "markets and market places" },
  family: { formula: "density", places: "playgrounds and nurseries", counts: "playgrounds and nurseries (childcare and kindergartens)" },
  "dog-friendly": { formula: "density", places: "dog parks, vets and pet shops", counts: "dog parks, vets and pet shops" },
  coworking: { formula: "density", places: "coworking spaces, libraries and cafés", counts: "coworking spaces, public libraries and cafés, the places people work from" },
  universities: { formula: "density", places: "university and college buildings", counts: "university and college buildings" },
  cycling: { formula: "density", places: "bike stands, hire docks and bike shops", counts: "bike parking, bike hire docks and bike shops" },
  "ev-charging": { formula: "density", places: "EV charging points", counts: "electric-vehicle charging points" },
};

/** An MSOA under this many places shows no density (api custom_criteria.LENS_MIN_PLACES). */
export const LENS_MIN_PLACES = 5;
const OSM: LensSource = { name: "OpenStreetMap", licence: "ODbL-1.0", attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };

/** Where a lens's places come from: the pack's own sources, else OpenStreetMap. */
export function lensSources(index: AreaIndex | null, preset: LensPreset): LensSource[] {
  const sources = index?.data.lens?.[preset]?.sources ?? [];
  return sources.length > 0 ? sources : [OSM];
}

const sourceName = (source: LensSource) => source.name.replace(/ \(.*\)$/, "");

/**
 * How a lens ranking's figure is made, one short paragraph each (the page's "How the figure is made"),
 * naming the sources the places came from (lensSources) and crediting each under its own licence.
 */
export function lensExplainer(ranking: LensRanking, sources: LensSource[]): string[] {
  const lens = LENSES[ranking.preset];
  const where = ranking.level === "lad" ? "borough" : "area";
  const osmOnly = sources.every((source) => sourceName(source) === "OpenStreetMap");
  const on = osmOnly ? "mapped on OpenStreetMap" : "on our places map";
  const names = sources.map(sourceName);
  const merged = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
  const counted = `We count ${lens.counts} ${on} inside the ${where}'s boundary, the shape on the map: a place just across a boundary road counts for its neighbour.`;
  const paragraphs = ranking.preset === "family"
    ? [
      `This figure counts places for families: playgrounds and nurseries (childcare and kindergartens) ${on} inside the area's boundary.`,
      "Each counts once, whatever its size: a big adventure playground and a small one weigh the same. We divide the count by the area's land in square kilometres, so a large area does not come first just for being large. 12 per km² means about 12 of these places in a square 1 km on each side.",
      "It is not a score of how good an area is for families: it leaves out schools, parks, homes, prices and safety. Look at those on each area's page.",
      "The map's Families layer and each area's page show the walk to the nearest playground or nursery instead.",
    ]
    : lens.formula === "density"
      ? [counted, `We divide the count by the ${where}'s land in square kilometres, so the figure is ${lens.places} per km² and a large ${where} does not come first just for being large.`]
      : lens.formula === "variety"
        ? [`We look at the ${lens.counts} ${on} inside the area's boundary and count the different cuisines among them. Each cuisine counts once, however many places serve it. This is not divided by land, so a larger area can hold more kinds.`]
        : [`For each neighbourhood inside the area's boundary we estimate the walk from its centre to the nearest of the ${lens.counts} ${on}, in a straight line at an easy pace (up to 5 km), and show the middle of those minutes. It is not a route.`];
  if (lens.formula === "density") {
    paragraphs.push(ranking.level === "lad"
      ? "The City of London is left out: its tiny area would top every list on a handful of places."
      : `Areas with fewer than ${LENS_MIN_PLACES} such places are left out: a few places in a small area would otherwise top the list.`);
  }
  paragraphs.push(
    osmOnly
      ? "It counts places, not people: it says nothing about who lives in an area. Volunteers keep the map up to date, so a new place may be missing and a closed one still listed."
      : `It counts places, not people: it says nothing about who lives in an area. Our places map merges ${merged} and counts a place only where the sources agree, so a new place may be missing and a closed one still listed.`,
    `Places: ${sources.map((source) => `${source.attribution} (${source.licence})`).join("; ")}.`,
  );
  return paragraphs;
}

export const RANKINGS: readonly RankingDefinition[] = [
  { kind: "metric", slug: "most-expensive", group: "Cost", title: "Most expensive areas", lead: "London areas where homes sold for the most per square metre.", level: "msoa", metric: "price-per-square-metre", order: "desc", help: "ranking-price", column: "Typical price per m²" },
  { kind: "metric", slug: "least-expensive", group: "Cost", title: "Least expensive areas", lead: "London areas where homes sold for the least per square metre.", level: "msoa", metric: "price-per-square-metre", order: "asc", help: "ranking-price", column: "Typical price per m²" },
  { kind: "metric", slug: "highest-flat-prices", group: "Cost", title: "Areas with the highest typical flat prices", lead: "London areas where flats typically sold for the most, at today's prices.", level: "msoa", metric: "typical-price-flat", order: "desc", help: "ranking-typical-price", column: "Typical flat price" },
  { kind: "metric", slug: "lowest-flat-prices", group: "Cost", title: "Areas with the lowest typical flat prices", lead: "London areas where flats typically sold for the least, at today's prices.", level: "msoa", metric: "typical-price-flat", order: "asc", help: "ranking-typical-price", column: "Typical flat price" },
  { kind: "metric", slug: "highest-terraced-prices", group: "Cost", title: "Areas with the highest typical terraced prices", lead: "London areas where terraced houses typically sold for the most, at today's prices.", level: "msoa", metric: "typical-price-terraced", order: "desc", help: "ranking-typical-price", column: "Typical terraced price" },
  { kind: "metric", slug: "lowest-terraced-prices", group: "Cost", title: "Areas with the lowest typical terraced prices", lead: "London areas where terraced houses typically sold for the least, at today's prices.", level: "msoa", metric: "typical-price-terraced", order: "asc", help: "ranking-typical-price", column: "Typical terraced price" },
  { kind: "metric", slug: "highest-semi-detached-prices", group: "Cost", title: "Areas with the highest typical semi-detached prices", lead: "London areas where semi-detached houses typically sold for the most, at today's prices.", level: "msoa", metric: "typical-price-semi", order: "desc", help: "ranking-typical-price", column: "Typical semi-detached price" },
  { kind: "metric", slug: "lowest-semi-detached-prices", group: "Cost", title: "Areas with the lowest typical semi-detached prices", lead: "London areas where semi-detached houses typically sold for the least, at today's prices.", level: "msoa", metric: "typical-price-semi", order: "asc", help: "ranking-typical-price", column: "Typical semi-detached price" },
  { kind: "metric", slug: "highest-detached-prices", group: "Cost", title: "Areas with the highest typical detached prices", lead: "London areas where detached houses typically sold for the most, at today's prices.", level: "msoa", metric: "typical-price-detached", order: "desc", help: "ranking-typical-price", column: "Typical detached price" },
  { kind: "metric", slug: "lowest-detached-prices", group: "Cost", title: "Areas with the lowest typical detached prices", lead: "London areas where detached houses typically sold for the least, at today's prices.", level: "msoa", metric: "typical-price-detached", order: "asc", help: "ranking-typical-price", column: "Typical detached price" },
  { kind: "metric", slug: "highest-crime", group: "Safety", title: "Areas with the most recorded crime", lead: "London areas with the most crimes recorded for every 1,000 residents.", level: "msoa", metric: "crime", order: "desc", help: "ranking-crime", column: "Crimes per 1,000" },
  { kind: "metric", slug: "lowest-crime", group: "Safety", title: "Areas with the least recorded crime", lead: "London areas with the fewest crimes recorded for every 1,000 residents.", level: "msoa", metric: "crime", order: "asc", help: "ranking-crime", column: "Crimes per 1,000" },
  { kind: "metric", slug: "least-deprived", group: "Homes & area", title: "Least deprived areas", lead: "London areas whose neighbourhoods rank as the least deprived in England, on average.", level: "msoa", metric: "deprivation", order: "desc", help: "ranking-deprivation", column: "Average decile (10 = least deprived)" },
  { kind: "metric", slug: "most-deprived", group: "Homes & area", title: "Most deprived areas", lead: "London areas whose neighbourhoods rank as the most deprived in England, on average.", level: "msoa", metric: "deprivation", order: "asc", help: "ranking-deprivation", column: "Average decile (1 = most deprived)" },
  { kind: "metric", slug: "highest-income", group: "Homes & area", title: "Areas with the highest household income", lead: "London areas with the highest typical yearly household income, from the official estimate.", level: "msoa", metric: "income", order: "desc", help: "ranking-income", column: "Household income" },
  { kind: "metric", slug: "lowest-income", group: "Homes & area", title: "Areas with the lowest household income", lead: "London areas with the lowest typical yearly household income, from the official estimate.", level: "msoa", metric: "income", order: "asc", help: "ranking-income", column: "Household income" },
  { kind: "metric", slug: "most-social-renting", group: "Homes & area", title: "Areas with the most social renting", lead: "London areas where the largest share of households rent from a council or housing association.", level: "msoa", metric: "social-renting", order: "desc", help: "ranking-social-renting", column: "Households renting socially" },
  { kind: "metric", slug: "least-social-renting", group: "Homes & area", title: "Areas with the least social renting", lead: "London areas where the smallest share of households rent from a council or housing association.", level: "msoa", metric: "social-renting", order: "asc", help: "ranking-social-renting", column: "Households renting socially" },
  { kind: "school", slug: "top-secondary-grade5-english-maths", group: "Schools", title: "Secondary schools with the most pupils at grade 5+ in English and maths", lead: "London state secondary schools where the largest share of pupils got grade 5 or above in both English and maths at GCSE.", phase: "secondary", axis: "grade5-english-maths", order: "desc", help: "ranking-school-results", column: "Grade 5+ English & maths" },
  { kind: "school", slug: "top-secondary-attainment-8", group: "Schools", title: "Secondary schools with the highest Attainment 8", lead: "London state secondary schools with the highest Attainment 8: pupils' average grades across eight GCSE subjects.", phase: "secondary", axis: "attainment-8", order: "desc", help: "ranking-school-results", column: "Attainment 8" },
  { kind: "school", slug: "top-secondary-progress-8", group: "Schools", title: "Secondary schools with the highest Progress 8", lead: "London state secondary schools whose pupils made the most progress from the end of primary school to GCSE, against similar pupils across England.", phase: "secondary", axis: "progress-8", order: "desc", help: "ranking-school-progress-8", column: "Progress 8" },
  { kind: "school", slug: "outstanding-secondary-schools", group: "Schools", title: "Secondary schools rated Outstanding", lead: "London state secondary schools whose last graded Ofsted inspection, under the previous framework, rated them Outstanding overall.", phase: "secondary", axis: "legacy-outstanding", order: "desc", help: "ranking-school-outstanding", column: "Inspected" },
  { kind: "school", slug: "outstanding-primary-schools", group: "Schools", title: "Primary schools rated Outstanding", lead: "London state primary schools whose last graded Ofsted inspection, under the previous framework, rated them Outstanding overall.", phase: "primary", axis: "legacy-outstanding", order: "desc", help: "ranking-school-outstanding", column: "Inspected" },
  { kind: "school", slug: "secondary-report-card-exceptional", group: "Schools", title: "Secondary schools with areas graded exceptional", lead: "London state secondary schools inspected under Ofsted's report cards, by how many areas were graded exceptional.", phase: "secondary", axis: "report-card-exceptional", order: "desc", help: "ranking-school-report-card", column: "Areas graded exceptional" },
  // top-primary-ks2 and top-secondary-ebacc wait for KS2 and EBacc in etl_schools.py.
  { kind: "count", slug: "most-primary-schools", group: "Schools", title: "Areas with the most primary schools", lead: "London areas with the most state primary schools inside their boundary.", level: "msoa", phase: "primary", order: "desc", help: "ranking-school-count", column: "Primary schools" },
  { kind: "count", slug: "most-secondary-schools", group: "Schools", title: "Areas with the most secondary schools", lead: "London areas with the most state secondary schools inside their boundary.", level: "msoa", phase: "secondary", order: "desc", help: "ranking-school-count", column: "Secondary schools" },
  { kind: "metric", slug: "closest-to-a-station", group: "Getting around", title: "Areas closest to a station", lead: "London areas whose homes have the shortest typical walk to a rail, Underground, Overground, DLR or tram station.", level: "msoa", metric: "station-access", order: "asc", help: "ranking-station", column: "Walk to station" },
  { kind: "lens", slug: "most-cycling-facilities", group: "Getting around", title: "Areas with the most bike stands, hire docks and bike shops", lead: "London areas with the most bike parking, hire docks and bike shops for their size.", level: "msoa", preset: "cycling", order: "desc", help: "ranking-lens", column: "Per km²" },
  { kind: "lens", slug: "most-ev-charge-points", group: "Getting around", title: "Areas with the most EV charging points", lead: "London areas with the most electric-vehicle charging points for their size.", level: "msoa", preset: "ev-charging", order: "desc", help: "ranking-lens", column: "Charge points per km²" },
  { kind: "lens", slug: "most-nightlife", group: "Going out", title: "Areas with the most bars, pubs and clubs", lead: "London areas with the most bars, pubs and nightclubs for their size.", level: "msoa", preset: "nightlife", order: "desc", help: "ranking-lens", column: "Venues per km²" },
  { kind: "lens", slug: "most-late-night-food", group: "Going out", title: "Areas with the most takeaways", lead: "London areas with the most takeaways and fast-food places for their size.", level: "msoa", preset: "late-night-food", order: "desc", help: "ranking-lens", column: "Places per km²" },
  { kind: "lens", slug: "most-cultural-venues", group: "Going out", title: "Areas with the most cinemas, theatres, museums and galleries", lead: "London areas with the most cinemas, theatres, arts centres, museums and galleries for their size.", level: "msoa", preset: "culture", order: "desc", help: "ranking-lens", column: "Venues per km²" },
  { kind: "lens", slug: "widest-food-variety", group: "Going out", title: "Areas with the widest choice of cuisines", lead: "London areas whose cafés, restaurants and takeaways cover the most different cuisines.", level: "msoa", preset: "food-variety", order: "desc", help: "ranking-lens-variety", column: "Cuisines" },
  { kind: "lens", slug: "most-coffee-shops", group: "Going out", title: "Areas with the most specialty coffee shops", lead: "London areas with the most specialty coffee shops and roasters for their size.", level: "msoa", preset: "good-coffee", order: "desc", help: "ranking-lens", column: "Coffee shops per km²" },
  { kind: "lens", slug: "closest-to-a-market", group: "Going out", title: "Areas closest to a market", lead: "London areas whose neighbourhoods have the shortest typical walk to a market.", level: "msoa", preset: "markets", order: "asc", help: "ranking-lens-nearest", column: "Walk to market" },
  { kind: "lens", slug: "most-gyms", group: "Everyday life", title: "Areas with the most gyms and sports centres", lead: "London areas with the most gyms, fitness studios and sports centres for their size.", level: "msoa", preset: "gyms", order: "desc", help: "ranking-lens", column: "Gyms per km²" },
  { kind: "lens", slug: "most-places-for-families", group: "Everyday life", title: "Areas with the most places for families", lead: "London areas with the most playgrounds and nurseries for their size.", level: "msoa", preset: "family", order: "desc", help: "ranking-lens-family", column: "Places per km²" },
  { kind: "lens", slug: "most-dog-friendly-places", group: "Everyday life", title: "Areas with the most dog parks, vets and pet shops", lead: "London areas with the most dog parks, vets and pet shops for their size.", level: "msoa", preset: "dog-friendly", order: "desc", help: "ranking-lens", column: "Places per km²" },
  { kind: "lens", slug: "most-coworking-spaces", group: "Everyday life", title: "Areas with the most coworking spaces, libraries and cafés", lead: "London areas with the most places to work from, coworking spaces, libraries and cafés, for their size.", level: "msoa", preset: "coworking", order: "desc", help: "ranking-lens", column: "Places per km²" },
  { kind: "lens", slug: "most-universities", group: "Everyday life", title: "Areas with the most university and college buildings", lead: "London areas with the most university and college buildings for their size.", level: "msoa", preset: "universities", order: "desc", help: "ranking-lens", column: "Buildings per km²" },
  { kind: "metric", slug: "highest-food-hygiene", group: "Everyday life", title: "Areas with the highest food hygiene ratings", lead: "London areas where the largest share of nearby cafés, restaurants, takeaways and pubs are rated 4 or 5 for food hygiene.", level: "msoa", metric: "food-hygiene", order: "desc", help: "ranking-food-hygiene", column: "Food places rated 4–5" },
];

export const RANKING_LIMIT = 25;

/** A group's section on /rankings ("rankings-getting-around"): the index's chips and a ranking's breadcrumb link to it. */
export function rankingGroupAnchor(group: string): string {
  return `rankings-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** The index page's sections: each group with rankings, in RANKING_GROUPS order, rankings in RANKINGS order. */
export function rankingsByGroup(rankings: readonly RankingDefinition[] = RANKINGS): { group: RankingGroup; rankings: RankingDefinition[] }[] {
  return RANKING_GROUPS
    .map((group) => ({ group, rankings: rankings.filter((ranking) => ranking.group === group) }))
    .filter((entry) => entry.rankings.length > 0);
}

export function rankingBySlug(slug: string): RankingDefinition | null {
  return RANKINGS.find((ranking) => ranking.slug === slug) ?? null;
}

/**
 * The good end of a layer: least crime, cheapest, least deprived, the shortest walk, the best
 * food hygiene. Household income and social renting have none (described, never judged): they keep the
 * first ranking in RANKINGS order.
 */
const GOOD_ORDER: Partial<Record<PageMetricId, RankingBase["order"]>> = {
  "price-per-square-metre": "asc",
  "typical-price-flat": "asc",
  "typical-price-terraced": "asc",
  "typical-price-semi": "asc",
  "typical-price-detached": "asc",
  crime: "asc",
  deprivation: "desc",
  "station-access": "asc",
  "food-hygiene": "desc",
};

/** True when this ranking lists its layer's good end first (GOOD_ORDER); false for a layer with none. */
export function isGoodEnd(ranking: RankingDefinition): boolean {
  return ranking.kind === "metric" && GOOD_ORDER[ranking.metric] === ranking.order;
}

/**
 * The ranking a map layer's "Top 10" link opens (map-data-selector.tsx): the layer's good end (crime →
 * least recorded crime, price → least expensive), else its first area ranking in RANKINGS order. None, no link.
 */
export function rankingForLayer(layer: string): string | null {
  const ranked = RANKINGS.filter((entry) => entry.kind === "metric" && entry.level !== "lad" && entry.metric === layer);
  const ranking = ranked.find(isGoodEnd) ?? ranked[0];
  return ranking ? `/rankings/${ranking.slug}` : null;
}

/** The map on a ranking's row: that area chosen, coloured by the ranking's layer when it has one. */
export function rankingMapHref(ranking: AreaRanking, geographyId: GeographyId, period: string | null = null): string {
  const query = new URLSearchParams({ selected: geographyId });
  if (ranking.kind === "metric") query.set("layer", ranking.metric);
  // The ranking's own month, so the map shows what the list shows (a crime ranking for August opens August).
  if (ranking.kind === "metric" && period) query.set("period", period);
  return `/?${query.toString()}`;
}

/** The map layer a ranking colours by: its metric, its lens's custom layer, or none (a count of schools). */
export function rankingLayer(ranking: AreaRanking): string | null {
  if (ranking.kind === "metric") return ranking.metric;
  if (ranking.kind === "lens") {
    const preset = presetBySlug(ranking.preset);
    return preset ? `custom:${preset.criterion.id}` : null;
  }
  return null;
}

/** The page-level "On map ↗" (CUJ-05/10 v4): the ranking's layer and month, its top 10 numbered on the map. */
export function rankingTopHref(ranking: AreaRanking, period: string | null = null): string {
  const query = new URLSearchParams();
  const layer = rankingLayer(ranking);
  if (layer) query.set("layer", layer);
  if (ranking.kind === "metric" && period) query.set("period", period);
  query.set("rank", ranking.slug);
  return `/?${query.toString()}`;
}

/**
 * A school ranking's "On map ↗" (CUJ04 board step 2): the map's school dots of its phase, narrowed to
 * Outstanding for the Outstanding lists and to London's top 10% for a results ranking (lib/map-school-layer.ts).
 */
export function schoolRankingMapHref(ranking: SchoolRanking): string {
  const filter: SchoolFilter = { ...DEFAULT_SCHOOL_FILTER, phases: [ranking.phase] };
  if (ranking.axis === "legacy-outstanding") filter.ofsted = ["out"];
  else if (ranking.axis !== "report-card-exceptional") filter.measure = { id: "englandTopPercent", threshold: 10 };
  return `/?${new URLSearchParams({ schools: schoolFilterText(filter) }).toString()}`;
}

/**
 * Areas | Boroughs on a ranking's page (CUJ-10 v4): the same figure for London's boroughs is a column of the
 * one boroughs table (/area/london), opened sorted the ranking's way. Null when the table has no column.
 */
export function rankingBoroughsHref(ranking: RankingDefinition): string | null {
  const column = BOROUGH_COLUMNS.find((entry) => entry.sortable && typeof entry.figure === "object" && (
    (ranking.kind === "metric" && entry.figure.kind === "metric" && entry.figure.metric === ranking.metric)
    || (ranking.kind === "lens" && entry.figure.kind === "lens" && entry.figure.preset === ranking.preset)));
  if (!column || ranking.kind === "school") return null;
  return `/area/london?sort=${column.id}${ranking.order === "asc" ? "&dir=asc" : ""}`;
}

/**
 * The /rankings index: mirror pairs and types merged into one tile with a switch.
 * `slugs[pair][type]` is each choice's ranking; a tile without a switch has one. Every ranking
 * sits in exactly one tile (tests/area-pages.test.ts), so each slug keeps its own page.
 */
export interface RankingTile {
  id: string;
  group: RankingGroup;
  /** Short name on the index; the full ranking title goes in the link's accessible name. */
  label: string;
  /** The short name per type where it names the type ("Typical flat price"); `label` names the switches. */
  typeLabels?: readonly string[];
  pair?: readonly [string, string];
  types?: readonly string[];
  slugs: readonly (readonly string[])[];
}

const HIGH_LOW = ["Highest", "Lowest"] as const;
const PHASES = ["Primary", "Secondary"] as const;
const one = (id: string, group: RankingGroup, label: string, slug: string): RankingTile => ({ id, group, label, slugs: [[slug]] });

export const RANKING_TILES: readonly RankingTile[] = [
  { id: "price", group: "Cost", label: "Price per m²", pair: HIGH_LOW, slugs: [["most-expensive"], ["least-expensive"]] },
  {
    id: "typical", group: "Cost", label: "Typical price", pair: HIGH_LOW, types: ["Flat", "Terraced", "Semi", "Detached"],
    typeLabels: ["Typical flat price", "Typical terraced price", "Typical semi price", "Typical detached price"],
    slugs: [
      ["highest-flat-prices", "highest-terraced-prices", "highest-semi-detached-prices", "highest-detached-prices"],
      ["lowest-flat-prices", "lowest-terraced-prices", "lowest-semi-detached-prices", "lowest-detached-prices"],
    ],
  },
  { id: "crime", group: "Safety", label: "Recorded crime", pair: ["Most", "Least"], slugs: [["highest-crime"], ["lowest-crime"]] },
  { id: "outstanding", group: "Schools", label: "Outstanding schools", types: PHASES, slugs: [["outstanding-primary-schools", "outstanding-secondary-schools"]] },
  one("grade5", "Schools", "Grade 5+ English & maths", "top-secondary-grade5-english-maths"),
  one("attainment-8", "Schools", "Attainment 8", "top-secondary-attainment-8"),
  one("progress-8", "Schools", "Progress 8", "top-secondary-progress-8"),
  one("exceptional", "Schools", "Areas graded exceptional", "secondary-report-card-exceptional"),
  {
    id: "school-count", group: "Schools", label: "Most schools", types: PHASES, typeLabels: ["Most primary schools", "Most secondary schools"],
    slugs: [["most-primary-schools", "most-secondary-schools"]],
  },
  one("station", "Getting around", "Closest to a station", "closest-to-a-station"),
  one("cycling", "Getting around", "Bike stands, docks, shops", "most-cycling-facilities"),
  one("ev", "Getting around", "EV charging points", "most-ev-charge-points"),
  one("nightlife", "Going out", "Bars, pubs and clubs", "most-nightlife"),
  one("takeaways", "Going out", "Takeaways", "most-late-night-food"),
  one("culture", "Going out", "Cinemas, theatres, museums", "most-cultural-venues"),
  one("cuisines", "Going out", "Choice of cuisines", "widest-food-variety"),
  one("coffee", "Going out", "Specialty coffee", "most-coffee-shops"),
  one("market", "Going out", "Closest to a market", "closest-to-a-market"),
  one("gyms", "Everyday life", "Gyms and sports centres", "most-gyms"),
  one("families", "Everyday life", "Places for families", "most-places-for-families"),
  one("dogs", "Everyday life", "Dog parks, vets, pet shops", "most-dog-friendly-places"),
  one("coworking", "Everyday life", "Coworking, libraries, cafés", "most-coworking-spaces"),
  one("universities", "Everyday life", "University buildings", "most-universities"),
  one("hygiene", "Everyday life", "Food hygiene", "highest-food-hygiene"),
  { id: "deprivation", group: "Homes & area", label: "Deprivation", pair: ["Least", "Most"], slugs: [["least-deprived"], ["most-deprived"]] },
  { id: "income", group: "Homes & area", label: "Household income", pair: HIGH_LOW, slugs: [["highest-income"], ["lowest-income"]] },
  { id: "social-renting", group: "Homes & area", label: "Social renting", pair: ["Most", "Least"], slugs: [["most-social-renting"], ["least-social-renting"]] },
];

/** The pair choice a tile opens on: its good end where it has one (Least crime, Lowest price), else the first. */
export function tileGoodPair(tile: RankingTile): number {
  const index = tile.slugs.findIndex((row) => {
    const ranking = rankingBySlug(row[0] ?? "");
    return ranking !== null && isGoodEnd(ranking);
  });
  return Math.max(0, index);
}

/** A ranking's mirror pair (Most | Least) for the switch on its page; null when it has none. */
export interface RankingPairSwitch {
  label: string;
  options: { label: string; slug: string; current: boolean }[];
}

export function rankingPairSwitch(slug: string): RankingPairSwitch | null {
  for (const tile of RANKING_TILES) {
    if (!tile.pair) continue;
    for (const [pair, row] of tile.slugs.entries()) {
      const type = row.indexOf(slug);
      if (type < 0) continue;
      return {
        label: tile.typeLabels?.[type] ?? tile.label,
        options: tile.pair.map((label, index) => ({ label, slug: tile.slugs[index][type], current: index === pair })),
      };
    }
  }
  return null;
}

export interface RankingPreviewRow {
  name: string;
  display: string;
  /** The figure for its mini bar; null where the list has no number (Ofsted grades). */
  value: number | null;
}

/** A ranking's first rows for its tile on /rankings, from the same figures as its page. */
export function rankingPreview(index: AreaIndex, ranking: RankingDefinition, count = 3): RankingPreviewRow[] {
  if (ranking.kind === "school") {
    const response = index.data.schoolRankings?.[ranking.slug];
    if (!response) return [];
    return buildSchoolRanking(ranking, response).slice(0, count).map((row) => ({ name: row.name, display: row.display, value: null }));
  }
  return buildRanking(index, ranking, count).rows
    .map((row) => ({ name: row.area.friendlyName?.trim() || row.area.name, display: row.display, value: row.value }));
}

// ---- London's boroughs side by side (/area/london) ------------------------------------

export type BoroughColumnId = "price" | "crime" | "income" | "schools" | "families" | "going-out";

export interface BoroughColumn {
  id: BoroughColumnId;
  /** The header, short. */
  label: string;
  /** What the figure is, in the header's accessible name. */
  title: string;
  /** Every column sorts (income too, since the owner decision). */
  sortable: boolean;
  /** How each borough's figure is made (schools: the plain count of its state schools). */
  figure: AreaFigure | "schools";
}

export const BOROUGH_COLUMNS: readonly BoroughColumn[] = [
  { id: "price", label: "£/m²", title: "Typical price per m²", sortable: true, figure: { kind: "metric", metric: "price-per-square-metre" } },
  { id: "crime", label: "Crime", title: "Crimes per 1,000 residents", sortable: true, figure: { kind: "metric", metric: "crime" } },
  { id: "income", label: "Income", title: "Typical household income", sortable: true, figure: { kind: "metric", metric: "income" } },
  { id: "schools", label: "Schools", title: "State schools", sortable: true, figure: "schools" },
  { id: "families", label: "Families", title: "Playgrounds and nurseries per km²", sortable: true, figure: { kind: "lens", preset: "family" } },
  { id: "going-out", label: "Going out", title: "Bars, pubs and clubs per km²", sortable: true, figure: { kind: "lens", preset: "nightlife" } },
];

export interface BoroughTableRow {
  area: HierarchyArea;
  name: string;
  href: string;
  /** Per column: the figure (null when unknown, never zero) and its words. */
  cells: Record<BoroughColumnId, { value: number | null; display: string }>;
}

export interface BoroughSort { by: "name" | BoroughColumnId; dir: "asc" | "desc" }

/** The table's first order: the most expensive first. */
export const BOROUGH_DEFAULT_SORT: BoroughSort = { by: "price", dir: "desc" };

/** A ?sort= the table opens with (old "Boroughs by …" links): a sortable column, highest first unless ?dir=asc (a ranking's Boroughs). */
export function boroughSortParam(value: string | string[] | undefined, direction?: string | string[] | undefined): BoroughSort {
  const id = Array.isArray(value) ? value[0] : value;
  const column = BOROUGH_COLUMNS.find((entry) => entry.id === id && entry.sortable);
  const dir = (Array.isArray(direction) ? direction[0] : direction) === "asc" ? "asc" : "desc";
  return column ? { by: column.id, dir } : BOROUGH_DEFAULT_SORT;
}

/** Every borough with its six figures, in the table's first order. */
export function boroughTable(index: AreaIndex, sort: BoroughSort = BOROUGH_DEFAULT_SORT): BoroughTableRow[] {
  const rows = descendants(index, LONDON, "lad").map((area) => {
    const cells = Object.fromEntries(BOROUGH_COLUMNS.map((column) => {
      const value = boroughFigure(index, column, area);
      return [column.id, { value, display: value === null ? "—" : boroughDisplay(column, value) }];
    })) as BoroughTableRow["cells"];
    return { area, name: area.name, href: areaPath(area), cells };
  });
  return sortBoroughRows(rows, sort);
}

/**
 * Rows in a chosen order; an unknown figure sits last either way, then A to Z. A column that does not
 * sort (BOROUGH_COLUMNS › sortable), asked for, keeps the first order.
 */
export function sortBoroughRows<T extends Pick<BoroughTableRow, "name" | "cells">>(rows: readonly T[], sort: BoroughSort): T[] {
  const by = sort.by === "name" || BOROUGH_COLUMNS.some((column) => column.id === sort.by && column.sortable) ? sort.by : BOROUGH_DEFAULT_SORT.by;
  const sign = sort.dir === "asc" ? 1 : -1;
  const name = (a: T, b: T) => PLAIN_NAME_ORDER.compare(a.name, b.name);
  return [...rows].sort((a, b) => {
    if (by === "name") return sign * name(a, b);
    const x = a.cells[by].value;
    const y = b.cells[by].value;
    if (x === null || y === null) return x === y ? name(a, b) : x === null ? 1 : -1;
    return sign * (x - y) || name(a, b);
  });
}

function boroughFigure(index: AreaIndex, column: BoroughColumn, area: HierarchyArea): number | null {
  if (column.figure === "schools") return area.schools ? area.schools.primary + area.schools.secondary : null;
  return rankingValue(index, column.figure, area)?.value ?? null;
}

function boroughDisplay(column: BoroughColumn, value: number): string {
  const figure = column.figure;
  if (figure === "schools") return value.toLocaleString("en-GB");
  if (figure.kind === "lens") return formatLensValue(figure.preset, value);
  if (figure.kind === "metric") return formatRankingValue(figure.metric, value);
  return value.toLocaleString("en-GB");
}

/**
 * Rankings with a page: every metric ranking (an empty one says "unknown for now"), and a lens ranking
 * only when its pack has a value at its level. Without data (null) no lens is shown.
 */
export function availableRankings(index: AreaIndex | null): RankingDefinition[] {
  return RANKINGS.filter((ranking) => {
    if (ranking.kind === "metric") return true;
    if (!index) return false;
    if (ranking.kind === "school") return schoolRankingShown(ranking, index.data.schoolRankings?.[ranking.slug]);
    if (ranking.kind === "count") return descendants(index, LONDON, ranking.level).some((area) => (area.schools?.[ranking.phase] ?? 0) > 0);
    return [...index.lenses[ranking.preset].values()].some((entry) => entry.carrier === ranking.level);
  });
}

export interface RankingRow {
  rank: number;
  area: HierarchyArea;
  /** The name to show ("Fitzrovia West & Soho · W1D"), never the official code. */
  name: string;
  parentName: string | null;
  value: number;
  /** What a roll-up rests on ("middle of 3 neighbourhoods"), or the places counted. */
  detail: string;
  display: string;
}

/** The area's ranking value, or null when unknown (never ranked as zero). */
function rankingValue(index: AreaIndex, ranking: AreaFigure, area: HierarchyArea): { value: number; detail: string } | null {
  if (ranking.kind === "lens") {
    // Already rolled up to this carrier: the area's own figure, never the middle of its neighbourhoods'.
    const entry = index.lenses[ranking.preset].get(area.geographyId);
    if (entry?.value == null) return null;
    const formula = LENSES[ranking.preset].formula;
    // A list of "most" places leaves out areas with none (universities: most have none).
    if (formula !== "nearest" && entry.value <= 0) return null;
    const sample = entry.sampleCount ?? 0;
    const detail = formula === "nearest" ? `middle of ${countOf(sample, "neighbourhood")}` : countOf(sample, "place");
    return { value: entry.value, detail };
  }
  if (ranking.kind === "count") {
    // Null when schools are not loaded (unknown, never 0); a list of "most" schools leaves out areas with none.
    const count = area.schools?.[ranking.phase];
    return count ? { value: count, detail: "" } : null;
  }
  if (ranking.metric === "deprivation") {
    // Published per neighbourhood as a decile: an area's figure is the average of its neighbourhoods'.
    const figure = deprivationOf(index, descendants(index, area.geographyId, "lsoa"));
    return figure ? { value: figure.meanDecile, detail: `average of ${countOf(figure.count, "neighbourhood")}` } : null;
  }
  if (NEIGHBOURHOOD_METRICS.includes(ranking.metric)) {
    const figure = middleOf(index, ranking.metric, descendants(index, area.geographyId, "lsoa"));
    return figure ? { value: figure.value, detail: `middle of ${countOf(figure.count, "neighbourhood")}` } : null;
  }
  const value = index.values[ranking.metric].get(area.geographyId)?.value;
  if (value != null) return { value, detail: "" };
  // Income is published per MSOA: a borough without its own figure takes the middle of its MSOAs'.
  if (ranking.metric === "income" && area.carrier === "lad") {
    const figure = middleOf(index, "income", descendants(index, area.geographyId, "msoa"));
    return figure ? { value: figure.value, detail: `middle of ${countOf(figure.count, "area")}` } : null;
  }
  return null;
}

export function formatRankingValue(metric: PageMetricId, value: number): string {
  if (metric === "price-per-square-metre") return formatPerSquareMetre(value);
  if (metric === "crime") return formatCrimeRate(value);
  if (metric === "income") return `${formatPounds(Math.round(value / 100) * 100)} a year`;
  if (metric === "deprivation") return value.toFixed(1);
  if (metric === "station-access") return `${Math.round(value)} min`;
  if (metric === "food-hygiene") return `${Math.round(value)}%`;
  if (isTypicalPriceLayer(metric)) return formatMoney(value);
  return formatPercent(value);
}

/** A lens figure: places per km² to one decimal, whole cuisines, whole walking minutes. */
export function formatLensValue(preset: LensPreset, value: number): string {
  const formula = LENSES[preset].formula;
  if (formula === "nearest") return `${Math.round(value)} min`;
  if (formula === "variety") return Math.round(value).toLocaleString("en-GB");
  return value.toFixed(1);
}

export function buildRanking(index: AreaIndex, ranking: AreaRanking, limit = RANKING_LIMIT): { rows: RankingRow[]; ranked: number } {
  const scored = descendants(index, LONDON, ranking.level).flatMap((area) => {
    const score = rankingValue(index, ranking, area);
    return score ? [{ area, ...score }] : [];
  });
  const sign = ranking.order === "desc" ? -1 : 1;
  scored.sort((a, b) => sign * (a.value - b.value) || byName(a.area, b.area));
  const shown = scored.slice(0, ranking.level === "lad" ? scored.length : limit);
  // Equal figures share a rank ("1, 1, 3").
  const ranks = shown.map((_, position) => position);
  shown.forEach((entry, position) => {
    const previous = shown[position - 1];
    if (previous && previous.value === entry.value) ranks[position] = ranks[position - 1];
  });
  const rows = shown.map((entry, position) => ({
    rank: ranks[position] + 1,
    area: entry.area,
    name: areaDisplayName(entry.area) ?? entry.area.name,
    parentName: entry.area.parentId ? index.byId.get(entry.area.parentId)?.name ?? null : null,
    value: entry.value,
    detail: entry.detail,
    display: ranking.kind === "lens" ? formatLensValue(ranking.preset, entry.value)
      : ranking.kind === "count" ? entry.value.toLocaleString("en-GB") : formatRankingValue(ranking.metric, entry.value),
  }));
  return { rows, ranked: scored.length };
}

// ---- Schools ------------------------------------------------------------------------------------

const OGL = "Contains public sector information licensed under the Open Government Licence v3.0.";

/** How a school-count ranking's figure is made (the page's "How the figure is made"). */
export function countExplainer(ranking: CountRanking): string[] {
  return [
    `We count the state-funded ${ranking.phase} schools on Ofsted's latest list whose address is inside each area's boundary, the shape on the map: a school just across a boundary road counts for its neighbour.`,
    "Areas (MSOAs) are drawn to hold similar numbers of people, about 5,000 to 15,000, so the plain count is fair and is not divided by land.",
    "Independent schools are not counted. Living near a school doesn't guarantee a place, so check each school's admissions rules.",
    `Schools: Ofsted. ${OGL}`,
  ];
}

/** Report-card grades began in November 2025: the list waits until this many schools of the phase have one. */
export const REPORT_CARD_MIN_INSPECTED = 30;

/** A school ranking has a page when its answer has rows (report cards: and enough schools inspected). */
export function schoolRankingShown(ranking: SchoolRanking, response: SchoolRankingResponse | undefined): boolean {
  if (!response || response.rows.length === 0) return false;
  return ranking.axis !== "report-card-exceptional" || (response.inspectedSchools ?? 0) >= REPORT_CARD_MIN_INSPECTED;
}

/** Ofsted grades are a filtered list: no rank numbers. */
const isFilteredList = (ranking: SchoolRanking) => ranking.axis === "legacy-outstanding";

export interface SchoolRankingRow {
  /** Null on a filtered list. */
  rank: number | null;
  urn: string;
  name: string;
  /** Our school page, /school/[urn]. */
  href: string;
  /** The school's page with the publisher: DfE results or Ofsted reports. */
  sourceHref: string;
  /** "DfE" or "Ofsted". */
  sourceLabel: string;
  borough: string | null;
  display: string;
  detail: string;
}

function formatSchoolValue(axis: SchoolAxis, value: number | string, year: string | null): string {
  if (axis === "legacy-outstanding" || typeof value === "string") return year ?? "unknown";
  if (axis === "grade5-english-maths") return `${Math.round(value)}%`;
  if (axis === "attainment-8") return value.toFixed(1);
  if (axis === "progress-8") return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
  return value.toLocaleString("en-GB");
}

function isOfstedAxis(axis: SchoolAxis): boolean {
  return axis === "legacy-outstanding" || axis === "report-card-exceptional";
}

function schoolSourceHref(axis: SchoolAxis, urn: string): string {
  const code = encodeURIComponent(urn);
  return isOfstedAxis(axis)
    ? `https://reports.ofsted.gov.uk/search?q=${code}`
    : `https://www.compare-school-performance.service.gov.uk/school/${code}`;
}

/** The API's rows as the table shows them: equal figures share a rank ("1, 1, 3"); filtered lists have none. */
export function buildSchoolRanking(ranking: SchoolRanking, response: SchoolRankingResponse): SchoolRankingRow[] {
  const ranks: number[] = [];
  response.rows.forEach((row, position) => {
    ranks.push(position > 0 && response.rows[position - 1].value === row.value ? ranks[position - 1] : position + 1);
  });
  return response.rows.map((row, position) => ({
    rank: isFilteredList(ranking) ? null : ranks[position],
    urn: row.urn,
    name: row.name,
    href: schoolPath(row.urn),
    sourceHref: schoolSourceHref(ranking.axis, row.urn),
    sourceLabel: isOfstedAxis(ranking.axis) ? "Ofsted" : "DfE",
    borough: row.borough,
    display: formatSchoolValue(ranking.axis, row.value, row.year),
    detail: row.cohort != null ? countOf(row.cohort, "pupil") : ranking.axis === "report-card-exceptional" && row.year ? `inspected ${row.year}` : "",
  }));
}

/** The figure's column, with its year when one year covers the list ("Progress 8 (2023/24)"). */
export function schoolColumn(ranking: SchoolRanking, response: SchoolRankingResponse): string {
  return response.year && ranking.axis === "progress-8" ? `${ranking.column} (${response.year})` : ranking.column;
}

/** The line under the lead: how many schools are shown, of how many, from which year. */
export function schoolRankingScope(ranking: SchoolRanking, response: SchoolRankingResponse): string {
  const shown = response.rows.length.toLocaleString("en-GB");
  const of = `${response.eligibleSchools.toLocaleString("en-GB")} state ${ranking.phase} schools`;
  if (isFilteredList(ranking)) return `The ${shown} most recently inspected of ${of} rated Outstanding`;
  if (ranking.axis === "report-card-exceptional") {
    const inspected = (response.inspectedSchools ?? 0).toLocaleString("en-GB");
    return `${response.eligibleSchools.toLocaleString("en-GB")} of the ${inspected} state ${ranking.phase} schools inspected under report cards so far have an area graded exceptional`;
  }
  const cohort = response.minCohort ? ` with ${response.minCohort} or more pupils in the year group` : "";
  return `Top ${shown} of ${of}${cohort}${response.year ? `, ${response.year}` : ""}`;
}
