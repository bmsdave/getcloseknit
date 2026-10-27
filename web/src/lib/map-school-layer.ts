import type { ExpressionSpecification, GeoJSONSourceSpecification, SymbolLayerSpecification } from "maplibre-gl";

import type { SavedItemInput } from "./saved-items";
import { formatDistance, schoolPath, straightLineKm } from "./school-card";
import {
  OFSTED_LABEL, SCHOOL_CAP_PX, SCHOOL_FOLD_PREFIX, STAGE_LABEL, rankTier, schoolIconCode,
  type OfstedMark, type RankTier, type SchoolIcon, type SchoolKind, type SchoolStage,
} from "./school-icons";
import {
  DEFAULT_SCHOOL_FILTER, measureStep, ofstedFilterOf, schoolMeasure, schoolMeasureValue, schoolShown, schoolType,
  type EstablishmentGroup, type OfstedFilter, type SchoolFilter, type SchoolMeasureId, type SchoolType,
} from "./school-filter";

/**
 * One open school as a map point (GET /api/v1/schools/points): state schools, then independent ones
 * (kind). Optional fields are left out when empty.
 */
export interface SchoolPoint {
  urn: string;
  name: string;
  phase: string;
  latitude: number;
  longitude: number;
  kind?: SchoolKind;
  stage?: SchoolStage;
  /** State only: the legacy single grade, or a report card (no single grade). */
  ofsted?: OfstedMark;
  /** State only: the England rank's top %, 25 or better. */
  topPercent?: number;
  /** The academic year of topPercent ("2024/25"). */
  rankYear?: string;
  /** State only: the school's place among London's ranked schools of its phase (1 = best) and how many. */
  regionRank?: number;
  regionPool?: number;
  /** Outside London: the region regionRank / aLevelRank are within (England coverage, migration 110). */
  rankScope?: { code: string; name: string };
  selective?: boolean;
  /** GIAS religious character, as published. */
  faith?: string;
  sixthForm?: boolean;
  /** "Girls", "Boys", or "Girls · mixed sixth form"; absent for a mixed school. */
  intake?: string;
  /** The combined A-level rank (migration 094, issue #201): state and independent sixth forms on
   * one scale. Present only when the school has a ranked sixth form. */
  aLevelRank?: { rank: number; pool: number; year: string };
  /** State only: GIAS type of establishment as a group (api schools.establishment_group). */
  group?: EstablishmentGroup;
  /** State only, Schools filter v2: each measure's latest published value and its academic year; absent when
   * suppressed, under the cohort floor or not published for the phase. */
  measures?: Partial<Record<SchoolMeasureId, [number, string]>>;
}

export interface SchoolPointsResponse { schemaVersion: "school-points.v1"; schools: SchoolPoint[] }

export const SCHOOL_SOURCE_ID = "school-points";
export const SCHOOL_LAYER = "school-points";
/** The "+N" bubble beside a cap that stands for the schools folded under it. */
export const SCHOOL_FOLD_LAYER = "school-folds";
export const SCHOOL_LAYERS = [SCHOOL_LAYER, SCHOOL_FOLD_LAYER] as const;
/** Schools join the map at neighbourhood zoom. */
export const SCHOOL_MIN_ZOOM = 12;
/** Caps nearer than this (px) fold into one ("+N"); above FOLD_MAX_ZOOM every school stands alone. */
export const SCHOOL_FOLD_RADIUS = SCHOOL_CAP_PX;
export const SCHOOL_FOLD_MAX_ZOOM = 16;
/** A school without the chosen measure (option 4): faded, never dropped. */
export const SCHOOL_FADED_OPACITY = 0.45;

const GIAS_DETAILS = "https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/";

function stageOf(point: Pick<SchoolPoint, "stage" | "phase">): SchoolStage {
  return point.stage ?? (point.phase === "primary" ? "primary" : "secondary");
}

/** The point's Top % of England (its phase, the latest ranked year), or null when not ranked. The plaque tier,
 * the tag, the Top 10% filter and the school page's Results line all read this one figure. */
export function schoolEnglandTop(point: Pick<SchoolPoint, "kind" | "topPercent">): number | null {
  return point.kind !== "independent" && typeof point.topPercent === "number" && point.topPercent > 0 ? point.topPercent : null;
}

/** The point's icon: every detail at every zoom. */
export function schoolIcon(point: SchoolPoint, filter: SchoolFilter = DEFAULT_SCHOOL_FILTER): SchoolIcon {
  const kind = point.kind ?? "state";
  const step = schoolMeasureStep(point, filter);
  // Coloured by a measure (option 4), the cap's top carries the measure's step instead of the Ofsted grade.
  return { kind, stage: stageOf(point), ofsted: kind === "state" && step === undefined ? point.ofsted ?? null : null,
    tier: kind === "state" ? rankTier(schoolEnglandTop(point)) : null, ...(step !== undefined ? { measure: step } : {}) };
}

/** Every icon the points draw, for map.addImage. */
export function schoolIcons(points: readonly SchoolPoint[], filter: SchoolFilter = DEFAULT_SCHOOL_FILTER): SchoolIcon[] {
  return points.map((point) => schoolIcon(point, filter));
}

// ---- Show › Schools filters: Schools filter v2 (lib/school-filter.ts) -------------------------------------

export {
  DEFAULT_SCHOOL_FILTER, isDefaultSchoolFilter, OFSTED_FILTERS, ofstedFilterOf, SCHOOL_TYPES, schoolFilterFromQuery, schoolShown,
  schoolType, withSchoolFilterQuery, type OfstedFilter, type SchoolFilter, type SchoolType,
} from "./school-filter";

/** Counts for the filter list and the legend: per type, per Ofsted grade (state), per award,
 * and schools with a combined A-level rank (issue #201). */
export interface SchoolCounts { types: Record<SchoolType, number>; ofsted: Record<OfstedFilter, number>; tiers: Record<RankTier, number>; sixthForms: number; total: number }

export function schoolCounts(points: readonly SchoolPoint[]): SchoolCounts {
  const counts: SchoolCounts = {
    types: { primary: 0, secondary: 0, "all-through": 0, private: 0 },
    ofsted: { out: 0, good: 0, ri: 0, inad: 0, rc: 0, none: 0 },
    tiers: { 25: 0, 10: 0, 5: 0, 3: 0, 1: 0 },
    sixthForms: 0,
    total: points.length,
  };
  for (const point of points) {
    counts.types[schoolType(point)] += 1;
    if (point.aLevelRank) counts.sixthForms += 1;
    if (point.kind === "independent") continue;
    counts.ofsted[ofstedFilterOf(point)] += 1;
    const tier = rankTier(schoolEnglandTop(point));
    if (tier) counts.tiers[tier] += 1;
  }
  return counts;
}

/** The colour step of a point on the chosen measure's ramp (option 4): null without the measure, undefined
 * when no measure is chosen (the cap keeps its Ofsted colour). */
export function schoolMeasureStep(point: SchoolPoint, filter: SchoolFilter): 0 | 1 | 2 | 3 | null | undefined {
  if (!filter.measure) return undefined;
  const found = schoolMeasureValue(point, filter.measure.id);
  return found ? measureStep(schoolMeasure(filter.measure.id), found.value) : null;
}
// ---- Map source and layers ----------------------------------------------------------------------------

export function schoolFeatures(points: readonly SchoolPoint[], filter: SchoolFilter = DEFAULT_SCHOOL_FILTER): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: points.filter((point) => schoolShown(point, filter)).map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
      properties: {
        urn: point.urn, name: point.name, phase: point.phase, kind: point.kind ?? "state", stage: stageOf(point),
        ofsted: point.ofsted ?? "", topPercent: point.topPercent ?? 0, rankYear: point.rankYear ?? "", regionRank: point.regionRank ?? 0,
        regionPool: point.regionPool ?? 0, selective: point.selective ?? false,
        faith: point.faith ?? "", sixthForm: point.sixthForm ?? false, intake: point.intake ?? "",
        aLevelRank: point.aLevelRank?.rank ?? 0, aLevelPool: point.aLevelRank?.pool ?? 0,
        aLevelYear: point.aLevelRank?.year ?? "",
        // The region its ranks are within (absent: London), so a tapped cap's card names it, not London.
        rankScopeCode: point.rankScope?.code ?? "", rankScopeName: point.rankScope?.name ?? "",
        // The look and its placement priority in one number (lib/school-icons.ts): the image is school-<code>.
        code: schoolIconCode(schoolIcon(point, filter)),
        // Coloured by a measure the school has no value for: faded, never dropped (a threshold drops it instead).
        faded: schoolMeasureStep(point, filter) === null ? 1 : 0,
      },
    })),
  };
}

/** Caps that would overlap fold into the best of them with a "+N" beside it. */
export function schoolSource(points: readonly SchoolPoint[], filter: SchoolFilter = DEFAULT_SCHOOL_FILTER): GeoJSONSourceSpecification {
  return {
    type: "geojson", data: schoolFeatures(points, filter),
    cluster: true, clusterRadius: SCHOOL_FOLD_RADIUS, clusterMaxZoom: SCHOOL_FOLD_MAX_ZOOM,
    // A fold is faded only when every school in it is.
    clusterProperties: { best: ["max", ["get", "code"]], faded: ["min", ["get", "faded"]] },
  };
}

/** A school's code, or a fold's best member's. */
const SCHOOL_CODE: ExpressionSpecification = ["coalesce", ["get", "best"], ["get", "code"]];

/**
 * The caps: always SCHOOL_CAP_PX (36 px) with every detail. They sit over the labels and are placed first, so labels and
 * road-collision bursts give way to them (schools are primary); they never hide each other.
 */
export function schoolLayer(): SymbolLayerSpecification {
  return {
    id: SCHOOL_LAYER, type: "symbol", source: SCHOOL_SOURCE_ID, minzoom: SCHOOL_MIN_ZOOM,
    layout: {
      "icon-image": ["concat", "school-", ["to-string", SCHOOL_CODE]],
      "icon-size": 1,
      "icon-allow-overlap": true,
      "icon-padding": 0,
      // Lower keys are placed and drawn first: Ruby … Silver, Outstanding, then the rest.
      "symbol-sort-key": ["-", 0, SCHOOL_CODE],
    },
    paint: { "icon-opacity": ["case", ["==", ["get", "faded"], 1], SCHOOL_FADED_OPACITY, 1] },
  };
}

/** "+N" beside a fold's cap: N more schools here; a tap zooms in. */
export function schoolFoldLayer(): SymbolLayerSpecification {
  return {
    id: SCHOOL_FOLD_LAYER, type: "symbol", source: SCHOOL_SOURCE_ID, minzoom: SCHOOL_MIN_ZOOM,
    filter: ["has", "point_count"],
    layout: {
      "icon-image": ["concat", SCHOOL_FOLD_PREFIX, ["to-string", ["-", ["get", "point_count"], 1]]],
      "icon-anchor": "left",
      "icon-offset": [14, 11],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  };
}

/** The count a fold image id stands for ("school-fold-3" → 3), or null. */
export function schoolFoldCount(imageId: string): number | null {
  if (!imageId.startsWith(SCHOOL_FOLD_PREFIX)) return null;
  const count = Number(imageId.slice(SCHOOL_FOLD_PREFIX.length));
  return Number.isInteger(count) && count > 0 && count < 10000 ? count : null;
}

/** A point back from a rendered feature's properties (null for a fold). */
export function schoolPointFromProperties(properties: Record<string, unknown> | undefined, at: [number, number]): SchoolPoint | null {
  const urn = typeof properties?.urn === "string" ? properties.urn : null;
  if (!urn || !/^\d{6}$/.test(urn)) return null;
  const text = (key: string) => (typeof properties?.[key] === "string" && properties[key] ? properties[key] as string : undefined);
  const flag = (key: string) => properties?.[key] === true || properties?.[key] === "true";
  const count = (key: string) => {
    const value = Number(properties?.[key]);
    return value > 0 ? value : undefined;
  };
  const rank = count("aLevelRank"), pool = count("aLevelPool"), year = text("aLevelYear");
  const point: SchoolPoint = {
    urn, name: text("name") ?? "School", phase: text("phase") ?? "", longitude: at[0], latitude: at[1],
    kind: text("kind") === "independent" ? "independent" : "state", stage: (text("stage") as SchoolStage | undefined),
    ofsted: text("ofsted") as OfstedMark | undefined, topPercent: count("topPercent"), rankYear: text("rankYear"),
    regionRank: count("regionRank"), regionPool: count("regionPool"),
    selective: flag("selective"), faith: text("faith"), sixthForm: flag("sixthForm"), intake: text("intake"),
  };
  if (rank !== undefined && pool !== undefined && year !== undefined) point.aLevelRank = { rank, pool, year };
  const scopeCode = text("rankScopeCode"), scopeName = text("rankScopeName");
  if (scopeCode && scopeName) point.rankScope = { code: scopeCode, name: scopeName };
  return point;
}

/** A faith tag as parents say it: "Catholic", "C of E"; nothing for none or unknown. Descriptive only. */
export function faithTag(faith: string | null | undefined): string | null {
  const text = (faith ?? "").trim();
  if (!text || /^(none|unknown|does not apply|not applicable)$/i.test(text)) return null;
  if (/^church of england/i.test(text)) return "C of E";
  if (/^(roman )?catholic$/i.test(text)) return "Catholic";
  return text;
}

export interface SchoolPopupTag { label: string; top?: boolean }

/**
 * Up to 3 tags, most useful for parents first: Private (or the A-level rank tag where a private
 * school has a combined A-level rank, issue #201) · Top N% England · year (the exact figure behind the cap's
 * 1/3/5/10/25 plaque, the same one the school page prints; the London place is the popup's own line) · phase · Grammar · faith ·
 * Sixth form · Girls/Boys (with "mixed sixth form" it stands for the Sixth form tag too).
 */
export function schoolTags(point: SchoolPoint): SchoolPopupTag[] {
  const top = schoolEnglandTop(point);
  const faith = faithTag(point.faith);
  const mixedSixth = /mixed sixth form/.test(point.intake ?? "");
  const aLevel = point.aLevelRank
    ? { label: `A level #${point.aLevelRank.rank} of ${point.aLevelRank.pool}`, top: true }
    : null;
  return [
    point.kind === "independent" ? (aLevel ?? { label: "Private" }) : null,
    top ? { label: `Top ${top}% England${point.rankYear ? ` · ${point.rankYear}` : ""}`, top: true } : null,
    { label: STAGE_LABEL[stageOf(point)] },
    point.selective ? { label: "Grammar" } : null,
    faith ? { label: faith } : null,
    point.sixthForm && !mixedSixth ? { label: "Sixth form" } : null,
    point.intake ? { label: point.intake } : null,
  ].filter((tag): tag is SchoolPopupTag => tag !== null).slice(0, 3);
}

export interface SchoolPopupView {
  urn: string;
  name: string;
  href: string;
  /** GIAS for a private school (it has no page here); the school's page otherwise. */
  external: boolean;
  ofsted: { mark: OfstedMark; label: string } | null;
  tags: SchoolPopupTag[];
  /** "#12 of 2,256 in London": the exact place is in the popup, never on the map. */
  position: string | null;
}

/** The hover popup: name and › to its page, Ofsted as a swatch with words for its tooltip, tags, London place. */
export function schoolPopupView(point: SchoolPoint): SchoolPopupView {
  const independent = point.kind === "independent";
  const ofsted = !independent && point.ofsted
    ? { mark: point.ofsted, label: point.ofsted === "report-card" ? "New Ofsted report card" : `Ofsted: ${OFSTED_LABEL[point.ofsted]}` }
    : null;
  const position = !independent && point.regionRank && point.regionPool && point.regionRank <= point.regionPool
    ? `#${point.regionRank.toLocaleString("en-GB")} of ${point.regionPool.toLocaleString("en-GB")} in ${point.rankScope?.name ?? "London"}`
    : independent && point.aLevelRank
      ? `#${point.aLevelRank.rank.toLocaleString("en-GB")} of ${point.aLevelRank.pool.toLocaleString("en-GB")} ${point.rankScope?.name ?? "London"} sixth forms`
      : null;
  return { urn: point.urn, name: point.name, href: independent ? `${GIAS_DETAILS}${point.urn}` : schoolPath(point.urn),
    external: independent, ofsted, tags: schoolTags(point), position };
}

const PHASE_WORDS: Readonly<Record<string, string>> = { primary: "Primary school", secondary: "Secondary school" };

export interface SchoolMapCardData {
  /** Name, link, Ofsted, tags and London place, as the hover peek shows them. */
  view: SchoolPopupView;
  /** "Primary school", "Private secondary school". */
  detail: string;
  /** Straight line from the home pin, when there is one: "450 m", "1.4 km". */
  distance: string | null;
  /** The ♡ for a school with a page here; a private school (GIAS only) has none. */
  save: SavedItemInput | null;
}

/** A tapped school's card in the sheet (components/map-cards.tsx), from the point its cap was drawn for. */
export function schoolMapCard(point: SchoolPoint, from: [number, number] | null): SchoolMapCardData {
  const view = schoolPopupView(point);
  const independent = point.kind === "independent";
  const detail = independent ? `Private ${point.phase === "primary" ? "primary" : "secondary"} school` : PHASE_WORDS[point.phase] ?? "State school";
  const at: [number, number] = [point.longitude, point.latitude];
  return {
    view, detail,
    distance: from ? formatDistance(straightLineKm(from, at) * 1000) : null,
    save: independent ? null : { kind: "school", id: point.urn, name: point.name, meta: detail, href: view.href, at },
  };
}

// ---- One load of the points per release ------------------------------------------------------------------

const pointLoads = new Map<string, Promise<SchoolPoint[] | null>>();

/** The school points at `path` (the release is in it), fetched once and shared by the map and the Show list. */
export function loadSchoolPoints(path: string): Promise<SchoolPoint[] | null> {
  let load = pointLoads.get(path);
  if (!load) {
    load = fetch(path)
      .then((response) => (response.ok ? response.json() as Promise<SchoolPointsResponse> : null))
      .then((payload) => payload?.schools ?? null)
      .catch(() => null);
    load.then((points) => { if (!points) pointLoads.delete(path); }).catch(() => undefined);
    pointLoads.set(path, load);
  }
  return load;
}
