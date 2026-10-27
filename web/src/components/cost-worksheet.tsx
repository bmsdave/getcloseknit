"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";

import { civicPath, readCivic } from "@/lib/civic";
import type { GeographyId, PreferenceProfile } from "@/lib/contracts";
import {
  EMPTY_ASSUMPTIONS,
  budgetSentence,
  buildCostWorksheet,
  moneyInputText,
  parseMoneyInput,
  type CostAssumptions,
  type CostLine,
} from "@/lib/housing-cost";
import { typicalBand } from "@/lib/monthly-cost";
import type { DataMode } from "@/lib/map-state";
import { isUnsetProfile } from "@/lib/profile-state";
import { fetchSectionJson } from "@/lib/section-fetch";
import { calculateStampDuty } from "@/lib/stamp-duty";
import { toolHref } from "@/lib/tools";
import { Term } from "./term";

import { HelpTip } from "./help-tip";

interface CouncilTaxPrefill { band: string; annual: number; borough: string; year: string }

/** The area page's geography from its path (/area/lsoa/E01002718 → uk:lsoa:E01002718); null elsewhere. */
function areaFromPath(path: string | null): string | null {
  const match = /^\/area\/([a-z]+)\/([A-Za-z0-9]+)/.exec(path ?? "");
  return match ? `uk:${match[1]}:${match[2]}` : null;
}

/** The borough's charge for a typical band for the household's bedrooms, from the area's civic record. */
function useCouncilTax(bedrooms: number, mode: DataMode): CouncilTaxPrefill | null {
  const geography = areaFromPath(usePathname());
  const [prefill, setPrefill] = useState<CouncilTaxPrefill | null>(null);
  useEffect(() => {
    if (!geography) return;
    let current = true;
    void fetchSectionJson<unknown>(civicPath({ geographyId: geography as GeographyId })).then((payload) => {
      const state = payload ? readCivic(payload, mode) : null;
      const tax = state?.status === "available" ? state.civic.councilTax : null;
      const band = typicalBand(bedrooms);
      const amount = tax?.bands.find((entry) => entry.band === band)?.amount ?? null;
      if (current && tax && amount !== null) {
        setPrefill({ band, annual: amount, borough: tax.boroughName ?? "the borough", year: tax.financialYear });
      }
    });
    return () => { current = false; };
  }, [geography, bedrooms, mode]);
  return prefill;
}

/**
 * Total housing costs. `initial` starts the fields from real figures (the
 * area's typical price, a stated deposit and term, the average fixed rate);
 * `note` says where they came from. Council tax starts from the borough's
 * charge for a typical band. The price is set against the household's saved
 * maximum in one line ("£58k over your £650k max"); cash for the deposit is
 * asked for on its own. Lines still missing a figure are named once under
 * "Still needed", never listed as "Unknown" or £0.
 */
export function CostWorksheet({ profile, mode, initial, note }: {
  profile: PreferenceProfile;
  mode: DataMode;
  initial?: Partial<CostAssumptions>;
  note?: ReactNode;
}) {
  const titleId = useId();
  const [assumptions, setAssumptions] = useState<CostAssumptions>(() => ({ ...EMPTY_ASSUMPTIONS, ...initial }));
  const councilTax = useCouncilTax(profile.bedrooms, mode);
  const [taxFilled, setTaxFilled] = useState(false);
  // Prefill council tax once, and only into an empty field.
  if (councilTax && !taxFilled) {
    setTaxFilled(true);
    if (assumptions.councilTaxMonthly === null) setAssumptions({ ...assumptions, councilTaxMonthly: Math.round(councilTax.annual / 12) });
  }
  const tenure = profile.market;
  const result = buildCostWorksheet(tenure, assumptions);
  // "Your … max" only for a visitor who saved a budget: the example defaults are nobody's.
  const budget = isUnsetProfile(profile) ? null : budgetSentence(profile, tenure, assumptions, result.monthlyTotal);
  const set = (changes: Partial<CostAssumptions>) => setAssumptions({ ...assumptions, ...changes });
  const known = result.lines.filter((line) => line.monthlyAmount !== null || line.oneOffAmount !== null);
  const taxNote = councilTax && (
    <p className="cost-prefill" data-testid="cost-council-tax">
      Council tax: {councilTax.borough}&apos;s band {councilTax.band} charge for {councilTax.year},
      {" "}{moneyInputText(councilTax.annual)} a year, a typical band for {profile.bedrooms} {profile.bedrooms === 1 ? "bedroom" : "bedrooms"}.
      Change it if you know the band.
    </p>
  );
  // A knit card with its result up top (a big monthly figure, then cash upfront), not a raw fieldset.
  return (
    <section className="cost-worksheet" aria-labelledby={titleId} data-testid="cost-worksheet">
      <div className="cost-worksheet__head">
        {/* The page's one "Not advice" line is under the title; the (?) explains the worksheet. */}
        <h2 id={titleId}>Total housing costs <HelpTip id="cost-comparison" label="this worksheet" /></h2>
      </div>
      {note}
      <div className="cost-result" aria-live="polite" data-testid="cost-result">
        <p className="cost-result__tile cost-result__tile--lead">
          <span className="cost-result__label">A month</span>
          <strong data-testid="cost-monthly-total" data-empty={known.length > 0 ? undefined : ""}>
            {known.length > 0 ? gdp(result.monthlyTotal) : "Add a figure to start"}
          </strong>
        </p>
        {tenure === "buy" && <CashNeeded assumptions={assumptions} />}
      </div>
      {budget && (
        <p className="cost-budget" data-over={budget.over ? "" : undefined} data-testid="cost-budget">{budget.text}</p>
      )}
      {tenure === "buy"
        ? <BuyFields assumptions={assumptions} set={set} note={taxNote} />
        : <RentFields assumptions={assumptions} set={set} note={taxNote} />}
      {known.length > 0 && <CostLines lines={known} />}
      <MissingFacts missing={result.missing} unknowns={result.unknowns} />
      <CostTerms tenure={tenure} />
      {result.statutory && (
        <p className="cost-statutory">
          <span className="provenance-tag">Official</span> {statutoryLabel(result.statutory)}:{" "}
          {result.statutory.detail}.
        </p>
      )}
    </section>
  );
}

/** Cash a buyer needs on the day: the deposit, stamp duty at standard rates and moving costs. */
function CashNeeded({ assumptions }: { assumptions: CostAssumptions }) {
  const { price, deposit, movingCosts } = assumptions;
  if (price === null || deposit === null) return null;
  const duty = calculateStampDuty({ price, firstTimeBuyer: false, additionalProperty: false, nonUkResident: false }).total;
  const total = deposit + duty + (movingCosts ?? 0);
  return (
    <p className="cost-result__tile cost-cash" data-testid="cost-cash-needed">
      <span className="cost-result__label">Upfront</span>
      <strong>{gdp(total)}</strong>
      <span className="cost-result__detail">
        deposit {gdp(deposit)} + stamp duty {gdp(duty)} (<Link href={toolHref("stamp-duty", { price })}>first-time buyers pay less</Link>)
        {movingCosts !== null ? <> + moving {gdp(movingCosts)}</> : null}
      </span>
    </p>
  );
}

function CostTerms({ tenure }: { tenure: PreferenceProfile["market"] }) {
  return (
    <p className="term-row">
      Terms used here:{" "}
      {tenure === "buy" && <><Term id="sdlt" /> <Term id="service-charge" /> <Term id="ground-rent" /> </>}
      <Term id="council-tax-bands" />
    </p>
  );
}

function BuyFields({ assumptions, set, note }: FieldProps) {
  return (
    <>
      <div className="cost-fields">
        <MoneyField label="Price" value={assumptions.price} onChange={(price) => set({ price })} />
        <MoneyField label="Your cash for the deposit" value={assumptions.deposit} onChange={(deposit) => set({ deposit })} />
        <NumberField label="Interest rate (%/year)" value={assumptions.annualInterestRatePct} onChange={(annualInterestRatePct) => set({ annualInterestRatePct })} />
        <NumberField label="Term (years)" value={assumptions.termYears} onChange={(termYears) => set({ termYears })} />
        <MoneyField label="Council tax (£/month)" value={assumptions.councilTaxMonthly} onChange={(councilTaxMonthly) => set({ councilTaxMonthly })} />
      </div>
      {note}
      <details className="cost-more" data-testid="cost-more">
        <summary>More costs</summary>
        <div className="cost-fields">
          <MoneyField label="Service charge (£/month)" value={assumptions.serviceChargeMonthly} onChange={(serviceChargeMonthly) => set({ serviceChargeMonthly })} />
          <MoneyField label="Ground rent (£/year)" value={assumptions.groundRentAnnual} onChange={(groundRentAnnual) => set({ groundRentAnnual })} />
          <MoneyField label="Maintenance (£/month)" value={assumptions.maintenanceMonthly} onChange={(maintenanceMonthly) => set({ maintenanceMonthly })} />
          <MoneyField label="Utilities (£/month)" value={assumptions.utilitiesMonthly} onChange={(utilitiesMonthly) => set({ utilitiesMonthly })} />
          <MoneyField label="Moving costs (£ one-off)" value={assumptions.movingCosts} onChange={(movingCosts) => set({ movingCosts })} />
        </div>
      </details>
    </>
  );
}

function RentFields({ assumptions, set, note }: FieldProps) {
  return (
    <>
      <div className="cost-fields">
        <MoneyField label="Monthly rent (£/month)" value={assumptions.monthlyRent} onChange={(monthlyRent) => set({ monthlyRent })} />
        <MoneyField label="Council tax (£/month)" value={assumptions.councilTaxMonthly} onChange={(councilTaxMonthly) => set({ councilTaxMonthly })} />
      </div>
      {note}
      <details className="cost-more" data-testid="cost-more">
        <summary>More costs</summary>
        <div className="cost-fields">
          <MoneyField label="Maintenance (£/month)" value={assumptions.maintenanceMonthly} onChange={(maintenanceMonthly) => set({ maintenanceMonthly })} />
          <MoneyField label="Utilities (£/month)" value={assumptions.utilitiesMonthly} onChange={(utilitiesMonthly) => set({ utilitiesMonthly })} />
          <MoneyField label="Moving costs (£ one-off)" value={assumptions.movingCosts} onChange={(movingCosts) => set({ movingCosts })} />
          <MoneyField label="Rental upfront (£ one-off)" value={assumptions.rentalUpfront} onChange={(rentalUpfront) => set({ rentalUpfront })} />
        </div>
      </details>
    </>
  );
}

/** Money reads "£708,000"; while editing it is plain digits so typing never jumps. */
function MoneyField({ label, value, onChange }: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label>{label}
      <input
        className="knit-field"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft ?? moneyInputText(value)}
        onFocus={() => setDraft(value === null ? "" : String(value))}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(parseMoneyInput(event.target.value));
        }}
      />
    </label>
  );
}

function NumberField({ label, value, onChange }: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label>{label}
      <input
        className="knit-field"
        type="number"
        min="0"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </label>
  );
}

function CostLines({ lines }: { lines: CostLine[] }) {
  return (
    <ul className="cost-lines">
      {lines.map((line) => (
        <li key={line.id}>
          <span>{line.label}</span>{" "}
          <span>{formatLine(line)}</span>{" "}
          <span className="provenance-tag">{provenanceLabel(line.provenance)}</span>
        </li>
      ))}
    </ul>
  );
}

function MissingFacts({ missing, unknowns }: { missing: string[]; unknowns: string[] }) {
  if (missing.length === 0 && unknowns.length === 0) return null;
  return (
    <div className="cost-unknowns">
      {missing.length > 0 && <p>Still needed: {missing.join(", ")}.</p>}
      {unknowns.length > 0 && (
        <p>Unknown, not zero — any of these could reverse the comparison: {unknowns.join(", ")}.</p>
      )}
    </div>
  );
}

function formatLine(line: CostLine): string {
  if (line.monthlyAmount !== null) return `${gdp(line.monthlyAmount)}/month`;
  if (line.oneOffAmount !== null) return `${gdp(line.oneOffAmount)} one-off`;
  return "Unknown";
}

function provenanceLabel(provenance: CostLine["provenance"]): string {
  if (provenance === "official") return "Official";
  if (provenance === "entered") return "Entered";
  if (provenance === "estimated") return "Estimated";
  return "Unknown";
}

/** Plain names for the rule ids in housing-cost.ts. */
const INSTRUMENT_NAMES: Record<string, string> = {
  "sdlt-residential-nil-rate": "Stamp Duty Land Tax",
  "sdlt-non-resident-surcharge": "Stamp Duty non-resident surcharge",
  "sdlt-additional-dwelling-surcharge": "Stamp Duty surcharge on an additional home",
  "tenant-fees-act": "Tenant Fees Act",
  "renters-rights-act": "Renters' Rights Act",
};

/** "Stamp Duty Land Tax in England from 1 April 2025", never the internal rule id. */
function statutoryLabel({ instrument, jurisdiction, effectiveDate }: { instrument: string; jurisdiction: string; effectiveDate: string }): string {
  const name = INSTRUMENT_NAMES[instrument] ?? instrument.replace(/-/g, " ");
  const place = jurisdiction.charAt(0).toUpperCase() + jurisdiction.slice(1);
  const date = new Date(`${effectiveDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `${name} in ${place} from ${date}`;
}

function gdp(value: number): string {
  const pounds = `£${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
  return value < 0 ? `−${pounds}` : pounds;
}

interface FieldProps {
  assumptions: CostAssumptions;
  set: (changes: Partial<CostAssumptions>) => void;
  /** Said under the main fields, above "More costs" (the council tax source). */
  note?: ReactNode;
}
