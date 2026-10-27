/**
 * Which schools My match labels on the map around the selected area (components/match/match-overlays.tsx).
 * A selection must never switch on dozens of overlapping names (final prod check: zoom 12 after a
 * Top-10 row): the best few further out, the nearest few close in.
 */
import type { BriefSchool } from "./brief-model";

/** Schools you didn't ask about still show when outstanding and this close to the selected area (close in only). */
const HIGHLIGHT_METRES = 800;
const MAX_HIGHLIGHTS = 2;
/** Schools the search asks for, before the map is zoomed in: the best few only. */
export const ASKED_FAR = 3;
/** ...and zoomed in, the nearest of them. */
export const ASKED_NEAR = 8;
const TIER_ORDER: readonly string[] = ["outstanding", "good", "requires-improvement", "inadequate", "unknown"];

/**
 * The school labels drawn for the selected area. Asked for (a criterion): close in the nearest ASKED_NEAR,
 * further out the best ASKED_FAR (the best grade, then the nearest). Not asked: the outstanding highlights, close in.
 */
export function labelledSchools(schools: readonly BriefSchool[], asked: boolean, closeIn: boolean, center: [number, number] | null): BriefSchool[] {
  if (!asked) return closeIn ? highlights(schools, center) : [];
  const far = (school: BriefSchool) => (center ? metresBetween(center, [school.longitude, school.latitude]) : 0);
  const ranked = schools.map((school) => ({ school, metres: far(school), tier: TIER_ORDER.indexOf(school.grade.tier) }));
  return (closeIn
    ? ranked.sort((left, right) => left.metres - right.metres).slice(0, ASKED_NEAR)
    : ranked.sort((left, right) => left.tier - right.tier || left.metres - right.metres).slice(0, ASKED_FAR))
    .map((entry) => entry.school);
}

/** Outstanding schools within a short walk of the selected area, nearest first, at most two. */
export function highlights(schools: readonly BriefSchool[], center: [number, number] | null): BriefSchool[] {
  if (!center) return [];
  return schools
    .filter((school) => school.grade.tier === "outstanding")
    .map((school) => ({ school, metres: metresBetween(center, [school.longitude, school.latitude]) }))
    .filter((entry) => entry.metres <= HIGHLIGHT_METRES)
    .sort((left, right) => left.metres - right.metres)
    .slice(0, MAX_HIGHLIGHTS)
    .map((entry) => entry.school);
}

function metresBetween([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
}
