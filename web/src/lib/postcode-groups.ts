/**
 * The postcode page groups its recorded sales by building, so a block of
 * flats reads as one card instead of thirty. Pure helpers: address cleaning
 * ("London, London" → "London"), a building key per address, and per-group
 * figures (which columns have any data, the sale count and price range).
 */
import type { AddressHistory, AddressSale } from "./contracts";
import { formatMoney } from "./money-format";

/** A group with more sale rows than this starts folded. */
export const LONG_GROUP_ROWS = 8;
/** With more buildings than this, every building starts folded: the page opens as an index of summaries. */
export const OPEN_BUILDINGS_MAX = 4;

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });

/** Leading address parts that name a unit inside a building, not the building. */
const UNIT_PART = /^(flat|apartment|apt|unit|suite|room|studio|maisonette|floor|basement|lower|upper|ground|first|second|third|fourth|fifth|top|garden|part|\d+(st|nd|rd|th)\b)/i;
const NUMBERED = /^\d/;

function parts(address: string): string[] {
  return address.split(",").map((part) => part.trim()).filter(Boolean);
}

/** Drops a part that repeats the one before it: "London, London" → "London". */
export function cleanAddress(address: string): string {
  return parts(address)
    .filter((part, index, all) => index === 0 || part.toLowerCase() !== all[index - 1].toLowerCase())
    .join(", ");
}

export interface AddressPlace {
  /** Groups homes in one building: "11 Coborn Road" for 11, 11a and 11b. */
  key: string;
  building: string;
  /** The home within its building: "Flat 3", or the full first line when there is no unit. */
  home: string;
  /** The address without town and postcode: "Flat 3, Oval House Rushcroft Road". */
  line: string;
}

/** Where an address sits: its building and the home inside it. */
export function addressPlace(address: string, postcode: string): AddressPlace {
  const all = parts(cleanAddress(address));
  const lines = all.filter((part) => part.toUpperCase() !== postcode.toUpperCase());
  // The last line is the town once the postcode is gone ("…, London").
  if (lines.length > 1 && !NUMBERED.test(lines[lines.length - 1])) lines.pop();
  let start = 0;
  while (start < lines.length - 1 && UNIT_PART.test(lines[start])) start += 1;
  const numbered = lines.findIndex((part, index) => index >= start && NUMBERED.test(part) && !UNIT_PART.test(part));
  const at = numbered >= 0 ? numbered : start;
  const street = lines[at] ?? address;
  // 11a and 11b Coborn Road share a building with 11 Coborn Road.
  const building = street.replace(/^(\d+)[a-z]\b/i, "$1");
  const before = lines.slice(0, at).join(", ");
  return { key: building.toLowerCase(), building, home: before || street, line: lines.join(", ") || address };
}

export interface BuildingRow {
  addressId: string;
  home: string;
  /** Rows this home spans (its sales); the home cell is drawn on its first row only. */
  span: number;
  first: boolean;
  sale: AddressSale;
}

export interface BuildingGroup {
  key: string;
  /** The heading: the building, or the one home's own address when it is alone. */
  title: string;
  building: string;
  homes: number;
  rows: BuildingRow[];
  /** Columns shown only when at least one sale in the group has the figure. */
  hasFloorArea: boolean;
  /** "2 homes · 9 sales, 1997–2024 · £120k to £1.2m"; "1 sale, 2006 · £330k" for a lone home. */
  summary: string;
  long: boolean;
  /** Starts folded: a long building, or one of many (its summary line still says it all). */
  folded: boolean;
}

function yearSpan(sales: AddressSale[]): string {
  const years = sales.map((sale) => sale.date.slice(0, 4)).sort();
  const [first, last] = [years[0], years[years.length - 1]];
  return first === last ? first : `${first}–${last}`;
}

function priceSpan(sales: AddressSale[]): string {
  const prices = sales.map((sale) => sale.nominalPrice);
  const [low, high] = [Math.min(...prices), Math.max(...prices)];
  return low === high ? formatMoney(low) : `${formatMoney(low)} to ${formatMoney(high)}`;
}

/** Sales grouped by building, buildings and homes in street-number order, newest sale first. */
export function groupByBuilding(histories: readonly AddressHistory[], postcode: string): BuildingGroup[] {
  const groups = new Map<string, { building: string; homes: { place: AddressPlace; history: AddressHistory }[] }>();
  for (const history of histories) {
    const place = addressPlace(history.displayAddress, postcode);
    const group = groups.get(place.key) ?? { building: place.building, homes: [] };
    group.homes.push({ place, history });
    groups.set(place.key, group);
  }
  const many = groups.size > OPEN_BUILDINGS_MAX;
  return [...groups.entries()]
    .sort(([, a], [, b]) => collator.compare(a.building, b.building))
    .map(([key, group]) => {
      const homes = [...group.homes].sort((a, b) => collator.compare(a.place.home, b.place.home));
      const rows = homes.flatMap(({ place, history }) => {
        const sales = [...history.transactions].sort((a, b) => b.date.localeCompare(a.date));
        return sales.map((sale, index) => ({
          addressId: history.addressId, home: place.home, span: sales.length, first: index === 0, sale,
        }));
      });
      const sales = rows.map((row) => row.sale);
      // The home count only when there is more than one: "1 home" says nothing.
      const homeCount = homes.length > 1 ? `${homes.length} homes · ` : "";
      const saleWord = sales.length === 1 ? "sale" : "sales";
      const summary = sales.length === 0
        ? `${homeCount}no recorded sales`
        : `${homeCount}${sales.length} ${saleWord}, ${yearSpan(sales)} · ${priceSpan(sales)}`;
      return {
        key,
        title: homes.length === 1 ? homes[0].place.line : group.building,
        building: group.building,
        homes: homes.length,
        rows,
        hasFloorArea: sales.some((sale) => sale.floorAreaSquareMetres !== null),
        summary,
        long: rows.length > LONG_GROUP_ROWS,
        folded: many || rows.length > LONG_GROUP_ROWS,
      };
    });
}

/** Each distinct disclaimer once, for the top of the page. */
export function distinctDisclaimers(histories: readonly AddressHistory[]): string[] {
  return [...new Set(histories.map((history) => history.estimateDisclaimer).filter(Boolean))];
}
