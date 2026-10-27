"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  EVIDENCE_SECTIONS,
  loadFolded,
  saveFolded,
  toggleFolded,
  type SectionId,
} from "@/lib/evidence-sections";
import { HeadIcon } from "./overview-tiles";
import { KnitIcon } from "./knit/knit-icon";

/** A request to bring one section into view, open and focused (a new object each time). */
interface Jump { id: SectionId }

export interface FoldedSections {
  folded: readonly SectionId[];
  toggle: (id: SectionId) => void;
  foldAll: () => void;
  openAll: () => void;
  /** Open a section if folded, scroll to it and focus its header. */
  reveal: (id: SectionId) => void;
  /** The pending reveal, cleared once its section has handled it. */
  jump: Jump | null;
  jumped: () => void;
}

/**
 * Which sections are folded, remembered in localStorage. The stored list
 * loads after mount so server and client first render the same (all open).
 */
export function useFoldedSections(): FoldedSections {
  const [folded, setFoldedState] = useState<readonly SectionId[]>([]);
  const [jump, setJump] = useState<Jump | null>(null);
  useEffect(() => setFoldedState(loadFolded()), []);
  const jumped = useCallback(() => setJump(null), []);
  const setFolded = useCallback((update: (current: readonly SectionId[]) => readonly SectionId[]) => {
    setFoldedState((current) => {
      const next = update(current);
      saveFolded(next);
      return next;
    });
  }, []);
  return {
    folded,
    jump,
    jumped,
    toggle: (id) => setFolded((current) => toggleFolded(current, id)),
    foldAll: () => setFolded(() => EVIDENCE_SECTIONS.map((section) => section.id)),
    openAll: () => setFolded(() => []),
    reveal: (id) => {
      setFolded((current) => current.filter((entry) => entry !== id));
      setJump({ id });
    },
  };
}

/** The nearest scrolling ancestor (the dock), or null for the viewport. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/** "Fold all" and "Open all", one small row under the summary. */
export function FoldRow({ sections }: { sections: FoldedSections }) {
  return (
    <div className="evidence-fold-row" data-testid="evidence-fold-row">
      <button type="button" data-testid="fold-all" onClick={sections.foldAll}>Fold all</button>
      <button type="button" data-testid="open-all" onClick={sections.openAll}>Open all</button>
    </div>
  );
}

/**
 * One collapsible section: a bold full-width header (icon, title, key figure,
 * chevron) that is a button controlling its region. The content mounts — and
 * so fetches — only once the section is open and on screen, then stays
 * mounted (hidden while folded) so reopening never refetches.
 */
export function EvidenceSection({ id, figure, sections, children }: {
  id: SectionId;
  /** One line under the title: the section's key figure. */
  figure: string;
  sections: FoldedSections;
  children: ReactNode;
}) {
  const { title, icon } = EVIDENCE_SECTIONS.find((section) => section.id === id)!;
  const open = !sections.folded.includes(id);
  const [onScreen, setOnScreen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const root = useRef<HTMLElement>(null);
  const header = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mounted) return;
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    // Measured against the panel's own scroller: a sliver of the previous
    // section left above a header scrolled to the top must not load it (it
    // would grow and push the header away), while the next 120px preload.
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
      root: scrollParent(node),
      rootMargin: "-24px 0px 120px 0px",
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);
  useEffect(() => {
    if (open && onScreen) setMounted(true);
  }, [open, onScreen]);

  const { jump, jumped } = sections;
  useEffect(() => {
    if (jump?.id !== id) return;
    setMounted(true);
    // After the unfold has rendered, so the region is no longer hidden.
    const frame = requestAnimationFrame(() => {
      header.current?.scrollIntoView({ block: "start" });
      header.current?.focus({ preventScroll: true });
      jumped();
    });
    return () => cancelAnimationFrame(frame);
  }, [jump, id, jumped]);

  const headId = `evidence-section-head-${id}`;
  const bodyId = `evidence-section-body-${id}`;
  return (
    <section ref={root} className="evidence-section" data-testid={`evidence-section-${id}`} data-open={open ? "" : undefined}>
      <h2 className="evidence-section__heading">
        <button
          ref={header}
          type="button"
          id={headId}
          className="evidence-section__toggle"
          data-testid={`section-toggle-${id}`}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => sections.toggle(id)}
        >
          <HeadIcon name={icon} />
          <span className="evidence-section__title">{title}<span className="sr-only"> section</span></span>
          <span className="evidence-section__figure" data-testid={`section-figure-${id}`}>{figure}</span>
          <KnitIcon name="chevron-down" colour="var(--icon-yarn, currentColor)" className="evidence-section__chevron" />
        </button>
      </h2>
      <div role="region" id={bodyId} aria-labelledby={headId} className="evidence-section__body" hidden={!open}>
        {mounted ? children : <div className="evidence-section__pending" aria-hidden="true" />}
      </div>
    </section>
  );
}
