"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** One chip: a section's id (its element id after the prefix) and its title. */
export interface TabSection { id: string; title: string }

/** How far below the chips a section's top may sit and still be the one in view (a fifth of the view, at most this). */
const READING_LINE_PX = 120;

/**
 * The section being read: the last one whose top has reached a line just under the sticky chips. The
 * line follows the chips' real bottom (site header and bar included, whatever their height) plus a
 * fifth of the view below them, so a section is current as soon as it reaches the top, never while
 * the tail of the one before still shows under the bar. At the very end of the page, the last section
 * whose top is in the upper part of the view.
 */
export function sectionInView(tops: readonly number[], barBottom: number, viewBottom: number, atEnd: boolean): number {
  const view = Math.max(0, viewBottom - barBottom);
  const line = barBottom + (atEnd ? view * 0.6 : Math.min(READING_LINE_PX, view * 0.2));
  let current = 0;
  tops.forEach((top, index) => { if (top <= line) current = index; });
  return current;
}

function useSectionInView(sections: readonly TabSection[], prefix: string, scrollRoot: string | null, bar: RefObject<HTMLElement | null>): string {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  const ids = sections.map((section) => section.id).join(" ");
  useEffect(() => {
    const nodes = ids.split(" ")
      .map((id) => document.getElementById(`${prefix}${id}`))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;
    // In the map sheet the card scrolls inside the dock, not the window.
    const root = scrollRoot ? nodes[0].closest<HTMLElement>(scrollRoot) : null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const barBottom = bar.current?.getBoundingClientRect().bottom ?? 0;
      const viewBottom = root ? root.getBoundingClientRect().bottom : window.innerHeight;
      const scroller = root ?? document.scrollingElement ?? document.documentElement;
      const atEnd = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const index = sectionInView(nodes.map((node) => node.getBoundingClientRect().top), barBottom, viewBottom, atEnd);
      setCurrent(nodes[index].id.slice(prefix.length));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    const target: HTMLElement | Window = root ?? window;
    target.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [ids, prefix, scrollRoot, bar]);
  return current;
}

/**
 * The sticky tab chips: one per section, in the page's order. Each is a link
 * to its section; the one in view is marked current. The area card and the
 * borough and MSOA pages share it.
 */
export function SectionTabs({ sections, prefix = "", scrollRoot = null, onGo }: {
  sections: readonly TabSection[];
  /** Before each section id in the DOM ("sheet-" in the map sheet). */
  prefix?: string;
  /** The scrolling ancestor, when it is not the window. */
  scrollRoot?: string | null;
  /** Shows a section; by default the browser follows the #link. */
  onGo?: (id: string) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const current = useSectionInView(sections, prefix, scrollRoot, nav);
  const list = useRef<HTMLUListElement>(null);
  // The chip row scrolls sideways on a phone: keep the current chip in it.
  useEffect(() => {
    const row = list.current;
    const chip = row?.querySelector<HTMLElement>(`[data-section="${current}"]`);
    if (!row || !chip) return;
    const left = chip.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + chip.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: Math.max(0, left - 16) });
  }, [current]);
  return (
    <nav ref={nav} className="area-tabs" aria-label="Sections" data-testid="area-tabs">
      <ul ref={list}>
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${prefix}${section.id}`} data-testid={`area-tab-${section.id}`} data-section={section.id}
              aria-current={current === section.id ? "true" : undefined}
              onClick={(event) => {
                if (!onGo || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onGo(section.id);
              }}>
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
