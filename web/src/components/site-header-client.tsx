"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

import { SAVED_MAP_STATE_KEY, savedMapHref } from "@/lib/map-state";
import { SAVED_HREF } from "@/lib/saved-panel";
import { useSaved } from "@/lib/saved-items";

import { KnitIcon } from "./knit/knit-icon";

/**
 * "Skip to content": the first stop on every page off the map. Focus moves past
 * the header to the page's heading (or <main> itself), so the next Tab lands
 * on the page's own links, not the header again. Uses the shared .skip-link.
 */
export function SkipToContent() {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    const main = event.currentTarget.closest("main") ?? document.querySelector("main");
    if (!main) return;
    event.preventDefault();
    const target = main.querySelector<HTMLElement>("h1") ?? main;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  }
  return <a className="skip-link" href="#main-content" data-testid="skip-to-content" onClick={skip}>Skip to content</a>;
}

/**
 * ♡ N, everything saved (areas, homes, schools, places), in the map's top bar and every page's
 * header: live, so a ♡ pressed anywhere on the page counts at once. Shows nothing when N is 0.
 * Off the map it is a full load of the map on Saved; on the map `onOpen` opens the Saved panel.
 */
export function SavedAreasLink({ onOpen, open }: { onOpen?: () => void; open?: boolean }) {
  const { count } = useSaved();
  if (count === 0) return null;
  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onOpen();
  }
  return (
    <a href={SAVED_HREF} onClick={click} className="saved-link" data-testid="header-saved-areas" aria-label={`Saved (${count})`}
      aria-expanded={onOpen ? !!open : undefined}>
      <KnitIcon name="heart" colour="var(--yarn-cherry)" className="saved-link__icon" style={{ width: 18, height: 18 }} />
      <span aria-hidden="true">{count}</span>
    </a>
  );
}

// The page this document first loaded: a later client-side step keeps document.referrer, so
// "came from the map" holds only on that first page.
const LANDING = typeof window === "undefined" ? null : window.location.pathname;

function cameFromMap(): boolean {
  if (!document.referrer || window.location.pathname !== LANDING) return false;
  try {
    const from = new URL(document.referrer);
    return from.origin === window.location.origin && from.pathname === "/";
  } catch {
    return false;
  }
}

/**
 * The way back to the map with its view: a step back when this page was opened from the map,
 * else the last view saved on this device (layer, zoom, chosen area), else a bare map.
 */
export function useMapReturn() {
  const [href, setHref] = useState("/");
  useEffect(() => {
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(SAVED_MAP_STATE_KEY); } catch { raw = null; }
    setHref(savedMapHref(raw));
  }, []);
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (!cameFromMap()) return;
    event.preventDefault();
    window.history.back();
  }
  return { href, onClick };
}

/** "Map →" at the header's end (named "Back to the map"): a full load, the map reads its view on boot. */
export function BackToMapLink() {
  const back = useMapReturn();
  return (
    <a href={back.href} onClick={back.onClick} className="site-header__map back-link" aria-label="Back to the map">
      <span>Map</span>
      <KnitIcon name="arrow-right" className="site-header__icon" />
    </a>
  );
}

/** The knitted house and wordmark: back to the map, like "Map →". */
export function BrandHomeLink({ children }: { children: ReactNode }) {
  const back = useMapReturn();
  return (
    <a href={back.href} onClick={back.onClick} className="site-header__brand" aria-label="close knit: back to the map">
      {children}
    </a>
  );
}
