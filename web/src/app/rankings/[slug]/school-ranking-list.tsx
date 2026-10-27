import Link from "next/link";

import type { SchoolRankingRow } from "@/lib/area-pages";

const UNKNOWN = "unknown";

/**
 * Schools on one axis: each name opens our school page; a small link goes to the publisher (DfE results or
 * Ofsted reports). A filtered list (Outstanding) has no rank column; the borough folds under the name on phones.
 */
export function SchoolRankingList({ rows, column }: { rows: SchoolRankingRow[]; column: string }) {
  const ranked = rows.some((row) => row.rank !== null);
  return (
    <table className="area-page__table area-page__ranking ranking-list" data-testid="ranking-table">
      <thead>
        <tr>
          {ranked && <th scope="col">#</th>}
          <th scope="col">School</th>
          <th scope="col" className="area-page__parent">Borough</th>
          <th scope="col">{column}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.urn}>
            {ranked && <td>{row.rank}</td>}
            <th scope="row">
              <Link href={row.href}>{row.name}</Link>{" "}
              <a className="area-page__source" href={row.sourceHref} data-testid="ranking-source-link">{row.sourceLabel}</a>
              <span className="area-page__note area-page__parent-inline">{row.borough ?? UNKNOWN}</span>
            </th>
            <td className="area-page__parent">{row.borough ?? UNKNOWN}</td>
            <td>
              <strong>{row.display}</strong>
              {row.detail && <span className="area-page__note">{row.detail}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
