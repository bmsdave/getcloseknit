"use client";

import { useSyncExternalStore, type CSSProperties } from "react";

import {
  GREEN_STREET_MIN_ZOOM, GREEN_STREET_TOP, STREET_TREE_PALETTES, TREE_DOT_ZOOM, TREE_MIN_ZOOM, canopyLegendColours, greenStreetRamp, treeHeatRamp,
} from "@/lib/map-street-trees";
import { metricGuidePath } from "@/lib/guide-routes";
import type { LayerExplanation } from "@/lib/layer-explainer";
import { findTopic, topicViewNote } from "@/lib/map-topics";
import type { DetailLayerId } from "@/lib/nature-layers";
import { onUiThemeChange, resolvedUiTheme, type ResolvedTheme } from "@/lib/ui-themes";

import { HelpTip } from "./help-tip";
import { RampSatin } from "./ramp-knit";

const serverTheme = (): ResolvedTheme => "day";

/** The theme showing, kept live (the map's own colours follow it). */
function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(onUiThemeChange, resolvedUiTheme, serverTheme);
}

/** The legend's "?" for each detail layer. */
export const DETAIL_ABOUT: Record<DetailLayerId, string> = {
  "green-streets": "Green streets: street trees per 100 m of road, each tree counted for the nearest road within 20 m. "
    + "Grey: no street tree. Council, TfL and Royal Parks trees only (GLA, Nov 2025): private and garden trees are not counted. "
    + "Roads: OS Open Roads 2026. Zoom in to see the streets, then each tree as a dot (Show › Street trees comes on with it).",
  canopy: "Green cover: green seen from space in summer 2025, every 10 m square: trees, gardens (private ones too), grass and parks. "
    + "Deeper green, greener cover (NDVI 0.4 to 0.7+); zoomed out, the share of each spot that is green. "
    + "Contains modified Copernicus Sentinel data (2025).",
};

/** The legend "?" panel (layer-explainer.tsx) for a detail layer: its name, then the rest of DETAIL_ABOUT. */
export function detailExplanation(layer: DetailLayerId): LayerExplanation {
  const text = DETAIL_ABOUT[layer];
  const split = text.indexOf(": ");
  return { name: text.slice(0, split), line: text.slice(split + 2), points: [], guide: metricGuidePath("nature-score") };
}

/**
 * The cover's one line to each tree in its "?" panel: Show › Street trees, while it is off (the Street trees
 * panel links back with "Overview: Green cover"). The legend chip is a button, so the link lives here.
 */
export function detailRelated(layer: DetailLayerId, trees: boolean): { label: string; show: "trees" } | null {
  return layer === "canopy" && !trees ? { label: "Trees: Street trees", show: "trees" } : null;
}

interface Scale {
  colours: string[];
  ends: [string, string];
  label: string;
  /** Below it nothing is drawn: the legend asks to zoom in instead of showing the scale (Green cover draws at every zoom). */
  minZoom: number;
  zoomHint: string;
}

function scaleFor(layer: DetailLayerId, theme: ResolvedTheme): Scale {
  if (layer === "canopy") {
    return { colours: canopyLegendColours(theme), ends: ["Less", "More"],
      label: "Green cover from the satellite: light green for less to deep green for more", minZoom: 0, zoomHint: "" };
  }
  return { colours: greenStreetRamp(STREET_TREE_PALETTES[theme]), ends: ["0", GREEN_STREET_TOP],
    label: `Trees per 100 m of street: grey for none to deep green for ${GREEN_STREET_TOP}`,
    minZoom: GREEN_STREET_MIN_ZOOM, zoomHint: "Zoom in to see the streets" };
}

/** "Green & trees · Green cover": the item and the view, as the Layers menu names them. */
export function detailCaption(layer: DetailLayerId): string {
  const item = findTopic(layer);
  const view = item?.views?.find((entry) => entry.layer === layer);
  return item && view ? `${item.label} · ${view.label}` : layer;
}

/**
 * The legend chip for a view of Green & trees drawn finer than areas: "Green & trees · Green streets" with
 * its one line ("council street trees per 100 m of road"), grey to deep green, 0 … 12+; "Green & trees ·
 * Green cover", Less … More at every zoom. With Street trees on, its key follows. Green streets zoomed out
 * further than it draws (the areas are clear) says to zoom in instead of a scale.
 */
export function DetailLegend({ layer, trees, zoom }: { layer: DetailLayerId; trees: boolean; zoom: number }) {
  const theme = useResolvedTheme();
  const scale = scaleFor(layer, theme);
  const caption = <span className="map-legend-caption" data-testid="legend-caption">{detailCaption(layer)}</span>;
  const note = <span className="map-legend-note map-legend-view-note" data-testid="legend-view-note">{topicViewNote(layer)}</span>;
  if (zoom < scale.minZoom) {
    return (
      <span className="map-legend" data-testid="map-legend" data-legend={layer}>
        {caption}
        <span className="map-legend-zoom" data-testid="legend-zoom-hint">{scale.zoomHint}</span>
      </span>
    );
  }
  return (
    <span className="map-legend" data-testid="map-legend" data-legend={layer}>
      {caption}
      <span className="map-legend-bar" role="img" aria-label={scale.label} data-colours={scale.colours.join(" ")}>
        <RampSatin colours={scale.colours} steps={scale.colours.length} width={320} height={14} className="map-legend-gradient" />
      </span>
      <span className="map-legend-stops">
        <span style={{ left: "0%" }} data-edge="start">{scale.ends[0]}</span>
        <span style={{ left: "100%" }} data-edge="end">{scale.ends[1]}</span>
      </span>
      {note}
      {/* Over Green cover the trees' heat is hidden (it repeats the cover): only the dots' key, from zoom 15.5. */}
      {trees && (layer !== "canopy" || zoom >= TREE_DOT_ZOOM) && <StreetTreesKey zoom={zoom} theme={theme} />}
    </span>
  );
}

/** The tree dots' key: a wider dot is a wider canopy; a hollow one has no size recorded. */
export function TreeKey() {
  const dot = { "--dot": STREET_TREE_PALETTES[useResolvedTheme()].leaf } as CSSProperties;
  return (
    <span className="map-legend-typical tree-key" data-testid="tree-key" style={dot}>
      <span className="tree-key__dot" aria-hidden="true" style={{ width: 7, height: 7 }} />
      <span className="tree-key__dot" aria-hidden="true" style={{ width: 13, height: 13 }} />
      <span>Canopy</span>
      <span className="tree-key__dot tree-key__dot--hollow" aria-hidden="true" />
      <span>Size unknown</span>
    </span>
  );
}

/** Street trees' key at this zoom: the heat's greens "Fewer … More" below zoom 15.5, the dots' key from 15.5. */
export function StreetTreesKey({ zoom, theme }: { zoom: number; theme: ResolvedTheme }) {
  if (zoom >= TREE_DOT_ZOOM) return <TreeKey />;
  const colours = treeHeatRamp(STREET_TREE_PALETTES[theme]);
  return (
    <span className="map-legend-typical tree-heat-key" data-testid="tree-heat-key">
      <span className="tree-heat-key__name">Street trees</span>
      <span>Fewer</span>
      <span className="tree-heat-key__bar" role="img" aria-label="Street trees: light green for fewer to deep green for more" data-colours={colours.join(" ")}>
        <RampSatin colours={colours} steps={colours.length} width={120} height={10} className="map-legend-gradient" />
      </span>
      <span>More</span>
    </span>
  );
}

/**
 * Street trees' key under an area layer's legend (V4-03 board: "Street trees · fewer → more" while it is on),
 * once the map draws them. The phone's one-line chip hides it (the legend keeps only the scale); the
 * Show panel keeps it there.
 */
export function ShowTreesLegend({ zoom }: { zoom: number }) {
  const theme = useResolvedTheme();
  return zoom < TREE_MIN_ZOOM ? null : <StreetTreesKey zoom={zoom} theme={theme} />;
}

/** What Show › Street trees draws at this zoom: nothing below 12, a heat to 15.5, then each tree. */
export function streetTreesZoomNote(zoom: number): string {
  if (zoom < TREE_MIN_ZOOM) return "Zoom in to see the trees. ";
  return zoom < TREE_DOT_ZOOM ? "Zoom in for each tree. " : "";
}

/**
 * Show › Street trees, while on: its key (the heat's greens, or the dots' from zoom 15.5), a word on what it
 * holds, a (?) with the source, the "Street trees (council list)" of the V4-03 board, and the one-line way
 * to the overview of all greenery, Green cover (hidden while it is the layer).
 */
export function StreetTreesPanel({ zoom, cover = false, onCover }: { zoom: number; cover?: boolean; onCover?: () => void }) {
  const theme = useResolvedTheme();
  return (
    <section className="tree-panel" data-testid="street-trees-panel" aria-label="Street trees">
      {(!cover || zoom >= TREE_DOT_ZOOM) && <StreetTreesKey zoom={zoom} theme={theme} />}
      <p className="tree-panel__note">
        {cover && zoom < TREE_DOT_ZOOM ? "Over Green cover: zoom in for each tree. " : streetTreesZoomNote(zoom)}
        Council, TfL and park trees (GLA): no gardens.
        <HelpTip id="street-trees" label="Street trees (council list)" />
      </p>
      {!cover && onCover && (
        <button type="button" className="link-button tree-panel__link" data-testid="street-trees-cover-link" onClick={onCover}>Overview: Green cover</button>
      )}
    </section>
  );
}
