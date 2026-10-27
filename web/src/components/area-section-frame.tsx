import type { ReactNode } from "react";

import { KnitIcon } from "./knit/knit-icon";
import { HeadIcon } from "./overview-tiles";

/**
 * One section in the area-page frame, shared by the area, borough and places pages:
 * title row (icon · name · headline · London chip · On map ↗), at most one chart, at
 * most five rows, then the sources folded behind ⓘ. Nothing folds the content itself, so every word
 * can be selected and copied.
 */
export function SectionFrame({ id, domId = id, title, icon, headline, chip, mapHref, about, after, report, children }: {
  /** The section's id in test ids and data-section. */
  id: string;
  /** Its element id (the map sheet prefixes it). */
  domId?: string;
  title: string;
  icon: string;
  headline?: ReactNode;
  chip?: string | null;
  /** Where "On map ↗" opens the map; none in the map sheet (it is the map). */
  mapHref?: string | null;
  about?: ReactNode;
  /** Under the section. */
  after?: ReactNode;
  /** In the title row, before On map (the area page's "Report", CUJ15 board; its form opens on the next line). */
  report?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={domId} className="area-section" data-section={id} data-testid={`evidence-section-${id}`} aria-labelledby={`${domId}-title`}>
      <div className="area-section__head">
        <h2 className="area-section__title" id={`${domId}-title`} tabIndex={-1}>
          <HeadIcon name={icon} />
          <span>{title}</span>
        </h2>
        {headline && <span className="area-section__headline" data-testid={`section-headline-${id}`}>{headline}</span>}
        {chip && <span className="london-chip" data-testid={`london-chip-${id}`}>{chip}</span>}
        {report}
        {mapHref && (
          // A full load: the map reads its layer and selection from the address once.
          <a className="area-section__map" href={mapHref} data-testid={`section-map-${id}`}>On map <span aria-hidden="true">↗</span></a>
        )}
      </div>
      <div className="area-section__body">{children}</div>
      {about && (
        <details className="area-section__about" data-testid={`card-sources-${id}`}>
          <summary>
            <KnitIcon name="info" colour="var(--icon-yarn, currentColor)" className="area-section__info" />
            <span>Sources</span>
          </summary>
          <div className="chart-sources__body">{about}</div>
        </details>
      )}
      {after}
    </section>
  );
}

/** One row: plain text, so it reads and copies as "Term: value". `mine` rows (added or lit for the household) carry ▸. */
export interface KeyRow {
  term: string; value: ReactNode; testId?: string; mine?: boolean;
  /** The block the value is (area360's audit ids on a home page): set on the value itself. */
  valueTestId?: string;
}

/** A row left out (unknown, or not for this area). */
export type MaybeRow = KeyRow | null | undefined | false | "";

export const isRow = (row: MaybeRow): row is KeyRow => !!row;

/** At most five base rows; the household's own (▸) come first and are added on top, never in place of one. */
const BASE_ROWS = 5;

/** A section's rows: a two-column list of plain copyable text, the household's rows first. */
export function KeyNumbers({ rows, testId }: { rows: readonly MaybeRow[]; testId: string }) {
  const present = rows.filter(isRow);
  const shown = [...present.filter((row) => row.mine), ...present.filter((row) => !row.mine).slice(0, BASE_ROWS)];
  if (shown.length === 0) return null;
  return (
    <dl className="key-numbers" data-testid={testId}>
      {/* Keyed by place in the list too: a pinned station and the same station nearby share a name (the
          household's "Highbury & Islington" trip row was dropped as a duplicate key of the station row). */}
      {shown.map((row, index) => (
        <div key={`${row.mine ? "mine" : "row"}-${index}-${row.term}`} data-testid={row.testId} data-mine={row.mine ? "" : undefined}>
          <dt>{row.mine && <span className="key-numbers__mark" aria-label="For you">▸ </span>}{row.term}</dt>
          <dd data-testid={row.valueTestId}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
