import Link from "next/link";

import { schoolFilterChipRows, type SchoolChipRowId, type SchoolFilter } from "@/lib/school-filter";

/**
 * Schools filter v2's chip rows, one component for the /schools hub (plain GET links, `href`) and the map's
 * Show › Schools (buttons, `onChange`): each chip is the filter it leads to (lib/school-filter.ts). Its styles are styles/school-filter.css, imported by the pages that use it.
 */
export function SchoolChipRows({ filter, rows, href, onChange, testPrefix = "filter" }: {
  filter: SchoolFilter; rows: readonly SchoolChipRowId[]; href?: (filter: SchoolFilter) => string;
  onChange?: (filter: SchoolFilter) => void; testPrefix?: string;
}) {
  return (
    <div className="schools-filters" data-testid={`${testPrefix}-chips`}>
      {schoolFilterChipRows(filter, rows).map((row) => (
        <div key={row.id} className="schools-filters__row" role="group" aria-label={row.label} data-testid={`${testPrefix}-${row.id}`}>
          <span className="schools-filters__label" aria-hidden="true">{row.label}</span>
          <div className="schools-filters__chips">
            {row.chips.map((chip) => href ? (
              <Link key={chip.id} href={href(chip.next)} scroll={false} className="schools-chip" data-chip={chip.id}
                aria-current={chip.current ? "true" : undefined}>{chip.label}</Link>
            ) : (
              <button key={chip.id} type="button" className="schools-chip" data-chip={chip.id} aria-pressed={chip.current}
                onClick={() => onChange?.(chip.next)}>{chip.label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
