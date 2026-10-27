import { bandIndex, type ChartTone } from "@/lib/chart-geometry";

import { SatinBlocks } from "@/components/ramp-knit";

import { ChartUnknown } from "./chart-unknown";

const edge = (index: number, count: number) => (index === 0 ? "start" : index === count - 1 ? "end" : "middle");

/**
 * An A–G style scale with this item's band raised and outlined ("Now" tag
 * above) and an optional potential band dash-outlined ("Potential" tag
 * below). Shape and tags mark the bands, not colour alone.
 */
export function BandScale({ bands, current, potential = null, label }: {
  bands: { id: string; label: string; tone: ChartTone }[]; current: string | null; potential?: string | null; label: string;
}) {
  const now = bandIndex(bands, current);
  if (now < 0) return <ChartUnknown />;
  const next = bandIndex(bands, potential);
  const sentence = `${bands[now].label} now${next >= 0 ? `, ${bands[next].label} potential` : ""}`;
  return (
    <div className="chart chart-bands" role="img" aria-label={`${label}: ${sentence}`} style={{ gridTemplateColumns: `repeat(${bands.length}, minmax(0, 1fr))` }}>
      {bands.map((band, index) => (
        <span
          key={band.id}
          className="chart-bands__band"
          data-chart-tone={band.tone}
          data-edge={edge(index, bands.length)}
          data-current={index === now ? "" : undefined}
          data-potential={index === next ? "" : undefined}
        >
          <span className="chart-bands__tag chart-bands__tag--now">{index === now ? "Now" : ""}</span>
          <span className="chart-bands__block">
            <SatinBlocks colours={["var(--tone)"]} width={40} height={index === now ? 16 : 12} className="chart-bands__satin" />
          </span>
          <span className="chart-bands__name">{band.label}</span>
          {next >= 0 && <span className="chart-bands__tag chart-bands__tag--potential">{index === next ? "Potential" : ""}</span>}
        </span>
      ))}
    </div>
  );
}
