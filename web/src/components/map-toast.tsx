"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { currentMapToast, hideMapToast, subscribeMapToast } from "@/lib/map-toast";

import { KnitIcon } from "./knit/knit-icon";

/**
 * The one map toast, mounted once over the map (close-knit.tsx); lib/map-toast.ts is how
 * anything shows one. Phones: just under the search pill, full width minus the gutters; desktops:
 * top-centre of the map the panel leaves visible (max 520px). Above the map's controls, the legend and
 * every sheet, below modal dialogs (styles/layout.css). role="status", polite; one at a time; ✕ closes
 * it and it hides on its own after its time, paused while it is hovered or focused.
 */
export function MapToast() {
  const toast = useSyncExternalStore(subscribeMapToast, currentMapToast, () => null);
  const [held, setHeld] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = toast?.id;
  const ms = toast?.ms;
  // A new toast starts its own clock; hovering or focusing it stops the clock, leaving restarts it.
  useEffect(() => {
    if (id === undefined || ms === undefined || held) return;
    const timer = window.setTimeout(() => hideMapToast(id), ms);
    return () => window.clearTimeout(timer);
  }, [id, ms, held]);
  useEffect(() => setHeld(false), [id]);
  return (
    // The live region stays mounted so screen readers hear each new message.
    <div className="map-toast-region" role="status" aria-live="polite" data-testid="map-toast-region">
      {toast && (
        <div
          ref={box}
          key={toast.id}
          className="map-toast"
          data-testid="map-toast"
          data-kind={toast.kind}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={(event) => { if (!box.current?.contains(event.relatedTarget as Node | null)) setHeld(false); }}
        >
          <p className="map-toast__text">
            <span data-testid="map-toast-text">{toast.text}</span>
            {toast.link && (
              <button type="button" className="map-toast__link" data-testid="map-toast-link" onClick={toast.link.onClick}>{toast.link.label}</button>
            )}
          </p>
          {toast.action && (
            <button type="button" className="map-toast__action" data-testid="map-toast-action" onClick={() => {
              hideMapToast(toast.id);
              toast.action?.onClick();
            }}>{toast.action.label}</button>
          )}
          <button type="button" className="map-toast__close" data-testid="map-toast-close" aria-label="Dismiss" onClick={() => hideMapToast(toast.id)}>
            <KnitIcon name="cross" colour="currentColor" style={{ width: 14, height: 14 }} />
          </button>
        </div>
      )}
    </div>
  );
}
