import Link from "next/link";
import type { ReactNode } from "react";

import type { GeographyId } from "@/lib/contracts";
import { areaPath } from "@/lib/area-pages";
import type { Crumb, NextLink, NextColumns } from "@/lib/entity-nav";
import { NEXT_COLUMNS } from "@/lib/entity-nav";

/**
 * Where an entity page sits: London › borough › area › postcode › home. Every
 * step but the last is a link; the last is this page.
 */
export function Breadcrumbs({ crumbs, label = "Where this sits" }: { crumbs: readonly Crumb[]; label?: string }) {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label={label} className="area-page__crumbs" data-testid="breadcrumbs">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`}>
            {crumb.href && index < crumbs.length - 1
              ? <Link href={crumb.href}>{crumb.label}</Link>
              : <span aria-current="page">{crumb.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** One item in a What's next column: a link, or a control the page owns (a Watch button). */
export type NextItem = NextLink | { node: ReactNode; key: string };

/**
 * The one "What's next" block on every entity page: Up (the places this sits
 * in), Inside (what it holds), Nearby (around it, the map, rankings) and Act
 * (save, compare, check, watch). Empty columns are left out.
 */
export function WhatsNext({ columns, testId = "whats-next" }: {
  columns: Partial<Record<keyof NextColumns, readonly (NextItem | null | false | undefined | "")[]>>;
  testId?: string;
}) {
  const shown = NEXT_COLUMNS
    .map((column) => ({ ...column, items: (columns[column.id] ?? []).filter((item): item is NextItem => !!item) }))
    .filter((column) => column.items.length > 0);
  if (shown.length === 0) return null;
  return (
    <nav className="whats-next" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <h2 id={`${testId}-title`}>What&apos;s next</h2>
      <div className="whats-next__columns">
        {shown.map((column) => (
          <div key={column.id} className="whats-next__column" data-testid={`${testId}-${column.id}`}>
            <h3>{column.title}</h3>
            <ul>
              {column.items.map((item) => (
                <li key={"node" in item ? item.key : `${item.label}-${item.href}`}>
                  {"node" in item ? item.node : item.reload || item.href.startsWith("#")
                    // A full load (the map reads its layer and selection from the address once), or a #section
                    // the page's own hash handling shows.
                    ? <a href={item.href} data-testid={item.testId}>{item.label}</a>
                    : <Link href={item.href} data-testid={item.testId}>{item.label}</Link>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/** "← Crofton": the way back from an area's Places and Evidence pack pages to the area page. */
export function BackToArea({ geographyId, name }: { geographyId: GeographyId; name: string }) {
  return (
    <Link className="area-back" href={areaPath({ geographyId })} data-testid="back-to-area">
      <span aria-hidden="true">← </span>{name}
    </Link>
  );
}
