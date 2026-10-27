/**
 * A ranking's top 10 on the map (CUJ-05 / CUJ-10 v4 boards, step B2): the ranking page's "On map ↗" opens
 * /?layer=…&rank=<slug>&period=…, and the map numbers its first ten areas with a small card ("Most expensive ·
 * Top 10 ✕ · Full ranking ›"). The link's layer and period win over the saved setup.
 */
import type { GeographyId } from "./contracts";

export const RANK_PARAM = "rank";
export const RANKING_TOP_SIZE = 10;

export interface RankingTopRow {
  rank: number;
  geographyId: GeographyId;
  name: string;
  /** The ranking's own figure, as its page shows it ("£17,900/m²"). */
  display: string;
  /** Where its pin goes ([longitude, latitude]); null when unknown (listed, not pinned). */
  center: [number, number] | null;
}

export interface RankingTopResponse {
  schemaVersion: "ranking-top.v1";
  slug: string;
  /** The page's title ("Most expensive areas"). */
  title: string;
  rows: RankingTopRow[];
}

/** The ranking a map address asks for (?rank=most-expensive), or null. */
export function rankParam(search: string): string | null {
  const slug = new URLSearchParams(search).get(RANK_PARAM);
  return slug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null;
}

/** The centre of a shape's bounding box ([longitude, latitude]): a pin's place when the API has no centre. */
export function boxCenter(coordinates: unknown): [number, number] | null {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (value: unknown): void => {
    if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") {
      box[0] = Math.min(box[0], value[0]); box[1] = Math.min(box[1], value[1]);
      box[2] = Math.max(box[2], value[0]); box[3] = Math.max(box[3], value[1]);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    }
  };
  visit(coordinates);
  return Number.isFinite(box[0]) ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
}

/** The card's short name: "Most expensive areas" → "Most expensive"; "Areas with the least recorded crime" → "Least recorded crime". */
export function rankingShortTitle(title: string): string {
  const short = title.replace(/^Areas (with the|closest to|whose) /i, (_, words: string) => (words.toLowerCase() === "closest to" ? "Closest to " : ""))
    .replace(/ areas$/i, "");
  return short.charAt(0).toUpperCase() + short.slice(1);
}
