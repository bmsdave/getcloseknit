/**
 * Map padding that keeps a camera target in the part of the map a visitor
 * can see: below the top bar, left of the desktop side panel, above the
 * phone bottom sheet. Measured from the two blocks (styles/layout.css) at the
 * moment of the move, so it follows the dock's state. Pure on rectangles so
 * the arithmetic is unit-testable; `visiblePadding` reads the DOM.
 */

import { isPhone } from "./viewport";

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/** Matches the phone breakpoint in styles/layout.css. */
export const PHONE_MAX_WIDTH = 800;
/** Never pad the map down to less than this many pixels of visible map each way. */
export const MIN_VISIBLE_PX = 120;

/**
 * Padding for a map frame given the top bar and the dock: the side panel's
 * width on desktop, the sheet's visible height on phones, plus `gap`. When
 * space is short the gaps give way first, so a target stays clear of the
 * sheet (markers would otherwise sit under its edge); only then do the
 * covered blocks, so at least MIN_VISIBLE_PX of map stays between opposite
 * paddings (a sheet pulled up to full height would otherwise leave MapLibre
 * nothing to fit in).
 */
export function paddingFor(frame: Rect, bar: Rect | null, dock: Rect | null, gap = 24, phone = frame.width <= PHONE_MAX_WIDTH): Padding {
  const top = bar ? Math.max(0, bar.bottom - frame.top) : 0;
  // A phone on its side (the short layout, lib/viewport.ts) has a side panel, not a bottom sheet.
  const desktop = !!dock && !phone;
  const right = dock && desktop ? Math.max(0, frame.right - dock.left) : 0;
  const bottom = dock && !desktop ? Math.max(0, frame.bottom - dock.top) : 0;
  const [padTop, padBottom] = fitAxis(top, bottom, gap, frame.height);
  const [padLeft, padRight] = fitAxis(0, right, gap, frame.width);
  return { top: padTop, bottom: padBottom, left: padLeft, right: padRight };
}

/** Two opposite paddings (covered extents `low` and `high`) plus `gap` each, fitted into `size`. */
function fitAxis(low: number, high: number, gap: number, size: number): [number, number] {
  const room = size - MIN_VISIBLE_PX;
  const spare = room - low - high;
  if (spare >= 2 * gap) return [low + gap, high + gap];
  if (spare >= 0) return [low + spare / 2, high + spare / 2];
  const first = Math.max(0, Math.min(low, room / 2));
  return [first, Math.max(0, room - first)];
}

type Bounds = [[number, number], [number, number]];

/**
 * The pan limit for a map `width` px wide. On phones the bottom sheet covers
 * most of the map, so London has to be able to sit in the strip above it:
 * the limit reaches one London-height further south (else a fit to London
 * pins the camera with Hertfordshire in view). Desktop keeps the bounds.
 */
export function panBounds(bounds: Bounds, width: number, phone = width <= PHONE_MAX_WIDTH): Bounds {
  if (!phone) return bounds;
  const [[west, south], [east, north]] = bounds;
  return [[west, south - (north - south)], [east, north]];
}

/** The same clearance as an easeTo offset: padding passed to easeTo would
 * persist on the map and shift every centre it reports afterwards. */
export function paddingOffset(padding: Padding): [number, number] {
  return [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2];
}

/** paddingFor the map container, the top bar (and the chips under it) and the dock as they are on screen now. */
export function visiblePadding(container: HTMLElement, gap = 24): Padding {
  const rect = (selector: string) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    // A hidden block (display: none) measures 0×0 at the origin: it covers nothing.
    return box && box.width > 0 && box.height > 0 ? box : null;
  };
  // The "Explore:" chips sit just under the top bar: the map's visible top is below them.
  const top = rect("[data-block='explore']") ?? rect("[data-block='top-bar']");
  return paddingFor(container.getBoundingClientRect(), top, restingDock(rect("[data-block='map-dock']")), gap, isPhone());
}

/**
 * The phone sheet where it rests: while it slides to a new snap its transform
 * still carries it from the last one, so a camera move started then (a search
 * raising the sheet) pads for where it will stop. A finger-held sheet is where it shows.
 */
function restingDock(box: DOMRect | null): Rect | null {
  const dock = document.querySelector<HTMLElement>("[data-block='map-dock']");
  if (!box || !dock || dock.dataset.dragging) return box;
  const transform = getComputedStyle(dock).transform;
  const shift = transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
  return shift ? { ...box.toJSON(), top: box.top - shift, bottom: box.bottom - shift } : box;
}
