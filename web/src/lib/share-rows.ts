/**
 * One row per category beside London: the People and Homes sections. Each row is the
 * area's share as a bar, London's share as a tick on the same scale, the share in words and a
 * difference chip only when the gap is 5 points or more. Unordered topics show the top four and fold
 * the rest into "Other"; ordered topics (ages) keep their natural order. Descriptive only: no row is
 * ever rated better or worse, and religion gets no lead line.
 */
import type { PropertyTypeCode } from "./market";
import type { PeopleCategory, PeoplePopulation, PeopleTopicId } from "./people-profile";
import { PEOPLE_TOPICS, sortCategories } from "./people-profile";

export const CHIP_POINTS = 5;
export const TOP_ROWS = 4;

export interface ShareRow {
  id: string;
  label: string;
  share: number | null;
  regionShare: number | null;
  /** "+14" / "−14" points against London, or null under CHIP_POINTS. */
  chip: string | null;
}

/** Percent in words: "39%", "<1%" for a sliver, "unknown" without a figure. */
export function sharePercent(share: number | null): string {
  if (share === null) return "unknown";
  const percent = share * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

export function shareChip(share: number | null, london: number | null): string | null {
  if (share === null || london === null) return null;
  const points = Math.round((share - london) * 100);
  if (Math.abs((share - london) * 100) < CHIP_POINTS) return null;
  return `${points > 0 ? "+" : "−"}${Math.abs(points)}`;
}

function row(category: Pick<PeopleCategory, "id" | "label" | "share" | "regionShare">): ShareRow {
  return { id: category.id, label: category.label, share: category.share, regionShare: category.regionShare,
    chip: shareChip(category.share, category.regionShare) };
}

/**
 * The rows a topic shows: every category for an ordered topic or a short list; otherwise the top four
 * by share and one "Other" row for the rest (all of them when expanded). `folded` says whether a
 * "Show all" has anything to add.
 */
export function shareRows(topic: PeopleTopicId, categories: readonly PeopleCategory[], expanded = false, keep: readonly string[] = []): { rows: ShareRow[]; folded: boolean } {
  if (PEOPLE_TOPICS[topic].ordered) return { rows: categories.map(row), folded: false };
  const byShare = sortCategories([...categories]).sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
  // The household's own types come first (reorder and highlight) and never fold into Other.
  const sorted = [...byShare.filter((category) => keep.includes(category.id)), ...byShare.filter((category) => !keep.includes(category.id))];
  if (sorted.length <= TOP_ROWS + 1) return { rows: sorted.map(row), folded: false };
  if (expanded) return { rows: sorted.map(row), folded: true };
  const shown = sorted.filter((category, index) => index < TOP_ROWS || keep.includes(category.id));
  const rest = sorted.filter((category) => !shown.includes(category));
  if (rest.length === 0) return { rows: shown.map(row), folded: false };
  const sum = (pick: (category: PeopleCategory) => number | null) => rest.some((category) => pick(category) === null)
    ? null : rest.reduce((total, category) => total + (pick(category) ?? 0), 0);
  return {
    rows: [...shown.map(row), row({ id: "other", label: "Other", share: sum((c) => c.share), regionShare: sum((c) => c.regionShare) })],
    folded: true,
  };
}

/** The bars' scale: the largest share (area or London) rounded up to the next 10%. */
export function shareScale(rows: readonly ShareRow[]): number {
  const top = Math.max(0, ...rows.flatMap((entry) => [entry.share ?? 0, entry.regionShare ?? 0]));
  return top > 0 ? Math.min(1, Math.ceil(top * 10 - 1e-9) / 10) : 1;
}

/**
 * A plain lead line from the largest gap of 5 points or more: "Aged 65 and over: 28% here, 12% in
 * London". None for religion (descriptive only) or when nothing stands apart.
 */
export function leadLine(topic: PeopleTopicId, categories: readonly PeopleCategory[], scope = "London"): string | null {
  if (topic === "religion") return null;
  const gaps = categories
    .filter((category) => category.share !== null && category.regionShare !== null)
    .map((category) => ({ category, gap: Math.abs(category.share! - category.regionShare!) }))
    .sort((a, b) => b.gap - a.gap);
  const top = gaps[0];
  if (!top || top.gap * 100 < CHIP_POINTS) return null;
  const label = topic === "age" ? `Aged ${top.category.label.replace(/ to /, "–")}` : top.category.label;
  return `${label}: ${sharePercent(top.category.share)} here, ${sharePercent(top.category.regionShare)} in ${scope}`;
}

/** "2,898 people / km² · half London's density"; null without a density. */
export function densityWords(population: PeoplePopulation | null, scope = "London"): string | null {
  if (!population?.densityPerKm2) return null;
  const density = `${Math.round(population.densityPerKm2).toLocaleString("en-GB")} people / km²`;
  if (!population.regionDensityPerKm2) return density;
  const ratio = population.densityPerKm2 / population.regionDensityPerKm2;
  const words = ratio >= 0.9 && ratio <= 1.1 ? `about ${scope}'s density`
    : ratio >= 0.45 && ratio <= 0.55 ? `half ${scope}'s density`
      : ratio >= 1.9 && ratio <= 2.1 ? `twice ${scope}'s density`
        : ratio < 1 ? `${Math.round(ratio * 100)}% of ${scope}'s density` : `${ratio.toFixed(1)}× ${scope}'s density`;
  return `${density} · ${words}`;
}

/**
 * The official deprivation index in deciles (a higher percentile is less deprived), never "100%":
 * "Deprivation: among London's least deprived 10%".
 */
export function deprivationWords(percentile: number | null, scope = "London"): string | null {
  if (percentile === null || !Number.isFinite(percentile)) return null;
  if (percentile > 40 && percentile < 60) return `Deprivation: around ${scope}'s middle`;
  if (percentile >= 60) return `Deprivation: among ${scope}'s least deprived ${Math.min(40, Math.max(10, Math.ceil((100 - percentile) / 10) * 10))}%`;
  return `Deprivation: among ${scope}'s most deprived ${Math.min(40, Math.max(10, Math.ceil(percentile / 10) * 10))}%`;
}

/** Census home types per market type, for highlighting the household's types in Homes. */
const ACCOMMODATION: Record<PropertyTypeCode, readonly string[]> = {
  D: ["detached"], S: ["semi-detached"], T: ["terraced"], F: ["purpose-built-flat", "converted-flat", "other-converted"], O: [],
};

export function accommodationIds(types: readonly PropertyTypeCode[]): string[] {
  return types.flatMap((type) => ACCOMMODATION[type]);
}
