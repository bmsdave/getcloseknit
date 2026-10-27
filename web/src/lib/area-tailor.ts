/**
 * Tailoring the area page to the household's My match profile: which home types come
 * first, what the budget buys, and the household's own tags. A client-side layer over the full page:
 * it only reorders and highlights, and adds the budget-fit and commute rows; it never hides data, so
 * the server-rendered page (what crawlers read) is the complete default.
 */
import type { Household, PreferenceProfile } from "./contracts";
import { routablePlaces } from "./commute";
import { formatMoney } from "./money-format";
import type { MarketTypeStats, PropertyTypeCode } from "./market";
import { HOUSEHOLD_OPTIONS } from "./tailor";

/** The four home types the Price section always shows, in the default order. */
export const PRICE_TYPES: readonly PropertyTypeCode[] = ["F", "T", "S", "D"];

const HOUSE_CODES: Record<"terraced" | "semi" | "detached", PropertyTypeCode> = { terraced: "T", semi: "S", detached: "D" };
const TYPE_WORDS: Record<PropertyTypeCode, string> = { F: "Flat", T: "Terraced", S: "Semi", D: "Detached", O: "Other" };

export interface PageTailor {
  /** Anything to tailor by; false: the full default page. */
  active: boolean;
  market: "buy" | "rent";
  /** The household's own maximum budget (never the default profile's). */
  budget: number | null;
  bedrooms: number | null;
  /** The home types chosen, in price order; empty when none were. */
  types: PropertyTypeCode[];
  household: Household | null;
  /** The first pinned place and its routed minutes, when known. */
  place: { label: string; minutes: number | null; targetMinutes: number } | null;
  /**
   * Every place of the household in My match's order (CUJ13): pinned addresses and the nearest of a kind (a gym,
   * a park), each with its minutes from this area, for one tag each. Empty: the tags fall back to `place`.
   */
  places?: TailorPlace[];
}

/** A household place from one area: its minutes there (null while unknown) against its limit and soft edge. */
export interface TailorPlace { label: string; minutes: number | null; targetMinutes: number; softMinutes: number }

/** The market codes for the profile's home types: house subtypes, or every house, or flats. */
export function chosenTypes(profile: Pick<PreferenceProfile, "houseTypes" | "propertyType">): PropertyTypeCode[] {
  const houses = (profile.houseTypes ?? []).map((type) => HOUSE_CODES[type]).filter(Boolean);
  const codes = houses.length ? houses : profile.propertyType === "house" ? ["T", "S", "D"] as PropertyTypeCode[] : [];
  if (profile.propertyType === "flat") codes.push("F");
  return PRICE_TYPES.filter((code) => codes.includes(code));
}

/**
 * The page's tailoring from the profile. `searchSet` is false for the default profile (and Tailor-only
 * answers), so its budget and bedrooms are never shown as the household's own.
 */
export function pageTailor(profile: PreferenceProfile, searchSet: boolean, minutes: number | null = null): PageTailor {
  const pinned = routablePlaces(profile.places)[0] ?? null;
  const types = chosenTypes(profile);
  const budget = searchSet && profile.market !== "rent" && profile.maximumBudget > 0 ? profile.maximumBudget : null;
  const household = profile.household ?? null;
  return {
    active: searchSet || types.length > 0 || pinned !== null || household !== null,
    market: profile.market === "rent" ? "rent" : "buy",
    budget,
    bedrooms: searchSet ? profile.bedrooms : null,
    types,
    household,
    place: pinned ? { label: pinned.label, minutes, targetMinutes: pinned.targetMinutes } : null,
  };
}

/** The types the Price section lists: the chosen ones first, then the rest, each once. */
export function typeOrder(tailor: Pick<PageTailor, "types">): PropertyTypeCode[] {
  return [...tailor.types, ...PRICE_TYPES.filter((code) => !tailor.types.includes(code))];
}

export function typeWords(codes: readonly PropertyTypeCode[]): string {
  return codes.map((code) => TYPE_WORDS[code]).join(", ");
}

/** "Buy ≤ £1.2m · 3-bed · Terraced, Semi, Detached · kids at primary · King's Cross"; empty without tailoring. */
export function tailorLine(tailor: PageTailor): string {
  if (!tailor.active) return "";
  return [
    tailor.market === "rent" ? "Rent" : tailor.budget !== null ? `Buy ≤ ${formatMoney(tailor.budget)}` : "Buy",
    tailor.bedrooms ? `${tailor.bedrooms}-bed` : null,
    tailor.types.length ? typeWords(tailor.types) : null,
    HOUSEHOLD_OPTIONS.find((option) => option.id === tailor.household)?.short ?? null,
    tailor.place?.label ?? null,
  ].filter((part): part is string => Boolean(part)).join(" · ");
}

export type BudgetFit = "all" | "most" | "some" | "few" | "none";

/**
 * How many of a type's recent sales a budget reaches: all (up to the dearest), most (at least three
 * in four), some (at least one in four), few (the cheapest 5%), none. Null under 5 sales.
 */
export function budgetFit(stats: Pick<MarketTypeStats, "sales" | "p5" | "p25" | "p75" | "p95" | "maxPrice" | "medianPrice">, budget: number): BudgetFit | null {
  if (stats.sales < 5) return null;
  const top = stats.maxPrice ?? stats.p95;
  if (top !== null && top <= budget) return "all";
  if (stats.p75 !== null && stats.p75 <= budget) return "most";
  const lower = stats.p25 ?? stats.medianPrice;
  if (lower !== null && lower <= budget) return "some";
  if (stats.p5 !== null && stats.p5 <= budget) return "few";
  return "none";
}

/** A tag of the household's own, shown before the area's. */
export interface PersonalTag { kind: "pro" | "con"; text: string; section: "price" | "getting-around" }

/**
 * "Within budget" / "Over budget" from the chosen types (or all homes), then one tag per household place in My match's
 * order (CUJ13 board: "Within budget · Work 11 min · Gym 4 min · ≈ Park 7 min"): inside its limit, "≈" on its
 * soft edge, "Fails:" past it. The budget reads as My match does too: a typical price (the median) inside it is within.
 */
export function personalTags(tailor: PageTailor, byType: readonly MarketTypeStats[], all: MarketTypeStats | null): PersonalTag[] {
  const tags: PersonalTag[] = [];
  if (tailor.budget !== null) {
    const pool = tailor.types.length ? byType.filter((stats) => tailor.types.includes(stats.propertyType as PropertyTypeCode)) : all ? [all] : [];
    const fits = pool.map((stats) => budgetFit(stats, tailor.budget!)).filter((fit): fit is BudgetFit => fit !== null);
    const typical = pool.some((stats) => stats.sales >= 5 && stats.medianPrice !== null && stats.medianPrice <= tailor.budget!);
    if (fits.some((fit) => fit === "all" || fit === "most") || typical) tags.push({ kind: "pro", text: "Within budget", section: "price" });
    else if (fits.length && fits.every((fit) => fit === "few" || fit === "none")) tags.push({ kind: "con", text: "Over budget", section: "price" });
  }
  const places: TailorPlace[] = tailor.places?.length ? tailor.places
    : tailor.place ? [{ ...tailor.place, softMinutes: tailor.place.targetMinutes }] : [];
  for (const place of places) {
    if (place.minutes === null) continue;
    const minutes = Math.round(place.minutes);
    tags.push(minutes > Math.max(place.targetMinutes, place.softMinutes)
      ? { kind: "con", text: `Fails: ${place.label} ${minutes} min`, section: "getting-around" }
      : { kind: "pro", text: `${minutes > place.targetMinutes ? "≈ " : ""}${place.label} ${minutes} min`, section: "getting-around" });
  }
  return tags;
}

/** How many of the household's own pros the verdict shows (the budget and three places, CUJ13 board). */
const PERSONAL_PROS = 4;

/**
 * The household's tags first, then the area's: at most three pros and two cons, except that the household's own pros
 * (up to four: the budget and its places) are never pushed out by the area's.
 */
export function mergeTags<T extends { kind: "pro" | "con" }>(personal: readonly T[], area: readonly T[]): T[] {
  const mine = personal.filter((tag) => tag.kind === "pro").slice(0, PERSONAL_PROS);
  const pros = [...mine, ...area.filter((tag) => tag.kind === "pro")].slice(0, Math.max(3, mine.length));
  const all = [...personal, ...area];
  return [...pros, ...all.filter((tag) => tag.kind === "con").slice(0, 2)];
}
