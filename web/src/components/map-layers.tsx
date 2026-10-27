"use client";

import Link from "next/link";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import { COMPASS_EASE_MS, COMPASS_HIDE_MS, compassShown, needleAngle, type CompassCamera } from "@/lib/map-compass";
import { MAP_CREDITS_EVENT } from "@/lib/map-credits";
import { closeMapSheet, openMapSheet } from "@/lib/map-sheets";
import { hideMapToast, showMapToast } from "@/lib/map-toast";
import { MY_LOCATION_LAYERS, MY_LOCATION_SOURCE, myLocationData } from "@/lib/my-location";

import { KnitIcon } from "./knit/knit-icon";
import { isPhone, MapSheet, SheetDefaultButton, useOpenMapSheet } from "./map-sheet";
import { useDisclosure } from "./top-bar-menu";

interface MapLayersProps {
  /** What colours the map, as the selector names it ("Price per m² · Rank in London"), for screen readers on the chip. */
  label: string;
  /** The phone's layer pill: the layer and always its view ("Price per m² · Actual"); `label` when absent. */
  pill?: string;
  /** The Layers button's tooltip after "Layers · ": the layer shown, or None. */
  title: string;
  /** The compact key on the chip: the layer, its period and its scale. */
  legend: ReactNode;
  /**
   * The reader's own colour range under the key (legend-range.tsx): always shown on a desktop; a phone's chip
   * opens it (its layer pill opens Layers). Absent where the layer's scale cannot be set.
   */
  range?: ReactNode;
  /** None (the plain map): no colours, so no legend chip. */
  plain: boolean;
  /** The legend's "?": what the layer measures and how (layer-explainer.tsx); `close` puts it away. */
  explainer: (close: () => void) => ReactNode;
  /** Data-mode notice over the chip. */
  notice: string | null;
  /** "Colour the map by", the Layers menu (map-data-selector.tsx); `done` closes it and refocuses its opener. */
  selector: (done: () => void) => ReactNode;
  /** Show: what is drawn on top (map-data-selector.tsx MapOverlays); `done` closes the card. */
  show: (done: () => void) => ReactNode;
  /** How many of Show's overlays are on, on the Show button. */
  shownCount: number;
  /** My match, the first round button: it opens the match wizard (preference-panel.tsx). */
  match: { active: boolean; onOpen: () => void; buttonRef: Ref<HTMLButtonElement> };
  /** The map, for my location, zoom and the compass; null until it has loaded. */
  map: MapLibreMap | null;
  /** The compass put the map flat and north: the 2D/3D setting follows (Map settings shows 2D). */
  onNorth?: () => void;
  /**
   * The ⓘ corner: the data status ("Demo data"), the land outlines' licence line while parcels are drawn
   * (it must stay on screen with them) and the node MapLibre mounts its attribution in.
   */
  attribution: { status: ReactNode; licence?: ReactNode; onHost: (node: HTMLElement | null) => void };
  /** A card opened (the first-visit card steps aside). */
  onOpen?: () => void;
  /**
   * The "Default" buttons in the Show and Layers headers: whether each already holds its
   * defaults, and the reset, which returns its undo (the toast's "Undo").
   */
  defaults?: Record<"layers" | "show", { isDefault: boolean; reset: () => () => void }>;
}

type Card = "layers" | "show";

/** My location: where the map flies to, a street's width. */
const LOCATE_ZOOM = 15;

/**
 * The map's own controls, apart from the area (Google and Apple Maps): a stack of round buttons on the
 * right (My match, Layers, Show), the compass while the map is turned or tilted, my location (with + and −
 * on a desktop), the ⓘ corner (map credits, Sources & privacy, Terms) and a legend chip, the layer and its
 * scale with a "?" that explains it.
 * Desktop: the stack sits 12px in from the map's right edge, or from the side panel's left edge once an
 * area is chosen (layout.css slides them together); Layers opens a floating card beside the stack, as
 * tall as its rows; Show a card the same way; a click outside closes them. Phones: the stack, my
 * location and the chip ride above the open sheet; Layers, Show and the "?" are MapSheets
 * that open at half with the map still live above them, and the layer pill under the search names the
 * layer in full. A phone on its side (lib/viewport.ts) has the three round
 * buttons, my location alone, a slim legend, ⓘ in the ≡ menu foot, and Layers, Show and the "?" as a
 * 360px right-side panel. One sheet at a time (lib/map-sheets.ts). Map settings live in the ≡ menu only.
 * Opening a card never moves the selection.
 */
export function MapLayers(props: MapLayersProps) {
  const active = useOpenMapSheet();
  const card: Card | null = active === "layers" || active === "show" ? active : null;
  const explaining = active === "explainer";
  const wrap = useRef<HTMLDivElement>(null);
  const layersButton = useRef<HTMLButtonElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const about = useRef<HTMLButtonElement>(null);
  /** The button that opened the sheet open now: focus goes back to it when the sheet closes. */
  const opener = useRef<HTMLElement | null>(null);
  const { onOpen, plain } = props;
  /** A phone's colour range, opened from the legend chip. */
  const [rangeOpen, setRangeOpen] = useState(false);
  const ranged = !plain && !!props.range;

  useEffect(() => {
    if (card) onOpen?.();
  }, [card, onOpen]);

  // None hides the chip, and with it its explainer.
  useEffect(() => {
    if (plain) closeMapSheet("explainer");
  }, [plain]);

  /** Closes the sheet `id` and puts focus back on what opened it. */
  const close = (id: string) => {
    closeMapSheet(id);
    opener.current?.focus({ preventScroll: true });
  };
  /** A button opens its sheet, switches to it from another, or closes it when it is the one open. */
  const toggle = (id: string, from: HTMLElement | null) => {
    if (active === id) {
      close(id);
      return;
    }
    opener.current = from;
    openMapSheet(id);
  };

  // Desktop: a click outside the controls closes Layers or Show, and a press outside the explainer
  // (not on its "?") closes it, as before. A phone's sheet stays up while the map is used.
  useEffect(() => {
    if (!active || !["layers", "show", "explainer"].includes(active)) return;
    const outside = (event: Event) => {
      if (isPhone()) return;
      const target = event.target as Node;
      if (active === "explainer") {
        const sheet = wrap.current?.querySelector("[data-sheet='explainer']");
        if (!sheet?.contains(target) && !about.current?.contains(target)) closeMapSheet("explainer");
      } else if (!wrap.current?.contains(target)) {
        closeMapSheet(active);
      }
    };
    const kind = active === "explainer" ? "pointerdown" : "click";
    document.addEventListener(kind, outside, true);
    return () => document.removeEventListener(kind, outside, true);
  }, [active]);

  const reset = (which: Card) => {
    const undo = props.defaults?.[which].reset();
    if (undo) showMapToast("Reset to default", { kind: "reset", action: { label: "Undo", onClick: undo } });
  };
  const title = card === "layers" ? "Layers" : "Show";
  return (
    <div className="map-controls" data-block="map-controls" ref={wrap}>
      {/* A phone names the layer in full under the search, "▤ Wildlife seen · Hedgehog ▾"
          (two lines at most, never cut); a tap opens Layers at that item. Its legend keeps the scale and "?". */}
      {!props.plain && (
        <button ref={pill} type="button" className="layer-pill" data-testid="layer-pill" aria-haspopup="dialog"
          aria-expanded={card === "layers"} aria-controls={card ? "map-controls-sheet" : undefined}
          onClick={() => toggle("layers", pill.current)}>
          <KnitIcon name="layers" colour="var(--icon-yarn, currentColor)" className="layer-pill__icon" style={{ width: 16, height: 16 }} />
          <span className="layer-pill__name"><span className="sr-only">Layer: </span>{props.pill ?? props.label}</span>
          <KnitIcon name="chevron-down" colour="var(--icon-yarn, currentColor)" className="layer-pill__caret" style={{ width: 14, height: 14 }} />
        </button>
      )}
      <div className="map-rail" data-testid="map-rail">
        {/* The match dialog returns focus here when it closes. */}
        <button ref={props.match.buttonRef} type="button" className="map-round find-my-area" data-testid="find-my-area"
          aria-haspopup="dialog" data-active={props.match.active} title="My match" onClick={props.match.onOpen}>
          <KnitIcon name="sparkle" colour="var(--icon-yarn, currentColor)" className="map-round__icon" style={{ width: 22, height: 22 }} />
          <span className="sr-only">My match</span>
        </button>
        <button
          ref={layersButton}
          type="button"
          aria-expanded={card === "layers"}
          aria-controls={card ? "map-controls-sheet" : undefined}
          onClick={() => toggle("layers", layersButton.current)}
          className="map-round map-layers-button"
          data-testid="layers-toggle"
          aria-haspopup="dialog"
          title={`Layers · ${props.title}`}
        >
          <KnitIcon name="layers" colour="var(--icon-yarn, currentColor)" className="map-round__icon" style={{ width: 22, height: 22 }} />
          <span className="sr-only">Layers</span>
        </button>
        <button
          ref={showButton}
          type="button"
          aria-expanded={card === "show"}
          aria-controls={card ? "map-controls-sheet" : undefined}
          onClick={() => toggle("show", showButton.current)}
          className="map-round map-show-button"
          data-testid="show-toggle"
          aria-haspopup="dialog"
          title="Show"
        >
          <KnitIcon name="pin" colour="var(--icon-yarn, currentColor)" className="map-round__icon" style={{ width: 22, height: 22 }} />
          {/* One accessible name, "Show, 2 on", never the badge glued to the label ("Show2"). */}
          <span className="sr-only">{props.shownCount > 0 ? `Show, ${props.shownCount} on` : "Show"}</span>
          {props.shownCount > 0 && <span className="map-round__count" aria-hidden="true">{props.shownCount}</span>}
        </button>
      </div>
      <MapPosition map={props.map} onNorth={props.onNorth} />
      <MapCredits {...props.attribution} />
      <div className="map-key" data-plain={props.plain || undefined}>
        {props.notice && <p className="layer-notice" role="status" data-testid="layer-notice">{props.notice}</p>}
        {explaining && !props.plain && (
          <MapSheet id="explainer" title={null} className="map-key__explainer" onClose={() => close("explainer")}>
            {props.explainer(() => close("explainer"))}
          </MapSheet>
        )}
        {!props.plain && (
          <div className="map-key__row">
            <button
              ref={chip}
              type="button"
              className="legend-chip"
              data-testid="legend-chip"
              aria-haspopup="dialog"
              aria-expanded={card === "layers" || (ranged && rangeOpen)}
              aria-controls={card ? "map-controls-sheet" : ranged && rangeOpen ? "legend-range" : undefined}
              onClick={() => (ranged && isPhone() ? setRangeOpen((open) => !open) : toggle("layers", chip.current))}
            >
              <span className="sr-only">Colour the map by: <span data-testid="legend-chip-layer">{props.label}</span>. </span>
              {props.legend}
            </button>
            <span className="legend-about" data-testid="legend-about">
              <button ref={about} type="button" className="legend-about__button" aria-expanded={explaining} aria-haspopup="dialog"
                aria-label={`About ${props.label}`} data-testid="legend-explain"
                onClick={() => toggle("explainer", about.current)}>
                <span aria-hidden="true">?</span>
              </button>
            </span>
          </div>
        )}
        {ranged && (
          <div id="legend-range" className="map-key__range" data-open={rangeOpen || undefined} data-testid="legend-range-wrap">
            {props.range}
          </div>
        )}
      </div>
      {card && (
        // Layers and Show swap without closing: the history step stays (lib/map-sheets.ts).
        <MapSheet
          key={card}
          id={card}
          title={title}
          className="layers-card"
          testId={card === "layers" ? "layers-panel" : "show-panel"}
          closeTestId="layers-close"
          data={{ card }}
          onClose={() => close(card)}
          headerExtra={props.defaults && (
            <SheetDefaultButton isDefault={props.defaults[card].isDefault} onReset={() => reset(card)} testId={`${card}-default`} />
          )}
        >
          <div id="map-controls-sheet" className="layers-card__content">
            {card === "layers" ? props.selector(() => close("layers")) : props.show(() => close("show"))}
          </div>
        </MapSheet>
      )}
    </div>
  );
}

/**
 * The ⓘ corner, bottom-right beside my location (phones: bottom-left above the sheet): ⓘ opens the map
 * credits (MapLibre mounts them here) with Sources & privacy and Terms; the data status, when there is
 * one, and the land outlines' licence line, while they are drawn, sit beside it in view.
 */
function MapCredits({ status, licence, onHost }: MapLayersProps["attribution"]) {
  const credits = useDisclosure<HTMLDivElement>();
  const { open, setOpen, returnTo, wrap } = credits;
  // A phone on its side opens them from the ≡ menu foot: focus goes to the first link and
  // back to ≡ on Escape.
  const fromMenu = useRef(false);
  useEffect(() => {
    const show = () => {
      returnTo.current = document.querySelector<HTMLElement>("[data-testid='top-menu-toggle']");
      fromMenu.current = true;
      setOpen(true);
    };
    window.addEventListener(MAP_CREDITS_EVENT, show);
    return () => window.removeEventListener(MAP_CREDITS_EVENT, show);
  }, [setOpen, returnTo]);
  useEffect(() => {
    if (!open || !fromMenu.current) return;
    fromMenu.current = false;
    wrap.current?.querySelector<HTMLElement>(".map-credits__text a")?.focus({ preventScroll: true });
  }, [open, wrap]);
  return (
    <div className="map-credits" ref={credits.wrap} data-testid="map-credits">
      {licence}
      {status && <span className="map-credits__status" data-testid="data-status">{status}</span>}
      <div className="map-credits__text" id={credits.panelId} hidden={!credits.open} data-testid="map-credits-text">
        <span className="map-attribution-text" ref={onHost} />
        <Link href="/privacy" data-testid="sources-privacy-link">Sources &amp; privacy</Link>
        <Link href="/terms" data-testid="sources-terms-link">Terms</Link>
      </div>
      <button {...credits.buttonProps} className="map-credits__toggle" data-testid="map-attribution-toggle" aria-label="About the map">
        <KnitIcon name="info" colour="var(--icon-yarn, currentColor)" className="knit-glyph" style={{ width: 18, height: 18 }} />
      </button>
    </div>
  );
}

/**
 * The compass chip (Map controls PR 1): above my location, only while the map is turned or tilted (read
 * once the camera settles, after MapLibre's 7° bearing snap). Its needle turns with the map, red north
 * half and wool south half, with a dotted arc while the map is tilted. A tap eases the map back to
 * north and flat, keeping its centre and zoom; the chip stays 600ms so the tap never lands on nothing.
 */
function MapCompass({ map, onNorth }: { map: MapLibreMap; onNorth?: () => void }) {
  const [settled, setSettled] = useState<CompassCamera>(() => ({ bearing: map.getBearing(), pitch: map.getPitch() }));
  const [live, setLive] = useState(settled);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    const read = () => ({ bearing: map.getBearing(), pitch: map.getPitch() });
    const follow = () => setLive(read());
    const settle = () => { const camera = read(); setLive(camera); setSettled(camera); };
    settle();
    map.on("rotate", follow);
    map.on("pitch", follow);
    map.on("moveend", settle);
    return () => { map.off("rotate", follow); map.off("pitch", follow); map.off("moveend", settle); };
  }, [map]);
  useEffect(() => {
    if (!resetting) return;
    const timer = window.setTimeout(() => setResetting(false), COMPASS_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [resetting]);
  if (!compassShown(settled, resetting)) return null;
  const north = () => {
    setResetting(true);
    map.once("moveend", () => onNorth?.());
    map.easeTo({ bearing: 0, pitch: 0, duration: COMPASS_EASE_MS });
  };
  return (
    <button type="button" className="map-round map-compass" data-testid="map-compass" aria-label="Back to north" title="Back to north"
      data-pitched={live.pitch > 0.01 || undefined} onClick={north}>
      <svg className="map-compass__face" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        {live.pitch > 0.01 && (
          <path className="map-compass__arc" d="M4.5 15.5 A8.5 8.5 0 0 0 19.5 15.5" fill="none" stroke="var(--muted)" strokeWidth="1.5"
            strokeLinecap="round" strokeDasharray="0.5 3" />
        )}
        <g className="map-compass__needle" style={{ transform: `rotate(${needleAngle(live.bearing)}deg)` }}>
          <path d="M12 2.5 L15.6 12 L8.4 12 Z" fill="var(--danger)" />
          <path d="M12 21.5 L8.4 12 L15.6 12 Z" fill="var(--wool)" />
        </g>
      </svg>
    </button>
  );
}

/**
 * My location, and + and − on a desktop (a phone pinches): bottom-right of the map. My location asks
 * the browser once per tap: a spinner ring while it waits, then the map flies there and shows a blue
 * dot with its accuracy circle (no toast). Blocked or unavailable, the map toast says so;
 * blocked adds "How to allow", a short sheet of browser steps with Try again. Nothing is kept or sent.
 */
function MapPosition({ map, onNorth }: { map: MapLibreMap | null; onNorth?: () => void }) {
  const [state, setState] = useState<"idle" | "locating" | "found">("idle");
  const button = useRef<HTMLButtonElement>(null);
  const active = useOpenMapSheet();
  const locate = () => {
    if (!map || !("geolocation" in navigator)) {
      showMapToast("Location isn't available here.", { kind: "location-unavailable" });
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude, accuracy } = position.coords;
        setState("found");
        hideMapToast();
        drawMyLocation(map, longitude, latitude, accuracy);
        map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), LOCATE_ZOOM) });
      },
      (error) => {
        setState((current) => (current === "locating" ? "idle" : current));
        if (error.code === 1) {
          showMapToast("Location is blocked for this site.", {
            kind: "location-blocked",
            link: { label: "How to allow", onClick: () => { hideMapToast(); openMapSheet("location-help"); } },
          });
        } else {
          showMapToast("Location isn't available here.", { kind: "location-unavailable" });
        }
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const closeHelp = () => {
    closeMapSheet("location-help");
    button.current?.focus({ preventScroll: true });
  };
  return (
    <div className="map-position" data-testid="map-position">
      {map && <MapCompass map={map} onNorth={onNorth} />}
      <button ref={button} type="button" className="map-round map-locate" data-testid="locate-me" title="My location" onClick={locate} disabled={!map}
        data-state={state} aria-busy={state === "locating"}>
        <KnitIcon name="locate" colour="var(--icon-yarn, var(--yarn-cobalt))" className="map-round__icon" style={{ width: 22, height: 22 }} />
        <span className="sr-only">My location</span>
      </button>
      <button type="button" className="map-round map-zoom" data-testid="zoom-in" title="Zoom in" onClick={() => map?.zoomIn()} disabled={!map}>
        <KnitIcon name="plus" colour="var(--icon-yarn, currentColor)" className="map-round__icon" style={{ width: 20, height: 20 }} />
        <span className="sr-only">Zoom in</span>
      </button>
      <button type="button" className="map-round map-zoom" data-testid="zoom-out" title="Zoom out" onClick={() => map?.zoomOut()} disabled={!map}>
        <KnitIcon name="minus" colour="var(--icon-yarn, currentColor)" className="map-round__icon" style={{ width: 20, height: 20 }} />
        <span className="sr-only">Zoom out</span>
      </button>
      {active === "location-help" && (
        <MapSheet id="location-help" title="Allow your location" testId="location-help" onClose={closeHelp}>
          <LocationSteps onRetry={() => { closeHelp(); locate(); }} />
        </MapSheet>
      )}
    </div>
  );
}

/** "How to allow": the steps per browser, then Try again (it asks the browser once more). */
function LocationSteps({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="location-steps">
      <section>
        <h3>iPhone · Safari</h3>
        <ol>
          <li>Tap <strong>aA</strong> in the address bar</li>
          <li>Website Settings › Location › <strong>Allow</strong></li>
        </ol>
      </section>
      <section>
        <h3>Android · Chrome</h3>
        <ol>
          <li>Tap the icon left of the address</li>
          <li>Permissions › Location › <strong>Allow</strong></li>
        </ol>
      </section>
      <p className="location-steps__note">Still off? Settings › Privacy › Location Services › Safari Websites.</p>
      <button type="button" className="location-steps__retry" data-testid="location-retry" onClick={onRetry}>Try again</button>
    </div>
  );
}

/** The blue dot and its accuracy circle, in the theme's cobalt yarn (the token read at draw time). */
function drawMyLocation(map: MapLibreMap, longitude: number, latitude: number, accuracy: number) {
  const data = myLocationData(longitude, latitude, accuracy);
  const style = getComputedStyle(document.documentElement);
  const blue = style.getPropertyValue("--yarn-cobalt").trim() || style.getPropertyValue("--focus").trim();
  const ring = style.getPropertyValue("--panel-solid").trim();
  const source = map.getSource(MY_LOCATION_SOURCE) as GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(MY_LOCATION_SOURCE, { type: "geojson", data });
  map.addLayer({
    id: MY_LOCATION_LAYERS[0], type: "fill", source: MY_LOCATION_SOURCE, filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": blue, "fill-opacity": 0.14, "fill-outline-color": blue },
  });
  map.addLayer({
    id: MY_LOCATION_LAYERS[1], type: "circle", source: MY_LOCATION_SOURCE, filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 7, "circle-color": blue, "circle-stroke-width": 3, "circle-stroke-color": ring },
  });
}
