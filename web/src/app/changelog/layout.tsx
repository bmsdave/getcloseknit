import type { ReactNode } from "react";

// The changelog's sheet loads on /changelog pages only.
import "../../styles/changelog.css";

export default function ChangelogLayout({ children }: { children: ReactNode }) {
  return children;
}
