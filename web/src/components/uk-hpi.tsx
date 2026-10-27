"use client";

import { useMemo, useState } from "react";

import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { formatMonth, formatPoundsShort } from "@/lib/market";
import {
  HPI_SPAN_LABELS,
  HPI_SPANS,
  HPI_TYPE_LABELS,
  formatChange,
  hpiPath,
  readAreaHpi,
  type AreaHpi,
  type HpiType,
} from "@/lib/uk-hpi";

import { ScaleMarker } from "./charts";
import { HelpTip } from "./help-tip";
import { useSectionJson } from "./section-seed";
import { Sparkline } from "./sparkline";
import { regionShare } from "@/lib/evidence-format";

/** The borough's official price index under Local market (HM Land Registry UK HPI); nothing until loaded. */
export function UkHpi({ geographyId, mode }: { geographyId: GeographyId; mode: DataMode }) {
  const payload = useSectionJson(hpiPath(geographyId));
  const hpi = useMemo(() => readAreaHpi(payload, mode)?.value, [payload, mode]);
  return hpi?.available ? <UkHpiView hpi={hpi} /> : null;
}

/** One line since 1995 with a type switch, the change over 1, 5 and 10 years next to London's, and the 5-year London rank. */
export function UkHpiView({ hpi }: { hpi: AreaHpi }) {
  const [type, setType] = useState<HpiType>("all");
  const shown = hpi.types.find((entry) => entry.type === type) ?? hpi.types[0];
  const rank = hpi.regionPercentile["5y"];
  const name = hpi.borough.name;
  return (
    <div className="uk-hpi" data-testid="uk-hpi">
      <h3 className="market-heading">Borough price index <HelpTip id="uk-hpi" /></h3>
      {hpi.types.length > 1 && (
        <div className="uk-hpi-types" role="group" aria-label="Type of home">
          {hpi.types.map((entry) => (
            <button key={entry.type} type="button" className="chip-button" aria-pressed={entry.type === shown.type}
              onClick={() => setType(entry.type)}>{HPI_TYPE_LABELS[entry.type]}</button>
          ))}
        </div>
      )}
      <Sparkline values={shown.series.map((point) => point.price)} periods={shown.series.map((point) => formatMonth(point.month))}
        format={formatPoundsShort} subject={`${name} average price, ${HPI_TYPE_LABELS[shown.type].toLowerCase()} homes,`}
        testId="uk-hpi-line" summary={false} />
      <div className="market-table-wrap" tabIndex={0} role="region" aria-label={`Price change in ${name} and London`}>
        <table className="market-table" data-testid="uk-hpi-changes">
          <thead><tr><th scope="col">Change</th><th scope="col">{name}</th><th scope="col">London</th></tr></thead>
          <tbody>
            {HPI_SPANS.map((span) => (
              <tr key={span}><th scope="row">{HPI_SPAN_LABELS[span]}</th><td>{formatChange(shown.change[span])}</td><td>{formatChange(shown.regionChange[span])}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {typeof rank === "number" && (
        <ScaleMarker position={rank / 100} low="Slowest" high="Fastest"
          label={`5-year change: faster than ${regionShare(rank)}% of London boroughs`} />
      )}
    </div>
  );
}
