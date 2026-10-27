"use client";

import { useEffect, useRef } from "react";

import { MAX_ZONES, type MatchZone, type PreferenceProfile } from "@/lib/contracts";
import { showMapToast } from "@/lib/map-toast";
import { DEFAULT_SOFT_METRES } from "@/lib/match-model";
import { addCriterion, replaceCriterion, searchCriteria } from "@/lib/match-search";
import { track } from "@/lib/usage";
import { zoneUsage } from "@/lib/usage-layers";
import { drawBarStatus, drawnZone } from "@/lib/zones";

import "../../styles/match-map.css";

/**
 * Drawing a zone (from My match › Where › Draw on map): a slim bar over the map instead of a card, "Tap corners · n so far · Undo · Cancel",
 * with Done (Done sits at the bottom of the screen on phones, under the thumb). Done adds the zone to My match and
 * the bar goes, so a finished zone is never shown beside a "0 so far" counter; a short notice says where it went.
 * Escape cancels. The taps themselves are read by ZoneDraw (zone-draw.tsx).
 */
export function ZoneDrawBar({ profile, onChange, drawing, onDrawing }: {
  profile: PreferenceProfile; onChange: (profile: PreferenceProfile) => void;
  drawing: [number, number][]; onDrawing: (draft: [number, number][] | null) => void;
}) {
  const zones = profile.zones ?? [];
  const drawn = zones.filter((zone): zone is Extract<MatchZone, { kind: "polygon" }> => zone.kind === "polygon").length;
  const finished = drawnZone(drawing, `Area I drew${drawn ? ` ${drawn + 1}` : ""}`);
  const full = zones.length >= MAX_ZONES;
  const cancel = useRef(onDrawing);
  cancel.current = onDrawing;
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel.current(null); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const status = drawBarStatus(drawing.length);
  const done = () => {
    if (!finished || full) return;
    track("zone_change", zoneUsage("add", finished, zones.length + 1));
    onChange(withZone(profile, finished));
    onDrawing(null);
    showMapToast(`${finished.label} · added to Where`, { ms: 3000, kind: "zone-added" });
  };
  return (
    <div className="zone-bar" role="toolbar" aria-label="Draw an area" data-testid="zone-draw-bar">
      <p className="zone-bar__status" role="status" data-testid="zone-draw-count" data-corners={drawing.length}>
        {status.lead}<span>{status.count}</span>
      </p>
      <button type="button" disabled={drawing.length === 0} onClick={() => onDrawing(drawing.slice(0, -1))} data-testid="undo-corner">Undo</button>
      <button type="button" onClick={() => onDrawing(null)} data-testid="cancel-zone">Cancel</button>
      <button type="button" className="zone-bar__done" disabled={!finished || full} onClick={done} data-testid="finish-zone">Done</button>
    </div>
  );
}

/** A finished drawing into My match › Where: a new Where at the end of the list, or one more zone (up to three). */
function withZone(profile: PreferenceProfile, zone: MatchZone): PreferenceProfile {
  const where = searchCriteria(profile).find((item) => item.kind === "where");
  if (where && where.kind === "where") return replaceCriterion(profile, "zone", { ...where, zones: [...where.zones, zone] });
  return addCriterion(profile, { kind: "where", zones: [zone], softMetres: DEFAULT_SOFT_METRES, must: false });
}
