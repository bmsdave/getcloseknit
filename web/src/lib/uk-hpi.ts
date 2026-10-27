/**
 * The official house price index for an area's borough (area-hpi.v1, HM Land Registry UK HPI,
 * api/area_api/uk_hpi.py). Borough-wide: a price line since 1995 by type of home and the change
 * over 1, 5 and 10 years against London. Our own £/m² stays the local figure.
 */
import type { GeographyId } from "./contracts";

export type HpiType = "all" | "detached" | "semi" | "terraced" | "flat";
export type HpiSpan = "1y" | "5y" | "10y";

export const HPI_TYPE_LABELS: Record<HpiType, string> = {
  all: "All", detached: "Detached", semi: "Semi", terraced: "Terraced", flat: "Flats",
};
export const HPI_SPANS: readonly HpiSpan[] = ["1y", "5y", "10y"];
export const HPI_SPAN_LABELS: Record<HpiSpan, string> = { "1y": "1 yr", "5y": "5 yrs", "10y": "10 yrs" };

export interface HpiTypeSeries {
  type: HpiType;
  latestPrice: number | null;
  change: Record<HpiSpan, number | null>;
  regionChange: Record<HpiSpan, number | null>;
  /** Quarterly to the latest month: YYYY-MM. */
  series: { month: string; price: number }[];
}

export interface AreaHpi {
  geographyId: GeographyId;
  available: boolean;
  borough: { id: GeographyId; name: string };
  latest: string | null;
  types: HpiTypeSeries[];
  regionPercentile: Partial<Record<"5y" | "10y", number | null>>;
}

export interface AreaHpiResponse {
  schemaVersion: "area-hpi.v1";
  productReleaseId?: string;
  dataMode?: "release" | "demo";
  value: AreaHpi;
  confidence: string;
  sources: { sourceId: string; release: string; attribution: string; licence: string }[];
  caveats: string[];
}

export function hpiPath(id: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/hpi`;
}

/** The payload when it is area-hpi.v1; real mode never takes the demo's. */
export function readAreaHpi(payload: unknown, mode: "real" | "demo"): AreaHpiResponse | null {
  const body = payload as Partial<AreaHpiResponse> | null;
  if (!body || body.schemaVersion !== "area-hpi.v1" || !body.value || !Array.isArray(body.value.types)) return null;
  if (mode === "real" && body.dataMode === "demo") return null;
  return body as AreaHpiResponse;
}

/** "+9.2%", "−5.2%", "0%"; unknown when not published. */
export function formatChange(value: number | null): string {
  if (value === null) return "unknown";
  if (value === 0) return "0%";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

/** Demo index shaped like area-hpi.v1 (made up): a steady climb with a dip after 2008. */
export function fixtureAreaHpi(id: GeographyId): AreaHpiResponse {
  const months: string[] = [];
  for (let year = 1995; year <= 2026; year += 1) {
    for (const month of [1, 4, 7, 10]) if (year < 2026 || month <= 7) months.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  const curve = (index: number) => 1 + index * 0.05 - (index > 54 && index < 70 ? 0.6 : 0);
  const types = (["all", "flat", "terraced", "semi", "detached"] as const).map((type, offset): HpiTypeSeries => {
    const base = [90_000, 70_000, 95_000, 120_000, 180_000][offset];
    const series = months.map((month, index) => ({ month, price: Math.round(base * curve(index)) }));
    return {
      type, latestPrice: series.at(-1)!.price,
      change: { "1y": 2.1 - offset * 0.4, "5y": 6.3 + offset, "10y": 14.8 + offset * 2 },
      regionChange: { "1y": 1.2, "5y": 4.9, "10y": 12.0 },
      series,
    };
  });
  return {
    schemaVersion: "area-hpi.v1",
    dataMode: "demo",
    value: {
      geographyId: id, available: true,
      borough: { id: "uk:lad:E09000019" as GeographyId, name: "Islington" },
      latest: "2026-07", types, regionPercentile: { "5y": 64, "10y": 58 },
    },
    confidence: "medium",
    sources: [{ sourceId: "hmlr-uk-hpi", release: "preview-hmlr-uk-hpi", licence: "OGL-3.0",
      attribution: "Demo numbers shaped like the HM Land Registry UK House Price Index." }],
    caveats: ["Demo data: not real prices."],
  };
}
