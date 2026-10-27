"use client";

import { useState } from "react";

import type { PreferenceProfile } from "@/lib/contracts";
import {
  GUARANTOR_INCOME_MULTIPLE,
  REFERENCING_DISCLAIMER,
  REFERENCING_RULE,
  RENTERS_RIGHTS_EXPLAINER,
  RENTERS_RIGHTS_SOURCE_URL,
  TENANT_INCOME_MULTIPLE,
  assessReferencing,
  defaultMonthlyRent,
  type ReferencingInput,
} from "@/lib/referencing";
import { sourceLabel } from "@/lib/sourced";

import { BarList } from "./charts";
import { MoneyInput } from "./money-input";

export function ReferencingCheck({ profile }: { profile: PreferenceProfile }) {
  const [input, setInput] = useState<ReferencingInput>(() => ({
    monthlyRent: defaultMonthlyRent(profile),
    incomes: [null, null],
    guarantorIncome: null,
    noUkCreditHistory: false,
  }));
  const result = assessReferencing(input);
  const set = (changes: Partial<ReferencingInput>) => setInput({ ...input, ...changes });
  const setIncome = (index: number, value: number | null) =>
    set({ incomes: input.incomes.map((income, position) => (position === index ? value : income)) });
  return (
    <fieldset className="referencing-check" data-testid="referencing-check">
      <legend>Will you pass referencing?</legend>
      <details className="cost-disclaimer">
        <summary>A self-check, not a referencing decision</summary>
        <p>{REFERENCING_DISCLAIMER}</p>
      </details>
      <NumberField label="Monthly rent (£/month)" value={input.monthlyRent} onChange={(monthlyRent) => set({ monthlyRent })} />
      <NumberField label="Your gross income (£/year)" value={input.incomes[0]} onChange={(value) => setIncome(0, value)} />
      <NumberField label="Co-tenant gross income (£/year)" value={input.incomes[1]} onChange={(value) => setIncome(1, value)} />
      <NumberField label="Guarantor gross income (£/year)" value={input.guarantorIncome} onChange={(guarantorIncome) => set({ guarantorIncome })} />
      <label>
        <input
          type="checkbox"
          checked={input.noUkCreditHistory}
          onChange={(event) => set({ noUkCreditHistory: event.target.checked })}
        />
        No UK credit history yet
      </label>
      {result.requiredIncome === null ? (
        <p>Enter the monthly rent to see the usual income threshold.</p>
      ) : (
        <>
          <p>
            Usual threshold ({TENANT_INCOME_MULTIPLE}× rent){" "}
            <strong data-testid="referencing-required">{gdp(result.requiredIncome)}</strong> a year · household income{" "}
            <strong data-testid="referencing-household">{gdp(result.householdIncome)}</strong>
          </p>
          <BarList
            label="Income a year against the usual referencing threshold"
            rows={[
              { id: "threshold", label: "Usual threshold", value: result.requiredIncome, display: gdp(result.requiredIncome) },
              { id: "household", label: "Household income", value: result.householdIncome, display: gdp(result.householdIncome) },
            ]}
          />
          <p role="status" data-testid="referencing-verdict">
            {result.meetsIncome
              ? "Household income meets the usual threshold."
              : `Household income is ${gdp(result.shortfall ?? 0)} short of the usual threshold.`}
          </p>
          <p>
            A guarantor is usually asked for {GUARANTOR_INCOME_MULTIPLE}× rent:{" "}
            <strong data-testid="referencing-guarantor">{gdp(result.requiredGuarantorIncome ?? 0)}</strong> a year
            {result.guarantorMeets === null ? "." : result.guarantorMeets ? " — your guarantor meets it." : " — your guarantor falls short."}
          </p>
          <p className="metric-description" data-testid="referencing-rule-source">
            {TENANT_INCOME_MULTIPLE}× and {GUARANTOR_INCOME_MULTIPLE}× rent are a {sourceLabel(REFERENCING_RULE)}.
          </p>
        </>
      )}
      {result.notes.length > 0 && (
        <ul data-testid="referencing-notes">
          {result.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
      {result.statutory && (
        <div className="cost-statutory" data-testid="renters-rights">
          <p>
            <span className="provenance-tag">Official</span> {result.statutory.instrument},{" "}
            {result.statutory.jurisdiction}, effective {result.statutory.effectiveDate}:{" "}
            {result.statutory.detail}.
          </p>
          <ul>
            {RENTERS_RIGHTS_EXPLAINER.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p><a href={RENTERS_RIGHTS_SOURCE_URL} target="_blank" rel="noreferrer">Renters&apos; rights in London (GLA)</a></p>
        </div>
      )}
    </fieldset>
  );
}

/** Every field here is pounds: a text field with commas, never type=number. */
function NumberField({ label, value, onChange }: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label>{label}
      <MoneyInput className="knit-field" value={value} onValue={onChange} />
    </label>
  );
}

function gdp(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}
