/**
 * The map's own pictures in the house style (DESIGN.md › Map): place badges as
 * embroidered patches (felt disc, running-stitch ring, plied-yarn icon). Each
 * is SVG markup from the same code as the UI (lib/thread-icons.ts), rasterised once for
 * map.addImage. Pure markup builders are unit-testable; rasterising needs a
 * browser.
 */
import { tone } from "./knit";
import { THREAD_ICONS } from "./thread-icons";

export interface MapImage { width: number; height: number; data: Uint8ClampedArray }
type ImageMap = {
  hasImage(id: string): boolean;
  addImage(id: string, image: MapImage, options?: { pixelRatio?: number }): void;
  updateImage?(id: string, image: MapImage): void;
};

/** A plied-yarn icon (as KnitIcon draws it) on a 24-unit grid. */
export function yarnIconMarkup(path: string, colour: string, width = 2.4): string {
  const dash = "0.85 1.05";
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="${path}" stroke="${tone(colour, -0.55)}" stroke-width="${width + 0.7}" opacity=".25" transform="translate(0 .6)"/>`
    + `<path d="${path}" stroke="${colour}" stroke-width="${width}"/>`
    + `<path d="${path}" stroke="${tone(colour, -0.35)}" stroke-width="${width * 0.92}" stroke-dasharray="${dash}" opacity=".45"/>`
    + `<path d="${path}" stroke="${tone(colour, 0.45)}" stroke-width="${width * 0.26}" stroke-dasharray="${dash}" stroke-dashoffset=".95" opacity=".55" transform="translate(-.28 -.28)"/></g>`;
}

/**
 * A place badge as an embroidered patch, 26 units: a felt disc in the group's
 * colour with a darker contour, a running-stitch ring just inside the edge,
 * and the group's icon in white plied yarn.
 */
export function placeBadgeSvg(colour: string, icon: string): string {
  const path = THREAD_ICONS[icon] ?? THREAD_ICONS["place-other"];
  return `<circle cx="13" cy="13.6" r="12" fill="#000" opacity=".18"/>`
    + `<circle cx="13" cy="13" r="12" fill="${colour}" stroke="${tone(colour, -0.38)}" stroke-width="1"/>`
    + `<circle cx="13" cy="13" r="9.6" fill="none" stroke="#ffffff" stroke-width="1.1" stroke-dasharray="2.2 1.7" stroke-linecap="round" opacity=".8"/>`
    + `<g transform="translate(6.4 6.4) scale(.55)">${yarnIconMarkup(path, "#ffffff", 2.7)}</g>`;
}

/** Rasterises markup drawn in a `px` box into RGBA pixels at `ratio`. null without a browser. */
export async function rasterise(markup: string, px: number, ratio: number): Promise<MapImage | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const size = Math.round(px * ratio);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${px} ${px}" overflow="visible">${markup}</svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try { await image.decode(); } catch { return null; }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);
  return { width: size, height: size, data: context.getImageData(0, 0, size, size).data };
}

/** Adds an image, or replaces it (a theme change redraws it). */
export function putImage(map: ImageMap, id: string, image: MapImage, ratio: number): void {
  if (map.hasImage(id)) map.updateImage?.(id, image);
  else map.addImage(id, image, { pixelRatio: ratio });
}
