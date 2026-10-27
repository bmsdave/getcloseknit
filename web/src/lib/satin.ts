/**
 * Satin stitch geometry (DESIGN.md › Charts): close slanted threads laid across
 * a block, as on an embroidered patch. Pure and seeded, so server and client
 * renders match. The threads are grouped into a few paths (three tones and a
 * sheen) to keep the DOM small; components/knit/satin.tsx draws them.
 */
import { rng } from "./knit";

export const SATIN_GAP = 1.75;
export const SATIN_THREAD = 2.2;

export interface SatinPaths {
  /** Threads in three alternating tones (shade, body, light). */
  tones: [string, string, string];
  /** A short sheen along the middle of each thread. */
  sheen: string;
}

const f = (n: number) => +n.toFixed(2);

/** Threads for a block at (x, y) of w × h, slanting by `slant` px from top to bottom. */
export function satinThreads(x: number, y: number, w: number, h: number, slant = 4, seed = 1): SatinPaths {
  const random = rng(seed);
  const tones: [string, string, string] = ["", "", ""];
  let sheen = "";
  const x0 = x - Math.max(0, slant) - 2, x1 = x + w - Math.min(0, slant) + 2;
  let i = 0;
  for (let tx = x0; tx < x1; tx += SATIN_GAP, i++) {
    const j1 = (random() - 0.5) * 0.5, j2 = (random() - 0.5) * 0.5;
    tones[i % 3] += `M${f(tx + j1)} ${f(y + 0.4)}L${f(tx + slant + j2)} ${f(y + h - 0.4)}`;
    sheen += `M${f(tx + j1 + slant * 0.3 - 0.45)} ${f(y + h * 0.3)}L${f(tx + slant * 0.7 + j2 - 0.45)} ${f(y + h * 0.7)}`;
  }
  return { tones, sheen };
}

/** Stem stitch: a line of short overlapping stitches. */
export const STEM_DASH = "5 1.25";
