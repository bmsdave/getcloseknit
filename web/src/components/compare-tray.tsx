"use client";

import Link from "next/link";

import { compareHref } from "@/lib/compare-table";
import { useComparedAreas, writeCompared } from "@/lib/compare-selection";
import { KnitIcon } from "./knit/knit-icon";
import "../styles/compare.css";

/**
 * "Compare · N" (Compare v2 tray): the areas added to compare (an area's "Add to compare", or Compare
 * on Saved › Areas), on the map outside My match, which has its own tray. Compare opens /compare.
 */
export function CompareTray() {
  const compared = useComparedAreas();
  if (compared.length === 0) return null;
  return (
    <div className="compare-tray" data-testid="compare-tray" role="region" aria-label="Compare">
      <strong className="compare-tray__count">Compare · {compared.length}</strong>
      {compared.length >= 2
        ? <Link className="compare-tray__open" href={compareHref("places", compared)} data-testid="compare-tray-open">Compare</Link>
        : <span className="compare-tray__hint">Add one more</span>}
      <button type="button" className="compare-tray__clear" aria-label="Clear compare" onClick={() => writeCompared([])}>
        <KnitIcon name="cross" className="knit-glyph" style={{ width: 14, height: 14 }} />
      </button>
    </div>
  );
}
