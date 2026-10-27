"use client";

import { useEffect } from "react";

/**
 * A printed pack carries every section, folded or not: opens each <details>
 * inside `selector` before the browser prints (the button or Ctrl+P).
 */
export function OpenOnPrint({ selector }: { selector: string }) {
  useEffect(() => {
    const open = () => {
      document.querySelectorAll<HTMLDetailsElement>(`${selector} details`).forEach((details) => { details.open = true; });
    };
    window.addEventListener("beforeprint", open);
    return () => window.removeEventListener("beforeprint", open);
  }, [selector]);
  return null;
}
