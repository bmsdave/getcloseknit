"use client";

import { fetchSectionJson } from "@/lib/section-fetch";
import { METRICS_PATH } from "@/lib/section-seed";
import { DEFAULT_COLLISION_VIEW, type CollisionView } from "@/lib/map-collisions";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { isMatchPack, type AddressId, type GeographyId, type MapLayerId, type MatchJob, type MatchPack, type MetricDefinition, type MetricId, type PreferenceProfile } from "@/lib/contracts";
import { DEFAULT_PROFILE, fallbackMetric, isPlaceholderMetric, PERSONAL_MATCH_DEFINITION, realPilotUnavailableReason } from "@/lib/fixtures";
import { effectiveScaleMode, type LegendScaleMode, type LegendStop } from "@/lib/legend-scale";
import type { SearchResult } from "@/lib/fixtures";
import {
  applyLayerSelection,
  applyModeSwitch,
  initialPitch,
  createEvidenceRequestScope,
  isLayerAvailableInMode,
  linkedLayer,
  matchRequestPath,
  parseMapState,
  unknownLayerNotice,
  preserveDiagnosticsQuery,
  restoreSavedMapState,
  SAVED_MAP_STATE_KEY,
  adoptSavedState,
  homeFromQuery,
  urlModeNotice,
  serializeMapState,
  shouldAdoptSavedState,
  withHomeQuery,
  type ConnectionStatus,
  type DataMode,
  type EvidenceRequestScope,
  type MapHome,
  type MapState,
} from "@/lib/map-state";
import { hiddenTopicLayers, londonOnlyLayers } from "@/lib/map-topics";
import {
  eraseLocalProfile, isUnsetProfile, loadLocalProfile, markProfileOrigin, PROFILE_SAVED_EVENT, profileOrigin, saveLocalProfile,
} from "@/lib/profile-state";
import { normaliseSearch, searchCriteria, searchKey } from "@/lib/match-search";
import { customMapDefinition, customRollup, customTooltip, customValuePack, isCustomLayerId, type CustomCriterion } from "@/lib/custom-criteria";
import { CUSTOM_PRESETS } from "@/lib/custom-presets";
import { layerAfterExplore } from "@/lib/explore-chips";
import { useCustomPack } from "./match/use-custom-pack";
import { CONNECTION_PROBE_MS, probeConnection, watchConnection } from "@/lib/connection";
import { propertyLayersApply } from "@/lib/map-property-layers";
import { defaultSaleView, type SalePinSelection, type SaleView } from "@/lib/map-sale-layers";
import { DEFAULT_PLACE_VIEW, placesFromQuery, withPlacesQuery, type PlaceView } from "@/lib/map-place-layers";
import { DEFAULT_SHOWS, plainFromQuery, showsFromQuery, withPlainQuery, withShowsQuery, type MapShows } from "@/lib/map-shows";
import { DEFAULT_SCHOOL_FILTER, schoolFilterFromQuery, withSchoolFilterQuery, type SchoolFilter } from "@/lib/map-school-layer";
import {
  collisionsFromQuery, crimeOffFromQuery, cycleFromQuery, DEFAULT_LAYER, DEFAULT_SCALE_MODE, defaultScaleMode, defaultShowSetup, isDefaultLayers, isDefaultShow, mergeMapSetup,
  readMapSetup, salesFromQuery, withCollisionsQuery, withCrimeOffQuery, withCycleQuery, withSalesQuery, writeMapSetup, type ShowSetup,
} from "@/lib/map-setup";
import { DEFAULT_PALETTE, paletteById, paletteRamp, sampleRamp } from "@/lib/palettes";
import type { MatchList } from "@/lib/match-map";
import type { ChangeWindow } from "@/lib/price-change";
import { DEFAULT_CHANGE_WINDOW, scaleFromQuery, withScaleQuery } from "@/lib/map-trend";
import { AUTO_SCALE, bootLegendScales, committedLegendScale, legendScaleKey, subscribeLegendScale, withLegendScaleQuery } from "@/lib/legend-range";
import { addressWriteDelay, onlyPeriodChanged } from "@/lib/address-writes";
import { prefetchAllBoxes } from "@/lib/area-boxes";
import { setUsageLayer, track } from "@/lib/usage";
import { showMapToast } from "@/lib/map-toast";
import { profileLinkEvent, profileLinkToast, readProfileLink } from "@/lib/profile-link";
import { layerUsage } from "@/lib/usage-layers";
import { isDetailLayer, detailAreaLayer, type DetailLayerId } from "@/lib/nature-layers";
import { mapPeriod } from "@/lib/map-period";
import { PRICE_METRIC_ID, PRICE_STEPS } from "@/lib/price-scale";
import { paintedMetric } from "@/lib/map-metric-paint";
import { isBusyStatus, MATCH_RETRIES, matchRetryDelay, type MatchBusy } from "@/lib/match-retry";

export function useExplorerController(initialState: MapState, fitSelected = false, dev = false, link?: string,
  fitZoom: number | null = null) {
  // The setup this map opens with: the link's own params, then the setup saved on this
  // device, then the defaults (lib/map-setup.ts). Read once per mount, before the first address write
  // saves anything; the server render has neither, so it is applied in the effects below.
  // The link is the server's reading of it, not the address: an in-app jump (a guide's "See this on the
  // map") renders before the router moves the address here, and its layer must still win.
  const [boot] = useState(() => (typeof window === "undefined" ? "" : mergeMapSetup(link ?? window.location.search, readMapSetup())));
  // A link that names a layer but no month (a ranking's "On map ↗", a guide's link) opens at that layer's
  // own newest month, not the price layer's: the ranking and the map show the same month.
  const periodFollowsLayer = useRef(new URLSearchParams(boot).has("layer") && !new URLSearchParams(boot).has("period"));
  const [layer, setLayer] = useState<MapLayerId>(initialState.layer);
  // Green streets and Canopy draw finer than areas: the areas under them (clear, still tapped) and the panel read Green & trees.
  const areaLayer = detailAreaLayer(layer);
  const [period, setPeriod] = useState(initialState.period);
  const [selected, setSelected] = useState<GeographyId | null>(initialState.selected);
  const [pitch, setPitch] = useState(initialState.pitch);
  // My match's Top 10 | Bottom 10: the panel writes it, the map pins it, the address keeps it.
  const [matchList, setMatchList] = useState<MatchList>(initialState.matchList ?? "top");
  const [camera, setCamera] = useState(initialState);
  // Where the map first opens: the link's camera, else the saved one (set on mount, before the map loads).
  const [startCamera, setStartCamera] = useState(initialState);
  // A link naming an area but no position opens on that area: the map fits it
  // once the area shapes load, and until then the URL carries no position, so
  // a reload still asks for the fit rather than the default London view.
  const fitOnLoad = fitSelected && initialState.selected !== null;
  const [cameraSettled, setCameraSettled] = useState(!fitOnLoad);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  // The home picked from search: a pin on the map until another area or home is chosen.
  const [homePin, setHomePin] = useState<[number, number] | null>(null);
  const [uprn, setUprn] = useState<string | null>(null);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  // A home chosen on the map: a ring at the home itself, since its parcel may be a title over a whole estate.
  const [chosenHome, setChosenHome] = useState<[number, number] | null>(null);
  const [addressId, setAddressId] = useState<AddressId | null>(null);
  const [scaleMode, setScaleMode] = useState<LegendScaleMode>(() => defaultScaleMode(initialState.layer));
  const [changeWindow, setChangeWindow] = useState<ChangeWindow>(DEFAULT_CHANGE_WINDOW);
  const [excludedCrime, setExcludedCrime] = useState<string[]>([]);
  const [crimeScaleStops, setCrimeScaleStops] = useState<LegendStop[] | null>(null);
  const [zoomTo, setZoomTo] = useState<{ id: GeographyId; nonce: number; zoom?: number } | null>(
    () => fitOnLoad && initialState.selected
      ? { id: initialState.selected, nonce: 0, ...(fitZoom !== null ? { zoom: fitZoom } : {}) } : null,
  );
  const [saleView, setSaleView] = useState<SaleView>(() => defaultSaleView(latestSaleYear(initialState.period)));
  const dataMode = useDataMode(initialState, dev, link);
  const profiles = useSharedProfile();
  const matches = useMatchPack(layer, profiles.profile, dataMode.mode, dataMode.release, dataMode.channel);
  // Real mode describes each layer with the release's own definition (legend,
  // periods, freshness, caveats); until /api/v1/metrics answers it shows a
  // placeholder without source lines, never the fixture's (demo keeps fixtures).
  const releaseMetrics = useReleaseMetrics(dataMode.mode, dataMode.release);
  const resolveMetric = (id: MetricId): MetricDefinition => releaseMetrics?.get(id) ?? fallbackMetric(id, dataMode.mode);
  // A flagged layer (Clean air) the release leaves out is not offered in Layers.
  const hiddenLayers = useMemo(() => hiddenTopicLayers(releaseMetrics ? new Set(releaseMetrics.keys()) : null), [releaseMetrics]);
  // Layers with London's data alone, by the release's coverage: "London only" in Layers on the England map.
  const londonOnly = useMemo(() => londonOnlyLayers(releaseMetrics?.values() ?? null), [releaseMetrics]);
  const evidenceMetric = useMemo(
    () => areaLayer === "personal-match" || isCustomLayerId(areaLayer) ? null
      : releaseMetrics?.get(areaLayer) ?? fallbackMetric(areaLayer, dataMode.mode),
    [areaLayer, releaseMetrics, dataMode.mode],
  );
  // A shared search opens on My match, whatever layer the link named (a bare /#profile=… link loads on
  // prices); once, so the reader can then change layer. A custom layer from the search stays.
  const openedShared = useRef(false);
  useEffect(() => {
    if (!profiles.shared || openedShared.current) return;
    openedShared.current = true;
    if (!isCustomLayerId(layer)) setLayer("personal-match");
  }, [profiles.shared, layer]);
  const custom = useCustomLayer(layer, profiles.profile, profiles.ready, setLayer);
  useLayerUsage(layer, custom.criterion);
  // The layer last on the map before My match: "+ Add criterion" offers it first ("Use Crime as a filter").
  const [lastMapLayer, setLastMapLayer] = useState<string | null>(layer === "personal-match" ? null : layer);
  if (layer !== "personal-match" && layer !== lastMapLayer) setLastMapLayer(layer);
  // The side panel follows the layer, except a criterion picked in Layers: that only recolours the map,
  // and the panel stays on the layer before it (My match on a cold link).
  const panelLayer = detailAreaLayer(isCustomLayerId(layer) && !custom.inPanel ? custom.before ?? "personal-match" : layer);
  const panelMetric = useMemo(
    () => panelLayer === areaLayer ? evidenceMetric
      : panelLayer === "personal-match" || isCustomLayerId(panelLayer) ? null
      : releaseMetrics?.get(panelLayer) ?? fallbackMetric(panelLayer, dataMode.mode),
    [panelLayer, areaLayer, evidenceMetric, releaseMetrics, dataMode.mode],
  );
  // The area view opened from My match (no layer of its own there): it reads the price evidence.
  const priceMetric = useMemo(
    () => releaseMetrics?.get("price-per-square-metre") ?? fallbackMetric("price-per-square-metre", dataMode.mode),
    [releaseMetrics, dataMode.mode],
  );
  useEffect(() => {
    if (!evidenceMetric || !evidenceMetric.periods.length) return;
    // The linked layer's own definition (never the placeholder, nor the server's first price layer).
    // ?layer=hmo is hmo-per-1000: the short name too, or its evidence asks for the price month (a 404).
    const linked = periodFollowsLayer.current && evidenceMetric.id === linkedLayer(boot);
    if (linked) periodFollowsLayer.current = false;
    if ((linked || !evidenceMetric.periods.includes(period)) && evidenceMetric.defaultPeriod && evidenceMetric.defaultPeriod !== period) {
      setPeriod(evidenceMetric.defaultPeriod);
    }
  }, [evidenceMetric, period, boot]);
  // The month an area's evidence is asked for. A link naming a layer but no month waits for that layer's
  // own definition: the placeholder knows no months, and the price month is a 404 for noise.
  const requestPeriod = periodFollowsLayer.current && dataMode.mode === "real" && evidenceMetric !== null
    && isPlaceholderMetric(evidenceMetric) && evidenceMetric.id === linkedLayer(boot) ? "" : period;
  // The month the map's packs are asked for: never a month the explorer is about to replace (lib/map-period.ts).
  const mapMonth = mapPeriod({
    metric: evidenceMetric, period, waiting: requestPeriod === "",
    placeholder: evidenceMetric !== null && isPlaceholderMetric(evidenceMetric),
    followsLayer: periodFollowsLayer.current && evidenceMetric?.id === new URLSearchParams(boot).get("layer"),
  });
  // Map colours are a viewer setting (Colours menu, ?palette=): every legend,
  // choropleth and sale pin is recoloured from the chosen ramp, read by the
  // metric's polarity (lib/palettes.ts).
  const [paletteId, setPaletteId] = useState<string>(DEFAULT_PALETTE);
  // Read after mount: the server render has no URL or storage to read.
  useEffect(() => {
    setPaletteId(initialPalette());
    const shared = scaleFromQuery(boot);
    // No scale in the address: the opened layer's own default (rank for Price per m²).
    setScaleMode(shared.scale ?? defaultScaleMode(parseMapState(new URLSearchParams(boot)).layer));
    if (shared.window) setChangeWindow(shared.window);
    // The reader's own colour ranges: this device's, then the link's for its layer (lib/legend-range.ts).
    bootLegendScales(boot);
  }, []);
  const palette = paletteById(paletteId);
  // My match colours every scored area in 7 bands by percentile; failed Musts are hatched.
  const baseMetric = evidenceMetric ?? custom.metric ?? PERSONAL_MATCH_DEFINITION;
  const priceBreaks = usePriceBreaks(dataMode.mode, dataMode.release);
  // Price: fixed breaks, equal-count over the latest year with history steps
  // below (log steps between the published legend's ends until they arrive),
  // coloured with the palette's ramp.
  // Only the price layer reads the breaks: any other layer keeps its painted metric (and the map its colours) when
  // they arrive, instead of repainting behind a "Loading map" pill (a cold price scale took 10 s, perf/layer-load).
  const layerBreaks = baseMetric.id === PRICE_METRIC_ID ? priceBreaks : null;
  const metric = useMemo(() => paintedMetric(baseMetric, palette, layerBreaks), [baseMetric, palette, layerBreaks]);
  // Sale pins show prices: the palette's ramp for price.
  const saleRamp = useMemo(() => sampleRamp(paletteRamp(palette, PRICE_METRIC_ID), 6), [palette]);
  // A link naming a home (?uprn=…&address=…, the property page's "Open on the map") reselects it.
  useEffect(() => {
    // The live address, not BOOT_SEARCH: a client-side link from the property page loads this module before it changes.
    const home = homeFromQuery(window.location.search);
    if (home?.uprn) selectDwelling({ uprn: home.uprn, addressId: home.addressId });
    else if (home?.addressId) setAddressId(home.addressId);
    // Once, on load: selectDwelling only reads stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The Places overlay, over any layer (?places=all or ?places=coffee,pub; absent = on, ?places=off).
  const [placeView, setPlaceView] = useState<PlaceView>(DEFAULT_PLACE_VIEW);
  useEffect(() => setPlaceView(placesFromQuery(boot)), [boot]);
  // Show's schools, stations and your places (?schools=on, ?stations=off, ?mine=on).
  const [shows, setShows] = useState<MapShows>(DEFAULT_SHOWS);
  useEffect(() => setShows(showsFromQuery(boot)), [boot]);
  // Show › Schools' filters (Schools filter v2, lib/school-filter.ts): ?schools=t.p.s_o.out.good_m.top.10.
  const [schoolFilter, setSchoolFilter] = useState<SchoolFilter>(DEFAULT_SCHOOL_FILTER);
  useEffect(() => setSchoolFilter(schoolFilterFromQuery(boot)), [boot]);
  // Layers › None: the plain map (?colours=none). Any layer chosen, or a new one shown, colours it again.
  const [plain, setPlain] = useState(false);
  const plainLayer = useRef(layer);
  useEffect(() => {
    if (plainLayer.current !== layer) setPlain(false);
    plainLayer.current = layer;
  }, [layer]);
  // The Cycle lanes overlay (TfL), off until asked for.
  const [cycleLanes, setCycleLanes] = useState(false);
  // The Road collisions overlay (DfT STATS19) and its filters; null while off.
  const [collisions, setCollisions] = useState<CollisionView | null>(null);
  // The rest of the opening setup: the layer with its view and period, the camera, the plain
  // map, crime filters and Show's other items. Only what differs from the server's first render is set.
  useEffect(() => {
    const opened = new URLSearchParams(boot);
    const state = parseMapState(opened);
    if (state.layer !== initialState.layer || state.period !== initialState.period) {
      plainLayer.current = state.layer;
      setLayer(state.layer);
      setPeriod(state.period);
    }
    if (["lat", "lng", "zoom"].every((key) => opened.has(key))
      && (state.latitude !== initialState.latitude || state.longitude !== initialState.longitude || state.zoom !== initialState.zoom)) {
      const start = { ...initialState, latitude: state.latitude, longitude: state.longitude, zoom: state.zoom, bearing: state.bearing };
      setStartCamera(start);
      setCamera(start);
      setCameraSettled(true);
    }
    setPlain(plainFromQuery(boot));
    setExcludedCrime(crimeOffFromQuery(boot));
    setCycleLanes(cycleFromQuery(boot));
    setCollisions(collisionsFromQuery(boot));
    setSaleView((current) => salesFromQuery(boot, { ...current, on: false }));
    // Once, on mount: `boot` is fixed for the mount and initialState is the server's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);
  // The live address too, after `boot`: a home's Safety "On map" is a client-side link, and `boot` is read
  // in render, before the router has moved the address there. Read once into a ref: the first address
  // write drops ?collisions=on before this state lands, and a rerun (Strict Mode) must not read that.
  const linkedCollisions = useRef<CollisionView | null | undefined>(undefined);
  useEffect(() => {
    if (linkedCollisions.current === undefined) linkedCollisions.current = collisionsFromQuery(window.location.search);
    if (linkedCollisions.current) setCollisions(linkedCollisions.current);
  }, []);
  // Layers v5: Road danger brings the collisions' dots with it (street zoom), Green streets each street tree
  // (Show's rows keep their filters); leaving the layer takes off what it brought, never what Show had on.
  // After the link's own Show state above, so a link's filters win on the first paint.
  const brought = useRef({ collisions: false, trees: false });
  useEffect(() => {
    if (layer === "road-collisions") {
      if (collisions === null && !collisionsFromQuery(boot) && !linkedCollisions.current) {
        brought.current.collisions = true;
        setCollisions(DEFAULT_COLLISION_VIEW);
      }
    } else if (brought.current.collisions) {
      brought.current.collisions = false;
      setCollisions(null);
    }
    if (layer === "green-streets") {
      if (!shows.trees && !showsFromQuery(boot).trees) {
        brought.current.trees = true;
        setShows((current) => ({ ...current, trees: true }));
      }
    } else if (brought.current.trees) {
      brought.current.trees = false;
      setShows((current) => ({ ...current, trees: false }));
    }
    // On the layer only: what Show holds meanwhile is the visitor's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer]);
  // A link's pitch, else the viewer's 2D/3D choice, else flat on phones and under Places (lib/map-state.ts).
  useEffect(() => setPitch((current) => initialPitch(BOOT_SEARCH, window.innerWidth, current, chosenPitch())), []);
  // Turning Places on flattens the map; on load initialPitch has already decided.
  const placesWereOn = useRef(placeView.on);
  useEffect(() => {
    if (placeView.on && !placesWereOn.current) setPitch(0);
    placesWereOn.current = placeView.on;
  }, [placeView.on]);
  // Stable between renders: the map repaints the sale pins whenever this changes.
  const shownSaleView = useMemo(
    () => ({ ...saleView, ramp: saleRamp }),
    [saleView, saleRamp],
  );

  // Recent sales as they open (off, every filter All) for this period: Show's Default and the setup's base.
  const defaultSales = useMemo(() => defaultSaleView(latestSaleYear(period)), [period]);
  useMapNavigation({
    // A custom layer stays in the address only while the profile carries the criterion.
    camera, cameraSettled, layer: custom.criterion || !isCustomLayerId(layer) ? layer : "personal-match", period, selected, pitch, mode: dataMode.mode, release: dataMode.release, scaleMode, changeWindow, placeView, shows,
    plain, home: uprn || addressId ? { uprn, addressId } : null, matchList,
    extras: { cycleLanes, collisions, saleView, excludedCrime, salesBase: defaultSales, schoolFilter },
  });

  // ---- Default: Show and Layers each put back their own defaults, with Undo. ----
  const showSetup: ShowSetup = { placeView, shows, cycleLanes, collisions, saleView, schoolFilter };
  const latestPrice = resolveMetric(DEFAULT_LAYER as MetricId).defaultPeriod || period;
  const layersDefault = isDefaultLayers({ layer, period, scaleMode, changeWindow, excludedCrime, plain }, latestPrice, DEFAULT_CHANGE_WINDOW);
  const showDefault = isDefaultShow(showSetup, defaultSales);

  function applyShow(next: ShowSetup) {
    setPlaceView(next.placeView);
    setShows(next.shows);
    setCycleLanes(next.cycleLanes);
    setCollisions(next.collisions);
    setSaleView(next.saleView);
    setSchoolFilter(next.schoolFilter);
  }

  /** Show › Default: Local places and Stations on, every other item off, every filter All. Returns the undo. */
  function resetShow(): () => void {
    const before = showSetup;
    applyShow(defaultShowSetup(defaultSales));
    return () => applyShow(before);
  }

  /** Layers › Default: Price per m² · Rank in London · latest, nothing filtered, colours on. Returns the undo. */
  function resetLayers(): () => void {
    const before = { layer, period, scaleMode, changeWindow, excludedCrime, plain };
    plainLayer.current = DEFAULT_LAYER as MapLayerId;
    setLayer(DEFAULT_LAYER as MapLayerId);
    setPeriod(latestPrice);
    setScaleMode(DEFAULT_SCALE_MODE);
    setChangeWindow(DEFAULT_CHANGE_WINDOW);
    setExcludedCrime([]);
    setPlain(false);
    dataMode.setNotice(null);
    return () => {
      plainLayer.current = before.layer;
      setLayer(before.layer);
      setPeriod(before.period);
      setScaleMode(before.scaleMode);
      setChangeWindow(before.changeWindow);
      setExcludedCrime(before.excludedCrime);
      setPlain(before.plain);
    };
  }

  function updateCamera(next: MapState) {
    setCamera(next);
    setCameraSettled(true);
  }

  function selectLayer(nextLayer: MetricId | DetailLayerId) {
    const nextMetric = resolveMetric(detailAreaLayer(nextLayer));
    const transition = applyLayerSelection(
      { layer, period, mode: dataMode.mode, release: dataMode.release },
      nextLayer,
      // A real-mode placeholder has no periods yet: keep the month until the release's own definition arrives.
      nextMetric.defaultPeriod || period,
      nextMetric.label,
    );
    dataMode.setNotice(transition.notice);
    if (transition.notice) return;
    setPlain(false);
    setLayer(transition.layer);
    setPeriod(transition.period);
  }

  function showMatches() {
    if (!isLayerAvailableInMode("personal-match", dataMode.mode)) {
      dataMode.setNotice(realPilotUnavailableReason("Personal matching", dataMode.release));
      return;
    }
    setPlain(false);
    setLayer("personal-match");
    profiles.setProfileOpen(false);
  }

  function selectSearchResult(result: SearchResult) {
    setSelected(result.geographyId);
    setFocus(result.center);
    setHomePin(result.uprn || result.addressId ? result.center : null);
    setUprn(result.uprn);
    setAddressId(result.addressId);
    setSelectedParcelId(null);
    setChosenHome(null);
    if (result.uprn) void loadParcel(result.uprn).then(setSelectedParcelId);
  }

  // A tapped parcel or dwelling selects the house: its own sale history and
  // home's summary load by address id / UPRN, and the area it sits in follows.
  function selectDwelling(dwelling: { uprn: string; addressId: string | null }) {
    setUprn(dwelling.uprn);
    setAddressId(dwelling.addressId as AddressId | null);
    setChosenHome(null);
    void fetch(`/api/v1/properties/${encodeURIComponent(dwelling.uprn)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { property?: { geographyId: GeographyId; addressId: AddressId | null; parcelId: string | null; location: [number, number] } } | null) => {
        if (!payload?.property) return;
        setSelected(payload.property.geographyId);
        setSelectedParcelId(payload.property.parcelId);
        setChosenHome(payload.property.location);
        if (!dwelling.addressId) setAddressId(payload.property.addressId);
      })
      .catch(() => undefined);
  }

  function loadParcel(uprn: string): Promise<string | null> {
    return fetch(`/api/v1/properties/${encodeURIComponent(uprn)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { property?: { parcelId: string | null } } | null) => payload?.property?.parcelId ?? null)
      .catch(() => null);
  }

  // A sale pin: its area, its address history and, when it has a UPRN, the
  // dwelling's property payload (parcel outline, last recorded sale).
  function selectSale(sale: SalePinSelection) {
    if (sale.uprn) {
      selectDwelling({ uprn: sale.uprn, addressId: sale.addressId });
    } else {
      setUprn(null);
      setSelectedParcelId(null);
      setChosenHome(null);
      setAddressId(sale.addressId as AddressId);
    }
    if (sale.area) setSelected(sale.area as GeographyId);
  }

  /** Select an area from a list and bring it into view on the map. */
  function selectAndZoom(id: GeographyId) {
    selectMapArea(id);
    setZoomTo({ id, nonce: Date.now() });
  }

  /** The 2D/3D toggle in Map settings: remembered on this device, unlike a tilt by gesture. */
  function choosePitch(next: number) {
    setPitch(next);
    try { window.localStorage.setItem(PITCH_KEY, next === 0 ? "2d" : "3d"); } catch { /* storage may be blocked */ }
  }

  function choosePalette(id: string) {
    setPaletteId(id);
    try { window.localStorage.setItem(PALETTE_KEY, id); } catch { /* storage may be blocked */ }
  }

  function selectMapArea(id: GeographyId) {
    if (id !== selected) setHomePin(null);
    setSelected(id);
    setUprn(null);
    setAddressId(null);
    setSelectedParcelId(null);
    setChosenHome(null);
  }

  /** Escape's last rung (use-escape-ladder.ts): no area chosen, and nothing of the home that came with it. */
  function clearSelection() {
    setSelected(null);
    setHomePin(null);
    setUprn(null);
    setAddressId(null);
    setSelectedParcelId(null);
    setChosenHome(null);
  }

  function toggleCrimeCategorySelection(category: string) {
    setExcludedCrime((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]);
  }

  function resetCrimeFilter() {
    setExcludedCrime([]);
  }

  function clearCrimeFilter(categories: string[]) {
    setExcludedCrime([...categories]);
  }

  return {
    layer, metric, evidenceMetric, panelLayer, panelMetric, priceMetric, period, requestPeriod, mapMonth, selected, pitch, camera, startCamera, focus, homePin, uprn, addressId, selectedParcelId, chosenHome,
    showDefault, layersDefault, resetShow, resetLayers,
    // Green streets or Canopy (Layers › Nature): drawn finer than areas, the areas left clear.
    detailLayer: isDetailLayer(layer) ? layer : null,
    scaleMode, changeWindow, excludedCrime, crimeScaleStops,
    // Individual sales apply to the house-level layers with real data only.
    saleView: shownSaleView, setSaleView,
    salesAvailable: dataMode.mode === "real" && propertyLayersApply(layer),
    placeView, setPlaceView,
    cycleLanes, setCycleLanes,
    shows, setShows,
    schoolFilter, setSchoolFilter,
    plain, choosePlain: () => setPlain(true),
    collisions, setCollisions,
    latestSaleYear: latestSaleYear(period), selectSale, zoomTo, selectAndZoom,
    paletteId, setPaletteId: choosePalette,
    profile: profiles.profile, profileReady: profiles.ready, profileOpen: profiles.profileOpen,
    matchPack: matches.matchPack, matchKey: matches.matchKey, routeJobStatus: matches.routeJobStatus,
    matchBusy: matches.matchBusy, retryMatch: matches.retryMatch, lastMapLayer,
    matchList, setMatchList,
    customCriterion: custom.criterion, customPack: custom.valuePack, customTooltip: custom.tooltip, customRollup: custom.rollup, showCriterion: custom.show,
    exploreCriterion: (criterion: Parameters<typeof custom.explore>[0]) => {
      setPlain(false);
      custom.explore(criterion);
    },
    // The comparison panel's way back: to the layer before it (a chip tapped over Crime goes back to Crime),
    // else My match as before.
    criterionBack: custom.before && custom.before !== "personal-match"
      ? { label: resolveMetric(detailAreaLayer(custom.before)).shortLabel, go: () => custom.explore(null) }
      : null,
    mode: dataMode.mode, release: dataMode.release, hiddenLayers, londonOnly,
    notice: dataMode.notice, connection: dataMode.connection,
    scope: dataMode.channel.scope, onConnection: dataMode.channel.onConnection,
    setPeriod, setPitch, choosePitch, setCamera: updateCamera, setScaleMode, setChangeWindow, setCrimeScaleStops,
    setProfile: profiles.setProfile, setProfileOpen: profiles.setProfileOpen, eraseProfile: profiles.eraseProfile,
    showMatches, selectLayer, selectSearchResult, selectMapArea, selectDwelling, clearSelection,
    toggleCrimeCategory: toggleCrimeCategorySelection, resetCrimeFilter, clearCrimeFilter,
    switchDataMode: dataMode.switchDataMode,
  };
}

/** `demoAllowed` (?dev=1): a real deployment otherwise never restores a saved demo choice. */
function useDataMode(initialState: MapState, demoAllowed: boolean, link?: string) {
  const [mode, setMode] = useState<DataMode>(initialState.mode);
  const [release, setRelease] = useState<string>(initialState.release);
  const [notice, setNotice] = useState<string | null>(() => initialNotice(initialState));
  const [connection, setConnection] = useState<ConnectionStatus>("online");
  const scope = useMemo(() => createEvidenceRequestScope(), []);
  const channel = useMemo(() => ({ scope, onConnection: setConnection }), [scope]);
  // "Offline" is never sticky: the browser's online/offline events clear or set it, and while it is set
  // the API is probed every CONNECTION_PROBE_MS; any answer clears it (lib/connection.ts).
  useEffect(() => watchConnection(window, setConnection), []);
  useEffect(() => {
    if (connection !== "offline") return;
    const timer = window.setInterval(() => {
      void probeConnection((url) => fetch(url, { cache: "no-store" })).then((up) => { if (up) setConnection("online"); });
    }, CONNECTION_PROBE_MS);
    return () => window.clearInterval(timer);
  }, [connection]);

  useEffect(() => {
    const search = window.location.search;
    // ?layer=commute names no layer: the map opens Price per m² and says so.
    const unknownLayer = unknownLayerNotice(link ?? search);
    if (unknownLayer) setNotice(unknownLayer);
    if (!shouldAdoptSavedState(search)) {
      const conflict = urlModeNotice(search, demoAllowed);
      if (conflict) setNotice(conflict);
      return;
    }
    const saved = restoreSavedMapState(readSavedMapState());
    if (!saved) return;
    const adopted = adoptSavedState(saved, initialState, demoAllowed);
    setMode(adopted.mode);
    setRelease(adopted.release);
  }, []);

  function switchDataMode(next: DataMode) {
    const transition = applyModeSwitch({ mode, release }, next);
    setMode(transition.mode);
    setRelease(transition.release);
    setNotice(transition.notice);
  }

  return { mode, release, notice, connection, channel, setNotice, setConnection, switchDataMode };
}

function useSharedProfile() {
  const [profile, setProfileState] = useState<PreferenceProfile>(DEFAULT_PROFILE);
  const [profileOpen, setProfileOpen] = useState(false);
  const [ready, setReady] = useState(false);
  // The page opened on a shared search (#profile=…).
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    // A shared link shows the sender's search ("This search") and is not saved until it is edited. A link that
    // cannot be read in full opens what it can, or the household's own search, with a toast.
    const link = readProfileLink(window.location.hash);
    const shared = link.profile;
    // In My match's one list: an old wizard search reads as range criteria in its order.
    setProfileState(shared ? markProfileOrigin(asSearch(shared), "shared") : asSearch(loadLocalProfile(DEFAULT_PROFILE)));
    setOpened(shared !== null);
    const toast = profileLinkToast(link);
    if (toast) showMapToast(toast.text, { kind: toast.kind, ms: 8000 });
    const event = profileLinkEvent(link);
    if (event) track("profile_link", event);
    setReady(true);
    // The Tailor card saved the household's own search: read it again (a shared or example search stays on screen).
    const reload = () => setProfileState((current) => (profileOrigin(current) === "own" ? asSearch(loadLocalProfile(DEFAULT_PROFILE)) : current));
    window.addEventListener(PROFILE_SAVED_EVENT, reload);
    return () => window.removeEventListener(PROFILE_SAVED_EVENT, reload);
  }, []);

  function setProfile(nextProfile: PreferenceProfile) {
    setProfileState(nextProfile);
    // The example is shown, never saved: the household's own saved search stays as it was.
    if (profileOrigin(nextProfile) !== "example") saveLocalProfile(nextProfile);
  }

  function eraseProfile() {
    eraseLocalProfile();
    setProfileState(DEFAULT_PROFILE);
  }

  return { profile, profileOpen, ready, shared: opened, setProfile, setProfileOpen, eraseProfile };
}

/** A saved or shared search in the one list's form; an unset one (nothing asked yet) stays unset. */
function asSearch(profile: PreferenceProfile): PreferenceProfile {
  return isUnsetProfile(profile) ? profile : normaliseSearch(profile);
}

/**
 * A custom criterion on the map (layer `custom:<id>`): from the profile, shown from the panel before it
 * joins the match, or a ready-made comparison named by a link (/?layer=custom:kebab-cafe opens it cold).
 * Only a link to a home-made criterion the profile lacks falls back to My match once the profile loads.
 */
function useCustomLayer(layer: MapLayerId, profile: PreferenceProfile, ready: boolean, setLayer: (layer: MapLayerId) => void) {
  const [shown, setShown] = useState<CustomCriterion | null>(null);
  // Shown from My match (or a link): the panel shows it. Picked in Layers: only the map does.
  const [inPanel, setInPanel] = useState(true);
  const id = isCustomLayerId(layer) ? layer.slice("custom:".length) : null;
  const fromProfile = id ? profile.custom?.find((entry) => entry.criterion.id === id)?.criterion ?? null : null;
  const preset = id ? CUSTOM_PRESETS.find((entry) => entry.criterion.id === id)?.criterion ?? null : null;
  const criterion = fromProfile ?? (id && shown?.id === id ? shown : null) ?? preset;
  const pack = useCustomPack(criterion);
  useEffect(() => {
    if (ready && id && !criterion) setLayer("personal-match");
  }, [ready, id, criterion, setLayer]);
  const metric = useMemo(() => (criterion ? customMapDefinition(criterion, pack) : null), [criterion, pack]);
  const valuePack = useMemo(() => (pack ? customValuePack(pack) : null), [pack]);
  const tooltip = useMemo(() => (pack ? customTooltip(pack) : null), [pack]);
  // Zoomed out the map paints the criterion's MSOAs, as every other layer (custom_criteria.roll_up_pack).
  const rollup = useMemo(() => (criterion ? () => customRollup(criterion) : null), [criterion]);
  // The layer on before a comparison (null on a cold shared link): turning it off, from its chip or the
  // panel's back link, returns to it. Kept in render, not an effect, so the back link names it at once.
  const [before, setBefore] = useState<Exclude<MapLayerId, `custom:${string}`> | null>(isCustomLayerId(layer) ? null : layer);
  if (!isCustomLayerId(layer) && layer !== before) setBefore(layer);
  function show(next: CustomCriterion | null) {
    setShown(next);
    setInPanel(true);
    setLayer(next ? `custom:${next.id}` : "personal-match");
  }
  function explore(next: CustomCriterion | null) {
    if (next) {
      setShown(next);
      setInPanel(false);
      setLayer(`custom:${next.id}`);
      return;
    }
    setShown(null);
    setLayer(layerAfterExplore(before));
  }
  return { criterion, metric, valuePack: criterion ? valuePack : null, tooltip: criterion ? tooltip : null, rollup,
    inProfile: fromProfile !== null, show, explore, before, inPanel };
}

interface MatchChannel {
  scope: EvidenceRequestScope;
  onConnection: (status: ConnectionStatus) => void;
}

function useMatchPack(
  layer: MapLayerId,
  profile: PreferenceProfile,
  mode: DataMode,
  release: string,
  channel: MatchChannel,
) {
  const [matched, setMatched] = useState<{ pack: MatchPack; key: string } | null>(null);
  const [routeJobStatus, setRouteJobStatus] = useState<string | null>(null);
  // A 429 or 5xx (lib/match-retry.ts): retried with a growing wait, then Try again (`retry` asks once more).
  const [busy, setBusy] = useState<MatchBusy>(null);
  const [retry, setRetry] = useState(0);
  const asked = useRef(false);
  // What is sent (v4: the ordered list, preference-profile.v2): marks, notes and the Kids/Drive answers that
  // change nothing in the match never ask again. Nothing asked yet (no criteria): no match, the map waits.
  const key = useMemo(() => (isUnsetProfile(profile) || !searchCriteria(profile).length ? null : searchKey(profile)), [profile]);

  useEffect(() => {
    // The ranking stays live under a custom criterion's map layer: the panel keeps showing it.
    if ((layer !== "personal-match" && !isCustomLayerId(layer)) || !isLayerAvailableInMode("personal-match", mode)) return;
    setBusy(null);
    if (!key) {
      setMatched(null);
      return;
    }
    const controller = new AbortController();
    const handlers = {
      onMatch: (pack: MatchPack) => { setBusy(null); setMatched({ pack, key }); },
      onJobStatus: setRouteJobStatus, onConnection: channel.onConnection,
    };
    let timeout = 0;
    // The pack is painted over every LSOA's box: those load while it is scored, not after it.
    if (mode === "real") prefetchAllBoxes("lsoa", release);
    const attempt = async (tries: number) => {
      const target = { path: matchRequestPath(mode, release), sequence: channel.scope.issue(), scope: channel.scope };
      const refused = await requestMatches(key, controller.signal, target, handlers);
      if (!refused || controller.signal.aborted || !target.scope.isCurrent(target.sequence)) return;
      if (tries >= MATCH_RETRIES) {
        setBusy("failed");
        return;
      }
      setBusy("retrying");
      timeout = window.setTimeout(() => void attempt(tries + 1), matchRetryDelay(tries, refused.retryAfter));
    };
    // Edits in a row wait 120 ms and ask once; the first ask (a shared search opening) goes at once.
    timeout = window.setTimeout(() => void attempt(0), asked.current ? 120 : 0);
    asked.current = true;
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [layer, key, mode, release, channel, retry]);

  // `matchKey` names the search the pack answers: the panel re-scores the pack on the client until the next one arrives.
  return {
    matchPack: matched?.pack ?? null, matchKey: matched?.key ?? null, routeJobStatus,
    matchBusy: busy, retryMatch: () => setRetry((count) => count + 1),
  };
}

interface NavigationSnapshot {
  camera: MapState;
  cameraSettled: boolean;
  layer: MapLayerId;
  period: string;
  selected: GeographyId | null;
  pitch: number;
  mode: DataMode;
  release: string;
  scaleMode: LegendScaleMode;
  changeWindow: ChangeWindow;
  placeView: PlaceView;
  shows: MapShows;
  plain: boolean;
  home: MapHome | null;
  /** My match's Top 10 | Bottom 10 (only in the address while My match is on). */
  matchList: MatchList;
  /** Show's other items and the crime filter: in the address and the saved setup too. */
  extras: { cycleLanes: boolean; collisions: CollisionView | null; saleView: SaleView; excludedCrime: string[]; salesBase: Omit<SaleView, "ramp">; schoolFilter: SchoolFilter };
}

function useMapNavigation(state: NavigationSnapshot) {
  const { camera, cameraSettled, layer, period, selected, pitch, mode, release, scaleMode, changeWindow, placeView, shows, plain, matchList } = state;
  const homeUprn = state.home?.uprn ?? null;
  const homeAddress = state.home?.addressId ?? null;
  const { cycleLanes, collisions, saleView, excludedCrime, salesBase, schoolFilter } = state.extras;
  // A sale view differs only by what the setup keeps (not its colours): compare it as that string.
  const salesQuery = withSalesQuery("", saleView, salesBase);
  // The layer's own colour range once a handle is released (a drag never rewrites the address; lib/legend-range.ts).
  const legendKey = legendScaleKey(layer, effectiveScaleMode(layer, scaleMode, false));
  const legendScale = useSyncExternalStore(subscribeLegendScale, () => committedLegendScale(legendKey), () => AUTO_SCALE);
  // Next's router treats history.replaceState as a navigation: rewriting the
  // address while the map settles would cancel a link click to another page.
  const leaving = useRef(false);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (anchor instanceof HTMLAnchorElement && leavesPage(anchor, event, window.location)) leaving.current = true;
    };
    const reset = () => { leaving.current = false; };
    // Back over a sheet's history step (lib/map-sheets.ts) lands on the address as it was when the
    // sheet opened: write the map's own again.
    const path = window.location.pathname;
    const back = () => {
      reset();
      const shared = writes.current.shared;
      if (shared === null || window.location.pathname !== path) return;
      const navigable = preserveDiagnosticsQuery(shared, window.location.search);
      if (window.location.search.slice(1) !== navigable) window.history.replaceState(null, "", `${path}?${navigable}${window.location.hash}`);
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("pageshow", reset);
    window.addEventListener("popstate", back);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pageshow", reset);
      window.removeEventListener("popstate", back);
    };
  }, []);
  // The last write and the one waiting: playback's months become one write per 400 ms (lib/address-writes.ts).
  const writes = useRef<{ last: number | null; shared: string | null; timer: number | null }>({ last: null, shared: null, timer: null });
  useEffect(() => () => { if (writes.current.timer !== null) window.clearTimeout(writes.current.timer); }, []);
  useEffect(() => {
    if (leaving.current) return;
    const query = withoutUnsettledCamera(serializeMapState({ ...camera, layer, period, selected, pitch, mode, release, matchList }), cameraSettled);
    // The colour scale travels in the address only (?scale=change&window=5), not in the saved view.
    // So does the Places overlay (?places=all).
    // The chosen home too (?uprn=…&address=…): a reload or a shared link reselects it.
    // Show's other items and the crime filter too: a reload or a shared link opens the same setup.
    const setup = withCrimeOffQuery(withCollisionsQuery(withCycleQuery(query, cycleLanes), collisions), excludedCrime);
    const withSales = new URLSearchParams(setup);
    const salesParam = new URLSearchParams(salesQuery).get("sales");
    if (salesParam) withSales.set("sales", salesParam);
    const withShows = withSchoolFilterQuery(withShowsQuery(withPlacesQuery(withScaleQuery(withSales.toString(), scaleMode, changeWindow, defaultScaleMode(layer)), placeView), shows),
      shows.schools, schoolFilter);
    const shared = withHomeQuery(withPlainQuery(withLegendScaleQuery(withShows, legendScale), plain),
      { uprn: homeUprn, addressId: homeAddress });
    const write = () => {
      writes.current = { last: performance.now(), shared, timer: null };
      if (leaving.current) return;
      const navigable = preserveDiagnosticsQuery(shared, window.location.search);
      window.history.replaceState(null, "", `${window.location.pathname}?${navigable}${window.location.hash}`);
      // The whole setup, saved on this device (lib/map-setup.ts).
      writeMapSetup(shared);
    };
    if (writes.current.timer !== null) window.clearTimeout(writes.current.timer);
    // Only a month moved (playback, a slider drag): spaced out. Anything else is written at once.
    const wait = onlyPeriodChanged(writes.current.shared, shared) ? addressWriteDelay(performance.now(), writes.current.last) : 0;
    if (wait === 0) write();
    else writes.current.timer = window.setTimeout(write, wait);
  }, [camera, cameraSettled, layer, period, pitch, selected, mode, release, scaleMode, changeWindow, placeView, shows, plain, homeUprn, homeAddress,
    cycleLanes, collisions, salesQuery, excludedCrime, matchList, schoolFilter, legendScale]);
}

/** A plain same-tab click on a link to another page of this site. */
export function leavesPage(
  anchor: { href: string; target: string; hasAttribute(name: string): boolean },
  event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean },
  location: { origin: string; pathname: string },
): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, location.origin);
  return url.origin === location.origin && url.pathname !== location.pathname;
}

function withoutUnsettledCamera(query: string, cameraSettled: boolean): string {
  if (cameraSettled) return query;
  const parameters = new URLSearchParams(query);
  for (const key of ["lat", "lng", "zoom"]) parameters.delete(key);
  return parameters.toString();
}

function initialNotice(initialState: MapState): string | null {
  if (isLayerAvailableInMode(initialState.layer, initialState.mode)) return null;
  return realPilotUnavailableReason(initialState.layer, initialState.release);
}

function readSavedMapState(): string | null {
  try {
    return window.localStorage.getItem(SAVED_MAP_STATE_KEY);
  } catch {
    return null;
  }
}

interface MatchTarget {
  path: string;
  sequence: number;
  scope: EvidenceRequestScope;
}

interface MatchHandlers {
  onMatch: (pack: MatchPack) => void;
  onJobStatus: (status: string | null) => void;
  onConnection: (status: ConnectionStatus) => void;
}

async function requestMatches(
  body: string,
  signal: AbortSignal,
  target: MatchTarget,
  handlers: MatchHandlers,
): Promise<{ retryAfter: string | null } | null> {
  try {
    const response = await fetch(target.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal,
    });
    if (!target.scope.isCurrent(target.sequence)) return null;
    // An answer of any status means the connection is there (lib/connection.ts).
    handlers.onConnection("online");
    if (isBusyStatus(response.status)) return { retryAfter: response.headers.get("retry-after") };
    if (!response.ok) return null;
    await resolveMatchPayload(await response.json() as MatchPack | MatchJob, target, signal, handlers);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return null;
    handlers.onConnection("offline");
    console.error("Match request failed", error);
  }
  return null;
}

async function resolveMatchPayload(
  payload: MatchPack | MatchJob,
  target: MatchTarget,
  signal: AbortSignal,
  handlers: MatchHandlers,
) {
  if (isMatchPack(payload)) {
    if (target.scope.isCurrent(target.sequence)) applyMatchPack(payload, handlers);
    return;
  }
  if (!target.scope.isCurrent(target.sequence)) return;
  handlers.onMatch(payload.partial);
  handlers.onJobStatus("Calculating commute matrix…");
  await pollMatchJob(payload.jobId, signal, target, handlers);
  if (target.scope.isCurrent(target.sequence)) handlers.onJobStatus(null);
}

function applyMatchPack(payload: MatchPack, handlers: MatchHandlers): void {
  track("match_run", { results: payload.values.filter((value) => value.rank !== null).length });
  handlers.onMatch(payload);
  handlers.onJobStatus(null);
}

async function pollMatchJob(jobId: string, signal: AbortSignal, target: MatchTarget, handlers: MatchHandlers) {
  while (!signal.aborted && target.scope.isCurrent(target.sequence)) {
    await delay(150, signal);
    const response = await fetch(`/api/v1/matches/jobs/${encodeURIComponent(jobId)}`, { signal });
    const payload = await response.json() as MatchPack | MatchJob;
    if (isMatchPack(payload)) {
      if (target.scope.isCurrent(target.sequence)) applyMatchPack(payload, handlers);
      return;
    }
  }
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export type ExplorerController = ReturnType<typeof useExplorerController>;

function latestSaleYear(period: string): number {
  const year = Number(period.slice(0, 4));
  return Number.isFinite(year) && year > 1995 ? year : new Date().getUTCFullYear();
}

function useReleaseMetrics(mode: DataMode, release: string): Map<MetricId, MetricDefinition> | null {
  const [metrics, setMetrics] = useState<Map<MetricId, MetricDefinition> | null>(null);
  useEffect(() => {
    if (mode !== "real") { setMetrics(null); return; }
    let live = true;
    // The catalogue (about 1.4 MB) is read once per page: the area card's sections read the same request
    // (section-fetch's cache), never a second copy per card view.
    void fetchSectionJson<{ metrics?: MetricDefinition[] }>(METRICS_PATH).then((payload) => {
      if (live && payload?.metrics?.length) setMetrics(new Map(payload.metrics.map((metric) => [metric.id, metric])));
    });
    return () => { live = false; };
  }, [mode, release]);
  return metrics;
}

/** The fixed price breaks (latest year plus history steps), computed once per release by /api/v1/price-scale. */
function usePriceBreaks(mode: DataMode, release: string): number[] | null {
  const [breaks, setBreaks] = useState<number[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ mode, release });
    void fetch(`/api/v1/price-scale?${query}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { breaks?: unknown } | null) => {
        const values = payload?.breaks;
        if (Array.isArray(values) && values.length === PRICE_STEPS + 1
          && values.every((value, index) => typeof value === "number" && (index === 0 || value > values[index - 1]))) {
          setBreaks(values as number[]);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [mode, release]);
  return breaks;
}

const PALETTE_KEY = "close-knit.palette";
const PITCH_KEY = "close-knit.map-view";
// The page normalises the URL on load; keep the query it was opened with.
export const BOOT_SEARCH = typeof window === "undefined" ? "" : window.location.search;

function initialPalette(): string {
  if (typeof window === "undefined") return DEFAULT_PALETTE;
  const fromUrl = new URLSearchParams(BOOT_SEARCH).get("palette");
  if (fromUrl) return paletteById(fromUrl).id;
  try { return paletteById(window.localStorage.getItem(PALETTE_KEY)).id; } catch { return DEFAULT_PALETTE; }
}

/** The viewer's 2D/3D choice from Map settings, or null when they have not chosen. */
export function chosenPitch(): number | null {
  try {
    const view = window.localStorage.getItem(PITCH_KEY);
    return view === "2d" ? 0 : view === "3d" ? 45 : null;
  } catch {
    return null;
  }
}

/**
 * Every layer the map shows, once per change: what people look at (layer_view) and the key engaged time
 * is split by (layer_time). The first one is the layer the page opened with, marked `initial`.
 */
function useLayerUsage(layer: MapLayerId, criterion: CustomCriterion | null) {
  const first = useRef(true);
  const criterionId = criterion?.id ?? null;
  useEffect(() => {
    // A custom layer waits for its criterion, so the event can say which one it is.
    if (isCustomLayerId(layer) && !criterion) return;
    const { name, props } = layerUsage(layer, criterion);
    setUsageLayer(name);
    track("layer_view", { ...props, initial: first.current });
    first.current = false;
    // criterion is read through its id: a new object with the same id is the same layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, criterionId]);
}
