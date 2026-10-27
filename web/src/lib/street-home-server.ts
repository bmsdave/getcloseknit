/** Server-side loader for the street-level home route: the demo fixture without an evidence API, the API otherwise. */
import { fetchApi } from "./deployment";
import type { DataMode } from "./map-state";
import { postcodeSlug } from "./postcode-page";
import type { StreetHomeAnswer } from "./street-home";
import { demoStreetHome } from "./street-home-fixture";

/** The API refused or did not answer in time (its status; 503 when unreachable): the page says so, never a 500. */
export interface StreetHomeUnavailable {
  unavailable: number;
}

/**
 * The home block (also for a hidden home's number), `{ uprn }` for a recorded home, `{ postcodePage }`
 * for a recorded home without a UPRN, null outside the street's numbers, or `{ unavailable }` when the
 * service is down or busy (rather than throw and make the page a 500, as a cold lookup past the 2.5 s wait did).
 */
export async function loadStreetHome(mode: DataMode, postcode: string, slug: string): Promise<StreetHomeAnswer | StreetHomeUnavailable | null> {
  if (mode === "demo") return demoStreetHome(postcode, slug);
  const { status, body } = await fetchApi<StreetHomeAnswer>(
    `/api/v1/homes/at/${encodeURIComponent(postcodeSlug(postcode))}/${encodeURIComponent(slug)}`);
  if (status === 404 || status === 400) return null;
  return body ?? { unavailable: status === 200 ? 502 : status };
}
