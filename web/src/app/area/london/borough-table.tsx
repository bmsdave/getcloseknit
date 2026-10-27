"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { sortBoroughRows, type BoroughColumnId, type BoroughSort, type BoroughTableRow } from "@/lib/area-pages";

export interface BoroughTableColumn { id: BoroughColumnId; label: string; title: string; sortable: boolean }
export type BoroughTableEntry = Pick<BoroughTableRow, "name" | "href" | "cells">;

/**
 * /area/london: every borough side by side, sorted by any column. The page renders
 * the whole table on the server; sorting only reorders it. Unknown figures ("—") always sort last.
 */
export function BoroughTable({ columns, rows, initial }: { columns: BoroughTableColumn[]; rows: BoroughTableEntry[]; initial: BoroughSort }) {
  const [sort, setSort] = useState<BoroughSort>(initial);
  const sorted = useMemo(() => sortBoroughRows(rows, sort), [rows, sort]);
  const pick = (by: BoroughSort["by"]) => setSort((current) => current.by === by
    ? { by, dir: current.dir === "asc" ? "desc" : "asc" }
    // A name sorts A to Z first; a figure, highest first.
    : { by, dir: by === "name" ? "asc" : "desc" });
  const label = sort.by === "name" ? "Borough" : columns.find((column) => column.id === sort.by)?.title ?? "";
  return (
    <div className="borough-table__wrap">
      <table className="area-page__table borough-table" data-testid="borough-table">
        <caption className="sr-only">London boroughs, sorted by {label.toLowerCase()}, {sort.dir === "asc" ? "lowest" : "highest"} first</caption>
        <thead>
          <tr>
            <SortHead id="name" label="Borough" title="Borough" sort={sort} onPick={pick} />
            {columns.map((column) => column.sortable
              ? <SortHead key={column.id} id={column.id} label={column.label} title={column.title} sort={sort} onPick={pick} numeric />
              : <th key={column.id} scope="col" className="borough-table__num" title={column.title}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.href}>
              <th scope="row"><Link href={row.href}>{row.name}</Link></th>
              {columns.map((column) => (
                <td key={column.id} className="borough-table__num" data-sorted={sort.by === column.id || undefined}>{row.cells[column.id].display}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHead({ id, label, title, sort, onPick, numeric = false }: {
  id: BoroughSort["by"]; label: string; title: string; sort: BoroughSort; onPick: (by: BoroughSort["by"]) => void; numeric?: boolean;
}) {
  const current = sort.by === id;
  return (
    <th scope="col" className={numeric ? "borough-table__num" : undefined}
      aria-sort={current ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="borough-table__sort" data-testid={`borough-sort-${id}`} title={title} onClick={() => onPick(id)}
        aria-label={title === label ? `Sort by ${label}` : `Sort by ${label}: ${title}`}>
        {label}
        {current && (
          <KnitIcon name="chevron-down" colour="var(--icon-yarn, currentColor)" className="borough-table__arrow"
            style={{ width: 12, height: 12, transform: sort.dir === "asc" ? "rotate(180deg)" : undefined }} />
        )}
      </button>
    </th>
  );
}
