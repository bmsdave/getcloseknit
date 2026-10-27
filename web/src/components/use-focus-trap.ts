"use client";

import { useEffect, type RefObject } from "react";

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function tabbableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll(TABBABLE_SELECTOR)].filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
  );
}

// UX-63: explicit Tab wrap for modal dialogs. Native showModal trapping
// must own this where it engages; this handler only pins the boundary
// stops (last-to-first, first-to-last), so it coincides with — never
// fights — a working native trap.
export function trapTabKey(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const items = tabbableElements(container);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function useDialogFocusTrap(open: boolean, dialog: RefObject<HTMLDialogElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => trapTabKey(event, node);
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [open, dialog]);
}
