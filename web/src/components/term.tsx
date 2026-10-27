"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { glossaryTerm, type GlossaryTermId } from "@/lib/glossary";
import { useDialogFocusTrap } from "./use-focus-trap";

/** An inline UK term that opens its glossary entry in a modal dialog. */
export function Term({ id, children }: { id: GlossaryTermId; children?: ReactNode }) {
  const entry = glossaryTerm(id);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node || !open) return;
    if (!node.open) node.showModal();
    const button = trigger.current;
    return () => {
      if (node.open) node.close();
      button?.focus();
    };
  }, [open]);
  useDialogFocusTrap(open, dialog);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="term"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={`term-${id}`}
        onClick={() => setOpen(true)}
      >
        {children ?? entry.term}
      </button>
      {open && createPortal(
        <dialog
          ref={dialog}
          className="term-dialog"
          aria-labelledby={headingId}
          data-testid="term-dialog"
          onCancel={() => setOpen(false)}
          onClose={() => setOpen(false)}
          // React bubbles portal events through the component tree: keep the
          // dialog's Escape from also dismissing the evidence sheet around it.
          onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
        >
          <h2 id={headingId}>{entry.term}</h2>
          <p className="term-short">{entry.short}</p>
          <p>{entry.long}</p>
          <p className="term-links">
            <a href={entry.url} target="_blank" rel="noreferrer">Read the official guidance on GOV.UK</a>
            {" · "}
            <Link href={`/guide/glossary#${entry.id}`}>All terms</Link>
          </p>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </dialog>,
        document.body,
      )}
    </>
  );
}
