"use client";

import { useState } from "react";

import { isCodeName } from "@/lib/area-labels";
import { budgetFit, typeOrder, type BudgetFit, type PageTailor } from "@/lib/area-tailor";
import { formatMonth, formatPoundsShort, type AreaMarketResponse, type MarketTypeStats, type PropertyTypeCode } from "@/lib/market";
import { formatMoney } from "@/lib/money-format";

import { SatinSpan } from "./ramp-knit";
import { TrendChart } from "./market-section";

/** Under this many sales a type reads "few sales" (its band still shows, lighter). */
const FEW_SALES = 10;
const TYPE_LABEL: Record<PropertyTypeCode, string> = { F: "Flat", T: "Terraced", S: "Semi", D: "Detached", O: "Other" };
const FIT_WORDS: Record<BudgetFit, string> = { all: "✓ all", most: "✓ most", some: "some", few: "few", none: "none" };

/**
 * Prices by type of home: all four types always (median, sales, the middle half as a band
 * on one shared scale), the household's types first and marked; then one ten-year line: All homes by
 * default, the household's types when chosen. Every type is a button that puts its own line on the
 * chart (again: back to the default). Two-up in a narrow panel, four-up where there is room
 * (a container query, styles/area-v3.css). Area figures only, never a price for one home.
 */
export function PriceTypes({ market, tailor }: { market: AreaMarketResponse; tailor: PageTailor }) {
  const stats = new Map(market.byType.map((entry) => [entry.propertyType, entry]));
  const order = typeOrder(tailor).filter((code) => code !== "O");
  const banded = order.map((code) => stats.get(code)).filter((entry): entry is MarketTypeStats => !!entry && entry.p25 !== null && entry.p75 !== null);
  const budget = tailor.budget;
  const low = Math.min(...banded.map((entry) => entry.p25!), budget ?? Infinity) * 0.9;
  const high = Math.max(...banded.map((entry) => entry.p75!), budget ?? 0) * 1.05;
  const at = (value: number) => (high > low ? (value - low) / (high - low) : 0.5);
  const [picked, setPicked] = useState<PropertyTypeCode | null>(null);
  const keys = picked ? [picked] : tailor.types.length ? tailor.types : (["all"] as const);
  const lead = [
    tailor.types.length ? "Your types first" : null,
    market.basis?.widened ? `sales in the wider ${isCodeName(market.basis.name) ? "" : `${market.basis.name} `}area` : "sales in this neighbourhood",
    market.window ? `12 months to ${formatMonth(market.window.end)}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="price-types" data-testid="price-types" data-tailored={tailor.types.length ? "" : undefined}>
      {lead && <p className="price-types__lead">{lead.charAt(0).toUpperCase() + lead.slice(1)}</p>}
      <ul className="price-types__list" aria-label="Typical sale by type of home">
        {order.map((code) => {
          const entry = stats.get(code);
          const mine = tailor.types.includes(code);
          const few = !entry || entry.sales < FEW_SALES;
          return (
            <li key={code} className="price-type" data-testid={`price-type-${code}`} data-mine={mine ? "" : undefined} data-few={few ? "" : undefined}>
              <button type="button" className="price-type__button" aria-pressed={picked === code}
                title={picked === code ? "Back to all homes" : `${TYPE_LABEL[code]} on the chart`}
                onClick={() => setPicked((current) => (current === code ? null : code))}>
              <span className="price-type__label">{mine && <span aria-label="Your type">▸ </span>}{TYPE_LABEL[code]}</span>
              <strong className="price-type__median">{entry?.medianPrice != null ? formatPoundsShort(entry.medianPrice) : "—"}</strong>
              <span className="price-type__sales">
                {entry ? `${entry.sales.toLocaleString("en-GB")} sale${entry.sales === 1 ? "" : "s"}` : "No sales"}
                {entry && few && entry.sales > 0 && " · few sales"}
              </span>
              {entry?.p25 != null && entry.p75 != null && (
                <span className="price-type__band">
                  <span className="price-type__track">
                    <SatinSpan from={at(entry.p25)} to={at(entry.p75)} colour={`var(--market-${code})`} width={200} height={12} className="price-type__satin" />
                    {budget !== null && <span className="price-type__budget" style={{ left: `${(at(budget) * 100).toFixed(1)}%` }} title={`Budget ${formatMoney(budget)}`} />}
                  </span>
                  <span className="price-type__range">Middle half {formatPoundsShort(entry.p25)}–{formatPoundsShort(entry.p75)}</span>
                </span>
              )}
              </button>
            </li>
          );
        })}
      </ul>
      {budget !== null && <p className="price-types__key"><span className="price-types__budget-key" aria-hidden="true" />Your budget {formatMoney(budget)}</p>}
      <TrendChart market={market} measure="price" keys={keys} />
    </div>
  );
}

/** "≤ £1.2m buys": Terraced all · Semi most · Detached some, for the household's types (or every type sold). */
export function budgetFitRow(market: AreaMarketResponse, tailor: PageTailor): { term: string; value: string } | null {
  if (tailor.budget === null) return null;
  const codes = (tailor.types.length ? tailor.types : typeOrder(tailor)).filter((code) => code !== "O");
  const parts = codes.flatMap((code) => {
    const entry = market.byType.find((stats) => stats.propertyType === code);
    const fit = entry ? budgetFit(entry, tailor.budget!) : null;
    return fit ? [`${TYPE_LABEL[code]} ${FIT_WORDS[fit]}`] : [];
  });
  return parts.length ? { term: `≤ ${formatMoney(tailor.budget)} buys`, value: parts.join(" · ") } : null;
}

