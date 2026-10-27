import { SatinRamp } from "@/components/knit/satin";
import { SatinShares } from "@/components/ramp-knit";
import { formatShare, stackWidths, type ChartTone } from "@/lib/chart-geometry";

import { ChartUnknown } from "./chart-unknown";

export interface StackedPart { id: string; label: string; value: number; tone: ChartTone }

/** The --chart-* token behind each tone (styles/charts.css › tone slots). */
const TONE_COLOUR: Record<ChartTone, string> = {
  c1: "var(--chart-1)", c2: "var(--chart-2)", c3: "var(--chart-3)", c4: "var(--chart-4)", c5: "var(--chart-5)",
  c6: "var(--chart-6)", bad: "var(--chart-bad)", good: "var(--chart-good)", neutral: "var(--chart-neutral)",
};

/**
 * A 100% satin strip of ordered parts, one block per part, with a legend
 * of labels and shares. Tiny shares keep a sliver of stitching and read
 * "under 1%". compact drops the legend for tiles; the accessible name still
 * lists every part.
 */
export function StackedBar({ parts, label, compact = false }: { parts: StackedPart[]; label: string; compact?: boolean }) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  if (parts.length === 0 || total <= 0) return <ChartUnknown />;
  const widths = stackWidths(parts.map((part) => part.value));
  const shares = parts.map((part) => formatShare(Math.max(0, part.value) / total));
  const sentence = parts.map((part, index) => `${part.label} ${shares[index]}`).join(", ");
  return (
    <div className="chart chart-stack" role="img" aria-label={`${label}: ${sentence}`} data-compact={compact ? "" : undefined}>
      <SatinShares parts={parts.map((part, index) => ({ value: widths[index], colour: TONE_COLOUR[part.tone] }))}
        width={compact ? 200 : 360} height={compact ? 12 : 16} className="chart-stack__bar" />
      {!compact && (
        <span className="chart-legend">
          {parts.map((part, index) => (
            <span key={part.id} className="chart-legend__item">
              <span className="chart-swatch chart-swatch--satin" data-chart-tone={part.tone}><SatinRamp colours={[TONE_COLOUR[part.tone]]} width={12} height={12} /></span>
              <span>{part.label}</span>
              <strong>{shares[index]}</strong>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** One row of StackedRows: a compact bar, an optional comparison bar under it (London), and a short legend. */
export interface StackedRow {
  id: string;
  label: string;
  parts: StackedPart[];
  /** The same parts for the comparison (London), drawn thinner under the row's own bar. */
  compare?: StackedPart[] | null;
  compareLabel?: string;
  /** The row's few named parts: swatch, label and share (the bar's aria-label lists every part). */
  legend?: StackedPart[];
  /** Plain text at the row's end ("highest medium"). */
  note?: string;
  testId?: string;
}

/**
 * Several 100% bars as one compact chart block: a label column, the bars, and
 * a short legend or note per row; an optional shared legend under all rows.
 * Rows with no parts read "Unknown", never an empty bar.
 */
export function StackedRows({ rows, label, legend, testId }: {
  rows: StackedRow[]; label: string; legend?: Array<{ id: string; label: string; tone: ChartTone }>; testId?: string;
}) {
  return (
    <figure className="stack-rows" aria-label={label} data-testid={testId}>
      {rows.map((row) => (
        <div key={row.id} className="stack-row" data-testid={row.testId}>
          <span className="stack-row__label">{row.label}</span>
          <span className="stack-row__bars">
            {row.parts.length === 0 ? <ChartUnknown /> : <StackedBar compact parts={row.parts} label={row.label} />}
            {row.compare && row.compare.length > 0 && (
              <span className="stack-row__compare">
                <StackedBar compact parts={row.compare} label={`${row.label}, ${row.compareLabel ?? "comparison"}`} />
                <small>{row.compareLabel}</small>
              </span>
            )}
          </span>
          {row.legend && row.legend.length > 0 && <LegendLine parts={row.legend} total={row.parts} />}
          {row.note && <span className="stack-row__note">{row.note}</span>}
        </div>
      ))}
      {legend && (
        <span className="chart-legend stack-rows__legend">
          {legend.map((item) => (
            <span key={item.id} className="chart-legend__item">
              <span className="chart-swatch chart-swatch--satin" data-chart-tone={item.tone}><SatinRamp colours={[TONE_COLOUR[item.tone]]} width={12} height={12} /></span>
              <span>{item.label}</span>
            </span>
          ))}
        </span>
      )}
    </figure>
  );
}

function LegendLine({ parts, total }: { parts: StackedPart[]; total: StackedPart[] }) {
  const sum = total.reduce((acc, part) => acc + Math.max(0, part.value), 0);
  return (
    <span className="chart-legend stack-row__legend">
      {parts.map((part) => (
        <span key={part.id} className="chart-legend__item">
          <span className="chart-swatch chart-swatch--satin" data-chart-tone={part.tone}><SatinRamp colours={[TONE_COLOUR[part.tone]]} width={12} height={12} /></span>
          <span>{part.label}</span>
          <strong>{sum > 0 ? formatShare(Math.max(0, part.value) / sum) : "unknown"}</strong>
        </span>
      ))}
    </span>
  );
}
