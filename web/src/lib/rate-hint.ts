import { LATEST_BOE_RATES } from "./boe-latest";
import { formatMonth } from "./mortgage-rates";
import { sourceLabel } from "./sourced";

export interface LatestRateHint {
  month: string;
  fixed2: number;
  fixed5: number;
  /** "Bank of England, Aug 2026". */
  source: string;
}

/** The latest average new fixed rates for the calculators, or null when none are published. */
export function latestRateHint(): LatestRateHint | null {
  const latest = LATEST_BOE_RATES?.value;
  return LATEST_BOE_RATES && latest && latest.fixed2 !== null && latest.fixed5 !== null
    ? { month: formatMonth(latest.month), fixed2: latest.fixed2, fixed5: latest.fixed5, source: sourceLabel(LATEST_BOE_RATES) }
    : null;
}
