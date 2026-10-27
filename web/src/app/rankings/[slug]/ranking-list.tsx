"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { SatinValueBar } from "@/components/knit/satin";
import { addCompared, MAX_COMPARE, removeCompared, useComparedAreas } from "@/lib/compare-selection";
import { compareHref } from "@/lib/compare-table";
import type { GeographyId } from "@/lib/contracts";
import { DEFAULT_PROFILE } from "@/lib/fixtures";
import { findBudgetHref, loadLocalProfile } from "@/lib/profile-state";
import { searchBudgetPrefill } from "@/lib/tools";

export interface RankingListRow {
  rank: number;
  name: string;
  href: string;
  parentName: string | null;
  display: string;
  detail: string;
  value: number;
  colour: string;
  /** The neighbourhood compared for this row (ranking-view.ts typicalNeighbourhood); null: not comparable. */
  compareId: GeographyId | null;
  /** The map with this area chosen and the ranking's layer on. */
  mapHref: string;
}

const UNKNOWN = "unknown";
const mark = (name: string) => <KnitIcon name={name} colour="var(--icon-yarn, currentColor)" className="knit-inline" style={{ width: 14, height: 14 }} />;

/**
 * The ranking table with a satin bar beside each figure, "On map ↗" under each name (the map keeps the
 * ranking's layer) and "Add to compare" on each row, then the next
 * steps "Compare the top 3" and "In my budget" (Like this lives on each area, not here). Comparison uses
 * the map's own selection (lib/compare-selection.ts); each action answers in words (role=status).
 */
export function RankingList({ rows, column, showParent }: {
  rows: RankingListRow[]; column: string; showParent: boolean;
}) {
  const compared = useComparedAreas();
  const [notice, setNotice] = useState<string | null>(null);
  // Read after hydration: the server render has no saved search.
  const [budget, setBudget] = useState<number | null>(null);
  useEffect(() => setBudget(searchBudgetPrefill(loadLocalProfile(DEFAULT_PROFILE))?.price ?? null), []);
  const max = Math.max(0, ...rows.map((row) => row.value));
  const top = rows.filter((row) => row.compareId).slice(0, 3);
  function toggle(row: RankingListRow) {
    const id = row.compareId!;
    if (compared.includes(id)) {
      removeCompared(id);
      setNotice(`${row.name} left the comparison.`);
      return;
    }
    const result = addCompared(id);
    setNotice(result.refused
      ? `Comparison holds ${MAX_COMPARE} areas. Remove one on the map to add ${row.name}.`
      : `Added a typical neighbourhood in ${row.name} to compare (${result.ids.length} of ${MAX_COMPARE}).`);
  }
  function compareTop() {
    const refused = top.filter((row) => addCompared(row.compareId!).refused).length;
    setNotice(refused
      ? `Comparison holds ${MAX_COMPARE} areas: ${top.length - refused} of the top ${top.length} added. Remove some on the map to add the rest.`
      : `The top ${top.length} are in compare.`);
  }
  const comparable = rows.some((row) => row.compareId);
  return (
    <>
      <table id="ranking-list" className="area-page__table area-page__ranking ranking-list" data-testid="ranking-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Area</th>
            {showParent && <th scope="col" className="area-page__parent">Borough</th>}
            <th scope="col">{column}</th>
            {comparable && <th scope="col"><span className="sr-only">Compare</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inCompare = row.compareId !== null && compared.includes(row.compareId);
            return (
              <tr key={row.href}>
                <td>{row.rank}</td>
                <th scope="row">
                  <Link href={row.href}>{row.name}</Link>
                  {showParent && <span className="area-page__note area-page__parent-inline">{row.parentName ?? UNKNOWN}</span>}
                  {/* A full load: the map reads its query on boot. */}
                  <a href={row.mapHref} className="ranking-list__map" data-testid="ranking-on-map" aria-label={`${row.name} on the map`}>
                    On map <span aria-hidden="true">↗</span>
                  </a>
                </th>
                {showParent && <td className="area-page__parent">{row.parentName ?? UNKNOWN}</td>}
                <td>
                  <SatinValueBar value={row.value} max={max} colour={row.colour} label={<strong>{row.display}</strong>} />
                  {row.detail && <span className="area-page__note">{row.detail}</span>}
                </td>
                {comparable && (
                  <td className="ranking-list__action">
                    {row.compareId && (
                      <button type="button" className="area-save-actions__button ranking-list__compare" data-testid="ranking-add-to-compare"
                        aria-pressed={inCompare} aria-label={`Add ${row.name} to compare`}
                        onClick={() => toggle(row)}>
                        {mark(inCompare ? "check" : "swap")}<span className="ranking-list__compare-label">{inCompare ? "In compare" : "Add to compare"}</span>
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 0 && (
        <div className="ranking-next" data-testid="ranking-next">
          <div className="ranking-next__row" role="group" aria-label="Next steps">
            {top.length > 1 && (
              <button type="button" className="area-save-actions__button" data-testid="ranking-compare-top" onClick={compareTop}>
                {mark("swap")} Compare the top {top.length}
              </button>
            )}
            {/* r3 #26 (CUJ05 board step 3): My match with the household's own budget (to buy), else asking for one. */}
            <a className="area-save-actions__button" href={findBudgetHref(budget)} data-testid="ranking-in-budget">
              {mark("search")} In my budget
            </a>
          </div>
        </div>
      )}
      <p className="area-save-actions__status" role="status" data-testid="ranking-status">
        {notice}
        {notice && compared.length >= 2 && <> <Link href={compareHref("places", compared)} data-testid="ranking-open-compare">Open compare</Link></>}
      </p>
    </>
  );
}
