"use client";

/**
 * Show › Schools hover popup (board V3-23-school-popup; Map controls PR 3): a peek at the
 * school's name, Ofsted as an icon only (the words are its tooltip and screen-reader label) and up to 3
 * tags. It takes no pointer and goes when the pointer leaves the cap; a click opens the school's card in
 * the sheet (components/map-cards.tsx). One at a time, above the cap (below it near the top edge), so it
 * never covers the cap; it follows the map. Keyboard: the caps are canvas pixels, so SchoolMapKeys lists
 * the schools nearest the map's centre as links out of sight; focusing one opens its popup at its cap.
 */
import Link from "next/link";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";

import { SCHOOL_LAYER, schoolIcon, schoolPointFromProperties, schoolPopupView, type SchoolPoint } from "@/lib/map-school-layer";
import { schoolIconLabel } from "@/lib/school-icons";

import { OfstedIcon } from "./ofsted-icon";
import "../../styles/school-map.css";

export { OfstedIcon };

export interface SchoolPopupOpen {
  point: SchoolPoint;
  /** Opened by keyboard focus on its link in SchoolMapKeys: the popup shows the focus ring. */
  focused?: boolean;
}

/** How many schools nearest the map's centre take a keyboard stop. */
const KEYBOARD_SCHOOLS = 10;

/** Half the popup's width (270 px) plus the 16 px gutter: it stays inside the map. */
const HALF_WIDTH = 151;
/** Room above the cap the popup needs, clear of the top bar; nearer the top edge it opens below. */
const ROOM_ABOVE = 210;

function position(map: MapLibreMap, point: SchoolPoint) {
  const at = map.project([point.longitude, point.latitude]);
  const width = map.getContainer().clientWidth;
  return { x: Math.min(Math.max(at.x, HALF_WIDTH), Math.max(HALF_WIDTH, width - HALF_WIDTH)), y: at.y, below: at.y < ROOM_ABOVE };
}

/** Escape closes it through the Esc ladder (use-escape-ladder.ts: its "peek" rung), never on its own. */
export function SchoolMapPopup({ map, open }: { map: MapLibreMap; open: SchoolPopupOpen }) {
  const [at, setAt] = useState(() => position(map, open.point));
  useEffect(() => {
    const follow = () => setAt(position(map, open.point));
    follow();
    map.on("move", follow);
    return () => { map.off("move", follow); };
  }, [map, open.point]);
  const view = schoolPopupView(open.point);
  return (
    <div role="tooltip" aria-label={view.name} className="school-pop" data-testid="school-popup" data-urn={view.urn}
      data-below={at.below ? "" : undefined} data-focused={open.focused ? "" : undefined}
      style={{ left: at.x, top: at.y }}>
      <div className="school-pop__head">
        {view.ofsted && <OfstedIcon mark={view.ofsted.mark} label={view.ofsted.label} />}
        <strong className="school-pop__name" title={view.name}>{view.name}</strong>
      </div>
      {view.tags.length > 0 && (
        <ul className="school-pop__tags" data-testid="school-popup-tags">
          {view.tags.map((tag) => <li key={tag.label} data-top={tag.top ? "" : undefined}>{tag.label}</li>)}
        </ul>
      )}
    </div>
  );
}

/** The schools drawn in view, nearest the map's centre first (a cap shows once its image is in). */
function schoolsInView(map: MapLibreMap): SchoolPoint[] {
  if (!map.getLayer(SCHOOL_LAYER) || map.getLayoutProperty(SCHOOL_LAYER, "visibility") === "none") return [];
  const centre = map.project(map.getCenter());
  const seen = new Map<string, { point: SchoolPoint; distance: number }>();
  for (const feature of map.queryRenderedFeatures({ layers: [SCHOOL_LAYER] })) {
    if (feature.geometry.type !== "Point") continue;
    const at = feature.geometry.coordinates as [number, number];
    const point = schoolPointFromProperties(feature.properties as Record<string, unknown>, at);
    if (!point || seen.has(point.urn)) continue;
    const pixel = map.project(at);
    seen.set(point.urn, { point, distance: Math.hypot(pixel.x - centre.x, pixel.y - centre.y) });
  }
  return [...seen.values()].sort((a, b) => a.distance - b.distance).slice(0, KEYBOARD_SCHOOLS).map((entry) => entry.point);
}

/**
 * Keyboard stops for the caps ("keyboard focus shows it too"): the schools nearest the map's centre
 * as links, out of sight; focus opens the school's popup at its cap, Enter opens its page.
 */
export function SchoolMapKeys({ map, onFocusSchool, onBlurSchool }: {
  map: MapLibreMap;
  onFocusSchool: (point: SchoolPoint) => void;
  onBlurSchool: () => void;
}) {
  const [points, setPoints] = useState<SchoolPoint[]>([]);
  useEffect(() => {
    let shown = "";
    const update = () => {
      const next = schoolsInView(map);
      const key = next.map((point) => point.urn).join();
      if (key !== shown) { shown = key; setPoints(next); }
    };
    update();
    map.on("idle", update);
    return () => { map.off("idle", update); };
  }, [map]);
  if (points.length === 0) return null;
  return (
    <ul className="sr-only" aria-label="Schools in view" data-testid="school-keys">
      {points.map((point) => {
        const view = schoolPopupView(point);
        const label = `${view.name}, ${schoolIconLabel(schoolIcon(point))}`;
        const keys = { onFocus: () => onFocusSchool(point), onBlur: () => onBlurSchool() };
        return (
          <li key={point.urn}>
            {view.external
              ? <a href={view.href} target="_blank" rel="noopener noreferrer" aria-label={label} data-urn={point.urn} {...keys}>{view.name}</a>
              : <Link href={view.href} aria-label={label} data-urn={point.urn} {...keys}>{view.name}</Link>}
          </li>
        );
      })}
    </ul>
  );
}
