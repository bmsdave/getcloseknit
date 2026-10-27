/*
 * Chart kit for the area panel: small, pure SVG/HTML charts coloured only
 * by the --chart-* tokens (styles/charts.css), so they work in every theme.
 *
 * Conventions:
 * - The root of every chart is role="img". `label` is the subject; charts
 *   with readable values append them ("Flood: High 86%, …"). ScaleMarker
 *   only shows positions, so its label must carry the numbers itself.
 * - null data renders "Unknown" text in place of the chart, never 0.
 * - Single-value charts (ScaleMarker, SegmentScore, Waffle) draw no number:
 *   put the value beside them. RingScore, BarList, StackedBar, IconCount
 *   and DistanceRings show their own numbers.
 * - Demo of every chart and state: /dev/charts (development only).
 */
export type { ChartTone, ScoreDirection } from "@/lib/chart-geometry";
export { formatShare, scalePosition } from "@/lib/chart-geometry";
export { BandScale } from "./band-scale";
export { BarList, type BarRow } from "./bar-list";
export { ChartFrame } from "./chart-frame";
export { ChartUnknown } from "./chart-unknown";
export { DistanceRings, type RingPlace } from "./distance-rings";
export { CHART_ICON_NAMES, ChartIcon, IconCount } from "./icon-count";
export { RingScore } from "./ring-score";
export { ScaleMarker } from "./scale-marker";
export { SegmentScore } from "./segment-score";
export { StackedBar, StackedRows, type StackedPart, type StackedRow } from "./stacked-bar";
export { Waffle } from "./waffle";
