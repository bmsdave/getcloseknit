import { SatinBlock } from "@/components/knit/satin";
import { formatShare, waffleCells } from "@/lib/chart-geometry";

import { ChartUnknown } from "./chart-unknown";

const SIDE = 10;
const VIEW = 104;
const GAP = 1.5;
const CELL = (VIEW - GAP * (SIDE - 1)) / SIDE;

/**
 * One share (0..1) as a 10×10 square of satin blocks, one per cell, filled
 * in reading order; the rest are --wool felt. Any share above 0 fills at
 * least one block. Size it with --waffle-size (default 104px).
 */
export function Waffle({ share, label }: { share: number | null; label: string }) {
  if (share === null) return <ChartUnknown />;
  const filled = waffleCells(share);
  return (
    <svg className="chart chart-waffle" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label={`${label}: ${formatShare(share)}`}>
      {Array.from({ length: SIDE * SIDE }, (_, index) => {
        const x = (index % SIDE) * (CELL + GAP), y = Math.floor(index / SIDE) * (CELL + GAP);
        return index < filled
          ? <SatinBlock key={index} x={x} y={y} width={CELL} height={CELL} colour="var(--chart-1)" slant={2} seed={index + 1} />
          : <rect key={index} x={+x.toFixed(2)} y={+y.toFixed(2)} width={+CELL.toFixed(2)} height={+CELL.toFixed(2)} rx={2} style={{ fill: "var(--wool)" }} />;
      })}
    </svg>
  );
}
