"use client";

import { useMemo } from "react";

import { bandsVersusLondon, councilTaxPath, readCouncilTax, typicalBillWords, type AreaCouncilTaxResponse } from "@/lib/council-tax";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { formatShare } from "@/lib/chart-geometry";
import { scopeName } from "@/lib/scope-name";

import { BarList, ChartFrame, type BarRow } from "./charts";
import { useSectionJson } from "./section-seed";

/**
 * Homes by council tax band A-H (VOA), the most common band and a typical
 * bill from the borough's Band D, under the market section. Mounted by
 * MarketSection; fetches its own block. Nothing in demo mode or before load.
 */
export function CouncilTaxBandsBlock({ geographyId, mode }: { geographyId: GeographyId; mode: DataMode }) {
  const payload = useSectionJson(mode === "real" ? councilTaxPath(geographyId) : null);
  const body = useMemo(() => readCouncilTax(payload), [payload]);
  return <CouncilTaxBandsView body={body} />;
}

export function CouncilTaxBandsView({ body }: { body: AreaCouncilTaxResponse | null }) {
  const value = body?.value;
  if (!body || !value) return null;
  const rows: BarRow[] = value.bands.map((band) => ({ id: band.band, label: band.band, value: band.share, display: formatShare(band.share) }));
  const bill = typicalBillWords(value);
  const london = bandsVersusLondon(value.regionPercentile, scopeName(body));
  return (
    <div className="council-tax" data-testid="council-tax-bands">
      <ChartFrame title="Council tax bands" help="council-tax-bands"
        sources={<>
          {body.sources.map((source) => <p key={source.release}>{source.attribution}</p>)}
          {body.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
        </>}>
        <p className="market-basis">
          Most homes: <strong>Band {value.mostCommon}</strong>
          {bill && <> · Typical bill <strong>{bill}</strong></>}
        </p>
        <BarList rows={rows} label="Homes by council tax band" />
        {london && <p className="market-note">{london}</p>}
      </ChartFrame>
    </div>
  );
}
