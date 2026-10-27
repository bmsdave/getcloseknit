import type { Carrier } from "./contracts";

export interface HistoricalPriceInputs {
  nominalPrice: number;
  cpihAtSale: number;
  cpihLatest: number;
  localPricePerSquareMetreAtSale: number | null;
  localPricePerSquareMetreLatest: number | null;
}

export interface HistoricalPriceComparison {
  nominalPrice: number;
  inflationAdjustedPrice: number;
  localMarketAdjustedPrice: number | null;
}

export interface PriceHistoryPoint {
  period: string;
  nominal: number | null;
  inflationAdjusted: number | null;
  localMarketAdjusted: number | null;
}

export interface PriceSampleCounts {
  allSales: number;
  matchedSales: number;
  excludedSales: number;
  carrierSales: number;
  carrier: Carrier;
}

export interface PriceSample extends PriceSampleCounts {
  explanation: string;
}

export interface PriceComposition {
  byPropertyType: Record<string, number>;
  newBuildShare: number | null;
}

export interface CompositionSale {
  propertyType: string;
  newBuild: boolean;
}

/** Square metres in one square foot of floor area. */
export const SQM_PER_SQFT = 10.7639;

export const PRICE_ENGLAND_NOTE =
  "Not published: nationwide price coverage is incomplete.";

export function toPricePerSquareFoot(poundsPerSquareMetre: number): number {
  return poundsPerSquareMetre / SQM_PER_SQFT;
}

export function toPricePerSquareMetre(poundsPerSquareFoot: number): number {
  return poundsPerSquareFoot * SQM_PER_SQFT;
}

export function adjustByIndex(nominal: number, atSale: number, latest: number): number {
  return Math.round((nominal * latest) / atSale);
}

export function compareHistoricalPrice(
  inputs: HistoricalPriceInputs,
): HistoricalPriceComparison {
  if (inputs.cpihAtSale <= 0 || inputs.cpihLatest <= 0) {
    throw new Error("CPIH values must be positive");
  }
  return {
    nominalPrice: inputs.nominalPrice,
    inflationAdjustedPrice: adjustByIndex(
      inputs.nominalPrice,
      inputs.cpihAtSale,
      inputs.cpihLatest,
    ),
    localMarketAdjustedPrice: marketAdjustedPrice(inputs),
  };
}

export function buildPriceHistorySeries(
  nominalByPeriod: { period: string; nominal: number | null }[],
  cpihByPeriod: Record<string, number>,
  cpihLatest: number | null,
  localByPeriod: Record<string, number>,
  localLatest: number | null,
): PriceHistoryPoint[] {
  return nominalByPeriod.map(({ period, nominal }) => ({
    period,
    nominal,
    inflationAdjusted: adjustPoint(nominal, cpihByPeriod[period], cpihLatest),
    localMarketAdjusted: adjustPoint(nominal, localByPeriod[period], localLatest),
  }));
}

export function describePriceSample(counts: PriceSampleCounts): PriceSample {
  return {
    ...counts,
    explanation:
      `${counts.matchedSales} matched sales support this number at ` +
      `${counts.carrier.toUpperCase()} level; ${counts.excludedSales} of ` +
      `${counts.allSales} sales had no usable floor area and are excluded.`,
  };
}

export function describeComposition(sales: CompositionSale[]): PriceComposition {
  const byPropertyType: Record<string, number> = {};
  for (const sale of sales) {
    byPropertyType[sale.propertyType] = (byPropertyType[sale.propertyType] ?? 0) + 1;
  }
  const newBuild = sales.filter((sale) => sale.newBuild).length;
  return {
    byPropertyType,
    newBuildShare: sales.length === 0 ? null : newBuild / sales.length,
  };
}

export function priceEnglandComparison(): { value: null; note: string } {
  return { value: null, note: PRICE_ENGLAND_NOTE };
}

function adjustPoint(
  nominal: number | null,
  atSale: number | undefined,
  latest: number | null,
): number | null {
  if (nominal === null || atSale === undefined || latest === null) return null;
  if (atSale <= 0 || latest <= 0) return null;
  return adjustByIndex(nominal, atSale, latest);
}

function marketAdjustedPrice(inputs: HistoricalPriceInputs): number | null {
  const atSale = inputs.localPricePerSquareMetreAtSale;
  const latest = inputs.localPricePerSquareMetreLatest;
  if (atSale === null || latest === null || atSale <= 0) {
    return null;
  }
  return adjustByIndex(inputs.nominalPrice, atSale, latest);
}
