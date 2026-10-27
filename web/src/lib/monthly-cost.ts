// Stream G2: the full monthly cost of living in an area, built on the AE-19 worksheet
// (housing-cost.ts) from what we know about the area and labelled defaults for the rest.
// Every line says where its number comes from: official (a published figure for this
// area), estimated (worked out from published figures) or assumed (a stated default).
// A comparison aid, never a valuation, a quote or mortgage advice.
import { buildCostWorksheet, type CostAssumptions, EMPTY_ASSUMPTIONS } from "./housing-cost";
import { REFERENCING_RULE } from "./referencing";
import { formatAsOf, type Sourced, sourceLabel } from "./sourced";
import { calculateStampDuty, SDLT_RATES } from "./stamp-duty";

export type CostSource = "official" | "estimated" | "assumed" | "unknown";
export type CouncilTaxBandLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export interface MonthlyCostLine {
  id: string;
  label: string;
  monthly: number | null;
  source: CostSource;
  note: string;
}

export interface UpfrontLine {
  id: string;
  label: string;
  amount: number;
  source: CostSource;
  note: string;
}

export interface MonthlyCostInput {
  market: "buy" | "rent";
  bedrooms: number;
  propertyType: "house" | "flat" | "any";
  /** Ballpark purchase price for the area (£/m² × a typical size); null when unknown. */
  price: number | null;
  /** Borough average monthly rent for the bedroom count; null when unknown. */
  monthlyRent: number | null;
  /** The borough's yearly council tax for the band, and whether the household picked the band. */
  councilTax: { band: CouncilTaxBandLetter; annual: number | null; picked: boolean; financialYear: string } | null;
  /** Latest Bank of England average 2-year fix at 75% LTV. */
  mortgageRate: { ratePct: number; month: string } | null;
  /** Fare zone of the nearest station ("2", "2/3"), or null. */
  zone: string | null;
  /** Whether the household's places are reached by public transport (or none were given). */
  travelsByTransit: boolean;
  firstTimeBuyer: boolean;
}

export interface MonthlyCost {
  lines: MonthlyCostLine[];
  /** Sum of the known lines; `complete` says whether any line is unknown. */
  monthlyTotal: number;
  complete: boolean;
  upfront: UpfrontLine[];
  upfrontTotal: number;
  /** Rent only: the yearly income a referencing check usually looks for. */
  referencing: { incomeNeeded: number; guarantorIncomeNeeded: number } | null;
  notIncluded: string[];
}

// Hamptons analysis of London leasehold flats, 2026 (research 2026-10 §2): the average
// service charge, before ground rent. Real charges vary several-fold by building.
export const LONDON_SERVICE_CHARGE: Sourced<number> = {
  value: 2_801,
  kind: "published",
  source: "Hamptons",
  sourceUrl: "https://www.landlordtoday.co.uk/breaking-news/2026/03/soaring-service-charges-on-leasehold-flats-hit-capital-values/",
  asOf: "2026-03",
};
export const LONDON_SERVICE_CHARGE_ANNUAL = LONDON_SERVICE_CHARGE.value;
export const LONDON_SERVICE_CHARGE_SOURCE = LONDON_SERVICE_CHARGE.sourceUrl!;

export const DEPOSIT_SHARE = 0.25; // matches the 75% loan-to-value of the Bank of England rate
export const TERM_YEARS = 25;
/** The 25% deposit and 25-year term behind the buying lines, shown as assumptions. */
export const BUY_ASSUMPTION: Sourced<{ depositShare: number; termYears: number }> = {
  value: { depositShare: DEPOSIT_SHARE, termYears: TERM_YEARS },
  kind: "assumption",
  source: "Close Knit",
  asOf: "2026-10",
};

// Adult 7-day Travelcard, Zones 1 to N, from 1 March 2026 (fares frozen at 2025 levels):
// Mayoral Decision MD3464, https://www.london.gov.uk/md3464-march-2026-transport-london-fare-changes
// A monthly Travelcard is 3.84 × the 7-day price, rounded up to 10p (same decision).
export const TRAVELCARD_7DAY: Sourced<Record<number, number>> = {
  value: { 2: 44.7, 3: 52.5, 4: 64.2, 5: 76.4, 6: 81.6 },
  kind: "published",
  source: "TfL fares",
  sourceUrl: "https://www.london.gov.uk/md3464-march-2026-transport-london-fare-changes",
  asOf: "2026-03-01",
  asOfVerb: "from",
};
export const TRAVELCARD_7DAY_2026 = TRAVELCARD_7DAY.value;
export const TRAVELCARD_SOURCE = TRAVELCARD_7DAY.sourceUrl!;

// Referencing (research 2026-10 §3): a typical agent rule, kept with its source in referencing.ts.
export const REFERENCING_MULTIPLE = REFERENCING_RULE.value.tenant;
export const GUARANTOR_MULTIPLE = REFERENCING_RULE.value.guarantor;

// Renters' Rights Act 2025, in force in England from 1 May 2026, and the Tenant Fees Act 2019.
export const RENTERS_RIGHTS: Sourced<string[]> = {
  value: [
    "A landlord may ask for at most one month's rent in advance.",
    "Landlords and agents may not invite or accept offers above the advertised rent: no bidding wars.",
    "The deposit is capped at five weeks' rent (six when the rent is £50,000 a year or more), protected in a government scheme.",
  ],
  kind: "published",
  source: "gov.uk",
  sourceUrl: "https://www.gov.uk/government/publications/guide-to-the-renters-rights-act",
  asOf: "2026-05-01",
  asOfVerb: "in force from",
};
export const RENTERS_RIGHTS_NOTES = RENTERS_RIGHTS.value;
export const RENTERS_RIGHTS_SOURCE = RENTERS_RIGHTS.sourceUrl!;

/** Zones 1–N reach for a fare zone: a boundary station ("2/3") counts as the lower zone, Zone 1 as 1–2. */
export function zoneReach(zone: string | null): number | null {
  const zones = (zone ?? "").split("/").map((part) => Number.parseInt(part, 10)).filter((n) => Number.isInteger(n) && n > 0);
  if (!zones.length) return null;
  const reach = Math.max(2, Math.min(...zones));
  return reach in TRAVELCARD_7DAY_2026 ? reach : null;
}

export function monthlyTravelcard(reach: number): number | null {
  const weekly = TRAVELCARD_7DAY_2026[reach];
  return weekly === undefined ? null : Math.ceil(Math.round(weekly * 3.84 * 1000) / 100) / 10;
}

/** A typical council tax band for the size of home, until the household picks the real one. */
export function typicalBand(bedrooms: number): CouncilTaxBandLetter {
  if (bedrooms <= 1) return "C";
  if (bedrooms === 2) return "D";
  if (bedrooms === 3) return "E";
  return "F";
}

export function tenancyDeposit(monthlyRent: number): number {
  const weekly = (monthlyRent * 12) / 52;
  return Math.floor(weekly * (monthlyRent * 12 >= 50_000 ? 6 : 5));
}

export function buildMonthlyCost(input: MonthlyCostInput): MonthlyCost {
  const buying = input.market === "buy";
  const flat = input.propertyType === "flat";
  const deposit = buying && input.price !== null ? Math.round(input.price * DEPOSIT_SHARE) : null;
  const assumptions: CostAssumptions = {
    ...EMPTY_ASSUMPTIONS,
    price: buying ? input.price : null,
    deposit,
    annualInterestRatePct: input.mortgageRate?.ratePct ?? null,
    termYears: TERM_YEARS,
    monthlyRent: buying ? null : input.monthlyRent,
    serviceChargeMonthly: buying && flat ? LONDON_SERVICE_CHARGE_ANNUAL / 12 : null,
    councilTaxMonthly: input.councilTax?.annual != null ? input.councilTax.annual / 12 : null,
  };
  const sheet = buildCostWorksheet(input.market, assumptions);
  const amount = (id: string) => sheet.lines.find((line) => line.id === id)?.monthlyAmount ?? null;

  const lines: MonthlyCostLine[] = [];
  if (buying) {
    lines.push({
      id: "mortgage", label: "Mortgage", monthly: amount("mortgage"),
      source: amount("mortgage") === null ? "unknown" : "estimated",
      note: input.price === null || !input.mortgageRate
        ? "Needs a ballpark price and the latest Bank of England rate."
        : `Ballpark £${round(input.price)} with a ${DEPOSIT_SHARE * 100}% deposit over ${TERM_YEARS} years at ` +
          `${input.mortgageRate.ratePct}% (average 2-year fix at 75% loan-to-value, Bank of England, ${formatAsOf(input.mortgageRate.month)}). ` +
          `Deposit and term are an ${sourceLabel(BUY_ASSUMPTION)}. Not mortgage advice.`,
    });
    if (flat) {
      lines.push({
        id: "service-charge", label: "Service charge", monthly: amount("service-charge"), source: "assumed",
        note: `London average for a leasehold flat, £${round(LONDON_SERVICE_CHARGE_ANNUAL)} a year (${sourceLabel(LONDON_SERVICE_CHARGE)}). Ask for the building's actual charge and ground rent.`,
      });
    }
  } else {
    lines.push({
      id: "rent", label: "Rent", monthly: amount("monthly-rent"),
      source: amount("monthly-rent") === null ? "unknown" : "estimated",
      note: input.monthlyRent === null
        ? "No published average rent for this size here (studios and the City of London have none)."
        : "The borough's average rent for this many bedrooms (ONS Price Index of Private Rents), the same across the borough; new lets usually ask more.",
    });
  }
  lines.push(councilTaxLine(input, amount("council-tax")));
  lines.push(travelLine(input));

  const known = lines.filter((line) => line.monthly !== null);
  const upfront = buying ? buyUpfront(input, deposit) : rentUpfront(input);
  return {
    lines,
    monthlyTotal: known.reduce((sum, line) => sum + (line.monthly ?? 0), 0),
    complete: known.length === lines.length,
    upfront,
    upfrontTotal: upfront.reduce((sum, line) => sum + line.amount, 0),
    referencing: !buying && input.monthlyRent !== null
      ? { incomeNeeded: input.monthlyRent * REFERENCING_MULTIPLE, guarantorIncomeNeeded: input.monthlyRent * GUARANTOR_MULTIPLE }
      : null,
    notIncluded: buying
      ? ["energy and water", "broadband", "insurance", ...(flat ? ["ground rent"] : []), "repairs and maintenance"]
      : ["energy and water", "broadband", "contents insurance"],
  };
}

function councilTaxLine(input: MonthlyCostInput, monthly: number | null): MonthlyCostLine {
  const tax = input.councilTax;
  if (!tax || monthly === null) {
    return { id: "council-tax", label: "Council tax", monthly: null, source: "unknown", note: "The borough's council tax is not available." };
  }
  return {
    id: "council-tax", label: `Council tax (band ${tax.band})`, monthly, source: tax.picked ? "official" : "assumed",
    note: tax.picked
      ? `The borough's average band ${tax.band} charge for ${tax.financialYear}, over 12 months (most councils bill over 10).`
      : `Band ${tax.band} is typical for ${input.bedrooms <= 1 ? "1 bedroom" : `${input.bedrooms} bedrooms`}, not this home's band: pick the band from the listing. ` +
        `Charge is the borough's average for ${tax.financialYear}.`,
  };
}

function travelLine(input: MonthlyCostInput): MonthlyCostLine {
  if (!input.travelsByTransit) {
    return { id: "travel", label: "Travel", monthly: 0, source: "assumed", note: "None of your places is reached by public transport, so no fares are counted." };
  }
  const reach = zoneReach(input.zone);
  const monthly = reach === null ? null : monthlyTravelcard(reach);
  if (monthly === null) {
    return { id: "travel", label: "Travel", monthly: null, source: "unknown", note: "No TfL fare zone for the nearest station." };
  }
  return {
    id: "travel", label: `Travel (Zones 1–${reach})`, monthly, source: "estimated",
    note: `Monthly Travelcard for Zones 1–${reach} (${sourceLabel(TRAVELCARD_7DAY)}), from the nearest station's zone ${input.zone}; ` +
      "assumes one person travelling into Zone 1 most weekdays. Pay-as-you-go caps can cost less.",
  };
}

function buyUpfront(input: MonthlyCostInput, deposit: number | null): UpfrontLine[] {
  if (input.price === null || deposit === null) return [];
  const duty = calculateStampDuty({ price: input.price, firstTimeBuyer: input.firstTimeBuyer, additionalProperty: false, nonUkResident: false });
  return [
    { id: "deposit", label: `Deposit (${DEPOSIT_SHARE * 100}%)`, amount: deposit, source: "assumed", note: "Matches the 75% loan-to-value rate above." },
    {
      id: "stamp-duty", label: "Stamp duty", amount: duty.total, source: "estimated",
      note: `${duty.regime === "first-time-buyer" ? "First-time buyer relief" : "Standard rates"} on the ballpark price (${sourceLabel(SDLT_RATES)}).` +
        (duty.notes.length ? ` ${duty.notes.join(" ")}` : ""),
    },
  ];
}

function rentUpfront(input: MonthlyCostInput): UpfrontLine[] {
  if (input.monthlyRent === null) return [];
  return [
    { id: "first-month", label: "First month's rent", amount: input.monthlyRent, source: "estimated", note: "At most one month in advance (Renters' Rights Act)." },
    { id: "deposit", label: "Deposit (at most)", amount: tenancyDeposit(input.monthlyRent), source: "estimated", note: `Capped at ${input.monthlyRent * 12 >= 50_000 ? "six" : "five"} weeks' rent (Tenant Fees Act).` },
  ];
}

function round(value: number): string {
  return Math.round(value).toLocaleString("en-GB");
}
