import { memo, type ReactNode } from "react";

import { sampleRamp } from "@/lib/palettes";

import { SatinBlock, SatinRamp } from "./knit/satin";

/**
 * Satin strips for charts and legends (DESIGN.md › Charts), built only from
 * the satin primitives. Fixed-size pieces are SatinRamp; the fluid ones fill
 * their CSS box: blocks are laid out at a nominal width close to the rendered
 * one and the svg stretches the rest, so the threads stay close and even.
 * Decorative unless given a title: the text beside them carries the value.
 */

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** An svg that stretches to its CSS box (preserveAspectRatio none). */
function Fit({ width, height, className, title, children }: { width: number; height: number; className?: string; title?: string; children: ReactNode }) {
  return (
    <svg className={["satin-fit", className].filter(Boolean).join(" ")} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" overflow="visible"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {children}
    </svg>
  );
}

/** Unworked felt in --wool: the empty part of a meter, an unfilled step. */
function Felt({ x = 0, y = 0, width, height }: { x?: number; y?: number; width: number; height: number }) {
  return <rect x={+x.toFixed(2)} y={y} width={+width.toFixed(2)} height={height} rx={Math.min(2.5, height / 4)} style={{ fill: "var(--wool)" }} />;
}

/** A 0..1 meter filling its box: a satin fill over a --wool track. */
export function SatinMeter({ value, colour, width = 200, height = 12, className }: { value: number; colour: string; width?: number; height?: number; className?: string }) {
  const v = clamp(value);
  const fill = v <= 0 ? 0 : Math.max(height * 0.8, v * width);
  return (
    <Fit width={width} height={height} className={className}>
      <Felt width={width} height={height} />
      {fill > 0 && <SatinBlock x={0} y={0} width={fill} height={height} colour={colour} slant={3} seed={5} />}
    </Fit>
  );
}

/** A range (0..1 each end) stitched into a --wool track that fills its box. */
export function SatinSpan({ from, to, colour, width = 240, height = 14, className }: {
  from: number | null; to: number | null; colour: string; width?: number; height?: number; className?: string;
}) {
  const hasRange = from !== null && to !== null;
  const lo = hasRange ? Math.min(clamp(from), clamp(to)) : 0, hi = hasRange ? Math.max(clamp(from), clamp(to)) : 0;
  const w = Math.min(width, Math.max(height * 0.8, (hi - lo) * width));
  const x = Math.min(lo * width, width - w);
  return (
    <Fit width={width} height={height} className={className}>
      <Felt width={width} height={height} />
      {hasRange && <SatinBlock x={x} y={0} width={w} height={height} colour={colour} slant={3} seed={Math.round(lo * 97) + 3} />}
    </Fit>
  );
}

/** Separate blocks side by side with gaps, filling the box; `null` is an unworked felt block. */
export function SatinBlocks({ colours, width = 300, height = 14, gap = 3, className, title }: {
  colours: readonly (string | null)[]; width?: number; height?: number; gap?: number; className?: string; title?: string;
}) {
  const n = Math.max(1, colours.length), w = (width - gap * (n - 1)) / n;
  return (
    <Fit width={width} height={height} className={className} title={title}>
      {colours.map((colour, i) => colour === null
        ? <Felt key={i} x={i * (w + gap)} width={w} height={height} />
        : <SatinBlock key={i} x={i * (w + gap)} y={0} width={w} height={height} colour={colour} slant={3} seed={i + 2} />)}
    </Fit>
  );
}

/** Shares of a whole filling the box: blocks whose stitches alternate direction so neighbours part. */
export function SatinShares({ parts, width = 360, height = 16, className }: { parts: readonly { value: number; colour: string }[]; width?: number; height?: number; className?: string }) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0) || 1;
  const shown = parts.map((part, i) => ({ ...part, i })).filter((part) => part.value > 0);
  let x = 0;
  return (
    <Fit width={width} height={height} className={className}>
      {shown.map((part, k) => {
        const full = (part.value / total) * width, start = x;
        x += full;
        const w = Math.max(1.5, full - (k < shown.length - 1 ? 2 : 0));
        return <SatinBlock key={part.i} x={start} y={0} width={w} height={height} colour={part.colour} slant={part.i % 2 ? -4 : 4} seed={part.i + 7} />;
      })}
    </Fit>
  );
}

type RampProps = { colours: readonly string[]; steps?: number; width?: number; height?: number; className?: string };

/** The legend re-renders on every timeline step with a new but equal colour list: skip the satin then. */
function sameRamp(previous: RampProps, next: RampProps): boolean {
  return previous.colours.join() === next.colours.join() && previous.steps === next.steps && previous.width === next.width
    && previous.height === next.height && previous.className === next.className;
}

/**
 * A colour ramp as a legend: `steps` separate satin blocks sampled along the
 * ramp, 3px apart, like a card of embroidery threads; never a gradient.
 */
export const RampSatin = memo(function RampSatin({ colours, steps = colours.length, width = 300, height = 14, className }: {
  colours: readonly string[]; steps?: number; width?: number; height?: number; className?: string;
}) {
  return <SatinBlocks colours={sampleRamp(colours, Math.max(1, steps))} width={width} height={height} className={["ramp-satin", className].filter(Boolean).join(" ")} />;
}, sameRamp);

/** A legend's colour square: one satin block. */
export function SatinSquare({ colour, size = 14, className = "map-legend-swatch" }: { colour: string; size?: number; className?: string }) {
  return <SatinRamp colours={[colour]} width={size} height={size} className={["satin-square", className].join(" ")} />;
}

/**
 * A two-way colour square, one satin block per shade with 3px gaps: columns
 * are shades of A, rows shades of B (bottom to top). Fills a square box.
 */
export function SatinSquareGrid({ colours, size = 120, gap = 3, className }: { colours: readonly (readonly string[])[]; size?: number; gap?: number; className?: string }) {
  const levels = Math.max(1, colours.length), cell = (size - gap * (levels - 1)) / levels;
  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} overflow="visible" aria-hidden="true">
      {colours.flatMap((column, a) => column.map((colour, b) => (
        <SatinBlock key={`${a}-${b}`} x={a * (cell + gap)} y={(levels - 1 - b) * (cell + gap)} width={cell} height={cell} colour={colour} slant={3} seed={a * levels + b + 1} />
      )))}
    </svg>
  );
}

/** Discrete colours side by side as satin blocks, about 6px wide per `per` (the colour pickers). */
export function SwatchKnit({ colours, per = 2, className }: { colours: readonly string[]; per?: number; className?: string }) {
  const block = per * 6, gap = 2;
  return <SatinRamp colours={colours} gap={gap} width={colours.length * block + gap * (colours.length - 1)} height={14} className={className} />;
}
