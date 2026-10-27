import type { ReactNode } from "react";

// The guide's sheet (articles and diagrams) loads on /guide pages only.
import "../../styles/guide.css";

export default function GuideLayout({ children }: { children: ReactNode }) {
  return children;
}
