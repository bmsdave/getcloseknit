import type { ReactNode } from "react";

// The calculators' sheet loads on /tools pages; the home page's Tools block (investor-calculator.tsx) imports it itself, only when opened.
import "../../styles/tools.css";

export default function ToolsLayout({ children }: { children: ReactNode }) {
  return children;
}
