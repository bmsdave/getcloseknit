"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { legacyAnchorPath } from "@/lib/guide-routes";

/**
 * /methodology#crime redirects to /guide#crime (the server never sees the
 * fragment); this sends old anchors on to their article.
 */
export function LegacyAnchorRedirect() {
  const router = useRouter();
  useEffect(() => {
    const target = legacyAnchorPath(window.location.hash);
    if (target) router.replace(target);
  }, [router]);
  return null;
}
