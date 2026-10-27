import type { ReactNode } from "react";

// The sources table borrows the calculators' table (tools.css › .tools-table), no longer global.
import "../../styles/tools.css";

export default function AboutLayout({ children }: { children: ReactNode }) {
  return children;
}
