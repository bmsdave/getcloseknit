import { tone } from "@/lib/knit";
import { SATIN_GAP } from "@/lib/satin";

import { ChartUnknown } from "./chart-unknown";

const shown = (score: number) => (Number.isInteger(score) ? String(score) : score.toFixed(1));
const COLOUR = "var(--chart-1)";
// Rough advance of a bold digit, in em; "/" is narrower, so this errs on the safe side.
const DIGIT = 0.62;
const MIN_SUFFIX = 11;

/** The band width of a ring of outer diameter `size`: 12–16px at reading sizes. */
export function ringBand(size: number): number {
  return Math.min(16, Math.max(10, size * 0.22));
}

/**
 * The centre label, sized to sit inside the ring's hole: the number shrinks
 * if it would touch the band, and "/max" shows only when it fits at 11px or
 * more (the aria-label always says "out of max").
 */
export function ringLabel(score: number, max: number, size: number): { text: string; fontSize: number; suffix: string | null; suffixSize: number } {
  const text = shown(score);
  const room = (size - 2 * ringBand(size) - 2) * 0.86;
  const fontSize = Math.min(size * 0.28, room / (DIGIT * text.length));
  const suffix = `/${max}`;
  const suffixSize = Math.max(MIN_SUFFIX, size * 0.14);
  const fits = DIGIT * (text.length * fontSize + suffix.length * suffixSize) <= room;
  return { text, fontSize, suffix: fits ? suffix : null, suffixSize };
}

/**
 * A score ring (score of max) in satin stitch: a --wool felt track, and the
 * first share of it worked in close threads laid across the band, with a
 * contour stitch along both edges. The number sits in the middle, never
 * touching the band; size is the outer diameter in px.
 */
export function RingScore({ score, max = 10, label, size = 56 }: { score: number | null; max?: number; label: string; size?: number }) {
  if (score === null) return <ChartUnknown />;
  const share = max > 0 ? Math.min(1, Math.max(0, score / max)) : 0;
  const centre = size / 2;
  // 12–16px at reading sizes; a tile ring (48px) keeps room for its number.
  const band = ringBand(size);
  const centreText = ringLabel(score, max, size);
  const r = centre - band / 2 - 1;
  const arc = share * 2 * Math.PI * r;
  const turn = `rotate(-90 ${centre} ${centre})`;
  // pathLength 1: the base and both contours stop at the same angle whatever their radius.
  const dash = `${share.toFixed(4)} 2`;
  // Threads laid across the band, SATIN_GAP apart along the mid radius, slightly slanted, in two tones.
  const threads: [string, string] = ["", ""];
  const count = Math.floor(arc / SATIN_GAP);
  for (let i = 0; i <= count; i++) {
    const a = -Math.PI / 2 + (Math.min(arc - 0.6, i * SATIN_GAP + 0.6) / r), slant = 1.2 / r;
    const p = (radius: number, angle: number) => `${(centre + radius * Math.cos(angle)).toFixed(2)} ${(centre + radius * Math.sin(angle)).toFixed(2)}`;
    threads[i % 2] += `M${p(r - band / 2 + 0.8, a - slant)}L${p(r + band / 2 - 0.8, a + slant)}`;
  }
  return (
    <svg className="chart chart-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${shown(score)} out of ${max}`}>
      <circle cx={centre} cy={centre} r={r} className="chart-ring__track" strokeWidth={band} />
      {arc > 0 && (
        <g className="chart-ring__arc satin" fill="none">
          <circle cx={centre} cy={centre} r={r} strokeWidth={band} pathLength={1} strokeDasharray={dash} transform={turn} style={{ stroke: tone(COLOUR, -0.12) }} />
          <path d={threads[0]} strokeWidth={1.7} strokeLinecap="round" style={{ stroke: COLOUR }} />
          <path d={threads[1]} strokeWidth={1.7} strokeLinecap="round" style={{ stroke: tone(COLOUR, 0.06) }} />
          <circle cx={centre} cy={centre} r={r - band / 2 + 0.4} strokeWidth={0.8} pathLength={1} strokeDasharray={dash} transform={turn} style={{ stroke: tone(COLOUR, -0.35) }} />
          <circle cx={centre} cy={centre} r={r + band / 2 - 0.4} strokeWidth={0.8} pathLength={1} strokeDasharray={dash} transform={turn} style={{ stroke: tone(COLOUR, -0.35) }} />
        </g>
      )}
      <text x={centre} y={centre} dy="0.35em" textAnchor="middle" className="chart-ring__value" style={{ fontSize: centreText.fontSize }}>
        {centreText.text}
        {centreText.suffix && <tspan className="chart-ring__max" style={{ fontSize: centreText.suffixSize }}>{centreText.suffix}</tspan>}
      </text>
    </svg>
  );
}
