"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The client half of the shared footer (site-footer.tsx): the map at "/" has
 * its own dock footer, so the shared one renders nothing there.
 */
export function SiteFooterFrame({ children }: { children: ReactNode }) {
  return usePathname() === "/" ? null : <>{children}</>;
}
