import type { ShareRow } from "@/lib/share-rows";
import { sharePercent } from "@/lib/share-rows";

import { SatinMeter } from "./ramp-knit";

const at = (value: number, scale: number) => `${Math.min(100, Math.max(0, (value / scale) * 100)).toFixed(2)}%`;

/**
 * One row per category: label · the area's satin bar · London's tick on the same scale ·
 * the share · a difference chip. Highlighted rows (the household's types) are bold with a ▸; the
 * rest stay, dimmed only when something is highlighted. Plain text beside every bar.
 */
export function ShareRowList({ rows, scale, colour, label, highlight = [], testId }: {
  rows: readonly ShareRow[];
  scale: number;
  /** One yarn per topic; Homes passes the neutral grey (descriptive). */
  colour: string;
  /** What the list is, for screen readers ("Age: 0 to 14 16%, …"). */
  label: string;
  highlight?: readonly string[];
  testId?: string;
}) {
  const sentence = rows.map((row) => `${row.label} ${sharePercent(row.share)}${row.regionShare === null ? "" : ` (London ${sharePercent(row.regionShare)})`}`).join(", ");
  return (
    <ul className="share-rows" aria-label={`${label}: ${sentence}`} data-testid={testId} data-highlighting={highlight.length ? "" : undefined}>
      {rows.map((row) => {
        const lit = highlight.includes(row.id);
        return (
          <li key={row.id} className="share-row" data-testid="share-row" data-highlight={lit ? "" : undefined}>
            <span className="share-row__label" title={row.label}>{lit && <span className="share-row__mark" aria-label="Your type">▸ </span>}{row.label}</span>
            <span className="share-row__track" aria-hidden="true">
              {row.share !== null && <SatinMeter value={row.share / scale} colour={colour} width={160} height={12} className="share-row__satin" />}
              {row.regionShare !== null && <span className="share-row__tick" style={{ left: at(row.regionShare, scale) }} />}
            </span>
            <span className="share-row__value">{sharePercent(row.share)}</span>
            <span className="share-row__chip">{row.chip && <span className="diff-chip" title="Points against London">{row.chip}</span>}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** A rate row (offence types per 1,000): the same row with the rate in words and London's as its tick. */
export interface RateRow { id: string; label: string; value: number | null; london: number | null; display: string; chip: string | null }

export function RateRowList({ rows, colour, label, testId }: { rows: readonly RateRow[]; colour: string; label: string; testId?: string }) {
  const scale = Math.max(1, ...rows.flatMap((row) => [row.value ?? 0, row.london ?? 0]));
  const sentence = rows.map((row) => `${row.label} ${row.display}${row.london === null ? "" : ` (London ${row.london.toLocaleString("en-GB")})`}`).join(", ");
  return (
    <ul className="share-rows share-rows--rates" aria-label={`${label}: ${sentence}`} data-testid={testId}>
      {rows.map((row) => (
        <li key={row.id} className="share-row" data-testid="rate-row">
          <span className="share-row__label" title={row.label}>{row.label}</span>
          <span className="share-row__track" aria-hidden="true">
            {row.value !== null && <SatinMeter value={row.value / scale} colour={colour} width={160} height={12} className="share-row__satin" />}
            {row.london !== null && <span className="share-row__tick" style={{ left: at(row.london, scale) }} />}
          </span>
          <span className="share-row__value">{row.display}</span>
          <span className="share-row__chip">{row.chip && <span className="diff-chip" title="London's rate per 1,000">{row.chip}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

/** The one legend for a section of rows: "▮ Crofton │ London · chip = points against London, when 5 or more". */
export function ShareLegend({ name, colour, scope = "London", note = `Chip = points against ${scope}, when 5 or more` }: { name: string; colour: string; scope?: string; note?: string }) {
  return (
    <p className="share-legend" data-testid="share-legend">
      <span className="share-legend__item"><span className="share-legend__swatch" style={{ background: colour }} aria-hidden="true" />{name}</span>
      <span className="share-legend__item"><span className="share-legend__tick" aria-hidden="true" />{scope}</span>
      {note && <span className="share-legend__note">{note}</span>}
    </p>
  );
}
