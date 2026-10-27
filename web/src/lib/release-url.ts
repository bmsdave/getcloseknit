/**
 * Release-scoped map data that browsers keep for an hour or a day (Cache-Control max-age): the school
 * points (Show › Schools), the area boxes and the overlay tiles. Its URL carries the active release id
 * (?release=<id>), so a new release is a new URL and a deploy never leaves the old release's copy on the
 * map; within one release the long cache still holds. The API ignores the parameter; it is a cache key.
 * Value packs and area evidence already carry it (lib/map-state.ts).
 */

/** `url` with `release=<id>` added (a tile template's {z}/{x}/{y} stay as they are); unchanged without a release. */
export function withRelease(url: string, release: string | null | undefined): string {
  if (!release) return url;
  return `${url}${url.includes("?") ? "&" : "?"}release=${encodeURIComponent(release)}`;
}

/** Every open school as a map point, for this release. */
export function schoolPointsPath(release: string | null | undefined): string {
  return withRelease("/api/v1/schools/points", release);
}

/**
 * The release each map shows (components/area-map.tsx sets it on every render), read where an overlay
 * adds its source: the map's helpers get the map, not the props.
 */
const mapReleases = new WeakMap<object, string>();

export function setMapRelease(map: object, release: string): void {
  mapReleases.set(map, release);
}

export function mapRelease(map: object): string | null {
  return mapReleases.get(map) ?? null;
}
