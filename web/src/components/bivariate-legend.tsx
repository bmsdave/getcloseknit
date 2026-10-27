"use client";

import type { BivariateSquare } from "@/lib/contracts";
import { bivariateAxisText } from "@/lib/custom-criteria";

import { SatinSquare, SatinSquareGrid } from "./ramp-knit";

/** The colour square in satin: columns are shades of A (left to right), rows shades of B (bottom to top),
 * one satin block per cell the map can paint (4 × 4), 3px apart. */
function Square({ square, size }: { square: BivariateSquare; size: number }) {
  return (
    <span className="bivariate-square" style={{ width: size }} aria-hidden="true">
      <SatinSquareGrid colours={square.colours} size={size} className="bivariate-square__satin" />
    </span>
  );
}

/**
 * The legend chip for an "A vs B" criterion: its name beside a small colour
 * square, then a key of the three corners the map paints (mostly A, mostly B,
 * many of both: a lens legend always has its key). The full
 * square at reading size is in the Layers card.
 */
export function BivariateLegendCompact({ square, label }: { square: BivariateSquare; label: string }) {
  const last = square.colours.length - 1;
  const keys = [
    { id: "a", colour: square.colours[last][0], text: square.corners.a },
    { id: "b", colour: square.colours[0][last], text: square.corners.b },
    { id: "both", colour: square.colours[last][last], text: square.corners.both },
  ];
  return (
    <span className="map-legend bivariate-legend" data-testid="map-legend">
      <Square square={square} size={28} />
      <span className="bivariate-legend__text">
        <span className="map-legend-caption" data-testid="legend-caption">{label}</span>
        <span className="bivariate-legend__key" data-testid="legend-bivariate-key">
          {keys.map((key) => (
            <span key={key.id}><SatinSquare colour={key.colour} size={10} />{key.text}</span>
          ))}
        </span>
      </span>
      <span className="sr-only">Colour from both counts inside each area; pale: {square.corners.none}.</span>
    </span>
  );
}

/** The same square in the data selector's colour key, with what each corner means. */
export function BivariateLegendDetails({ square, title }: { square: BivariateSquare; title: string }) {
  const corner = (key: keyof BivariateSquare["corners"], colour: string) => (
    <li key={key}><SatinSquare colour={colour} />{square.corners[key]}</li>
  );
  const last = square.colours.length - 1;
  return (
    <div className="legend-details" data-testid="legend-details">
      <p className="legend-details-title">{title}</p>
      <div className="bivariate-details">
        <Square square={square} size={120} />
        <div className="bivariate-axes">
          <span>→ {bivariateAxisText(square, "a")}</span>
          <span>↑ {bivariateAxisText(square, "b")}</span>
        </div>
      </div>
      <ul className="legend-details-bands" aria-label="Corners of the colour square">
        {corner("a", square.colours[last][0])}
        {corner("b", square.colours[0][last])}
        {corner("both", square.colours[last][last])}
        {corner("none", square.colours[0][0])}
      </ul>
      <p className="legend-details-direction">
        Places inside each area's boundary, the shape on the map, so the colours follow the high streets; a café just across the boundary road counts for the neighbouring area. Each side has four shades, one per count range: below London's median is pale on that side, then from the median, the upper quartile and the top tenth it gets stronger. Hover an area for its exact counts.
      </p>
    </div>
  );
}
