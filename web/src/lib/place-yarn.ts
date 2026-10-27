/**
 * The yarn on the map (DESIGN.md › Map rules): a household place is an ink teardrop pin with a white glyph
 * for its type (no cherry, sun or tangerine dots that read as collisions or school caps), the
 * type read from the label the household gave it; routes are yarn in the colour of their mode.
 * Colour never encodes a score, and every pin is one size.
 */
import { deepen } from "./knit";
import { yarnIconMarkup } from "./map-yarn-images";
import { THREAD_ICONS } from "./thread-icons";

export type PlaceKind = "work" | "school" | "gym" | "family" | "other";

/** The pin's glyph per type (thread icons). */
export const MY_PLACE_GLYPH: Record<PlaceKind, string> = {
  work: "briefcase", school: "school", gym: "barbell", family: "family", other: "heart",
};

/** The pin itself: DS ink with a white edge, the same in Day and Night (the white edge carries it on Night). */
export const MY_PLACE_INK = "#22252c";

const KIND_WORDS: [PlaceKind, RegExp][] = [
  ["work", /\b(work|works|office|job|workplace|hq|headquarters|commute)\b/i],
  ["school", /\b(school|nursery|college|uni|university|campus|kindergarten|academy)\b/i],
  ["gym", /\b(gym|fitness|pool|swim|swimming|yoga|pilates|crossfit|climbing|leisure)\b/i],
  ["family", /\b(family|friend|friends|mum|mom|mother|dad|father|parents?|grand(?:ma|pa|parents?)|gran|granny|nan|nana|sister|brother|sibling|partner|in-laws|aunt|uncle|cousin)\b/i],
];

/** A place's type from its label ("Work", "Kids' school", "Mum's"): the first matching kind, else "other". */
export function placeKind(label: string): PlaceKind {
  const text = label.replace(/['’]s\b/g, "");
  return KIND_WORDS.find(([, words]) => words.test(text))?.[0] ?? "other";
}

const PIN = "M12 29s-9.5-9-9.5-16.5a9.5 9.5 0 0 1 19 0C21.5 20 12 29 12 29Z";

/** An ink teardrop pin (24 × 30 px) with the place type's glyph in white plied yarn. Our own markup. */
export function myPlacePinMarkup(label: string): string {
  const kind = placeKind(label);
  const glyph = THREAD_ICONS[MY_PLACE_GLYPH[kind]] ?? THREAD_ICONS["place-other"];
  return `<svg class="knit-pin" width="24" height="30" viewBox="0 0 24 30" aria-hidden="true" data-kind="${kind}" overflow="visible">`
    + `<path d="${PIN}" fill="${MY_PLACE_INK}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<g transform="translate(5.4 5.9) scale(0.55)">${yarnIconMarkup(glyph, "#ffffff", 2.6)}</g></svg>`;
}

/** Route yarn by mode: transit cherry, cycle sky (as the cycle lanes), car cobalt. Walking is a cherry running stitch. */
export const ROUTE_YARN = { transit: "#e2453c", cycle: "#4aa3df", car: "#2f5bd3", walk: "#e2453c" } as const;

/** The darker shade of a yarn for its outline and its ply twist. */
export const yarnShade = (colour: string, k = -0.38): string => deepen(colour, k);
