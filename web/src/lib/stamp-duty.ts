// Stamp Duty Land Tax (SDLT) on a residential purchase in England by
// individuals. One dated rate table, checked against gov.uk on the date
// below; a pure function turns a price into a band-by-band breakdown.
// Out of scope: companies (17% flat rate), 6+ dwellings, shared ownership,
// lease rent (net present value) and reliefs other than first-time buyer.
import type { Sourced } from "./sourced";

export interface SdltBand {
  /** Price from which this band starts (exclusive lower bound, £). */
  from: number;
  /** Upper bound of the band (inclusive, £), or null for "and above". */
  to: number | null;
  /** Base rate for this band, percent. */
  ratePct: number;
}

export interface SdltSource {
  label: string;
  url: string;
}

export interface SdltTable {
  jurisdiction: "england";
  /** The day these rates were checked as in force. */
  inForceOn: string;
  /** Effective dates of the parts of the table. */
  standardFrom: string;
  firstTimeBuyerFrom: string;
  additionalPropertyFrom: string;
  nonResidentFrom: string;
  standard: SdltBand[];
  firstTimeBuyer: SdltBand[];
  /** First-time buyer relief is lost entirely above this price. */
  firstTimeBuyerMaxPrice: number;
  /** Added to every band when the buyer will own more than one home. */
  additionalPropertySurchargePct: number;
  /** The additional-property surcharge does not apply below this price. */
  additionalPropertyMinPrice: number;
  /** Added to every band for buyers who are not UK resident for SDLT. */
  nonResidentSurchargePct: number;
  sources: SdltSource[];
}

export const SDLT_ENGLAND_2026_10_05: SdltTable = {
  jurisdiction: "england",
  inForceOn: "2026-10-05",
  standardFrom: "2025-04-01",
  firstTimeBuyerFrom: "2025-04-01",
  additionalPropertyFrom: "2024-10-31",
  nonResidentFrom: "2021-04-01",
  standard: [
    { from: 0, to: 125_000, ratePct: 0 },
    { from: 125_000, to: 250_000, ratePct: 2 },
    { from: 250_000, to: 925_000, ratePct: 5 },
    { from: 925_000, to: 1_500_000, ratePct: 10 },
    { from: 1_500_000, to: null, ratePct: 12 },
  ],
  firstTimeBuyer: [
    { from: 0, to: 300_000, ratePct: 0 },
    { from: 300_000, to: 500_000, ratePct: 5 },
  ],
  firstTimeBuyerMaxPrice: 500_000,
  additionalPropertySurchargePct: 5,
  additionalPropertyMinPrice: 40_000,
  nonResidentSurchargePct: 2,
  sources: [
    { label: "Residential property rates (gov.uk)", url: "https://www.gov.uk/stamp-duty-land-tax/residential-property-rates" },
    { label: "Higher rates for additional properties (gov.uk)", url: "https://www.gov.uk/guidance/stamp-duty-land-tax-buying-an-additional-residential-property" },
    { label: "Previous rates and thresholds (gov.uk)", url: "https://www.gov.uk/government/publications/rates-and-allowances-stamp-duty-land-tax" },
  ],
};

/** The table with its source and check date, for labels beside a stamp duty figure. */
export const SDLT_RATES: Sourced<SdltTable> = {
  value: SDLT_ENGLAND_2026_10_05,
  kind: "published",
  source: "gov.uk rates",
  sourceUrl: SDLT_ENGLAND_2026_10_05.sources[0].url,
  asOf: SDLT_ENGLAND_2026_10_05.inForceOn,
  asOfVerb: "checked",
};

export interface SdltBuyer {
  price: number;
  firstTimeBuyer: boolean;
  additionalProperty: boolean;
  nonUkResident: boolean;
}

export interface SdltBandResult {
  from: number;
  to: number | null;
  ratePct: number;
  taxable: number;
  tax: number;
}

export type SdltRegime = "standard" | "first-time-buyer";

export interface SdltResult {
  price: number;
  regime: SdltRegime;
  bands: SdltBandResult[];
  total: number;
  effectiveRatePct: number;
  surchargePct: number;
  /** Plain-language notes about which rules were applied or skipped. */
  notes: string[];
}

export function calculateStampDuty(buyer: SdltBuyer, table: SdltTable = SDLT_ENGLAND_2026_10_05): SdltResult {
  const { price } = buyer;
  if (!Number.isFinite(price) || price < 0) throw new Error("price must be zero or more");
  const notes: string[] = [];
  const regime = chooseRegime(buyer, table, notes);
  const surchargePct = surcharge(buyer, table, notes);
  const base = regime === "first-time-buyer" ? table.firstTimeBuyer : table.standard;
  const bands = base.map((band) => bandResult(band, price, surchargePct));
  const total = roundDownPound(bands.reduce((sum, band) => sum + band.tax, 0));
  return {
    price,
    regime,
    bands,
    total,
    effectiveRatePct: price > 0 ? (total / price) * 100 : 0,
    surchargePct,
    notes,
  };
}

function chooseRegime(buyer: SdltBuyer, table: SdltTable, notes: string[]): SdltRegime {
  if (!buyer.firstTimeBuyer) return "standard";
  if (buyer.additionalProperty) {
    notes.push("First-time buyer relief does not apply when you will own another home.");
    return "standard";
  }
  if (buyer.price > table.firstTimeBuyerMaxPrice) {
    notes.push(`First-time buyer relief stops above £${table.firstTimeBuyerMaxPrice.toLocaleString("en-GB")}, so standard rates apply.`);
    return "standard";
  }
  return "first-time-buyer";
}

function surcharge(buyer: SdltBuyer, table: SdltTable, notes: string[]): number {
  let pct = 0;
  if (buyer.additionalProperty) {
    if (buyer.price >= table.additionalPropertyMinPrice) pct += table.additionalPropertySurchargePct;
    else notes.push(`The additional-property surcharge does not apply below £${table.additionalPropertyMinPrice.toLocaleString("en-GB")}.`);
  }
  if (buyer.nonUkResident) pct += table.nonResidentSurchargePct;
  return pct;
}

function bandResult(band: SdltBand, price: number, surchargePct: number): SdltBandResult {
  const top = band.to === null ? price : Math.min(price, band.to);
  const taxable = Math.max(0, top - band.from);
  const ratePct = band.ratePct + surchargePct;
  return { from: band.from, to: band.to, ratePct, taxable, tax: (taxable * ratePct) / 100 };
}

/** HMRC rounds SDLT due down to the whole pound. */
function roundDownPound(value: number): number {
  return Math.floor(value + 1e-9);
}
