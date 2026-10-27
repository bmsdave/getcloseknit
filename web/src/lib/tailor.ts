/**
 * Tailor (docs/area-card-2026-10/personalisation-spec.md): who is moving, buy or rent, the place
 * travelled to most and up to three weekly things. The answers change a few overview facts and
 * tiles 5-7, never the order of anything. They stay in this device's profile (lib/profile-state.ts).
 */
import { routablePlaces } from "./commute";
import { MAX_LIFESTYLE, type Household, type Lifestyle, type PreferenceProfile } from "./contracts";

/** Step 1's answers, as the buttons say them. */
export const HOUSEHOLD_OPTIONS: { id: Household; label: string; short: string }[] = [
  { id: "solo", label: "Me or a couple", short: "me or a couple" },
  { id: "sharers", label: "Sharing", short: "sharers" },
  { id: "kids-under5", label: "Kids under 5", short: "kids under 5" },
  { id: "kids-primary", label: "Kids at primary", short: "kids at primary" },
  { id: "kids-secondary", label: "Kids at secondary", short: "kids at secondary" },
  { id: "kids-mixed", label: "Kids, mixed ages", short: "kids of mixed ages" },
  { id: "55plus", label: "55+ or downsizing", short: "55+" },
];

/** Step 4's answers. Parks and Quiet mark tiles already shown; the rest bring their own tile. */
export const LIFESTYLE_OPTIONS: { id: Lifestyle; label: string; short: string }[] = [
  { id: "parks", label: "Parks", short: "parks" },
  { id: "gym", label: "Gym or pool", short: "gym" },
  { id: "cafes", label: "Cafés", short: "cafés" },
  { id: "bars", label: "Pubs & bars", short: "pubs & bars" },
  { id: "quiet", label: "Quiet streets", short: "quiet" },
  { id: "gp", label: "GP", short: "GP" },
  { id: "shops", label: "Food shops", short: "food shops" },
];

/** A gentle suggestion for step 4, shown but never ticked for the household. */
export function suggestedLifestyle(household: Household | null | undefined): Lifestyle | null {
  if (household === "55plus") return "gp";
  if (household === "sharers") return "cafes";
  if (household?.startsWith("kids-")) return "parks";
  return null;
}

/** School phases the household's answer implies; null leaves the search's own phases alone. */
export function householdPhases(household: Household | null | undefined): ("primary" | "secondary")[] | null {
  if (household === "kids-under5" || household === "kids-primary") return ["primary"];
  if (household === "kids-secondary") return ["secondary"];
  if (household === "kids-mixed") return ["primary", "secondary"];
  return null;
}

export interface TailorAnswers {
  household: Household | null;
  market: "buy" | "rent";
  lifestyle: Lifestyle[];
}

export function tailorAnswers(profile: PreferenceProfile): TailorAnswers {
  return { household: profile.household ?? null, market: profile.market, lifestyle: [...(profile.lifestyle ?? [])] };
}

/** The answers written into the profile: household (and the school phases it implies), market, lifestyle (at most 3). */
export function applyTailor(profile: PreferenceProfile, answers: TailorAnswers): PreferenceProfile {
  const phases = householdPhases(answers.household);
  const lifestyle = [...new Set(answers.lifestyle)].slice(0, MAX_LIFESTYLE);
  const next: PreferenceProfile = {
    ...profile,
    market: answers.market,
    household: answers.household,
    lifestyle,
    school: phases ? { ...profile.school, phases } : profile.school,
  };
  if (!next.household) delete next.household;
  if (!next.lifestyle?.length) delete next.lifestyle;
  return next;
}

/** Reset to default: the Tailor answers go; the search's budget, places and school settings stay. */
export function withoutTailor(profile: PreferenceProfile): PreferenceProfile {
  const next = { ...profile };
  delete next.household;
  delete next.lifestyle;
  return next;
}

/** Whether anything was answered that changes the overview. */
export function isTailored(profile: PreferenceProfile): boolean {
  return tailorSummary(profile) !== "";
}

/** "kids at primary · gym" for the chip's "For:" line; empty when nothing changes the overview. */
export function tailorSummary(profile: PreferenceProfile): string {
  const pinned = routablePlaces(profile.places)[0]?.label ?? null;
  const household = HOUSEHOLD_OPTIONS.find((option) => option.id === profile.household)?.short ?? null;
  const picks = (profile.lifestyle ?? []).map((id) => LIFESTYLE_OPTIONS.find((option) => option.id === id)?.short ?? id);
  return [household, profile.market === "rent" ? "renting" : null, pinned ? `to ${pinned}` : null, ...picks]
    .filter((part): part is string => Boolean(part)).join(" · ");
}
