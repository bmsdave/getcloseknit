"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { guidePath } from "@/lib/guide-slugs";
import { HELP, type HelpId } from "@/lib/help-texts";
import { KnitIcon } from "./knit/knit-icon";

const EDGE = 8;

/**
 * A (?) button that opens a short plain-language explanation with a link
 * to the guide article. Closes on Escape (focus returns to the button), on
 * a pointer outside, or on a second tap. `text` replaces the stored
 * explanation when it is built from the user's own evidence.
 */
export function HelpTip({ id, label, text }: { id: HelpId; label?: string; text?: string }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const popoverId = useId();
  const help = HELP[id];

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    // Capture on window runs before every other handler: Escape closes only
    // this bubble, not the sheet or dialog around it (preventDefault stops a
    // <dialog> cancel).
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape, true); };
  }, [open]);

  // Keep the bubble inside the viewport: panels sit at both screen edges.
  useLayoutEffect(() => {
    if (!open || !bubble.current) { setShift(0); return; }
    const box = bubble.current.getBoundingClientRect();
    // clientWidth, not innerWidth: an overflowing bubble would widen innerWidth itself.
    const right = box.right - shift - (document.documentElement.clientWidth - EDGE);
    const left = EDGE - (box.left - shift);
    setShift(right > 0 ? -right : left > 0 ? left : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <span className="help-tip" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="help-tip__button"
        aria-label={label ? `About ${label}` : "What does this mean?"}
        aria-expanded={open}
        aria-controls={popoverId}
        data-help-id={id}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true"><KnitIcon name="help" colour="var(--icon-yarn, currentColor)" className="knit-glyph" style={{ width: 14, height: 14 }} /></span>
      </button>
      {open && (
        <span
          ref={bubble}
          className="help-tip__bubble"
          id={popoverId}
          role="note"
          data-testid={`help-${id}`}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
        >
          <span className="help-tip__text">{text ?? help.short}</span>
          <Link className="help-tip__more" href={guidePath(help.guide)}>Learn more →</Link>
        </span>
      )}
    </span>
  );
}
