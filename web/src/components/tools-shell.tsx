import Link from "next/link";
import type { ReactNode } from "react";

import { HelpTip } from "@/components/help-tip";
import { KnitOrnament } from "@/components/knit/ornament";
import { MoneyInput } from "@/components/money-input";
import { SiteHeader } from "@/components/site-header";
import type { HelpId } from "@/lib/help-texts";
import { findBudgetHref } from "@/lib/profile-state";
import { sourceLabel } from "@/lib/sourced";
import { EXAMPLE_PRICE_SOURCED, NOT_ADVICE, RATES_NOT_OFFERS, checkHomeHref, soldWords, toolHref, type ToolSlug } from "@/lib/tools";
import { ToolTabs } from "./tool-tabs";

/** The (?) behind each tool's notice line: the full notice and the tool's guide article. */
const TOOL_HELP: Record<ToolSlug, HelpId> = {
  "stamp-duty": "tool-stamp-duty", "mortgage-rates": "tool-mortgage-rates", investor: "tool-buy-to-let", "check-a-home": "tool-check-a-home",
};

/**
 * Frame for every /tools page: one container width on all of them, so the header,
 * search and tabs never move; "Tools" (to /tools) and the four tabs on one row; the title; and
 * the notice as one muted line whose (?) holds it in full.
 */
export function ToolsShell({ current, title, rates = false, children }: {
  current: ToolSlug | null;
  title: string;
  /** The rates tracker shows averages, not anyone's numbers: its own notice. */
  rates?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="methodology tools-page" data-testid="tools-page">
      <SiteHeader />
      <ToolTabs current={current} />
      <h1>{title}</h1>
      <p className="tools-advice" role="note" data-testid="not-advice">
        {rates ? "Averages, not offers, not financial advice" : "A guide, not financial advice"}
        <HelpTip id={TOOL_HELP[current ?? "stamp-duty"]} label="this notice" text={rates ? RATES_NOT_OFFERS : NOT_ADVICE} />
      </p>
      {current === null && <KnitOrnament kind="town" className="tools-ornament" />}
      {children}
    </main>
  );
}

/** Shows where a prefilled price came from, e.g. "Price from 12 Example Road". */
export function PrefillNote({ price, from, sold = null }: { price: number | null; from: string | null; sold?: string | null }) {
  if (price === null) {
    return (
      <p className="tools-prefill" data-testid="tools-example">
        Example numbers to start with: the {pounds(EXAMPLE_PRICE_SOURCED.value)} price is an {sourceLabel(EXAMPLE_PRICE_SOURCED)}. Change any of them.
      </p>
    );
  }
  return (
    <p className="tools-prefill" data-testid="tools-prefill">
      Price filled in{from ? <> from <strong>{from}</strong></> : null}{sold ? <>, its last sale in {soldWords(sold)}</> : null}.
      {" "}Change it to try other numbers.
    </p>
  );
}

/**
 * Where a tool's answer leads, with the same price: "Next with £500k": Buy-to-let with it
 * (from stamp duty), the areas it buys in (My match with that budget), and a home checked at it.
 */
export function ToolHandoff({ price, from, current }: { price: number | null; from: string | null; current?: ToolSlug }) {
  const short = price === null ? null : shortPounds(price);
  return (
    <nav className="tools-handoff" aria-label="Next">
      {short && <p className="tools-handoff__lead" data-testid="tool-next-lead">Next with {short}</p>}
      {current === "stamp-duty" && price !== null && (
        <Link className="property-button" href={toolHref("investor", { price, from: from ?? "stamp duty" })} data-testid="tool-buy-to-let">
          Buy-to-let with {short} <span aria-hidden="true">→</span>
        </Link>
      )}
      <Link className="property-button" href={findBudgetHref(price)} data-testid="tool-find-areas">
        {price === null ? "Find areas" : "Areas this buys in"} <span aria-hidden="true">→</span>
      </Link>
      <Link className="property-button" href={checkHomeHref({ price, from })} data-testid="tool-check-home">Check a home</Link>
    </nav>
  );
}

/** "£500k", "£1.25m": the price in the handoff's words. */
export function shortPounds(price: number): string {
  if (price >= 1_000_000) return `£${+(price / 1_000_000).toFixed(2)}m`;
  if (price >= 1_000) return `£${+(price / 1_000).toFixed(price % 1000 === 0 ? 0 : 1)}k`;
  return `£${price.toLocaleString("en-GB")}`;
}

/** A number field with its unit sewn in: "£" before the number, "%" or "years" after it. */
export function ToolNumberField({ label, value, onChange, prefix, suffix, step, testId }: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  prefix?: string;
  suffix?: string;
  step?: string;
  testId?: string;
}) {
  return (
    <label className="tools-field">
      <span>{label}</span>
      <span className="tools-field__input">
        {prefix && <span className="tools-field__adorn" aria-hidden="true">{prefix}</span>}
        {prefix === "£" ? (
          // Pounds: a text field with thousands commas, never type=number.
          <MoneyInput value={value} onValue={onChange} data-testid={testId} />
        ) : (
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step={step ?? "any"}
            value={value ?? ""}
            data-testid={testId}
            onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
          />
        )}
        {suffix && <span className="tools-field__adorn" aria-hidden="true">{suffix}</span>}
      </span>
    </label>
  );
}

export function ToolCheckbox({ label, checked, onChange, children }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <span className="tools-check">
      <label>
        <input type="checkbox" className="tools-toggle" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
      {children}
    </span>
  );
}

/**
 * Inputs and the result side by side: the result sticks beside the inputs on
 * a wide screen; on a phone it follows them, and `bar` stays pinned to the
 * bottom of the screen so the answer is in view while editing.
 */
export function ToolLayout({ inputs, result, bar }: { inputs: ReactNode; result: ReactNode; bar: ReactNode }) {
  return (
    <div className="tools-layout">
      <div className="tools-layout__inputs">{inputs}</div>
      <div className="tools-layout__result">{result}</div>
      <div className="tools-bar" aria-hidden="true" data-testid="tools-bar">{bar}</div>
    </div>
  );
}

export function pounds(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency: "GBP", minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value);
}

export function percent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}
