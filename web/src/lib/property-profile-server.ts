/**
 * Server-side loaders for the property pages: demo fixtures without an
 * evidence API, the API's property-profile.v2 / postcode-homes.v1 otherwise.
 * `status` lets a page tell "no such home" (404) from "service down" (503).
 */
import { cache } from "react";

import type { DataMode } from "./map-state";
import { evidenceServiceUrl } from "./evidence-service";
import { fetchApi } from "./deployment";
import type { PostcodeHomesResponse, PropertyProfileResponse } from "./property-profile";
import { demoPostcodeHomes, demoPropertyProfile } from "./property-profile-fixture";

export interface Loaded<T> {
  mode: DataMode;
  status: number;
  body: T | null;
}

// One read per request (React cache): a page and its metadata share it, so a home's profile (an
// expensive "detail" read for the API's rate limit) is never fetched twice for one view.
export const loadPropertyProfile = cache(async (uprn: string): Promise<Loaded<PropertyProfileResponse>> => {
  if (!evidenceServiceUrl()) {
    const body = demoPropertyProfile(uprn);
    return { mode: "demo", status: body ? 200 : 404, body };
  }
  const upstream = await fetchApi<PropertyProfileResponse>(`/api/v1/properties/${encodeURIComponent(uprn)}/profile`);
  return { mode: "real", ...upstream };
});

export const loadPostcodeHomes = cache(async (postcode: string): Promise<Loaded<PostcodeHomesResponse>> => {
  if (!evidenceServiceUrl()) {
    const body = demoPostcodeHomes(postcode);
    return { mode: "demo", status: body ? 200 : 404, body };
  }
  const upstream = await fetchApi<PostcodeHomesResponse>(`/api/v1/postcodes/${encodeURIComponent(postcode)}/homes`);
  return { mode: "real", ...upstream };
});
