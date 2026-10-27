/**
 * Show › Schools map icons (board V4-01c-school-one-channel): the sun-yellow mortarboard with a
 * white halo, one visual channel per fact and no channel carrying two:
 * - Ofsted → the colour of the cap's top only (no marks): Outstanding green, Good blue, Requires
 *   improvement amber, Inadequate red, report card grey, not inspected plain sun.
 * - Phase → a letter on the band only: P primary, S secondary, PS all-through.
 * - Funding → the body colour only: state sun yellow; private ink body with a white top (no Ofsted).
 * - England rank (latest year) → an award plaque on the cap's top-right only, with its tier number: Top 25% Silver,
 *   10% Gold, 5% Diamond, 3% Red Diamond, 1% Ruby; none below Top 25%.
 * Every marker is the same 36 px and shows all of this at every zoom (at 24 px the letters and the
 * plaque numbers were 8–9 px and could not be made out; now ≥ 11 px); density is handled by placement
 * only (lib/map-school-layer.ts folds what would overlap into "+N"). Selectivity and faith are never on
 * the icon (popup tags only).
 *
 * Pure SVG markup: the cap on a 32-unit grid (36 px) inside a 56-unit canvas so the plaque has room,
 * rasterised once per combination for map.addImage (lib/map-yarn-images.ts); the Show legend, the popup
 * and the school pages draw the same markup, so they match the map. The map paints hex, not tokens
 * (DESIGN.md › Map marker colours).
 */
import { putImage, rasterise, type MapImage } from "./map-yarn-images";

export type SchoolStage = "primary" | "secondary" | "all-through";
export type SchoolKind = "state" | "independent";
export type OfstedMark = "outstanding" | "good" | "requires-improvement" | "inadequate" | "report-card";
/** England rank tiers (Top %), best last. */
export type RankTier = 25 | 10 | 5 | 3 | 1;

export interface SchoolIcon {
  kind: SchoolKind;
  stage: SchoolStage;
  /** State only; null = not inspected (a plain sun top). */
  ofsted: OfstedMark | null;
  /** State only: the England rank's award (the page's "top x%"). */
  tier: RankTier | null;
  /** Coloured by a measure (Schools filter v2, option 4): its step 0 light … 3 dark, or null without a value
   * (a white top, the marker faded); absent = the Ofsted colours. */
  measure?: MeasureStep | null;
}

export type MeasureStep = 0 | 1 | 2 | 3;
/** The cap top per measure step, light to dark: one-hue blues (no red–green), apart from the sun body. */
export const MEASURE_COLOUR: readonly [string, string, string, string] = ["#c6dbef", "#6baed6", "#2171b5", "#08306b"];
/** No value for the measure: a white top. */
export const MEASURE_NONE_COLOUR = "#ffffff";

/** The canvas (units) the icon is drawn on; the cap is the middle 32 units (SCHOOL_CAP_PX). */
export const SCHOOL_ICON_UNITS = 56;
const CAP_UNITS = 32;
/** The cap on the map, CSS px: its canvas (and so its hover and tap area) is 56 units = 63 px. */
export const SCHOOL_CAP_PX = 36;
/** On-screen pixels per unit: 32 units = SCHOOL_CAP_PX. */
export const SCHOOL_ICON_SCALE = SCHOOL_CAP_PX / CAP_UNITS;
/** The phase letter's font size in cap units: P or S, and PS (14.1 and 12.4 px on the map). */
export const STAGE_LETTER_UNITS = { one: 12.5, two: 11 } as const;
/** The canvas offset of the 32-unit cap grid. */
const AT = (SCHOOL_ICON_UNITS - CAP_UNITS) / 2;

export const OFSTED_LABEL: Record<OfstedMark, string> = {
  outstanding: "Outstanding", good: "Good", "requires-improvement": "Requires improvement", inadequate: "Inadequate",
  "report-card": "Report card",
};
export const STAGE_LABEL: Record<SchoolStage, string> = { primary: "Primary", secondary: "Secondary", "all-through": "All-through" };
export const STAGE_LETTER: Record<SchoolStage, string> = { primary: "P", secondary: "S", "all-through": "PS" };

const SUN = "#f6c445";
const INK = "#22252c";
const HALO = "#ffffff";
/** The cap top per Ofsted grade (Okabe–Ito based, checked under deuteranopia and protanopia on V4-01c). */
export const OFSTED_COLOUR: Record<OfstedMark, string> = {
  outstanding: "#009e73", good: "#0072b2", "requires-improvement": "#b8860b", inadequate: "#c0352c", "report-card": "#5b6270",
};
/** Not inspected: the plain sun top. */
export const NOT_INSPECTED_COLOUR = SUN;

export const RANK_TIERS: readonly RankTier[] = [25, 10, 5, 3, 1];
export const TIER_NAME: Record<RankTier, string> = { 25: "Silver", 10: "Gold", 5: "Diamond", 3: "Red Diamond", 1: "Ruby" };
const TIER_STYLE: Record<RankTier, { fill: string; text: string; shape: "coin" | "diamond" | "ruby"; ring?: string }> = {
  25: { fill: "#d5dbe3", text: INK, shape: "coin", ring: HALO },
  // Ink on the light fills (white on Gold was 2.95:1, on Diamond 2.38:1), white on the dark ones: each ≥ 4:1.
  10: { fill: "#c98a00", text: INK, shape: "coin", ring: "#7a4f00" },
  5: { fill: "#5fb0e6", text: INK, shape: "diamond" },
  3: { fill: "#e2453c", text: HALO, shape: "diamond" },
  1: { fill: "#9a1b4b", text: HALO, shape: "ruby" },
};
/** The plaque number's colour per tier (tests check it against the fill). */
export const TIER_TEXT: Record<RankTier, string> = Object.fromEntries(RANK_TIERS.map((tier) => [tier, TIER_STYLE[tier].text])) as Record<RankTier, string>;
/** The plaque's fill per tier (legend swatches). */
export const TIER_COLOUR: Record<RankTier, string> = { 25: "#d5dbe3", 10: "#c98a00", 5: "#5fb0e6", 3: "#e2453c", 1: "#9a1b4b" };

const CAP_TOP = "m2.5 9.5 9.5-5 9.5 5-9.5 5Z";
const CAP_BODY = "M6.5 11.6V16c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3v-4.4L12 14.5Z";
const CAP_AT = `transform="translate(16 17) scale(1.22) translate(-12 -11.75)"`;
const FONT = `font-family="Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif" font-weight="800"`;

/** The award for an England Top %: 1, 3, 5, 10 or 25 (the band holds the exact figure); none below Top 25%. */
export function rankTier(topPercent: number | null | undefined): RankTier | null {
  if (typeof topPercent !== "number" || topPercent <= 0) return null;
  return [...RANK_TIERS].reverse().find((tier) => topPercent <= tier) ?? null;
}

/**
 * One number per look, ordered by placement priority (higher wins where caps would overlap):
 * Ruby > Red Diamond > Diamond > Gold > Silver > Outstanding > the rest. It names the image too, so a "+N"
 * fold can draw its best school's cap from the max of its members' codes.
 */
export function schoolIconCode(icon: SchoolIcon): number {
  const tier = icon.kind === "state" && icon.tier ? RANK_TIERS.indexOf(icon.tier) + 1 : 0;  // 25 → 1 … 1 → 5
  const ofsted = icon.kind === "state" && icon.ofsted
    ? ({ outstanding: 6, good: 5, "requires-improvement": 4, "report-card": 3, inadequate: 2 } as const)[icon.ofsted] : 1;
  const stage = { primary: 1, secondary: 2, "all-through": 3 }[icon.stage];
  // By a measure: its step leads (none 1, steps 2-5), above every Ofsted look.
  const step = icon.measure === undefined ? 0 : icon.measure === null ? 1 : icon.measure + 2;
  return step * 10000 + tier * 1000 + ofsted * 100 + stage * 10 + (icon.kind === "state" ? 2 : 1);
}

export function schoolIconId(icon: SchoolIcon): string {
  return `school-${schoolIconCode(icon)}`;
}

function capMarkup(icon: SchoolIcon): string {
  const independent = icon.kind === "independent";
  const top = independent ? HALO
    : icon.measure !== undefined ? (icon.measure === null ? MEASURE_NONE_COLOUR : MEASURE_COLOUR[icon.measure])
      : icon.ofsted ? OFSTED_COLOUR[icon.ofsted] : SUN;
  const body = independent ? INK : SUN;
  const letter = STAGE_LETTER[icon.stage];
  const [fill, edge] = independent ? [HALO, INK] : [INK, HALO];
  return `<g ${CAP_AT} fill="none" stroke="${HALO}" stroke-width="2.6" stroke-linejoin="round"><path d="${CAP_TOP}"/><path d="${CAP_BODY}"/></g>`
    // The ink contour (1.3 px) is what parts a sun cap from the snow Day map (sun on snow is only 1.5:1).
    + `<g ${CAP_AT} stroke="${INK}" stroke-width="1" stroke-linejoin="round"><path d="${CAP_BODY}" fill="${body}"/><path d="${CAP_TOP}" fill="${top}"/></g>`
    + `<text x="16" y="25.2" text-anchor="middle" ${FONT} font-size="${letter.length > 1 ? STAGE_LETTER_UNITS.two : STAGE_LETTER_UNITS.one}" letter-spacing="-0.4" `
    + `fill="${fill}" stroke="${edge}" stroke-width="2.4" stroke-linejoin="round" paint-order="stroke">${letter}</text>`;
}

/** The award plaque (23 px at the 36 px cap, its number 11.9–12.9 px): shape + colour + the tier number, dark outline, white halo. */
export function plaqueMarkup(tier: RankTier): string {
  const { fill, text, shape, ring } = TIER_STYLE[tier];
  const number = (y: number, size: number) => `<text x="9.3" y="${y}" text-anchor="middle" ${FONT} font-size="${size}" letter-spacing="-0.3" `
    + `fill="${text}" stroke="${text === INK ? HALO : INK}" stroke-width="1.45" stroke-linejoin="round" paint-order="stroke">${tier}</text>`;
  const outline = (d: string) => `<path d="${d}" fill="${HALO}" stroke="${HALO}" stroke-width="5.19" stroke-linejoin="round"/>`
    + `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="1.04" stroke-linejoin="round"/>`;
  let body: string;
  if (shape === "coin") {
    const disc = "M0.7 9.3a8.6 8.6 0 1 0 17.2 0a8.6 8.6 0 1 0-17.2 0Z";
    body = outline(disc)
      + `<path d="M4.2 7.2a5.6 5.6 0 0 1 4.6-3.6" fill="none" stroke="${HALO}" stroke-width="1.8" stroke-linecap="round" opacity="0.9"/>`
      + `<circle cx="9.3" cy="9.3" r="6.8" fill="none" stroke="${ring}" stroke-opacity="${tier === 25 ? 0.45 : 0.5}" stroke-width="0.9"/>`
      + number(12.75, 9.6);
  } else if (shape === "diamond") {
    body = outline("M4.3 1.6h10l4.3 5.2-9.3 10.8L0 6.8Z")
      + `<path d="M0 6.8h18.6M4.3 1.6l3 5.2 2 10.8M14.3 1.6l-3 5.2-2 10.8" fill="none" stroke="${HALO}" stroke-opacity="0.75" stroke-width="0.9"/>`
      + number(11.45, 10.4);
  } else {
    body = outline("M3.5 1.5l3 2.4 2.8-3 2.8 3 3-2.4 3.5 6-9.3 10.3L0 7.5Z")
      + `<path d="M0 7.5h18.6M6.5 3.9l2.8 13.9M12.1 3.9l-2.8 13.9" fill="none" stroke="${HALO}" stroke-opacity="0.55" stroke-width="0.9"/>`
      + number(11.45, 10.4);
  }
  // Smaller than the cap and further out (it used to hide a third of the Ofsted top); its number ≥ 11 px.
  return `<g transform="translate(19.5 -6.5) scale(1.1)">${body}</g>`;
}

/** The icon's markup on the 32-unit cap grid (the plaque reaches past its top-right corner). */
export function schoolCapMarkup(icon: SchoolIcon): string {
  const ranked = icon.kind === "state" && icon.tier;
  return capMarkup(icon) + (ranked ? plaqueMarkup(icon.tier!) : "");
}

/** The icon's markup on its 56-unit canvas, the cap in the middle. */
export function schoolIconMarkup(icon: SchoolIcon): string {
  return `<g transform="translate(${AT} ${AT})">${schoolCapMarkup(icon)}</g>`;
}

/** The Ofsted swatch beside words (popup, legend, school rows, school page): the cap's top in the grade's colour. */
export const OFSTED_SWATCH_VIEWBOX = "0 0 24.4 13";
export function ofstedSwatchMarkup(mark: OfstedMark | null): string {
  const colour = mark ? OFSTED_COLOUR[mark] : SUN;
  return `<g transform="translate(-1.6 -4.4) scale(1.15)"><path d="${CAP_TOP}" fill="${colour}" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/></g>`;
}

/** Words for the icon (legend and screen readers). */
export function schoolIconLabel(icon: SchoolIcon): string {
  const state = icon.kind === "state";
  return [STAGE_LABEL[icon.stage], state ? "state" : "private",
    state && icon.measure === undefined ? (icon.ofsted ? `Ofsted ${OFSTED_LABEL[icon.ofsted]}` : "not inspected") : null,
    state && icon.tier ? `top ${icon.tier}% in England (${TIER_NAME[icon.tier]})` : null].filter(Boolean).join(", ");
}

type ImageMap = Parameters<typeof putImage>[0];

/** Adds the icons not yet on the map (drawn asynchronously); resolves once all are in. */
export async function addSchoolIcons(map: ImageMap, icons: readonly SchoolIcon[], pixelRatio: number): Promise<void> {
  const ratio = Math.max(1, Math.ceil(pixelRatio));
  const wanted = new Map(icons.map((icon) => [schoolIconId(icon), icon]));
  await Promise.all([...wanted].filter(([id]) => !map.hasImage(id)).map(async ([id, icon]) => {
    const image: MapImage | null = await rasterise(schoolIconMarkup(icon), SCHOOL_ICON_UNITS, ratio * SCHOOL_ICON_SCALE);
    if (image && !map.hasImage(id)) putImage(map, id, image, ratio);
  }));
}

// ---- "+N" folds ---------------------------------------------------------------------------------------

export const SCHOOL_FOLD_PREFIX = "school-fold-";

/**
 * A fold bubble ("+3"): a white pill with an ink edge, a mini cap (the layer's glyph) and
 * the count, drawn on a canvas at once so MapLibre's styleimagemissing can add it synchronously.
 * null without a browser.
 */
export function drawSchoolFold(count: number, ratio: number): MapImage | null {
  if (typeof document === "undefined" || typeof Path2D === "undefined") return null;
  const label = `+${count}`;
  const height = 22;
  const width = Math.max(37, 25 + label.length * 8.5);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(ratio, ratio);
  const r = height / 2 - 0.75;
  context.beginPath();
  context.moveTo(0.75 + r, 0.75);
  context.arcTo(width - 0.75, 0.75, width - 0.75, height - 0.75, r);
  context.arcTo(width - 0.75, height - 0.75, 0.75, height - 0.75, r);
  context.arcTo(0.75, height - 0.75, 0.75, 0.75, r);
  context.arcTo(0.75, 0.75, width - 0.75, 0.75, r);
  context.closePath();
  context.fillStyle = HALO;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = INK;
  context.stroke();
  context.save();
  context.translate(3.5, 2.6);
  context.scale(0.68, 0.68);
  context.fillStyle = SUN;
  context.strokeStyle = INK;
  context.lineWidth = 1.6;
  context.lineJoin = "round";
  for (const d of [CAP_BODY, CAP_TOP]) {
    const path = new Path2D(d);
    context.fill(path);
    context.stroke(path);
  }
  context.restore();
  context.fillStyle = INK;
  context.font = `800 13px "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif`;
  context.textBaseline = "middle";
  context.fillText(label, 21, height / 2 + 0.5);
  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}
