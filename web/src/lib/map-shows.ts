/**
 * Show's overlays beyond Places and Recent sales (map-layers.tsx): state schools, the rail network's
 * stations, the household's own places and street trees. Stations are on until turned off; the others
 * are off until asked for. They travel in the address only (?schools=on, ?stations=off, ?mine=on, ?trees=on).
 */
export interface MapShows {
  schools: boolean;
  stations: boolean;
  mine: boolean;
  /** Street trees (GLA): counts from zoom 13, one dot per tree from 15. */
  trees: boolean;
}

export const DEFAULT_SHOWS: MapShows = { schools: false, stations: true, mine: false, trees: false };

export function showsFromQuery(search: string): MapShows {
  const parameters = new URLSearchParams(search);
  return {
    // ?schools=on, or the filter's compact text (?schools=t.p_m.ks2.75, lib/school-filter.ts).
    schools: parameters.has("schools") && parameters.get("schools") !== "off",
    stations: parameters.get("stations") !== "off",
    mine: parameters.get("mine") === "on",
    trees: parameters.get("trees") === "on",
  };
}

export function withShowsQuery(query: string, shows: MapShows): string {
  const parameters = new URLSearchParams(query);
  const set = (key: string, value: string | null) => (value === null ? parameters.delete(key) : parameters.set(key, value));
  set("schools", shows.schools ? "on" : null);
  set("stations", shows.stations ? null : "off");
  set("mine", shows.mine ? "on" : null);
  set("trees", shows.trees ? "on" : null);
  return parameters.toString();
}

/** Layers › None, the plain map with no colours (?colours=none): in the address only, like Show's overlays. */
export function plainFromQuery(search: string): boolean {
  return new URLSearchParams(search).get("colours") === "none";
}

export function withPlainQuery(query: string, plain: boolean): string {
  const parameters = new URLSearchParams(query);
  if (plain) parameters.set("colours", "none");
  else parameters.delete("colours");
  return parameters.toString();
}

/** How many overlays Show has on, Places and Recent sales included, for the button's count. */
export function shownCount(shows: MapShows, others: readonly boolean[]): number {
  return [shows.schools, shows.stations, shows.mine, shows.trees, ...others].filter(Boolean).length;
}
