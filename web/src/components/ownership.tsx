"use client";

import { useMemo } from "react";

import { type AreaOwnershipResponse, ownershipPath, ownershipRows, readAreaOwnership } from "@/lib/area-ownership";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { versusLondon } from "@/lib/overview-text";
import { BarList } from "./charts";
import { useSectionJson } from "./section-seed";

/** Company and overseas ownership (HMLR CCOD/OCOD), real mode only; nothing while CLOSE_KNIT_OWNERSHIP is off. */
export function Ownership({ geographyId, mode }: { geographyId: GeographyId; mode: DataMode }) {
  const payload = useSectionJson(mode === "real" ? ownershipPath(geographyId) : null);
  const ownership = useMemo(() => (payload ? readAreaOwnership(payload) : null), [payload]);
  return <OwnershipBlock ownership={ownership} />;
}

export function OwnershipBlock({ ownership }: { ownership: AreaOwnershipResponse | null }) {
  const rows = ownershipRows(ownership);
  const value = ownership?.value;
  if (!value?.available || rows.length === 0) return null;
  const company = rows.find((row) => row.id === "company");
  const comparison = versusLondon(company?.regionPercentile ?? null, "More than", "Fewer than");
  return (
    <div className="ownership" data-testid="ownership">
      <h3>Company owners</h3>
      {value.words && <p className="market-note">{value.words}{comparison ? ` · ${comparison}` : ""}</p>}
      <BarList rows={rows} label="Land titles per 100 homes" />
      <details className="chart-sources">
        <summary>Sources &amp; method</summary>
        <div className="chart-sources__body">
          {ownership!.sources.map((source) => <p key={source.release}>{source.attribution}</p>)}
          {ownership!.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
        </div>
      </details>
    </div>
  );
}
