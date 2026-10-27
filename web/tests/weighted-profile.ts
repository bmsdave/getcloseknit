import type { PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";

/**
 * A filled-in search for scoring tests: the default profile (every priority Off since Find my area
 * asks first) with the budget, crime, commute and schools weighted 3, as the old default was.
 */
export function weightedProfile(): PreferenceProfile {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.factors = profile.factors.map((factor) => ({
    ...factor,
    weight: ["affordability", "crime", "commute", "schools"].includes(factor.factorId) ? 3 : 0,
  }));
  return profile;
}
