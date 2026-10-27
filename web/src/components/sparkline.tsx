"use client";

import { chartScale, describeTrend } from "@/lib/chart-scale";
import type { Point } from "@/lib/knit";

import { Dot, threadPath } from "./knit";
import { StemLine } from "./knit/satin";

const BOX = { width: 260, height: 80 };

interface SparklineProps {
  /** One entry per period; null keeps the slot but breaks the line. */
  values: readonly (number | null)[];
  periods: readonly string[];
  /** Renders a number for the axis and the summary row, e.g. "£9,600". */
  format: (value: number) => string;
  subject: string;
  testId?: string;
  /** Line only: no axis, periods or summary (a glance next to a headline number). */
  compact?: boolean;
  /** The latest/first/high/low row; off where the figures sit in key numbers beside the chart. */
  summary?: boolean;
}

const pointsOf = (segment: string): Point[] => segment.split(" ").map((pair) => {
  const [x, y] = pair.split(",").map(Number);
  return [x, y] as const;
});

/**
 * The line in stem stitch: one run per unbroken stretch, exactly through the
 * data points (threadPath, no jitter). The svg stretches to its box, so the
 * stitches keep their width with a non-scaling stroke (charts.css › .stem).
 */
function Threads({ segments, width }: { segments: string[]; width: number }) {
  return segments.map((segment, index) => {
    const points = pointsOf(segment);
    // A lone month is a short stitch, so it still shows.
    const run = points.length > 1 ? points : [[points[0][0] - 1.5, points[0][1]], [points[0][0] + 1.5, points[0][1]]] as Point[];
    return <g key={index} className="stem"><StemLine d={threadPath(run)} colour="var(--thread)" width={width} /></g>;
  });
}

/** The dot at the latest point, placed over the stretched svg in % of its box. */
function EndDot({ segments, size }: { segments: string[]; size: number }) {
  const end = pointsOf(segments.at(-1)!).at(-1)!;
  return (
    <span className="sparkline-dot" style={{ left: `${(end[0] / BOX.width) * 100}%`, top: `${(end[1] / BOX.height) * 100}%`, width: size, height: size }}>
      <Dot colour="var(--thread)" size={size} />
    </span>
  );
}

/**
 * A line chart that always shows its numbers: axis ticks (high / mid / low),
 * a summary row (latest, first, high, low) and the covered period. The
 * accessible name states the direction computed from the data. The line is a
 * stem stitch ending in a dot at the latest value (DESIGN.md › Time series).
 */
export function Sparkline({ values, periods, format, subject, testId, compact = false, summary = true }: SparklineProps) {
  const scale = chartScale(values, BOX);
  const label = `${subject} ${describeTrend(scale.first, scale.latest)} between ${periods[0] ?? "?"} and ${periods.at(-1) ?? "?"}`;
  if (scale.observedCount === 0) {
    return <p className="chart-empty" data-testid={testId}>No published values in this window.</p>;
  }
  if (compact) {
    return (
      <span className="sparkline-compact" data-testid={testId}>
        <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} role="img" aria-label={label} preserveAspectRatio="none">
          <Threads segments={scale.segments} width={2} />
        </svg>
        <EndDot segments={scale.segments} size={10} />
      </span>
    );
  }
  return (
    <div className="sparkline" data-testid={testId}>
      <div className="sparkline-axis" aria-hidden="true">
        {scale.ticks.map((tick) => <span key={tick}>{format(tick)}</span>)}
      </div>
      <div className="sparkline-plot">
        <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} role="img" aria-label={label} preserveAspectRatio="none">
          {scale.ticks.map((tick) => (
            <line key={tick} x1="0" x2={BOX.width} y1={tickY(tick, scale.low, scale.high)} y2={tickY(tick, scale.low, scale.high)} className="sparkline-grid" />
          ))}
          <Threads segments={scale.segments} width={3} />
        </svg>
        <EndDot segments={scale.segments} size={13} />
      </div>
      <div className="sparkline-periods"><span>{periods[0]}</span><span>{periods.at(-1)}</span></div>
      {summary && (
        <dl className="sparkline-summary">
          <div><dt>Latest</dt><dd data-testid="chart-latest">{format(scale.latest as number)}</dd></div>
          <div><dt>First</dt><dd>{format(scale.first as number)}</dd></div>
          <div><dt>High</dt><dd>{format(scale.high as number)}</dd></div>
          <div><dt>Low</dt><dd>{format(scale.low as number)}</dd></div>
        </dl>
      )}
    </div>
  );
}

function tickY(tick: number, low: number | null, high: number | null): number {
  if (low === null || high === null || high === low) return BOX.height / 2;
  const usable = BOX.height - 12;
  return 6 + usable - ((tick - low) / (high - low)) * usable;
}
