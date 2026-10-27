import { compassPoint, ringLabel, ringPoint, spreadMarkers, type ChartTone } from "@/lib/chart-geometry";
import { formatDistance } from "@/lib/places";

import { Dot } from "@/components/knit";
import { StemLine } from "@/components/knit/satin";

import { ChartUnknown } from "./chart-unknown";

export interface RingPlace { id: string; label: string; distanceMetres: number; bearingDegrees: number; tone: ChartTone }

const VIEW = 240;
const CENTRE = VIEW / 2;
const RADIUS = 100;
const MARKER = 9;
/** A full circle as one path, so a ring can be stem-stitched. */
const circlePath = (r: number) => `M${CENTRE - r} ${CENTRE}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/**
 * Places by bearing and distance on 500 m / 1 km / 1.5 km rings around the
 * area. Each point is a numbered marker, nudged apart so none overlap, and
 * named in the key under the rings (nearest first), so long names never
 * crowd the picture. Places past the outer ring sit on its edge.
 */
export function DistanceRings({ points, rings = [500, 1000, 1500], label }: { points: RingPlace[]; rings?: number[]; label: string }) {
  const outer = Math.max(...rings);
  if (points.length === 0) return <ChartUnknown>None within {ringLabel(outer)}</ChartUnknown>;
  const sorted = [...points].sort((a, b) => a.distanceMetres - b.distanceMetres);
  const placed = spreadMarkers(
    sorted.map((point) => ringPoint(point.distanceMetres, point.bearingDegrees, outer, RADIUS)),
    MARKER * 2 + 2,
    RADIUS + 6,
  );
  const sentence = sorted
    .map((point, index) => `${index + 1} ${point.label}, ${formatDistance(point.distanceMetres)} ${compassPoint(point.bearingDegrees)}`)
    .join("; ");
  return (
    <div className="chart chart-rings" role="img" aria-label={`${label}: ${sentence}`}>
      <svg className="chart-rings__plot" viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true">
        {rings.map((ring) => (
          <g key={ring} className="chart-rings__ring"><StemLine d={circlePath((ring / outer) * RADIUS)} colour="var(--chart-neutral)" width={1.6} /></g>
        ))}
        <line x1={CENTRE} x2={CENTRE} y1={CENTRE - RADIUS - 4} y2={CENTRE - RADIUS + 6} className="chart-rings__north-tick" />
        <text x={CENTRE} y={CENTRE - RADIUS - 8} textAnchor="middle" className="chart-rings__north">N</text>
        {rings.map((ring) => (
          <text key={ring} x={CENTRE} y={CENTRE + (ring / outer) * RADIUS - 4} textAnchor="middle" className="chart-rings__ring-label">
            {ringLabel(ring)}
          </text>
        ))}
        <g transform={`translate(${CENTRE - 6} ${CENTRE - 6})`}><Dot colour="var(--yarn-cherry)" size={12} /></g>
        {sorted.map((point, index) => (
          <g key={point.id} data-chart-tone={point.tone} transform={`translate(${(CENTRE + placed[index].x).toFixed(2)} ${(CENTRE + placed[index].y).toFixed(2)})`}>
            <g transform={`translate(${-MARKER - 2} ${-MARKER - 2})`}><Dot colour="var(--tone)" size={MARKER * 2 + 4} /></g>
            <text dy="0.35em" textAnchor="middle" className="chart-rings__number">{index + 1}</text>
          </g>
        ))}
      </svg>
      <ol className="chart-rings__key">
        {sorted.map((point, index) => (
          <li key={point.id} data-chart-tone={point.tone}>
            <span className="chart-rings__badge">{index + 1}</span>
            <span className="chart-rings__name">{point.label}</span>
            <span className="chart-rings__distance">{formatDistance(point.distanceMetres)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
