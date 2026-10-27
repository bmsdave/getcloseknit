/**
 * My match, one model for every criterion. Mirrors api/area_api/match_model.py;
 * api/tests/match_contract_fixtures.json pins both.
 *
 * A search is one ordered list of criteria (preference-profile.v2), the top one matters most. Each criterion
 * gives an area a fit in [0, 1]: 1 inside its range, linear to 0 across its soft edge, 0 beyond. A Must has its
 * edges at the range: a filter with no weight (an area outside it is out). The others are ranked: weights from
 * the place in the list (rank-order centroid), score = 100 × the weighted geometric mean of the fits (a fit of 0
 * scores 0 — red on the map, not out; no evidence counts as half a fit). Ties break by the criteria in order.
 * Each scored area gets its rank, its percentile among the scored, its top 2 reasons and 2 weakest criteria.
 *
 * A v1 profile (the current panel: importance dots, Must, ranges, zones) is migrated on the way in (`migrateV1`).
 */
import type {
  FitKind, GeographyId, MatchComponent, MatchCriterion, MatchCriterionEcho, MatchPack, MatchResult, MatchZone, PreferenceProfile,
  PreferenceProfileV2, Quality,
} from "./contracts";
import { rankPlace } from "./coverage-words";

export const PACK_SCHEMA = "match-pack.v2";
export const MODEL = "soft-edge-rank.v1";
/** Chip defaults (one place): the better half of London inside, the soft edge a quarter further. */
export const DEFAULT_EDGE = 50;
export const DEFAULT_SOFT = 25;
export const SOFT_MINUTES_FACTOR = 1.5;
export const DEFAULT_SOFT_METRES = 1000;
export const ZONE_DISTANCE_EDGES = 3;
export const MISSING_FIT = 0.5;
/** An area with no evidence for any ranked criterion has no score (unknown, not the middle): neither out nor ranked. */
const UNSCORED_MISSING = 1 - 1e-9;
const TOP_REASONS = 2;
const WEAKEST = 2;
export const BOTTOM = 10;

/** The v1 wizard factors and the map layer each one is a range on (Safer streets = Crime, …). */
export const FACTOR_LAYERS: Record<string, string> = {
  "market-level": "price-per-square-metre", "growth-outlook": "growth-outlook", crime: "crime", deprivation: "deprivation",
  income: "income", "social-renting": "social-renting", schools: "schools", "station-access": "station-access",
  noise: "noise", disorder: "disorder", "epc-share": "epc-share", "leasehold-share": "leasehold-share",
};
export const LAYER_FACTORS: Record<string, string> = Object.fromEntries(Object.entries(FACTOR_LAYERS).map(([factor, layer]) => [layer, factor]));

/** A v2 criterion as the scorer holds it: a migrated one keeps its v1 id (`_id`) and evidence (`_source`). */
export type ModelCriterion = (MatchCriterion | { kind: "commute"; must?: boolean }) & { _id?: string; _source?: string };
/** A v2 profile, possibly migrated from v1 (internal keys, and the v1 commute destinations it still reads). */
export type ModelProfile = Omit<PreferenceProfileV2, "criteria"> & {
  criteria: ModelCriterion[];
  commuteDestinations?: PreferenceProfile["commuteDestinations"];
};

/** One piece of evidence for one area (a row of load_match_evidence). */
export interface EvidenceRow {
  geographyId: GeographyId;
  name: string;
  factorId: string;
  rawValue: number;
  /** London percentile (0 lowest … 100 highest), when known. */
  percentile?: number | null;
  unit: string;
  carrierGeographyId: GeographyId;
  quality: Quality;
  sourceVersion: string;
  destinationId?: string;
  detail?: Record<string, number | null>;
}

export interface Spec {
  id: string;
  kind: ModelCriterion["kind"];
  must: boolean;
  priority: number;
  weight: number;
  item: ModelCriterion;
  axis: "value" | "percentile";
  source: string;
  min: number | null;
  max: number | null;
  softMin: number | null;
  softMax: number | null;
  better: "lower" | "higher" | "middle";
  layer?: string;
}

export function isV2(profile: { schemaVersion: string }): profile is PreferenceProfileV2 {
  return profile.schemaVersion === "preference-profile.v2";
}

export function criterionId(item: ModelCriterion): string {
  if (item._id) return item._id;
  if (item.kind === "budget") return "affordability";
  if (item.kind === "range") return `range:${item.layer}`;
  if (item.kind === "place") return `place:${item.id}`;
  if (item.kind === "where") return "zone";
  if (item.kind === "custom") return `custom:${item.criterion.id}`;
  return item.kind;
}

/** Rank-order centroid: w_i = 1/n · Σ_{k=i..n} 1/k (13 ranked: 25%, 17%, 13%, 10% … 1%). */
export function rocWeights(count: number): number[] {
  const weights: number[] = [];
  for (let index = 1; index <= count; index += 1) {
    let total = 0;
    for (let k = index; k <= count; k += 1) total += 1 / k;
    weights.push(total / count);
  }
  return weights;
}

/** Any accepted profile as v2 (a v1 one migrated). */
export function asV2(profile: PreferenceProfile | PreferenceProfileV2 | ModelProfile): ModelProfile {
  return isV2(profile as PreferenceProfileV2) ? profile as ModelProfile : migrateV1(profile as PreferenceProfile);
}

/**
 * preference-profile.v1 → v2 (migrate_v1): every weighted or limited criterion joins
 * one list by weight descending (ties keep the v1 order: factors, places, own criteria, ranges); zones become the
 * Where criterion at the top; Must stays Must. Migrated criteria keep their v1 ids, so relaxing and the current
 * panel read the same ids.
 *
 * The My match panel (lib/match-search.ts) keeps its v2 list in the v1 profile: `order` (the ids in
 * priority order) wins over the weights, a range carries its `scale` and `must`, a place its `softMinutes`, an own
 * criterion its `must`, and `where` the Where criterion's Must and soft edge. A profile without them reads as before.
 */
export function migrateV1(profile: PreferenceProfile): ModelProfile {
  const candidates: { weight: number; order: number; item: ModelCriterion }[] = [];
  const add = (weight: number, item: ModelCriterion) => candidates.push({ weight, order: candidates.length, item });
  for (const factor of profile.factors ?? []) {
    const must = factor.minimumUtility !== null && factor.minimumUtility !== undefined
      || factor.maximumUtility !== null && factor.maximumUtility !== undefined;
    const weight = factor.weight || 0;
    if (weight <= 0 && !must) continue;
    if (factor.factorId === "affordability") add(weight, { kind: "budget", must });
    else if (factor.factorId === "commute") {
      if (profile.commuteDestinations?.length) add(weight, { kind: "commute", _id: "commute", must });
    } else if (factor.factorId in FACTOR_LAYERS) add(weight, factorRange(factor, must));
  }
  for (const place of profile.places ?? []) {
    add(place.weight || 0, {
      kind: "place", id: place.id, label: place.label, target: place.target, mode: place.mode, targetMinutes: place.targetMinutes,
      ...(place.when !== undefined ? { when: place.when } : {}), ...(place.softMinutes !== undefined ? { softMinutes: place.softMinutes } : {}),
      must: Boolean(place.must),
    });
  }
  for (const entry of profile.custom ?? []) {
    if ((entry.weight || 0) > 0 || entry.must) {
      add(entry.weight || 0, { kind: "custom", criterion: entry.criterion, direction: entry.direction, must: Boolean(entry.must) });
    }
  }
  for (const range of profile.ranges ?? []) {
    const strict = (range.softMin === null || range.softMin === undefined || range.softMin === range.min)
      && (range.softMax === null || range.softMax === undefined || range.softMax === range.max);
    // A range the panel wrote says its Must and keeps its soft edges for when Must is turned off (specs ignore
    // them on a Must); an older one is a Must when it has no soft edge.
    const told = range.must !== undefined;
    add(range.importance || 0, {
      kind: "range", layer: range.layer, scale: range.scale ?? "value", min: range.min ?? null, max: range.max ?? null,
      softMin: strict && !told ? null : range.softMin ?? null, softMax: strict && !told ? null : range.softMax ?? null,
      must: told ? Boolean(range.must) : strict,
    });
  }
  const where: ModelCriterion | null = profile.zones?.length
    ? { kind: "where", zones: [...profile.zones], softMetres: profile.where?.softMetres ?? DEFAULT_SOFT_METRES, must: Boolean(profile.where?.must) }
    : null;
  let criteria: ModelCriterion[];
  if (profile.order?.length) {
    // The panel's order: the ids it names first, in its order; anything else after them, by weight as before.
    if (where) candidates.push({ weight: Infinity, order: -1, item: where });
    const at = new Map(profile.order.map((id, index) => [id, index]));
    const rank = (item: ModelCriterion) => at.get(criterionId(item)) ?? Infinity;
    criteria = candidates.sort((a, b) => rank(a.item) - rank(b.item) || b.weight - a.weight || a.order - b.order).map((entry) => entry.item);
  } else {
    criteria = candidates.sort((a, b) => b.weight - a.weight || a.order - b.order).map((entry) => entry.item);
    if (where) criteria.unshift(where);
  }
  const migrated: ModelProfile = { schemaVersion: "preference-profile.v2", market: profile.market ?? "buy", targetBudget: profile.targetBudget,
    maximumBudget: profile.maximumBudget, criteria };
  if (profile.bedrooms !== undefined) migrated.bedrooms = profile.bedrooms;
  if (profile.propertyType !== undefined) migrated.propertyType = profile.propertyType;
  if (profile.houseTypes !== undefined) migrated.houseTypes = profile.houseTypes;
  if (profile.marks !== undefined) migrated.marks = profile.marks;
  // The redacted usage record is the household's choice: it travels with the match request only when given.
  if (profile.analyticsConsent) migrated.analyticsConsent = true;
  if (profile.commuteDestinations !== undefined) migrated.commuteDestinations = profile.commuteDestinations;
  return migrated;
}

/** A wizard factor as a range on its London percentile: the chip default, or for a Must its own limit (_factor_range). */
export function factorRange(factor: PreferenceProfile["factors"][number], must: boolean): ModelCriterion {
  const direction = factor.direction ?? "higher";
  let low: number | null = null, high: number | null = null, softLow: number | null = null, softHigh: number | null = null;
  if (direction === "lower") { high = 100 - DEFAULT_EDGE; softHigh = 100 - DEFAULT_EDGE + DEFAULT_SOFT; }
  else if (direction === "higher") { low = DEFAULT_EDGE; softLow = DEFAULT_EDGE - DEFAULT_SOFT; }
  else { low = DEFAULT_SOFT; high = 100 - DEFAULT_SOFT; softLow = 0; softHigh = 100; }
  if (must) {
    const minimum = factor.minimumUtility ?? null, maximum = factor.maximumUtility ?? null;
    softLow = softHigh = null;
    if (direction === "lower") {
      high = minimum !== null ? 100 - minimum : high;
      low = maximum !== null ? 100 - maximum : null;
    } else if (direction === "higher") {
      low = minimum !== null ? minimum : low;
      high = maximum !== null ? maximum : null;
    } else if (minimum !== null) {
      const half = (100 - minimum) / 2;
      low = 50 - half;
      high = 50 + half;
    }
  }
  return { kind: "range", layer: FACTOR_LAYERS[factor.factorId], scale: "percentile", min: low, max: high, softMin: softLow, softMax: softHigh,
    must, _id: factor.factorId, _source: factor.factorId };
}

/** A v2 profile without internal keys (for links and the API); the legacy commute criterion has no v2 form. */
export function contractProfile(profile: PreferenceProfile | PreferenceProfileV2 | ModelProfile): PreferenceProfileV2 {
  const { commuteDestinations, ...rest } = asV2(profile);
  void commuteDestinations;
  return {
    ...rest,
    criteria: rest.criteria.filter((item): item is MatchCriterion & { _id?: string } => item.kind !== "commute")
      .map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith("_"))) as MatchCriterion),
  };
}

/** The profile's criteria, in order, as the scorer reads them (specs in match_model.py). */
export function specs(profile: PreferenceProfile | PreferenceProfileV2 | ModelProfile): Spec[] {
  const v2 = asV2(profile);
  const out = v2.criteria.map((item, index) => spec(item, index, v2));
  const ranked = out.filter((entry) => !entry.must);
  rocWeights(ranked.length).forEach((weight, index) => { ranked[index].weight = weight; });
  return out;
}

function spec(item: ModelCriterion, index: number, profile: ModelProfile): Spec {
  const must = Boolean(item.must);
  const base = { id: criterionId(item), kind: item.kind, must, priority: index + 1, weight: 0, item, axis: "value" as Spec["axis"],
    min: null as number | null, max: null as number | null, softMin: null as number | null, softMax: null as number | null };
  if (item.kind === "budget") {
    return { ...base, source: "affordability", better: "lower", max: must ? profile.maximumBudget : profile.targetBudget,
      softMax: must ? null : profile.maximumBudget };
  }
  if (item.kind === "range") {
    const min = item.min ?? null, max = item.max ?? null;
    return { ...base, source: item._source ?? base.id, layer: item.layer, axis: item.scale === "percentile" ? "percentile" : "value",
      min, max, softMin: must ? null : item.softMin ?? null, softMax: must ? null : item.softMax ?? null,
      better: min !== null && max !== null ? "middle" : max !== null ? "lower" : "higher" };
  }
  if (item.kind === "place") {
    const target = item.targetMinutes ?? null;
    return { ...base, source: base.id, better: "lower", max: target,
      softMax: must || target === null ? null : item.softMinutes ?? target * SOFT_MINUTES_FACTOR };
  }
  if (item.kind === "where") {
    return { ...base, source: "zone", better: "lower", max: 0, softMax: must ? null : item.softMetres ?? DEFAULT_SOFT_METRES };
  }
  if (item.kind === "custom") {
    return item.direction === "higher"
      ? { ...base, source: base.id, axis: "percentile", better: "higher", min: DEFAULT_EDGE, softMin: must ? null : DEFAULT_EDGE - DEFAULT_SOFT }
      : { ...base, source: base.id, axis: "percentile", better: "lower", max: 100 - DEFAULT_EDGE, softMax: must ? null : 100 - DEFAULT_EDGE + DEFAULT_SOFT };
  }
  return { ...base, source: "commute", better: "lower" };
}

/** 1 inside [low, high]; across a soft edge, linear down to 0 at the edge; 0 beyond (range_fit). */
export function rangeFit(value: number, low: number | null, high: number | null, softLow: number | null, softHigh: number | null): number {
  if (low !== null && value < low) return softLow === null || softLow >= low || value <= softLow ? 0 : (value - softLow) / (low - softLow);
  if (high !== null && value > high) return softHigh === null || softHigh <= high || value >= softHigh ? 0 : (softHigh - value) / (softHigh - high);
  return 1;
}

export function fitKind(fit: number): FitKind {
  return fit >= 1 ? "in" : fit > 0 ? "edge" : "out";
}

/** To 6 decimals first, then half up (round_half_up). */
export function roundHalfUp(value: number): number {
  return Math.floor(Number(value.toFixed(6)) + 0.5);
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

// ---- zones: distance outside ----------------------------------------------------------------------------

const METRES_PER_DEGREE_LAT = 110_540;
const METRES_PER_DEGREE_LON = 111_320 * Math.cos(51.5 * Math.PI / 180);

/**
 * Metres from each area's point to the nearest point of an area inside the zones (0 inside), on a flat projection
 * around London; capped at ZONE_DISTANCE_EDGES soft edges (zone_distances).
 */
export function zoneDistances(inside: ReadonlySet<string>, points: ReadonlyMap<string, [number, number]>, soft: number): Map<string, number> {
  const cap = soft * ZONE_DISTANCE_EDGES;
  const insidePoints = [...inside].flatMap((id) => (points.has(id) ? [xy(points.get(id)!)] : []));
  const out = new Map<string, number>();
  for (const [id, point] of points) {
    if (inside.has(id)) { out.set(id, 0); continue; }
    const [x, y] = xy(point);
    let best = cap;
    for (const [px, py] of insidePoints) best = Math.min(best, Math.hypot(px - x, py - y));
    out.set(id, Math.round(best));
  }
  for (const id of inside) if (!out.has(id)) out.set(id, 0);
  return out;
}

function xy([lat, lon]: [number, number]): [number, number] {
  return [lon * METRES_PER_DEGREE_LON, lat * METRES_PER_DEGREE_LAT];
}

export function profileZones(profile: PreferenceProfile | PreferenceProfileV2 | ModelProfile): MatchZone[] {
  if (isV2(profile as PreferenceProfileV2)) {
    const where = (profile as ModelProfile).criteria.find((item) => item.kind === "where");
    return where && where.kind === "where" ? [...where.zones] : [];
  }
  return [...((profile as PreferenceProfile).zones ?? [])];
}

export function softMetres(profile: PreferenceProfile | PreferenceProfileV2 | ModelProfile): number {
  const where = asV2(profile).criteria.find((item) => item.kind === "where");
  return (where && where.kind === "where" ? where.softMetres : undefined) ?? DEFAULT_SOFT_METRES;
}

// ---- scoring --------------------------------------------------------------------------------------------

export interface ScoreOptions {
  relaxed?: readonly string[];
  zoneLsoas?: ReadonlySet<string> | null;
  zoneDistance?: ReadonlyMap<string, number> | null;
  sourceReleaseSet?: string;
  /** Every area to score, even one without a single row (its criteria all missing). */
  areas?: readonly { geographyId: GeographyId; name: string }[];
}

/** match-pack.v2 for any accepted profile (score_pack). Budget rows carry the price or rent already chosen. */
export function scorePack(profile: PreferenceProfile | PreferenceProfileV2 | ModelProfile, rows: readonly EvidenceRow[], options: ScoreOptions = {}): MatchPack {
  const v2 = asV2(profile);
  const criteria = specs(v2);
  const grouped = new Map<string, EvidenceRow[]>();
  const names = new Map<string, string>();
  for (const area of options.areas ?? []) { grouped.set(area.geographyId, []); names.set(area.geographyId, area.name); }
  for (const row of rows) {
    if (!grouped.has(row.geographyId)) grouped.set(row.geographyId, []);
    grouped.get(row.geographyId)!.push(row);
  }
  const percentiles = percentileMaps(criteria, grouped);
  const relaxed = new Set(options.relaxed ?? []);
  const results = [...grouped].map(([areaId, areaRows]) => scoreArea(v2, criteria, areaId as GeographyId, names.get(areaId) ?? areaRows[0]?.name ?? areaId,
    areaRows, relaxed, options, percentiles));
  rankResults(results, criteria);
  const releaseSet = options.sourceReleaseSet
    ?? [...new Set(rows.map((row) => row.sourceVersion).filter(Boolean))].sort().join("+");
  const values = results.map((result) => ({ ...result, sourceReleaseSet: releaseSet }));
  const pack: MatchPack = {
    schemaVersion: PACK_SCHEMA, profileVersion: (profile.schemaVersion ?? "preference-profile.v1") as MatchPack["profileVersion"], model: MODEL,
    sourceReleaseSet: releaseSet, criteria: criteria.map((entry) => echo(entry, grouped, percentiles)), sort: "score", values,
  };
  return summarise(pack);
}

/** Ascending London percentile (0 lowest, 100 highest), ties sharing the lower rank (quick_criteria.percentiles). */
export function ascendingPercentiles(values: ReadonlyMap<string, number>): Map<string, number> {
  const ordered = [...values.values()].sort((a, b) => a - b);
  const out = new Map<string, number>();
  if (ordered.length < 2) { for (const key of values.keys()) out.set(key, 0); return out; }
  const first = new Map<number, number>();
  ordered.forEach((value, index) => { if (!first.has(value)) first.set(value, index); });
  for (const [key, value] of values) out.set(key, round(first.get(value)! / (ordered.length - 1) * 100, 1));
  return out;
}

function percentileMaps(criteria: Spec[], grouped: Map<string, EvidenceRow[]>): Map<string, Map<string, number>> {
  const maps = new Map<string, Map<string, number>>();
  for (const entry of criteria) {
    if (entry.axis !== "percentile" || maps.has(entry.source)) continue;
    const values = new Map<string, number>();
    const stored = new Map<string, number>();
    for (const [areaId, areaRows] of grouped) {
      const row = areaRows.find((candidate) => candidate.factorId === entry.source && candidate.rawValue !== null && candidate.rawValue !== undefined);
      if (!row) continue;
      values.set(areaId, row.rawValue);
      if (row.percentile !== null && row.percentile !== undefined) stored.set(areaId, row.percentile);
    }
    maps.set(entry.source, stored.size === values.size ? stored : ascendingPercentiles(values));
  }
  return maps;
}

function scoreArea(profile: ModelProfile, criteria: Spec[], areaId: GeographyId, name: string, rows: EvidenceRow[], relaxed: Set<string>,
  options: ScoreOptions, percentiles: Map<string, Map<string, number>>): MatchResult {
  const components: MatchComponent[] = [];
  const failures: string[] = [];
  let missing = 0, logSum = 0, zero = false;
  for (const entry of criteria) {
    const component = componentFor(entry, profile, rows, areaId, options, percentiles);
    if (!component) {
      if (entry.must) { if (!relaxed.has(entry.id)) failures.push(`${entry.id}:missing`); } else missing += entry.weight;
      continue;
    }
    components.push(component);
    const fit = component.fit ?? 0;
    if (entry.must) { if (fit <= 0 && !relaxed.has(entry.id)) failures.push(`${entry.id}:outside`); }
    else if (fit <= 0) zero = true;
    else logSum += entry.weight * Math.log(fit);
  }
  if (profile.marks?.excluded?.includes(areaId as GeographyId) && !relaxed.has("mark")) failures.push("mark:excluded");
  const precise = zero ? 0 : 100 * Math.exp(logSum + (missing ? missing * Math.log(MISSING_FIT) : 0));
  const ranked = criteria.some((entry) => !entry.must);
  const result: MatchResult = {
    geographyId: areaId, name,
    score: failures.length || missing >= UNSCORED_MISSING ? null : roundHalfUp(precise), rankScore: round(precise, 6), rank: null, percentile: null,
    evidenceCompleteness: ranked ? roundHalfUp(100 * (1 - missing)) : 100,
    excluded: failures.length > 0, unmetLimits: failures, sourceReleaseSet: "", components,
    missingWeight: round(missing, 6), reasons: failures.length ? [] : reasons(components), weakest: weakest(components, failures),
  };
  if (options.zoneLsoas || options.zoneDistance) {
    result.inZone = options.zoneDistance ? options.zoneDistance.get(areaId) === 0 : options.zoneLsoas!.has(areaId);
  }
  return result;
}

function componentFor(entry: Spec, profile: ModelProfile, rows: EvidenceRow[], areaId: string, options: ScoreOptions,
  percentiles: Map<string, Map<string, number>>): MatchComponent | null {
  if (entry.kind === "where") return whereComponent(entry, areaId as GeographyId, options);
  if (entry.kind === "commute") return commuteComponent(entry, profile, rows);
  const row = rows.find((candidate) => candidate.factorId === entry.source && candidate.rawValue !== null && candidate.rawValue !== undefined);
  if (!row) return null;
  let value = row.rawValue;
  let percentile: number | null = null;
  if (entry.axis === "percentile") {
    percentile = percentiles.get(entry.source)?.get(areaId) ?? null;
    if (percentile === null) return null;
    value = percentile;
  }
  const fit = rangeFit(value, entry.min, entry.max, entry.softMin, entry.softMax);
  const component = finish(entry, row, fit);
  if (percentile !== null) component.percentile = round(percentile, 1);
  if (entry.kind === "place" && entry.item.kind === "place" && entry.item.targetMinutes !== undefined) component.targetMinutes = entry.item.targetMinutes;
  if (entry.kind === "range") component.layer = entry.layer;
  return component;
}

function finish(entry: Spec, base: Pick<EvidenceRow, "rawValue" | "unit" | "carrierGeographyId" | "quality" | "sourceVersion" | "detail">, fit: number): MatchComponent {
  const component: MatchComponent = {
    factorId: entry.id as MatchComponent["factorId"], rawValue: base.rawValue, unit: base.unit ?? "",
    utility: round(fit * 100, 6), fit, fitKind: fitKind(fit), weight: entry.weight, contribution: round(entry.weight * fit, 6),
    must: entry.must, priority: entry.priority, carrierGeographyId: base.carrierGeographyId, quality: base.quality, sourceVersion: base.sourceVersion,
  };
  if (base.detail) component.detail = base.detail;
  return component;
}

function whereComponent(entry: Spec, areaId: GeographyId, options: ScoreOptions): MatchComponent | null {
  let metres: number;
  if (options.zoneDistance?.has(areaId)) metres = options.zoneDistance.get(areaId)!;
  else if (options.zoneLsoas) metres = options.zoneLsoas.has(areaId) ? 0 : (entry.softMax ?? DEFAULT_SOFT_METRES) * ZONE_DISTANCE_EDGES;
  else return null;
  const fit = rangeFit(metres, null, 0, null, entry.softMax);
  return finish(entry, { rawValue: metres, unit: "m", carrierGeographyId: areaId, quality: "observed", sourceVersion: "zones" }, fit);
}

function commuteComponent(entry: Spec, profile: ModelProfile, rows: EvidenceRow[]): MatchComponent | null {
  const byDestination = new Map(rows.filter((row) => row.factorId === "commute" && row.destinationId).map((row) => [row.destinationId!, row]));
  const journeys = (profile.commuteDestinations ?? []).filter((destination) => (destination.weight || 0) > 0 && byDestination.has(destination.id))
    .map((destination) => ({ destination, row: byDestination.get(destination.id)! }));
  if (!journeys.length) return null;
  const total = journeys.reduce((sum, journey) => sum + journey.destination.weight, 0);
  const minutes = journeys.reduce((sum, journey) => sum + journey.row.rawValue * journey.destination.weight, 0) / total;
  const fit = journeys.reduce((sum, { destination, row }) => sum + rangeFit(row.rawValue, null, destination.targetMinutes, null,
    entry.must ? null : destination.targetMinutes * SOFT_MINUTES_FACTOR) * destination.weight, 0) / total;
  const first = journeys[0].row;
  return finish(entry, { rawValue: Math.round(minutes), unit: "minutes", carrierGeographyId: first.carrierGeographyId, quality: "observed",
    sourceVersion: first.sourceVersion }, fit);
}

function reasons(components: MatchComponent[]): string[] {
  return components.filter((component) => !component.must && (component.fit ?? 0) > 0)
    .sort((a, b) => round(b.weight * (b.fit ?? 0), 9) - round(a.weight * (a.fit ?? 0), 9) || (a.priority ?? 0) - (b.priority ?? 0))
    .slice(0, TOP_REASONS).map((component) => component.factorId as string);
}

function weakest(components: MatchComponent[], failures: string[]): string[] {
  const out = failures.filter((code) => !code.startsWith("mark:")).map(limitId);
  const ranked = components.filter((component) => !component.must && (component.fit ?? 0) < 1)
    .sort((a, b) => round(b.weight * (1 - (b.fit ?? 0)), 9) - round(a.weight * (1 - (a.fit ?? 0)), 9) || (a.priority ?? 0) - (b.priority ?? 0));
  for (const component of ranked) if (!out.includes(component.factorId)) out.push(component.factorId);
  return out.slice(0, WEAKEST);
}

/** "range:crime:outside" → "range:crime", "zone:outside" → "zone" (limit_id). */
export function limitId(code: string): string {
  return code.slice(0, code.lastIndexOf(":"));
}

function tieKey(result: MatchResult, criteria: Spec[]): number[] {
  const byId = new Map(result.components.map((component) => [component.factorId as string, component]));
  const key: number[] = [];
  for (const entry of [...criteria.filter((item) => !item.must), ...criteria.filter((item) => item.must)]) {
    const component = byId.get(entry.id);
    if (!component) { key.push(-MISSING_FIT, Infinity); continue; }
    const value = component.percentile ?? component.rawValue;
    const oriented = entry.better === "higher" ? -value : entry.better === "middle" ? Math.abs(value - ((entry.min ?? 0) + (entry.max ?? 0)) / 2) : value;
    key.push(-(component.fit ?? 0), oriented);
  }
  return key;
}

/** Ranked and coloured: not out, and with evidence for at least one ranked criterion (is_scored). */
export function isScored(result: Pick<MatchResult, "excluded" | "score">): boolean {
  return !result.excluded && result.score !== null;
}

/** Scored areas first, by precise score, then the tie key, then id; no evidence next; out areas last (rank_results). */
export function rankResults(results: MatchResult[], criteria: Spec[] | null = null): void {
  const keys = new Map(results.map((result) => [result, criteria && isScored(result) ? tieKey(result, criteria) : []]));
  const group = (result: MatchResult) => (result.excluded ? 2 : result.score === null ? 1 : 0);
  results.sort((a, b) => {
    if (group(a) !== group(b)) return group(a) - group(b);
    if (a.excluded) return a.unmetLimits.length - b.unmetLimits.length || compareIds(a.geographyId, b.geographyId);
    if (a.score === null) return compareIds(a.geographyId, b.geographyId);
    const score = round(b.rankScore ?? 0, 6) - round(a.rankScore ?? 0, 6);
    if (score !== 0) return score;
    const left = keys.get(a)!, right = keys.get(b)!;
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return compareIds(a.geographyId, b.geographyId);
  });
  const count = results.filter(isScored).length;
  results.forEach((result, index) => {
    result.rank = isScored(result) ? index + 1 : null;
    result.percentile = !isScored(result) ? null : count === 1 ? 100 : roundHalfUp(100 * (count - (index + 1)) / (count - 1));
  });
}

function compareIds(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function summarise(pack: MatchPack): MatchPack {
  const scored = pack.values.filter(isScored);
  return {
    ...pack, scored: scored.length,
    bottom: [...scored].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, BOTTOM).map((result) => ({
      geographyId: result.geographyId, rank: result.rank!, percentile: result.percentile!, score: result.score!, weakest: result.weakest ?? [],
    })),
  };
}

function echo(entry: Spec, grouped: Map<string, EvidenceRow[]>, percentiles: Map<string, Map<string, number>>): MatchCriterionEcho {
  // The budget's bounds are the household's own figures: never echoed in a pack (privacy boundary, AE-09).
  const hide = entry.kind === "budget";
  const out: MatchCriterionEcho = {
    id: entry.id, kind: entry.kind, must: entry.must, priority: entry.priority, weight: round(entry.weight, 6), better: entry.better,
    scale: entry.axis, min: hide ? null : entry.min, max: hide ? null : entry.max, softMin: hide ? null : entry.softMin,
    softMax: hide ? null : entry.softMax,
  };
  if (entry.layer) out.layer = entry.layer;
  if (entry.axis === "percentile" && entry.kind === "range") {
    const of = percentiles.get(entry.source) ?? new Map<string, number>();
    const pairs: [number, number][] = [];
    for (const [areaId, areaRows] of grouped) {
      const row = areaRows.find((candidate) => candidate.factorId === entry.source);
      if (row && of.has(areaId)) pairs.push([of.get(areaId)!, row.rawValue]);
    }
    const at = (percentile: number | null) => (percentile === null || !pairs.length ? null
      : pairs.reduce((best, pair) => {
        const gap = Math.abs(pair[0] - percentile) - Math.abs(best[0] - percentile);
        return gap < 0 || (gap === 0 && pair[1] < best[1]) ? pair : best;
      })[1]);
    out.valueBounds = { min: at(entry.min), max: at(entry.max), softMin: at(entry.softMin), softMax: at(entry.softMax) };
  }
  return out;
}

/**
 * The pack with these Musts (and zones, marks) lifted (relax): an area out only for them is scored again with the
 * score it already had (a Must has no weight).
 */
export function relax(pack: MatchPack, relaxed: readonly string[] = [], profile: PreferenceProfile | PreferenceProfileV2 | null = null): MatchPack {
  const lifted = new Set(relaxed);
  const values = pack.values.map((result) => {
    const unmetLimits = result.unmetLimits.filter((code) => !lifted.has(limitId(code)));
    const excluded = unmetLimits.length > 0;
    const unscored = (result.missingWeight ?? 0) >= UNSCORED_MISSING;
    return { ...result, unmetLimits, excluded, score: excluded || unscored ? null : roundHalfUp(result.rankScore ?? 0), reasons: excluded ? [] : reasons(result.components) };
  });
  rankResults(values, profile ? specs(profile) : null);
  return summarise({ ...pack, values });
}

/**
 * The 0–100 score from a set of components (fitScore for a live preview): the weighted geometric mean of the ranked
 * fits, `missingWeight` of the weight counted as half a fit; 100 with nothing ranked.
 */
export function scoreOf(components: readonly Pick<MatchComponent, "fit" | "utility" | "weight">[], missingWeight = 0): number {
  let logSum = 0;
  for (const component of components) {
    if (component.weight <= 0) continue;
    const fit = component.fit ?? component.utility / 100;
    if (fit <= 0) return 0;
    logSum += component.weight * Math.log(fit);
  }
  return 100 * Math.exp(logSum + (missingWeight ? missingWeight * Math.log(MISSING_FIT) : 0));
}

/** "Crime", "Price per square metre", "Gyms": a criterion's plain name (criterion_words). */
export function criterionWords(factorId: string, entry: Spec | undefined): string {
  if (entry?.layer) return layerWords(entry.layer);
  if (entry?.item.kind === "custom") return entry.item.criterion.label || factorId;
  return layerWords(factorId);
}

export function layerWords(layer: string): string {
  const words = layer.slice(layer.indexOf(":") + 1).replaceAll("-", " ");
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

/** "≤ 25", "20–40", or for a London percentile range "lowest 50% of London" (bound_words). */
export function boundWords(entry: Spec | undefined): string {
  if (!entry) return "range";
  const { min, max } = entry;
  if (entry.axis === "percentile") {
    const place = rankPlace();
    if (min !== null && max !== null) return `middle ${plainNumber(max - min)}% of ${place}`;
    return max !== null ? `lowest ${plainNumber(max)}% of ${place}` : `highest ${plainNumber(100 - (min ?? 0))}% of ${place}`;
  }
  if (min !== null && max !== null) return `${plainNumber(min)}–${plainNumber(max)}`;
  return max !== null ? `≤ ${plainNumber(max)}` : `≥ ${plainNumber(min ?? 0)}`;
}

export function plainNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1 });
}
