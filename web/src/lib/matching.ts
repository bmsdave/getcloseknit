import type {
  FactorId,
  GeographyId,
  MatchComponent,
  MatchCriterionValues,
  MatchLimitId,
  MatchPack,
  MatchResult,
  PreferenceProfile,
  PreferenceProfileV2,
  Quality,
  PlaceCategory,
  PlacePreference,
  ValuePack,
} from "./contracts";
import { isDescriptiveLayer } from "./contracts";
import { CUSTOM_UNITS, previewCustomValues } from "./custom-criteria";
import { presetBySlug } from "./custom-presets";
import { getValuePack, isForecastHorizonValidated, METRICS } from "./fixtures";
import {
  boundWords, criterionWords, LAYER_FACTORS, plainNumber, profileZones, rankResults, relax, scorePack, softMetres, specs, zoneDistances,
  type EvidenceRow, type Spec,
} from "./match-model";
import { matchMapValue, matchPercentiles } from "./match-map";
import { previewZoneLsoas } from "./zones";

interface PreviewFactor {
  rawValue: number;
  percentile: number;
  carrierGeographyId: GeographyId;
  quality: Quality;
  sourceVersion: string;
}

interface PreviewMatchArea {
  geographyId: GeographyId;
  name: string;
  purchasePrice: number;
  monthlyRent: number;
  factors: Partial<Record<FactorId, PreviewFactor>>;
}

export interface RawMatchFactor {
  rawValue: number;
  percentile: number;
  carrierGeographyId: GeographyId;
  quality: Quality;
  sourceVersion: string;
}

export interface RawMatchArea {
  geographyId: GeographyId;
  name: string;
  price: number;
  // Legacy preview scalar. The real scorer never reads it: observed rent
  // arrives as borough-carried bedroom cells in RentContext, and any
  // user-entered asking rent is display-only, never evidence.
  monthlyRent: number;
  journeys: Record<string, number>;
  factors: Partial<Record<FactorId, RawMatchFactor>>;
  /** Custom criteria by factor id `custom:<id>`: raw value and London percentile ("more of it"). */
  custom?: Record<string, RawMatchFactor & { unit: string }>;
  /** Range criteria by factor id `range:<layer>`: the layer's own value for the area and its London percentile when known. */
  ranges?: Record<string, Omit<RawMatchFactor, "percentile"> & { unit: string; percentile?: number | null }>;
}

// One observed ONS private-rent cell: a borough median monthly rent for a
// single bedroom category over a stated 12-month reference window.
export interface ObservedRentCell {
  carrierGeographyId: GeographyId;
  bedrooms: string;
  medianMonthlyRent: number;
  period: string;
  sourceVersion: string;
}

export interface RentContext {
  observed: ObservedRentCell[];
  lsoaToBorough: Record<string, GeographyId>;
}

export const RENT_MONTHLY_BUDGET_CEILING = 20_000;
const BOROUGH_ID_RE = /^uk:lad:E\d{8}$/;
const LSOA_ID_RE = /^uk:lsoa:E\d{8}$/;

export interface ProfileTelemetryEvent {
  market: PreferenceProfile["market"];
  budgetBand: number;
  bedrooms: number;
  forecastHorizon: PreferenceProfile["forecastHorizon"];
  factorWeights: Partial<Record<FactorId, number>>;
  destinationCount: number;
  destinationModes: string[];
  schoolPhases: string[];
}

const AREAS: PreviewMatchArea[] = [
  previewMatchArea("uk:lsoa:E01000001", "Westminster preview", 600_000, 2_900, {
    "market-level": previewFactor(9_600, 92, "uk:lsoa:E01000001", "observed", "preview-price-2026-06"),
    crime: previewFactor(54, 22, "uk:lsoa:E01000001", "observed", "preview-police-2026-06"),
    deprivation: previewFactor(8, 80, "uk:lsoa:E01000001", "observed", "preview-imd-2025"),
    income: previewFactor(72_000, 90, "uk:msoa:E02000001", "observed", "preview-income-2023"),
    "social-renting": previewFactor(14, 30, "uk:lsoa:E01000001", "observed", "preview-census-2021"),
    schools: previewFactor(3, 85, "uk:lsoa:E01000001", "observed", "preview-schools-2026"),
    "station-access": previewFactor(4.2, 8, "uk:lsoa:E01000001", "observed", "preview-osm-2026-09"),
    ...previewQuickFactors("uk:lsoa:E01000001", [71, 88], [95, 92], [48, 70], [88, 90]),
  }),
  previewMatchArea("uk:lsoa:E01000002", "North London preview", 440_000, 2_100, {
    "market-level": previewFactor(6_800, 38, "uk:msoa:E02000002", "fallback", "preview-price-2026-06"),
    crime: previewFactor(112, 70, "uk:lsoa:E01000002", "observed", "preview-police-2026-06"),
    deprivation: previewFactor(4, 40, "uk:lsoa:E01000002", "observed", "preview-imd-2025"),
    income: previewFactor(43_000, 45, "uk:msoa:E02000002", "observed", "preview-income-2023"),
    "social-renting": previewFactor(37, 75, "uk:lsoa:E01000002", "observed", "preview-census-2021"),
    schools: previewFactor(3, 65, "uk:lsoa:E01000002", "observed", "preview-schools-2026"),
    "station-access": previewFactor(13.5, 78, "uk:lsoa:E01000002", "observed", "preview-osm-2026-09"),
    ...previewQuickFactors("uk:lsoa:E01000002", [32, 30], [24, 45], [31, 25], [40, 35]),
  }),
  previewMatchArea("uk:lsoa:E01000003", "South Bank preview", 510_000, 2_400, {
    "market-level": previewFactor(7_450, 61, "uk:lsoa:E01000003", "observed", "preview-price-2026-06"),
    crime: previewFactor(76, 45, "uk:lsoa:E01000003", "observed", "preview-police-2026-06"),
    deprivation: previewFactor(6, 60, "uk:lsoa:E01000003", "observed", "preview-imd-2025"),
    income: previewFactor(52_000, 62, "uk:msoa:E02000003", "observed", "preview-income-2023"),
    "social-renting": previewFactor(29, 58, "uk:lsoa:E01000003", "observed", "preview-census-2021"),
    schools: previewFactor(3, 74, "uk:lsoa:E01000003", "observed", "preview-schools-2026"),
    "station-access": previewFactor(7.8, 41, "uk:lsoa:E01000003", "observed", "preview-osm-2026-09"),
    ...previewQuickFactors("uk:lsoa:E01000003", [55, 62], [41, 70], [44, 60], [79, 82]),
  }),
];

/** Fixed preview values ([raw, percentile]) for noise, disorder, EPC A-C share and leasehold share. */
function previewQuickFactors(id: GeographyId, noise: [number, number], disorder: [number, number],
  epc: [number, number], leasehold: [number, number]): Partial<Record<FactorId, PreviewFactor>> {
  return {
    noise: previewFactor(noise[0], noise[1], id, "observed", "preview-defra-noise-2022"),
    disorder: previewFactor(disorder[0], disorder[1], id, "observed", "preview-police-2026-06"),
    "epc-share": previewFactor(epc[0], epc[1], id, "observed", "preview-epc-2026"),
    "leasehold-share": previewFactor(leasehold[0], leasehold[1], id, "observed", "preview-hmlr-2026-07"),
  };
}

// Explicit preview LSOA-to-borough parents. Preview rent evidence is fixed
// per preview borough for the 2-bedroom cell only; every other bedroom
// count is honestly missing, and the constants never enter real mode.
const PREVIEW_RENT_LOOKUP: Record<string, GeographyId> = {
  "uk:lsoa:E01000001": "uk:lad:E09000001",
  "uk:lsoa:E01000002": "uk:lad:E09000002",
  "uk:lsoa:E01000003": "uk:lad:E09000003",
};

function previewRentContext(): RentContext {
  return {
    observed: AREAS.map((area) => ({
      carrierGeographyId: PREVIEW_RENT_LOOKUP[area.geographyId],
      bedrooms: "2 bedrooms",
      medianMonthlyRent: area.monthlyRent,
      period: "preview-2026-07",
      sourceVersion: "preview-ons-rent-2026-07",
    })),
    lsoaToBorough: { ...PREVIEW_RENT_LOOKUP },
  };
}

const UNITS: Record<FactorId, string> = {
  affordability: "budget fit",
  "market-level": "£/m²",
  "growth-outlook": "% real growth",
  crime: "per 1,000",
  deprivation: "decile",
  income: "£/year",
  "social-renting": "%",
  commute: "minutes",
  schools: "reachable options",
  "station-access": "minutes",
  noise: "% of homes ≥55 dB",
  disorder: "per 1,000",
  "epc-share": "% of homes rated A-C",
  "leasehold-share": "% of sales leasehold",
};
const SOURCE_RELEASE_SET = "preview-open-data-2026-09";

/** The preview match (fixtures, demo mode): the model over the three preview areas. */
export function buildMatchPack(profile: AnyProfile, relaxed: MatchLimitId[] = []): MatchPack {
  const zones = profileZones(profile);
  const inside = previewZoneLsoas(zones);
  const distances = inside ? zoneDistances(inside, new Map(AREAS.map((area, index) => [area.geographyId, PREVIEW_ORIGINS[index] as [number, number]])),
    softMetres(profile)) : null;
  return scoreMatchPack(profile, AREAS.map((area) => toRawArea(area, profile)), previewRentContext(), relaxed, inside, distances);
}

/** Preview area vectors for the similar-areas mirror (utility = stored percentile). */
export function previewAreaVectors(): Array<{
  geographyId: GeographyId;
  name: string;
  factors: Partial<Record<FactorId, { rawValue: number; utility: number; unit: string }>>;
}> {
  return AREAS.map((area) => ({
    geographyId: area.geographyId,
    name: area.name,
    factors: Object.fromEntries(Object.entries(area.factors).map(([factorId, factor]) => [
      factorId, { rawValue: factor.rawValue, utility: factor.percentile, unit: UNITS[factorId as FactorId] },
    ])),
  }));
}

/** A v1 profile (the current panel) or a v2 one (ordered criteria). */
export type AnyProfile = PreferenceProfile | PreferenceProfileV2;

/**
 * The match over raw areas (lib/match-model.ts scorePack): `zoneLsoas` is the zones expanded to LSOA ids and
 * `zoneDistance` the metres outside them (null: no zones). Mirrors build_match_pack in api/area_api/matching.py.
 */
export function scoreMatchPack(
  profile: AnyProfile,
  areas: RawMatchArea[],
  rentContext: RentContext = { observed: [], lsoaToBorough: {} },
  relaxed: MatchLimitId[] = [],
  zoneLsoas: ReadonlySet<string> | null = null,
  zoneDistance: ReadonlyMap<string, number> | null = null,
): MatchPack {
  assertRentLookup(rentContext.lsoaToBorough);
  const rows = areas.flatMap((area) => rawAreaRows(area, profile, rentContext));
  return scorePack(profile, rows, { relaxed, zoneLsoas, zoneDistance, sourceReleaseSet: SOURCE_RELEASE_SET,
    areas: areas.map((area) => ({ geographyId: area.geographyId, name: area.name })) });
}

/** A raw area as evidence rows (load_match_evidence's shape): budget, factors, journeys, places, own criteria, ranges. */
function rawAreaRows(area: RawMatchArea, profile: AnyProfile, rentContext: RentContext): EvidenceRow[] {
  const base = { geographyId: area.geographyId, name: area.name };
  const rows: EvidenceRow[] = [];
  const price = affordabilityFactor(area, profile, rentContext);
  if (price) {
    rows.push({ ...base, factorId: "affordability", rawValue: price.rawValue, unit: profile.market === "rent" ? "£/month" : UNITS.affordability,
      carrierGeographyId: price.carrierGeographyId, quality: price.quality, sourceVersion: price.sourceVersion });
  }
  const horizon = "forecastHorizon" in profile ? profile.forecastHorizon : "1y";
  for (const [factorId, factor] of Object.entries(area.factors)) {
    // Growth stays out until its own horizon passes the forecast validation gate: no fixture extrapolation.
    if (!factor || (factorId === "growth-outlook" && !isForecastHorizonValidated(horizon))) continue;
    rows.push({ ...base, factorId, rawValue: factor.rawValue, percentile: factor.percentile, unit: UNITS[factorId as FactorId] ?? "",
      carrierGeographyId: factor.carrierGeographyId, quality: factor.quality, sourceVersion: factor.sourceVersion });
  }
  for (const [key, minutes] of Object.entries(area.journeys)) {
    if (key.startsWith("place:")) {
      rows.push({ ...base, factorId: key, rawValue: Math.round(minutes * 10) / 10, unit: "minutes", carrierGeographyId: area.geographyId,
        quality: "fallback", sourceVersion: "estimate-straight-line-v1" });
    } else {
      rows.push({ ...base, factorId: "commute", destinationId: key, rawValue: minutes, unit: "minutes", carrierGeographyId: area.geographyId,
        quality: "observed", sourceVersion: "preview-r5-network-2026-09" });
    }
  }
  for (const [factorId, value] of Object.entries(area.custom ?? {})) {
    rows.push({ ...base, factorId, rawValue: value.rawValue, percentile: value.percentile, unit: value.unit,
      carrierGeographyId: value.carrierGeographyId, quality: value.quality, sourceVersion: value.sourceVersion });
  }
  for (const [factorId, value] of Object.entries(area.ranges ?? {})) {
    rows.push({ ...base, factorId, rawValue: value.rawValue, percentile: value.percentile ?? null, unit: value.unit,
      carrierGeographyId: value.carrierGeographyId, quality: value.quality, sourceVersion: value.sourceVersion });
  }
  return rows;
}

/** The pack with these Musts, zones or marks lifted (apply_relaxation); with the profile, ties break as scored. */
export function applyRelaxation(pack: MatchPack, relaxed: MatchLimitId[] = [], profile: AnyProfile | null = null): MatchPack {
  return relax(pack, relaxed, profile);
}

/** Every criterion of the profile with its id, weight (rank-order centroid; 0 for a Must) and Must flag. */
export function allPreferences(profile: AnyProfile): { factorId: string; weight: number; must: boolean }[] {
  return specs(profile).map((entry) => ({ factorId: entry.id, weight: entry.weight, must: entry.must }));
}

/** Each unmet limit in the household's words (describe_unmet_limits in matching.py). */
export function describeUnmetLimits(result: MatchResult, profile: AnyProfile): string[] {
  const byId = new Map(specs(profile).map((entry) => [entry.id, entry]));
  const components = new Map(result.components.map((component) => [component.factorId as string, component]));
  return result.unmetLimits.map((code) => describeLimit(code, byId, components, profile));
}

function describeLimit(code: string, byId: Map<string, Spec>, components: Map<string, MatchComponent>, profile: AnyProfile): string {
  const id = limitFactor(code);
  if (id === "zone") return "Outside the zones you chose";
  if (id === "mark") return "You ruled this area out";
  const entry = byId.get(id);
  const component = components.get(id);
  const name = criterionWords(id, entry);
  if (code.endsWith(":missing") || !component || !entry) return `No ${name.toLowerCase()} evidence to check your ${boundWords(entry)}`;
  if (entry.kind === "budget") {
    if (profile.market === "rent") {
      return `Rent £${Math.round(component.rawValue).toLocaleString("en-GB")} a month is over your £${Math.round(profile.maximumBudget).toLocaleString("en-GB")}`;
    }
    return `Ballpark ${poundsShort(component.rawValue)} is over your ${poundsShort(profile.maximumBudget)}`;
  }
  if (entry.item.kind === "place") {
    return `${entry.item.label}: about ${Math.round(component.rawValue)} min, over your ${entry.item.targetMinutes ?? component.targetMinutes}`;
  }
  return `${name} ${plainNumber(component.rawValue)}${component.unit ? ` ${component.unit}` : ""} is outside your ${boundWords(entry)}`;
}

function poundsShort(value: number): string {
  return value >= 1_000_000 ? `£${(value / 1_000_000).toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}m` : `£${Math.round(value / 1000)}k`;
}

/** The relaxable id of an unmet-limit code, as limit_id in matching.py:
 * "range:crime:outside" -> "range:crime", "place:gym:outside" -> "place:gym", "zone:outside" -> "zone". */
export function limitFactor(code: string): MatchLimitId {
  return code.slice(0, code.lastIndexOf(":")) as MatchLimitId;
}

export const MARK_LIMIT = "mark:excluded";

// Straight-line estimates, the same formulas as api/area_api/personal_places.py.
const DETOUR = 1.3;
const SPEED_KMH: Record<string, number> = { walk: 4.8, cycle: 15, car: 20 };

export function estimatePlaceMinutes(km: number, mode: string, stationWalk: number | null = null): number {
  if (mode in SPEED_KMH) return km * DETOUR / SPEED_KMH[mode] * 60;
  const transit = (stationWalk ?? 15) + 5 + km * 1.25 / 30 * 60;
  return Math.min(transit, km * DETOUR / SPEED_KMH.walk * 60);
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Preview areas have no amenity data: a fixed distance to the nearest of each kind.
const PREVIEW_NEAREST_METRES: Record<PlaceCategory, number[]> = {
  park: [350, 900, 200], cafe: [80, 150, 60], supermarket: [400, 650, 300], convenience: [120, 200, 90],
  gp: [500, 800, 450], pharmacy: [300, 400, 250], pub: [150, 100, 120], restaurant: [90, 140, 70],
  gym: [450, 300, 600], pool: [1400, 900, 1800], sports_club: [700, 1200, 500],
  step_free_station: [300, 1400, 650],
};
// ...and to the nearest school that qualifies for a "top N" rule (further for a stricter rule).
const PREVIEW_TOP_SCHOOL_METRES = [1600, 2400, 1100];

type PreviewPlace = Pick<PlacePreference, "target" | "mode">;

function placeMinutes(area: PreviewMatchArea, place: PreviewPlace): number {
  const index = AREAS.indexOf(area);
  if (place.target.kind === "category" || place.target.kind === "school" || place.target.kind === "school-filter") {
    const mode = place.mode === "cycle" || place.mode === "car" ? place.mode : "walk";
    // A school filter: the preview's top-10 distance, beyond its `within` there is none (no data, as the API).
    const metres = place.target.kind === "school"
      ? PREVIEW_TOP_SCHOOL_METRES[index] * Math.sqrt(10 / place.target.top)
      : place.target.kind === "school-filter"
        ? (place.target.within !== undefined && PREVIEW_TOP_SCHOOL_METRES[index] > place.target.within ? Number.NaN : PREVIEW_TOP_SCHOOL_METRES[index])
        : PREVIEW_NEAREST_METRES[place.target.category][index];
    return estimatePlaceMinutes(metres / 1000, mode);
  }
  const [lat, lon] = PREVIEW_ORIGINS[index];
  // Near any of: the quickest of the points, as personal_places.place_rows takes the best row.
  const points = place.target.kind === "any-of" ? place.target.points : [[place.target.latitude, place.target.longitude]];
  return Math.min(...points.map(([latitude, longitude]) => estimatePlaceMinutes(haversineKm(lat, lon, latitude, longitude), place.mode, 6)));
}

/** A preview area with the evidence the profile's criteria read (places, own criteria, layer ranges). */
function toRawArea(area: PreviewMatchArea, profile: AnyProfile): RawMatchArea {
  const journeys: Record<string, number> = {};
  for (const destination of "commuteDestinations" in profile ? profile.commuteDestinations : []) {
    journeys[destination.id] = previewJourneyMinutes(area, destination.latitude, destination.longitude, destination.mode);
  }
  const custom: NonNullable<RawMatchArea["custom"]> = {};
  const ranges: NonNullable<RawMatchArea["ranges"]> = {};
  const index = AREAS.indexOf(area);
  for (const entry of specs(profile)) {
    const item = entry.item;
    if (item.kind === "place") {
      const minutes = placeMinutes(area, item);
      if (Number.isFinite(minutes)) journeys[entry.id] = minutes;
    } else if (item.kind === "custom") {
      // Preview areas have no places on the map: fixed demo counts per criterion (lib/custom-criteria.ts).
      const value = previewCustomValues(item.criterion).find((candidate) => candidate.geographyId === area.geographyId);
      if (value?.value == null || value.percentile === null) continue;
      custom[entry.id] = { rawValue: value.value, percentile: value.percentile, carrierGeographyId: area.geographyId, quality: "observed",
        sourceVersion: "preview-osm-2026-09", unit: CUSTOM_UNITS[item.criterion.formula] };
    } else if (item.kind === "range" && entry.source === entry.id) {
      const value = previewRangeValue(item.layer, index);
      if (value) ranges[entry.id] = value;
    }
  }
  return {
    geographyId: area.geographyId,
    name: area.name,
    price: area.purchasePrice,
    monthlyRent: area.monthlyRent,
    journeys,
    factors: area.factors,
    custom,
    ranges,
  };
}

/**
 * A preview area's value of a layer: the map fixture's (metrics), the demo place counts (ready-made criteria), or the
 * preview factor of the same name (disorder, schools … : layers without a map value pack).
 */
function previewRangeValue(layer: string, index: number): NonNullable<RawMatchArea["ranges"]>[string] | null {
  if (layer.startsWith("custom:")) {
    const preset = presetBySlug(layer.slice("custom:".length));
    const value = preset ? previewCustomValues(preset.criterion)[index] : null;
    return value?.value == null || !preset ? null : {
      rawValue: value.value, percentile: value.percentile, unit: CUSTOM_UNITS[preset.criterion.formula], carrierGeographyId: AREAS[index].geographyId,
      quality: "observed", sourceVersion: "preview-osm-2026-09",
    };
  }
  const metric = METRICS.find((entry) => entry.id === layer);
  if (!metric) {
    const factor = AREAS[index].factors[LAYER_FACTORS[layer] as FactorId];
    return factor ? { rawValue: factor.rawValue, percentile: factor.percentile, unit: UNITS[LAYER_FACTORS[layer] as FactorId] ?? "",
      carrierGeographyId: factor.carrierGeographyId, quality: factor.quality, sourceVersion: factor.sourceVersion } : null;
  }
  const entry = (getValuePack(metric.id, metric.defaultPeriod) as ValuePack).values[index];
  return entry?.value == null ? null : {
    rawValue: entry.value, percentile: entry.regionPercentile ?? null, unit: metric.unit, carrierGeographyId: entry.geographyId,
    quality: entry.quality, sourceVersion: metric.provenance.release,
  };
}

export function telemetryProfile(profile: PreferenceProfile): ProfileTelemetryEvent | null {
  if (!profile.analyticsConsent) return null;
  return {
    market: profile.market,
    budgetBand: Math.round(profile.maximumBudget / 50_000) * 50_000,
    bedrooms: profile.bedrooms,
    forecastHorizon: profile.forecastHorizon,
    factorWeights: Object.fromEntries(profile.factors.map((factor) => [factor.factorId, factor.weight])),
    destinationCount: profile.commuteDestinations.length,
    destinationModes: [...new Set(profile.commuteDestinations.map((destination) => destination.mode))],
    schoolPhases: profile.school.phases,
  };
}

/**
 * The match as the map's value pack: one entry per area, its band 0–6 by percentile among the
 * scored areas (lib/match-map.ts); null (grey) when it is out (hatched on top) or has no score.
 */
export function matchValuePack(pack: MatchPack): ValuePack {
  const percentiles = matchPercentiles(pack);
  return {
    schemaVersion: "area-value-pack.v1",
    metricId: "price-per-square-metre",
    period: "2026-09",
    sourceVersion: pack.sourceReleaseSet,
    values: pack.values.map((result) => ({
      geographyId: result.geographyId,
      name: result.name,
      metricId: "price-per-square-metre",
      period: "2026-09",
      value: matchMapValue(percentiles.get(result.geographyId)),
      regionPercentile: null,
      countryPercentile: null,
      sampleCount: null,
      quality: result.evidenceCompleteness === 100 ? "observed" : "fallback",
      sourceVersion: pack.sourceReleaseSet,
      carrier: "lsoa",
    })),
  };
}

function affordabilityFactor(
  area: RawMatchArea,
  profile: AnyProfile,
  rentContext: RentContext,
): PreviewFactor | null {
  if (profile.market === "rent") return rentAffordabilityFactor(area, profile, rentContext);
  return previewFactor(area.price, 0, area.geographyId, "observed", "preview-price-2026-06");
}

// Rent affordability reads only borough-carried bedroom cells resolved
// through the official LSOA-to-borough lookup. Anything else — a missing
// cell, an unmapped LSOA, annual-scale budgets — suppresses the component
// instead of inheriting a purchase-price score.
function rentAffordabilityFactor(
  area: RawMatchArea,
  profile: AnyProfile,
  rentContext: RentContext,
): PreviewFactor | null {
  if (!monthlyBudgetsUsable(profile)) return null;
  if (!LSOA_ID_RE.test(area.geographyId)) return null;
  const borough = rentContext.lsoaToBorough[area.geographyId];
  if (!borough) return null;
  assertBoroughCarrier(borough);
  const cell = bedroomCellFor(profile.bedrooms ?? 2);
  if (!cell) return null;
  const observed = rentContext.observed.find((entry) =>
    entry.carrierGeographyId === borough && entry.bedrooms === cell);
  if (!observed) return null;
  return previewFactor(observed.medianMonthlyRent, 0, borough, "fallback", observed.sourceVersion);
}

function monthlyBudgetsUsable(profile: AnyProfile): boolean {
  return profile.targetBudget > 0
    && profile.maximumBudget >= profile.targetBudget
    && profile.maximumBudget <= RENT_MONTHLY_BUDGET_CEILING;
}

function bedroomCellFor(bedrooms: number): string | null {
  if (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 8) return null;
  if (bedrooms === 0) return "studio";
  if (bedrooms === 1) return "1 bedroom";
  if (bedrooms <= 3) return `${bedrooms} bedrooms`;
  return "4 or more bedrooms";
}

function assertBoroughCarrier(id: string): asserts id is GeographyId {
  if (!BOROUGH_ID_RE.test(id)) throw new Error(`invalid borough carrier geography id: ${id}`);
}

function assertRentLookup(lookup: Record<string, GeographyId>): void {
  for (const parent of Object.values(lookup)) assertBoroughCarrier(parent);
}

const PREVIEW_ORIGINS = [[51.501, -0.1416], [51.545, -0.094], [51.503, -0.089]];

function previewJourneyMinutes(area: PreviewMatchArea, latitude: number, longitude: number, mode: string): number {
  const [originLatitude, originLongitude] = PREVIEW_ORIGINS[AREAS.indexOf(area)];
  const distance = Math.hypot((latitude - originLatitude) * 111, (longitude - originLongitude) * 69);
  const speed = mode === "walk" ? 4.8 : mode === "cycle" ? 14 : 20;
  return distance / speed * 60 + (mode === "transit" ? 8 : 0);
}

/**
 * Whether the area's ballpark price (or borough rent, for a rental) is above the maximum budget:
 * null when the pack carries no price evidence for it. Mirrors matching.over_budget.
 */
export function overBudget(result: MatchResult, profile: Pick<AnyProfile, "maximumBudget">): boolean | null {
  const price = result.components.find((component) => component.factorId === "affordability");
  return price ? price.rawValue > profile.maximumBudget : null;
}

/**
 * For grouping a list (budget_tier): within the maximum, unknown, over it. The order itself no longer follows it: the
 * budget is a ranked criterion like any other, and over its soft edge an area scores 0.
 */
export function budgetTier(result: MatchResult, profile: Pick<AnyProfile, "maximumBudget">): 0 | 1 | 2 {
  const over = overBudget(result, profile);
  return over === false ? 0 : over === null ? 1 : 2;
}

/** Re-ranks a pack (from the API or the preview) by the model; idempotent. */
export function rankPack(pack: MatchPack, profile: AnyProfile): MatchPack {
  const values = pack.values.map((result) => ({ ...result }));
  if (values.some((result) => result.rankScore === undefined)) return { ...pack, values };
  rankResults(values, specs(profile));
  return { ...pack, values };
}

function previewMatchArea(
  geographyId: GeographyId,
  name: string,
  purchasePrice: number,
  monthlyRent: number,
  factors: PreviewMatchArea["factors"],
): PreviewMatchArea {
  return { geographyId, name, purchasePrice, monthlyRent, factors };
}

function previewFactor(
  rawValue: number,
  percentile: number,
  carrierGeographyId: GeographyId,
  quality: Quality,
  sourceVersion: string,
): PreviewFactor {
  return { rawValue, percentile, carrierGeographyId, quality, sourceVersion };
}

/** The preview's values of a criterion layer (GET /api/v1/match-criteria/{layer} without the evidence service). */
export function previewCriterionValues(layer: string): MatchCriterionValues | null {
  if (layer.startsWith("custom:") || isDescriptiveLayer(layer)) return null;
  const found = AREAS.flatMap((area, index) => {
    const value = previewRangeValue(layer, index);
    return value ? [{ area, value }] : [];
  });
  if (!found.length) return null;
  return {
    schemaVersion: "match-criterion-values.v1", layer, unit: found[0].value.unit, sourceReleaseIds: [SOURCE_RELEASE_SET],
    values: found.map(({ area, value }) => ({ geographyId: area.geographyId, value: value.rawValue, regionPercentile: value.percentile ?? null })),
  };
}
