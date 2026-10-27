/**
 * Knitted components (DESIGN.md › Knitted components). Built from stitches by
 * lib/knit.ts — never a knit texture laid over a shape. Colours may be hex or
 * a CSS variable (`var(--wool)`) so the same knit follows Day and Night.
 */
import { memo, useId, type CSSProperties, type ReactNode } from "react";

import { barGrid, hash, knitStitch, tone, looped, pixels, purlBump, ribGrid, rng, slack, type Cell, type Grid, type Point } from "@/lib/knit";

export { tone };

const cell = (s: Cell): [string, "k" | "p"] | null => (s === null ? null : typeof s === "string" ? [s, "k"] : [s[0], "p"]);
const idPart = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "");

export interface KnitFabricProps {
  grid: Grid;
  /** Stitch cell size in user units; the SVG scales to its box. */
  stitchW?: number;
  stitchH?: number;
  /** A bind-off chain across the top row (a finished edge). */
  bindOff?: boolean;
  seed?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Placement when nested inside another <svg> (user units of the parent). */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Stockinette with intarsia colour and purl stitches, rows interlocking. */
export function KnitFabric({ grid, stitchW: W = 10, stitchH: H = 8, bindOff = false, seed = 1, title, className, style, x, y, width: boxW, height: boxH }: KnitFabricProps) {
  const uid = idPart(useId());
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const width = cols * W, height = rows * H + H * 0.4;
  const colours = [...new Set(grid.flat().flatMap((s) => cell(s)?.[0] ?? []))];
  const key = (colour: string) => `${uid}${colours.indexOf(colour)}`;
  const random = rng(seed);
  // Hand-knit rows never line up perfectly: each row sits a fraction of a stitch off.
  const wobble = rng(seed + 7);
  const rowShift = grid.map(() => (wobble() - 0.5) * W * 0.14);

  // The depth showing between the legs. At the fabric's own edges it is inset,
  // so the outline is made by the stitches themselves (V points along the
  // bottom, loop tops along the top, bumps down the sides), never a cut line.
  const runs: ReactNode[] = [];
  grid.forEach((row, r) => {
    for (let c = 0; c < cols;) {
      const here = cell(row[c]);
      if (!here) { c++; continue; }
      const [colour, kind] = here;
      let e = c;
      while (e + 1 < cols && cell(row[e + 1])?.join() === here.join()) e++;
      const leftEdge = c === 0 || !cell(row[c - 1]), rightEdge = e === cols - 1 || !cell(row[e + 1]);
      const x0 = c * W + (leftEdge ? W * 0.24 : -0.2) + rowShift[r], x1 = (e + 1) * W + (rightEdge ? -W * 0.24 : 0.2) + rowShift[r];
      const y0 = r * H + (r === 0 || !cell(grid[r - 1]?.[c] ?? null) ? H * 0.6 : 0);
      const y1 = r * H + H * 1.32 - (r === rows - 1 || !cell(grid[r + 1]?.[c] ?? null) ? H * 0.5 : 0);
      runs.push(<rect key={`${r}-${c}`} x={x0} y={y0} width={Math.max(0, x1 - x0)} height={Math.max(0, y1 - y0)}
        style={{ fill: tone(colour, kind === "k" ? -0.3 : -0.2) }} />);
      c = e + 1;
    }
  });
  const stitches: ReactNode[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      const here = cell(grid[r][c]);
      const v = Math.floor(random() * 3);
      if (!here) continue;
      const [colour, kind] = here;
      const cx = c * W + W / 2 + rowShift[r] + (random() - 0.5) * 0.6;
      if (kind === "k") stitches.push(<use key={`${r}-${c}`} href={`#${key(colour)}k${v}`} x={cx} y={(r + 1) * H + H * 0.25 + (random() - 0.5) * 0.5} />);
      else stitches.push(<use key={`${r}-${c}`} href={`#${key(colour)}p${(r + c) % 2}`} x={cx} y={r * H + H * 0.78} />);
    }
  }
  return (
    <svg className={["knit-fabric", className].filter(Boolean).join(" ")} style={{ overflow: "visible", ...style }} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" x={x} y={y} width={boxW} height={boxH}
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <StitchDefs colours={colours} idOf={key} W={W} H={H} />
      {runs}
      {stitches}
      {bindOff && grid[0].map((s, c) => {
        const here = cell(s);
        if (!here) return null;
        const [colour] = here;
        const x0 = c * W - W * 0.1, x1 = x0 + W * 1.2, y = H * 0.18, w = H * 0.6;
        return <path key={c} d={`M${x0} ${y}Q${(x0 + x1) / 2} ${y - w * 0.62} ${x1} ${y}Q${(x0 + x1) / 2} ${y + w * 0.62} ${x0} ${y}Z`}
          fill={`url(#${key(colour)}gV)`} style={{ stroke: tone(colour, -0.26) }} strokeWidth={0.4} />;
      })}
    </svg>
  );
}

/**
 * Gradients and stitch symbols for each colour: `${idOf(colour)}k0..2` (knit V,
 * bottom point at 0,0) and `${idOf(colour)}p0..1` (purl bump). Shared by
 * KnitFabric and anything else that places stitches itself (a knitted ring).
 */
export function StitchDefs({ colours, idOf: key, W, H }: { colours: readonly string[]; idOf: (colour: string) => string; W: number; H: number }) {
  const shapes = [0, 1, 2].map((v) => knitStitch(W, H, v));
  return (
    <defs>
      {colours.map((colour) => (
        <g key={colour}>
          {(["L", "R", "V"] as const).map((side) => (
            <linearGradient key={side} id={`${key(colour)}g${side}`} x1={side === "R" ? 1 : 0} y1="0" x2={side === "L" ? 1 : 0} y2={side === "V" ? 1 : 0.3}>
              <stop offset="0" style={{ stopColor: tone(colour, -0.2) }} />
              <stop offset="0.42" style={{ stopColor: tone(colour, 0.24) }} />
              <stop offset="0.62" style={{ stopColor: colour }} />
              <stop offset="1" style={{ stopColor: tone(colour, -0.26) }} />
            </linearGradient>
          ))}
          {shapes.map((shape, v) => (
            <symbol key={v} id={`${key(colour)}k${v}`} overflow="visible">
              {shape.legs.map((leg) => (
                <g key={leg.side}>
                  <path d={leg.d} style={{ fill: tone(colour, -0.6) }} opacity={0.18} transform="translate(0 1.2)" />
                  <path d={leg.d} fill={`url(#${key(colour)}g${leg.side})`} style={{ stroke: tone(colour, -0.26) }} strokeWidth={0.4} />
                  {leg.plies.map((d) => <path key={d} d={d} fill="none" style={{ stroke: tone(colour, -0.14) }} strokeWidth={0.5} opacity={0.45} />)}
                </g>
              ))}
            </symbol>
          ))}
          {[0, 1].map((v) => (
            <symbol key={`p${v}`} id={`${key(colour)}p${v}`} overflow="visible">
              <path d={purlBump(W, H, v)} fill={`url(#${key(colour)}gV)`} style={{ stroke: tone(colour, -0.26) }} strokeWidth={0.4} />
            </symbol>
          ))}
        </g>
      ))}
    </defs>
  );
}

/** A score as a knitted strip: the first value% of stitches in `colour`, the rest plain wool. */
export const KnitBar = memo(function KnitBar({ value, colour = "var(--yarn-cherry)", ground = "var(--wool)", cols = 34, rows = 3, label, className }: {
  value: number; colour?: string; ground?: string; cols?: number; rows?: number; label?: string; className?: string;
}) {
  return <KnitFabric grid={barGrid(value, colour, ground, cols, rows)} seed={hash(`${value}${colour}`)} title={label}
    className={["knit-bar", className].filter(Boolean).join(" ")} />;
});

/** k2p2 ribbing: the finished edge on sheets, headers and the hero button. */
export const RibBand = memo(function RibBand({ colour = "var(--cuff)", stripe = "var(--cuff-stripe)", cols = 48, rows = 5, className }: {
  colour?: string; stripe?: string | null; cols?: number; rows?: number; className?: string;
}) {
  return <KnitFabric grid={ribGrid(cols, rows, colour, stripe ?? undefined)} seed={7} className={["rib-band", className].filter(Boolean).join(" ")} />;
});

const HOUSE = [
  "...............",
  ".......R.......",
  "......RRR......",
  ".....RRRRR.....",
  "....RRRRRRR....",
  "...RRRRRRRRR...",
  "..RRRRRRRRRRR..",
  "...SSSSSSSSS...",
  "...SWSSSSSWS...",
  "...SSSSSSSSS...",
  "...PPPPDPPPP...",
  "...PWPPDPPWP...",
  "...PPPPDPPPP...",
  "GGGGGGGGGGGGGGG",
];

/** The logo: a little house knitted in colour-work (DESIGN.md › Logo). */
export const KnitLogo = memo(function KnitLogo({ className, title = "Close Knit" }: { className?: string; title?: string }) {
  const grid = pixels(HOUSE, {
    ".": "var(--wool)", R: "#e2453c", S: "#f6c445", P: "#4aa3df",
    W: "var(--logo-window)", D: "#22252c", G: "var(--logo-ground)",
  });
  return <KnitFabric grid={grid} stitchW={12} stitchH={9.5} seed={6} title={title} className={["knit-logo", className].filter(Boolean).join(" ")} />;
});

/** One plied strand along a path, for use inside an <svg>. */
export function Yarn({ d, colour = "var(--yarn-cherry)", width = 5 }: { d: string; colour?: string; width?: number }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" className="yarn">
      <path d={d} style={{ stroke: tone(colour, -0.6) }} strokeWidth={width + 1.6} opacity={0.3} transform="translate(0 1.4)" />
      <path d={d} style={{ stroke: tone(colour, -0.38) }} strokeWidth={width + 1} />
      <path d={d} style={{ stroke: colour }} strokeWidth={width} />
      <path d={d} style={{ stroke: tone(colour, -0.32) }} strokeWidth={width * 0.95} strokeDasharray={`${width * 0.38} ${width * 0.38}`} opacity={0.6} />
      <path d={d} style={{ stroke: tone(colour, 0.22) }} strokeWidth={width * 0.3} strokeDasharray={`${width * 0.38} ${width * 0.38}`} strokeDashoffset={width * 0.38} opacity={0.5} transform={`translate(${-width * 0.12} ${width * 0.1})`} />
    </g>
  );
}

/** A thread through chart points: exact at the points (no jitter), optionally with one loop. */
export function threadPath(points: readonly Point[], loopAt?: number, radius = 6): string {
  return loopAt === undefined ? slack(points, 1, 0) : looped(points, loopAt, radius, 1, 0);
}

/** A plain dot (DESIGN.md › Dot): a filled circle with a thin --surface ring, so it reads on any
    background. A place on the map, today on a line chart, a value on a scale; one size per use, never sized by a value. */
export function Dot({ colour, size = 18, title, className }: { colour: string; size?: number; title?: string; className?: string }) {
  const ring = Math.max(1.5, size * 0.1);
  return (
    <svg className={["dot", className].filter(Boolean).join(" ")} width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <circle cx={size / 2} cy={size / 2} r={(size - ring) / 2} style={{ fill: colour, stroke: "var(--surface)" }} strokeWidth={ring} />
    </svg>
  );
}

/** A short strand of yarn: a series' legend swatch, drawn as the thread itself. */
export function YarnSwatch({ colour, className, ...data }: { colour: string; className?: string } & { [key: `data-${string}`]: string | undefined }) {
  return (
    <svg className={["yarn-swatch", className].filter(Boolean).join(" ")} viewBox="0 0 24 12" aria-hidden="true" {...data}>
      <Yarn d="M2.5 7.5C6 3 9 3 12 6s6 3 9.5-1.5" colour={colour} width={2.6} />
    </svg>
  );
}

/** A thin k2p2 rib along a table's head (DESIGN.md › tables): decorative, before the <table>. */
export function TableRib({ cols = 48 }: { cols?: number }) {
  return <RibBand cols={cols} rows={2} stripe={null} className="table-rib" />;
}

/**
 * The sheet's handle, embroidered into the rib cuff: a short bar of satin
 * stitch (slanted yarn stitches laid side by side), not a flat pill.
 */
export function SatinHandle({ colour = "var(--handle-yarn)", className }: { colour?: string; className?: string }) {
  const stitches = Array.from({ length: 11 }, (_, i) => 4 + i * 4.4);
  return (
    <svg className={["satin-handle", className].filter(Boolean).join(" ")} viewBox="0 0 56 12" aria-hidden="true" focusable="false">
      {stitches.map((x, i) => (
        <Yarn key={i} d={`M${(x - 1.6).toFixed(1)} ${i % 2 ? 9.6 : 9.2}L${(x + 1.6).toFixed(1)} ${i % 2 ? 2.4 : 2.8}`} colour={colour} width={2.6} />
      ))}
    </svg>
  );
}

/**
 * The sheet's cuff: three rows of stockinette (cuff, stripe, cuff) with square
 * stitches, so the band reads as knitting and its lower edge is a row of V
 * points sewn onto the sheet. Rib at this size reads as stripes, so the cuff
 * is plain knit.
 */
export const CuffBand = memo(function CuffBand({ cols = 48, className }: { cols?: number; className?: string }) {
  const row = (colour: string) => Array.from({ length: cols }, () => colour);
  return <KnitFabric grid={[row("var(--cuff)"), row("var(--cuff-stripe)"), row("var(--cuff)")]} stitchW={10} stitchH={8.4} seed={11}
    className={["rib-band", "cuff-band", className].filter(Boolean).join(" ")} />;
});
