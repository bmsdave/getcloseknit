/**
 * A knitted colour-work band for hero moments (DESIGN.md › Ornaments): Fair
 * Isle houses, OXO diamonds or Selbu roses, knitted stitch by stitch
 * (lib/ornaments.ts). The frame clips the band to clean rounded edges, so no
 * stitch forms the outline. Decorative: hidden from assistive tech.
 */
import { useMemo } from "react";

import { ornamentGrid, type OrnamentKind } from "@/lib/ornaments";

import { KnitFabric } from "./index";

export function KnitOrnament({ kind = "town", cols = 104, className }: { kind?: OrnamentKind; cols?: number; className?: string }) {
  const grid = useMemo(() => ornamentGrid(kind, cols), [kind, cols]);
  return (
    <div className={["knit-ornament", `knit-ornament--${kind}`, className].filter(Boolean).join(" ")} aria-hidden="true">
      <KnitFabric grid={grid} stitchW={10} stitchH={9} seed={kind.length * 7} />
    </div>
  );
}
