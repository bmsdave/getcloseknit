import type { ExpressionSpecification } from "maplibre-gl";

// UX-55: the dedicated selected-area treatment. Selection emphasis lives in
// fill opacity and outline width only — the fill-colour expression (metric
// hue) is never branched on selection, and the honesty opacities for
// suppressed/fallback evidence always win over emphasis.
// Strong enough that the colours on the map match the legend swatches over
// the basemap (most areas are "fallback": at 0.46 the top navy read as grey).
const SELECTED_FILL_OPACITY = 0.95;
const OBSERVED_FILL_OPACITY = 0.88;
const FALLBACK_FILL_OPACITY = 0.8;
const SUPPRESSED_FILL_OPACITY = 0.35;

/** Fill opacity for an area's evidence quality (by default its `quality` feature-state). */
export function selectionFillOpacity(
  quality: ExpressionSpecification = ["feature-state", "quality"] as ExpressionSpecification,
): ExpressionSpecification {
  return [
    "case",
    ["==", quality, "suppressed"], SUPPRESSED_FILL_OPACITY,
    ["==", quality, "fallback"], FALLBACK_FILL_OPACITY,
    ["boolean", ["feature-state", "selected"], false], SELECTED_FILL_OPACITY,
    OBSERVED_FILL_OPACITY,
  ] as ExpressionSpecification;
}

/** The selected area's outline: a thick white line over a dark halo (selectionHaloPaint). */
export function selectionOutlinePaint(): {
  "line-color": ExpressionSpecification;
  "line-width": ExpressionSpecification;
} {
  return {
    "line-color": [
      "case",
      ["boolean", ["feature-state", "selected"], false], "#ffffff",
      "#ffffff",
    ] as ExpressionSpecification,
    "line-width": [
      "case",
      ["boolean", ["feature-state", "selected"], false], 3.5,
      // Unselected areas carry no outline: thousands of LSOA edges turn the
      // zoomed-out map white, and neighbouring colours already separate them.
      0,
    ] as ExpressionSpecification,
  };
}

/** The dark halo under the selected area's white outline, so it reads on light and dark colours alike. */
export const SELECTION_HALO_COLOUR = "#22252c";
export function selectionHaloPaint(): {
  "line-color": string;
  "line-width": ExpressionSpecification;
  "line-opacity": number;
} {
  return {
    "line-color": SELECTION_HALO_COLOUR,
    "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 8, 0] as ExpressionSpecification,
    "line-opacity": 0.85,
  };
}

/**
 * A selected district or borough is not one of the drawn areas (the map fills
 * neighbourhoods), so it has its own line layers: the selection's white
 * outline over its dark halo, without feature-state.
 */
export function widerAreaOutlinePaint(): { "line-color": string; "line-width": number } {
  return { "line-color": "#ffffff", "line-width": 3.5 };
}

export function widerAreaHaloPaint(): { "line-color": string; "line-width": number; "line-opacity": number } {
  return { "line-color": SELECTION_HALO_COLOUR, "line-width": 8, "line-opacity": 0.85 };
}
