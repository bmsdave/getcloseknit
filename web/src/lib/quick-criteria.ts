/**
 * Quick criteria (migration 028): My match factors read from data the release already holds,
 * with the plain words their cards use. Mirrors api/area_api/quick_criteria.py and the
 * `disorder` rows the crime ETL writes. Pure: no React.
 */
import type { FactorId, MatchComponent } from "./contracts";

export const QUICK_FACTOR_IDS = ["noise", "disorder", "epc-share", "leasehold-share"] as const satisfies readonly FactorId[];
export type QuickFactorId = (typeof QUICK_FACTOR_IDS)[number];

export const QUICK_FACTOR_LABELS: Record<QuickFactorId, string> = {
  noise: "Noise",
  disorder: "Visible disorder",
  "epc-share": "Energy rating A–C",
  "leasehold-share": "Leasehold share",
};

/** One line on what each factor measures, for the wizard and Claude's descriptions. */
export const QUICK_FACTOR_HELP: Record<QuickFactorId, string> = {
  noise: "Share of homes at 55 dB or more (day-evening-night) from road, rail or aircraft, Defra noise maps 2022.",
  disorder: "Anti-social behaviour, criminal damage and arson, and public order per 1,000 residents over 12 months (police.uk).",
  "epc-share": "Share of homes with an energy certificate rated A, B or C. Only homes with a certificate count.",
  "leasehold-share": "Share of last year's sales that were leasehold (HM Land Registry), not the share of homes.",
};

export function isQuickFactor(id: string): id is QuickFactorId {
  return (QUICK_FACTOR_IDS as readonly string[]).includes(id);
}

const percent = (value: number | null | undefined) => (value === null || value === undefined ? "?" : `${Math.round(value)}%`);

/** The figures behind a quick factor, in words, for its criterion card; null for other factors. */
export function quickFactorNote(component: Pick<MatchComponent, "factorId" | "rawValue" | "detail" | "quality">): string | null {
  const detail = component.detail ?? {};
  switch (component.factorId) {
    case "noise":
      return `${percent(component.rawValue)} of homes at 55 dB or more: road ${percent(detail.road)}, rail ${percent(detail.rail)}, aircraft ${percent(detail.air)}.`;
    case "disorder":
      return `${component.rawValue.toLocaleString("en-GB", { maximumFractionDigits: 1 })} incidents per 1,000 residents a year: anti-social behaviour, criminal damage, public order${component.quality === "fallback" ? " (neighbourhood rate)" : ""}.`;
    case "epc-share": {
      const rated = typeof detail.homesRated === "number" ? ` (of ${detail.homesRated.toLocaleString("en-GB")} homes with a certificate)` : "";
      return `${percent(component.rawValue)} of homes rated A–C${rated}.`;
    }
    case "leasehold-share": {
      const sales = typeof detail.sales === "number" ? ` of ${detail.sales} sales` : " of sales";
      const where = component.quality === "fallback" ? " in the wider neighbourhood" : "";
      const mostly = component.rawValue >= 50 ? " Mostly leasehold: check years left on the lease and the service charge." : "";
      return `${percent(component.rawValue)}${sales} in the last year were leasehold${where}.${mostly}`;
    }
    default:
      return null;
  }
}
