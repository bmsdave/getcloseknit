"use client";

import { useState, type ReactNode } from "react";

import { HelpTip } from "@/components/help-tip";
import { StemDivider } from "@/components/knit/satin";
import type { HelpId } from "@/lib/help-texts";

import { ChartUnknown } from "./chart-unknown";

/**
 * Wraps one chart: a title row with an optional (?) and a "Show as table"
 * toggle (when table is given), the chart or the unknown text in its place,
 * and an optional folded "Sources & method" line for licences and method.
 */
export function ChartFrame({ title, help, unknown = null, table, sources, children }: {
  title: string; help?: HelpId; unknown?: string | null; table?: ReactNode; sources?: ReactNode; children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const missing = Boolean(unknown);
  return (
    <section className="chart-frame">
      <div className="chart-frame__head">
        <h3>{title}</h3>
        {help && <HelpTip id={help} label={title} />}
        {table && !missing && (
          <button type="button" className="chart-frame__toggle" aria-pressed={asTable} onClick={() => setAsTable((value) => !value)}>
            <span>Show as table</span>
          </button>
        )}
      </div>
      {missing ? <ChartUnknown>{unknown}</ChartUnknown> : asTable ? <div className="chart-table"><StemDivider className="stem-divider table-stem" />{table}</div> : children}
      {sources && (
        <details className="chart-sources">
          <summary>Sources &amp; method</summary>
          <div className="chart-sources__body">{sources}</div>
        </details>
      )}
    </section>
  );
}
