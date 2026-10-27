/**
 * /compare (Compare v2): one kind at a time, never mixed. Places (areas, districts and boroughs side
 * by side), Schools or Homes; cafés, gyms and other places are never compared. Pure: the page loads
 * each column's payload and this turns them into rows; the best value of a row is marked only where
 * "better" has one direction and the values differ. A missing figure stays "—", never a guess.
 */
import { areaDisplayName } from "./area-labels";
import type { AreaProfileResponse, GeographyId, MatchPack, PreferenceProfile } from "./contracts";
import { searchItems } from "./match-search";
import type { PropertyProfile } from "./property-profile";
import { shortPounds } from "./property-profile";
import { formatDistance, ofstedStanding, schoolPath, type SchoolCard } from "./school-card";
import { PRICE_TILE_SOURCE, type AreaStandouts, type StandoutTileId } from "./standouts";

export type CompareKind = "places" | "schools" | "homes";

export const COMPARE_KINDS: readonly { id: CompareKind; label: string }[] = [
  { id: "places", label: "Places" },
  { id: "schools", label: "Schools" },
  { id: "homes", label: "Homes" },
];

export const MAX_COMPARE_COLUMNS = 4;

const ID_PATTERNS: Record<CompareKind, RegExp> = {
  places: /^uk:(lsoa|msoa|lad):E\d{8}$/,
  schools: /^\d{6}$/,
  homes: /^\d{1,12}$/,
};

export function isCompareKind(value: unknown): value is CompareKind {
  return value === "places" || value === "schools" || value === "homes";
}

/** The ids a kind accepts, in order, once each, at most four. */
export function cleanCompareIds(kind: CompareKind, ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => ID_PATTERNS[kind].test(id)))].slice(0, MAX_COMPARE_COLUMNS);
}

export function compareHref(kind: CompareKind, ids: readonly string[]): string {
  const clean = cleanCompareIds(kind, ids);
  return `/compare?kind=${kind}${clean.length ? `&ids=${clean.map(encodeURIComponent).join(",")}` : ""}`;
}

/** ?kind=…&ids=a,b from the page's search params (Places when the kind is missing or unknown). */
export function parseCompareQuery(params: Record<string, string | string[] | undefined>): { kind: CompareKind; ids: string[] } {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const kind = isCompareKind(first(params.kind)) ? first(params.kind) as CompareKind : "places";
  return { kind, ids: cleanCompareIds(kind, first(params.ids).split(",").map((id) => id.trim()).filter(Boolean)) };
}

export interface CompareColumn {
  id: string;
  name: string;
  /** "Area", "Borough", "Primary school", "Flat". */
  tag: string;
  href: string | null;
  /** Areas: the postcode district (for the homes-for-sale links); absent for schools and homes. */
  outcode?: string | null;
}

export interface CompareCell {
  text: string;
  best: boolean;
  /** 0–1 against the row's largest value, for a satin bar; null: no bar. */
  bar: number | null;
}

export interface CompareRow {
  label: string;
  cells: CompareCell[];
  /** Where the row's figures come from, shown on hover (the Price row: PRICE_TILE_SOURCE). */
  note?: string;
}

export interface CompareTable {
  kind: CompareKind;
  columns: CompareColumn[];
  rows: CompareRow[];
}

type Better = "low" | "high" | null;
interface Value { text: string; value: number | null }

const NONE: Value = { text: "—", value: null };

/**
 * One row: the best cell (lowest or highest) when at least two values differ; bars when asked for. A longer
 * bar is always the better value, so on a lower-is-better row (price, minutes, metres) the lowest has the full bar
 * and each other is lowest ÷ its value; a row with no better side draws value ÷ largest.
 */
export function compareRow(label: string, better: Better, bars: boolean, values: readonly Value[]): CompareRow {
  const numbers = values.map((entry) => entry.value).filter((value): value is number => value !== null);
  const differ = numbers.length >= 2 && numbers.some((value) => value !== numbers[0]);
  const target = better && differ ? (better === "low" ? Math.min(...numbers) : Math.max(...numbers)) : null;
  const max = numbers.length ? Math.max(...numbers) : 0;
  const min = numbers.length ? Math.min(...numbers) : 0;
  const barred = bars && max > 0 && numbers.every((value) => value >= 0);
  const length = (value: number) => (better === "low" ? (value === min ? 1 : min / value) : value / max);
  return {
    label,
    cells: values.map((entry) => ({
      text: entry.text,
      best: target !== null && entry.value === target,
      bar: barred && entry.value !== null ? Math.max(0.06, length(entry.value)) : null,
    })),
  };
}

/**
 * A bar's colour says who wins its row, not which column it sits in. The winner's bar
 * is --chart-good; every other bar, and every bar in a row with no winner, is --chart-neutral.
 */
export function barColour(best: boolean): string {
  return best ? "var(--chart-good)" : "var(--chart-neutral)";
}

/** Rows whose every cell is "—" say nothing and are left out. */
function known(rows: CompareRow[]): CompareRow[] {
  return rows.filter((row) => row.cells.some((cell) => cell.text !== NONE.text));
}

// ---- Places ------------------------------------------------------------------------------------

const CARRIER_TAGS: Record<string, string> = { lsoa: "Area", msoa: "District", lad: "Borough" };

export interface PlaceColumnInput {
  id: GeographyId;
  /** The name people use, when the caller knows it ("Highbury · N5"). */
  name?: string | null;
  profile: AreaProfileResponse | null;
  /** Its postcode district, for the homes-for-sale links. */
  outcode?: string | null;
  /** The area page's 12 tiles (neighbourhoods and boroughs); null or absent for a district. */
  standouts?: AreaStandouts | null;
}

function metric(profile: AreaProfileResponse | null, id: string): number | null {
  const value = profile?.metrics.find((entry) => entry.metricId === id)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "£9.8k" per m²; "£850" below a thousand. */
const perUnit = (n: number) => (n >= 1000 ? `£${(n / 1000).toFixed(1)}k` : `£${Math.round(n)}`);

const value = (number: number | null, text: (n: number) => string): Value => (number === null ? NONE : { text: text(number), value: number });

/**
 * A row in the area page's tile words. With every area's tile, the best is the one its London standing calls better
 * (100 = the better end: safer, quieter, nearer a station, more schools); a tile's display has no raw figure to rank
 * by. Otherwise (a district, no tiles) each cell is its profile's figure, ranked `fallback`.
 */
function tileRow(label: string, id: StandoutTileId, inputs: readonly PlaceColumnInput[], fallback: "low" | "high",
  byFigure: (input: PlaceColumnInput, index: number) => Value, byStanding = true): CompareRow {
  const tiles = inputs.map((input) => input.standouts?.tiles.find((tile) => tile.id === id));
  if (byStanding && tiles.every((tile) => tile?.available && tile.display && tile.standing !== null)) {
    return compareRow(label, "high", true, tiles.map((tile) => ({ text: tile!.display!, value: tile!.standing })));
  }
  return compareRow(label, fallback, true, inputs.map(byFigure));
}

/** The schools tile's count: its figure, else the number its words start with ("26 within 1.5 km"). */
function schoolCount(input: PlaceColumnInput): number | null {
  const tile = input.standouts?.tiles.find((entry) => entry.id === "schools");
  if (typeof tile?.value === "number") return tile.value;
  const count = /^(\d+)/.exec(tile?.display ?? "")?.[1];
  return count === undefined ? null : Number(count);
}

export function placesTable(inputs: readonly PlaceColumnInput[]): CompareTable {
  const columns = inputs.map((input) => {
    const carrier = input.id.split(":")[1];
    const code = input.id.split(":")[2];
    return { id: input.id, name: input.name || areaDisplayName(input.profile) || code, tag: CARRIER_TAGS[carrier] ?? "Area", href: `/area/${carrier}/${code}`, outcode: input.outcode ?? null };
  });
  const ranks = inputs.map((input) => input.profile?.regionRanks ?? null);
  // The area page's own tile words ("Safer than 62%", "14 within 1.5 km", "38% over 55 dB"), so Compare and the
  // area page never disagree; a row ranks by the tile's figure (crime rate, count, minutes, share at 55 dB+). An area
  // without tiles (a district) shows its profile's figure in the same units.
  const cell = (index: number, id: StandoutTileId, fallback: number | null, words: (n: number) => string): Value => {
    const tile = inputs[index].standouts?.tiles.find((entry) => entry.id === id);
    if (tile?.available && tile.display) return { text: tile.display, value: typeof tile.value === "number" ? tile.value : fallback };
    return value(fallback, words);
  };
  const share = (input: PlaceColumnInput) => {
    const any55 = input.profile?.noise?.any55Share ?? null;
    return any55 === null ? null : Math.round(any55 * 100);
  };
  const rows = [
    { ...compareRow("Price", "low", true, inputs.map((input, index) =>
      cell(index, "price", metric(input.profile, "price-per-square-metre"), (n) => `${perUnit(n)}/m²`))), note: PRICE_TILE_SOURCE },
    tileRow("Safety", "safety", inputs, "low", (input, index) =>
      cell(index, "safety", metric(input.profile, "crime"), (n) => `${n.toFixed(1)} / 1,000`)),
    // "26 within 1.5 km" beats "20 within 1.5 km": ranked by the count it shows, not the schools standing
    // (a London rank of school results, which can call the area with fewer schools better).
    tileRow("Schools", "schools", inputs, "high", (_input, index) => cell(index, "schools", schoolCount(inputs[index]), String), false),
    tileRow("Station walk", "station-walk", inputs, "low", (_input, index) =>
      cell(index, "station-walk", ranks[index]?.gettingAround?.value ?? null, (n) => `${Math.round(n)} min`)),
    tileRow("Noise", "noise", inputs, "low", (input, index) => cell(index, "noise", share(input), (n) => `${n}% over 55 dB`)),
    compareRow("Park", "low", true, ranks.map((rank) => value(rank?.greenSpace?.value ?? null, formatDistance))),
  ];
  return { kind: "places", columns, rows: known(rows) };
}

/**
 * CUJ03 step 2: the household's search on top of the areas' rows: its match score first
 * (0–100, "Out" for an area failing a Must), then after Schools one row per place it travels to (door-to-door
 * minutes as the search scored them). No pack (no search, or still loading): the rows as they are.
 */
export function withSearchRows(table: CompareTable, pack: MatchPack | null, profile: PreferenceProfile): CompareRow[] {
  if (table.kind !== "places" || !pack) return table.rows;
  const results = table.columns.map((column) => pack.values.find((entry) => entry.geographyId === column.id) ?? null);
  const match = compareRow("Match", "high", true, results.map((result) => {
    if (!result) return NONE;
    if (result.excluded) return { text: "Out", value: null };
    return result.score === null ? NONE : { text: String(result.score), value: result.score };
  }));
  const places = searchItems(profile).flatMap((item) => (item.criterion.kind !== "place" ? [] : [
    compareRow(item.criterion.label, "low", true, results.map((result) => {
      const component = result?.components.find((entry) => entry.factorId === item.id);
      return component ? { text: `${Math.round(component.rawValue)} min`, value: Math.round(component.rawValue) } : NONE;
    })),
  ]));
  // After Schools (or Safety, or Price when a row is left out for want of figures): the trips sit with the area's basics.
  const after = ["Schools", "Safety", "Price"].map((label) => table.rows.findIndex((row) => row.label === label)).find((at) => at >= 0) ?? -1;
  return known([match, ...table.rows.slice(0, after + 1), ...places, ...table.rows.slice(after + 1)]);
}

// ---- Schools -----------------------------------------------------------------------------------

const PHASES: Record<string, string> = { primary: "Primary", secondary: "Secondary" };

function ofstedValue(card: SchoolCard): Value {
  const standing = ofstedStanding(card.history.inspections);
  if (!standing) return NONE;
  // Legacy grades rank 1 (Outstanding) to 4; report cards have no single grade, so no "best".
  if (standing.kind === "legacy") return { text: standing.grade, value: 5 - standing.overall };
  return { text: "Report card", value: null };
}

export function schoolsTable(cards: readonly { urn: string; card: SchoolCard | null }[]): CompareTable {
  const columns = cards.map(({ urn, card }) => ({
    id: urn,
    name: card?.school.name ?? `School ${urn}`,
    tag: card ? `${PHASES[card.school.phase] ?? "School"}` : "School",
    href: schoolPath(urn),
  }));
  // Headline results as each card names them; a measure one school lacks shows "—".
  const measures = [...new Map(cards.flatMap(({ card }) => card?.kpis ?? []).map((kpi) => [kpi.measure, kpi.label]))];
  const rows = [
    compareRow("Ofsted", "high", false, cards.map(({ card }) => (card ? ofstedValue(card) : NONE))),
    ...measures.map(([measure, label]) => compareRow(label, "high", true, cards.map(({ card }) => {
      const kpi = card?.kpis.find((entry) => entry.measure === measure);
      // Best by London percentile: measures differ in units, the percentile reads the same way.
      return kpi && kpi.valueText && !kpi.missingReason ? { text: kpi.valueText, value: kpi.percentile } : NONE;
    }))),
    compareRow("Got in from", "high", true, cards.map(({ card }) => {
      const offered = card?.admissions.lastOffered.find((row) => row.distanceMetres !== null);
      return value(offered?.distanceMetres ?? null, formatDistance);
    })),
    compareRow("Pupils", null, false, cards.map(({ card }) => value(card?.details.pupils ?? null, (n) => n.toLocaleString("en-GB")))),
  ];
  return { kind: "schools", columns, rows: known(rows) };
}

// ---- Homes -------------------------------------------------------------------------------------

const EPC_ORDER = ["G", "F", "E", "D", "C", "B", "A"];

function homeType(profile: PropertyProfile): string {
  return [profile.facts.builtForm, profile.facts.propertyType].filter(Boolean).join(" ").trim() || "Home";
}

export function homesTable(homes: readonly { uprn: string; profile: PropertyProfile | null }[]): CompareTable {
  const columns = homes.map(({ uprn, profile }) => ({
    id: uprn,
    name: profile?.displayAddress.split(",")[0] ?? `Home ${uprn}`,
    tag: profile?.facts.propertyType ?? "Home",
    href: `/property/${uprn}`,
  }));
  const rows = [
    compareRow("Type", null, false, homes.map(({ profile }) => (profile ? { text: homeType(profile), value: null } : NONE))),
    compareRow("Size", "high", true, homes.map(({ profile }) =>
      value(profile?.facts.floorAreaSquareMetres ?? null, (n) => `${Math.round(n)} m²`))),
    compareRow("EPC", "high", false, homes.map(({ profile }) => {
      const rating = profile?.facts.energyRating ?? null;
      const rank = rating ? EPC_ORDER.indexOf(rating.toUpperCase()) : -1;
      return rating ? { text: rating.toUpperCase(), value: rank < 0 ? null : rank } : NONE;
    })),
    compareRow("Tenure", null, false, homes.map(({ profile }) => (profile?.facts.tenure ? { text: profile.facts.tenure, value: null } : NONE))),
    // A recorded sale is a fact with its date; never an estimate for the home today.
    compareRow("Last sale", null, false, homes.map(({ profile }) => {
      const sale = profile?.sales[0];
      return sale ? { text: `${shortPounds(sale.price)} · ${sale.date.slice(0, 4)}`, value: null } : NONE;
    })),
    compareRow("Sale position", null, false, homes.map(({ profile }) => {
      const position = profile?.areaPrices.position;
      return position ? { text: position.bandWords, value: null } : NONE;
    })),
    compareRow("Area prices", null, false, homes.map(({ profile }) => {
      const range = profile?.areaPrices.range;
      return range ? { text: `${shortPounds(range.p25)}–${shortPounds(range.p75)}`, value: null } : NONE;
    })),
  ];
  return { kind: "homes", columns, rows: known(rows) };
}
