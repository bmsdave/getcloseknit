/**
 * What a ranking list adds around its table (C8): a one-sentence takeaway, the bars' one chart colour,
 * and the neighbourhood that stands for a row when it is compared or used to find areas
 * like it (comparison and "Like this" work on neighbourhoods, LSOAs).
 */
import { descendants, LENSES, type AreaIndex, type AreaRanking, type RankingRow } from "@/lib/area-pages";
import type { GeographyId } from "@/lib/contracts";
import { isTypicalPriceLayer, typicalPriceWords } from "@/lib/typical-price";

const SUFFIX: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };

function ordinal(n: number): string {
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? "th" : SUFFIX[n % 10] ?? "th"}`;
}

/** The figure in words: crime, deprivation, station walks, food hygiene and typical prices say what their number counts. */
export function rankingFigure(ranking: AreaRanking, display: string): string {
  if (ranking.kind === "lens") {
    const lens = LENSES[ranking.preset];
    if (lens.formula === "nearest") return `a ${display} walk to a market`;
    return lens.formula === "variety" ? `${display} ${lens.places}` : `${display} ${lens.places} per km²`;
  }
  if (ranking.kind === "count") return `${display} state ${ranking.phase} school${display === "1" ? "" : "s"}`;
  if (ranking.metric === "crime") return `${display} crimes per 1,000 residents`;
  if (ranking.metric === "deprivation") return `an average decile of ${display}`;
  if (ranking.metric === "station-access") return `a ${display} walk to a station`;
  if (ranking.metric === "food-hygiene") return `${display} of food places rated 4–5`;
  if (isTypicalPriceLayer(ranking.metric)) return `${display} for ${typicalPriceWords(ranking.metric)}`;
  return display;
}

/** One sentence above the table: the first row and the last, in words; null with no rows. */
export function rankingTakeaway(ranking: AreaRanking, rows: readonly RankingRow[]): string | null {
  const first = rows[0];
  if (!first) return null;
  if (rows.length === 1) return `${first.name} is the only area with a figure here, at ${rankingFigure(ranking, first.display)}.`;
  const last = rows[rows.length - 1];
  return `${first.name} comes first, at ${rankingFigure(ranking, first.display)}; ${last.name} is ${ordinal(last.rank)}, at ${rankingFigure(ranking, last.display)}.`;
}

/**
 * A row's bar colour: one chart token for the whole list. The bar's length carries the figure;
 * an alarm colour would judge an end the reader may want (most expensive, most nightlife).
 */
export const RANKING_BAR_COLOUR = "var(--chart-1)";

/**
 * The neighbourhood (LSOA) that stands for an area (MSOA) row: the one whose own figure is nearest the
 * row's, else the first by name when the figure is published only for the whole area. Boroughs have none.
 */
export function typicalNeighbourhood(index: AreaIndex, ranking: AreaRanking, row: RankingRow): GeographyId | null {
  if (row.area.carrier !== "msoa") return null;
  const lsoas = descendants(index, row.area.geographyId, "lsoa");
  // A lens or a school count is published for the whole area only.
  const values = ranking.kind !== "metric" ? new Map<GeographyId, { value: number | null }>() : index.values[ranking.metric];
  const nearest = lsoas
    .flatMap((lsoa) => { const value = values.get(lsoa.geographyId)?.value; return value == null ? [] : [{ id: lsoa.geographyId, gap: Math.abs(value - row.value) }]; })
    .sort((a, b) => a.gap - b.gap)[0];
  return nearest?.id ?? lsoas[0]?.geographyId ?? null;
}
