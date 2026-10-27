import Link from "next/link";

import { KnitIcon } from "@/components/knit/knit-icon";
import { schoolFilterText } from "@/lib/school-filter";
import { HUB_CHIP_ROWS, schoolsHref, type SchoolFilters } from "@/lib/schools-hub";

import { SchoolChipRows } from "./school-filter-chips";

/**
 * /schools' search and filter chips (Menu v5 board; Schools filter v2). Plain GET links and a GET form, so the page
 * works before (and without) hydration: the server renders the list for the query. The chips are the map's
 * (components/schools/school-filter-chips.tsx) and write the same ?schools= text, so "On the map" carries them over.
 */
export function SchoolSearch({ filters }: { filters: SchoolFilters }) {
  const text = schoolFilterText(filters.school);
  return (
    <form action="/schools" method="get" role="search" className="schools-search" data-testid="schools-search">
      <label htmlFor="schools-q" className="sr-only">Search a school</label>
      <KnitIcon name="search" colour="var(--icon-yarn, var(--ink))" className="schools-search__ring" style={{ width: 16, height: 16 }} />
      <input id="schools-q" name="q" type="search" className="knit-field schools-search__field" defaultValue={filters.q}
        placeholder="Search a school" autoComplete="off" enterKeyHint="search" />
      {filters.borough && <input type="hidden" name="borough" value={filters.borough.slug} />}
      {text !== "on" && <input type="hidden" name="schools" value={text} />}
      <button type="submit" className="primary-action schools-search__go">Search</button>
    </form>
  );
}

export function SchoolFilterChips({ filters }: { filters: SchoolFilters }) {
  const text = schoolFilterText(filters.school);
  return (
    <>
      <SchoolChipRows filter={filters.school} rows={HUB_CHIP_ROWS} href={(school) => schoolsHref(filters, { school })} />
      {text !== "on" && (
        <p className="schools-hub__map">
          <Link href={`/?schools=${text}`} data-testid="schools-on-map">On the map ↗</Link>
        </p>
      )}
    </>
  );
}
