/**
 * The area page's server-read JSON (the SEO rule): the server reads every payload the default
 * page shows and sends it with the page, keyed by the exact URL each client hook asks for, so the
 * first paint, crawlers and no-JS readers get every section whole and the hooks skip the fetch.
 * Pure: the URLs here are the ones the hooks build (tests/section-seed.test.ts guards the list).
 */
import type { GeographyId, MetricDefinition, MetricId } from "./contracts";
import { homePath } from "./area-home";
import { overviewLayersPath } from "./area-layers";
import { shortLetsPath } from "./short-lets";
import { healthPath } from "./area-health";
import { locationPath } from "./area-location";
import { areaProfilePath } from "./area-profile-path";
import { rentsPath } from "./area-rents";
import { rentTrendPath } from "./rent-trend";
import { areaSafetyPathFor } from "./area-safety";
import { civicPath } from "./civic";
import { fallbackMetric, getMetric } from "./fixtures";
import { floodPath } from "./flood-risk";
import { kidsPath } from "./kids";
import { planEvidenceRequest, type DataMode } from "./map-state";
import { marketPath, recentSalesPath } from "./market";
import { marketDepthPath } from "./market-depth";
import { areaPeoplePath } from "./people-profile";
import { placesPath } from "./places";

/** URL → parsed JSON body; null when the server got a definite "not here" (404). */
export type SectionSeed = Readonly<Record<string, unknown>>;

export const METRICS_PATH = "/api/v1/metrics";
export const HEALTH_PATH = "/api/v1/health";
/** The profile asks for every topic at its newest published month. */
export const LATEST_PROFILE_PERIOD = "9999-12";
export const PRICE_METRIC: MetricId = "price-per-square-metre";
export const FOOD_HYGIENE_METRIC: MetricId = "food-hygiene";
/** The metric definitions the page reads (price and crime sources, food hygiene's period): the seed keeps only these. */
export const PAGE_METRICS: readonly MetricId[] = [PRICE_METRIC, "crime", FOOD_HYGIENE_METRIC];

const area = (id: GeographyId) => `/api/v1/areas/${encodeURIComponent(id)}`;
const home = (uprn: string | null) => uprn ? `?uprn=${encodeURIComponent(uprn)}` : "";

export const noisePath = (id: GeographyId, uprn: string | null) => `${area(id)}/noise${home(uprn)}`;
export const naturePath = (id: GeographyId, uprn: string | null) => `${area(id)}/nature${home(uprn)}`;
export const areaSchoolsPath = (id: GeographyId) => `${area(id)}/schools`;
export const foodHygienePath = (id: GeographyId, period: string) => `${area(id)}?metric=${FOOD_HYGIENE_METRIC}&period=${encodeURIComponent(period)}`;

/** A metric's evidence URL as useAreaEvidence builds it; null when the mode does not serve it. */
export function evidencePath(selected: GeographyId, metric: MetricDefinition, period: string, mode: DataMode, release: string): string | null {
  const planned = planEvidenceRequest({ selected, layer: metric.id, layerLabel: metric.label, metric: metric.id, period, mode, release });
  return planned.kind === "fetch" ? planned.path : null;
}

/** The newest period of a metric, as the page asks for it. */
export const newestPeriod = (metric: MetricDefinition) => metric.periods.at(-1) ?? metric.defaultPeriod;

/** The page's metric definition: the release's in real mode (once read), the fixture's in demo. */
export function pageMetric(id: MetricId, mode: DataMode, metrics: readonly MetricDefinition[] | null): MetricDefinition {
  return (mode === "real" ? metrics?.find((metric) => metric.id === id) : undefined) ?? fallbackMetric(id, mode);
}

export interface AreaSeedQuery {
  /** The page's neighbourhood. */
  geographyId: GeographyId;
  /** The evidence's own area (a fallback area answers for its parent); usually the same. */
  areaId: GeographyId;
  mode: DataMode;
  release: string;
  /** The price period the page reads. */
  period: string;
  /** The home the link carried, when it has one. */
  uprn: string | null;
  /** A home page also shows the Overview tiles (the layers scorecard, ?scope=overview). */
  layers?: boolean;
}

/** Everything the default page reads before it knows the metrics (the first round). */
export function areaSeedPaths({ geographyId, areaId, mode, release, period, uprn, layers = false }: AreaSeedQuery): string[] {
  const crime = getMetric("crime");
  const real = mode === "real";
  return unique([
    METRICS_PATH, HEALTH_PATH,
    evidencePath(geographyId, fallbackMetric(PRICE_METRIC, mode), period, mode, release),
    // The Safety tile's trend reads crime at the fixture's newest month (evidence-panel useCrimeTrend).
    evidencePath(areaId, crime, newestPeriod(crime), mode, release),
    areaProfilePath({ selected: areaId, period: LATEST_PROFILE_PERIOD, mode, release }),
    floodPath(areaId, uprn), placesPath({ selected: areaId, uprn, mode, release }),
    marketPath(geographyId), marketDepthPath(geographyId), recentSalesPath(geographyId, 1, "nearest"), rentTrendPath(geographyId),
    areaSafetyPathFor(geographyId),
    civicPath({ geographyId: areaId }), rentsPath(areaId),
    noisePath(areaId, uprn), naturePath(areaId, uprn), kidsPath(areaId), areaSchoolsPath(areaId), areaPeoplePath(areaId),
    real ? homePath(areaId) : null, real ? locationPath(areaId) : null, real ? healthPath(areaId) : null,
    layers ? overviewLayersPath(geographyId) : null,
    real ? shortLetsPath(geographyId) : null,
  ]);
}

/**
 * The second round, once the metrics (and safety) are in: food hygiene at its metric's period, and the
 * crime line Safety draws only when the rate moved (its period is the release's crime metric's).
 */
export function areaSeedFollowUps(query: AreaSeedQuery, metrics: readonly MetricDefinition[] | null, crimeMoved: boolean): string[] {
  const food = metrics?.find((metric) => metric.id === FOOD_HYGIENE_METRIC)?.defaultPeriod;
  const crime = pageMetric("crime", query.mode, metrics);
  return unique([
    food ? foodHygienePath(query.areaId, food) : null,
    crimeMoved ? evidencePath(query.areaId, crime, newestPeriod(crime), query.mode, query.release) : null,
  ]);
}

function unique(paths: readonly (string | null)[]): string[] {
  return [...new Set(paths.filter((path): path is string => path !== null))];
}
