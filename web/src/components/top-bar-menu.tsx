"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { openMapCredits } from "@/lib/map-credits";
import type { DataMode } from "@/lib/map-state";
import { KnitIcon } from "./knit/knit-icon";
import { SiteMenu } from "./site-menu";

/**
 * A disclosure: the button toggles a panel that closes on Escape (focus
 * returns to the button) or on a click outside the wrapper — the HelpTip
 * pattern. Escape is caught on window in the capture phase so it closes
 * only this panel, not the dock or sheet around it. A panel rendered
 * outside the wrapper takes the `panel` ref so clicks in it count as inside.
 * A second opener (the map's legend chip) sets `returnTo`, so focus goes back to it.
 */
export function useDisclosure<W extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<W>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    // Click, not pointerdown: folding a panel in the bottom sheet moves the
    // rows above it, which must not happen under a finger mid-tap.
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!wrap.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A disclosure open inside this panel (Colours, a HelpTip) closes
      // first. Only the panel counts: the wrapper can hold other expanded
      // controls (the dock's "Hide panel").
      // The site menu's folds (data-fold) are not disclosures to close first.
      const expanded = document.getElementById(panelId)?.querySelectorAll("[aria-expanded='true']:not([data-fold])") ?? [];
      if (expanded.length > 0) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      (returnTo.current ?? button.current)?.focus();
    };
    // Capture: the target is still attached even if its own handler removes it.
    document.addEventListener("click", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("click", outside, true); window.removeEventListener("keydown", escape, true); };
  }, [open, panelId]);
  return {
    open, setOpen, wrap, panel, button, returnTo, panelId,
    buttonProps: {
      ref: button,
      type: "button" as const,
      "aria-expanded": open,
      "aria-controls": panelId,
      onClick: () => setOpen((value) => !value),
    },
  };
}

interface TopBarMenuProps {
  /** ?dev=1: the data mode switch and its release id. */
  dev: boolean;
  mode: DataMode;
  release: string;
  onModeChange: (mode: DataMode) => void;
  /** The Map group: 2D/3D and Colours, the map settings' only home. */
  mapSettings?: ReactNode;
  /** The map's theme state, shared with its Colours panel. */
  theme?: { themeId: string; chooseTheme: (id: string) => void };
}

/**
 * The map's ≡ menu: the site menu (site-menu.tsx) with the Map group.
 * The data mode and release are internals, shown only with ?dev=1.
 */
export function TopBarMenu(props: TopBarMenuProps) {
  const menu = useDisclosure();
  return (
    <div className="top-menu" ref={menu.wrap}>
      <button {...menu.buttonProps} className="top-menu-toggle" data-testid="top-menu-toggle" aria-label="Menu">
        <KnitIcon name="menu" colour="var(--icon-yarn, currentColor)" className="top-menu-knit" style={{ width: 18, height: 18 }} />
      </button>
      {menu.open && (
        <div className="top-menu-panel" id={menu.panelId} data-testid="top-menu">
          <SiteMenu onMap mapSettings={props.mapSettings} theme={props.theme}
            onCredits={() => { menu.setOpen(false); openMapCredits(); }} />
          {props.dev && (
            <fieldset className="top-menu-section data-mode-selector" data-testid="data-mode-selector">
              <legend>Data mode</legend>
              {(["demo", "real"] as const).map((mode) => (
                <label key={mode}>
                  <input type="radio" name="data-mode" value={mode} checked={props.mode === mode} onChange={() => props.onModeChange(mode)} />
                  <span>{mode === "demo" ? "Demo data" : "Real data"}</span>
                </label>
              ))}
              <p data-testid="data-mode-release">Release {props.release}</p>
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}
