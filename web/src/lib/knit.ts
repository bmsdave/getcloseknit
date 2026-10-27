/**
 * Knitting geometry for the Close Knit design system (see DESIGN.md).
 *
 * Knitted things are built stitch by stitch, never a texture laid over a
 * shape: a stockinette stitch is a V of two leaf-shaped yarn legs whose tops
 * tuck under the row above; a purl bump is a horizontal loop; colour lives on
 * individual stitches (intarsia), so a knitted bar's end steps like real
 * knitting. Yarn paths are slack, softly kinked curves, optionally with a loop.
 *
 * Everything here is deterministic (seeded) so server and client renders match.
 */

export type Stitch = string | readonly [colour: string, kind: "p"];
/** A grid cell: a stitch, or null for no fabric (a knitted icon on a transparent ground). */
export type Cell = Stitch | null;
export type Grid = readonly (readonly Cell[])[];
export type Point = readonly [number, number];

/** Lighten (k > 0) or darken (k < 0) a #rrggbb colour. */
export function shade(hex: string, k: number): string {
  const n = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  const out = rgb.map((c) => Math.max(0, Math.min(255, Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k)))));
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Darken, but less for light yarn so cream and white stay clean, never grey. */
export function deepen(hex: string, k: number): string {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return shade(hex, k * (1 - 0.55 * lum));
}

/** Shade a hex directly; mix a CSS variable towards black/white so it can be themed. */
export function tone(colour: string, k: number): string {
  if (colour.startsWith("#")) return k < 0 ? deepen(colour, k) : shade(colour, k);
  const pct = Math.round(100 - Math.abs(k) * 100);
  return `color-mix(in srgb, ${colour} ${pct}%, ${k < 0 ? "black" : "white"})`;
}

/** mulberry32: small, fast, deterministic PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const f = (n: number) => n.toFixed(2);

/** A leaf from (x0,y0) to (x1,y1), widest (w) in the middle, its spine bowed by `bow`. */
export function leaf(x0: number, y0: number, x1: number, y1: number, w: number, bow: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const mx = x0 + dx * 0.5 + nx * bow, my = y0 + dy * 0.5 + ny * bow;
  const a = [mx + nx * w * 0.62, my + ny * w * 0.62], b = [mx - nx * w * 0.62, my - ny * w * 0.62];
  return {
    d: `M${f(x0)} ${f(y0)}Q${f(a[0])} ${f(a[1])} ${f(x1)} ${f(y1)}Q${f(b[0])} ${f(b[1])} ${f(x0)} ${f(y0)}Z`,
    mid: [mx, my] as Point,
    normal: [nx, ny] as Point,
  };
}

export interface StitchShape { legs: { side: "L" | "R"; d: string; plies: string[] }[] }

/** One knit stitch (a V) with its bottom point at (0,0), in a W×H cell. */
export function knitStitch(W: number, H: number, variant: number): StitchShape {
  const r = rng(hash(`k${variant}`));
  const lean = (r() * 0.1 - 0.05) * W;
  const w = W * 0.5 * (0.95 + r() * 0.1);
  const top = -H * 1.3;
  const legs = (["L", "R"] as const).map((side) => {
    const sx = side === "L" ? -1 : 1;
    const x0 = sx * W * 0.04, x1 = sx * W * 0.44 + lean;
    const { d, mid, normal } = leaf(x0, 0, x1, top, w, sx * W * 0.05);
    const plies = [-0.17, 0.17].map((o) => {
      const px = mid[0] + normal[0] * w * o, py = mid[1] + normal[1] * w * o;
      return `M${f(x0 + (px - x0) * 0.25)} ${f(py * 0.25)}Q${f(px)} ${f(py)} ${f(x1 + (px - x1) * 0.3)} ${f(top + (py - top) * 0.3)}`;
    });
    return { side, d, plies };
  });
  return { legs };
}

/** One purl bump centred on (0,0). */
export function purlBump(W: number, H: number, variant: number): string {
  const r = rng(hash(`p${variant}`));
  const bow = H * 0.14 * (variant % 2 ? 1 : -1);
  return leaf(-W * 0.6, 0, W * 0.6, r() * 0.8 - 0.4, H * 1.05, bow).d;
}

/** A row-major grid where the first `round(value * cols)` stitches of every row are `colour`. */
export function barGrid(value: number, colour: string, ground: string, cols = 34, rows = 3): Grid {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * cols);
  return Array.from({ length: rows }, () => Array.from({ length: cols }, (_, c) => (c < filled ? colour : ground)));
}

/** k2p2 ribbing; rows listed in `stripeRows` use the stripe colour. */
export function ribGrid(cols: number, rows: number, colour: string, stripe?: string, stripeRows: readonly number[] = [1, 2]): Grid {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c): Stitch => {
      const col = stripe && stripeRows.includes(r) ? stripe : colour;
      return c % 4 < 2 ? col : [col, "p"];
    }),
  );
}

/** Pixel art → grid: each character maps to a colour (or a purl stitch). */
export function pixels(art: readonly string[], palette: Record<string, Cell>): Grid {
  return art.map((row) => [...row].map((ch) => palette[ch] ?? null));
}

/** A slack yarn path through points: densified, softly kinked, smoothed (Catmull-Rom → cubic). */
export function slack(points: readonly Point[], seed = 1, amp = 4): string {
  const r = rng(seed);
  const dense: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const n = Math.max(1, Math.floor(len / 26));
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    for (let j = 1; j <= n; j++) {
      const t = j / n, jit = j < n ? (r() * 2 - 1) * amp : 0;
      dense.push([x0 + (x1 - x0) * t + nx * jit, y0 + (y1 - y0) * t + ny * jit]);
    }
  }
  let d = `M${f(dense[0][0])} ${f(dense[0][1])}`;
  for (let i = 0; i < dense.length - 1; i++) {
    const p0 = dense[Math.max(0, i - 1)], p1 = dense[i], p2 = dense[i + 1], p3 = dense[Math.min(dense.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** The same, with one teardrop loop tied at points[at] — what makes a line read as yarn. */
export function looped(points: readonly Point[], at: number, radius: number, seed = 1, amp = 4): string {
  if (points.length < 3 || at <= 0 || at >= points.length - 1) return slack(points, seed, amp);
  const a = slack(points.slice(0, at + 1), seed, amp);
  const [x, y] = points[at], rr = radius;
  const loop = ` C${f(x + 2.2 * rr)} ${f(y - 0.4 * rr)} ${f(x + 1.2 * rr)} ${f(y - 2.6 * rr)} ${f(x)} ${f(y - 1.6 * rr)}` +
    ` C${f(x - 1.2 * rr)} ${f(y - 0.6 * rr)} ${f(x - 0.4 * rr)} ${f(y + 0.6 * rr)} ${f(x)} ${f(y)}`;
  const b = slack(points.slice(at), seed + 1, amp);
  return a + loop + b.slice(b.indexOf(" C"));
}

export interface RingStitch { x: number; y: number; angle: number; row: number; index: number }

/**
 * Knitting in the round: `count` V stitches per row placed around a circle,
 * clockwise from 12 o'clock, each rotated so its row runs along the tangent
 * (the V opens outwards). Row 0 sits on `radius`, later rows step out by
 * `rowStep`. A share fills whole stitches, as on a knitted bar.
 */
export function ringStitches(cx: number, cy: number, radius: number, count: number, rows = 1, rowStep = 0): RingStitch[] {
  const out: RingStitch[] = [];
  for (let row = 0; row < rows; row++) {
    const r = radius + row * rowStep;
    for (let index = 0; index < count; index++) {
      const angle = ((index + 0.5) / count) * 360;
      const a = (angle * Math.PI) / 180;
      out.push({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a), angle, row, index });
    }
  }
  return out;
}
