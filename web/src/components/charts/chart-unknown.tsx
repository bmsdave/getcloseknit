import type { ReactNode } from "react";

/** Stands in for a chart whose data is missing: words, never an empty chart or a 0. */
export function ChartUnknown({ children = "Unknown" }: { children?: ReactNode }) {
  return <p className="chart-unknown" data-unknown="">{children}</p>;
}
