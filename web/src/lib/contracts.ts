import type { components } from "./api-types.gen";

/** The API's schemas, generated from contracts/openapi.yaml (deploy/tools/gen_openapi.py). */
type Schemas = components["schemas"];
import type { MultiPolygon, Polygon } from "geojson";

import { CENSUS_METRIC_IDS } from "./census-layers";
import { NATURE_METRIC_IDS, type DetailLayerId } from "./nature-layers";
import { assertCustomPreferences, type CustomCriterion, type CustomFactorId, type CustomPreference } from "./custom-criteria";
import type { PropertyProfile } from "./property-profile";
import { isSchoolFilterText } from "./school-filter";

export const METRIC_IDS = [
  "price-per-square-metre",
  "crime",
  "deprivation",
  "income",
  "social-renting",
  "stock-value-per-square-metre",
  "station-access",
  "food-hygiene",
  // Road, rail and aircraft noise (Defra 2022, deploy/tools/etl_noise_layer.py): share of homes at 55 dB Lden or more.
  "noise",
  // Pedestrians and cyclists hurt per 1,000 residents a year (DfT STATS19, deploy/tools/etl_kids.py).
  "road-collisions",
  // Clean air (GLA LAEI 2022, deploy/tools/etl_health.py load-air): mean NO2 at the area's homes, µg/m³.
  "air-no2",
  // "Typical home price" (migration 040): one layer, one metric per type of home.
  "typical-price",
  "typical-price-flat",
  "typical-price-terraced",
  "typical-price-semi",
  "typical-price-detached",
  // Census 2021 layers (deploy/tools/etl_census_layers.py): one metric per category, descriptive only.
  ...CENSUS_METRIC_IDS,
  // Nature (deploy/tools/etl_nature.py `layers`): the Nature rank and one "Wildlife seen" metric per species.
  ...NATURE_METRIC_IDS,
  // UK HPI (migration 080, deploy/tools/etl_uk_hpi.py): the borough's change in the official index, on every level.
  "hpi-change-5y",
  "hpi-change-10y",
  // Rent trend (deploy/tools/etl_rent_trend.py, ONS PIPR): % change in the borough's rents, carrier borough.
  "rent-change-1y",
  "rent-change-5y",
  // Council tax bands (migration 082): mean band of the LSOA's homes, A = 1 ... H = 8 (VOA CTSOP).
  "council-tax-band-mean",
  // Company and overseas ownership (migration 083, deploy/tools/etl_ownership.py): titles per 100 homes.
  "ownership-company-share",
  "ownership-overseas-share",
  // Short lets (deploy/tools/etl_short_lets.py): Airbnb listings per 1,000 homes (Inside Airbnb, CC BY 4.0).
  "short-lets-per-1000",
  // Development pipeline (migration 085, deploy/tools/etl_pipeline.py): new homes not started or being built per 1,000 homes.
  "pipeline-homes-per-1000",
  // Mobile coverage (migration 086, deploy/tools/etl_mobile.py): % of premises per borough (Ofcom publishes no finer).
  "mobile-4g-indoor",
  "mobile-5g-outdoor",
  // Future transport (deploy/tools/etl_future_transport.py): km to the nearest new station under construction or consented.
  "future-station-distance",
  // Licensed HMOs per 1,000 homes (borough HMO registers, deploy/tools/etl_hmo.py); grey where not published.
  "hmo-per-1000",
  // Layers v5 PR 3 (migration 100, deploy/tools/etl_layers_v5.py): typical rent by bedrooms (ONS PIPR, borough),
  // homes at medium or high flood risk (EA NaFRA2), good schools within 1.5 km (DfE England top 25%) and
  // full-time students (Census 2021 TS066, descriptive only).
  "typical-rent",
  "typical-rent-1-bed",
  "typical-rent-3-bed",
  "flood-risk",
  "good-schools-nearby",
  "good-schools-nearby-secondary",
  "student-share",
  // Layers v5 PR 3 batch 2 (migration 101): straight-line walking minutes to the nearest supermarket
  // (OpenStreetMap) and GP practice (NHS England), % of premises with gigabit broadband available (Ofcom).
  "supermarket-walk",
  "gp-walk",
  "broadband-gigabit",
] as const;

export type MetricId = (typeof METRIC_IDS)[number];
export const FACTOR_IDS = [
  "affordability",
  "market-level",
  "growth-outlook",
  "crime",
  "deprivation",
  "income",
  "social-renting",
  "commute",
  "schools",
  "station-access",
  // Quick criteria (migration 028): appended so shared links keep their factor indexes.
  "noise",
  "disorder",
  "epc-share",
  "leasehold-share",
] as const;

export type FactorId = (typeof FACTOR_IDS)[number];
// A detail layer (Green streets, Canopy) is drawn finer than areas: lib/nature-layers.ts DETAIL_LAYER_IDS.
export type MapLayerId = MetricId | DetailLayerId | "personal-match" | `custom:${string}`;
/** A geography level as the API names it: "lad" is a local authority district (a London borough among them). */
export type Carrier = "lsoa" | "msoa" | "lad";
/**
 * The same level as the area tiles name their layer and file ("borough" for a LAD): ids and page URLs say lad since
 * step R2 (docs/architecture/global-geography.md), the tiles until step 7.
 */
export type TileKind = "lsoa" | "msoa" | "borough";
export type Quality = "observed" | "fallback" | "suppressed";
export type GeographyId = `uk:${Carrier}:${string}`;

/** Carrier for a kind as written anywhere: the old "borough" (tiles, ids and URLs from before R2) → "lad". */
export function carrierOf(kind: string): Carrier {
  return (kind === "borough" ? "lad" : kind) as Carrier;
}

/** Tile layer and file kind for a carrier ("lad" → "borough"). */
export function tileKindOf(carrier: Carrier | TileKind): TileKind {
  return carrier === "lad" ? "borough" : carrier;
}

/** Carrier of a geography id: uk:lad:E09000007 (or an old uk:borough:E09000007) → "lad". */
export function carrierOfId(id: string): Carrier {
  return carrierOf(id.split(":")[1] ?? "");
}

const OLD_LAD_ID = "uk:borough:";

/** An old LAD id (uk:borough:<code>, before step R2) as its current id (uk:lad:<code>); any other id as it is. */
export function canonicalAreaId<T extends string>(id: T): T {
  return (id.startsWith(OLD_LAD_ID) ? `uk:lad:${id.slice(OLD_LAD_ID.length)}` : id) as T;
}

/** `canonicalAreaId` on every string of a decoded value (a shared profile, a saved list), keys included. */
export function canonicalAreaIds<T>(value: T): T {
  if (typeof value === "string") return canonicalAreaId(value) as T;
  if (Array.isArray(value)) return value.map((item) => canonicalAreaIds(item)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [canonicalAreaId(key), canonicalAreaIds(item)])) as T;
  }
  return value;
}
export type SchoolId = `uk:school:${string}`;

export type Provenance = Schemas["Provenance"];

export type LegendStop = Schemas["LegendStop"];

export type MetricDefinition = Schemas["MetricDefinition"];

export type MetricCoverage = Schemas["MetricCoverage"];

/** A two-count colour square (custom "A vs B" criteria): thresholds start levels 1..3 on each axis,
 * colours[level of A][level of B]; the map paints cell = level A × 4 + level B. */
export interface BivariateSquare {
  axes: Record<"a" | "b", { label: string; thresholds: number[] }>;
  colours: string[][];
  corners: Record<"none" | "a" | "b" | "both", string>;
}

export type MapDefinition = Omit<MetricDefinition, "id"> & { id: MapLayerId; bivariate?: BivariateSquare | null };

export type AreaSummary = Schemas["AreaSummary"];

export type ValuePackEntry = Schemas["ValuePackEntry"];

export type ValuePack = Schemas["ValuePack"];

export type AreaResponse = Schemas["AreaResponse"];

/** Metrics the area profile carries: everything but the per-home stock value. */
export const PROFILE_METRIC_IDS = [
  "price-per-square-metre",
  "crime",
  "deprivation",
  "income",
  "social-renting",
] as const satisfies readonly MetricId[];

/**
 * One area across every topic, for the Overview scorecard. Each metric is
 * at its latest period on or before the requested one (periods differ per
 * metric); a metric with no value there is absent, never zero.
 */
export type AreaProfileResponse = Schemas["AreaProfileResponse"];

/**
 * One London rank (migration 054, api/area_api/places.py): `percentile` 0-100 is the raw
 * value's percent rank among London LSOAs, lowest value = 0; for bestPrimary it is that
 * school's rank among London primaries. Pass `percentile` and `higherIsBetter` to <Rating>.
 */
export type LondonRank = Schemas["AreaRank"];

export type BestPrimaryRank = Schemas["SchoolRank"];

export type AreaLondonRanks = Schemas["AreaRanks"];

/**
 * The middle price of one type of home sold in an area since `since`, adjusted to
 * `adjustedTo` and rounded to £5,000: about the area's sales, never one home. Taken
 * from the first of the area's own level and its wider ones with enough sales.
 */
export type TypicalPrice = Schemas["TypicalPrice"];

export type PropertyLastSale = Schemas["PropertyLastSale"];

export type PropertySummary = Schemas["PropertySummary"];

export type PropertyResponse = Schemas["PropertyResponse"];

export type PropertyHistoryResponse = Schemas["PropertyHistoryResponse"];

export type SchoolSummaryResponse = Schemas["SchoolSummaryResponse"];

export type SchoolSearchResponse = Schemas["SchoolSearchResponse"];

export type AreaSchoolsResponse = Schemas["AreaSchoolsResponse"];

export type PreferenceDirection = "higher" | "lower" | "target-range";

export type FactorDefinition = Schemas["FactorDefinition"];

export type FactorPreference = Schemas["FactorPreference"];

export type CommuteDestination = Schemas["CommuteDestination"];

// A place the household wants to live in. Areas outside every zone carry the
// relaxable unmet limit "zone:outside"; membership only breaks score ties.
export type MatchZone =
  | { kind: "station"; stationId: string; maxWalkMinutes: number; label?: string }
  | { kind: "borough"; id: GeographyId; label?: string }
  | { kind: "lsoas"; ids: GeographyId[]; label?: string }
  /** Drawn on the map: one ring of [latitude, longitude] corners, closed implicitly. */
  | { kind: "polygon"; points: [number, number][]; label?: string };

export const MAX_ZONES = 3;
export const MAX_ZONE_LSOAS = 50;
export const ZONE_WALK_MINUTES = { min: 5, max: 30 } as const;
const ZONE_LABEL_MAX = 80;
const STATION_ID_RE = /^osm:[nwr]\d{1,15}$/;
const ZONE_FIELDS: Record<MatchZone["kind"], string[]> = {
  station: ["kind", "stationId", "maxWalkMinutes", "label"],
  borough: ["kind", "id", "label"],
  lsoas: ["kind", "ids", "label"],
  polygon: ["kind", "points", "label"],
};
/** Mirrors POLYGON_POINTS in api/area_api/matching.py and ENGLAND_BOX in api/area_api/coverage.py. */
export const POLYGON_POINTS = { min: 3, max: 50 } as const;
export const ENGLAND_BOX = { latitude: [49.86, 55.82], longitude: [-6.45, 1.77] } as const;
/** "Near any of": two or three pinned points; minutes are the best of them. */
export const ANY_OF_POINTS = { min: 2, max: 3 } as const;

/** A limit that relaxation can lift: one factor's bounds, or the zones. */
export type MatchLimitId = FactorId | "zone" | "mark" | PlaceFactorId | CustomFactorId | RangeFactorId;

/**
 * A place the household goes to: a pinned point (work, a gym, a particular school, friends) or
 * the nearest of a kind ("any park"). Each one is a match criterion `place:<id>` scored like a
 * commute leg (200 - minutes/target*100); `must` makes the target a hard limit.
 * Mirrors validate_places in api/area_api/matching.py.
 */
export const PLACE_CATEGORIES = [
  "park", "cafe", "supermarket", "convenience", "gp", "pharmacy", "pub", "restaurant", "gym", "pool", "sports_club",
  "step_free_station",
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];
/** Append-only: share links carry the index. car = typical weekday-morning traffic, no parking or charges. */
export const PLACE_MODES = ["walk", "cycle", "transit", "car"] as const;
export type PlaceMode = (typeof PLACE_MODES)[number];
/** When the trip happens (absent = weekday morning). Only the morning has routed times so far; scoring ignores it. */
export const PLACE_WHENS = ["weekday-am", "weekday-pm", "saturday"] as const;
export type PlaceWhen = (typeof PLACE_WHENS)[number];
export const MAX_PLACES = 8;
export const SCHOOL_PHASES = ["primary", "secondary"] as const;
export type SchoolPhase = (typeof SCHOOL_PHASES)[number];
export const MAX_TOP_SCHOOLS = 200;
/** A school filter place's straight-line limit (matching.SCHOOL_WITHIN_METRES). */
export const SCHOOL_WITHIN_METRES = { min: 100, max: 10_000 } as const;
/** How a "top N schools" rule ranks: published results (default) or Progress 8 (secondaries only). */
export const SCHOOL_RANKINGS = ["results", "progress8"] as const;
export type SchoolRanking = (typeof SCHOOL_RANKINGS)[number];
const PLACE_FILTER_RE = /^[\w &'.+-]{1,40}$/u;
export const MAX_MARKED_AREAS = 50;
const PLACE_ID_RE = /^[a-z0-9-]{1,24}$/;
const GEOGRAPHY_ID_RE = /^uk:(lsoa|msoa|lad):E\d{8}$/;

export type PlaceTarget =
  | { kind: "point"; latitude: number; longitude: number }
  /** The nearest of a kind, optionally one brand ("M&S", "PureGym") or one sport ("tennis"). */
  | { kind: "category"; category: PlaceCategory; brand?: string; sport?: string }
  /** Near one of London's top N state schools of a phase (by published results). */
  | { kind: "school"; phase: SchoolPhase; top: number; rankBy?: SchoolRanking }
  /** Near a school like this (Schools filter v2): the nearest school the filter keeps (its compact text, the map's
   * ?schools= value, lib/school-filter.ts), and only within `within` metres when set. */
  | { kind: "school-filter"; filter: string; within?: number }
  /** Near any of two or three pinned points ([latitude, longitude]): either office, whichever is quicker. */
  | { kind: "any-of"; points: [number, number][] };

export interface PlacePreference {
  id: string;
  label: string;
  target: PlaceTarget;
  mode: PlaceMode;
  targetMinutes: number;
  weight: number;
  must: boolean;
  when?: PlaceWhen;
  /** v4: the soft edge in minutes (fit 0 at it); absent = targetMinutes × 1.5. */
  softMinutes?: number;
}

/** One-tap marks: liked areas are highlighted, excluded ones leave the ranking, notes are private. */
export interface AreaMarks {
  liked: GeographyId[];
  excluded: GeographyId[];
  notes: Record<string, string>;
}

/** Who is moving (Tailor, personalisation-spec.md §2): changes a few overview facts, never the order. */
export const HOUSEHOLDS = ["solo", "sharers", "kids-under5", "kids-primary", "kids-secondary", "kids-mixed", "55plus"] as const;
export type Household = (typeof HOUSEHOLDS)[number];
/** Things used weekly (Tailor): they fill overview tiles 5-7. At most MAX_LIFESTYLE. */
export const LIFESTYLES = ["parks", "gym", "cafes", "bars", "quiet", "gp", "shops"] as const;
export type Lifestyle = (typeof LIFESTYLES)[number];
export const MAX_LIFESTYLE = 3;

export interface PreferenceProfile {
  schemaVersion: "preference-profile.v1";
  market: "buy" | "rent";
  targetBudget: number;
  maximumBudget: number;
  bedrooms: number;
  forecastHorizon: "1y" | "5y";
  factors: FactorPreference[];
  commuteDestinations: CommuteDestination[];
  school: {
    phases: ("primary" | "secondary")[];
    characteristics: string[];
    facetWeights: Record<string, number>;
    shortlistUrns: string[];
    desiredSchoolCount: number;
  };
  analyticsConsent: boolean;
  zones?: MatchZone[];
  /** House or flat, for comparing prices with sales of similar homes. Absent = any. */
  propertyType?: "house" | "flat" | "any";
  /** The kinds of house wanted (several may be picked). Matching treats any of them as a house. */
  houseTypes?: ("terraced" | "semi" | "detached")[];
  places?: PlacePreference[];
  /** Ranges on map layers' own values, with soft edges (lib/match-ranges.ts). */
  ranges?: RangeCriterion[];
  marks?: AreaMarks;
  /** The household's own criteria from places on OpenStreetMap (lib/custom-criteria.ts). */
  custom?: CustomPreference[];
  /** Tailor: kept on this device only, never in share links or match requests. Absent or null = default. */
  household?: Household | null;
  /** Tailor: up to MAX_LIFESTYLE things used weekly, on this device only. */
  lifestyle?: Lifestyle[];
  /**
   * The criteria's ids in priority order (affordability, place:<id>, range:<layer>, custom:<id>, zone),
   * Musts first. A criterion missing from it joins at the end (lib/match-search.ts); the weights above are then only
   * a fallback order for old profiles.
   */
  order?: string[];
  /** The Where criterion over `zones`: a Must keeps only areas inside; softMetres is its soft edge. */
  where?: { must?: boolean; softMetres?: number };
  /** "Kids at home?" / "Do you drive?", kept only to order My match's suggestions (never sent or shared). */
  suggest?: { kids?: boolean; drive?: boolean };
}

/** At most this many ids in a profile's `order`. */
export const MAX_ORDER = 40;

/** A household place scored as a criterion (see PlacePreference). */
export type PlaceFactorId = `place:${string}`;

/** The house subtypes, in the order they are offered. */
export const HOUSE_TYPES = ["terraced", "semi", "detached"] as const;
export type HouseType = (typeof HOUSE_TYPES)[number];

/**
 * A range on one map layer's own values (mirrors validate_ranges in api/area_api/matching.py).
 * Fit 1 inside [min, max]; across a soft edge (softMin ≤ min, softMax ≥ max) it falls linearly to 0 at the
 * edge; 0 beyond, and any fit of 0 puts the area out. A null bound is open; a soft edge that is null or at
 * the range is strict ("Must" is just that preset). `layer` is a metric id or a ready-made criterion
 * (`custom:<preset id>`); the Census is never a criterion. Deprivation (owner decision),
 * household income and social renting are.
 */
export interface RangeCriterion {
  layer: string;
  min: number | null;
  max: number | null;
  softMin: number | null;
  softMax: number | null;
  /** Importance dots, 1–5: the old weight; v4 orders by `order` instead (kept for older readers). */
  importance: number;
  /** v4: the layer's own values (default) or its London percentile (0 lowest … 100 highest). */
  scale?: "value" | "percentile";
  /** v4: a filter with no weight (edges at the range); absent = strict ranges are Musts, as before. */
  must?: boolean;
}

export const MAX_RANGES = 8;
/** A search keeps up to this many ranges on this device (the panel sends them as v2, ≤ 20 criteria). */
export const MAX_STORED_RANGES = 20;
export type RangeFactorId = `range:${string}`;
const RANGE_LAYER_RE = /^(custom:)?[a-z0-9][a-z0-9-]{0,59}$/;
/** Census-derived layers outside the census- prefix: descriptive like them (api matching.DESCRIPTIVE_IDS). */
export const DESCRIPTIVE_LAYER_IDS: readonly string[] = ["student-share"];

/** A layer that describes who lives in an area: on the map, never ranked or a match criterion (is_descriptive_layer). */
export function isDescriptiveLayer(layer: string): boolean {
  return layer.startsWith("census-") || DESCRIPTIVE_LAYER_IDS.includes(layer);
}

/** Mirrors validate_ranges in api/area_api/matching.py; absent means none. */
export function assertRanges(ranges: unknown): asserts ranges is RangeCriterion[] | undefined {
  if (ranges === undefined) return;
  if (!Array.isArray(ranges) || ranges.length > MAX_STORED_RANGES) throw new Error(`at most ${MAX_STORED_RANGES} range criteria`);
  const seen = new Set<string>();
  const fields = new Set(["layer", "min", "max", "softMin", "softMax", "importance", "scale", "must"]);
  for (const item of ranges as RangeCriterion[]) {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => !fields.has(key))) throw new Error("malformed range criterion");
    if (typeof item.layer !== "string" || !RANGE_LAYER_RE.test(item.layer) || seen.has(item.layer)) throw new Error("invalid or duplicate range layer");
    if (isDescriptiveLayer(item.layer)) throw new Error(`${item.layer} describes an area and is never a match criterion`);
    seen.add(item.layer);
    const { min, max, softMin, softMax } = item;
    if (![min, max, softMin, softMax].every((bound) => bound === null || bound === undefined || (typeof bound === "number" && Number.isFinite(bound)))) {
      throw new Error("range bounds must be numbers or null");
    }
    if (min == null && max == null) throw new Error("a range needs a lowest or a highest value");
    if (min != null && max != null && min > max) throw new Error("range lowest exceeds highest");
    if (softMin != null && (min == null || softMin > min)) throw new Error("a soft edge below sits at or under the lowest value");
    if (softMax != null && (max == null || softMax < max)) throw new Error("a soft edge above sits at or over the highest value");
    if (!Number.isInteger(item.importance) || item.importance < 1 || item.importance > 5) throw new Error("range importance must be an integer from 1 to 5");
    if (item.scale !== undefined && item.scale !== "value" && item.scale !== "percentile") throw new Error("range scale must be value or percentile");
    if (item.scale === "percentile" && [min, max, softMin, softMax].some((bound) => bound != null && (bound < 0 || bound > 100))) {
      throw new Error("percentile bounds are 0-100");
    }
    if (item.must !== undefined && typeof item.must !== "boolean") throw new Error("range must is true or false");
  }
}

/** Mirrors validate_house_types in api/area_api/matching.py; absent or empty means any house. */
export function assertHouseTypes(value: unknown): asserts value is HouseType[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((item) => !HOUSE_TYPES.includes(item))) {
    throw new Error("house types must be distinct values of terraced, semi or detached");
  }
}

/** House, flat or any: any house subtype counts as a house (property_kind in api/area_api/matching.py). */
export function propertyKind(profile: Pick<PreferenceProfile, "propertyType" | "houseTypes">): "house" | "flat" | "any" {
  if (profile.houseTypes?.length) return "house";
  return profile.propertyType ?? "any";
}

export type MatchComponent = Schemas["MatchComponent"];

export type MatchResult = Schemas["MatchResult"];

/** ✓ ≈ ✗ in the popup. */
export type FitKind = "in" | "edge" | "out";

export type SimilarAreaComponent = Schemas["SimilarAreaComponent"];

export type SimilarArea = Schemas["SimilarArea"];

export type SimilarAreasResponse = Schemas["SimilarAreasResponse"];

export type StationSearchResult = Schemas["StationSearchResult"];

export type StationSearchResponse = Schemas["StationSearchResponse"];

export type MatchPack = Schemas["MatchPack"];

/** True for a match pack (either version), false for a match job. */
export function isMatchPack(value: { schemaVersion: string }): value is MatchPack {
  return value.schemaVersion === "match-pack.v1" || value.schemaVersion === "match-pack.v2";
}

// ---- v4 My match: preference-profile.v2 (contracts/openapi.yaml PreferenceProfileV2) --------------------

/** A criterion of the ordered list. Its id: affordability, range:<layer>, place:<id>, zone, custom:<id>. */
export type MatchCriterion =
  | { kind: "budget"; must?: boolean }
  /** scale value: the layer's own unit; percentile: its London percentile (0 lowest … 100 highest). */
  | { kind: "range"; layer: string; scale?: "value" | "percentile"; min: number | null; max: number | null; softMin: number | null; softMax: number | null; must?: boolean }
  | { kind: "place"; id: string; label: string; target: PlaceTarget; mode: PlaceMode; when?: PlaceWhen; targetMinutes: number; softMinutes?: number; must?: boolean }
  /** Where: fit 1 inside, falling to 0 at softMetres outside; must = only inside. */
  | { kind: "where"; zones: MatchZone[]; softMetres?: number; must?: boolean }
  | { kind: "custom"; criterion: CustomCriterion; direction: "higher" | "lower"; must?: boolean };

export type MatchCriterionKind = MatchCriterion["kind"];

/** The household's search as one ordered list: top = most important; a Must is a filter. */
export interface PreferenceProfileV2 {
  schemaVersion: "preference-profile.v2";
  market: "buy" | "rent";
  /** Budget range end: fit 1 at or under it. */
  targetBudget: number;
  /** Budget soft edge end: fit 0 at or over it; a Must budget keeps areas at or under it. */
  maximumBudget: number;
  bedrooms?: number;
  propertyType?: "house" | "flat" | "any";
  houseTypes?: HouseType[];
  criteria: MatchCriterion[];
  marks?: AreaMarks;
  /** The household agreed to a redacted usage record of the search (privacy.analytics_event); absent = no. */
  analyticsConsent?: boolean;
}

/** A criterion as the API scored it (pack.criteria). */
export type MatchCriterionEcho = Schemas["MatchCriterionEcho"];

/** GET /api/v1/match-criteria/{layer}: every area's value of a criterion layer and its London percentile. */
export type MatchCriterionValues = Schemas["MatchCriterionValues"];

export const MAX_CRITERIA = 20;
const CRITERION_FIELDS: Record<MatchCriterionKind, readonly string[]> = {
  budget: ["kind", "must"],
  range: ["kind", "layer", "scale", "min", "max", "softMin", "softMax", "must"],
  place: ["kind", "id", "label", "target", "mode", "when", "targetMinutes", "softMinutes", "must"],
  where: ["kind", "zones", "softMetres", "must"],
  custom: ["kind", "criterion", "direction", "must"],
};

/** One criterion (validate_v2 in api/area_api/match_model.py); throws on anything the API would refuse. */
export function assertMatchCriterion(item: MatchCriterion): void {
  if (!item || typeof item !== "object" || !(item.kind in CRITERION_FIELDS)) throw new Error("criterion kind must be budget, range, place, where or custom");
  const unknown = Object.keys(item).filter((key) => !CRITERION_FIELDS[item.kind].includes(key));
  if (unknown.length) throw new Error(`unknown ${item.kind} criterion field: ${unknown[0]}`);
  if (item.must !== undefined && typeof item.must !== "boolean") throw new Error("must is true or false");
  if (item.kind === "range") {
    const { must, scale = "value" } = item;
    if (!["value", "percentile"].includes(scale)) throw new Error("range scale must be value or percentile");
    assertRanges([{ layer: item.layer, min: item.min ?? null, max: item.max ?? null, softMin: must ? null : item.softMin ?? null,
      softMax: must ? null : item.softMax ?? null, importance: 1 }]);
    if (scale === "percentile" && [item.min, item.max, must ? null : item.softMin, must ? null : item.softMax]
      .some((value) => value != null && (value < 0 || value > 100))) throw new Error("percentile bounds are 0-100");
  } else if (item.kind === "place") {
    const { kind, softMinutes, must, ...place } = item;
    void kind;
    assertPlaces([{ ...place, weight: 0, must: Boolean(must) }]);
    if (softMinutes !== undefined && softMinutes !== null
      && (!Number.isInteger(softMinutes) || softMinutes < item.targetMinutes || softMinutes > 240)) {
      throw new Error("softMinutes is whole minutes from targetMinutes to 240");
    }
  } else if (item.kind === "where") {
    if (!Array.isArray(item.zones) || !item.zones.length) throw new Error("a where criterion lists 1 to 3 zones");
    assertZones(item.zones);
    if (item.softMetres !== undefined && item.softMetres !== null
      && (!Number.isInteger(item.softMetres) || item.softMetres < 100 || item.softMetres > 5000)) {
      throw new Error("softMetres is whole metres from 100 to 5000");
    }
  } else if (item.kind === "custom") {
    if (!["higher", "lower"].includes(item.direction)) throw new Error("custom direction must be higher or lower");
    assertCustomPreferences([{ criterion: item.criterion, weight: 3, direction: item.direction }]);
  }
}

/** preference-profile.v2 as the API validates it (validate_v2). */
export function assertPreferenceProfileV2(value: PreferenceProfileV2): PreferenceProfileV2 {
  if (value?.schemaVersion !== "preference-profile.v2") throw new Error("invalid profile version");
  if (!["buy", "rent"].includes(value.market)) throw new Error("unsupported housing market");
  if (!(value.targetBudget > 0) || !(value.maximumBudget >= value.targetBudget)) throw new Error("invalid housing budget");
  if (value.bedrooms !== undefined && (!Number.isInteger(value.bedrooms) || value.bedrooms < 0 || value.bedrooms > 8)) throw new Error("invalid bedroom count");
  if (value.propertyType !== undefined && !["house", "flat", "any"].includes(value.propertyType)) throw new Error("invalid property type");
  assertHouseTypes(value.houseTypes);
  assertMarks(value.marks);
  if (value.analyticsConsent !== undefined && typeof value.analyticsConsent !== "boolean") throw new Error("analyticsConsent is true or false");
  if (!Array.isArray(value.criteria) || value.criteria.length > MAX_CRITERIA) throw new Error(`criteria must be a list of at most ${MAX_CRITERIA}`);
  const ids = new Set<string>();
  const counts: Record<string, number> = {};
  for (const item of value.criteria) {
    assertMatchCriterion(item);
    const id = matchCriterionId(item);
    if (ids.has(id)) throw new Error(`duplicate criterion: ${id}`);
    ids.add(id);
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  if ((counts.budget ?? 0) > 1 || (counts.where ?? 0) > 1) throw new Error("at most one budget and one where criterion");
  if ((counts.place ?? 0) > MAX_PLACES) throw new Error(`at most ${MAX_PLACES} places`);
  return value;
}

/** A criterion's id (criterion_id in match_model.py). */
export function matchCriterionId(item: MatchCriterion): string {
  if (item.kind === "budget") return "affordability";
  if (item.kind === "range") return `range:${item.layer}`;
  if (item.kind === "place") return `place:${item.id}`;
  if (item.kind === "where") return "zone";
  return `custom:${item.criterion.id}`;
}

export type MatchJob = Schemas["MatchJob"];

export type AdmissionCutoff = Schemas["AdmissionCutoff"];

export type AdmissionEvidence = Schemas["AdmissionEvidence"];

export type SchoolStatus = "open" | "closed";

export type SchoolObservation = Schemas["SchoolObservation"];

export type SchoolSummary = Schemas["SchoolSummary"];

/** Top school: top 10% of London on the phase headline, top 25% on the second measure, and Ofsted Good+ (server-side). */
export type SchoolTopBadge = Schemas["SchoolTopBadge"];

export const FLOOD_CHECK_URL = "https://www.gov.uk/check-long-term-flood-risk";

export type FloodMechanism = "rivers-sea" | "surface-water";
export type FloodStatus = "exposed" | "no-mapped-exposure" | "no-coverage";

export interface FloodObservation {
  mechanism: FloodMechanism;
  label: string;
  exposure: number | null;
}

export interface FloodScreening {
  status: FloodStatus;
  semantics: "polygon-intersection" | "area-exposure";
  observations: FloodObservation[];
  sourceRelease: string;
  checkUrl: string;
}

export function assertFloodScreening(value: FloodScreening): FloodScreening {
  if (!["exposed", "no-mapped-exposure", "no-coverage"].includes(value.status)) {
    throw new Error("invalid flood screening status");
  }
  if (!["polygon-intersection", "area-exposure"].includes(value.semantics)) {
    throw new Error("flood screening must declare its join semantics");
  }
  for (const observation of value.observations) {
    if (observation.exposure !== null
      && (typeof observation.exposure !== "number"
        || observation.exposure < 0 || observation.exposure > 1)) {
      throw new Error(`flood exposure must be a 0-1 share or null: ${observation.mechanism}`);
    }
  }
  if (value.checkUrl.length === 0) throw new Error("flood screening needs the official check link");
  return value;
}

export type PriceForecast = Schemas["PriceForecast"];

export type JourneyRequest = Schemas["JourneyRequest"];

export type JourneyResult = Schemas["JourneyResult"];

export type PropertyTransaction = Schemas["PropertyTransaction"];

export type PropertyHistory = Schemas["PropertyHistory"];

export type AddressId = `uk:addr:${string}`;

/**
 * A home's recorded sales, oldest first, whatever answered for it: the real
 * property profile (fromProfile), an address history (fromAddressHistory) or
 * the demo dossier (a PropertyHistory already is one).
 */
export type SaleRecord = Pick<PropertyHistory, "address" | "geographyId" | "sourceVersion"> & {
  transactions: AddressSale[];
};

export function fromProfile(profile: PropertyProfile): SaleRecord {
  return {
    address: profile.displayAddress,
    geographyId: profile.areas.lsoa.id,
    sourceVersion: profile.sourceVersion,
    transactions: profile.sales.map(({ date, price, floorAreaSquareMetres }) => ({
      date, nominalPrice: price, floorAreaSquareMetres,
    })),
  };
}

export function fromAddressHistory(history: AddressHistory): SaleRecord {
  const { displayAddress, geographyId, sourceVersion, transactions } = history;
  return { address: displayAddress, geographyId, sourceVersion, transactions };
}

/** A recorded sale. No per-sale £/m² while the EPC licence is pending. */
export type AddressSale = Schemas["AddressSale"];

export type AddressHistory = Schemas["AddressHistory"];

// Other homes' sales in the same building / street (nearby-sales.v1). Rows
// deliberately carry no floor area or £/m²; the median needs 5 sales.
export type NearbySale = Schemas["NearbySale"];

export type NearbySaleGroup = Schemas["NearbySaleGroup"];

export type NearbySales = Schemas["NearbySalesResponse"];

// Local market depth and the area evidence pack (area-market.v1 /
// area-evidence-pack.v1, the `value` of the API's evidence envelope).
// Aggregates only: medians are null under 10 sales, the premium unless both
// sides have 10; leaseholdShareOfSales is a share of sales, not of homes.
export type MarketMedian = Schemas["MarketMedian"];

export type MarketSection = Schemas["MarketSection"];

export type PackSourceRelease = Schemas["SourceRelease"];

export type NearbySaleSummary = Schemas["NearbySaleSummary"];

export type AreaEvidencePack = Schemas["AreaEvidencePack"];

export interface EvidenceEnvelope<T> {
  schemaVersion: string;
  productReleaseId: string;
  dataMode: "release" | "demo";
  value: T;
  confidence: "high" | "medium" | "low" | "none";
  evidence: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  caveats: string[];
}

// ---- Postcode sectors (GET /api/v1/sectors/{slug}, docs/housemetric-gap-2026-10/sector-spec.md) ----
// Aggregates only: no per-home value or £/m², no addresses. The response is an
// EvidenceEnvelope<SectorValue>; lib/sector.ts › readSector also accepts the bare value.

/** A £/m² distribution over 24 months; the API leaves it out (null) under 20 sales. */
export interface SectorDistribution {
  sales: number;
  p09: number; p25: number; p50: number; p75: number; p91: number;
  buckets: { from: number; to: number; count: number }[];
}

export type SectorIndexZone = "sector" | "district" | "borough-house" | "borough-flat";

/** One year of an index (2004 = 100); a year with under 10 sales has null indices. */
export interface SectorIndexPoint {
  year: number;
  nominal: number | null;
  real: number | null;
  sales: number;
}

export interface SectorReturn {
  years: 1 | 5 | 10 | 20;
  zone: "sector" | "district";
  /** Compound growth a year as a fraction (0.032 = 3.2% a year); totals likewise (0.37 = +37%). */
  nominalPa: number;
  realPa: number;
  nominalTotal: number;
  realTotal: number;
}

export interface NearbySector {
  code: string;
  slug: string;
  name: string | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  sales: number;
  isSelf: boolean;
}

export interface SectorStreet {
  name: string;
  sales: number;
  medianFloorArea: number | null;
  medianPpm: number | null;
}

export interface SectorValue {
  sector: {
    code: string;
    slug: string;
    name: string | null;
    district: string;
    borough: { id: string; name: string } | null;
    postcodeCount: number;
    geometry: Polygon | MultiPolygon | null;
  };
  distribution: {
    periodEnd: string;
    sector: SectorDistribution | null;
    district: SectorDistribution | null;
  } | null;
  index: { base: number; series: { zone: SectorIndexZone; points: SectorIndexPoint[] }[] } | null;
  returns: SectorReturn[];
  nearby: NearbySector[];
  streets: SectorStreet[];
}

export type SectorResponse = EvidenceEnvelope<SectorValue>;

/** GET /api/v1/sectors?q=W5: prefix match, at most 20. */
export interface SectorListItem {
  code: string;
  slug: string;
  name: string | null;
  /** [lon, lat] a point inside the sector (a q search only). */
  center?: [number, number] | null;
}

export function addressId(value: string): AddressId {
  if (!/^uk:addr:[0-9a-f]{12}$/.test(value)) throw new Error(`invalid address id: ${value}`);
  return value as AddressId;
}

export function geographyId(carrier: Carrier | TileKind, officialCode: string): GeographyId {
  if (!/^E\d{8}$/.test(officialCode)) {
    throw new Error(`invalid official geography code: ${officialCode}`);
  }
  return `uk:${carrierOf(carrier)}:${officialCode}`;
}

export function schoolId(urn: string): SchoolId {
  if (!/^\d{6}$/.test(urn)) throw new Error(`invalid school URN: ${urn}`);
  return `uk:school:${urn}`;
}

export function assertMetricDefinition(value: MetricDefinition): MetricDefinition {
  if (!METRIC_IDS.includes(value.id) || value.periods.length === 0) {
    throw new Error("invalid metric definition");
  }
  if (!value.periods.includes(value.defaultPeriod) || value.legend.length < 2) {
    throw new Error(`metric ${value.id} has an invalid period or legend`);
  }
  if (!/^[0-9a-f]{64}$/.test(value.provenance.checksum)
    || value.provenance.transformationVersion.length === 0) {
    throw new Error(`metric ${value.id} has invalid provenance`);
  }
  return value;
}

export function assertAreaSummary(value: AreaSummary): AreaSummary {
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(value.geographyId)) {
    throw new Error("invalid area geography ID");
  }
  _assertPercentile(value.regionPercentile);
  _assertPercentile(value.countryPercentile);
  return value;
}

export function assertAreaResponse(value: AreaResponse): AreaResponse {
  if (value.schemaVersion !== "area-summary.v1") throw new Error("invalid area response version");
  assertAreaSummary(value.summary);
  for (const entry of [...value.priceTimeline, ...value.metricTimeline]) {
    assertAreaSummary(entry);
  }
  return value;
}

export function assertPropertyHistoryResponse(value: PropertyHistoryResponse): PropertyHistoryResponse {
  if (value.schemaVersion !== "property-history.v1") {
    throw new Error("invalid property history version");
  }
  if (!/^[0-9]+$/.test(value.history.uprn)) {
    throw new Error(`invalid property UPRN: ${value.history.uprn}`);
  }
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(value.history.geographyId)) {
    throw new Error("invalid property geography ID");
  }
  return value;
}

export function assertPreferenceProfile(value: PreferenceProfile): PreferenceProfile {
  if (value.schemaVersion !== "preference-profile.v1") throw new Error("invalid profile version");
  value.school.characteristics ??= [];
  value.school.facetWeights ??= { progress: 3, attainment: 2, attendance: 1 };
  if (value.targetBudget <= 0 || value.maximumBudget < value.targetBudget) {
    throw new Error("invalid housing budget");
  }
  if (value.factors.some((factor) => factor.weight < 0 || factor.weight > 5)) {
    throw new Error("factor weight must be between 0 and 5");
  }
  if (value.factors.some((factor) => !FACTOR_IDS.includes(factor.factorId))) {
    throw new Error("unsupported profile factor");
  }
  if (value.factors.some((factor) => !["higher", "lower", "target-range"].includes(factor.direction))) {
    throw new Error("unsupported factor direction");
  }
  for (const factor of value.factors) {
    for (const bound of [factor.minimumUtility, factor.maximumUtility]) {
      if (bound !== null && (typeof bound !== "number" || bound < 0 || bound > 100)) {
        throw new Error(`factor utility bound must be 0-100 or null: ${factor.factorId}`);
      }
    }
    if (factor.minimumUtility !== null && factor.maximumUtility !== null
      && factor.minimumUtility > factor.maximumUtility) {
      throw new Error(`factor minimum exceeds maximum: ${factor.factorId}`);
    }
  }
  if (new Set(value.factors.map((factor) => factor.factorId)).size !== value.factors.length) {
    throw new Error("duplicate profile factor");
  }
  if (Object.values(value.school.facetWeights).some((weight) => weight < 0 || weight > 5)) {
    throw new Error("school facet weight must be between 0 and 5");
  }
  assertZones(value.zones);
  if (value.propertyType !== undefined && !["house", "flat", "any"].includes(value.propertyType)) {
    throw new Error("invalid property type");
  }
  assertHouseTypes(value.houseTypes);
  assertPlaces(value.places);
  assertMarks(value.marks);
  assertCustomPreferences(value.custom);
  assertRanges(value.ranges);
  if (value.order !== undefined && (!Array.isArray(value.order) || value.order.length > MAX_ORDER
    || value.order.some((id) => typeof id !== "string" || id.length > 80))) {
    throw new Error("invalid criteria order");
  }
  if (value.where !== undefined) {
    const { must, softMetres } = value.where ?? {};
    if (typeof value.where !== "object" || value.where === null || (must !== undefined && typeof must !== "boolean")
      || (softMetres !== undefined && !(Number.isInteger(softMetres) && softMetres >= 100 && softMetres <= 5000))) {
      throw new Error("invalid where criterion");
    }
  }
  // The two inline answers only order suggestions: anything unreadable is dropped, never the search.
  if (value.suggest !== undefined) {
    const { kids, drive } = (value.suggest ?? {}) as { kids?: unknown; drive?: unknown };
    value.suggest = { ...(typeof kids === "boolean" ? { kids } : {}), ...(typeof drive === "boolean" ? { drive } : {}) };
  }
  // Tailor answers are a convenience: an unknown one is dropped rather than losing the whole search.
  if (value.household != null && !HOUSEHOLDS.includes(value.household)) value.household = null;
  if (value.lifestyle !== undefined) {
    value.lifestyle = Array.isArray(value.lifestyle)
      ? [...new Set(value.lifestyle.filter((entry) => LIFESTYLES.includes(entry)))].slice(0, MAX_LIFESTYLE)
      : undefined;
  }
  return value;
}

/** Mirrors validate_places in api/area_api/matching.py. */
export function assertPlaces(places: unknown): asserts places is PlacePreference[] | undefined {
  if (places === undefined) return;
  if (!Array.isArray(places) || places.length > MAX_PLACES) throw new Error(`at most ${MAX_PLACES} places`);
  const ids = new Set<string>();
  for (const place of places as PlacePreference[]) {
    if (!PLACE_ID_RE.test(place.id) || ids.has(place.id)) throw new Error("invalid or duplicate place id");
    ids.add(place.id);
    if (typeof place.label !== "string" || place.label.length < 1 || place.label.length > 60) throw new Error("invalid place label");
    const target = place.target;
    if (target?.kind === "point") {
      if (!(Math.abs(target.latitude) <= 90 && Math.abs(target.longitude) <= 180)) throw new Error("invalid place coordinates");
    } else if (target?.kind === "category") {
      if (!PLACE_CATEGORIES.includes(target.category)) throw new Error("invalid place target");
      for (const key of ["brand", "sport"] as const) {
        const value = target[key];
        if (value !== undefined && !(typeof value === "string" && PLACE_FILTER_RE.test(value))) throw new Error(`invalid place ${key}`);
      }
    } else if (target?.kind === "any-of") {
      const points: unknown = target.points;
      if (!Array.isArray(points) || points.length < ANY_OF_POINTS.min || points.length > ANY_OF_POINTS.max
        || !points.every((point) => isLatLon(point))) {
        throw new Error(`a near-any-of place lists ${ANY_OF_POINTS.min} to ${ANY_OF_POINTS.max} [latitude, longitude] points`);
      }
    } else if (target?.kind === "school") {
      if (!SCHOOL_PHASES.includes(target.phase) || !Number.isInteger(target.top) || target.top < 1 || target.top > MAX_TOP_SCHOOLS) {
        throw new Error("invalid school rule");
      }
      const rankBy = target.rankBy ?? "results";
      if (!SCHOOL_RANKINGS.includes(rankBy) || (rankBy === "progress8" && target.phase !== "secondary")) {
        throw new Error("invalid school ranking");
      }
    } else if (target?.kind === "school-filter") {
      if (!isSchoolFilterText(target.filter)) throw new Error("invalid school filter");
      if (target.within !== undefined && (!Number.isInteger(target.within) || target.within < SCHOOL_WITHIN_METRES.min || target.within > SCHOOL_WITHIN_METRES.max)) {
        throw new Error(`a school filter's within is ${SCHOOL_WITHIN_METRES.min} to ${SCHOOL_WITHIN_METRES.max} metres`);
      }
    } else {
      throw new Error("invalid place target");
    }
    if (!PLACE_MODES.includes(place.mode)) throw new Error("invalid place mode");
    if (place.when !== undefined && !PLACE_WHENS.includes(place.when)) throw new Error("invalid place time band");
    if (!Number.isInteger(place.targetMinutes) || place.targetMinutes < 1 || place.targetMinutes > 120) throw new Error("place minutes must be 1-120");
    if (!Number.isInteger(place.weight) || place.weight < 0 || place.weight > 5) throw new Error("place weight must be 0-5");
    if (typeof place.must !== "boolean") throw new Error("invalid place must flag");
    if (place.softMinutes !== undefined
      && (!Number.isInteger(place.softMinutes) || place.softMinutes < place.targetMinutes || place.softMinutes > 240)) {
      throw new Error("place soft edge is whole minutes from the target to 240");
    }
  }
}

/** Mirrors validate_marks in api/area_api/matching.py. */
export function assertMarks(marks: unknown): asserts marks is AreaMarks | undefined {
  if (marks === undefined) return;
  const value = marks as AreaMarks;
  for (const list of [value.liked, value.excluded]) {
    if (!Array.isArray(list) || list.length > MAX_MARKED_AREAS || !list.every((id) => GEOGRAPHY_ID_RE.test(id))) {
      throw new Error("marks must list area ids");
    }
  }
  const notes = Object.entries(value.notes ?? {});
  if (notes.length > MAX_MARKED_AREAS || notes.some(([id, text]) => !GEOGRAPHY_ID_RE.test(id) || typeof text !== "string" || text.length > 280)) {
    throw new Error("invalid area notes");
  }
}

/** Mirrors validate_zones in api/area_api/matching.py; absent or empty means no zones. */
export function assertZones(zones: unknown): asserts zones is MatchZone[] | undefined {
  if (zones === undefined) return;
  if (!Array.isArray(zones)) throw new Error("zones must be a list");
  if (zones.length > MAX_ZONES) throw new Error(`at most ${MAX_ZONES} zones`);
  for (const zone of zones as MatchZone[]) assertZone(zone);
}

function assertZone(zone: MatchZone): void {
  if (typeof zone !== "object" || zone === null || !(zone.kind in ZONE_FIELDS)) {
    throw new Error("zone kind must be station, borough, lsoas or polygon");
  }
  const unknown = Object.keys(zone).filter((key) => !ZONE_FIELDS[zone.kind].includes(key));
  if (unknown.length) throw new Error(`unknown ${zone.kind} zone field: ${unknown[0]}`);
  if (zone.label !== undefined && (typeof zone.label !== "string" || zone.label.length > ZONE_LABEL_MAX)) {
    throw new Error(`zone label must be text of at most ${ZONE_LABEL_MAX} characters`);
  }
  if (zone.kind === "station") {
    if (typeof zone.stationId !== "string" || !STATION_ID_RE.test(zone.stationId)) throw new Error("invalid station id");
    if (!Number.isInteger(zone.maxWalkMinutes)
      || zone.maxWalkMinutes < ZONE_WALK_MINUTES.min || zone.maxWalkMinutes > ZONE_WALK_MINUTES.max) {
      throw new Error(`station zone walk minutes must be an integer from ${ZONE_WALK_MINUTES.min} to ${ZONE_WALK_MINUTES.max}`);
    }
  } else if (zone.kind === "borough") {
    if (typeof zone.id !== "string" || !/^uk:lad:E\d{8}$/.test(zone.id)) throw new Error("invalid borough zone id");
  } else if (zone.kind === "polygon") {
    assertPolygonPoints(zone.points);
  } else {
    const ids = zone.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_ZONE_LSOAS) {
      throw new Error(`an area zone lists 1 to ${MAX_ZONE_LSOAS} LSOA ids`);
    }
    if (ids.some((id) => typeof id !== "string" || !/^uk:lsoa:E\d{8}$/.test(id))) {
      throw new Error("area zone ids must be LSOA geography ids");
    }
    if (new Set(ids).size !== ids.length) throw new Error("duplicate LSOA id in an area zone");
  }
}

/**
 * A drawn zone's corners, in England: the widest box the API takes (scope.ENGLAND.bbox, CLOSE_KNIT_ENGLAND on).
 * The API holds the flag and checks its own box, so a saved search or a link is never dropped here for a coverage
 * the page has not loaded yet; a new drawing follows the loaded coverage (zones.drawnZone).
 */
function assertPolygonPoints(points: unknown): void {
  const corners = `a drawn zone has ${POLYGON_POINTS.min} to ${POLYGON_POINTS.max} corners`;
  if (!Array.isArray(points) || points.length < POLYGON_POINTS.min || points.length > POLYGON_POINTS.max) throw new Error(corners);
  if (!points.every((point) => isLatLon(point, ENGLAND_BOX))) {
    throw new Error("drawn zone corners must be [latitude, longitude] in England");
  }
  if (new Set(points.map((point) => JSON.stringify(point))).size < POLYGON_POINTS.min) throw new Error(corners);
}

/** A [latitude, longitude] pair of plain numbers, on the globe or inside `box`; mirrors matching._is_lat_lon. */
export function isLatLon(point: unknown, box?: { latitude: readonly [number, number]; longitude: readonly [number, number] }): boolean {
  if (!Array.isArray(point) || point.length !== 2 || !point.every((value) => typeof value === "number" && Number.isFinite(value))) return false;
  const [lat, lon] = point as [number, number];
  const [latLow, latHigh] = box?.latitude ?? [-90, 90];
  const [lonLow, lonHigh] = box?.longitude ?? [-180, 180];
  return lat >= latLow && lat <= latHigh && lon >= lonLow && lon <= lonHigh;
}

function _assertPercentile(value: number | null): void {
  if (value !== null && (value < 0 || value > 100)) {
    throw new Error("percentile must be between 0 and 100");
  }
}
