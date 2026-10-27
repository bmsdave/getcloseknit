/**
 * "Homes near this school". The postcodes with recorded homes nearest a point
 * (GET /api/v1/homes/near, api/area_api/homes_near.py), each a link to its list of homes. Postcodes,
 * never addresses: the homes are one tap away, on their postcode's page.
 */
import type { DataMode } from "./map-state";
import { normalisePostcode } from "./postcode-page";

export interface NearPostcode {
  postcode: string;
  geographyId: string;
  /** Homes there, as its list of homes counts them (/postcode/{code}/homes). */
  homes: number;
  /** Straight line from the point to the middle of those homes. */
  metres: number;
}

export interface HomesNearResponse {
  schemaVersion: "homes-near.v1";
  productReleaseId: string;
  point: { latitude: number; longitude: number };
  radiusMetres: number;
  postcodes: NearPostcode[];
  caveats: string[];
}

export const HOMES_NEAR_LIMIT = 4;

export function homesNearPath(latitude: number, longitude: number, limit = HOMES_NEAR_LIMIT): string {
  const query = new URLSearchParams({ latitude: latitude.toFixed(5), longitude: longitude.toFixed(5), limit: String(limit) });
  return `/api/v1/homes/near?${query.toString()}`;
}

/** The rows the page can show: valid postcodes with at least one home, nearest first; anything else is dropped. */
export function readHomesNear(payload: unknown): NearPostcode[] | null {
  const body = payload as HomesNearResponse | null;
  if (!body || body.schemaVersion !== "homes-near.v1" || !Array.isArray(body.postcodes)) return null;
  return body.postcodes
    .filter((row) => normalisePostcode(row?.postcode ?? "") !== null && Number.isInteger(row.homes) && row.homes > 0 && Number.isFinite(row.metres))
    .sort((left, right) => left.metres - right.metres);
}

/** "120 m" / "1.2 km": a straight line, rounded to tens of metres. */
export function nearDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(metres / 10) * 10)} m`;
}

export function homesWord(count: number): string {
  return `${count} ${count === 1 ? "home" : "homes"}`;
}

/** The preview's homes are in SW1A 1AB (the demo postcode's homes page) and W5 1LR. */
const DEMO_NEAR: NearPostcode[] = [
  { postcode: "SW1A 1AB", geographyId: "uk:lsoa:E01000001", homes: 3, metres: 240 },
];

/** Postcodes near a school: the API in real mode, the preview postcode in demo; null when the read failed. */
export async function loadHomesNear(point: { latitude: number; longitude: number } | null, mode: DataMode): Promise<NearPostcode[] | null> {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return [];
  if (mode === "demo") return DEMO_NEAR;
  const { fetchApi } = await import("./deployment");
  const { body } = await fetchApi<unknown>(homesNearPath(point.latitude, point.longitude));
  return readHomesNear(body);
}
