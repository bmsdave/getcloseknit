// Preview mirror of api/area_api/similarity.py: neighbourhoods whose London
// percentiles for crime, deprivation, income, price level and station access
// sit closest to one area's. Demographic composition is never compared.
import { friendlyTitle } from "./area-labels";
import { demoFriendlyFields } from "./area-labels-fixture";
import type { FactorId, GeographyId, MatchZone, SimilarArea, SimilarAreasResponse } from "./contracts";
import { previewAreaVectors } from "./matching";
import { previewZoneLsoas } from "./zones";

export const SIMILARITY_FACTORS: FactorId[] = ["crime", "deprivation", "income", "market-level", "station-access"];
export const MAX_SIMILAR_RESULTS = 10;
const MIN_SHARED_FACTORS = 3;
const PRICE_FACTOR: FactorId = "market-level";

const CAVEATS = [
  "Similarity compares London percentiles of crime, deprivation, household income, price per m² "
  + "and walk to a station. It never compares who lives in an area.",
  "Similar evidence is not a recommendation: check each area's own evidence before relying on it.",
];
const CHEAPER_CAVEAT = "Cheaper means a lower median price per m² of recorded sales (market level), "
  + "not a lower price for any particular home.";
const ZONES_CAVEAT = "Areas inside your zones are left out.";

export interface AreaVector {
  geographyId: GeographyId;
  name: string;
  factors: Partial<Record<FactorId, { rawValue: number; utility: number; unit: string }>>;
}

export interface SimilarOptions {
  cheaper?: boolean;
  exclude?: ReadonlySet<string>;
  limit?: number;
}

export function similarAreas(
  targetId: GeographyId,
  areas: AreaVector[],
  factors: FactorId[],
  options: SimilarOptions = {},
): SimilarArea[] {
  const target = areas.find((area) => area.geographyId === targetId);
  if (!target) return [];
  const wanted = factors.filter((factor) => target.factors[factor] !== undefined);
  if (wanted.length < MIN_SHARED_FACTORS) return [];
  const needed = Math.max(MIN_SHARED_FACTORS, wanted.length - 1);
  const price = target.factors[PRICE_FACTOR]?.rawValue;
  if (options.cheaper && price === undefined) return [];
  const matches: SimilarArea[] = [];
  for (const area of areas) {
    if (area.geographyId === targetId || options.exclude?.has(area.geographyId)) continue;
    const shared = wanted.filter((factor) => area.factors[factor] !== undefined);
    if (shared.length < needed) continue;
    const candidatePrice = area.factors[PRICE_FACTOR]?.rawValue;
    if (options.cheaper && (candidatePrice === undefined || candidatePrice >= (price as number))) continue;
    matches.push(similarMatch(area, target, shared));
  }
  matches.sort((left, right) => right.similarity - left.similarity
    || (left.geographyId < right.geographyId ? -1 : left.geographyId > right.geographyId ? 1 : 0));
  return matches.slice(0, options.limit ?? MAX_SIMILAR_RESULTS);
}

function similarMatch(area: AreaVector, target: AreaVector, shared: FactorId[]): SimilarArea {
  const components = shared.map((factorId) => {
    const mine = area.factors[factorId]!;
    const theirs = target.factors[factorId]!;
    return {
      factorId, rawValue: mine.rawValue, unit: mine.unit, utility: mine.utility,
      targetUtility: theirs.utility, targetRawValue: theirs.rawValue,
    };
  });
  const squared = components.reduce((sum, item) => sum + (item.utility - item.targetUtility) ** 2, 0);
  const distance = Math.sqrt(squared / components.length);
  return {
    geographyId: area.geographyId,
    name: area.name,
    title: friendlyTitle(demoFriendlyFields(area.geographyId)),
    similarity: Math.round(Math.max(0, 100 - distance) * 10) / 10,
    components,
  };
}

export function similarFactors(socialRenting: boolean): FactorId[] {
  return socialRenting ? [...SIMILARITY_FACTORS, "social-renting"] : [...SIMILARITY_FACTORS];
}

export function similarCaveats(cheaper: boolean, outsideZones: boolean): string[] {
  return [...CAVEATS, ...(cheaper ? [CHEAPER_CAVEAT] : []), ...(outsideZones ? [ZONES_CAVEAT] : [])];
}

/** Preview answer of GET /api/v1/areas/{id}/similar; null for an unknown area. */
export function previewSimilarAreas(
  geographyId: GeographyId,
  options: { cheaper: boolean; zones: MatchZone[] | null; socialRenting: boolean },
): SimilarAreasResponse | null {
  const areas = previewAreaVectors();
  const target = areas.find((area) => area.geographyId === geographyId);
  if (!target) return null;
  const factors = similarFactors(options.socialRenting);
  const inside = previewZoneLsoas(options.zones ?? undefined);
  return {
    schemaVersion: "similar-areas.v1",
    geographyId,
    name: target.name,
    factors,
    cheaper: options.cheaper,
    outsideZones: inside !== null,
    values: similarAreas(geographyId, areas, factors, { cheaper: options.cheaper, exclude: inside ?? undefined }),
    caveats: similarCaveats(options.cheaper, inside !== null),
  };
}

/** Request path for the similar-areas list; zones travel only when asked to leave them out. */
export function similarAreasPath(
  geographyId: GeographyId,
  options: { cheaper: boolean; outsideZones: MatchZone[] | null },
): string {
  const parameters = new URLSearchParams();
  if (options.cheaper) parameters.set("cheaper", "true");
  if (options.outsideZones?.length) parameters.set("outsideZones", JSON.stringify(options.outsideZones));
  const query = parameters.toString();
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/similar${query ? `?${query}` : ""}`;
}
