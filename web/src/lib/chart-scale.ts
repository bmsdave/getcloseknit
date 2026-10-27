/**
 * Geometry for the evidence sparklines. Every chart must show its numbers:
 * the scale exposes low/high/first/latest values and axis ticks so a reader
 * (or an agent reading the DOM) never has to guess what a line means.
 * Missing months break the line rather than being drawn as zero.
 */
export interface ChartBox {
  width: number;
  height: number;
}

export interface ChartScale {
  segments: string[];
  low: number | null;
  high: number | null;
  first: number | null;
  latest: number | null;
  observedCount: number;
  ticks: number[];
}

const PADDING = 6;

export function chartScale(values: readonly (number | null)[], box: ChartBox): ChartScale {
  const observed = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (observed.length === 0) {
    return { segments: [], low: null, high: null, first: null, latest: null, observedCount: 0, ticks: [] };
  }
  const low = Math.min(...observed);
  const high = Math.max(...observed);
  const span = high - low;
  const usable = box.height - PADDING * 2;
  const step = box.width / Math.max(1, values.length - 1);
  const y = (value: number) => span === 0 ? box.height / 2 : PADDING + usable - ((value - low) / span) * usable;
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${round(index * step)},${round(y(value))}`);
  });
  if (current.length > 0) segments.push(current.join(" "));
  return {
    segments, low, high, first: observed[0], latest: observed[observed.length - 1],
    observedCount: observed.length, ticks: span === 0 ? [low] : [high, (high + low) / 2, low],
  };
}

export function describeTrend(first: number | null, latest: number | null): string {
  if (first === null || latest === null || first === 0) return "is incomplete";
  const change = (latest - first) / Math.abs(first);
  if (change > 0.02) return "rises";
  if (change < -0.02) return "falls";
  return "is broadly flat";
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
