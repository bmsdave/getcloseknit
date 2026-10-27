"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { escapeRung } from "@/lib/esc-ladder";

import { closeMapRung, mapEscapeRungs } from "./area-map";

/**
 * The one Escape handler on the map page (Map controls PR 1, lib/esc-ladder.ts): a press closes the
 * top-most thing one step at a time: a hover peek → a pinned popup → the selection (the area is
 * deselected, so its panel or sheet goes). It leaves Escape to what claims it first: a field being
 * typed in, an open dialog or sheet (it closes itself), a zone being drawn (its bar cancels), or a
 * handler that already used the key (a help bubble, a menu). Focus inside the leaving panel moves to
 * the map, never lost on a hidden element.
 */
export function useEscapeLadder(map: MapLibreMap | null, selected: boolean, deselect: () => void, card: { open: boolean; close: () => void }) {
  const live = useRef({ deselect, card });
  live.current = { deselect, card };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const dialogs = document.querySelectorAll<HTMLElement>("[role='dialog'], [aria-modal='true']");
      const rungs = map ? mapEscapeRungs(map) : { peek: false, card: false };
      const rung = escapeRung(
        // The sheet's card (a tapped school, tree, collision or place; Map controls PR 3) is the card rung.
        { peek: rungs.peek, card: rungs.card || live.current.card.open, selection: selected },
        {
          handled: event.defaultPrevented,
          typing: Boolean(target?.closest("input, textarea, select, [contenteditable='true']")),
          dialog: [...dialogs].some((dialog) => dialog.getClientRects().length > 0),
          drawing: Boolean(document.querySelector("[data-testid='zone-draw-bar']")),
        },
      );
      if (!rung) return;
      event.preventDefault();
      if (rung !== "selection") {
        if (map) closeMapRung(map, rung);
        if (rung === "card" && live.current.card.open) live.current.card.close();
        return;
      }
      const inside = Boolean(document.activeElement?.closest("[data-testid='map-dock']"));
      live.current.deselect();
      if (inside) requestAnimationFrame(() => map?.getCanvas().focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [map, selected]);
}
