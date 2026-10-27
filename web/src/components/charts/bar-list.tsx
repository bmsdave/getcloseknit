import { SatinMeter } from "@/components/ramp-knit";

import { ChartUnknown } from "./chart-unknown";

export interface BarRow { id: string; label: string; value: number; display: string; marker?: number | null }

const pct = (value: number, max: number) => `${((Math.max(0, value) / max) * 100).toFixed(2)}%`;

/**
 * Horizontal bars on one shared scale, each a satin meter: label, bar and display
 * value side by side on an aligned grid, and an optional London tick
 * (marker, same units as value). A key names the tick whenever one is drawn.
 */
export function BarList({ rows, label }: { rows: BarRow[]; label: string }) {
  if (rows.length === 0) return <ChartUnknown />;
  const markers = rows.map((row) => row.marker).filter((marker): marker is number => typeof marker === "number");
  const max = Math.max(...rows.map((row) => row.value), ...markers, 0);
  const scale = max > 0 ? max : 1;
  const sentence = rows.map((row) => `${row.label} ${row.display}`).join(", ");
  return (
    <div className="chart chart-bars" role="img" aria-label={`${label}: ${sentence}`}>
      <ul className="chart-bars__list">
        {rows.map((row) => (
          <li key={row.id} className="chart-bars__row">
            <span className="chart-bars__label">{row.label}</span>
            <span className="chart-bars__track">
              <SatinMeter value={Math.max(0, row.value) / scale} colour="var(--chart-1)" width={160} height={12} className="chart-bars__satin" />
              {typeof row.marker === "number" && <span className="chart-bars__marker" style={{ left: pct(row.marker, scale) }} />}
            </span>
            <span className="chart-bars__value">{row.display}</span>
          </li>
        ))}
      </ul>
      {markers.length > 0 && <span className="chart-key"><span className="chart-key__tick" />London</span>}
    </div>
  );
}
