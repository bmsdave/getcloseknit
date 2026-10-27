"use client";

import { useId, useState } from "react";

import { formatMoney, formatPerArea } from "@/lib/money-format";
import { pounds } from "@/lib/property-profile";

/**
 * "Is the asking price fair?" (review #16): the asking price from a listing
 * against what is on record here. Client only: the figure lives in this
 * component's state and nowhere else (no storage, no URL, no request), so a
 * reload empties the field. Never a valuation: it sets one price against
 * recorded sales and the area's price range, never against a figure for the
 * home itself.
 */

/** What the page already shows, to set an asking price against. */
export interface AskingBasis {
  /** The recorded price to compare with, and how to name it ("this home's last recorded sale (£570k, 3 Nov 2022)"). Never an estimate. */
  reference: { price: number; words: string } | null;
  /**
   * The middle half of local sales. `per: "m2"` compares the asking price per
   * m² (needs `floorArea`); `per: "price"` compares the price itself.
   */
  band: { p25: number; p75: number; per: "m2" | "price"; what: string } | null;
  /** The home's floor area in m², for a £/m² comparison. */
  floorArea?: number | null;
}

export interface AskingAnswer {
  /** "£650,000 is 14% above this home's last recorded sale (…) and inside the middle half of flat sales here, adjusted to Jun 2026 (£520k–£760k)." */
  sentence: string;
  /** "At 54 m², that is £12,040/m²." when a floor area is known. */
  perArea: string | null;
}

/** A typed or pasted price in pounds ("650000", "£650,000", "650k", "1.2m"); null when it is not a plausible home price. */
export function parseAskingPrice(text: string): number | null {
  const cleaned = text.trim().toLowerCase().replace(/[£,\s]/g, "");
  const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(cleaned);
  if (!match) return null;
  const amount = Number(match[1]) * (match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : 1);
  return Number.isFinite(amount) && amount >= 10_000 && amount <= 100_000_000 ? Math.round(amount) : null;
}

/** "12% above", "3% below", or "about the same as" (within half a percent). */
export function relativeTo(value: number, reference: number): string {
  const percent = ((value - reference) / reference) * 100;
  if (Math.abs(percent) < 0.5) return "about the same as";
  return `${Math.round(Math.abs(percent))}% ${percent > 0 ? "above" : "below"}`;
}

/** Where a figure sits against a middle half: below it, inside it, or above it. */
export function bandPosition(value: number, band: { p25: number; p75: number }): "below" | "inside" | "above" {
  if (value < band.p25) return "below";
  return value > band.p75 ? "above" : "inside";
}

export function askingPriceAnswer(asking: number, basis: AskingBasis): AskingAnswer | null {
  if (!(asking > 0)) return null;
  const perSquareMetre = basis.floorArea && basis.floorArea > 0 ? asking / basis.floorArea : null;
  const parts: string[] = [];
  if (basis.reference && basis.reference.price > 0) {
    parts.push(`${relativeTo(asking, basis.reference.price)} ${basis.reference.words}`);
  }
  const band = basis.band;
  const compared = band ? (band.per === "m2" ? perSquareMetre : asking) : null;
  if (band && compared !== null) {
    const range = band.per === "m2"
      ? `${formatPerArea(band.p25, "")}–${formatPerArea(band.p75)}`
      : `${formatMoney(band.p25)}–${formatMoney(band.p75)}`;
    parts.push(`${bandPosition(compared, band)} the middle half of ${band.what} (${range})`);
  }
  if (parts.length === 0) return null;
  return {
    sentence: `${pounds(asking)} is ${parts.join(" and ")}.`,
    perArea: perSquareMetre === null ? null : `At ${basis.floorArea} m², that is ${formatPerArea(perSquareMetre)}.`,
  };
}

export function AskingPriceCheck({ basis, className = "", testId = "asking-price-check" }: {
  basis: AskingBasis; className?: string; testId?: string;
}) {
  const [text, setText] = useState("");
  const id = useId();
  if (!basis.reference && !basis.band) return null;
  const asking = parseAskingPrice(text);
  const answer = asking === null ? null : askingPriceAnswer(asking, basis);
  return (
    <section className={`asking-check ${className}`.trim()} data-testid={testId} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Is the asking price fair?</h2>
      <label className="asking-check__label" htmlFor={`${id}-input`}>Asking price</label>
      <div className="asking-check__field">
        <span className="asking-check__pound" aria-hidden="true">£</span>
        <input id={`${id}-input`} className="knit-field asking-check__input" data-testid="asking-price-input"
          inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="650,000"
          aria-describedby={`${id}-note`} value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      <div className="asking-check__answer" role="status" data-testid="asking-price-answer">
        {answer ? (
          <>
            <p>{answer.sentence}</p>
            {answer.perArea && <p className="asking-check__detail">{answer.perArea}</p>}
          </>
        ) : text.trim() !== "" && asking === null ? (
          <p className="asking-check__detail">Type a price in pounds, like 650000.</p>
        ) : null}
      </div>
      <p className="asking-check__note" id={`${id}-note`} data-testid="asking-price-note">
        <strong>Not a valuation.</strong> A check against recorded sales; homes often sell for less than the asking price.
        We don&apos;t keep this figure: it is not saved or sent anywhere, and it clears when you reload.
      </p>
    </section>
  );
}
