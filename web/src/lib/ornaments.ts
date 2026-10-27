/**
 * Colour-work bands for hero moments (DESIGN.md › Ornaments): stranded
 * knitting charts in the Fair Isle and Selbu traditions, built stitch by stitch
 * as a Grid for KnitFabric. Every cell is a stitch (never empty), so a band's
 * edge is the knitting itself, finished by its frame.
 *
 * - "town": a row of knitted houses in yarn colours with lit windows, between
 *   peerie borders (the small two- or three-row patterns of Fair Isle).
 * - "fairisle": houses and diamond "OXO" motifs alternating on one band.
 * - "selbu": eight-petal Selbu roses, alternating snow and sky, on the ground.
 */
import type { Cell, Grid } from "./knit";

export type OrnamentKind = "town" | "fairisle" | "selbu";

const HOUSE = [
  "......R......",
  ".....RRR.....",
  "....RRRRR....",
  "...RRRRRRR...",
  "..RRRRRRRRR..",
  ".RRRRRRRRRRR.",
  "..BBBBBBBBB..",
  "..BWWBBBWWB..",
  "..BWWBBBWWB..",
  "..BBBBDBBBB..",
  "..BBBBDBBBB..",
];

const ROSE = [
  ".....S.....",
  "....SSS....",
  ".S..SSS..S.",
  ".SS.SSS.SS.",
  "..SS.S.SS..",
  "SSSSS.SSSSS",
  "..SS.S.SS..",
  ".SS.SSS.SS.",
  ".S..SSS..S.",
  "....SSS....",
  ".....S.....",
];

const DIAMOND = [
  ".....D.....",
  "....D.D....",
  "...D.X.D...",
  "..D.XXX.D..",
  ".D.XX.XX.D.",
  "D.XX...XX.D",
  ".D.XX.XX.D.",
  "..D.XXX.D..",
  "...D.X.D...",
  "....D.D....",
  ".....D.....",
];

/** House colourways: roof, walls. Windows are --logo-window (lit at night). */
const HOUSES: readonly [string, string][] = [
  ["var(--yarn-cherry)", "var(--yarn-sun)"], ["var(--yarn-sky)", "var(--yarn-pink)"], ["var(--yarn-cobalt)", "var(--yarn-sky)"],
  ["var(--yarn-sun)", "var(--yarn-cherry)"], ["var(--yarn-pink)", "var(--yarn-cobalt)"], ["var(--yarn-tangerine)", "var(--yarn-sky)"],
];

const GROUND = "var(--wool)";
// A door is always a dark wooden door, in Day and Night alike.
const DOOR = "#22252c";

/** Two peerie rows: a dotted row and a little zig-zag, in two yarns. */
function peerie(cols: number, a: string, b: string): Cell[][] {
  const dots = Array.from({ length: cols }, (_, c) => (c % 4 === 0 ? a : GROUND));
  const zig = Array.from({ length: cols }, (_, c) => (c % 4 === 1 || c % 4 === 3 ? b : GROUND));
  const solid = Array.from({ length: cols }, () => a);
  return [solid, dots, zig];
}

/** Stamps motif `art` at column `x` of `rows`, painting chart letters with `paint`. */
function stamp(rows: Cell[][], top: number, x: number, art: readonly string[], paint: (ch: string) => Cell | undefined) {
  art.forEach((line, r) => [...line].forEach((ch, c) => {
    const cell = paint(ch);
    if (cell !== undefined && rows[top + r] && x + c < rows[top + r].length) rows[top + r][x + c] = cell;
  }));
}

/** A colour-work band `cols` stitches wide. */
export function ornamentGrid(kind: OrnamentKind, cols = 104): Grid {
  const motifH = 11, gap = 2;
  const body: Cell[][] = Array.from({ length: motifH + gap * 2 }, () => Array.from({ length: cols }, () => GROUND));
  const width = kind === "selbu" ? ROSE[0].length : HOUSE[0].length, pitch = width + 3;
  const count = Math.floor((cols + 3) / pitch), offset = Math.floor((cols - (count * pitch - 3)) / 2);
  for (let i = 0; i < count; i++) {
    const x = offset + i * pitch;
    if (kind === "selbu") {
      const yarn = i % 2 ? "var(--yarn-sky)" : "var(--handle-yarn)";
      stamp(body, gap, x, ROSE, (ch) => (ch === "S" ? yarn : undefined));
    } else if (kind === "fairisle" && i % 2 === 1) {
      stamp(body, gap, x, DIAMOND, (ch) => (ch === "D" ? "var(--yarn-sun)" : ch === "X" ? "var(--yarn-cherry)" : undefined));
    } else {
      const [roof, walls] = HOUSES[(kind === "fairisle" ? i / 2 : i) % HOUSES.length | 0];
      stamp(body, gap, x, HOUSE, (ch) => ({ R: roof, B: walls, W: "var(--logo-window)", D: DOOR } as Record<string, Cell>)[ch]);
    }
  }
  const [top1, top2, top3] = kind === "selbu" ? peerie(cols, "var(--yarn-cherry)", "var(--handle-yarn)") : peerie(cols, "var(--yarn-cherry)", "var(--yarn-sun)");
  const [bot1, bot2, bot3] = kind === "selbu" ? peerie(cols, "var(--yarn-cherry)", "var(--handle-yarn)") : peerie(cols, "var(--yarn-cobalt)", "var(--yarn-sky)");
  return [top1, top2, top3, ...body, bot3, bot2, bot1];
}
