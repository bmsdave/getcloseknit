import type { GeographyId } from "./contracts";
import type { HelpId } from "./help-texts";
import type { DataMode } from "./map-state";
import type { RankScope } from "./scope-name";

/**
 * Homes here for one area: density (ONS mid-year estimates) and Census 2021
 * counts by topic, each with London's share of the same category. Contract of
 * GET /api/v1/areas/{id}/people (api/area_api/people.py). The payload carries
 * every Census topic; the page shows the homes, households and ages ones.
 */
export const PEOPLE_TOPIC_IDS = [
  "ethnicity",
  "religion",
  "qualification",
  "occupation",
  "economic-activity",
  "tenure",
  "accommodation",
  "age",
  "household-type",
  "country-of-birth",
] as const;

export type PeopleTopicId = (typeof PEOPLE_TOPIC_IDS)[number];

export interface PeopleCategory {
  id: string;
  label: string;
  /** null when the area has no Census figure: shown as unknown, never 0. */
  count: number | null;
  share: number | null;
  regionShare: number | null;
}

export interface PeopleTopic {
  id: PeopleTopicId;
  total: number | null;
  categories: PeopleCategory[];
}

export interface PeoplePopulation {
  residents: number;
  year: number;
  areaKm2: number;
  densityPerKm2: number | null;
  regionDensityPerKm2: number | null;
  sourceVersion: string;
}

export interface PeopleSource {
  id: string;
  attribution: string;
  caveats: string[];
}

export interface AreaPeopleResponse {
  schemaVersion: "area-people.v1";
  productReleaseId?: string;
  geographyId: GeographyId;
  name: string | null;
  kind: "lsoa" | "msoa" | "lad";
  /** The region the "London" shares are of (API rankScope); absent = London. */
  rankScope?: RankScope | null;
  population: PeoplePopulation | null;
  censusYear: 2021;
  topics: PeopleTopic[];
  sources: PeopleSource[];
}

export interface PeopleTopicMeta {
  title: string;
  /** Who the Census counted: "of 1,474 residents". */
  universe: string;
  help: HelpId;
  /** Categories keep the Census order (age bands) instead of largest first. */
  ordered?: boolean;
}

export const PEOPLE_TOPICS: Record<PeopleTopicId, PeopleTopicMeta> = {
  ethnicity: { title: "Ethnic group", universe: "residents", help: "people-ethnicity" },
  religion: { title: "Religion", universe: "residents", help: "people-religion" },
  qualification: { title: "Highest qualification", universe: "residents aged 16+", help: "people-qualification" },
  occupation: { title: "Jobs", universe: "working residents", help: "people-occupation" },
  "economic-activity": { title: "Work and study", universe: "residents aged 16+", help: "people-work" },
  tenure: { title: "Owned or rented", universe: "households", help: "people-tenure" },
  accommodation: { title: "Type of home", universe: "households", help: "people-home-type" },
  age: { title: "Residents' age", universe: "residents", help: "people-age", ordered: true },
  "household-type": { title: "Household type", universe: "households", help: "people-household-type" },
  "country-of-birth": { title: "Country of birth", universe: "residents", help: "people-country-of-birth" },
};

/**
 * The topics the page shows: the homes, the households and ages in them, then ethnic group, country
 * of birth (world regions) and religion, the full breakdown behind each Census map layer
 * (lib/census-layers.ts). Qualifications, jobs and work are not shown.
 */
export const PEOPLE_GROUPS: Array<{ title: string; topics: PeopleTopicId[] }> = [
  { title: "The homes", topics: ["accommodation", "tenure"] },
  { title: "Households and ages", topics: ["household-type", "age"] },
  { title: "Ethnic group, country of birth and religion", topics: ["ethnicity", "country-of-birth", "religion"] },
];

/** Rows shown before "Show all"; a topic with one more row than this shows everything. */
export const PEOPLE_TOP_ROWS = 5;

export function areaPeoplePath(id: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/people`;
}

export type AreaPeopleState =
  | { status: "available"; people: AreaPeopleResponse }
  | { status: "unavailable"; reason: string };

/** Demo payloads carry `preview-` source ids; real mode never shows them. */
export function readAreaPeople(payload: unknown, mode: DataMode): AreaPeopleState {
  const people = payload as Partial<AreaPeopleResponse> | null;
  if (!people || people.schemaVersion !== "area-people.v1" || !Array.isArray(people.topics) || !Array.isArray(people.sources)) {
    return { status: "unavailable", reason: "invalid-people-response" };
  }
  const versions = [...people.sources.map((source) => source.id), people.population?.sourceVersion ?? ""];
  if (mode === "real" && versions.some((version) => version.startsWith("preview-"))) {
    return { status: "unavailable", reason: "fixture-people-in-real-mode" };
  }
  return { status: "available", people: people as AreaPeopleResponse };
}

/** Largest first; unknown counts keep their order at the end. */
export function sortCategories(categories: PeopleCategory[]): PeopleCategory[] {
  return categories
    .map((category, index) => ({ category, index }))
    .sort((a, b) => (b.category.count ?? -1) - (a.category.count ?? -1) || a.index - b.index)
    .map(({ category }) => category);
}

/** Census order for ordered topics (age bands), otherwise largest first. */
export function orderedCategories(id: PeopleTopicId, categories: PeopleCategory[]): PeopleCategory[] {
  return PEOPLE_TOPICS[id].ordered ? categories : sortCategories(categories);
}

export function visibleCategories(categories: PeopleCategory[], expanded: boolean): { rows: PeopleCategory[]; hidden: number } {
  const sorted = sortCategories(categories);
  if (expanded || sorted.length <= PEOPLE_TOP_ROWS + 1) return { rows: sorted, hidden: 0 };
  return { rows: sorted.slice(0, PEOPLE_TOP_ROWS), hidden: sorted.length - PEOPLE_TOP_ROWS };
}

/** Bars share one scale per topic so the biggest row (area or London) fills the track. */
export function barScale(categories: PeopleCategory[]): number {
  const largest = Math.max(0, ...categories.flatMap((category) => [category.share ?? 0, category.regionShare ?? 0]));
  return largest > 0 ? largest : 1;
}

export function formatShare(share: number | null): string {
  if (share === null) return "unknown";
  const percent = share * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

export function formatCount(count: number | null): string {
  return count === null ? "unknown" : count.toLocaleString("en-GB");
}

/** "3 times the London average" style comparison for density; null when either side is unknown. */
export function densityRatio(population: PeoplePopulation | null): number | null {
  if (!population?.densityPerKm2 || !population.regionDensityPerKm2) return null;
  return population.densityPerKm2 / population.regionDensityPerKm2;
}

export function densityComparison(population: PeoplePopulation | null): string {
  const ratio = densityRatio(population);
  if (ratio === null) return "London comparison unknown";
  if (ratio >= 0.9 && ratio <= 1.1) return "about the London average";
  if (ratio > 1) return `${ratio >= 2 ? `${ratio.toFixed(1)} times` : `${Math.round((ratio - 1) * 100)}% more than`} the London average`;
  return `${Math.round((1 - ratio) * 100)}% less than the London average`;
}
