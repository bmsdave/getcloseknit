/**
 * Travel to › the nearest of a kind (CUJ-13 board "Gym · ≤ 10 min walk"): typing "gym", "park", "M&S" or
 * "swimming" offers the nearest one as a place card, ahead of the street addresses that merely contain the word.
 * The same targets the MCP find_areas takes (a kind, a brand, a sport, a top-school rule); minutes on foot.
 */
import type { MatchCriterion, PlaceCategory, PlaceTarget } from "./contracts";
import { MATCH_CHIPS } from "./match-ranges";

export interface PlaceKindOption {
  key: string;
  /** The option and the card's name: "Gym", "M&S", "Top primary". */
  label: string;
  /** What the option reads: "Gym · ≤ 10 min walk". */
  text: string;
  criterion: Extract<MatchCriterion, { kind: "place" }>;
}

interface Kind { key: string; label: string; words: readonly string[]; target: PlaceTarget; minutes: number }

const category = (name: PlaceCategory, extra: { brand?: string; sport?: string } = {}): PlaceTarget => ({ kind: "category", category: name, ...extra });

/** Most specific first: a brand or sport before its kind, so "puregym" offers PureGym, then any gym. */
const KINDS: readonly Kind[] = [
  { key: "brand-ms", label: "M&S", words: ["m&s", "marks", "marks and spencer", "marks & spencer"], target: category("supermarket", { brand: "M&S" }), minutes: 10 },
  { key: "brand-waitrose", label: "Waitrose", words: ["waitrose"], target: category("supermarket", { brand: "Waitrose" }), minutes: 10 },
  { key: "brand-sainsburys", label: "Sainsbury's", words: ["sainsbury", "sainsburys", "sainsbury's"], target: category("supermarket", { brand: "Sainsbury's" }), minutes: 10 },
  { key: "brand-tesco", label: "Tesco", words: ["tesco"], target: category("supermarket", { brand: "Tesco" }), minutes: 10 },
  { key: "brand-lidl", label: "Lidl", words: ["lidl"], target: category("supermarket", { brand: "Lidl" }), minutes: 10 },
  { key: "brand-aldi", label: "Aldi", words: ["aldi"], target: category("supermarket", { brand: "Aldi" }), minutes: 10 },
  { key: "brand-puregym", label: "PureGym", words: ["puregym", "pure gym"], target: category("gym", { brand: "PureGym" }), minutes: 10 },
  { key: "brand-virgin-active", label: "Virgin Active", words: ["virgin active"], target: category("gym", { brand: "Virgin Active" }), minutes: 15 },
  { key: "sport-tennis", label: "Tennis club", words: ["tennis"], target: category("sports_club", { sport: "tennis" }), minutes: 15 },
  { key: "sport-football", label: "Football club", words: ["football"], target: category("sports_club", { sport: "soccer" }), minutes: 15 },
  { key: "gym", label: "Gym", words: ["gym", "gyms", "fitness", "leisure centre"], target: category("gym"), minutes: 10 },
  { key: "park", label: "Park", words: ["park", "parks"], target: category("park"), minutes: 10 },
  { key: "cafe", label: "Café", words: ["cafe", "café", "coffee"], target: category("cafe"), minutes: 5 },
  { key: "supermarket", label: "Supermarket", words: ["supermarket", "groceries"], target: category("supermarket"), minutes: 10 },
  { key: "pool", label: "Swimming pool", words: ["pool", "swim", "swimming", "lido"], target: category("pool"), minutes: 15 },
  { key: "gp", label: "GP", words: ["gp", "doctor", "surgery"], target: category("gp"), minutes: 10 },
  { key: "pharmacy", label: "Pharmacy", words: ["pharmacy", "chemist"], target: category("pharmacy"), minutes: 10 },
  { key: "pub", label: "Pub", words: ["pub", "bar"], target: category("pub"), minutes: 10 },
  { key: "top-primary", label: "Top primary", words: ["primary", "school"], target: { kind: "school", phase: "primary", top: 100 }, minutes: 10 },
  { key: "top-secondary", label: "Top secondary", words: ["secondary", "school"], target: { kind: "school", phase: "secondary", top: 50 }, minutes: 20 },
  { key: "step-free", label: "Step-free station", words: ["step-free", "step free", "lift"], target: category("step_free_station"), minutes: 10 },
];

/** The chips' own ids (gym, park, cafe, top-primary), so a kind typed here and its What matters chip are one criterion. */
const CHIP_IDS: Record<string, string> = { gym: "gym-nearby", park: "parks-nearby", cafe: "cafes-nearby", "top-primary": "top-primary" };

/** What one kind adds: the chip's card when there is one, else the nearest of the kind on foot. */
function criterionFor(kind: Kind): Extract<MatchCriterion, { kind: "place" }> {
  const chip = MATCH_CHIPS.find((entry) => entry.id === CHIP_IDS[kind.key])?.criterion;
  if (chip?.kind === "place") return structuredClone(chip);
  return { kind: "place", id: kind.key.slice(0, 24), label: kind.label, target: kind.target, mode: "walk", targetMinutes: kind.minutes, must: false };
}

/**
 * The kinds a typed place names, best first (at most two): "gym" → Gym · ≤ 10 min walk; "puregym" → PureGym, Gym.
 * The query (less a leading "the", "nearest"… and a trailing "near work") must start a kind's word, so
 * "Clapham Common" or "Park Road" stay addresses.
 */
export function placeKindOptions(query: string): PlaceKindOption[] {
  const needle = query.trim().toLowerCase().replace(/\s+/g, " ").replace(/^(the|a|an|any|nearest|my|local) /, "")
    .replace(/ (near|in|by|around|close to) .*$/, "");
  if (needle.length < 2) return [];
  // Two letters match a whole word only ("gp"), so "Ba" for Bank or "St" for Stratford stays stations and addresses.
  const hit = (word: string) => (needle.length < 3 ? word === needle : word.startsWith(needle));
  const found = KINDS.filter((kind) => kind.words.some(hit));
  const first = found[0]?.target;
  // A brand or a sport also offers its kind ("puregym" → PureGym, then any gym).
  const plain = first?.kind === "category" && (first.brand || first.sport)
    ? KINDS.find((kind) => kind.target.kind === "category" && !kind.target.brand && !kind.target.sport && kind.target.category === first.category)
    : undefined;
  const list = [...new Set([...found.slice(0, plain ? 1 : 2), ...(plain ? [plain] : [])])];
  return list.map((kind) => {
    const criterion = criterionFor(kind);
    return { key: `kind:${kind.key}`, label: criterion.label, text: `${criterion.label} · ≤ ${criterion.targetMinutes} min walk`, criterion };
  });
}

/**
 * A short name for an address picked in Travel to: its first part with a word in it, never a bare house number
 * ("5, The Old Gym, 12 Marshalsea Road" → "The Old Gym", not "5").
 */
export function addressLabel(text: string): string {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const named = parts.find((part) => /[a-z]{2,}/i.test(part) && !/^(flat|unit|apartment|apt|room|floor)\b/i.test(part));
  return (named ?? parts[0] ?? text).slice(0, 60);
}
