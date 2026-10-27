"use client";

import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import type { GeographyId } from "@/lib/contracts";
import { visiblePadding } from "@/lib/map-padding";
import { registerPickMarker } from "@/lib/map-pick";
import { rankingShortTitle, type RankingTopResponse } from "@/lib/ranking-top";

import "../styles/ranking-top.css";

function motionDuration(milliseconds: number): number {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : milliseconds;
  } catch {
    return milliseconds;
  }
}

/**
 * A ranking's top 10 on the map (CUJ-05/10 v4 step B2): from the ranking page's "On map ↗"
 * (/?layer=…&rank=<slug>), its first ten areas numbered on the map, fitted into view once, and a small card naming
 * them ("Most expensive · Top 10 ✕", the first three, "Full ranking ›"). A pin or a row opens the area; ✕ clears it.
 */
export function RankingTop({ map, slug, selected, onSelect, onPin, onClose }: {
  map: MapLibreMap | null; slug: string; selected: GeographyId | null;
  /** A row of the card (chosen from a list: the camera flies there). */
  onSelect: (id: GeographyId) => void;
  /** A pin on the map (a map click only selects). */
  onPin: (id: GeographyId) => void;
  onClose: () => void;
}) {
  const [top, setTop] = useState<RankingTopResponse | null | "unavailable">(null);
  useEffect(() => {
    const controller = new AbortController();
    setTop(null);
    fetch(`/api/v1/rankings/${encodeURIComponent(slug)}`, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => (response.ok ? (await response.json()) as Partial<RankingTopResponse> | null : null))
      .then((body) => {
        if (!controller.signal.aborted) setTop(body?.schemaVersion === "ranking-top.v1" ? body as RankingTopResponse : "unavailable");
      })
      .catch(() => { if (!controller.signal.aborted) setTop("unavailable"); });
    return () => controller.abort();
  }, [slug]);
  const rows = useMemo(() => (top && top !== "unavailable" ? top.rows : []), [top]);
  const select = useRef(onPin);
  select.current = onPin;
  // Numbered pins; drawn again when the selection moves so the chosen one stands out.
  useEffect(() => {
    if (!map || !rows.length) return;
    const markers = rows.flatMap((row) => {
      if (!row.center) return [];
      const element = document.createElement("button");
      element.type = "button";
      element.className = `bm-area ranking-pin${row.geographyId === selected ? " bm-selected" : ""}`;
      element.dataset.testid = "ranking-pin";
      element.setAttribute("aria-label", `#${row.rank} ${row.name}`);
      const badge = document.createElement("b");
      badge.textContent = String(row.rank);
      element.append(badge);
      element.addEventListener("click", (event) => { event.stopPropagation(); select.current(row.geographyId); });
      // The hover's peek is the map's tooltip (lib/map-pick.ts), as every other object's: rank · name, then the value.
      registerPickMarker(map, { kind: "rank", element, lngLat: row.center,
        properties: { geographyId: row.geographyId, lines: [`${row.rank} · ${row.name}`, row.display] } });
      return [new maplibregl.Marker({ element }).setLngLat(row.center).addTo(map)];
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [map, rows, selected]);
  // Once per ranking: the camera takes in all ten (a link's own camera, if any, already ran).
  useEffect(() => {
    if (!map) return;
    const centers = rows.flatMap((row) => (row.center ? [row.center] : []));
    if (centers.length < 2) return;
    const bounds = centers.reduce((box, at) => box.extend(at), new maplibregl.LngLatBounds(centers[0], centers[0]));
    // The card covers the map's top-left corner: the pins go below it, and left of the round controls.
    const padding = visiblePadding(map.getContainer(), 48);
    const card = document.querySelector("[data-testid='ranking-top']")?.getBoundingClientRect();
    const top = card && card.height > 0 ? Math.max(padding.top, card.bottom - map.getContainer().getBoundingClientRect().top + 32) : padding.top;
    map.fitBounds(bounds, { padding: { ...padding, top, right: Math.max(padding.right, 72) }, maxZoom: 13, duration: motionDuration(700) });
    // Only when the ten arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, top]);
  if (top === "unavailable") return null;
  const title = top ? rankingShortTitle(top.title) : "Ranking";
  return (
    <section className="ranking-top" aria-label={`${title}: top 10 on the map`} data-testid="ranking-top">
      <header className="ranking-top__head">
        <h2>{title} <span>· Top 10</span></h2>
        <button type="button" className="ranking-top__close" aria-label="Close the top 10" onClick={onClose}>
          <KnitIcon name="cross" colour="currentColor" className="knit-glyph" style={{ width: 14, height: 14 }} />
        </button>
      </header>
      {top ? (
        <ol className="ranking-top__rows">
          {top.rows.slice(0, 3).map((row) => (
            <li key={row.geographyId}>
              <button type="button" aria-current={row.geographyId === selected ? "true" : undefined} onClick={() => onSelect(row.geographyId)}>
                <b>{row.rank}</b><span>{row.name}</span><span className="ranking-top__value">{row.display}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : <p className="ranking-top__status">Loading…</p>}
      <Link className="ranking-top__more" href={`/rankings/${slug}`}>Full ranking <span aria-hidden="true">›</span></Link>
    </section>
  );
}
