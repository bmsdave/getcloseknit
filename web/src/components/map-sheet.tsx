"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { forgetMapSheet, openMapSheetId, subscribeMapSheets } from "@/lib/map-sheets";
import { DRAG_START, FLICK_VELOCITY, rubberBand, SHEET_SNAPS, snapAfterRelease, snapAfterTap, stepSnap, type SheetSnap } from "@/lib/sheet-snap";
import { isPhone, PHONE_QUERY } from "@/lib/viewport";

import { KnitIcon } from "./knit/knit-icon";

/** Phones get bottom sheets; a phone on its side does not (lib/viewport.ts; styles/layout.css repeats the query). */
export { isPhone, PHONE_QUERY };

/** The id of the MapSheet open now (lib/map-sheets.ts), or null. */
export function useOpenMapSheet(): string | null {
  return useSyncExternalStore(subscribeMapSheets, openMapSheetId, () => null);
}

export interface MapSheetProps {
  /** The sheet's id in lib/map-sheets.ts ("layers", "show", …): one sheet is open at a time. */
  id: string;
  /** The header's title; null leaves the header to the content (it brings its own title · ✕). */
  title: string | null;
  /** Where a phone sheet may rest, lowest first; default half · full. Without "collapsed" a pull or flick down past half closes it. */
  snaps?: readonly SheetSnap[];
  /** Where it opens on a phone; default "half". */
  initial?: SheetSnap;
  /** ✕, Escape, the back gesture or a pull down: the owner closes it (closeMapSheet) and puts focus back on its opener. */
  onClose: () => void;
  /** Beside the title, before ✕: the "Default" reset. */
  headerExtra?: ReactNode;
  /**
   * In place of the visible title (it stays for screen readers and focus): the content's own way back, e.g. My match's
   * "← My match" over an area, so the sheet never reads "My match ✕" over "← My match".
   */
  lead?: ReactNode;
  children: ReactNode;
  testId?: string;
  closeTestId?: string;
  /** Extra class names, e.g. the floating card's look on a desktop. */
  className?: string;
  /** More data attributes for the owner's CSS (data-card="layers"). */
  data?: Record<string, string>;
  /** Asks a phone sheet to rest at a snap it allows (My match's "Top 10 ›" goes full); `at` makes a repeat count. */
  snapTo?: { snap: SheetSnap; at: number } | null;
}

/** The handle's accessible name says where the sheet rests. */
export const SNAP_NAMES: Record<SheetSnap, string> = { collapsed: "lowered", half: "half height", full: "full height" };
const DEFAULT_SNAPS: readonly SheetSnap[] = ["half", "full"];

/**
 * One sheet for the map: Layers, Show, the layer explainer and the "How to allow" steps
 * today; My match, Saved and Areas/zones later. Phones: a bottom sheet that rests at its snaps and is
 * dragged, flicked and tapped between them with the area sheet's gestures (useSheetDrag), its content
 * scrolling only at full (at half a drag anywhere moves it). The header is title · extra · ✕; Escape,
 * ✕ and the back gesture close it; focus moves to the title on open unless the content took it.
 * Desktops: the same markup is the floating card beside the map's buttons (styles/layout.css).
 *
 *   <MapSheet id="show" title="Show" onClose={close} headerExtra={<DefaultButton … />}>…</MapSheet>
 */
export function MapSheet(props: MapSheetProps) {
  const allowed = props.snaps ?? DEFAULT_SNAPS;
  const [rest, setRest] = useState<SheetSnap>(() => props.initial && allowed.includes(props.initial) ? props.initial : allowed.includes("half") ? "half" : allowed[0]);
  const snap = allowed.includes(rest) ? rest : allowed[0];
  const sheet = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const live = useRef(props.onClose);
  live.current = props.onClose;
  const dismissable = !allowed.includes("collapsed");
  const { snapTo } = props;
  useEffect(() => {
    if (snapTo && allowed.includes(snapTo.snap)) setRest(snapTo.snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapTo]);
  useSheetDrag(sheet, snap, allowed, setRest, {
    key: props.id,
    handle: SHEET_HANDLE,
    content: ".map-sheet__body",
    bodyDrags: true,
    onDismiss: dismissable ? () => live.current() : undefined,
  });
  // Focus: the title, unless the content took it (Layers focuses the layer shown).
  useEffect(() => {
    const node = sheet.current;
    if (node && !node.contains(document.activeElement)) {
      (title.current ?? node.querySelector<HTMLElement>("[data-explainer-focus]") ?? node).focus({ preventScroll: true });
    }
  }, []);
  // Escape closes, unless a disclosure inside is open (it closes first).
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (sheet.current?.querySelector("[aria-expanded='true']:not([data-fold]):not(.map-sheet__grip)")) return;
      event.preventDefault();
      event.stopPropagation();
      live.current();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, []);
  // Leaving the page with the sheet open: the store forgets it (history belongs to the navigation).
  // (After a microtask: React's development double mount runs this cleanup and mounts again at once.)
  const { id } = props;
  useEffect(() => {
    const mounted = { current: true };
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current && !sheet.current?.isConnected) forgetMapSheet(id);
      });
    };
  }, [id]);
  // Below full the content does not scroll: it starts at its top again.
  useEffect(() => {
    if (snap !== "full") sheet.current?.querySelector(".map-sheet__body")?.scrollTo?.({ top: 0 });
  }, [snap]);
  return (
    <section
      ref={sheet}
      className={`map-sheet${props.className ? ` ${props.className}` : ""}`}
      // Without a title the content is the dialog (the layer explainer brings its own).
      role={props.title !== null ? "dialog" : undefined}
      aria-label={props.title ?? undefined}
      tabIndex={-1}
      data-testid={props.testId}
      data-sheet={props.id}
      data-snap={snap}
      {...Object.fromEntries(Object.entries(props.data ?? {}).map(([key, value]) => [`data-${key}`, value]))}
    >
      <button
        type="button"
        className="map-sheet__grip"
        data-testid="map-sheet-handle"
        aria-label={`Sheet size: ${SNAP_NAMES[snap]}`}
        onClick={() => {
          const next = snapAfterTap(snap);
          if (allowed.includes(next)) setRest(next);
          else if (snap === "full") setRest("half");
          else setRest(allowed[allowed.length - 1]);
        }}
        onKeyDown={(event) => {
          const step = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          setRest(stepSnap(snap, step, allowed));
        }}
      >
        <span className="panel-handle" />
      </button>
      {props.title !== null && (
        <div className="map-sheet__head">
          <h2 ref={title} className={props.lead ? "sr-only" : "map-sheet__title"} tabIndex={-1}>{props.title}</h2>
          {props.lead && <div className="map-sheet__lead">{props.lead}</div>}
          {props.headerExtra}
          <button type="button" className="map-sheet__close" data-testid={props.closeTestId ?? (props.testId ? `${props.testId}-close` : undefined)}
            aria-label={`Close ${props.title.toLowerCase()}`} onClick={() => live.current()}>
            <KnitIcon name="cross" colour="var(--icon-yarn, currentColor)" style={{ width: 16, height: 16 }} />
          </button>
        </div>
      )}
      <div className="map-sheet__body">{props.children}</div>
    </section>
  );
}

/**
 * The quiet "Default" text button for a sheet's header: muted and disabled while the sheet
 * already holds its defaults.
 */
export function SheetDefaultButton({ isDefault, onReset, testId }: { isDefault: boolean; onReset: () => void; testId?: string }) {
  return (
    <button type="button" className="map-sheet__default" data-testid={testId} disabled={isDefault} onClick={onReset}>Default</button>
  );
}

/** Where a drag may start on a MapSheet: the grabber and the header (and an explainer's own header). */
const SHEET_HANDLE = ".map-sheet__grip, .map-sheet__head, .layer-explainer__head";
// [data-sheet-nodrag]: a control with its own drag (My match's ≡ reorder handles).
const NOT_A_HANDLE = "input, select, textarea, [data-sheet-nodrag]";
/** Only the last stretch of a drag sets its release speed: a finger that stops before lifting does not flick. */
const VELOCITY_WINDOW = 100;
/** A sheet without a peek closes when let go this far (px) below its half, or flicked down from there. */
const DISMISS_PULL = 72;

export interface SheetDragOptions {
  /** What the resting heights depend on besides the viewport (the area sheet's kind of content). */
  key: string;
  /** Selector of the parts that drag the sheet with any pointer (grabber, header, peek line). */
  handle: string;
  /** Selector of the scrolling content: a finger there scrolls it at full and drags the sheet from its top. */
  content: string;
  /** Below full, a finger anywhere in the content drags the sheet (MapSheet); else only the handles do (the area sheet). */
  bodyDrags?: boolean;
  /** A sheet without "collapsed": a pull or flick down past its lowest snap closes it. */
  onDismiss?: () => void;
  /** The half snap's share of the screen (dvh) before it has been seen, from --sheet's. */
  halfShare?: (sheetVh: number) => number;
  /** Every time the sheet comes to rest on a phone (the area sheet lifts the map's buttons with it). */
  onRest?: (sheet: HTMLElement) => void;
  /** Called when the sheet leaves phone layout (the area sheet clears what onRest set). */
  onDesktop?: (sheet: HTMLElement | null) => void;
}

interface Drag {
  /** The sheet's layout top while pinned at full height; offset is the transform below it. */
  base: number;
  offset: number;
  /** The offset and the finger's y when the drag began. */
  start: number;
  y: number;
  /** The offsets of the highest and lowest allowed snaps; past them the sheet stretches. */
  min: number;
  max: number;
  full: number;
  heights: Record<SheetSnap, number>;
  samples: [time: number, y: number][];
}

interface Press {
  id: number;
  time: number;
  x: number;
  y: number;
  /** A finger in the content: it scrolls (at full), and only a pull down from its top moves the sheet. */
  content: boolean;
  /** A finger in the scrolled content: the browser scrolls it (and cancels the pointer), and a
   * pull down that reaches its top hands over to the sheet in the same gesture, by touch events. */
  scrolled: boolean;
  drag: Drag | null;
}

/**
 * A phone sheet's gestures and motion, shared by the area sheet (map-dock.tsx) and every MapSheet.
 * The handles drag it once a press travels DRAG_START px. The content is text to select and copy: a
 * mouse there only selects, and a finger scrolls it at full, except that a pull down from its top
 * moves the sheet (scrolled, a pull down scrolls it to its top and then moves the sheet); below full
 * a finger there moves the sheet when `bodyDrags`. A drag pins the sheet at its full height and
 * moves it by transform only, once a frame, without a React render. On release it rests where
 * snapAfterRelease says from the finger's position and speed. Every change of snap (a drag, a tap, a
 * key) slides the sheet from where it showed to where it rests; the curve is in layout.css. A press
 * that never travels stays an ordinary tap, and a drag that ends over a button does not press it.
 */
export function useSheetDrag(
  ref: RefObject<HTMLElement | null>,
  snap: SheetSnap,
  allowed: readonly SheetSnap[],
  onSnap: (next: SheetSnap) => void,
  options: SheetDragOptions,
) {
  const live = useRef({ snap, allowed, onSnap, options });
  live.current = { snap, allowed, onSnap, options };
  /** Resting heights seen per snap, for the content kind and viewport they were seen with. */
  const seen = useRef<{ key: string; heights: Partial<Record<SheetSnap, number>> }>({ key: "", heights: {} });
  /** The layout top the sheet rests at, and the top it showed at when a drag let go. */
  const rest = useRef<number | null>(null);
  const from = useRef<number | null>(null);

  const remember = (sheet: HTMLElement) => {
    rest.current = sheet.offsetTop;
    const key = `${live.current.options.key} ${window.innerWidth}x${window.innerHeight}`;
    if (seen.current.key !== key) seen.current = { key, heights: {} };
    seen.current.heights[live.current.snap] = sheet.offsetHeight;
    live.current.options.onRest?.(sheet);
  };

  // Slide every change of snap from where the sheet showed.
  useLayoutEffect(() => {
    const sheet = ref.current;
    if (!sheet || !window.matchMedia(PHONE_QUERY).matches) {
      rest.current = null;
      live.current.options.onDesktop?.(sheet);
      return;
    }
    const start = from.current ?? (rest.current === null ? null : rest.current + shift(sheet));
    from.current = null;
    unpin(sheet);
    remember(sheet);
    slide(sheet, start === null ? 0 : start - sheet.offsetTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, snap, options.key]);

  useEffect(() => {
    const sheet = ref.current;
    if (!sheet) return;
    let press: Press | null = null;
    let frame = 0;
    let draggedAt = -Infinity;
    const measure = () => {
      if (!sheet.dataset.dragging && window.matchMedia(PHONE_QUERY).matches) remember(sheet);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    const contentOf = () => sheet.querySelector<HTMLElement>(live.current.options.content);
    const dismissable = () => Boolean(live.current.options.onDismiss) && !live.current.allowed.includes("collapsed");

    const begin = (drag: Press, event: { clientY: number; timeStamp: number; pointerId?: number }) => {
      const shown = sheet.getBoundingClientRect().top; // mid-slide too
      sheet.dataset.dragging = "true";
      const full = Number.parseFloat(getComputedStyle(sheet).maxHeight) || window.innerHeight - 72;
      sheet.style.height = `${full}px`;
      sheet.style.transform = "";
      const base = sheet.offsetTop;
      const known = seen.current.heights;
      // Half is --sheet (45dvh, more on short phones) until it has been seen; a sheet may take more (the match list).
      const sheetVh = Number.parseFloat(getComputedStyle(sheet).getPropertyValue("--sheet")) || 45;
      const halfVh = live.current.options.halfShare?.(sheetVh) ?? sheetVh;
      const heights = {
        collapsed: dismissable() ? 0 : known.collapsed ?? 72,
        half: known.half ?? Math.min(full, (window.innerHeight * halfVh) / 100),
        full,
      };
      const stops = live.current.allowed.map((name) => heights[name]);
      drag.drag = {
        base, offset: shown - base, start: shown - base, y: event.clientY,
        // A sheet that closes when pulled down follows the finger all the way down.
        min: full - Math.max(...stops), max: dismissable() ? full : full - Math.min(...stops), full, heights,
        samples: [[drag.time, drag.y], [event.timeStamp, event.clientY]],
      };
      if (event.pointerId === undefined) return;
      try {
        sheet.setPointerCapture(event.pointerId);
      } catch {}
    };

    const follow = (drag: Drag, y: number, time: number) => {
      drag.samples.push([time, y]);
      if (drag.samples.length > 8) drag.samples.shift();
      drag.offset = rubberBand(drag.start + y - drag.y, drag.min, drag.max);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (press?.drag) sheet.style.transform = `translate3d(0, ${press.drag.offset}px, 0)`;
        });
      }
    };

    const down = (event: PointerEvent) => {
      draggedAt = -Infinity; // a drag's click, if any, came before this press
      if (event.button !== 0 || !event.isPrimary || !window.matchMedia(PHONE_QUERY).matches) return;
      const target = event.target as Element;
      if (target.closest(NOT_A_HANDLE)) return;
      const content = target.closest<HTMLElement>(live.current.options.content);
      const full = live.current.snap === "full";
      // A mouse or pen in the text drag-selects it; only a finger hands its scroll over to the sheet.
      const finger = event.pointerType === "touch";
      const fromContent = Boolean(content && finger && (full || live.current.options.bodyDrags));
      if (!target.closest(live.current.options.handle) && !fromContent) return;
      // Below full the content of a MapSheet does not scroll: a finger there is the sheet's.
      const scrollable = Boolean(content && full);
      const scrolled = Boolean(scrollable && content!.scrollTop > 0);
      press = { id: event.pointerId, time: event.timeStamp, x: event.clientX, y: event.clientY, content: scrollable, scrolled, drag: null };
    };

    const move = (event: PointerEvent) => {
      // A scrolled press is the browser's scroll until touchMove hands it over.
      if (!press || press.id !== event.pointerId || press.scrolled) return;
      if (!press.drag) {
        const dx = event.clientX - press.x;
        const dy = event.clientY - press.y;
        if (Math.abs(dy) < DRAG_START && Math.abs(dx) < DRAG_START) return;
        // Sideways is a scroll of a row inside; up in scrolling content scrolls it.
        if (Math.abs(dx) > Math.abs(dy) || (press.content && dy < 0)) {
          press = null;
          return;
        }
        begin(press, event);
      }
      follow(press.drag!, event.clientY, event.timeStamp);
    };

    const up = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId) return;
      // The browser cancels the pointer when it starts scrolling the content: the touch carries on.
      if (press.scrolled && event.type === "pointercancel") return;
      release(event.timeStamp, event.type === "pointerup");
    };

    const release = (now: number, lifted: boolean) => {
      const drag = press?.drag;
      press = null;
      if (!drag) return;
      cancelAnimationFrame(frame);
      frame = 0;
      draggedAt = now;
      // The speed over the last moves, unless the finger rested before it lifted.
      const last = drag.samples[drag.samples.length - 1];
      const first = drag.samples.find(([time]) => time < last[0] && last[0] - time <= VELOCITY_WINDOW);
      const velocity = lifted && first && now - last[0] <= VELOCITY_WINDOW
        ? (last[1] - first[1]) / (last[0] - first[0])
        : 0;
      const shown = drag.full - drag.offset;
      const top = drag.base + drag.offset;
      sheet.style.transform = `translate3d(0, ${drag.offset}px, 0)`;
      if (dismissable()) {
        const lowest = Math.min(...live.current.allowed.map((name) => drag.heights[name]));
        if (shown < lowest - DISMISS_PULL || (velocity >= FLICK_VELOCITY && shown <= lowest + 1)) {
          unpin(sheet);
          live.current.options.onDismiss?.();
          return;
        }
      }
      const target = snapAfterRelease(shown, velocity, drag.heights, live.current.allowed);
      if (target === live.current.snap) {
        unpin(sheet);
        slide(sheet, top - sheet.offsetTop);
        return;
      }
      from.current = top;
      live.current.onSnap(target);
      // Should the snap not change after all, still let the sheet go.
      requestAnimationFrame(() => {
        if (from.current === null) return;
        from.current = null;
        unpin(sheet);
        slide(sheet, top - sheet.offsetTop);
      });
    };

    // A pull down from the top of the content is the sheet's, not a scroll.
    let touchY = 0;
    const touchMove = (event: TouchEvent) => {
      if (!press) return;
      const touch = event.touches[0];
      if (press.scrolled && touch) {
        const was = touchY;
        touchY = touch.clientY;
        if (!press.drag) {
          // Scrolling back up the content: once at its top, a finger still moving down takes the sheet.
          const content = contentOf();
          if (!content || content.scrollTop > 0 || touch.clientY <= was) return;
          press.time = event.timeStamp;
          press.y = touch.clientY;
          begin(press, { clientY: touch.clientY, timeStamp: event.timeStamp });
        }
        if (event.cancelable) event.preventDefault();
        follow(press.drag!, touch.clientY, event.timeStamp);
        return;
      }
      const pull = press.content && live.current.snap === "full" && touch
        && touch.clientY > press.y && Math.abs(touch.clientY - press.y) >= Math.abs(touch.clientX - press.x);
      if ((press.drag || pull) && event.cancelable) event.preventDefault();
    };

    const touchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const touchEnd = (event: TouchEvent) => {
      if (!press?.scrolled) return;
      const touch = event.changedTouches[0];
      if (press.drag && touch) follow(press.drag, touch.clientY, event.timeStamp);
      release(event.timeStamp, event.type === "touchend");
    };

    // A drag that ends over a button must not also press it: clicks this soon after are swallowed.
    const click = (event: MouseEvent) => {
      if (event.timeStamp - draggedAt > 500) return;
      draggedAt = -Infinity;
      event.preventDefault();
      event.stopPropagation();
    };

    sheet.addEventListener("pointerdown", down);
    sheet.addEventListener("pointermove", move);
    sheet.addEventListener("pointerup", up);
    sheet.addEventListener("pointercancel", up);
    sheet.addEventListener("touchstart", touchStart, { passive: true });
    sheet.addEventListener("touchmove", touchMove, { passive: false });
    sheet.addEventListener("touchend", touchEnd);
    sheet.addEventListener("touchcancel", touchEnd);
    sheet.addEventListener("click", click, true);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      sheet.removeEventListener("pointerdown", down);
      sheet.removeEventListener("pointermove", move);
      sheet.removeEventListener("pointerup", up);
      sheet.removeEventListener("pointercancel", up);
      sheet.removeEventListener("touchstart", touchStart);
      sheet.removeEventListener("touchmove", touchMove);
      sheet.removeEventListener("touchend", touchEnd);
      sheet.removeEventListener("touchcancel", touchEnd);
      sheet.removeEventListener("click", click, true);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}

/** The sheet's current transform offset (px), mid-slide too. */
function shift(sheet: HTMLElement): number {
  const transform = getComputedStyle(sheet).transform;
  return transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
}

/** Hands the sheet back to its CSS height, with no transition yet. */
function unpin(sheet: HTMLElement) {
  sheet.style.transition = "none";
  sheet.style.height = "";
  sheet.style.transform = "";
  delete sheet.dataset.dragging;
}

/** Shows the sheet (or a control riding on it, map-dock.tsx) `delta` px below where it rests, then lets the CSS transition take it home. */
export function slide(sheet: HTMLElement, delta: number) {
  sheet.style.transition = "none";
  sheet.style.transform = Math.abs(delta) < 1 ? "" : `translate3d(0, ${delta}px, 0)`;
  void sheet.offsetHeight;
  sheet.style.transition = "";
  sheet.style.transform = "";
}

export { SHEET_SNAPS };
