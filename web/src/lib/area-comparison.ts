import type { AreaBrief } from "./brief-model";
import type {
  FactorId,
  GeographyId,
  MatchPack,
  MatchResult,
  PlaceFactorId,
  PlacePreference,
  PreferenceProfile,
  Quality,
} from "./contracts";
import { formatEvidenceValue, formatFactorLabel, formatPounds } from "./evidence-format";
import { DEFAULT_PROFILE } from "./fixtures";
import { searchItems } from "./match-search";
import { itemName } from "./match-words";
import { describeUnmetLimits } from "./matching";

/**
 * True for a search My match wrote (one ordered list: it keeps `order`): the old factor weights under it
 * are all 0 and mean nothing. An older weighted profile (no `order`) reads by its weights.
 */
export function isOrderedSearch(profile: PreferenceProfile): boolean {
  return Array.isArray(profile.order) && searchItems(profile).length > 0;
}

/**
 * A v4 search as set, most important first ("King's Cross (#1)", "Safer streets (must)"), places "Your place N"
 * while destinations stay out (AE-09); the budget has its own line. Empty for an older weighted profile.
 */
export function orderedNeeds(profile: PreferenceProfile, redactPlaces: boolean): string[] {
  const places = (profile.places ?? []).map((place) => place.id);
  return searchItems(profile).filter((item) => item.criterion.kind !== "budget").map((item) => {
    const criterion = item.criterion;
    const name = criterion.kind === "place" && redactPlaces ? `Your place ${places.indexOf(criterion.id) + 1}` : itemName(criterion);
    return `${name} (${item.must ? "must" : `#${item.rank}`})`;
  });
}

const MIN_AREAS = 2;
const MAX_AREAS = 4;
const MATERIAL_GAP = 15;

// UX-47: the selection bounds shared by every comparison entry point — two
// distinct areas minimum, four maximum, never a duplicate. Refusals report
// the rejected id so the tray can explain them without evicting anyone.
export const MAX_COMPARED_AREAS = MAX_AREAS;

export function applyComparisonToggle(
  current: GeographyId[],
  id: GeographyId,
): { ids: GeographyId[]; refused: GeographyId | null } {
  if (current.includes(id)) return { ids: current.filter((item) => item !== id), refused: null };
  if (current.length >= MAX_AREAS) return { ids: current, refused: id };
  return { ids: [...current, id], refused: null };
}

export function applyComparisonAdopt(ids: GeographyId[]): { ids: GeographyId[]; truncated: number } {
  return { ids: ids.slice(0, MAX_AREAS), truncated: Math.max(0, ids.length - MAX_AREAS) };
}

export interface ComparisonCell {
  state: "observed" | "unknown";
  rawValue: number | null;
  unit: string | null;
  utility: number | null;
  carrierGeographyId: GeographyId | null;
  quality: Quality | null;
  sourceVersion: string | null;
  leader: boolean;
  /** The figure as the result card shows it ("~£686k", "26 min"); "Not published" only when there is none. */
  display: string;
  /** What the figure means for this household ("estimate · £86k over your £600k limit", "72/100 fit"). */
  note: string;
  /** Carrier, quality and release: shown only behind "Sources". */
  source: string | null;
}

export interface ComparisonRow {
  factorId: FactorId | PlaceFactorId;
  /** Plain row name: "Price", a place's own label (or "Your place 1" when redacted), or the factor name. */
  label: string;
  weight: number;
  cells: ComparisonCell[];
  sharedEvidence: boolean;
  materialDifference: string | null;
}

export interface ComparisonColumn {
  result: MatchResult;
  reasons: string[];
}

export interface AreaComparison {
  release: string;
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  conclusions: string[];
}

export interface ComparisonOptions {
  /** The search brief behind the result cards: its ballpark price is the one figure for price. */
  brief?: AreaBrief | null;
  /** The decision brief keeps destinations private (AE-09): "Your place 1" instead of the label. */
  redactPlaces?: boolean;
  /** A brief shared without its budget: prices without "over / under your limit". */
  redactBudget?: boolean;
  /** A brief opened from someone else's link: "the £650k limit", never "your". */
  shared?: boolean;
}

export function buildAreaComparison(
  pack: MatchPack,
  geographyIds: GeographyId[],
  profile: PreferenceProfile,
  options: ComparisonOptions = {},
): AreaComparison {
  const columns = selectColumns(pack, geographyIds, profile);
  assertSingleRelease(columns);
  const rows = buildRows(columns, profile, options);
  return {
    release: columns[0].result.sourceReleaseSet,
    columns,
    rows,
    conclusions: buildConclusions(columns, rows, profile, options),
  };
}

/** "£686k", "£1.2m", "£950": short money for compare and brief (the card's ~£686k without the tilde). */
export function formatMoneyShort(value: number): string {
  const sign = value < 0 ? "-" : "";
  const amount = Math.abs(value);
  if (amount >= 1_000_000) return `${sign}£${(amount / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}m`;
  if (amount >= 10_000) return `${sign}£${Math.round(amount / 1000)}k`;
  return `${sign}${formatPounds(amount)}`;
}

/** The household's limit in its own terms: "£600k" to buy, "£2,500 a month" to rent. */
export function formatBudget(profile: PreferenceProfile, value: number): string {
  return profile.market === "rent" ? `${formatPounds(value)} a month` : formatMoneyShort(value);
}

/**
 * Factors whose weight the household chose: anything other than the untouched default (every
 * priority Off; the budget always counts at 3). Defaults are assumptions, never "weights you set".
 */
export function chosenFactors(profile: PreferenceProfile): PreferenceProfile["factors"] {
  return profile.factors.filter((factor) => factor.weight > 0 && factor.weight !== defaultWeight(factor.factorId));
}

export function defaultWeight(factorId: FactorId): number {
  return DEFAULT_PROFILE.factors.find((factor) => factor.factorId === factorId)?.weight ?? 0;
}

/** "matters 4 of 5" only for a weight the household picked; the untouched default says so. */
export function rowWeightLabel(row: Pick<ComparisonRow, "factorId" | "weight">): string {
  if (row.weight <= 0) return "not counted";
  const factor = !row.factorId.startsWith("place:") && !row.factorId.startsWith("custom:");
  if (factor && row.weight === defaultWeight(row.factorId as FactorId)) return "standard weight (you can change it)";
  return `matters ${row.weight} of 5`;
}

/** The plain name of a factor row: the budget reads as "Price", the rest keep their factor names. */
export function factorRowLabel(factorId: FactorId): string {
  return factorId === "affordability" ? "Price" : formatFactorLabel(factorId);
}

function selectColumns(
  pack: MatchPack,
  geographyIds: GeographyId[],
  profile: PreferenceProfile,
): ComparisonColumn[] {
  if (geographyIds.length < MIN_AREAS) throw new Error("comparison needs at least two areas");
  if (geographyIds.length > MAX_AREAS) throw new Error("comparison covers at most four areas");
  if (new Set(geographyIds).size !== geographyIds.length) {
    throw new Error("comparison needs distinct areas, not a duplicate");
  }
  return geographyIds.map((geographyId) => {
    const result = pack.values.find((candidate) => candidate.geographyId === geographyId);
    if (!result) throw new Error(`comparison unknown area: ${geographyId}`);
    return { result, reasons: describeUnmetLimits(result, profile) };
  });
}

function assertSingleRelease(columns: ComparisonColumn[]): void {
  const releases = [...new Set(columns.map((column) => column.result.sourceReleaseSet))];
  if (releases.length > 1) {
    throw new Error(`comparison release-mismatch: ${releases.join(" vs ")}`);
  }
}

function buildRows(columns: ComparisonColumn[], profile: PreferenceProfile, options: ComparisonOptions): ComparisonRow[] {
  const [first, ...rest] = orderedFactors(profile).map((factorId) => buildRow(columns, profile, factorId, options));
  const places = (profile.places ?? []).map((place, index) => placeRow(columns, place, index, options));
  // Price first, then the places travelled to (the card's trips line), then every other factor.
  if (first?.factorId === "affordability") return [first, ...places, ...rest];
  return [...places, ...[first, ...rest].filter((row): row is ComparisonRow => row !== undefined)];
}

function placeRow(columns: ComparisonColumn[], place: PlacePreference, index: number, options: ComparisonOptions): ComparisonRow {
  const factorId = `place:${place.id}` as PlaceFactorId;
  const label = options.redactPlaces ? `Your place ${index + 1}` : place.label;
  const cells = markLeaders(columns.map((column) => {
    const component = column.result.components.find((candidate) => candidate.factorId === factorId);
    if (!component) return unknownCell(label);
    const minutes = Math.round(component.rawValue);
    const within = minutes <= place.targetMinutes;
    return {
      ...observedCell(component),
      display: `${minutes} min`,
      note: `${within ? "within" : "over"} your ${place.targetMinutes} min`,
    };
  }));
  return { factorId, label, weight: place.weight, cells, sharedEvidence: false, materialDifference: null };
}

function orderedFactors(profile: PreferenceProfile): FactorId[] {
  const ids = profile.factors.map((factor) => factor.factorId);
  const priority: FactorId[] = ["affordability", "commute"];
  return [...priority.filter((id) => ids.includes(id)), ...ids.filter((id) => !priority.includes(id))];
}

function buildRow(
  columns: ComparisonColumn[],
  profile: PreferenceProfile,
  factorId: FactorId,
  options: ComparisonOptions,
): ComparisonRow {
  const weight = profile.factors.find((factor) => factor.factorId === factorId)?.weight ?? 0;
  const label = factorRowLabel(factorId);
  if (factorId === "affordability") return priceRow(columns, profile, weight, options);
  const cells = markLeaders(columns.map((column) => cellFor(column.result, factorId, label)));
  const sharedEvidence = isSharedEvidence(cells);
  return {
    factorId,
    label,
    weight,
    cells,
    sharedEvidence,
    materialDifference: sharedEvidence ? null : materialSentence(columns, cells, label),
  };
}

/**
 * Price: the result card's ballpark (the search brief's estimatedPrice) when the brief has the
 * area, so card, compare and brief show one figure; otherwise the match's own price. Either way
 * it reads against the household's limit, never as a bare "budget fit" number.
 */
function priceRow(columns: ComparisonColumn[], profile: PreferenceProfile, weight: number, options: ComparisonOptions): ComparisonRow {
  const label = "Price";
  const cells = columns.map((column): ComparisonCell => {
    const component = column.result.components.find((candidate) => candidate.factorId === "affordability");
    const area = options.brief?.areas.find((entry) => entry.geographyId === column.result.geographyId);
    const estimate = area?.estimatedPrice ?? null;
    const price = estimate ?? component?.rawValue ?? null;
    if (price === null) return unknownCell(label);
    const base = component ? observedCell(component) : unknownCell(label);
    const fromBrief = estimate !== null;
    return {
      ...base,
      state: "observed",
      rawValue: price,
      unit: "£",
      carrierGeographyId: fromBrief ? column.result.geographyId : base.carrierGeographyId,
      quality: fromBrief ? "observed" : base.quality,
      sourceVersion: fromBrief ? options.brief!.productReleaseId : base.sourceVersion,
      display: `~${formatBudget(profile, price)}`,
      note: options.redactBudget ? "estimate" : `estimate · ${limitNote(profile, price, options.shared ? "the" : "your")}`,
      source: fromBrief
        ? `${carrierName(column.result.geographyId)} · median £/m² × ${area?.assumedFloorArea ?? "an assumed"} m², a ballpark · ${options.brief!.productReleaseId}`
        : base.source,
      leader: false,
    };
  });
  const priced = cells.filter((cell) => cell.rawValue !== null);
  const lowest = priced.length > 1 ? Math.min(...priced.map((cell) => cell.rawValue!)) : null;
  const marked = cells.map((cell) => {
    const leader = lowest !== null && cell.rawValue === lowest;
    return { ...cell, leader, note: leader ? `${cell.note} · lowest` : cell.note };
  });
  return {
    factorId: "affordability",
    label,
    weight,
    cells: marked,
    sharedEvidence: false,
    materialDifference: priceSentence(columns, marked, profile, options.redactBudget ?? false, options.shared ? "the" : "your"),
  };
}

function limitNote(profile: PreferenceProfile, price: number, whose: "your" | "the" = "your"): string {
  const limit = profile.maximumBudget;
  if (price <= limit) return `within ${whose} ${formatBudget(profile, limit)} limit`;
  return `${formatBudget(profile, price - limit)} over ${whose} ${formatBudget(profile, limit)} limit`;
}

function priceSentence(columns: ComparisonColumn[], cells: ComparisonCell[], profile: PreferenceProfile, noBudget: boolean,
  whose: "your" | "the" = "your"): string | null {
  const priced = columns.flatMap((column, index) => cells[index].rawValue !== null ? [`${column.result.name} ~${formatBudget(profile, cells[index].rawValue!)}`] : []);
  if (priced.length < 2) return null;
  if (noBudget) return `Price: ${priced.join(", ")} — estimates.`;
  return `Price: ${priced.join(", ")} — estimates against ${whose} ${formatBudget(profile, profile.maximumBudget)} limit.`;
}

function cellFor(result: MatchResult, factorId: FactorId, label: string): ComparisonCell {
  const component = result.components.find((candidate) => candidate.factorId === factorId);
  if (!component) return unknownCell(label);
  return observedCell(component);
}

function observedCell(component: MatchResult["components"][number]): ComparisonCell {
  const utility = Math.round(component.utility);
  return {
    state: "observed",
    rawValue: component.rawValue,
    unit: component.unit,
    utility,
    carrierGeographyId: component.carrierGeographyId,
    quality: component.quality,
    sourceVersion: component.sourceVersion,
    leader: false,
    display: `${formatEvidenceValue(component.rawValue, component.unit ?? "")} ${component.unit}`.trim(),
    note: `${utility}/100 fit`,
    source: `${carrierName(component.carrierGeographyId)} · ${component.quality} · ${component.sourceVersion}`,
  };
}

function unknownCell(label: string): ComparisonCell {
  return {
    state: "unknown", rawValue: null, unit: null, utility: null,
    carrierGeographyId: null, quality: null, sourceVersion: null, leader: false,
    display: "Not published",
    note: `No ${label.toLowerCase()} figure for this area yet, so it isn't ranked.`,
    source: null,
  };
}

/** "LSOA E01000002": the carrier level and code, for the Sources list only. */
export function carrierName(id: GeographyId): string {
  const [, level, code] = id.split(":");
  return `${level.toUpperCase()} ${code}`;
}

/** "neighbourhood", "borough": the carrier level in words, safe to show outside Sources. */
function carrierWords(id: GeographyId): string {
  const level = id.split(":")[1];
  return level === "lsoa" ? "neighbourhood" : level === "msoa" ? "district" : level === "lad" ? "borough" : level;
}

function markLeaders(cells: ComparisonCell[]): ComparisonCell[] {
  const observed = cells.filter((cell) => cell.state === "observed");
  if (observed.length === 0) return cells;
  const best = Math.max(...observed.map((cell) => cell.utility ?? 0));
  return cells.map((cell) => {
    const leader = cell.state === "observed" && cell.utility === best;
    return { ...cell, leader, note: leader ? `${cell.note} · leads` : cell.note };
  });
}

function isSharedEvidence(cells: ComparisonCell[]): boolean {
  const observed = cells.filter((cell) => cell.state === "observed");
  if (observed.length < 2) return false;
  const first = observed[0];
  return observed.every((cell) =>
    cell.carrierGeographyId === first.carrierGeographyId && cell.rawValue === first.rawValue);
}

function materialSentence(
  columns: ComparisonColumn[],
  cells: ComparisonCell[],
  label: string,
): string | null {
  const observed = columns.flatMap((column, index) =>
    cells[index].state === "observed" ? [{ name: column.result.name, cell: cells[index] }] : []);
  if (observed.length < 2) return null;
  const utilities = observed.map((entry) => entry.cell.utility ?? 0);
  if (Math.max(...utilities) - Math.min(...utilities) < MATERIAL_GAP) return null;
  return differenceSentence(label, observed);
}

function differenceSentence(
  label: string,
  observed: { name: string; cell: ComparisonCell }[],
): string {
  const best = Math.max(...observed.map((entry) => entry.cell.utility ?? 0));
  const leaders = observed.filter((entry) => entry.cell.utility === best);
  const rest = observed.filter((entry) => entry.cell.utility !== best);
  const leaderText = leaders.map((entry) => `${entry.name} (${best}/100, ${cellRaw(entry.cell)})`).join(" and ");
  const restText = rest.map((entry) => `${entry.name} (${entry.cell.utility}/100, ${cellRaw(entry.cell)})`).join(" and ");
  return `${label} separates the shortlist: ${leaderText} ahead of ${restText}.`;
}

function cellRaw(cell: ComparisonCell): string {
  return cell.display;
}

function buildConclusions(
  columns: ComparisonColumn[],
  rows: ComparisonRow[],
  profile: PreferenceProfile,
  options: ComparisonOptions = {},
): string[] {
  return [
    weightedLine(profile, options),
    ...scoreLines(columns),
    ...exclusionLines(columns),
    ...completenessLines(columns),
    ...evidenceLines(columns, rows),
  ].filter((line) => line.length > 0);
}

function weightedLine(profile: PreferenceProfile, options: ComparisonOptions = {}): string {
  // v4: the ordered list is the search (its factor weights are all 0): name it in its order.
  if (isOrderedSearch(profile)) {
    // Musts filter rather than weigh: only the ranked criteria, in order.
    const names = orderedNeeds(profile, options.redactPlaces ?? false).filter((name) => !name.endsWith("(must)"))
      .map((name) => name.replace(/ \(#\d+\)$/, ""));
    if (names.length === 0) return "Only your must-haves are in the search, so they and the price carry the comparison.";
    return `${options.shared ? "The search weighs" : "You asked us to weigh"}, most important first: ${names.join(", ")}.`;
  }
  const chosen = chosenFactors(profile).map((factor) => factorRowLabel(factor.factorId).toLowerCase());
  if (chosen.length === 0) return "You haven't picked any priorities yet, so price and journey times carry the comparison.";
  return `You asked us to weigh ${chosen.join(", ")}.`;
}

function scoreLines(columns: ComparisonColumn[]): string[] {
  const scored = columns.filter((column) => !column.result.excluded && column.result.score !== null);
  if (scored.length === 0) {
    return ["No compared area meets your must-have limits, so there is no headline score to trust."];
  }
  const best = Math.max(...scored.map((column) => column.result.score ?? 0));
  const leaders = scored.filter((column) => column.result.score === best);
  if (leaders.length > 1) {
    const names = leaders.map((column) => column.result.name).join(" and ");
    return [`${names} tie at ${best}/100 — use the rows below, not the headline score.`];
  }
  return [`${leaders[0].result.name} leads on the headline score (${best}/100).`];
}

function exclusionLines(columns: ComparisonColumn[]): string[] {
  return columns
    .filter((column) => column.result.excluded)
    .map((column) => `${column.result.name} is excluded: ${column.reasons.join("; ")}.`);
}

function completenessLines(columns: ComparisonColumn[]): string[] {
  return columns
    .filter((column) => column.result.evidenceCompleteness < 100)
    .map((column) =>
      `${column.result.name} is missing ${100 - column.result.evidenceCompleteness}% of weighted evidence.`);
}

function evidenceLines(columns: ComparisonColumn[], rows: ComparisonRow[]): string[] {
  // Rows outside the score ("Not in your score") stay out of the conclusions.
  return rows.filter((row) => row.weight > 0).flatMap((row) => evidenceLine(columns, row));
}

function evidenceLine(columns: ComparisonColumn[], row: ComparisonRow): string[] {
  const label = row.label;
  if (row.sharedEvidence) {
    const carrier = row.cells.find((cell) => cell.carrierGeographyId)?.carrierGeographyId;
    return [`${label} comes from one shared ${carrier ? carrierWords(carrier) : "wider-area"} figure, counted once rather than as separate signals.`];
  }
  const unknown = columns.filter((_, index) => row.cells[index].state === "unknown");
  if (unknown.length > 0 && unknown.length < columns.length) {
    const names = unknown.map((column) => column.result.name).join(" and ");
    return [`We have no ${label.toLowerCase()} figure for ${names}, so it stays unknown and isn't ranked on it.`];
  }
  return row.materialDifference ? [row.materialDifference] : [];
}
