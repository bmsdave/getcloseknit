/**
 * The map's place while MapLibre loads (close-knit.tsx loads it after the page
 * is interactive; the server renders this instead): the same box as .map-stage
 * in the canvas colour, so nothing moves when the map takes its place. Decoration only.
 */
export function MapPoster() {
  return <div className="map-poster" data-testid="map-poster" aria-hidden="true" />;
}
