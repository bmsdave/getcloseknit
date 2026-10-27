// The frame every entity page shares (borough, area, postcode, home, school):
// breadcrumbs up to London and one "What's next" block. Built from the area
// hierarchy and the existing path helpers; nothing here fetches.
import type { HierarchyArea } from "./area-pages";
import { areaPath, regionPath } from "./area-pages";
import { LONDON_SCOPE, regionScope } from "./scope-name";

/** One breadcrumb step; null href: this page. */
export interface Crumb { label: string; href: string | null }

/** One link in a What's next column. */
export interface NextLink {
  label: string;
  href: string;
  testId?: string;
  /** A full page load (the map reads its address once). */
  reload?: boolean;
}

export interface NextColumns { up: string; inside: string; nearby: string; act: string }

export const NEXT_COLUMNS: readonly { id: keyof NextColumns; title: string }[] = [
  { id: "up", title: "Up" },
  { id: "inside", title: "Inside" },
  { id: "nearby", title: "Nearby" },
  { id: "act", title: "Act" },
];

/** The name people use for an area in a breadcrumb: its friendly name without the district, else the official name. */
export function crumbName(area: Pick<HierarchyArea, "name" | "friendlyName">): string {
  return area.friendlyName?.trim() || area.name;
}

/**
 * London › borough › MSOA › neighbourhood, each a link; `current` names the
 * last area as its own page does. An MSOA whose name is the same as the
 * neighbourhood after it is left out (St James's › St James's).
 */
export function areaCrumbs(trail: readonly HierarchyArea[], current?: string | null): Crumb[] {
  const labels = trail.map((area, index) => (index === trail.length - 1 && current ? current : crumbName(area)));
  // The root is the area's region: London › …, or North West › … (its list on /area/england).
  const region = regionScope(trail[0]?.regionCode) ?? LONDON_SCOPE;
  const crumbs: Crumb[] = [{ label: region.name, href: regionPath(region) }];
  // The hierarchy could not be read: London, then this page.
  if (trail.length === 0 && current) return [...crumbs, { label: current, href: null }];
  trail.forEach((area, index) => {
    if (area.carrier === "msoa" && index + 1 < trail.length && labels[index + 1] === labels[index]) return;
    // Never the same name twice in a row (London › City of London › City of London): the wider one stays, a link.
    if (crumbs.at(-1)?.label === labels[index]) return;
    crumbs.push({ label: labels[index], href: areaPath(area) });
  });
  return crumbs;
}

/** The Up column: the places above this page, nearest first, London last. */
export function upLinks(crumbs: readonly Crumb[]): { label: string; href: string }[] {
  return crumbs.slice(0, -1)
    .filter((crumb): crumb is { label: string; href: string } => crumb.href !== null)
    .reverse();
}

