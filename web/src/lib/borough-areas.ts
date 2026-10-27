/**
 * The borough page's Areas list: each neighbourhood with its £/m² and three London
 * strips, sortable by price, crime, schools or name, the sort kept in the address (?sort=).
 */
import { areaDisplayName } from "./area-labels";
import { areaPath, descendants, formatPerSquareMetre, NAME_ORDER, type AreaIndex } from "./area-pages";
import type { GeographyId } from "./contracts";
import type { NeighbourhoodStrip } from "./standouts";

/** One neighbourhood in the list; a null figure is unknown, never 0. */
export interface BoroughAreaRow {
  id: GeographyId;
  name: string;
  /** "4 neighbourhoods": a wider neighbourhood's row (its neighbourhoods share its name); never a code. */
  note: string | null;
  href: string;
  price: number | null;
  priceDisplay: string;
  /** Neutral: the raw London percentile (higher is dearer). */
  pricePosition: number | null;
  /** 100 = safer than all of London. */
  safety: number | null;
  /** The best primary within 1 km among London's primaries. */
  schools: number | null;
}

export type BoroughAreaSort = "price" | "crime" | "schools" | "name";

export const BOROUGH_AREA_SORTS: readonly { id: BoroughAreaSort; label: string }[] = [
  { id: "price", label: "Price" }, { id: "crime", label: "Crime" }, { id: "schools", label: "Schools" }, { id: "name", label: "A–Z" },
];

/** The list's first rows; "Show all" unfolds the rest. */
export const FIRST_AREAS = 10;

export function boroughAreaSortParam(value: string | string[] | undefined): BoroughAreaSort {
  const id = Array.isArray(value) ? value[0] : value;
  return BOROUGH_AREA_SORTS.find((entry) => entry.id === id)?.id ?? "price";
}

/** Dearest first, least crime first, best schools first, or A to Z; an unknown figure sits last, then A to Z. */
export function sortBoroughAreas(rows: readonly BoroughAreaRow[], sort: BoroughAreaSort): BoroughAreaRow[] {
  const name = (a: BoroughAreaRow, b: BoroughAreaRow) => NAME_ORDER.compare(a.name, b.name);
  const key = (row: BoroughAreaRow) => sort === "price" ? row.price : sort === "crime" ? row.safety : sort === "schools" ? row.schools : null;
  return [...rows].sort((a, b) => {
    if (sort === "name") return name(a, b);
    const x = key(a);
    const y = key(b);
    if (x === null || y === null) return x === y ? name(a, b) : x === null ? 1 : -1;
    return y - x || name(a, b);
  });
}

/** The middle of the known values (null with none), rounded as the strips and £/m² show them. */
function middleOf(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (known.length === 0) return null;
  const half = Math.floor(known.length / 2);
  return Math.round(known.length % 2 ? known[half] : (known[half - 1] + known[half]) / 2);
}

/**
 * The borough's areas, one distinct name per row: its neighbourhoods (LSOAs) take the
 * name of the wider neighbourhood (MSOA) they sit in, so they are grouped into it, one row with the
 * middle of their figures that opens the MSOA's area page. A wider neighbourhood with one neighbourhood
 * is that neighbourhood's row. Price and crime from the area pages' figures (as /area/london shows them),
 * the school strip from the borough's standouts (the API's best-primary rank per neighbourhood). Never
 * an official code like "Ealing 034A".
 */
export function boroughAreaRows(index: AreaIndex, borough: GeographyId, strips: readonly NeighbourhoodStrip[] = []): BoroughAreaRow[] {
  const byId = new Map(strips.map((entry) => [entry.geographyId, entry]));
  const groups = new Map<string, ReturnType<typeof descendants>>();
  for (const area of descendants(index, borough, "lsoa")) {
    const key = area.parentId && index.byId.get(area.parentId)?.carrier === "msoa" ? area.parentId : area.geographyId;
    groups.set(key, [...(groups.get(key) ?? []), area]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const figures = members.map((area) => {
      const price = index.values["price-per-square-metre"].get(area.geographyId);
      const crime = index.values.crime.get(area.geographyId);
      const strip = byId.get(area.geographyId);
      const crimePercentile = crime?.regionPercentile ?? null;
      return {
        price: price?.value ?? strip?.price ?? null,
        pricePosition: price?.regionPercentile ?? strip?.priceLondonPercentile ?? null,
        safety: crimePercentile !== null ? 100 - crimePercentile : strip?.safetyStanding ?? null,
        schools: strip?.schoolStanding ?? null,
      };
    });
    const one = members.length === 1;
    const area = one ? members[0] : index.byId.get(key as GeographyId)!;
    const price = one ? figures[0].price : middleOf(figures.map((entry) => entry.price));
    return {
      id: area.geographyId,
      name: areaDisplayName(area) ?? areaDisplayName(members[0]) ?? area.name,
      note: one ? null : `${members.length} neighbourhoods`,
      href: areaPath(area),
      price,
      priceDisplay: price === null ? "—" : formatPerSquareMetre(price),
      pricePosition: one ? figures[0].pricePosition : middleOf(figures.map((entry) => entry.pricePosition)),
      safety: one ? figures[0].safety : middleOf(figures.map((entry) => entry.safety)),
      schools: one ? figures[0].schools : middleOf(figures.map((entry) => entry.schools)),
    };
  });
}
