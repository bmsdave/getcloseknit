"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { readAreaRents, rentsPath } from "@/lib/area-rents";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import type { LatestRateHint } from "@/lib/rate-hint";

import { useSectionJson } from "./section-seed";

/** The calculator's code and styles load only when the block is opened. */
const InvestorCalculator = dynamic(() => import("./investor-calculator").then((loaded) => loaded.InvestorCalculator), { ssr: false });

/**
 * The home page's folded Tools block: the investor calculator (buy-to-let, HMO, BRRR, flip), after the
 * area's Living costs. Nothing is read until it is opened; then the borough rent for the area is read (the
 * area page's own rents read) as the rent to start from. Nothing the reader types is kept or sent.
 */
export function HomeInvestorTools({ areaId, mode, price, address, rateHint }: {
  areaId: GeographyId | null;
  mode: DataMode;
  /** The home's last recorded sale, or null (the calculator then opens on its example price). */
  price: number | null;
  address: string;
  rateHint: LatestRateHint | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="home-tools" data-testid="home-tools" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary data-testid="home-tools-toggle">Tools</summary>
      {open && <Calculator areaId={areaId} mode={mode} price={price} address={address} rateHint={rateHint} />}
    </details>
  );
}

function Calculator({ areaId, mode, price, address, rateHint }: {
  areaId: GeographyId | null; mode: DataMode; price: number | null; address: string; rateHint: LatestRateHint | null;
}) {
  const payload = useSectionJson(areaId ? rentsPath(areaId) : null);
  // The calculator starts from the rent, so it waits for the read (a missing one just means no starting rent).
  if (payload === undefined) return <p className="home-tools__status" role="status" data-testid="home-tools-loading">Loading the borough rent…</p>;
  return (
    <InvestorCalculator initialPrice={price} from={price === null ? null : address} rateHint={rateHint}
      rents={payload === null ? null : readAreaRents(payload, mode)} embedded />
  );
}
