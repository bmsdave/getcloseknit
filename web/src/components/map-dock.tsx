"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

import {
  applyPanelWidth, clampPanelWidth, PANEL_DEFAULT, PANEL_MAX, PANEL_MIN, PANEL_STEP, readPanelWidth, writePanelWidth,
} from "@/lib/panel-width";
import { SHEET_SNAPS, snapAfterTap, stepSnap, type SheetSnap } from "@/lib/sheet-snap";

import { KnitIcon } from "./knit/knit-icon";
import { isPhone, slide, SNAP_NAMES, useSheetDrag } from "./map-sheet";

export { isPhone };

export type DockArea = "empty" | "area" | "match" | "saved";

interface MapDockProps {
  /**
   * Where the sheet rests (phones). Desktop folds the side panel to its strip at
   * "collapsed" and shows it at either other snap. Only the visitor moves it:
   * map taps never do (close-knit.tsx).
   */
  snap: SheetSnap;
  onSnap: (next: SheetSnap) => void;
  /** What the area row holds: nothing yet, an area's evidence, or the match ranking. */
  area: DockArea;
  /** "Area name · value" (or a tapped place) for the peek row; null while unknown. */
  summary: string | null;
  /** With nothing chosen, the peek's "Try an example" (the ready-made search). */
  onExample?: () => void;
  /** The area evidence, the match ranking, or the empty state. */
  children: ReactNode;
  /** Clicks inside the panel's content, before its links act (close-knit.tsx opens a school's link here). */
  onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * The area block over the map: area information only (the map's layers, key,
 * credits and settings are its own controls, map-layers.tsx). Desktop: a right
 * panel from the top that collapses to a 44px strip, and no panel at
 * all with nothing chosen (the hint under the search says what to do; layout.css);
 * a phone on its side gets the same panel, 360px wide. Phones held
 * upright (lib/viewport.ts PHONE_QUERY): a
 * bottom sheet like the one in Apple or Google Maps, resting at a peek, half or
 * full and dragged between them (see useSheetDrag). The peek is the grabber over
 * one line: "Area · value", or "Choose an area · Try an example". A tap on the
 * grabber or that line opens it to half and lowers it again. (Licence lines and
 * credits are the map's ⓘ corner.)
 */
export function MapDock(props: MapDockProps) {
  // With nothing chosen the open sheet is only its rows: there is no full. On a phone it rests as its
  // peek bar (close-knit.tsx never lifts it), so the map's centre stays the map's; only the visitor's
  // own tap or drag opens it (the prompt, Try an example and the map's attribution).
  const allowed = props.area === "empty" ? SHEET_SNAPS.slice(0, 2) : SHEET_SNAPS;
  const snap: SheetSnap = allowed.includes(props.snap) ? props.snap : "half";
  const expanded = snap !== "collapsed";
  const setSnap = (next: SheetSnap) => {
    if (allowed.includes(next)) props.onSnap(next);
  };
  const sheet = useRef<HTMLElement>(null);
  const peekFit = usePeekFit(sheet, props.area === "area");
  // The shared phone-sheet gestures (map-sheet.tsx); the match list's half is taller, and an area's
  // half grows to show its peek whole (usePeekFit).
  useSheetDrag(sheet, snap, allowed, setSnap, {
    key: `${props.area}${peekFit ? ` ${peekFit}` : ""}`,
    handle: HANDLE,
    content: ".dock-area",
    halfShare: (sheetVh) => (props.area === "match" ? Math.max(sheetVh, 74)
      : peekFit ? Math.max(sheetVh, (peekFit / window.innerHeight) * 100) : sheetVh),
    onRest: liftControls,
    onDesktop: dropControls,
  });
  // The stored panel width: app/page.tsx sets it before first paint; a client-side visit to the map gets it here.
  useEffect(() => applyPanelWidth(readPanelWidth()), []);
  // Desktop: the panel, absent with nothing chosen, slides in when something is (layout.css).
  const [entering, setEntering] = useState(false);
  const wasEmpty = useRef(props.area === "empty");
  useEffect(() => {
    if (wasEmpty.current && props.area !== "empty" && !isPhone()) setEntering(true);
    wasEmpty.current = props.area === "empty";
  }, [props.area]);
  const reopenLabel = props.summary
    ?? (props.area === "match" ? "Personal matches" : props.area === "area" ? "Show area evidence" : props.area === "saved" ? "Saved"
      : "Choose an area");
  return (
    <aside
      ref={sheet}
      className="map-dock"
      data-block="map-dock"
      data-testid="map-dock"
      data-expanded={expanded}
      data-snap={snap}
      data-area={props.area}
      data-entering={entering || undefined}
      style={peekFit ? ({ "--sheet-fit": `${peekFit}px` } as CSSProperties) : undefined}
      onAnimationEnd={(event) => { if (event.target === event.currentTarget) setEntering(false); }}
      aria-label="Area evidence"
    >
      {/* Phones: the grabber, the head and the peek line drag the sheet; its text is for reading
          and copying. The grabber is a button too: a tap, Enter or Space toggles the peek and
          half, the arrow keys step the snaps, Escape lowers it. */}
      <button
        type="button"
        className="dock-grip"
        data-testid="sheet-handle"
        aria-expanded={expanded}
        aria-label={`Panel size: ${SNAP_NAMES[snap]}`}
        onClick={() => setSnap(snapAfterTap(snap))}
        onKeyDown={(event) => {
          const step = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
          if (step) {
            event.preventDefault();
            setSnap(stepSnap(snap, step, allowed));
          } else if (event.key === "Escape" && snap !== "collapsed") {
            event.stopPropagation();
            setSnap("collapsed");
          }
        }}
      >
        <span className="panel-handle" />
      </button>
      {expanded && <PanelResize dock={sheet} />}
      {expanded && (
        <div className="dock-head">
          <button
            type="button"
            className="dock-toggle"
            data-testid="evidence-sheet-close"
            aria-label="Hide panel"
            aria-expanded={true}
            onClick={() => setSnap("collapsed")}
          >
            <PanelIcon />
            <Chevron />
          </button>
        </div>
      )}
      <div className="dock-area" onClickCapture={props.onClickCapture}>
        {props.children}
      </div>
      {!expanded && (
        <button
          type="button"
          className="dock-reopen"
          data-testid="evidence-sheet-reopen"
          aria-expanded={false}
          aria-label={props.summary ? `Show panel: ${props.summary}` : undefined}
          onClick={() => setSnap("half")}
        >
          <span className="dock-reopen-label">{reopenLabel}</span>
          <Chevron />
        </button>
      )}
      {!expanded && props.area === "empty" && props.onExample && (
        <button type="button" className="dock-example" data-testid="dock-example" onClick={props.onExample}>Try an example</button>
      )}
    </aside>
  );
}

/** At most this share of a phone's height for an area's half: the chosen area stays in view above it. */
const PEEK_MAX_SHARE = 0.72;

/**
 * An area's peek on a phone (round-2 finding 3): the half height that shows its header, verdict,
 * tags and all four peek tiles above the sticky footer (Compare · Like this · Check a home, Open full
 * area page), in px; null off a phone, before it is measured, or for other content. It follows the
 * content (a longer name, more tags) and never takes more than PEEK_MAX_SHARE of the screen.
 */
export function usePeekFit(sheet: RefObject<HTMLElement | null>, active: boolean): number | null {
  const [fit, setFit] = useState<number | null>(null);
  useEffect(() => {
    const node = sheet.current;
    if (!active || !node) {
      setFit(null);
      return;
    }
    const measure = () => {
      const peek = node.querySelector<HTMLElement>('.evidence-panel[data-view="peek"]');
      const tiles = peek?.querySelector<HTMLElement>(".standout-tiles");
      const footer = node.querySelector<HTMLElement>('[data-testid="area-view-footer"]');
      // Measured once the peek has loaded: a fit taken from its placeholders moved the sheet two or three
      // times as they filled in, each move a layout shift (the layout sweep's CLS).
      if (!isPhone() || !tiles || !footer || peek?.querySelector('[aria-busy="true"]')) return;
      // The content flows from the sheet's top whatever its height: the tiles' bottom from there, then the footer.
      const scroller = node.querySelector<HTMLElement>(".dock-area");
      const below = tiles.getBoundingClientRect().bottom - node.getBoundingClientRect().top + (scroller?.scrollTop ?? 0);
      const needed = Math.ceil(below + footer.offsetHeight + 12);
      const next = Math.min(needed, Math.round(window.innerHeight * PEEK_MAX_SHARE));
      setFit((current) => (current !== null && Math.abs(current - next) < 4 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    const content = node.querySelector(".dock-area");
    if (content) for (const child of Array.from(content.children)) observer.observe(child);
    observer.observe(node);
    const mutations = new MutationObserver(() => {
      observer.disconnect();
      if (content) for (const child of Array.from(content.children)) observer.observe(child);
      observer.observe(node);
      measure();
    });
    if (content) mutations.observe(content, { childList: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [sheet, active]);
  return fit;
}

/**
 * Desktop: the panel's left edge widens or narrows it (lib/panel-width.ts). Drag it, or focus it and use the
 * arrow keys (Shift: bigger steps), Home and End; a double-click goes back to the default. The width is
 * remembered per browser; the map moves by half the change so what was in the middle of the visible map
 * stays there. Hidden on phones (layout.css).
 */
function PanelResize({ dock }: { dock: RefObject<HTMLElement | null> }) {
  const [width, setWidth] = useState<number | null>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const measure = () => Math.round(dock.current?.getBoundingClientRect().width ?? PANEL_DEFAULT);
  useEffect(() => { setWidth(measure()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const resize = (next: number | null, save: boolean) => {
    const before = measure();
    const clamped = next === null ? null : clampPanelWidth(next, window.innerWidth);
    applyPanelWidth(clamped);
    const after = measure();
    if (after !== before) window.__closeKnitMap?.panBy([(after - before) / 2, 0], { animate: false });
    setWidth(after);
    if (save) writePanelWidth(clamped);
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    delete dock.current?.dataset.resizing;
    resize(measure(), true);
    window.__closeKnitMap?.resize();
  };
  return (
    <div
      className="dock-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      aria-valuenow={width ?? PANEL_DEFAULT}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-testid="panel-resize"
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: measure() };
        if (dock.current) dock.current.dataset.resizing = "";
      }}
      onPointerMove={(event) => {
        if (drag.current) resize(drag.current.width + drag.current.x - event.clientX, false);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => resize(null, true)}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? PANEL_STEP * 4 : PANEL_STEP;
        const next = event.key === "ArrowLeft" ? measure() + step : event.key === "ArrowRight" ? measure() - step
          : event.key === "Home" ? PANEL_MIN : event.key === "End" ? PANEL_MAX : null;
        if (next === null) return;
        event.preventDefault();
        resize(next, true);
      }}
    />
  );
}

/** Desktop: a side panel folding to the right. */
function PanelIcon() {
  return <KnitIcon name="panel" colour="var(--icon-yarn, currentColor)" className="icon-panel" style={{ width: 18, height: 18 }} />;
}

function Chevron() {
  return <KnitIcon name="chevron" colour="var(--icon-yarn, currentColor)" className="chevron" style={{ width: 16, height: 16 }} />;
}

/** Where a drag starts: the grabber, the head and the peek line; never text (it selects) or a field. */
const HANDLE = ".dock-grip, .dock-head, .dock-reopen";
/** Map height a phone needs over the sheet for the round buttons in a column: the top bar (72px), four 44px buttons with 10px gaps, 12px either side. */
const CONTROLS_COLUMN = 72 + 12 + 4 * 44 + 3 * 10 + 12;
/** The controls that ride above the sheet (layout.css --float-bottom). */
const FLOATING = ".map-controls :is(.map-rail, .map-position, .map-key, .map-credits)";

/**
 * The map's own controls (map-layers.tsx) ride above where the area sheet rests; they slide with it
 * from the frame after the first rest is known (data-sheet-rest), so a page load never animates.
 */
function liftControls(sheet: HTMLElement) {
  const shell = sheet.parentElement;
  if (!shell) return;
  // Once the first rest is known they slide to a new one by a transform from where they showed, as the sheet
  // does (slide): moving `bottom` itself was a layout shift whenever an area's sheet fitted its loaded peek.
  const controls = shell.dataset.sheetRest === undefined ? [] : Array.from(shell.querySelectorAll<HTMLElement>(FLOATING));
  const shown = controls.map((control) => control.getBoundingClientRect().top);
  shell.style.setProperty("--sheet-rest", `${Math.max(0, window.innerHeight - sheet.offsetTop)}px`);
  // Too little map over a high sheet for the column of round buttons (the top bar, four 44px buttons
  // and their gaps): they lie in a row above the sheet instead (layout.css).
  if (sheet.offsetTop < CONTROLS_COLUMN) shell.dataset.sheetHigh = "";
  else delete shell.dataset.sheetHigh;
  controls.forEach((control, index) => {
    control.style.transition = "none";
    control.style.transform = "";
    slide(control, shown[index] - control.getBoundingClientRect().top);
  });
  if (!shell.dataset.sheetRest) requestAnimationFrame(() => requestAnimationFrame(() => { shell.dataset.sheetRest = ""; }));
}

function dropControls(sheet: HTMLElement | null) {
  const shell = sheet?.parentElement;
  if (!shell) return;
  shell.style.removeProperty("--sheet-rest");
  delete shell.dataset.sheetRest;
  delete shell.dataset.sheetHigh;
}
