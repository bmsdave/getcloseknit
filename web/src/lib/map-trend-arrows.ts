import type { ExpressionSpecification, SymbolLayerSpecification } from "maplibre-gl";

import { tone } from "./knit";
import { THREAD_ICONS } from "./thread-icons";

/**
 * Rise/fall markers over each area in the Change scale: the "rise" and "fall"
 * thread icons (DESIGN.md › Icons), drawn as map images, never a font glyph.
 * Symbol layout cannot read feature-state, so there is one layer per direction
 * with a fixed icon and the per-area percent (feature-state `value`) decides
 * its opacity.
 */
export const TREND_ARROW_UP_LAYER = "trend-arrows-up";
export const TREND_ARROW_DOWN_LAYER = "trend-arrows-down";
export const TREND_ARROW_LAYER_IDS = [TREND_ARROW_UP_LAYER, TREND_ARROW_DOWN_LAYER] as const;
/** Arrows appear only where individual areas are large enough to carry one. */
export const TREND_ARROW_MIN_ZOOM = 13;
/** Changes smaller than this (in percent) count as flat and get no arrow. */
export const TREND_FLAT_PERCENT = 0.5;

const RISING_INK = "#7f3b08";
const FALLING_INK = "#2d004b";
const HALO = "#ffffff";
/** Icon box in CSS pixels (the icon's 24-unit grid). */
const ICON_PX = 20;
const YARN = 2.3;

const ICONS = {
  up: { id: "trend-rise", path: THREAD_ICONS.rise, colour: RISING_INK },
  down: { id: "trend-fall", path: THREAD_ICONS.fall, colour: FALLING_INK },
} as const;

function opacityWhen(test: ExpressionSpecification): ExpressionSpecification {
  return ["case", ["==", ["feature-state", "value"], null], 0, test, 1, 0] as ExpressionSpecification;
}

/** The rise/fall arrows on one kind's area tiles (`source`, `sourceLayer`), over each area's feature-state value. */
export function trendArrowLayers(source: string, sourceLayer: string): SymbolLayerSpecification[] {
  const value: ExpressionSpecification = ["to-number", ["feature-state", "value"], 0];
  const arrow = (id: string, icon: string, test: ExpressionSpecification): SymbolLayerSpecification => ({
    id,
    type: "symbol",
    source, "source-layer": sourceLayer,
    minzoom: TREND_ARROW_MIN_ZOOM,
    layout: {
      visibility: "none",
      "icon-image": icon,
      // Sit above the area name so the two never cover each other.
      "icon-offset": [0, -21],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-opacity": opacityWhen(test),
    },
  });
  return [
    arrow(TREND_ARROW_UP_LAYER, ICONS.up.id, [">=", value, TREND_FLAT_PERCENT] as ExpressionSpecification),
    arrow(TREND_ARROW_DOWN_LAYER, ICONS.down.id, ["<=", value, -TREND_FLAT_PERCENT] as ExpressionSpecification),
  ];
}

/**
 * A direction's thread icon as RGBA pixels for map.addImage: a white halo, then
 * the yarn as KnitIcon lays it (shadow, body, twist, highlight). null where
 * there is no canvas (server, tests).
 */
export function trendIconImage(direction: "up" | "down", pixelRatio: number): { width: number; height: number; data: Uint8ClampedArray } | null {
  if (typeof document === "undefined") return null;
  const { path, colour } = ICONS[direction];
  const size = Math.round(ICON_PX * pixelRatio);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(size / 24, size / 24);
  context.lineCap = "round";
  context.lineJoin = "round";
  const line = new Path2D(path);
  const stroke = (style: string, width: number, { alpha = 1, dash = [] as number[], offset = 0, dx = 0, dy = 0 } = {}) => {
    context.save();
    context.translate(dx, dy);
    context.globalAlpha = alpha;
    context.setLineDash(dash);
    context.lineDashOffset = offset;
    context.strokeStyle = style;
    context.lineWidth = width;
    context.stroke(line);
    context.restore();
  };
  stroke(HALO, YARN + 3);
  stroke(tone(colour, -0.55), YARN + 0.7, { alpha: 0.22, dy: 0.6 });
  stroke(colour, YARN);
  stroke(tone(colour, -0.35), YARN * 0.92, { alpha: 0.5, dash: [0.85, 1.05] });
  stroke(tone(colour, 0.45), YARN * 0.26, { alpha: 0.55, dash: [0.85, 1.05], offset: 0.95, dx: -0.28, dy: -0.28 });
  return { width: size, height: size, data: context.getImageData(0, 0, size, size).data };
}

/** Adds the two icons to a map once; a map whose style was replaced gets them again. */
export function addTrendIcons(map: { hasImage(id: string): boolean; addImage(id: string, image: { width: number; height: number; data: Uint8ClampedArray }, options?: { pixelRatio?: number }): void }, pixelRatio: number): void {
  const ratio = Math.max(1, Math.ceil(pixelRatio));
  for (const direction of ["up", "down"] as const) {
    if (map.hasImage(ICONS[direction].id)) continue;
    const image = trendIconImage(direction, ratio);
    if (image) map.addImage(ICONS[direction].id, image, { pixelRatio: ratio });
  }
}

/** Which arrow an area gets for a percent change: "up", "down" or none. */
export function trendArrow(percent: number | null): "up" | "down" | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  if (percent >= TREND_FLAT_PERCENT) return "up";
  if (percent <= -TREND_FLAT_PERCENT) return "down";
  return null;
}
