"use client";

import "@/styles/tools.css";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import { HelpTip } from "@/components/help-tip";
import { SatinBar, StemDivider } from "@/components/knit/satin";
import { PrefillNote, ToolCheckbox, ToolHandoff, ToolLayout, ToolNumberField, percent, pounds } from "@/components/tools-shell";
import { RENT_BEDROOM_LABELS, type AreaRentsResponse, type RentBedrooms } from "@/lib/area-rents";
import {
  BRRR_EXAMPLE, BUY_TO_LET_EXAMPLE, FLIP_EXAMPLE, HMO_EXAMPLE,
  brrr, buyToLet, exampleBrrr, exampleBuyToLet, exampleFlip, exampleHmo, flip, hmo,
  type BrrrInputs, type BrrrResult, type BuyToLetInputs, type BuyToLetResult, type FlipInputs, type FlipResult,
  type HmoInputs,
} from "@/lib/investor";
import { formatMonth } from "@/lib/market";
import type { LatestRateHint } from "@/lib/rate-hint";
import { sourceLabel } from "@/lib/sourced";
import { EXAMPLE_PRICE, carryPrice } from "@/lib/tools";

export type { LatestRateHint };

const EXAMPLE = BUY_TO_LET_EXAMPLE.value;
const HMO = HMO_EXAMPLE.value;
const BRRR = BRRR_EXAMPLE.value;
const FLIP = FLIP_EXAMPLE.value;

type Tab = "btl" | "hmo" | "brrr" | "flip";

const TABS: { id: Tab; label: string }[] = [
  { id: "btl", label: "Buy-to-let" },
  { id: "hmo", label: "HMO" },
  { id: "brrr", label: "BRRR" },
  { id: "flip", label: "Flip" },
];

/** The bedroom counts a borough rent is published for (the "all homes" average is not a choice). */
const BEDROOMS: { key: Exclude<RentBedrooms, "all">; label: string }[] = [
  { key: "oneBedroom", label: "1" },
  { key: "twoBedrooms", label: "2" },
  { key: "threeBedrooms", label: "3" },
  { key: "fourOrMoreBedrooms", label: "4+" },
];

const pound = { prefix: "£" };

/**
 * The investor calculator: buy-to-let, HMO, refinance (BRRR) and flip, one tab each. Everything stays in
 * this component's state (no storage, no request); on the tools page the price is carried in the address.
 * `rents` is the borough's average rent by bedroom count (area-rents.v1): the rent starts there and stays
 * editable. `embedded` is the home page's folded Tools block: results below the inputs, no pinned bar, no
 * hand-off buttons, address untouched.
 */
export function InvestorCalculator({ initialPrice, from, rateHint, rents = null, embedded = false }: {
  initialPrice: number | null;
  from: string | null;
  rateHint: LatestRateHint | null;
  rents?: AreaRentsResponse | null;
  embedded?: boolean;
}) {
  const boroughRents = rents?.available ? rents : null;
  const price = initialPrice ?? EXAMPLE_PRICE;
  const fixed5 = rateHint?.fixed5 ?? null;
  const [tab, setTab] = useState<Tab>("btl");
  const [bedrooms, setBedrooms] = useState<Exclude<RentBedrooms, "all">>("twoBedrooms");
  const [letIn, setLetIn] = useState<BuyToLetInputs>(() => withRent(exampleBuyToLet(price, fixed5), rentFor(boroughRents, "twoBedrooms")));
  const [hmoIn, setHmoIn] = useState<HmoInputs>(() => exampleHmo(price, fixed5, rentFor(boroughRents, "oneBedroom")));
  const [brrrIn, setBrrrIn] = useState<BrrrInputs>(() => exampleBrrr(price, fixed5, rentFor(boroughRents, "twoBedrooms")));
  const [flipIn, setFlipIn] = useState<FlipInputs>(() => exampleFlip(price));
  // The price rides in the address, so the tabs and the next tool start from it (one price
  // for all four tabs; the home page's embedded block leaves the address alone).
  useEffect(() => { if (!embedded) carryPrice(letIn.price); }, [embedded, letIn.price]);

  // One price for all four tabs: changing it on one changes it on the rest.
  const syncPrice = (changes: { price?: number | null }, except: Tab) => {
    if (!("price" in changes)) return;
    const next = changes.price ?? null;
    if (except !== "btl") setLetIn((value) => ({ ...value, price: next }));
    if (except !== "hmo") setHmoIn((value) => ({ ...value, price: next }));
    if (except !== "brrr") setBrrrIn((value) => ({ ...value, price: next }));
    if (except !== "flip") setFlipIn((value) => ({ ...value, price: next }));
  };
  const updateLet = (changes: Partial<BuyToLetInputs>) => { setLetIn((value) => ({ ...value, ...changes })); syncPrice(changes, "btl"); };
  const updateHmo = (changes: Partial<HmoInputs>) => { setHmoIn((value) => ({ ...value, ...changes })); syncPrice(changes, "hmo"); };
  const updateBrrr = (changes: Partial<BrrrInputs>) => { setBrrrIn((value) => ({ ...value, ...changes })); syncPrice(changes, "brrr"); };
  const updateFlip = (changes: Partial<FlipInputs>) => { setFlipIn((value) => ({ ...value, ...changes })); syncPrice(changes, "flip"); };

  const chooseBedrooms = (key: Exclude<RentBedrooms, "all">) => {
    setBedrooms(key);
    const rent = rentFor(boroughRents, key);
    if (rent === null) return;
    setLetIn((value) => ({ ...value, monthlyRent: rent }));
    setBrrrIn((value) => ({ ...value, monthlyRent: rent }));
  };

  const selectOnArrow = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(TABS.findIndex((entry) => entry.id === tab) + step + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`investor-tab-${next.id}`)?.focus();
  };

  const body = (() => {
    const shared = { embedded, initialPrice, from, rateHint };
    if (tab === "hmo") return <HmoPanel values={hmoIn} update={updateHmo} {...shared} />;
    if (tab === "brrr") return <BrrrPanel values={brrrIn} update={updateBrrr} {...shared} />;
    if (tab === "flip") return <FlipPanel values={flipIn} update={updateFlip} {...shared} />;
    return <LetPanel values={letIn} update={updateLet} {...shared} />;
  })();

  return (
    <div className="investor" data-testid="investor-calculator">
      <div className="tools-tabs" role="tablist" aria-label="Kind of investment">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" id={`investor-tab-${entry.id}`} data-testid={`investor-tab-${entry.id}`}
            aria-selected={tab === entry.id} aria-controls="investor-panel" tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => setTab(entry.id)} onKeyDown={selectOnArrow}>
            {entry.label}
          </button>
        ))}
      </div>
      {boroughRents && (tab === "btl" || tab === "brrr") && (
        <>
          <fieldset className="tools-radios" data-testid="investor-bedrooms">
            <legend>Bedrooms</legend>
            {BEDROOMS.map((entry) => (
              <label key={entry.key}>
                <input type="radio" name="investor-bedrooms" checked={bedrooms === entry.key} onChange={() => chooseBedrooms(entry.key)} /> {entry.label}
              </label>
            ))}
          </fieldset>
          <RentSource rents={boroughRents} bedrooms={bedrooms} />
        </>
      )}
      {boroughRents && tab === "hmo" && <RentSource rents={boroughRents} bedrooms="oneBedroom" room />}
      <div role="tabpanel" id="investor-panel" aria-labelledby={`investor-tab-${tab}`}>{body}</div>
      {embedded && (
        <p className="tools-subtle" data-testid="investor-note">
          A guide, not financial advice. We don&apos;t keep these figures: they are not saved or sent anywhere, and they clear when you reload.
        </p>
      )}
    </div>
  );
}

function rentFor(rents: AreaRentsResponse | null, bedrooms: RentBedrooms): number | null {
  return rents?.rents.find((rent) => rent.bedrooms === bedrooms)?.monthlyRent ?? null;
}

function withRent(inputs: BuyToLetInputs, rent: number | null): BuyToLetInputs {
  return rent === null ? inputs : { ...inputs, monthlyRent: rent };
}

/** Where the starting rent came from, so it is never mistaken for this home's rent. */
function RentSource({ rents, bedrooms, room = false }: { rents: AreaRentsResponse; bedrooms: RentBedrooms; room?: boolean }) {
  const rent = rentFor(rents, bedrooms);
  if (rent === null) return null;
  const demo = rents.sourceVersion?.startsWith("preview-");
  return (
    <p className="tools-subtle" data-testid="investor-rent-source">
      {room
        ? `Each room starts at half the ${rents.borough?.name ?? "borough"} average rent for ${RENT_BEDROOM_LABELS[bedrooms]}`
        : `Rent starts at the ${rents.borough?.name ?? "borough"} average for ${RENT_BEDROOM_LABELS[bedrooms]}`}
      {" "}({pounds(rent)} a month; {demo ? "demo numbers" : "ONS"}{rents.period ? `, ${formatMonth(rents.period)}` : ""}), not this home&apos;s rent: change it.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Fields

type NumericKey<T> = { [K in keyof T]: T[K] extends number | null ? K : never }[keyof T];

/** A number field for one input, with a test id of "{prefix}-{key}". */
function fieldFor<T extends object>(prefix: string, values: T, update: (changes: Partial<T>) => void) {
  return function Field(key: NumericKey<T>, label: string, unit: { prefix?: string; suffix?: string } = {}) {
    return (
      <ToolNumberField key={String(key)} label={label} value={values[key] as number | null}
        onChange={(value) => update({ [key]: value } as Partial<T>)} {...unit} testId={`${prefix}-${String(key)}`} />
    );
  };
}

interface PanelProps {
  embedded: boolean;
  initialPrice: number | null;
  from: string | null;
  rateHint: LatestRateHint | null;
}

/** Inputs and results side by side (a pinned bar on a phone) on the tools page; stacked in the home page's block. */
function Layout({ embedded, inputs, result, bar }: { embedded: boolean; inputs: ReactNode; result: ReactNode; bar: ReactNode }) {
  if (embedded) return <div className="tools-stack">{inputs}{result}</div>;
  return <ToolLayout inputs={inputs} result={result} bar={bar} />;
}

function SurchargeChecks({ additionalProperty, nonUkResident, update }: {
  additionalProperty: boolean;
  nonUkResident: boolean;
  update: (changes: { additionalProperty?: boolean; nonUkResident?: boolean }) => void;
}) {
  return (
    <div className="tools-checks">
      <ToolCheckbox label="I will own another home after buying" checked={additionalProperty} onChange={(value) => update({ additionalProperty: value })}>
        <HelpTip id="sdlt-additional-property" />
      </ToolCheckbox>
      <ToolCheckbox label="I am not a UK resident" checked={nonUkResident} onChange={(value) => update({ nonUkResident: value })}>
        <HelpTip id="sdlt-non-resident" />
      </ToolCheckbox>
    </div>
  );
}

function RateNote({ rateHint, prefix, fallback }: { rateHint: LatestRateHint | null; prefix: string; fallback: number }) {
  return rateHint ? (
    <p className="tools-subtle" data-testid={`${prefix}-rate-source`}>
      Average new fixed rates at 75% loan-to-value in {rateHint.month}: {rateHint.fixed2.toFixed(2)}% for 2 years,{" "}
      {rateHint.fixed5.toFixed(2)}% for 5 years ({rateHint.source}; <Link href="/tools/mortgage-rates">tracker</Link>). Investor loans usually cost more.
    </p>
  ) : (
    <p className="tools-subtle" data-testid={`${prefix}-rate-source`}>
      The {fallback}% rate is an {sourceLabel(BUY_TO_LET_EXAMPLE)}: put in your own.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Buy-to-let and HMO share their purchase, mortgage and cost fields.

type LetShared = Omit<BuyToLetInputs, "monthlyRent">;

function LetFields({ prefix, values, update, rateHint, initialPrice, from, rentSection }: Omit<PanelProps, "embedded"> & {
  prefix: "btl" | "hmo";
  values: LetShared;
  update: (changes: Partial<LetShared>) => void;
  rentSection: ReactNode;
}) {
  const field = fieldFor(prefix, values, update);
  return (
    <>
      <section className="methodology-card tools-card" aria-labelledby={`${prefix}-purchase`}>
        <h2 id={`${prefix}-purchase`}>The purchase</h2>
        <PrefillNote price={initialPrice} from={from} />
        <div className="tools-grid">
          {field("price", "Price", pound)}
          {field("deposit", "Deposit", pound)}
          {field("annualInterestRatePct", "Mortgage rate (a year)", { suffix: "%" })}
          {field("termYears", "Term", { suffix: "years" })}
        </div>
        <RateNote rateHint={rateHint} prefix={prefix} fallback={EXAMPLE.fallbackRatePct} />
        <fieldset className="tools-radios">
          <legend>Mortgage type</legend>
          <label><input type="radio" name={`${prefix}-repayment`} checked={values.repayment === "interest-only"} onChange={() => update({ repayment: "interest-only" })} /> Interest only</label>
          <label><input type="radio" name={`${prefix}-repayment`} checked={values.repayment === "repayment"} onChange={() => update({ repayment: "repayment" })} /> Repayment</label>
        </fieldset>
        <SurchargeChecks additionalProperty={values.additionalProperty} nonUkResident={values.nonUkResident} update={update} />
      </section>

      <section className="methodology-card tools-card" aria-labelledby={`${prefix}-rent`}>
        <h2 id={`${prefix}-rent`}>Rent and running costs</h2>
        {rentSection}
        <details className="tools-details" data-testid={`${prefix}-more-costs`}>
          <summary>More costs</summary>
          <div className="tools-grid">
            {field("serviceChargeMonthly", "Service charge (a month)", pound)}
            {field("groundRentAnnual", "Ground rent (a year)", pound)}
            {field("insuranceAnnual", "Landlord insurance (a year)", pound)}
            {field("maintenanceMonthly", "Repairs allowance (a month)", pound)}
            {field("legalAndSurvey", "Legal and survey fees", pound)}
            {field("refurbishment", "Work before letting", pound)}
          </div>
        </details>
      </section>
    </>
  );
}

function LetPanel({ values, update, embedded, ...rest }: PanelProps & { values: BuyToLetInputs; update: (changes: Partial<BuyToLetInputs>) => void }) {
  const result = buyToLet(values);
  const field = fieldFor("btl", values, update);
  const rentSection = (
    <>
      <div className="tools-grid">
        {field("monthlyRent", "Rent (a month)", pound)}
        {field("voidWeeksPerYear", "Empty each year", { suffix: "weeks" })}
        {field("agentFeePct", "Letting agent fee (of rent)", { suffix: "%" })}
      </div>
      <p className="tools-subtle" data-testid="btl-example-source">
        The example rent ({EXAMPLE.grossYieldPct}% of the price a year), {EXAMPLE.voidWeeksPerYear} empty weeks, a {EXAMPLE.agentFeePct}% agent fee,
        {" "}a {EXAMPLE.depositShare * 100}% deposit and a {EXAMPLE.termYears}-year term are an {sourceLabel(BUY_TO_LET_EXAMPLE)}: put in the real ones.
      </p>
    </>
  );
  return (
    <Layout embedded={embedded}
      inputs={<LetFields prefix="btl" values={values} update={update} rentSection={rentSection} {...rest} />}
      result={<LetResults prefix="btl" result={result} price={values.price} from={values.price === rest.initialPrice ? rest.from : null} embedded={embedded} />}
      bar={<LetBar result={result} />} />
  );
}

function HmoPanel({ values, update, embedded, ...rest }: PanelProps & { values: HmoInputs; update: (changes: Partial<HmoInputs>) => void }) {
  const result = hmo(values);
  const field = fieldFor("hmo", values, update);
  const rentSection = (
    <>
      <div className="tools-grid">
        {field("rooms", "Lettable rooms", {})}
        {field("rentPerRoomMonthly", "Rent per room (a month)", pound)}
        {field("billsMonthly", "Bills you pay (a month)", pound)}
        {field("voidWeeksPerYear", "Empty each year", { suffix: "weeks" })}
        {field("agentFeePct", "Management fee (of rent)", { suffix: "%" })}
      </div>
      <p className="tools-subtle" data-testid="hmo-example-source">
        The example {HMO.rooms} rooms, {pounds(HMO.billsMonthly)} of bills, {HMO.voidWeeksPerYear} empty weeks and a {HMO.agentFeePct}% fee are an{" "}
        {sourceLabel(HMO_EXAMPLE)}; a room rent of {pounds(HMO.fallbackRoomRent)} is used when there is no borough rent. An HMO often needs a licence and fire
        safety work: put them under More costs, work before letting.
      </p>
    </>
  );
  return (
    <Layout embedded={embedded}
      inputs={<LetFields prefix="hmo" values={values} update={update} rentSection={rentSection} {...rest} />}
      result={<LetResults prefix="hmo" result={result} price={values.price} from={values.price === rest.initialPrice ? rest.from : null} embedded={embedded} />}
      bar={<LetBar result={result} />} />
  );
}

function LetBar({ result }: { result: BuyToLetResult }) {
  if (result.missing.length > 0) return <span>Still needed: {result.missing.join(", ")}</span>;
  return (
    <>
      <span>Cash flow</span>{" "}
      <strong className={(result.monthlyCashFlow ?? 0) < 0 ? "tools-negative" : undefined}>{money(result.monthlyCashFlow)} a month</strong>{" "}
      <span>net yield {pct(result.netYieldPct)}</span>
    </>
  );
}

function LetResults({ prefix, result, price, from, embedded }: {
  prefix: "btl" | "hmo"; result: BuyToLetResult; price: number | null; from: string | null; embedded: boolean;
}) {
  return (
    <section className="methodology-card tools-card" aria-labelledby={`${prefix}-results`} aria-live="polite">
      <h2 id={`${prefix}-results`}>What it adds up to</h2>
      {result.missing.length > 0 ? (
        <p data-testid={`${prefix}-missing`}>Still needed: {result.missing.join(", ")}.</p>
      ) : (
        <>
          <dl className="tools-stats" data-testid={`${prefix}-results`}>
            <Stat label="Gross yield" help="btl-gross-yield" value={pct(result.grossYieldPct)} testId={`${prefix}-gross-yield`} />
            <Stat label="Net yield" help="btl-net-yield" value={pct(result.netYieldPct)} testId={`${prefix}-net-yield`}
              meter={share(result.netYieldPct, result.grossYieldPct, "of the gross yield kept after costs")} />
            <Stat label="Cash flow a month" help="btl-cash-flow" value={money(result.monthlyCashFlow)} testId={`${prefix}-monthly-cash-flow`} negative={(result.monthlyCashFlow ?? 0) < 0} />
            <Stat label="Cash flow a year" value={money(result.annualCashFlow)} testId={`${prefix}-annual-cash-flow`} negative={(result.annualCashFlow ?? 0) < 0} />
            <Stat label="Cash needed" help="btl-cash-required" value={money(result.cashRequired)} testId={`${prefix}-cash-required`}
              meter={share(result.cashRequired, price, "of the price")} />
            <Stat label="Yearly return on that cash" value={pct(result.cashOnCashPct)} testId={`${prefix}-cash-return`} negative={(result.cashOnCashPct ?? 0) < 0} />
          </dl>
          <Table testId={`${prefix}-breakdown`} caption="How it is worked out (a year, before income tax)" rows={[
            { label: "Rent if never empty", value: result.annualRent },
            { label: "Rent after empty weeks", value: result.annualRentAfterVoids },
            { label: "Running costs", value: negate(result.annualRunningCosts) },
            { label: "Mortgage payments", value: negate(result.monthlyMortgage === null ? null : result.monthlyMortgage * 12) },
            { label: "Cash flow", value: result.annualCashFlow, total: true },
          ]} />
          <p className="tools-subtle">
            Loan {money(result.loan)} ({pct(result.loanToValuePct, 0)} of the price). Cash needed is the deposit, stamp duty of{" "}
            {money(result.stampDuty?.total ?? null)} (<Link href="/tools/stamp-duty">how it is worked out</Link>) and the fees you entered.
          </p>
        </>
      )}
      {result.unknowns.length > 0 && (
        <p className="tools-note" data-testid={`${prefix}-unknowns`}>
          Left blank, so not counted — any of these lowers the return: {result.unknowns.join(", ")}.
        </p>
      )}
      <p className="tools-subtle">
        Figures are before income tax <HelpTip id="btl-tax" />. Rents, rates and costs change; nothing here predicts them.
      </p>
      {!embedded && <ToolHandoff price={price} from={from} current="investor" />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// BRRR

function BrrrPanel({ values, update, embedded, initialPrice, from, rateHint }: PanelProps & {
  values: BrrrInputs; update: (changes: Partial<BrrrInputs>) => void;
}) {
  const result = brrr(values);
  const field = fieldFor("brrr", values, update);
  const inputs = (
    <>
      <section className="methodology-card tools-card" aria-labelledby="brrr-purchase">
        <h2 id="brrr-purchase">Buy and do up</h2>
        <PrefillNote price={initialPrice} from={from} />
        <div className="tools-grid">
          {field("price", "Price", pound)}
          {field("refurb", "Work cost", pound)}
          {field("valueAfter", "Value after the work", pound)}
          {field("legalAndSurvey", "Legal and survey fees", pound)}
        </div>
        <p className="tools-subtle" data-testid="brrr-example-source">
          The example work ({BRRR.refurbShare * 100}% of the price) and value after it ({BRRR.valueAfterMultiple} times the price) are an{" "}
          {sourceLabel(BRRR_EXAMPLE)}. The value after work is a guess until a surveyor values it: put in theirs.
        </p>
        <SurchargeChecks additionalProperty={values.additionalProperty} nonUkResident={values.nonUkResident} update={update} />
      </section>
      <section className="methodology-card tools-card" aria-labelledby="brrr-refinance">
        <h2 id="brrr-refinance">Refinance and let</h2>
        <div className="tools-grid">
          {field("refinanceLtvPct", "New mortgage (of the new value)", { suffix: "%" })}
          {field("annualInterestRatePct", "Mortgage rate (a year)", { suffix: "%" })}
          {field("monthlyRent", "Rent (a month)", pound)}
          {field("runningCostsMonthly", "Running costs (a month)", pound)}
        </div>
        <RateNote rateHint={rateHint} prefix="brrr" fallback={BRRR.fallbackRatePct} />
        <p className="tools-subtle">The new mortgage is worked out interest only. Costs here are agent, repairs and insurance together.</p>
      </section>
    </>
  );
  const result_ = <BrrrResults result={result} embedded={embedded} price={values.price} from={values.price === initialPrice ? from : null} />;
  const bar = result.missing.length > 0 ? <span>Still needed: {result.missing.join(", ")}</span> : (
    <>
      <span>Left in</span> <strong>{money(result.moneyLeftIn)}</strong>{" "}
      <span>cash flow {money(result.cashFlowMonthly)} a month</span>
    </>
  );
  return <Layout embedded={embedded} inputs={inputs} result={result_} bar={bar} />;
}

function BrrrResults({ result, price, from, embedded }: { result: BrrrResult; price: number | null; from: string | null; embedded: boolean }) {
  return (
    <section className="methodology-card tools-card" aria-labelledby="brrr-results" aria-live="polite">
      <h2 id="brrr-results">What it adds up to</h2>
      {result.missing.length > 0 ? (
        <p data-testid="brrr-missing">Still needed: {result.missing.join(", ")}.</p>
      ) : (
        <>
          <dl className="tools-stats" data-testid="brrr-results">
            <Stat label="Money left in" value={money(result.moneyLeftIn)} testId="brrr-money-left-in"
              meter={share(result.moneyLeftIn, result.totalCost, "of what you put in")} />
            <Stat label="Cash flow a month" value={money(result.cashFlowMonthly)} testId="brrr-cash-flow" negative={(result.cashFlowMonthly ?? 0) < 0} />
            <Stat label="Yearly return on money left in" testId="brrr-roi" negative={(result.roiPct ?? 0) < 0}
              value={result.roiPct !== null ? pct(result.roiPct) : (result.annualCashFlow ?? 0) >= 0 ? "No cash left in" : "Unknown"} />
          </dl>
          <Table testId="brrr-breakdown" caption="How it is worked out" rows={[
            { label: "Price", value: price },
            { label: "Stamp duty", value: result.stampDuty?.total ?? null },
            { label: "Work and fees", value: result.totalCost === null || price === null || result.stampDuty === null ? null : result.totalCost - price - result.stampDuty.total },
            { label: "Cash in before the refinance", value: result.totalCost, total: true },
            { label: "New mortgage", value: negate(result.refinanceLoan) },
            { label: "Money left in", value: result.moneyLeftIn, total: true },
          ]} />
          {(result.cashReleased ?? 0) > 0 && (
            <p className="tools-note" data-testid="brrr-released">The refinance pays out {money(result.cashReleased)} more than you put in.</p>
          )}
          <p className="tools-subtle">
            Stamp duty of {money(result.stampDuty?.total ?? null)} (<Link href="/tools/stamp-duty">how it is worked out</Link>). A lender may value the
            home lower than you hope, or lend less against a home just bought; refinance fees and early repayment charges are not counted.
          </p>
        </>
      )}
      {result.unknowns.length > 0 && (
        <p className="tools-note" data-testid="brrr-unknowns">
          Left blank, so not counted — any of these lowers the return: {result.unknowns.join(", ")}.
        </p>
      )}
      <p className="tools-subtle" data-testid="brrr-holding">
        Holding and bridging costs until the refinance (council tax, utilities, insurance, bridging interest) are not counted.
      </p>
      <p className="tools-subtle">Figures are before income tax <HelpTip id="btl-tax" />. Nothing here predicts values, rents or rates.</p>
      {!embedded && <ToolHandoff price={price} from={from} current="investor" />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Flip

function FlipPanel({ values, update, embedded, initialPrice, from }: PanelProps & {
  values: FlipInputs; update: (changes: Partial<FlipInputs>) => void;
}) {
  const result = flip(values);
  const field = fieldFor("flip", values, update);
  const inputs = (
    <>
      <section className="methodology-card tools-card" aria-labelledby="flip-purchase">
        <h2 id="flip-purchase">Buy and do up</h2>
        <PrefillNote price={initialPrice} from={from} />
        <div className="tools-grid">
          {field("price", "Price", pound)}
          {field("refurb", "Work cost", pound)}
          {field("months", "Time to sell", { suffix: "months" })}
          {field("financeRatePct", "Finance rate (a year)", { suffix: "%" })}
          {field("legalAndSurvey", "Legal and survey fees", pound)}
        </div>
        <p className="tools-subtle" data-testid="flip-example-source">
          Finance is charged on the price and the work for the whole time; put 0 if you pay cash. The example work ({FLIP.refurbShare * 100}% of the price),
          {" "}{FLIP.months} months and {FLIP.financeRatePct}% finance are an {sourceLabel(FLIP_EXAMPLE)}.
        </p>
        <SurchargeChecks additionalProperty={values.additionalProperty} nonUkResident={values.nonUkResident} update={update} />
      </section>
      <section className="methodology-card tools-card" aria-labelledby="flip-sale">
        <h2 id="flip-sale">The sale</h2>
        <div className="tools-grid">
          {field("salePrice", "Sale price", pound)}
          {field("sellingCostsPct", "Selling costs (of the sale price)", { suffix: "%" })}
        </div>
        <p className="tools-subtle">
          The example sale price ({FLIP.salePriceMultiple} times the price) and {FLIP.sellingCostsPct}% selling costs are an {sourceLabel(FLIP_EXAMPLE)}:
          a sale price is a guess until a home sells.
        </p>
      </section>
    </>
  );
  const bar = result.missing.length > 0 ? <span>Still needed: {result.missing.join(", ")}</span> : (
    <>
      <span>Profit</span>{" "}
      <strong className={(result.profit ?? 0) < 0 ? "tools-negative" : undefined}>{money(result.profit)}</strong>{" "}
      <span>return {pct(result.roiPct)}</span>
    </>
  );
  return <Layout embedded={embedded} inputs={inputs} result={<FlipResults result={result} values={values} embedded={embedded} from={values.price === initialPrice ? from : null} />} bar={bar} />;
}

function FlipResults({ result, values, from, embedded }: { result: FlipResult; values: FlipInputs; from: string | null; embedded: boolean }) {
  return (
    <section className="methodology-card tools-card" aria-labelledby="flip-results" aria-live="polite">
      <h2 id="flip-results">What it adds up to</h2>
      {result.missing.length > 0 ? (
        <p data-testid="flip-missing">Still needed: {result.missing.join(", ")}.</p>
      ) : (
        <>
          <dl className="tools-stats" data-testid="flip-results">
            <Stat label="Profit" value={money(result.profit)} testId="flip-profit" negative={(result.profit ?? 0) < 0} />
            <Stat label="Return on what you spend" value={pct(result.roiPct)} testId="flip-roi" negative={(result.roiPct ?? 0) < 0} />
            <Stat label="Return scaled to a year" value={pct(result.annualisedRoiPct)} testId="flip-annual-roi" negative={(result.annualisedRoiPct ?? 0) < 0} />
          </dl>
          <Table testId="flip-breakdown" caption="How it is worked out" rows={[
            { label: "Sale price", value: values.salePrice },
            { label: "Selling costs", value: negate(result.sellingCosts) },
            { label: "Price", value: negate(values.price) },
            { label: "Stamp duty", value: negate(result.stampDuty?.total ?? null) },
            { label: "Work", value: negate(values.refurb) },
            { label: "Legal and survey fees", value: negate(values.legalAndSurvey ?? 0) },
            { label: "Finance interest", value: negate(result.financeCost) },
            { label: "Profit", value: result.profit, total: true },
          ]} />
          <p className="tools-subtle">
            Stamp duty of {money(result.stampDuty?.total ?? null)} (<Link href="/tools/stamp-duty">how it is worked out</Link>). The return is the profit over
            everything spent before the sale, and the yearly figure just scales it, without compounding.
          </p>
        </>
      )}
      {result.unknowns.length > 0 && (
        <p className="tools-note" data-testid="flip-unknowns">
          Left blank, so not counted — any of these lowers the profit: {result.unknowns.join(", ")}.
        </p>
      )}
      <p className="tools-subtle" data-testid="flip-holding">
        Holding costs until the sale (council tax, utilities, insurance) and bridging fees are not counted; only the finance interest is.
      </p>
      <p className="tools-subtle">Profit is before capital gains or income tax <HelpTip id="btl-tax" />. Sale prices and timing are not guaranteed.</p>
      {!embedded && <ToolHandoff price={values.price} from={from} current="investor" />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared result pieces

interface Meter { value: number; caption: string }

/** A result tile: the big number, and a satin meter with its share in words where a share means something. */
function Stat({ label, value, help, testId, negative, meter }: {
  label: string;
  value: string;
  help?: "btl-gross-yield" | "btl-net-yield" | "btl-cash-flow" | "btl-cash-required";
  testId: string;
  negative?: boolean;
  meter?: Meter | null;
}) {
  return (
    <div>
      <dt>{label}{help && <HelpTip id={help} />}</dt>
      <dd>
        <strong data-testid={testId} className={negative ? "tools-negative" : undefined}>{value}</strong>
        {meter && (
          <>
            <SatinBar value={meter.value} colour="var(--chart-1)" width={120} height={12} className="tools-meter" />
            <span>{Math.round(meter.value * 100)}% {meter.caption}</span>
          </>
        )}
      </dd>
    </div>
  );
}

/** part ÷ whole as a 0–1 meter, or nothing when either is unknown or the share is not a share. */
function share(part: number | null, whole: number | null, caption: string): Meter | null {
  if (part === null || whole === null || whole <= 0 || part < 0) return null;
  return { value: Math.min(1, part / whole), caption };
}

function Table({ testId, caption, rows }: { testId: string; caption: string; rows: { label: string; value: number | null; total?: boolean }[] }) {
  return (
    <div className="tools-table-wrap">
      <StemDivider className="stem-divider table-stem" />
      <table className="tools-table" data-testid={testId}>
        <caption>{caption}</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.total ? "tools-table__total" : undefined}>
              <th scope="row">{row.label}</th>
              <td>{money(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function money(value: number | null): string {
  return value === null ? "Unknown" : pounds(value);
}

function pct(value: number | null, decimals = 2): string {
  return value === null ? "Unknown" : percent(value, decimals);
}

function negate(value: number | null): number | null {
  return value === null ? null : -value;
}
