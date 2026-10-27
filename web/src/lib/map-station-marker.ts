/**
 * The station marker (DESIGN.md › Map): a neutral circle, never the TfL roundel (a trademark).
 * A centre in the ground colour inside a ring in the line's colour; at an interchange the ring
 * is split into equal segments, one per line, clockwise from twelve o'clock in the data's order.
 * Drawn on a canvas at the screen's pixel ratio and cached per line combination, so it can be
 * drawn synchronously when MapLibre asks for a missing image. Everything about the marker's
 * look lives here, so it can be swapped later (for a licensed roundel, say).
 */
import type { MapImage } from "./map-yarn-images";
import type { ResolvedTheme } from "./ui-themes";

/** The marker's box in CSS pixels at icon-size 1. */
export const STATION_MARKER_PX = 18;
export const STATION_MARKER_PREFIX = "ck-station-";

/** Centre, and the outer hairline that parts pale and dark rings alike from the ground. */
export const STATION_MARKER_THEME: Record<ResolvedTheme, { centre: string; edge: string }> = {
  day: { centre: "#ffffff", edge: "rgba(34, 37, 44, 0.35)" },
  night: { centre: "#1d2944", edge: "rgba(244, 247, 250, 0.55)" },
};

export interface RingSegment { colour: string; start: number; end: number }

/** The image id of a station: its lines, as the data lists them ("central,northern"). */
export function stationMarkerId(lines: string | readonly string[]): string {
  return STATION_MARKER_PREFIX + (typeof lines === "string" ? lines : lines.join(","));
}

/** The lines in a marker id, or null for an id that is not a station marker. */
export function stationMarkerLines(id: string): string[] | null {
  if (!id.startsWith(STATION_MARKER_PREFIX)) return null;
  const lines = id.slice(STATION_MARKER_PREFIX.length).split(",").filter(Boolean);
  return lines.length ? lines : null;
}

/** Equal ring segments, one per colour, clockwise from twelve o'clock (canvas angles, radians). */
export function ringSegments(colours: readonly string[]): RingSegment[] {
  const top = -Math.PI / 2, step = (2 * Math.PI) / Math.max(1, colours.length);
  return colours.map((colour, i) => ({ colour, start: top + i * step, end: top + (i + 1) * step }));
}

/** The part of a 2D canvas context the marker uses (a recording fake in the unit tests). */
export type MarkerContext = Pick<CanvasRenderingContext2D, "beginPath" | "arc" | "stroke" | "fill" | "moveTo" | "lineTo"> & {
  strokeStyle: unknown; fillStyle: unknown; lineWidth: number; lineCap: CanvasLineCap;
};

/** Draws the marker into a `size` × `size` device-pixel box. */
export function drawStationMarker(context: MarkerContext, colours: readonly string[], size: number, theme: ResolvedTheme): void {
  const { centre, edge } = STATION_MARKER_THEME[theme];
  const ratio = size / STATION_MARKER_PX, c = size / 2;
  const hairline = 0.9 * ratio, outer = c - hairline, ring = outer * 0.42, inner = outer - ring;
  context.beginPath();
  context.arc(c, c, outer + hairline / 2, 0, 2 * Math.PI);
  context.strokeStyle = edge;
  context.lineWidth = hairline;
  context.stroke();
  context.lineCap = "butt";
  context.lineWidth = ring;
  const segments = ringSegments(colours);
  for (const segment of segments) {
    context.beginPath();
    context.arc(c, c, outer - ring / 2, segment.start, segment.end);
    context.strokeStyle = segment.colour;
    context.stroke();
  }
  if (segments.length > 1) {
    // Thin dividers, so neighbouring dark lines (Metropolitan, Elizabeth) stay apart.
    context.lineWidth = 0.7 * ratio;
    context.strokeStyle = centre;
    for (const { start } of segments) {
      context.beginPath();
      context.moveTo(c + inner * Math.cos(start), c + inner * Math.sin(start));
      context.lineTo(c + outer * Math.cos(start), c + outer * Math.sin(start));
      context.stroke();
    }
  }
  context.beginPath();
  context.arc(c, c, inner, 0, 2 * Math.PI);
  context.fillStyle = centre;
  context.fill();
}

const cache = new Map<string, MapImage>();

/** The marker's pixels for these line colours at `ratio`, cached; null without a browser canvas. */
export function stationMarkerImage(colours: readonly string[], theme: ResolvedTheme, ratio: number): MapImage | null {
  const key = `${theme}|${ratio}|${colours.join(",")}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const size = Math.round(STATION_MARKER_PX * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  // A CPU canvas: reading pixels back from a GPU one stalls the frame, once per line combination.
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  drawStationMarker(context, colours, size, theme);
  const image = { width: size, height: size, data: context.getImageData(0, 0, size, size).data };
  cache.set(key, image);
  return image;
}
