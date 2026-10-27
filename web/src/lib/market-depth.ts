/**
 * Local market depth for the area page's Price rows: GET /api/v1/areas/{id}/market (area-market.v1,
 * an evidence envelope around api/area_api/market_depth.py's payload): 12-month sales and turnover,
 * the leasehold share of sales, resale and new-build £/m² over 36 months and growth. Aggregates only.
 */
import type { GeographyId, MarketSection } from "./contracts";
import type { DataMode } from "./map-state";

export function marketDepthPath(id: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/market`;
}

/** The market block from the envelope (or a bare payload); real mode never takes the demo's. */
export function readMarketDepth(payload: unknown, mode: DataMode): MarketSection | null {
  const record = payload as { schemaVersion?: string; value?: unknown } | null;
  if (!record || record.schemaVersion !== "area-market.v1") return null;
  const value = (record.value ?? record) as Partial<MarketSection> & { sourceVersion?: string | null };
  if (typeof value.available !== "boolean") return null;
  if (mode === "real" && value.sourceVersion?.startsWith("preview-")) return null;
  return value as MarketSection;
}
