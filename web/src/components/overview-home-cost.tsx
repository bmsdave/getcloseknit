"use client";

import Link from "next/link";
import { useState } from "react";

import { widerAreaWords, type FriendlyAreaFields } from "@/lib/area-labels";
import type { AreaSummary } from "@/lib/contracts";
import { formatPounds } from "@/lib/evidence-format";
import { defaultHomeSize, formatPricePerSquareMetre, HOME_SIZES, homeCost, isHomeSize, type HomeSize } from "@/lib/overview-scorecard";
import { toolHref } from "@/lib/tools";
import { HelpTip } from "./help-tip";

export const HOME_SIZE_KEY = "close-knit.home-size.v1";

function savedHomeSize(bedrooms: number | null): HomeSize {
  try {
    const saved = Number(window.localStorage.getItem(HOME_SIZE_KEY));
    if (isHomeSize(saved)) return saved;
  } catch { /* storage blocked */ }
  return defaultHomeSize(bedrooms);
}

/** The chosen home size: saved choice, else from the profile's bedrooms. */
export function useHomeSize(bedrooms: number | null): [HomeSize, (size: HomeSize) => void] {
  const [size, setSize] = useState<HomeSize>(() => savedHomeSize(bedrooms));
  const choose = (next: HomeSize) => {
    setSize(next);
    try { window.localStorage.setItem(HOME_SIZE_KEY, String(next)); } catch { /* storage blocked */ }
  };
  return [size, choose];
}

/**
 * The buyer's first answer and the page's one hero price: roughly what a
 * home of a chosen size costs here, with the sum as one caption line. The
 * 1-year trend is its own Overview tile.
 */
export function OverviewHomeCost({ price, loading, size, onSize, friendly = null }: {
  /** The area's £/m² at the chosen period; null when unknown. */
  price: AreaSummary | null;
  /** The price is still on its way (it comes from the area profile). */
  loading: boolean;
  size: HomeSize;
  onSize: (size: HomeSize) => void;
  /** Names the wider area when the price is borrowed. */
  friendly?: FriendlyAreaFields | null;
}) {
  const choose = onSize;
  const perSquareMetre = price?.value ?? null;
  const cost = homeCost(perSquareMetre, size);
  return (
    <section className="overview-card overview-home" data-testid="home-cost" aria-labelledby="overview-home-title"
      aria-busy={loading && cost === null ? true : undefined}>
      <div className="overview-card__head">
        <h2 id="overview-home-title">What a home costs here</h2>
        <HelpTip id="home-cost" label="home cost" />
      </div>
      <div className="overview-sizes" role="group" aria-label="Home size">
        {HOME_SIZES.map((option) => (
          <button
            key={option.squareMetres}
            type="button"
            aria-pressed={size === option.squareMetres}
            data-testid={`home-size-${option.bedrooms}`}
            onClick={() => choose(option.squareMetres)}
          >
            {option.label} <small>{option.squareMetres} m²</small>
          </button>
        ))}
      </div>
      <p className="overview-home__price" data-testid="home-cost-value">{cost !== null ? formatPounds(cost) : loading ? "Loading…" : "unknown"}</p>
      <p className="overview-home__sum" data-testid="home-cost-sum">
        {perSquareMetre === null
          ? (loading ? null : "No recent price for this area")
          : <>{size} m² × {formatPricePerSquareMetre(perSquareMetre)} · rough guide</>}
      </p>
      {/* While loading, an empty tools line holds the card at its final height (no layout shift). */}
      {cost === null && loading && <p className="overview-home__tools" aria-hidden="true" />}
      {cost !== null && (
        <p className="overview-home__tools">
          <Link href={toolHref("stamp-duty", { price: cost })} data-testid="home-cost-stamp-duty">Stamp duty on this price</Link>
        </p>
      )}
      {price?.quality === "fallback" && <PriceFallbackNote friendly={friendly} />}
    </section>
  );
}

/** A borrowed price, said once and named: "uses the price for the wider area around …". */
export function PriceFallbackNote({ friendly }: { friendly: FriendlyAreaFields | null }) {
  return (
    <p className="overview-warning" data-testid="price-fallback-warning">
      <span>Few sales here, so this uses the price for {widerAreaWords(friendly)}.</span>
      <HelpTip id="price-fallback" label="wider area price" />
    </p>
  );
}
