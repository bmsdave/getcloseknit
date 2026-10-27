import type { AreaSummary, SaleRecord } from "./contracts";
import { formatPounds } from "./evidence-format";
import { floodHeadline, type AreaFloodResponse } from "./flood-risk";
import { crimeVerdict, formatPricePerSquareMetre, noiseShareWords, schoolsWords, trendWords } from "./overview-scorecard";
import type { AreaFacts } from "./overview-text";
import { scoreWords, walkMinutes, type AreaPlacesState } from "./places";
import { boroughForSelectedArea, boroughLabel, searchPlanning } from "./planning-evidence";
import { sortByTopic, type TopicId } from "./topic-order";

/**
 * The area panel's sections, in reading order under the summary. Property
 * shows only when a home is chosen.
 */
const SECTION_LIST = [
  { id: "price", title: "Price & market", icon: "home" },
  { id: "crime", title: "Crime", icon: "crime" },
  { id: "people", title: "People", icon: "people" },
  { id: "schools", title: "Schools", icon: "school" },
  { id: "environment", title: "Environment", icon: "tree" },
  { id: "transport", title: "Transport", icon: "train" },
  { id: "planning", title: "Planning", icon: "planning" },
  { id: "property", title: "Property", icon: "key" },
] as const;

export type SectionId = (typeof SECTION_LIST)[number]["id"];

const SECTION_TOPIC: Record<SectionId, TopicId> = {
  price: "price", transport: "getting-around", crime: "safety", schools: "schools", environment: "environment",
  planning: "homes", property: "homes", people: "people",
};

/** The panel's sections in the one topic order (lib/topic-order.ts). */
export const EVIDENCE_SECTIONS = sortByTopic(SECTION_LIST, (section) => SECTION_TOPIC[section.id]);

const SECTION_IDS: readonly string[] = EVIDENCE_SECTIONS.map((section) => section.id);

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === "string" && SECTION_IDS.includes(value);
}

/** localStorage key: the ids of folded sections (all open when absent). */
export const FOLDED_SECTIONS_KEY = "close-knit.folded-sections";

/** Parses the stored list; unknown ids and malformed values are dropped. */
export function parseFolded(stored: string | null): SectionId[] {
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? [...new Set(parsed.filter(isSectionId))] : [];
  } catch {
    return [];
  }
}

export function loadFolded(): SectionId[] {
  if (typeof window === "undefined") return [];
  try {
    return parseFolded(window.localStorage.getItem(FOLDED_SECTIONS_KEY));
  } catch {
    return [];
  }
}

export function saveFolded(folded: readonly SectionId[]): void {
  try {
    window.localStorage.setItem(FOLDED_SECTIONS_KEY, JSON.stringify(folded));
  } catch {
    return;
  }
}

/** Folds an open section or opens a folded one; order follows the panel. */
export function toggleFolded(folded: readonly SectionId[], id: SectionId): SectionId[] {
  const next = folded.includes(id) ? folded.filter((entry) => entry !== id) : [...folded, id];
  return SECTION_IDS.filter((entry): entry is SectionId => next.includes(entry as SectionId));
}

export interface KeyFigureInput {
  facts: AreaFacts;
  /** null while loading; "unknown" when the area has no flood data. */
  flood: AreaFloodResponse | null | "unknown";
  /** null while loading. */
  places: AreaPlacesState | null;
  /** The chosen home's sales, oldest first; null without a home. */
  history: SaleRecord | null;
  /** Planning has no figure in a real release yet. */
  planning: string | null;
  /** The area profile is still on its way. */
  loading: boolean;
}

const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

function known(summary: AreaSummary | null): summary is AreaSummary & { value: number } {
  return summary !== null && summary.value !== null;
}

const join = (parts: Array<string | null | false | undefined>) => parts.filter(Boolean).join(" · ");

/**
 * One line per section header, read from what the summary already loaded,
 * so a folded section never fetches to fill its header. "…" while loading,
 * "unknown" when nothing was published.
 */
export function sectionKeyFigures(input: KeyFigureInput): Record<SectionId, string> {
  const { facts, flood, places, history, loading } = input;
  const pending = loading ? "…" : "unknown";

  const trend = trendWords(facts.change);
  const price = known(facts.price)
    ? join([formatPricePerSquareMetre(facts.price.value), trend.direction !== "unknown" && `${trend.arrow} ${trend.text} a year`.trim()])
    : pending;

  const crime = crimeVerdict(facts.crime) ?? pending;

  // Places, not people: the homes (share that are social rent), never who lives in them.
  const people = known(facts.socialRenting) ? `${number.format(facts.socialRenting.value)}% of homes social rent` : pending;

  const schools = facts.schools ? schoolsWords(facts.schools) : pending;

  const headline = floodHeadline(flood && flood !== "unknown" ? flood : null);
  const noise = noiseShareWords(facts.noise);
  const environment = headline !== "unknown" || noise !== null
    ? join([headline !== "unknown" && `Flood ${headline[0].toLowerCase()}${headline.slice(1)}`, noise])
    : flood === null || loading ? "…" : "unknown";

  const data = places?.status === "available" ? places.places : null;
  const nearest = data ? [...data.stations].sort((a, b) => a.distanceMetres - b.distanceMetres)[0] ?? null : null;
  const transport = places === null ? "…" : data
    ? join([data.connectivity ? scoreWords(data.connectivity.score) : null, nearest && `${walkMinutes(nearest.distanceMetres)} min walk to ${nearest.name}`]) || "No station nearby"
    : "unknown";

  const lastSale = history?.transactions.at(-1) ?? null;
  const property = lastSale ? `Last sold ${formatPounds(lastSale.nominalPrice)} · ${lastSale.date.slice(0, 4)}` : "No recorded sale for this home";

  return { price, crime, people, schools, environment, transport, planning: input.planning ?? "unknown", property };
}

/** Preview planning header: the pilot's applications in the area's borough. */
export function planningKeyFigure(geographyId: string): string {
  const borough = boroughForSelectedArea(geographyId);
  const result = searchPlanning(borough);
  if (result.status === "no-coverage") return "Outside the pilot boroughs";
  const count = result.records.length;
  return `${count} application${count === 1 ? "" : "s"} · ${boroughLabel(borough)}`;
}
