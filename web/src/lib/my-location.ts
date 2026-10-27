/**
 * My location on the map: a blue dot and its accuracy circle, drawn from the browser's
 * one answer to a tap on the locate button. Nothing is kept or sent.
 */
export const MY_LOCATION_SOURCE = "my-location";
export const MY_LOCATION_LAYERS = ["my-location-accuracy", "my-location-dot"] as const;

const METRES_PER_DEGREE = 111_320;

/**
 * The accuracy circle as a closed ring of [lng, lat] points, `metres` around the point (at least 10 m,
 * so a very precise fix still shows a ring around the dot).
 */
export function accuracyRing(longitude: number, latitude: number, metres: number, steps = 48): [number, number][] {
  const radius = Math.max(10, Number.isFinite(metres) ? metres : 10);
  const dLat = radius / METRES_PER_DEGREE;
  const dLng = radius / (METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / steps) * 2 * Math.PI;
    ring.push([longitude + dLng * Math.cos(angle), latitude + dLat * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

/** The GeoJSON for the source: the ring, then the point (the layers filter on geometry type). */
export function myLocationData(longitude: number, latitude: number, metres: number) {
  return {
    type: "FeatureCollection" as const,
    features: [
      { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [accuracyRing(longitude, latitude, metres)] } },
      { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [longitude, latitude] } },
    ],
  };
}
