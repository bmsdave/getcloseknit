"use client";

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  type AreaBrief, ballparkLabel, type BriefLayer, type BriefSchool, ringFor, SCHOOL_TIER_LABEL,
} from "@/lib/brief-model";
import type { GeographyId, MatchPack, MatchResult, PreferenceProfile } from "@/lib/contracts";
import { type CommuteMode, drawableModes, type PlaceCommute, routeShapes } from "@/lib/commute";
import { type Padding, paddingOffset, visiblePadding } from "@/lib/map-padding";
import { type Box, clearOfControls, coveredLabels, pinOffsets } from "@/lib/map-clearance";
import { AREA_FILL_LAYERS, AREA_TILE_KINDS, areaTileSourceId, areaTileTarget } from "@/lib/area-tiles";
import { pickOnMap, registerPickMarker } from "@/lib/map-pick";
import { isPhone } from "@/lib/viewport";
import { criteriaFor, fitRows, friendlyName, groupRanks, marksOf, matchRows } from "@/lib/match-brief";
import {
  inBottomDecile, MATCH_HATCH_TILE, matchHatchPixels, matchInk, type MatchList, matchPercentiles, matchRingInk, outAreas,
} from "@/lib/match-map";
import type { FitState } from "@/lib/match-ranges";
import { rankPack } from "@/lib/matching";
import { onUiThemeChange, resolvedUiTheme } from "@/lib/ui-themes";
import { myPlacePinMarkup, ROUTE_YARN, yarnShade } from "@/lib/place-yarn";
import { KnitIcon } from "@/components/knit/knit-icon";

import { labelledSchools } from "@/lib/match-school-labels";
import { useAreaCommute } from "./use-area-commute";
import "../../styles/match-map.css";

interface MatchOverlaysProps {
  map: MapLibreMap | null;
  brief: AreaBrief | null;
  pack: MatchPack | null;
  /** The match as the map is coloured now (a dragged slider applied): the hatch and the area popup read it. */
  livePack?: MatchPack | null;
  profile: PreferenceProfile;
  selected: GeographyId | null;
  /** The list row under the pointer: its area gets a bold outline. */
  hovered?: GeographyId | null;
  /** Which ten are pinned (MapState matchList): the best in ink, or the least like the search in red. */
  list?: MatchList;
  layers: Record<BriefLayer, boolean>;
  schools: BriefSchool[];
  onSelect: (id: GeographyId) => void;
}

const SOURCE = "match-brief-outlines";
const LINES = "match-brief-lines";
/**
 * An area that fails a Must is out: grey under a light hatch, never red (red = scored low). One hatch per kind of area,
 * on its area tiles (lib/area-tiles.ts), holding that kind's out areas alone.
 */
const OUT_HATCHES = AREA_TILE_KINDS.map((kind) => ({ kind, id: `match-out-hatch-${kind}`, source: areaTileSourceId(kind) }));
const HATCH_IMAGE = "match-hatch";

/** A kind's hatch filter: its out areas' tile features. */
function hatchFilter(out: readonly GeographyId[], kind: string): maplibregl.FilterSpecification {
  const ids = out.map(areaTileTarget).filter((target) => target.sourceLayer === kind).map((target) => target.id);
  return ["in", ["id"], ["literal", ids]];
}
/** Lines in the theme's ink, recoloured when Day and Night switch. */
const INK_LINES = ["match-brief-top-line", "match-brief-hover-line"];
const LAYERS = [...OUT_HATCHES.map((hatch) => hatch.id), "match-brief-top-line", "match-brief-ring-line", "match-brief-selected-line", "match-brief-hover-line",
  "match-brief-route-shadow", "match-brief-route-outline", "match-brief-route-line", "match-brief-route-ply", "match-brief-walk-leg",
  "match-brief-last-stretch"];

/** A route's colour by its mode (transit, and anything unknown, is cherry), optionally shaded. */
function routeColour(shade?: number): maplibregl.ExpressionSpecification {
  const tone = (colour: string) => (shade === undefined ? colour : yarnShade(colour, shade));
  return ["match", ["get", "mode"], "cycle", tone(ROUTE_YARN.cycle), "car", tone(ROUTE_YARN.car), tone(ROUTE_YARN.transit)];
}
const ROUND = { "line-cap": "round", "line-join": "round" } as const;

/** The light diagonal hatch (8 px tile) over areas that fail a Must, drawn once into the map's sprite. */
function hatchImage(theme: "day" | "night"): { width: number; height: number; data: Uint8Array } {
  return { width: MATCH_HATCH_TILE, height: MATCH_HATCH_TILE, data: matchHatchPixels(theme) };
}
const MODE_WORD: Record<string, string> = { cycle: "by bike", transit: "by public transport", walk: "walking", car: "by car" };
const MODE_ICON: Record<string, string> = { cycle: "bicycle", transit: "tube", walk: "walk", car: "car" };
/** Schools you didn't ask about show only once the map is zoomed in this far (lib/match-school-labels.ts). */
export const SCHOOL_LABEL_ZOOM = 15;
/** Space kept between numbered pins laid out side by side (px). */
const PIN_GAP = 4;

/**
 * My match drawn on the explorer's own map: rank badges with a ballpark price (a heart on liked areas),
 * the selected area's ring with prices against the budget, the household's places with the real
 * route to each (along streets, in the way they travel) and the minutes, the nearest station, and
 * schools only when the search asks for them (otherwise at most two outstanding ones close by,
 * marked "worth knowing"). Outlines and routes are map layers; labels are DOM markers.
 */
export function MatchOverlays(props: MatchOverlaysProps) {
  const { map, brief, profile, selected, layers, schools } = props;
  // Ranked as the results list ranks (the precise score), so a pin's number is the row's number.
  const pack = useMemo(() => (props.pack ? groupRanks(rankPack(props.pack, profile)) : null), [props.pack, profile]);
  // The list's own ten (matchRows): pin n is row n, Top 10 or Bottom 10, the same areas and the same numbers.
  const rows = useMemo(() => matchRows(props.pack, profile, props.list ?? "top").map((result) => result.geographyId), [props.pack, profile, props.list]);
  const commute = useAreaCommute(selected, profile);
  const closeIn = useZoomedIn(map, SCHOOL_LABEL_ZOOM);
  const markers = useRef<maplibregl.Marker[]>([]);
  // Bumped once the sources exist, so the drawing effects run after a late style load.
  const [drawn, setDrawn] = useState(0);
  // Per place and its own mode ("work:transit"): the mode the map switch picked; a new own mode starts afresh.
  const [routeMode, setRouteMode] = useState<Record<string, CommuteMode>>({});
  const callbacks = useRef(props);
  callbacks.current = props;
  // The areas that fail a Must, from the match as the map is coloured now; read too when a hatch layer is added.
  const live = props.livePack ?? props.pack;
  const out = useMemo(() => outAreas(live ?? null), [live]);
  const outRef = useRef(out);
  outRef.current = out;

  // Sources and layers, re-added if the style is ever reloaded; removed on unmount.
  useEffect(() => {
    if (!map) return;
    const ensure = () => {
      // addImage fires "styledata" at once, which runs ensure again inside it: add the image first, then
      // check for the layer, or the outer call adds it a second time (a map error: "Basemap unavailable").
      const tiled = OUT_HATCHES.filter((hatch) => map.getSource(hatch.source));
      if (map.isStyleLoaded() && tiled.length && !map.hasImage(HATCH_IMAGE)) map.addImage(HATCH_IMAGE, hatchImage(resolvedUiTheme()));
      for (const hatch of tiled) {
        if (!map.isStyleLoaded() || map.getLayer(hatch.id)) continue;
        map.addLayer({ id: hatch.id, type: "fill", source: hatch.source, "source-layer": hatch.kind,
          filter: hatchFilter(outRef.current, hatch.kind), paint: { "fill-pattern": HATCH_IMAGE } },
        map.getLayer("match-brief-top-line") ? "match-brief-top-line" : undefined);
        setDrawn((value) => value + 1);
      }
      if (!map.isStyleLoaded() || map.getSource(SOURCE)) return;
      const theme = resolvedUiTheme();
      map.addSource(SOURCE, { type: "geojson", data: empty() });
      map.addSource(LINES, { type: "geojson", data: empty() });
      map.addLayer({ id: "match-brief-top-line", type: "line", source: SOURCE, filter: ["==", ["get", "kind"], "top"],
        paint: { "line-color": matchInk(theme), "line-width": 2.5 } });
      map.addLayer({ id: "match-brief-ring-line", type: "line", source: SOURCE, filter: ["==", ["get", "kind"], "ring"],
        paint: { "line-color": matchRingInk(theme), "line-width": 1.4, "line-dasharray": [2, 2] } });
      map.addLayer({ id: "match-brief-selected-line", type: "line", source: SOURCE, filter: ["==", ["get", "kind"], "selected"],
        paint: { "line-color": ROUTE_YARN.car, "line-width": 4 } });
      // The list row under the pointer: its area outlined bold, over the page's thinner outlines.
      map.addLayer({ id: "match-brief-hover-line", type: "line", source: SOURCE, filter: ["==", ["get", "kind"], "hover"],
        paint: { "line-color": matchInk(theme), "line-width": 4.5 } });
      // Routes are yarn (DESIGN.md › Map rules): a soft shadow, a darker outline, the strand, then its ply twist.
      const route = ["==", ["get", "kind"], "route"] as maplibregl.FilterSpecification;
      map.addLayer({ id: "match-brief-route-shadow", type: "line", source: LINES, filter: route, layout: ROUND,
        paint: { "line-color": "#000000", "line-width": 8, "line-opacity": 0.22, "line-blur": 2, "line-translate": [1, 2] } });
      map.addLayer({ id: "match-brief-route-outline", type: "line", source: LINES, filter: route, layout: ROUND,
        paint: { "line-color": routeColour(-0.45), "line-width": 6.5 } });
      map.addLayer({ id: "match-brief-route-line", type: "line", source: LINES, filter: route, layout: ROUND,
        paint: { "line-color": routeColour(), "line-width": 5 } });
      map.addLayer({ id: "match-brief-route-ply", type: "line", source: LINES, filter: route,
        layout: { "line-join": "round" },
        paint: { "line-color": routeColour(-0.32), "line-width": 4.5, "line-opacity": 0.6, "line-dasharray": [0.45, 0.45] } });
      // Walking is a running stitch: short cherry dashes with gaps, no casing.
      map.addLayer({ id: "match-brief-walk-leg", type: "line", source: LINES, filter: ["==", ["get", "kind"], "walk"],
        paint: { "line-color": ROUTE_YARN.walk, "line-width": 3, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "match-brief-last-stretch", type: "line", source: LINES, filter: ["==", ["get", "kind"], "last"],
        paint: { "line-color": ROUTE_YARN.walk, "line-width": 2.5, "line-opacity": 0.85, "line-dasharray": [2, 1.8] } });
      setDrawn((value) => value + 1);
    };
    ensure();
    // "styledata" can fire for the last time before the style reports loaded (tiles still coming), so
    // also try once the map settles; ensure() is a no-op once the sources exist.
    map.on("styledata", ensure);
    map.on("idle", ensure);
    return () => {
      map.off("styledata", ensure);
      map.off("idle", ensure);
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of [SOURCE, LINES]) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map]);

  // Day and Night: the outlines follow the theme's ink, so they never vanish on the navy basemap.
  useEffect(() => {
    if (!map) return;
    return onUiThemeChange(() => {
      const theme = resolvedUiTheme();
      for (const id of INK_LINES) if (map.getLayer(id)) map.setPaintProperty(id, "line-color", matchInk(theme));
      if (map.getLayer("match-brief-ring-line")) map.setPaintProperty("match-brief-ring-line", "line-color", matchRingInk(theme));
      // The Must hatch recedes at night (a navy veil), so filtered areas never glow brighter than the colours.
      if (map.hasImage(HATCH_IMAGE)) map.updateImage(HATCH_IMAGE, hatchImage(theme));
    });
  }, [map]);

  // A new search with nothing selected: bring the results (and your places) into view, once per set,
  // padded for the top bar and the side panel or the phone sheet, and again when the sheet changes height.
  // Never moves the map under a selection or after the user has panned.
  const fitted = useRef<string | null>(null);
  const panned = useRef(false);
  const [snap, setSnap] = useState<string | null>(null);
  useEffect(() => {
    if (!map) return;
    const moved = (event: { originalEvent?: unknown }) => { if (event.originalEvent) panned.current = true; };
    map.on("movestart", moved);
    const dock = document.querySelector("[data-block='map-dock']");
    const observer = dock ? new MutationObserver(() => setSnap(dock.getAttribute("data-snap"))) : null;
    observer?.observe(dock!, { attributes: true, attributeFilter: ["data-snap"] });
    setSnap(dock?.getAttribute("data-snap") ?? null);
    return () => { map.off("movestart", moved); observer?.disconnect(); };
  }, [map]);
  useEffect(() => {
    if (!map || selected) return;
    const centers = (brief?.areas ?? []).flatMap((entry) => (entry.center ? [entry.center] : []));
    const key = (brief?.areas ?? []).map((entry) => entry.geographyId).join(",");
    if (centers.length < 2) return;
    const sameSet = fitted.current?.startsWith(`${key}|`) ?? false;
    if (fitted.current === `${key}|${snap}` || (sameSet && panned.current)) return;
    if (!sameSet) panned.current = false;
    const points = [...centers, ...pinned(profile).map((place) => [place.longitude, place.latitude] as [number, number])];
    const bounds = points.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds(points[0], points[0]));
    // Padding measured from the top bar and the dock once the sheet has settled (its height animates):
    // on phones the sheet covers most of the map. Marked done only when it runs, so a re-render that
    // cancels the timer schedules it again.
    const timer = window.setTimeout(() => {
      fitted.current = `${key}|${snap}`;
      fitVisible(map, bounds, pinPadding(map.getContainer()));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [map, brief, selected, profile, snap]);

  // Outlines and travel lines follow the brief, the selection and the layer switches.
  useEffect(() => {
    if (!map || !map.getSource(SOURCE)) return;
    const area = brief?.areas.find((entry) => entry.geographyId === selected);
    const ring = layers.ring && brief && selected ? ringFor(brief, selected) : [];
    // The page of matches outlined, so they read as "these" against the colouring (the selected one bolder,
    // the row under the pointer boldest).
    const top = (brief?.areas ?? []).filter((entry) => entry.geometry && entry.geographyId !== selected);
    const hover = props.hovered ? brief?.areas.find((entry) => entry.geographyId === props.hovered && entry.geometry) : undefined;
    const outlines = [
      ...top.map((entry) => feature(entry.geometry!, "top")),
      ...ring.filter((entry) => entry.geometry).map((entry) => feature(entry.geometry!, "ring")),
      ...(area?.geometry ? [feature(area.geometry, "selected")] : []),
      ...(hover?.geometry ? [feature(hover.geometry, "hover")] : []),
    ];
    (map.getSource(SOURCE) as GeoJSONSource).setData({ type: "FeatureCollection", features: outlines });
    // The route in the mode each place is reached by, along streets, from the area's neighbourhood to
    // the hub; then the short last stretch to the place itself. No route known: no line (never a straight one).
    // The mode is the place's own unless the switch on its label picked another.
    const lines = layers.travel ? pinned(profile).flatMap((place) => {
      const routed = commute?.places.find((entry) => entry.placeId === place.id);
      if (!routed?.hub?.location) return [];
      const mode = routeMode[`${place.id}:${place.mode}`] ?? place.mode;
      const shapes = routeShapes(routed, mode);
      if (!shapes.length) return [];
      const last = { type: "Feature" as const, properties: { kind: "last", mode },
        geometry: { type: "LineString" as const, coordinates: [routed.hub.location, [place.longitude, place.latitude]] } };
      return [...shapes.map((shape) => ({ type: "Feature" as const, properties: { kind: shape.kind, mode: shape.mode },
        geometry: { type: "LineString" as const, coordinates: shape.coordinates } })), last];
    }) : [];
    (map.getSource(LINES) as GeoJSONSource).setData({ type: "FeatureCollection", features: lines });
  }, [map, brief, selected, layers, profile, commute, routeMode, drawn, props.hovered]);

  // Areas that fail a Must carry the hatch (each kind's hatch holds its out areas), from the match as the map is
  // coloured now (a dragged Must hatches live). A soft miss is not hatched: it reads red by its score.
  useEffect(() => {
    if (!map) return;
    for (const hatch of OUT_HATCHES) if (map.getLayer(hatch.id)) map.setFilter(hatch.id, hatchFilter(out, hatch.kind));
  }, [map, out, drawn]);
  const percentiles = useMemo(() => (live ? matchPercentiles(live) : new Map<GeographyId, number>()), [live]);

  // An area tapped on the map: a popup with how it sits against each criterion (V3-30b frame 4). Only when
  // the area itself took the tap (lib/map-pick.ts): a school cap or a sale pin over it opens its own card.
  const fitsFor = useRef<(id: string) => string | null>(() => null);
  fitsFor.current = (id) => {
    const result = live?.values.find((entry) => entry.geographyId === id);
    return result ? fitPopup(result, profile, percentiles.get(result.geographyId), live) : null;
  };
  useEffect(() => {
    if (!map) return;
    let popup: maplibregl.Popup | null = null;
    const click = (event: MapMouseEvent) => {
      // A place being put down (use-tap-to-place.ts) or a zone drawn takes this tap.
      if (map.getContainer().dataset.picking === "true" || !AREA_FILL_LAYERS.some((id) => map.getLayer(id))) return;
      const target = event.originalEvent.target as HTMLElement | null;
      if (target?.closest(".maplibregl-marker")) return;
      const pick = pickOnMap(map, event.point, "click");
      const html = pick?.kind === "area" && pick.feature.id !== undefined ? fitsFor.current(String(pick.feature.id)) : null;
      popup?.remove();
      popup = html ? new maplibregl.Popup({ offset: 10, closeButton: true, className: "match-fit-popup", maxWidth: "280px" })
        .setLngLat(event.lngLat).setHTML(html).addTo(map) : null;
    };
    map.on("click", click);
    return () => { map.off("click", click); popup?.remove(); };
  }, [map]);

  // DOM markers.
  useEffect(() => {
    if (!map) return;
    markers.current.forEach((marker) => marker.remove());
    const placed: maplibregl.Marker[] = [];
    const add = (element: HTMLElement, at: [number, number], popup?: string) => {
      const marker = new maplibregl.Marker({ element }).setLngLat(at);
      if (popup) marker.setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(popup));
      placed.push(marker.addTo(map));
    };
    const ranks = new Map((pack?.values ?? []).map((result) => [result.geographyId, result]));
    const liked = new Set(marksOf(profile).liked);
    const pins: { marker: maplibregl.Marker; at: [number, number] }[] = [];
    // On a phone the strip of map above the sheet is short: pins carry the number only (the list has the price).
    const narrow = isPhone();
    // A ballpark says its home ("2-bed ~£497k"), never a bare "~£497k".
    const ballpark = (price: number) => ballparkLabel(price, { bedrooms: profile.bedrooms, monthly: profile.market === "rent", short: true });
    // Bottom 10: −1 … −10 in deep red, −1 the least like the search; only those ten are pinned.
    const bottom = props.list === "bottom";
    for (const area of brief?.areas ?? []) {
      const result = ranks.get(area.geographyId as GeographyId);
      if (!area.center || !result) continue;
      const place = rows.indexOf(area.geographyId as GeographyId);
      if (bottom && place < 0) continue;
      const price = layers.prices && !narrow && area.estimatedPrice !== null ? `<span>${escape(ballpark(area.estimatedPrice))}</span>` : "";
      const badge = bottom
        ? `<b aria-label="Bottom ${place + 1}">−${place + 1}</b>`
        : place >= 0 ? `<b>${place + 1}</b>` : result.rank !== null ? `<b>${result.rank}</b>` : "<b>–</b>";
      const element = label(
        // No price (a phone, or prices off): the number alone, a round pin (match-map.css .bm-number).
        `bm-area bm-fit-${layers.prices ? area.budgetFit : "none"}${bottom ? " bm-bottom" : ""}${price ? "" : " bm-number"}${area.geographyId === selected ? " bm-selected" : ""}`,
        `${liked.has(area.geographyId as GeographyId) ? `<i class="bm-heart" role="img" aria-label="liked">${icon("heart", 12)}</i>` : ""}${badge}${price}`,
        "match-map-area");
      // A better rank draws on top: pin 3's number is never under pin 8's price.
      element.style.zIndex = String(place >= 0 ? 40 - place : 20);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        callbacks.current.onSelect(area.geographyId as GeographyId);
      });
      add(element, area.center);
      pins.push({ marker: placed[placed.length - 1], at: area.center });
    }
    const area = brief?.areas.find((entry) => entry.geographyId === selected);
    if (brief && selected && layers.prices && layers.ring) {
      // A ballpark carried from the wider area repeats on every neighbour: it is said once, on the card.
      const ring = ringFor(brief, selected);
      const counts = new Map<number, number>();
      for (const entry of [...ring, ...(area ? [area] : [])]) {
        if (entry.estimatedPrice !== null) counts.set(entry.estimatedPrice, (counts.get(entry.estimatedPrice) ?? 0) + 1);
      }
      for (const entry of ring) {
        if (!entry.center || entry.estimatedPrice === null || (counts.get(entry.estimatedPrice) ?? 0) > 1) continue;
        add(label(`bm-chip bm-fit-${entry.budgetFit}`, escape(ballpark(entry.estimatedPrice)), "match-map-price"), entry.center,
          `<strong>${escape(entry.name)}</strong><br>${entry.pricePerSquareMetre ? `£${entry.pricePerSquareMetre.toLocaleString("en-GB")}/m² · ` : ""}neighbouring area`);
      }
    }
    if (layers.schools) {
      // Schools are a criterion only when the search asks for them; otherwise just the standouts close by.
      const asked = criteriaFor(profile).includes("schools");
      const shown = labelledSchools(schools, asked, closeIn, area?.center ?? null);
      for (const school of shown) {
        const tier = SCHOOL_TIER_LABEL[school.grade.tier];
        add(label(`bm-school bm-school-${school.grade.tier}${asked ? "" : " bm-highlight"}`,
          `${icon("school")} ${escape(shortName(school.name))} · ${tier}${asked ? "" : " · worth knowing"}`, "match-map-school"),
        [school.longitude, school.latitude],
          `<strong>${escape(school.name)}</strong><br>${escape(school.phase)} · ${tier}${school.grade.year ? ` (${escape(school.grade.year)})` : ""}${school.attainment8 !== null ? `<br>Attainment 8: ${school.attainment8}` : ""}${school.selectivity === "Selective" ? "<br>Selective: entrance exam" : ""}`
          + `<br><a class="bm-school-link" href="/school/${encodeURIComponent(school.urn)}" data-testid="map-school-card-link">School card →</a>`);
      }
    }
    if (layers.travel) {
      if (area?.station) {
        add(label("bm-station", `${icon("swap")} ${escape(area.station.name)}`, "match-map-station"), area.station.center,
          `${escape(area.station.name)}: ${area.station.walkMinutes} min walk`);
      }
      const result = selected ? ranks.get(selected) : undefined;
      for (const place of pinned(profile)) {
        const minutes = result?.components.find((component) => component.factorId === `place:${place.id}`)?.rawValue;
        const routed = commute?.places.find((entry) => entry.placeId === place.id);
        // Your place is an ink pin with its type's glyph, one size for all, with a small label pill.
        // On a phone it is the pin alone (its name in the list and the summary), so it never hides the numbers.
        const dot = placeDot(place.label);
        const element = narrow
          ? label(`knit-place${place.must ? " knit-must" : ""}`, `${dot}<span class="sr-only">${escape(place.label)}</span>`, "match-map-place")
          : label(`knit-place${place.must ? " knit-must" : ""}`,
          `${dot}<span class="knit-place-label">${escape(place.label)}${minutes !== undefined ? ` · ${Math.round(minutes)} min ${MODE_WORD[place.mode] ?? ""}` : ""}`
          + `${modeSwitch(drawableModes(routed, place.mode), routeMode[`${place.id}:${place.mode}`] ?? place.mode, routed, place.mode)}</span>`, "match-map-place");
        // The switch redraws this place's route in another mode; the place's own mode is the default.
        element.addEventListener("click", (event) => {
          const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
          if (!button) return;
          event.stopPropagation();
          const mode = button.dataset.mode as CommuteMode;
          setRouteMode((current) => ({ ...current, [`${place.id}:${place.mode}`]: mode }));
        });
        add(element, [place.longitude, place.latitude]);
        // A tap on the pin opens its card (map-cards.tsx), through the map's one hit-test; a hover peeks its name.
        registerPickMarker(map, { kind: "my-place", element, lngLat: [place.longitude, place.latitude],
          properties: { placeId: place.id, name: place.label, lines: [place.label] } });
        pins.push({ marker: placed[placed.length - 1], at: [place.longitude, place.latitude] });
      }
    }
    // Numbered pins and your places never sit on top of each other.
    spreadPins(map, pins);
    if (layers.travel) {
      for (const place of pinned(profile).filter((entry) => (routeMode[`${entry.id}:${entry.mode}`] ?? entry.mode) === "transit")) {
        const legs = commute?.places.find((entry) => entry.placeId === place.id)?.routes?.[0]?.legs ?? [];
        for (const leg of legs) {
          if (leg.mode === "walk" || !leg.coordinates?.length || !leg.line) continue;
          const middle = leg.coordinates[Math.floor(leg.coordinates.length / 2)];
          // The line's name only: its minutes beside the place's door-to-door total read as a contradiction
          // ("Bus 476 · 19 min" next to "25 min"); they stay in its popup.
          add(label("bm-line", escape(leg.line), "match-map-line"), middle,
            `${escape(leg.line)}: ${escape(leg.from ?? "")} → ${escape(leg.to ?? "")} · ${leg.minutes} min`);
        }
      }
    }
    markers.current = placed;
    clearLabels(map, placed);
  }, [map, brief, pack, rows, profile, selected, layers, schools, commute, routeMode, drawn, closeIn, props.list]);

  // Pins that sit on top of each other at this zoom fan out again after every zoom.
  useEffect(() => {
    if (!map) return;
    const respread = () => {
      spreadPins(map, markers.current
        .filter((marker) => ["match-map-area", "match-map-place"].includes(marker.getElement().dataset.testid ?? ""))
        .map((marker) => ({ marker, at: marker.getLngLat().toArray() as [number, number] })));
      clearLabels(map, markers.current);
    };
    const reclear = () => clearLabels(map, markers.current);
    map.on("zoomend", respread);
    map.on("moveend", reclear);
    return () => { map.off("zoomend", respread); map.off("moveend", reclear); };
  }, [map]);

  return null;
}

const FIT_ICON: Record<FitState, string> = { in: "check", edge: "", out: "cross" };
const FIT_WORD: Record<FitState, string> = { in: "fits", edge: "on the edge", out: "out" };

/**
 * The tapped area's popup (V3-30b frame 4): its name and match score 0–100, as the list row says it ("Out" when a
 * criterion puts it out; never x/10), then
 * each criterion with a check, an "≈" for the soft edge or a cross, its value and a short note. The score badge is
 * red for an area in the bottom 10 % of this search (`percentile` among the scored areas).
 */
export function fitPopup(result: MatchResult, profile: PreferenceProfile, percentile?: number | null, pack: MatchPack | null = null): string | null {
  const rows = fitRows(result, profile, pack);
  if (!rows.length) return null;
  const low = inBottomDecile(percentile ?? result.percentile);
  const head = result.excluded || result.score === null ? `<span class="fit-popup__out">Out</span>`
    : `<span class="fit-popup__score${low ? " fit-popup__score--bottom" : ""}"${low ? ` data-testid="match-fit-bottom"` : ""}>`
      + `${result.score}<span class="sr-only"> of 100</span>${low ? `<span class="sr-only"> · bottom 10% of your search</span>` : ""}</span>`;
  const items = rows.map((row) => {
    const mark = row.state === "edge" ? `<b class="fit-popup__edge" aria-hidden="true">≈</b>` : icon(FIT_ICON[row.state], 14);
    return `<li class="fit-popup__row fit-popup__row--${row.state}">${mark}<span class="sr-only">${FIT_WORD[row.state]}:</span>`
      + `<span>${escape(row.name)} <strong>${escape(row.value)}</strong>${row.note ? ` · ${escape(row.note)}` : ""}</span></li>`;
  }).join("");
  return `<div class="fit-popup" data-testid="match-fit-popup"><p class="fit-popup__head"><strong>${escape(friendlyName(result))}</strong>${head}</p>`
    + `<ul class="fit-popup__rows">${items}</ul></div>`;
}

/** True once the map is zoomed to `zoom` or closer; follows zooming. */
function useZoomedIn(map: MapLibreMap | null, zoom: number): boolean {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    if (!map) return;
    const update = () => setInside(map.getZoom() >= zoom);
    update();
    map.on("zoomend", update);
    return () => { map.off("zoomend", update); };
  }, [map, zoom]);
  return inside;
}

/**
 * Fits the bounds into the part of the map a visitor can see. The camera is computed with even
 * padding (only the zoom depends on it) and the clearance is applied as an offset, so no padding
 * persists on the map to shift every later centre (see paddingOffset). The zoom never goes under
 * the map's minimum: a very short strip above a phone sheet keeps London at its widest.
 */
function fitVisible(map: MapLibreMap, bounds: maplibregl.LngLatBounds, padding: Padding) {
  const vertical = (padding.top + padding.bottom) / 2;
  const horizontal = (padding.left + padding.right) / 2;
  const camera = map.cameraForBounds(bounds, { padding: { top: vertical, bottom: vertical, left: horizontal, right: horizontal }, maxZoom: 14 });
  if (!camera?.center) return;
  map.easeTo({ center: camera.center, zoom: Math.max(map.getMinZoom(), camera.zoom ?? map.getZoom()), offset: paddingOffset(padding), duration: 800 });
}

const boxOf = (element: Element): Box => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
};
const shownBoxes = (selector: string): Box[] => [...document.querySelectorAll(selector)]
  .map(boxOf).filter((box) => box.right > box.left && box.bottom > box.top);

/** The top 10's fit padding: the top bar and the dock, then the controls column and the legend. */
function pinPadding(container: HTMLElement): Padding {
  return clearOfControls(boxOf(container), visiblePadding(container, 24),
    shownBoxes(".map-controls .map-rail, .map-controls .map-position"), shownBoxes(".map-controls .map-key"));
}

const PRIMARY_MARKS = new Set(["match-map-area", "match-map-place"]);
const SECONDARY_MARKS = new Set(["match-map-line", "match-map-station", "match-map-school", "match-map-price"]);

/**
 * Pins and your places stay readable: a route line's name, a station, a school or a neighbour's
 * price that would sit on one of them, on a map control, the legend or the dock is hidden, not drawn on top.
 */
function clearLabels(map: MapLibreMap, placed: maplibregl.Marker[]) {
  const elements = placed.map((marker) => marker.getElement());
  const secondary = elements.filter((element) => SECONDARY_MARKS.has(element.dataset.testid ?? ""));
  secondary.forEach((element) => { delete element.dataset.covered; });
  const keep = elements.filter((element) => PRIMARY_MARKS.has(element.dataset.testid ?? "")).map(boxOf);
  const frame = boxOf(map.getContainer());
  const obstacles = [
    ...shownBoxes(".map-controls .map-rail > *, .map-controls .map-position > *, .map-controls .map-key > *, .map-controls .map-credits > *"),
    ...shownBoxes("[data-block='map-dock'], [data-block='top-bar'], [data-block='explore']"),
  ];
  const covered = coveredLabels(secondary.map(boxOf).map((box) => (
    // A label past the map's edge is clipped anyway: never hide it for that.
    box.right <= frame.left || box.left >= frame.right ? { ...box, right: box.left } : box)), keep, obstacles);
  secondary.forEach((element, index) => { if (covered[index]) element.dataset.covered = "true"; });
}

/** Numbered pins that overlap on screen are laid out side by side (offsets only), after every zoom. */
function spreadPins(map: MapLibreMap, pins: { marker: maplibregl.Marker; at: [number, number] }[]) {
  const boxes = pins.map((pin) => {
    const point = map.project(pin.at);
    const rect = pin.marker.getElement().getBoundingClientRect();
    return { x: point.x, y: point.y, width: rect.width || 32, height: rect.height || 28 };
  });
  const offsets = pinOffsets(boxes, PIN_GAP);
  pins.forEach((pin, index) => pin.marker.setOffset(offsets[index]));
}

/** Small mode buttons on a place's label (tube 24 · bicycle 27 · car 31, as thread icons); none when only the place's own mode can be drawn. */
function modeSwitch(modes: CommuteMode[], current: string, routed: PlaceCommute | undefined, own: string): string {
  if (!modes.length || (modes.length === 1 && modes[0] === own)) return "";
  const buttons = modes.map((mode) => {
    const minutes = routed?.modes[mode]?.minutes;
    return `<button type="button" data-mode="${mode}" aria-pressed="${mode === current}" aria-label="Show the route ${MODE_WORD[mode]}">`
      + `${icon(MODE_ICON[mode])}${minutes !== undefined ? ` ${minutes}` : ""}</button>`;
  });
  return `<span class="bm-modes" role="group" aria-label="Route mode">${buttons.join("")}</span>`;
}

function pinned(profile: PreferenceProfile) {
  return (profile.places ?? []).flatMap((place) => place.target.kind === "point"
    ? [{ id: place.id, label: place.label, must: place.must, mode: place.mode, latitude: place.target.latitude, longitude: place.target.longitude }]
    : []);
}

function shortName(name: string): string {
  const trimmed = name.replace(/\b(Primary|Secondary|Junior|Infant|C of E|CofE|Church of England|Catholic|RC)\b/g, "").replace(/\s+/g, " ").trim();
  return trimmed.length > 26 ? `${trimmed.slice(0, 25)}…` : trimmed;
}

function empty() {
  return { type: "FeatureCollection" as const, features: [] };
}

function feature(geometry: NonNullable<AreaBrief["areas"][number]["geometry"]>, kind: string) {
  return { type: "Feature" as const, geometry, properties: { kind } };
}

/** A place's pin markup: ink with its type's glyph. */
function placeDot(placeLabel: string): string {
  return myPlacePinMarkup(placeLabel);
}

/** A thread icon's markup for the HTML map labels, in the label's text colour (decorative). */
function icon(name: string, size = 13): string {
  return renderToStaticMarkup(<KnitIcon name={name} colour="currentColor" className="knit-inline" style={{ width: size, height: size }} />);
}

function label(className: string, html: string, testId: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  element.dataset.testid = testId;
  element.innerHTML = html;
  return element;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}
