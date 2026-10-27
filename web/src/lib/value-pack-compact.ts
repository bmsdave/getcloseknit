/**
 * The map's compact value packs (?format=compact, api map_chunks.compact_pack): per area only what the map paints
 * (id, value, regional and England percentiles, quality, a roll-up's area count, crime's breakdown) as rows, with
 * what every entry repeats said once. England's 34k LSOAs are ~1.5 MB of JSON instead of ~15 MB. Read back into the
 * full pack shape here, so everything after the fetch reads one kind of pack; names are left empty (the map never
 * shows a pack's names: cards and tooltips read the area's own evidence).
 */
import type { components } from "./api-types.gen";
import { carrierOf, type GeographyId, type MetricId, type Quality, type ValuePack, type ValuePackEntry } from "./contracts";

export const COMPACT_PACK_SCHEMA = "area-value-pack-compact.v1";

/** The compact pack as the API documents it (contracts/openapi.yaml CompactValuePack). */
type CompactPack = components["schemas"]["CompactValuePack"];

function isCompact(body: unknown): body is CompactPack {
  const pack = body as Partial<CompactPack> | null;
  return !!pack && pack.schemaVersion === COMPACT_PACK_SCHEMA && Array.isArray(pack.values);
}

/** A value pack from either answer: the compact rows read back into entries, a full pack as it is; null otherwise. */
export function readValuePack(body: unknown): ValuePack | null {
  if (!isCompact(body)) {
    const pack = body as Partial<ValuePack> | null;
    return pack && Array.isArray(pack.values) ? pack as ValuePack : null;
  }
  const { metricId, period, sourceVersion } = body;
  const carrier = body.carrier ?? carrierOf(body.values[0]?.[0]?.split(":")[1] ?? "lsoa");
  const values: ValuePackEntry[] = body.values.map(([geographyId, value, regionPercentile, countryPercentile, quality, areaCount, breakdown]) => {
    const entry: ValuePackEntry & { direction?: string | null; areaCount?: number } = {
      geographyId: geographyId as GeographyId, name: "", metricId: metricId as MetricId, period, value,
      regionPercentile, countryPercentile, sampleCount: null, quality: quality as Quality, sourceVersion, carrier,
      direction: body.direction ?? null,
    };
    if (areaCount !== null && areaCount !== undefined) entry.areaCount = areaCount;
    if (breakdown) entry.breakdown = breakdown;
    return entry;
  });
  return {
    schemaVersion: "area-value-pack.v1", metricId: metricId as MetricId, period, sourceVersion,
    ...(body.productReleaseId ? { productReleaseId: body.productReleaseId } : {}), values,
  };
}
