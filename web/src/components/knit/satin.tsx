/**
 * Satin-stitched charts (DESIGN.md › Charts): legends, meters, steps, shares and
 * swatches are embroidered blocks: a felt base in the yarn's shade, close
 * slanted threads, and a contour stitch, so every edge is clean. Line charts and
 * dividers are stem stitch. The text value always sits beside the stitching.
 */
import { useId, type CSSProperties, type ReactNode } from "react";

import { tone } from "@/lib/knit";
import { satinThreads, STEM_DASH } from "@/lib/satin";

const idPart = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "");
const f = (n: number) => +n.toFixed(2);

/** One satin block, for use inside an <svg>. */
export function SatinBlock({ x, y, width, height, colour, slant = 4, seed = 1 }: {
  x: number; y: number; width: number; height: number; colour: string; slant?: number; seed?: number;
}) {
  const id = `sb${idPart(useId())}`;
  if (width <= 0.5) return null;
  const rx = Math.min(2.5, height / 4);
  const { tones, sheen } = satinThreads(x, y, width, height, slant, seed);
  return (
    <g className="satin">
      <clipPath id={id}><rect x={f(x)} y={f(y)} width={f(width)} height={f(height)} rx={f(rx)} /></clipPath>
      <rect x={f(x)} y={f(y)} width={f(width)} height={f(height)} rx={f(rx)} style={{ fill: tone(colour, -0.12) }} />
      <g clipPath={`url(#${id})`} fill="none" strokeLinecap="round" strokeWidth={2.2}>
        <path d={tones[0]} style={{ stroke: tone(colour, -0.08) }} />
        <path d={tones[1]} style={{ stroke: colour }} />
        <path d={tones[2]} style={{ stroke: tone(colour, 0.05) }} />
        <path d={sheen} style={{ stroke: tone(colour, 0.42) }} strokeWidth={0.5} opacity={0.4} />
      </g>
      <rect x={f(x + 0.4)} y={f(y + 0.4)} width={f(width - 0.8)} height={f(height - 0.8)} rx={f(Math.min(2.2, height / 4))}
        fill="none" style={{ stroke: tone(colour, -0.35) }} strokeWidth={0.8} opacity={0.8} />
    </g>
  );
}

/** An unworked block: plain felt in --wool. */
function Felt({ x, width, height }: { x: number; width: number; height: number }) {
  return <rect x={f(x)} y={0} width={f(width)} height={height} rx={2.5} style={{ fill: "var(--wool)" }} />;
}

interface SvgBox { width?: number; height?: number; className?: string; style?: CSSProperties; title?: string }

function Frame({ width, height, className, style, title, children }: Required<Pick<SvgBox, "width" | "height">> & SvgBox & { children: ReactNode }) {
  return (
    <svg className={className} viewBox={`0 0 ${f(width)} ${f(height)}`} width={f(width)} height={f(height)} overflow="visible" style={style}
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {children}
    </svg>
  );
}

/** A 0..1 meter: a satin fill over a --wool track. */
export function SatinBar({ value, colour, width = 190, height = 12, ...box }: SvgBox & { value: number; colour: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const fill = v <= 0 ? 0 : Math.max(height * 0.8, v * width);
  return (
    <Frame width={width} height={height} {...box}>
      <Felt x={0} width={width} height={height} />
      {fill > 0 && <SatinBlock x={0} y={0} width={fill} height={height} colour={colour} slant={3} seed={5} />}
    </Frame>
  );
}

/**
 * A table row's figure as a bar: satin to `value / max` on a --wool track in the colour the figure takes
 * on its metric's ramp, with the figure as text beside it, so colour is never the only cue. The bar
 * itself is decorative (aria-hidden); the text carries the fact.
 */
export function SatinValueBar({ value, max, colour, label, width = 96, height = 12, className = "satin-value-bar" }: {
  value: number; max: number; colour: string; label: ReactNode; width?: number; height?: number; className?: string;
}) {
  return (
    <span className={className}>
      <SatinBar value={max > 0 ? value / max : 0} colour={colour} width={width} height={height} className="satin-value-bar__bar" />
      <span className="satin-value-bar__value">{label}</span>
    </span>
  );
}

/** n steps, `filled` of them stitched (ratings, bands). */
export function SatinSteps({ count, filled, colour, width = 155, height = 12, gap = 3, colours, ...box }: SvgBox & {
  count: number; filled: number; colour: string; gap?: number; colours?: readonly string[];
}) {
  const w = (width - gap * (count - 1)) / count;
  return (
    <Frame width={width} height={height} {...box}>
      {Array.from({ length: count }, (_, i) => i < filled
        ? <SatinBlock key={i} x={i * (w + gap)} y={0} width={w} height={height} colour={colours?.[i] ?? colour} slant={3} seed={i + 2} />
        : <Felt key={i} x={i * (w + gap)} width={w} height={height} />)}
    </Frame>
  );
}

/** A legend or scale: one satin block per class, with an optional marker at 0..1. */
export function SatinRamp({ colours, marker, width = 366, height = 14, gap = 3, ...box }: SvgBox & {
  colours: readonly string[]; marker?: number | null; gap?: number;
}) {
  const n = Math.max(1, colours.length), w = (width - gap * (n - 1)) / n;
  return (
    <Frame width={width} height={height} {...box}>
      {colours.map((colour, i) => <SatinBlock key={i} x={i * (w + gap)} y={0} width={w} height={height} colour={colour} slant={4} seed={i + 1} />)}
      {marker != null && Number.isFinite(marker) && (
        <rect className="satin-marker" x={f(Math.max(0, Math.min(1, marker)) * width - 2)} y={-4} width={4} height={height + 8} rx={2}
          style={{ fill: "var(--ink)", stroke: "var(--panel-solid)" }} strokeWidth={1.5} />
      )}
    </Frame>
  );
}

/** Shares of a whole: satin blocks whose stitches alternate direction so neighbours part. */
export function SatinStacked({ parts, width = 358, height = 16, ...box }: SvgBox & { parts: readonly { value: number; colour: string }[] }) {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0) || 1;
  let x = 0;
  return (
    <Frame width={width} height={height} {...box}>
      {parts.map((p, i) => {
        const full = (Math.max(0, p.value) / total) * width, start = x;
        x += full;
        const w = full - (i < parts.length - 1 ? 2 : 0);
        return w > 0.5 ? <SatinBlock key={i} x={start} y={0} width={w} height={height} colour={p.colour} slant={i % 2 ? -4 : 4} seed={i + 7} /> : null;
      })}
    </Frame>
  );
}


/** Stem stitch along a path, for use inside an <svg> (line charts, baselines). */
export function StemLine({ d, colour, width = 2.7, opacity, className }: { d: string; colour: string; width?: number; opacity?: number; className?: string }) {
  return <path className={className} d={d} fill="none" style={{ stroke: colour }} strokeWidth={width} strokeDasharray={STEM_DASH} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />;
}

/** A table or list divider: a quiet stem stitch across the full width. */
export function StemDivider({ className = "stem-divider" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 2" preserveAspectRatio="none" aria-hidden="true" style={{ display: "block", width: "100%", height: 2 }}>
      <path d="M1 1H399" fill="none" style={{ stroke: "var(--field-line)" }} strokeWidth={1.3} strokeDasharray={STEM_DASH} strokeLinecap="round" opacity={0.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
