"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";

import type { BriefLayer, SchoolFilter } from "@/lib/brief-model";
import { filterSchools } from "@/lib/brief-model";
import { addPlace, removePlace, updatePlace } from "@/lib/match-brief";
import { describeSchoolFilter, schoolFilterText, type SchoolFilter as MapSchoolFilter } from "@/lib/school-filter";
import { rescore, searchCriteria, searchKey, setBudget } from "@/lib/match-search";

import { effectiveScaleMode } from "@/lib/legend-scale";
import { parcelsShown, PROPERTY_ATTRIBUTION, PROPERTY_ATTRIBUTION_SHORT } from "@/lib/map-property-layers";
import { areaEvidencePath, compactDataStatus, describeDataStatus, describePublicDataStatus, PERIOD_PATTERN, periodForMetric, type DataMode, type MapState } from "@/lib/map-state";
import { sharedPoliteFetch } from "@/lib/shared-fetch";
import { markToolBudget } from "@/lib/budget-source";
import { type GeographyId, type MatchPack, type MetricDefinition, type MetricId, type PreferenceProfile } from "@/lib/contracts";
import { friendlyTitle } from "@/lib/area-labels";
import { mapValueText } from "@/lib/map-legend";
import type { SheetSnap } from "@/lib/sheet-snap";
import { isCustomLayerId } from "@/lib/custom-criteria";
import { CUSTOM_RANGE_SCOPE, topicPillLabel, topicTitle, topicTrigger } from "@/lib/map-topics";
import { LONDON_ONLY_LABEL, loadedMapCoverage, subscribeMapCoverage, subscribeViewScope, viewScopeWords } from "@/lib/map-coverage";
import { subscribeViewScale, viewScaleMetricId } from "@/lib/view-scale";
import { legendScaleFor, servedScope, subscribeLegendScale, type ScaleScope } from "@/lib/legend-range";
import { paintedStore } from "@/lib/layer-explainer";
import { exampleProfile, isUnsetProfile } from "@/lib/profile-state";
import { rankParam } from "@/lib/ranking-top";

import { useUiTheme } from "./appearance-menu";
import { CoverageNotice } from "./coverage-notice";
import { AreaKeyNumbers, EvidencePanel } from "./evidence-panel";
import { ExplorerHeader } from "./explorer-header";
import { FirstVisitIntro, useIntroCard } from "./first-visit-intro";
import { valueLine } from "@/lib/coverage-words";
import { useScope } from "@/components/scope-context";
import { coversEngland } from "@/lib/scope";
import { HelpTip } from "./help-tip";
import { AreaMarks, MATCH_FLAGS } from "./match/area-marks";
import { useMatchBrief } from "./match/use-match-brief";
import { useFindLike } from "./match/use-find-like";
import { isPhone, MapDock, type DockArea } from "./map-dock";
import { MapPoster } from "./map-poster";
import { MapLayers } from "./map-layers";
import { MapSheet, PHONE_QUERY, useOpenMapSheet } from "./map-sheet";
import { MapToast } from "./map-toast";
import { closeMapSheet, openMapSheet } from "@/lib/map-sheets";
import { MapSettings } from "./map-settings";
import { CurrentLayerExplainer, LayerExplainer } from "./layer-explainer";
import { shownCount } from "@/lib/map-shows";
import { LegendRange } from "./legend-range";
import { LiveMapLegend, MatchLegendHint, ownScaleKey } from "./map-legend";
import { MapDataSelector, MapOverlays } from "./map-data-selector";
import { CycleLaneKey } from "./kids-tiles";
import { CollisionPanel } from "./collision-panel";
import { detailExplanation, detailRelated, DetailLegend, ShowTreesLegend, StreetTreesPanel } from "./detail-legend";
import { SchoolMeasureLegend, SchoolPanel } from "./school/school-legend";
import { DEFAULT_COLLISION_VIEW } from "@/lib/map-collisions";
import { PriceTimelineControl } from "./price-timeline-control";
import { SalesAbout, SalesLegendCompact, SalesPanel } from "./sales-panel";
import { PlacesPanel } from "./places-panel";
import { MapCardView, type MyPlaceActions } from "./map-cards";
import { useTapToPlace } from "./use-tap-to-place";
import { SavedPanel } from "./saved-panel";
import { CompareTray } from "./compare-tray";
import { SAVED_PARAM, wantsSaved } from "@/lib/saved-panel";
import { mapCardTitle, type MapCard } from "@/lib/map-pick";
import { paddingOffset, visiblePadding } from "@/lib/map-padding";
import { SCHOOL_PARAM, schoolParam, schoolUrnFromHref } from "@/lib/school-card";
import { PanelSchool } from "./school/school-panel";
import { track } from "@/lib/usage";
import { valueStore } from "@/lib/value-store";
import { useEscapeLadder } from "./use-escape-ladder";
import { useExplorerController } from "./use-explorer-controller";

import "../styles/first-view.css";
// Show › Schools' filters and key (school-legend.tsx stays CSS-free so its unit test can render it).
import "../styles/school-map.css";
import "../styles/school-filter.css";

// MapLibre (about 400 KB gzipped) is the only library these three import: it loads after the
// page is interactive, the poster holding the map's place till then, so search, the intro and the
// sheet never wait for it.
// The map is this page's first paint: its chunk (MapLibre with it) starts downloading as this module runs, alongside
// hydration, instead of once the explorer has rendered (perf/layer-load: every open waited for it).
if (typeof window !== "undefined") void import("./area-map");
const AreaMap = dynamic(() => import("./area-map").then((loaded) => loaded.AreaMap), { ssr: false, loading: () => <MapPoster /> });
const MatchOverlays = dynamic(() => import("./match/match-overlays").then((loaded) => loaded.MatchOverlays), { ssr: false });
const ZoneDraw = dynamic(() => import("./match/zone-draw").then((loaded) => loaded.ZoneDraw), { ssr: false });
const MyPlacesOverlay = dynamic(() => import("./my-places-overlay").then((loaded) => loaded.MyPlacesOverlay), { ssr: false });
const SavedOverlay = dynamic(() => import("./saved-overlay").then((loaded) => loaded.SavedOverlay), { ssr: false });
// A ranking's top 10 (the ranking page's "On map ↗"): loaded when a link asks for one.
const RankingTop = dynamic(() => import("./ranking-top").then((loaded) => loaded.RankingTop), { ssr: false });
// Drawing mode's bar: loaded when a drawing starts.
const ZoneDrawBar = dynamic(() => import("./match/zone-draw-bar").then((loaded) => loaded.ZoneDrawBar));
// My match (ranking, compare, brief, shortlists) shows only once asked for: its code loads then
// (server-rendered as before when a link opens on it).
const PersonalMatchPanel = dynamic(() => import("./personal-match-panel").then((loaded) => loaded.PersonalMatchPanel));

/** Two blocks over the map: the top bar and the map dock. */
export function CloseKnit({ initialState, link, fitSelected = false, fitZoom = null, dev = false }: {
  initialState: MapState; link?: string; fitSelected?: boolean; fitZoom?: number | null; dev?: boolean;
}) {
  // The served scope (app/layout.tsx): the first view's words say England from the first paint.
  const england = coversEngland(useScope());
  const explorer = useExplorerController(initialState, fitSelected, dev, link, fitZoom);
  // The interface theme is applied on load, not when Map settings first opens.
  const theme = useUiTheme();
  const findButton = useRef<HTMLButtonElement>(null);
  // Where the phone sheet rests (desktop: the side panel shown or folded). Only the visitor moves it.
  // With nothing to show it starts at the peek, its line the prompt (desktop opens it on load, below).
  const [snap, setSnap] = useState<SheetSnap>(() =>
    initialState.selected || initialState.layer === "personal-match" || isCustomLayerId(initialState.layer) ? "half" : "collapsed");
  const dockOpen = snap !== "collapsed";
  // One sheet at a time on a phone: a MapSheet opening (Layers, Show, …) lowers the area
  // sheet to its peek, and the area sheet rising closes the MapSheet. The area is never lost.
  const openSheet = useOpenMapSheet();
  useEffect(() => {
    // Watch opens over the area sheet, which stays where it was: closing Watch shows the same area view.
    if (openSheet && !openSheet.startsWith("watch:") && isPhone()) setSnap("collapsed");
  }, [openSheet]);
  const phone = usePhoneLayout();
  // My match's sheet on a phone: where it opens (lowered for the example, so London shows) and a requested snap
  // ("Top 10 ›" goes full).
  const [matchStart, setMatchStart] = useState<SheetSnap>("half");
  const [matchSnap, setMatchSnap] = useState<{ snap: SheetSnap; at: number } | null>(null);
  const moveDock = useCallback((next: SheetSnap) => {
    if (next !== "collapsed" && isPhone()) closeMapSheet();
    setSnap(next);
  }, []);
  /** Lifts a lowered sheet to half for something the visitor asked to see; leaves an open one as it is. */
  const lift = useCallback(() => {
    if (isPhone()) closeMapSheet();
    setSnap((current) => (current === "collapsed" ? "half" : current));
  }, []);
  // Phones with nothing chosen keep the sheet at its peek bar: only an area (or My match) opens it.
  const emptyArea = useRef(true);
  const raise = useCallback(() => {
    if (!(emptyArea.current && isPhone())) lift();
  }, [lift]);
  const [summary, setSummary] = useState<string | null>(null);
  const [attributionHost, setAttributionHost] = useState<HTMLElement | null>(null);
  const [crimeCategories, setCrimeCategories] = useState<string[]>([]);
  // The London median of the month shown, for the legend's tick: a store too, so a timeline step re-renders
  // only the legend for it, not the page (monthly playback).
  const regionMedian = useRef(valueStore<number | null>(null)).current;
  // What the map paints, for the legend "?" (London typical and the chosen area on the scale): a store, not
  // state, so a timeline step re-renders nothing for it.
  const painted = useRef(paintedStore()).current;
  const onCrimeCategories = useCallback((next: string[]) => {
    setCrimeCategories((current) => (current.join("\n") === next.join("\n") ? current : next));
  }, []);
  const matchLayer = explorer.layer === "personal-match";
  // A criterion shown from My match keeps that panel; one picked in Layers leaves the panel as it was.
  const matchPanel = explorer.panelLayer === "personal-match" || isCustomLayerId(explorer.panelLayer);
  // My match: the brief behind the ranking, what is drawn on the map and the place being pinned.
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [matchLayers, setMatchLayers] = useState<Record<BriefLayer, boolean>>({ prices: true, ring: true, schools: true, travel: true });
  const [schoolFilter, setSchoolFilter] = useState<SchoolFilter>({ phase: "all", topOnly: false });
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(placing);
  placingRef.current = placing;
  // A zone being drawn on the map (My match › Where › Draw on map): its corners so far, or null when not drawing.
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  // Drawing mode: the map, not a card. A phone sheet steps down to its peek while the corners are tapped.
  const isDrawing = drawing !== null;
  useEffect(() => {
    if (isDrawing && isPhone()) setSnap("collapsed");
  }, [isDrawing]);
  const myPlaces = (explorer.profile.places ?? []).filter((place) => place.target.kind === "point").length;
  // Once the map is up, fetch My match's code (panel and map overlays) in the background: the first
  // comparison chosen or "Show areas" then opens without waiting on the network.
  useEffect(() => {
    if (!map) return;
    void import("./personal-match-panel");
    void import("./match/match-overlays");
    void import("./match/zone-draw");
  }, [map]);
  // My match on the map: every area by its score. The API's pack answers one search; while the
  // search on screen is newer (a reorder, a Soften, a card's edit) the pack is re-scored on the client from its own
  // components until the next one arrives, and a handle being dragged (the draft) re-scores it live.
  const [hoveredMatch, setHoveredMatch] = useState<GeographyId | null>(null);
  const [draft, setDraft] = useState<PreferenceProfile | null>(null);
  const liveDraft = useDeferredValue(draft);
  const matchPack = useMemo(() => currentPack(explorer.matchPack, explorer.matchKey, explorer.profile),
    [explorer.matchPack, explorer.matchKey, explorer.profile]);
  const mapMatchPack = useMemo(() => (explorer.matchPack && liveDraft ? rescore(explorer.matchPack, liveDraft) : matchPack),
    [explorer.matchPack, liveDraft, matchPack]);
  // The pins number the list, so the brief follows the list, not the dragged handle.
  const brief = useMatchBrief(explorer.profile, matchPack, explorer.selected, explorer.mode, matchLayer, 0, explorer.matchList);
  const mapSchools = brief && explorer.selected
    ? filterSchools(brief.schools, schoolFilter, explorer.selected)
    : [];
  const placeAt = useCallback((point: { latitude: number; longitude: number }) => {
    explorer.setProfile(addPlace(explorer.profile, {
      label: "Pinned place", target: { kind: "point", ...point }, mode: "transit", targetMinutes: 30, weight: 3, must: false,
    }));
    setPlacing(false);
  }, [explorer]);
  // My match › Travel to › Or pin it on the map: the next tap is the place.
  useTapToPlace(map, placing && matchLayer, placeAt);
  // The first-visit card steps aside once the visitor gets going: a search, the layers, an area.
  const [started, setStarted] = useState(false);
  const onStarted = useCallback(() => setStarted(true), []);
  // Places are on by default now, so they no longer count as getting going.
  // A ranking's "On map ↗" (/?layer=…&rank=<slug>): its top 10 numbered on the map until ✕. The address keeps rank= until
  // then (a reload or a shared address shows the same ten). A ranking opened keeps the first-visit card away for the visit
  // (the client navigation can reach the card before the address carries rank=).
  const search = useSearchParams()?.toString() ?? "";
  const [rank, setRank] = useState<string | null>(null);
  const [ranked, setRanked] = useState(false);
  useEffect(() => {
    const asked = rankParam(search);
    if (asked) { setRank(asked); setRanked(true); }
  }, [search]);
  const intro = useIntroCard(started || !!explorer.selected);
  const introShown = intro.visible && !explorer.selected && !matchPanel && !ranked;
  // My match from its round button or the first-visit card (no wizard): the list opens, Budget focused.
  // On a phone it is the one MapSheet "match", opened again if another sheet took its place.
  const findMyArea = useCallback(() => {
    intro.dismiss();
    setMatchSnap(null);
    explorer.showMatches();
    if (isPhone()) openMapSheet("match");
  }, [explorer, intro]);
  // Show › Schools › Use in My match (Schools filter v2): the same filter as a place, "near a school like this",
  // a 15-minute walk; then My match opens with it.
  const useSchoolsInMatch = useCallback((filter: MapSchoolFilter) => {
    explorer.setProfile(addPlace(explorer.profile, {
      label: describeSchoolFilter(filter).slice(0, 60), target: { kind: "school-filter", filter: schoolFilterText(filter) },
      mode: "walk", targetMinutes: 15, weight: 4, must: false,
    }));
    findMyArea();
  }, [explorer, findMyArea]);
  // The card's ×: focus moves to the top bar's "Find my area".
  const focusFindAfterClose = useCallback(() => window.requestAnimationFrame(() => findButton.current?.focus()), []);
  // Intro › Try an example: the ready-made search (#23), shown as an example and never saved. A phone opens the
  // sheet lowered, so the coloured map of London is what shows first (never zoom 9 south of London).
  const tryExample = useCallback(() => {
    explorer.setProfile(exampleProfile());
    if (isPhone()) setMatchStart("collapsed");
    explorer.showMatches();
  }, [explorer]);
  // One h1 on the page (contract 6): the intro's value line while it shows, an area's or the match
  // panel's title when they show, otherwise the same value line for screen readers.
  const valueHeading = !introShown && !explorer.selected && !matchPanel;
  const reopen = useReopenLabel(explorer.selected, explorer.panelMetric, explorer.requestPeriod, explorer.mode, explorer.release);
  const reopenLabel = reopen?.text ?? null;
  // Desktop: a new area (or leaving My match) reopens the folded side panel, as before. Phones: a newly
  // chosen area opens its peek at once (half height: name, verdict, tags, 4 tiles), never a one-line bar needing a second
  // tap; a sheet already at half or full stays where the visitor put it.
  useEffect(() => {
    if (!isPhone()) raise();
  }, [explorer.selected, matchLayer, raise]);
  // My match, asked for from the menu, the intro or a link, opens the ranking (a desktop's side panel; a phone's
  // own sheet, below).
  useEffect(() => {
    if (matchPanel && !isPhone()) raise();
  }, [matchPanel, raise]);
  // "Like this" and a tool's "Find areas at this budget" open My match with the budget to start from.
  const like = useFindLike(explorer.profile, explorer.mode);
  const showMatches = explorer.showMatches;
  useEffect(() => {
    if (like.open) showMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [like.open]);
  // A tool's price (Stamp duty, Buy-to-let: "Areas this buys in →") is the budget, applied once the saved search is read:
  // the map colours at once, as if typed and entered (CUJ-06, CUJ-11). The tool's price is the comfortable end
  // and the stretch fades above it ("£570k typical area price, fades to …"); the chip says "from Tools".
  const carried = like.carried;
  useEffect(() => {
    if (carried === null || !explorer.profileReady) return;
    const next = setBudget(explorer.profile, { market: "buy", target: carried });
    markToolBudget(next.targetBudget, next.maximumBudget);
    explorer.setProfile(next);
    track("match_edit", { action: "budget", criterion: "budget", criteria: searchCriteria(next).length });
    like.dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carried, explorer.profileReady]);
  // A tapped place, school, collision or tree opens its card at the top of the sheet (the peek line names it on
  // phones); a tap on the empty map closes it (map-controller/interactions.ts registerPick), and so does turning places off.
  const [pick, setPick] = useState<MapCard | null>(null);
  // Your place's card (Map controls PR 4): rename, move (the next tap on the map), remove, commute from here.
  // A move lasts while its card is open.
  const [moving, setMoving] = useState<string | null>(null);
  // A school (its cap on the map, or a school link in the panel) opens its page content in the panel in place of the
  // area (school-panel.tsx); ‹ Back, Escape, a tap on the map or another area returns to the area. ?school=<urn> keeps
  // it in the address, so a reload or a shared link opens it again (and moves the map to it).
  const [school, setSchool] = useState<{ urn: string; name: string | null; fly: boolean } | null>(null);
  const openSchool = useCallback((urn: string, fly = false) => {
    setPick(null);
    setMoving(null);
    setSavedOpen(false);
    setSchool((current) => (current?.urn === urn ? current : { urn, name: null, fly }));
    lift();
  }, [lift]);
  const onPick = useCallback((next: MapCard | null) => {
    if (next?.kind === "school" && !next.school.view.external) {
      openSchool(next.school.view.urn);
      return;
    }
    setSchool(null);
    setPick(next);
    setMoving(null);
    if (next && !isPhone()) raise();
  }, [raise, openSchool]);
  const closePick = useCallback(() => { setPick(null); setMoving(null); setSchool(null); }, []);
  const schoolUrn = school?.urn ?? null;
  const schoolRead = useRef(false);
  useEffect(() => {
    if (!schoolRead.current) {
      schoolRead.current = true;
      const urn = schoolParam(window.location.search);
      if (urn) openSchool(urn, true);
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get(SCHOOL_PARAM) === schoolUrn) return;
    if (schoolUrn) url.searchParams.set(SCHOOL_PARAM, schoolUrn);
    else url.searchParams.delete(SCHOOL_PARAM);
    window.history.replaceState(window.history.state, "", url);
  }, [schoolUrn, openSchool]);
  const schoolLoaded = useCallback((name: string | null, at: [number, number] | null) => {
    setSchool((current) => (current ? { ...current, name, fly: false } : current));
    if (!school?.fly || !at || !map) return;
    map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 14), offset: paddingOffset(visiblePadding(map.getContainer())), duration: 0 });
  }, [school?.fly, map]);
  // Another area chosen (search, the map, a list) leaves the school for that area.
  const lastSelected = useRef(explorer.selected);
  useEffect(() => {
    if (lastSelected.current === explorer.selected) return;
    lastSelected.current = explorer.selected;
    setSchool(null);
  }, [explorer.selected]);
  // A school's link inside the panel (the area's school rows, Saved) opens the school here, not a new page;
  // a modified click, a new tab or a link marked data-full-page still goes to the page.
  const panelSchoolLinks = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || link.target || link.dataset.fullPage !== undefined) return;
    const urn = schoolUrnFromHref(link.href, window.location.origin);
    if (!urn) return;
    event.preventDefault();
    openSchool(urn);
  }, [openSchool]);
  const movingPlace = pick?.kind === "my-place" && moving === pick.placeId ? moving : null;
  useTapToPlace(map, movingPlace !== null, (point) => {
    if (movingPlace) explorer.setProfile(updatePlace(explorer.profile, movingPlace, { target: { kind: "point", ...point } }));
    setMoving(null);
  });
  const placeActions: MyPlaceActions = {
    nameOf: (id) => explorer.profile.places?.find((place) => place.id === id)?.label ?? null,
    rename: (id, label) => explorer.setProfile(updatePlace(explorer.profile, id, { label })),
    moving: movingPlace,
    onMove: (id) => { setPlacing(false); setMoving(id); },
    remove: (id) => explorer.setProfile(removePlace(explorer.profile, id)),
    commute: () => findMyArea(),
  };
  // Escape, one rung per press (Map controls PR 1): a peek on the map → this card → the selection.
  useEscapeLadder(map, explorer.selected !== null, explorer.clearSelection, { open: pick !== null || school !== null, close: closePick });
  const placesOn = explorer.placeView.on;
  useEffect(() => {
    if (!placesOn) setPick((current) => (current?.kind === "place" ? null : current));
  }, [placesOn]);
  // ♡ Saved (the header's ♡ N, or /?saved=1 from another page): the dock shows Saved until it is closed,
  // an area is chosen or My match opens. "On map" draws each saved thing as a ♡.
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedOnMap, setSavedOnMap] = useState(true);
  // Read in the first render, on every mount (a client-side link to /?saved=1 too): the map rewrites its address from
  // its own state before effects here run.
  const [bootSaved] = useState(() => typeof window !== "undefined" && wantsSaved(window.location.search));
  const openSaved = useCallback(() => {
    setSavedOpen((open) => !open);
    lift();
  }, [lift]);
  // CUJ03: the saved map setup may reopen My match a moment after load; on /?saved=1 that is not the
  // visitor opening it, so Saved stays until they first press or type something.
  const bootHold = useRef(bootSaved);
  useEffect(() => {
    if (!bootSaved) return;
    const release = () => { bootHold.current = false; };
    window.addEventListener("pointerdown", release, { capture: true, once: true });
    window.addEventListener("keydown", release, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", release, { capture: true });
      window.removeEventListener("keydown", release, { capture: true });
    };
  }, [bootSaved]);
  const leftSaved = useRef({ selected: explorer.selected, matchPanel });
  useEffect(() => {
    const before = leftSaved.current;
    leftSaved.current = { selected: explorer.selected, matchPanel };
    const matchOpened = matchPanel && !before.matchPanel && !bootHold.current;
    if ((explorer.selected && explorer.selected !== before.selected) || matchOpened) setSavedOpen(false);
  }, [explorer.selected, matchPanel]);
  // The address says Saved is open (?saved=1), so a reload or a copied link opens it again; the map's own
  // writes keep the flag (preserveDiagnosticsQuery) and never save it with the setup.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has(SAVED_PARAM) === savedOpen) return;
    if (savedOpen) url.searchParams.set(SAVED_PARAM, "1");
    else url.searchParams.delete(SAVED_PARAM);
    window.history.replaceState(window.history.state, "", url);
  }, [savedOpen]);
  // A phone shows My match in its own MapSheet: the area sheet keeps the area (it waits at its peek, hidden under it).
  const matchSheet = matchPanel && phone;
  // My match: a row or a map tap opens the one area view in the panel (a phone: in My match's sheet),
  // never the old in-list card; "← My match" goes back to the list with the area still chosen. A comparison of places
  // shown from My match keeps its own panel.
  // Opening My match (its button, a link, "Like this") shows the list first, even with an area already chosen.
  const [listFor, setListFor] = useState<GeographyId | null>(initialState.selected);
  const onMatchList = explorer.panelLayer === "personal-match";
  // In render, not an effect, so the list never unmounts for a frame (its open blocks keep their state).
  const [wasOnList, setWasOnList] = useState(onMatchList);
  if (wasOnList !== onMatchList) {
    setWasOnList(onMatchList);
    if (onMatchList) setListFor(explorer.selected);
  }
  const matchArea = onMatchList && explorer.selected !== null && listFor !== explorer.selected;
  const matchResult = matchArea ? matchPack?.values.find((result) => result.geographyId === explorer.selected) ?? null : null;
  // Its score as on its row, or "Out" (the neutral hatch) when a Must puts it out.
  const matchScore: number | "out" | null = !matchResult ? null : matchResult.excluded || matchResult.score === null ? "out" : matchResult.score;
  // Phones: a newly chosen area opens at its peek (half height: name, verdict, tags, 4 tiles) at once, never a one-line bar
  // that needs a second tap; a sheet already at half or full stays. Under My match its sheet lifts instead.
  const shownSelection = useRef(explorer.selected);
  useEffect(() => {
    const was = shownSelection.current;
    shownSelection.current = explorer.selected;
    if (!explorer.selected || explorer.selected === was || !isPhone() || isDrawing) return;
    if (!matchSheet) lift();
    else if (document.querySelector("[data-testid='match-sheet']")?.getAttribute("data-snap") === "collapsed") {
      setMatchSnap({ snap: "half", at: Date.now() });
    }
  }, [explorer.selected, lift, matchSheet, isDrawing]);
  // A card alone (a school tapped before any area) is content too: a desktop's panel, absent while empty, shows it.
  const area: DockArea = savedOpen ? "saved" : matchPanel && !matchSheet ? (matchArea ? "area" : "match") : explorer.selected || pick || school ? "area" : "empty";
  emptyArea.current = area === "empty";
  // Phones: with nothing chosen (on arrival, or My match closed on no area) the sheet rests at its
  // peek rather than an empty half. A map tap only ever chooses an area, so it never lands here.
  useEffect(() => {
    if (area === "empty" && isPhone()) setSnap("collapsed");
  }, [area]);
  // /?saved=1 opens Saved with the sheet up (after the phone's resting peek above, which it overrides).
  useEffect(() => {
    if (!bootSaved) return;
    setSavedOpen(true);
    lift();
  }, [bootSaved, lift]);
  const salesOn = explorer.salesAvailable && explorer.saleView.on;
  const customCriteria = (explorer.profile.custom ?? []).map((entry) => entry.criterion);
  const changeScale = effectiveScaleMode(explorer.metric.id, explorer.scaleMode, false) === "change";
  // What the view's ranks are in: London, the one region in view, or "its region" across regions (England map).
  const regionScope = useSyncExternalStore(subscribeViewScope, viewScopeWords, () => "London");
  // A rank scale split from the areas in view (lib/view-scale.ts) reads "Rank in view"; too few areas, the region's.
  // Only which layer it is: a new view's breaks re-render the legend (map-legend useViewBreaks), never the page.
  const viewScaleLayer = useSyncExternalStore(subscribeViewScale, viewScaleMetricId, () => null);
  const inView = viewScaleLayer === explorer.metric.id && effectiveScaleMode(explorer.metric.id, explorer.scaleMode, false) === "percentile";
  // The reader's own scale (lib/legend-range.ts), as one word: a drag keeps it "custom", so it never re-renders the page.
  const ownKey = ownScaleKey({ metric: explorer.metric, scaleMode: explorer.scaleMode });
  const ownKind = useSyncExternalStore<ScaleScope | "custom">(subscribeLegendScale, () => {
    const scale = ownKey ? legendScaleFor(ownKey) : null;
    return !scale ? "view" : scale.range ? "custom" : scale.scope;
  }, () => "view");
  // A London map (CLOSE_KNIT_ENGLAND off) has no England ranks: a saved "england" reads as the region's.
  const coverage = useSyncExternalStore(subscribeMapCoverage, () => loadedMapCoverage().coverage, () => "london" as const);
  const ownScope = ownKind === "custom" ? ownKind : servedScope(ownKind, coverage);
  const rankScope = ownScope === "custom" ? CUSTOM_RANGE_SCOPE : ownScope === "england" ? "England"
    : ownScope === "region" ? (regionScope === "England" ? "its region" : regionScope) : inView ? "view" : regionScope;
  const topicState = { layer: explorer.layer, scaleMode: explorer.scaleMode, changeWindow: explorer.changeWindow, rankScope };
  // Parcels (and so their licence line) show at house zoom on the price layer, unless None hides the colours.
  const licence = parcelsShown(explorer.metric.id, explorer.camera.zoom) && !salesOn && !changeScale && !explorer.plain;
  const legendProps = {
    metric: explorer.metric,
    period: explorer.period,
    mode: explorer.mode,
    scaleMode: explorer.scaleMode,
    changeWindow: explorer.changeWindow,
    rankScope,
    inView,
    stopsOverride: explorer.crimeScaleStops,
    // Sold homes at house zoom share the sale pins' six price colours.
    soldRamp: explorer.saleView.ramp,
    houseZoom: licence,
    // The legend's title names the layer ("Noise · % of homes at 55 dB or more").
    layerName: topicTrigger(topicState, customCriteria, explorer.metric.shortLabel).name,
    // A layer whose data is London's alone on the England map says so while it is chosen (DESIGN.md §6).
    coverageTag: england && explorer.londonOnly?.has(explorer.metric.id) ? LONDON_ONLY_LABEL : null,
  };
  // Leaving My match: back to the layer before it (a phone's ✕, Escape or the back gesture on its sheet).
  const selectLayer = explorer.selectLayer;
  const lastMapLayer = explorer.lastMapLayer;
  const leaveMatch = useCallback(() => {
    closeMapSheet("match");
    selectLayer((lastMapLayer && !isCustomLayerId(lastMapLayer) ? lastMapLayer : "price-per-square-metre") as MetricId);
    // The sheet's opener takes focus back (MapSheet's contract).
    window.requestAnimationFrame(() => findButton.current?.focus());
  }, [selectLayer, lastMapLayer]);
  // A phone's My match is the MapSheet "match": open whenever My match is on and no other sheet took its place (it
  // comes back when Layers or Show closes); the back gesture on it leaves My match, as ✕ does.
  // The area sheet waits at its peek under My match's sheet (a link opening on My match starts it at half).
  // On /?saved=1 a saved setup may turn My match on under Saved; its sheet waits until Saved closes.
  useEffect(() => {
    if (matchSheet && !savedOpen) setSnap("collapsed");
  }, [matchSheet, savedOpen]);
  const sheetWas = useRef(openSheet);
  useEffect(() => {
    const was = sheetWas.current;
    sheetWas.current = openSheet;
    if (!matchSheet) return;
    if (was === "match" && openSheet === null && drawing === null) leaveMatch();
    else if (openSheet === null && snap === "collapsed" && !savedOpen) openMapSheet("match");
  }, [matchSheet, openSheet, snap, drawing, leaveMatch, savedOpen]);
  const matchPanelNode = (
    <PersonalMatchPanel
      pack={matchPack}
      jobStatus={explorer.routeJobStatus}
      busy={{ state: explorer.matchBusy, onRetry: explorer.retryMatch }}
      profile={explorer.profile}
      selected={explorer.selected}
      mode={explorer.mode}
      release={explorer.release}
      onSelect={(id) => { setListFor(null); selectedFrom("ranking", explorer.selectAndZoom)(id); }}
      onChangeProfile={explorer.setProfile}
      brief={brief}
      schoolFilter={schoolFilter}
      onSchoolFilter={setSchoolFilter}
      placing={placing}
      onPlacing={setPlacing}
      shownCriterion={isCustomLayerId(explorer.panelLayer) ? explorer.customCriterion : null}
      keyNumbers={explorer.selected && (
        <AreaKeyNumbers selected={explorer.selected} mode={explorer.mode} release={explorer.release} />
      )}
      onShowCriterion={explorer.showCriterion}
      criterionBack={explorer.criterionBack}
      criterionBackInHeader={matchSheet}
      drawing={drawing}
      onDrawing={setDrawing}
      onDraft={setDraft}
      mapLayer={explorer.lastMapLayer}
      hiddenLayers={explorer.hiddenLayers}
      onHover={setHoveredMatch}
      matchList={explorer.matchList}
      onMatchList={explorer.setMatchList}
      like={like}
      onShowTop={() => setMatchSnap({ snap: "full", at: Date.now() })}
      layers={matchLayers}
      onLayers={setMatchLayers}
    />
  );
  // The one area view for an area chosen in My match: its price evidence, "← My match" and the score.
  const backToList = () => setListFor(explorer.selected);
  const areaView = (inSheet: boolean) => (
    <EvidencePanel
      key="match-area"
      selected={explorer.selected}
      metric={explorer.priceMetric}
      period={explorer.period}
      mode={explorer.mode}
      release={explorer.release}
      connection={explorer.connection}
      scope={explorer.scope}
      onConnection={explorer.onConnection}
      uprn={explorer.uprn}
      addressId={explorer.addressId}
      excludedCrime={explorer.excludedCrime}
      onSelect={selectedFrom("panel", explorer.selectMapArea)}
      open={inSheet || dockOpen}
      phone={phone}
      onSummary={setSummary}
      back={{
        label: "My match", onBack: backToList, score: matchScore, inHeader: inSheet,
        // Off (FLAGS.md): the old card's Like it · Not for me · Note, kept for the owner to switch back on.
        extra: MATCH_FLAGS.AREA_MARKS && explorer.selected
          ? <AreaMarks id={explorer.selected} profile={explorer.profile} onChange={explorer.setProfile} /> : null,
      }}
    />
  );
  // The phone sheet's header over an area or a lens (CUJ06 / CUJ10): its way back in the title's place, never
  // "My match ✕" over "← My match" (the view below leaves its own back out: inHeader, criterionBackInHeader).
  const lensShown = isCustomLayerId(explorer.panelLayer) && !!explorer.customCriterion;
  const matchSheetLead = matchArea ? (
    <button type="button" className="map-sheet__back" data-testid="area-view-back" onClick={backToList}>
      <span aria-hidden="true">← </span>My match
    </button>
  ) : lensShown ? (
    <button type="button" className="map-sheet__back criterion-back" data-testid="criterion-sheet-back"
      onClick={explorer.criterionBack ? explorer.criterionBack.go : () => explorer.showCriterion(null)}>
      ← Back to {explorer.criterionBack ? explorer.criterionBack.label : "My match"}
    </button>
  ) : undefined;
  return (
    <main
      className="explorer-shell"
      data-testid="close-knit"
      data-active-metric={explorer.layer}
      data-active-period={explorer.period}
      data-map-pitch={explorer.pitch}
    >
      <a className="skip-link" href="#area-evidence">Skip to area evidence</a>
      <ExplorerHeader
        onSelect={(result) => {
          if (!result.uprn && !result.addressId) track("area_select", { area: result.geographyId, from: "search" });
          explorer.selectSearchResult(result);
          // A search is asked for: its answer comes up from the peek (it chooses an area, so the sheet may open).
          lift();
        }}
        onSearch={onStarted}
        empty={area === "empty"}
        saved={{ open: savedOpen, onOpen: openSaved }}
        menu={{
          dev, mode: explorer.mode, release: explorer.release, onModeChange: explorer.switchDataMode, theme,
          mapSettings: (
            <MapSettings themeId={theme.themeId} onTheme={theme.chooseTheme} paletteId={explorer.paletteId} onPalette={explorer.setPaletteId} layer={explorer.layer}
              pitch={explorer.pitch} onPitch={explorer.choosePitch} showTheme={false} />
          ),
        }}
      />
      {/* A returning visitor gets no card: ♡ N is the reminder. */}
      {introShown && <FirstVisitIntro england={england} onFind={findMyArea} onExample={tryExample} onDismiss={intro.dismiss} onClose={focusFindAfterClose} />}
      {/* Desktop, nothing chosen: no side panel, one hint under the search (phones: the sheet's peek says it). */}
      {area === "empty" && !introShown && (
        <p className="map-hint" data-testid="map-hint">
          <span>Choose an area</span>
          <span className="map-hint__dot" aria-hidden="true">·</span>
          <button type="button" className="map-hint__example" data-testid="map-hint-example" onClick={tryExample}>Try an example</button>
        </p>
      )}
      {valueHeading && <h1 className="sr-only" data-testid="value-heading">{valueLine(england)}</h1>}
      <AreaMap
        metric={explorer.metric}
        matchPack={matchLayer ? mapMatchPack : null}
        clientPack={explorer.customPack}
        clientTooltip={explorer.customTooltip}
        clientRollup={explorer.customRollup}
        mode={explorer.mode}
        release={explorer.release}
        period={explorer.mapMonth}
        selected={explorer.selected}
        pitch={explorer.pitch}
        focus={explorer.focus}
        pin={explorer.homePin}
        onPick={onPick}
        initialCamera={explorer.startCamera}
        scaleMode={explorer.scaleMode}
        changeWindow={explorer.changeWindow}
        excludedCrime={explorer.excludedCrime}
        onMedian={regionMedian.set}
        onPainted={painted.set}
        plain={explorer.plain}
        onCamera={explorer.setCamera}
        onPitch={explorer.setPitch}
        onSelect={(id) => {
          // A tap that pins a place (My match › Travel to › pin it) also lands on an area: it keeps the list.
          if (placingRef.current) setListFor(id);
          selectedFrom("map", explorer.selectMapArea)(id);
        }}
        onSelectDwelling={explorer.selectDwelling}
        sales={explorer.salesAvailable ? explorer.saleView : null}
        places={explorer.placeView}
        cycleLanes={explorer.cycleLanes}
        stations={explorer.shows.stations}
        schools={explorer.shows.schools}
        schoolFilter={explorer.schoolFilter}
        collisions={explorer.collisions}
        streetTrees={explorer.shows.trees}
        detailLayer={explorer.detailLayer}
        zoomTo={explorer.zoomTo}
        onSelectSale={explorer.selectSale}
        selectedParcelId={explorer.selectedParcelId}
        chosenHome={explorer.chosenHome}
        onLegendStops={explorer.setCrimeScaleStops}
        onCrimeCategories={onCrimeCategories}
        attributionHost={attributionHost}
        onMap={setMap}
      />
      {matchLayer && (
        <MatchOverlays map={map} brief={brief} pack={matchPack} livePack={mapMatchPack} profile={explorer.profile} selected={explorer.selected}
          hovered={hoveredMatch} list={explorer.matchList} layers={matchLayers} schools={mapSchools}
          onSelect={selectedFrom("match_map", explorer.selectMapArea)} />
      )}
      {(matchLayer || drawing !== null) && <ZoneDraw map={map} zones={explorer.profile.zones} draft={drawing} onDraft={setDrawing} />}
      {explorer.shows.mine && !matchLayer && <MyPlacesOverlay map={map} profile={explorer.profile} />}
      {savedOnMap && <SavedOverlay map={map} />}
      {rank && !matchLayer && (
        <RankingTop map={map} slug={rank} selected={explorer.selected} onSelect={explorer.selectAndZoom}
          onPin={explorer.selectMapArea} onClose={() => { setRank(null); dropRankParam(); }} />
      )}
      {/* Drawing a zone, from My match › Where: a slim bar over the map; Done, Undo, Cancel here. */}
      {drawing !== null && (
        <ZoneDrawBar profile={explorer.profile} onChange={explorer.setProfile} drawing={drawing} onDrawing={setDrawing} />
      )}
      <span id="area-evidence" className="sr-only" tabIndex={-1}>Area evidence</span>
      <MapLayers
        map={map}
        onNorth={() => explorer.choosePitch(0)}
        match={{ active: matchLayer, onOpen: findMyArea, buttonRef: findButton }}
        shownCount={explorer.showDefault ? 0 : shownCount(explorer.shows, [explorer.placeView.on, salesOn, explorer.cycleLanes, explorer.collisions !== null])}
        plain={explorer.plain}
        title={explorer.plain ? "None" : topicTitle(topicState, customCriteria, explorer.metric.shortLabel)}
        explainer={(close) => explorer.detailLayer ? (
          <LayerExplainer explanation={detailExplanation(explorer.detailLayer)} ramp={null} average={null} area={null} onClose={close}
            related={((link) => link && { label: link.label, onSelect: () => { explorer.setShows({ ...explorer.shows, trees: true }); close(); } })(
              detailRelated(explorer.detailLayer, explorer.shows.trees))} />
        ) : (
          <CurrentLayerExplainer legend={legendProps} name={topicTrigger(topicState, customCriteria, explorer.metric.shortLabel).name}
            criterion={isCustomLayerId(explorer.layer) ? explorer.customCriterion : null} painted={painted}
            selected={explorer.selected} selectedName={reopen?.name ?? null} onClose={close} />
        )}
        attribution={{
          onHost: setAttributionHost,
          status: dev
            ? describeDataStatus({ mode: explorer.mode, release: explorer.release, connection: explorer.connection })
            : publicDataStatus(describePublicDataStatus({ mode: explorer.mode, connection: explorer.connection })),
          // HM Land Registry's statement stays on screen with the outlines, panel or no panel.
          licence: licence && (
            <div className="dock-licence map-licence">
              <details data-testid="parcel-attribution">
                <summary>{PROPERTY_ATTRIBUTION_SHORT} <span className="dock-licence__more">more</span></summary>
                {PROPERTY_ATTRIBUTION}
              </details>
              <HelpTip id="parcel-licence" label="land outlines" />
            </div>
          ),
        }}
        show={() => (
          <MapOverlays
            overlays={{
              places: {
                on: explorer.placeView.on,
                onChange: (on) => explorer.setPlaceView({ ...explorer.placeView, on }),
                panel: <PlacesPanel view={explorer.placeView} zoom={explorer.camera.zoom} onChange={explorer.setPlaceView} />,
              },
              schools: {
                on: explorer.shows.schools,
                onChange: (on) => explorer.setShows({ ...explorer.shows, schools: on }),
                panel: <SchoolPanel filter={explorer.schoolFilter} zoom={explorer.camera.zoom} release={explorer.release} onChange={explorer.setSchoolFilter} onUseInMatch={useSchoolsInMatch} />,
              },
              sales: {
                available: explorer.salesAvailable,
                note: "Over Price per m², with real data",
                on: explorer.saleView.on,
                onChange: (on) => explorer.setSaleView({ ...explorer.saleView, on }),
                panel: <SalesPanel view={explorer.saleView} latestYear={explorer.latestSaleYear} zoom={explorer.camera.zoom} onChange={explorer.setSaleView} />,
                about: <SalesAbout />,
              },
              stations: { on: explorer.shows.stations, onChange: (on) => explorer.setShows({ ...explorer.shows, stations: on }) },
              mine: {
                available: myPlaces > 0 || explorer.shows.mine,
                note: "Pin a place in My match",
                on: explorer.shows.mine,
                onChange: (on) => explorer.setShows({ ...explorer.shows, mine: on }),
              },
              "cycle-lanes": { on: explorer.cycleLanes, onChange: explorer.setCycleLanes, panel: <CycleLaneKey /> },
              collisions: {
                on: explorer.collisions !== null,
                onChange: (on) => explorer.setCollisions(on ? DEFAULT_COLLISION_VIEW : null),
                panel: explorer.collisions && <CollisionPanel view={explorer.collisions} zoom={explorer.camera.zoom} onChange={explorer.setCollisions} />,
              },
              trees: {
                on: explorer.shows.trees,
                onChange: (on) => explorer.setShows({ ...explorer.shows, trees: on }),
                panel: <StreetTreesPanel zoom={explorer.camera.zoom} cover={explorer.detailLayer === "canopy"} onCover={() => explorer.selectLayer("canopy")} />,
              },
            }}
          />
        )}
        label={topicTitle(topicState, customCriteria, explorer.metric.shortLabel)}
        // A phone's legend chip shows the scale only: the pill names the layer and its "London only".
        pill={[topicPillLabel(topicState, customCriteria, explorer.metric.shortLabel), legendProps.coverageTag].filter(Boolean).join(" · ")}
        selector={() => (
          <MapDataSelector
            layer={explorer.layer}
            metric={explorer.metric}
            mode={explorer.mode}
            plain={explorer.plain}
            onPlain={explorer.choosePlain}
            timeline={explorer.evidenceMetric && (
              <PriceTimelineControl
                metric={explorer.evidenceMetric}
                period={explorer.period}
                onPeriod={explorer.setPeriod}
                mode={explorer.mode}
                release={explorer.release}
              />
            )}
            custom={customCriteria}
            hidden={explorer.hiddenLayers}
            londonOnly={explorer.londonOnly}
            crimeCategories={crimeCategories}
            controls={{
              period: explorer.period,
              scaleMode: explorer.scaleMode,
              changeWindow: explorer.changeWindow,
              excludedCrime: explorer.excludedCrime,
              onScaleMode: explorer.setScaleMode,
              onChangeWindow: explorer.setChangeWindow,
              onToggleCrime: explorer.toggleCrimeCategory,
              onResetCrime: explorer.resetCrimeFilter,
              onClearCrime: explorer.clearCrimeFilter,
            }}
            onLayer={explorer.selectLayer}
            onCriterion={explorer.exploreCriterion}
          />
        )}
        notice={explorer.notice}
        onOpen={onStarted}
        defaults={{
          show: { isDefault: explorer.showDefault, reset: explorer.resetShow },
          layers: { isDefault: explorer.layersDefault, reset: explorer.resetLayers },
        }}
        range={salesOn || (explorer.shows.schools && explorer.schoolFilter.measure) || matchLayer || explorer.detailLayer || !ownKey
          ? undefined : <LegendRange legend={legendProps} region={regionScope} />}
        legend={salesOn ? <SalesLegendCompact view={explorer.saleView} />
          : explorer.shows.schools && explorer.schoolFilter.measure ? <SchoolMeasureLegend filter={explorer.schoolFilter} />
          : matchLayer && (isUnsetProfile(explorer.profile) || !searchCriteria(explorer.profile).length) ? <MatchLegendHint />
          : explorer.detailLayer ? <DetailLegend layer={explorer.detailLayer} trees={explorer.shows.trees} zoom={explorer.camera.zoom} /> : (
            <>
              <LiveMapLegend {...legendProps} median={regionMedian} />
              {explorer.shows.trees && <ShowTreesLegend zoom={explorer.camera.zoom} />}
            </>
          )}
      />
      {/* Map messages: above the controls, the legend and every sheet. */}
      <MapToast />
      <CoverageNotice map={map} layerName={legendProps.layerName} coverageTag={legendProps.coverageTag} />
      {/* A phone's My match: the one MapSheet, lowered to its summary, at half, or full for the ten. */}
      {matchSheet && openSheet === "match" && (
        <MapSheet id="match" title="My match" snaps={MATCH_SNAPS} initial={matchStart} onClose={leaveMatch} snapTo={matchSnap}
          className="match-sheet" testId="match-sheet" closeTestId="match-sheet-close" lead={matchSheetLead}>
          {matchArea ? areaView(true) : matchPanelNode}
        </MapSheet>
      )}
      <MapDock
        snap={snap}
        onSnap={moveDock}
        area={area}
        summary={school && !savedOpen ? school.name ?? "School" : pick ? mapCardTitle(pick) : area === "area" ? reopenLabel ?? summary : null}
        onExample={tryExample}
        onClickCapture={panelSchoolLinks}
      >
        {school && !savedOpen && !(matchPanel && !matchSheet) ? (
          <PanelSchool key={school.urn} urn={school.urn} from={explorer.selected} onBack={closePick} onLoaded={schoolLoaded} />
        ) : (<>
        {pick && <MapCardView card={pick} places={placeActions} onClose={closePick} />}
        {/* Saved has its own "Compare · N" of the ticked areas: no second tray over it. */}
        {!matchPanel && !savedOpen && <CompareTray />}
        {savedOpen ? (
          <SavedPanel
            match={{ pack: matchPack, profile: explorer.profile, mode: explorer.mode, release: explorer.release }}
            onClose={() => setSavedOpen(false)}
            onMap={savedOnMap}
            onToggleMap={setSavedOnMap}
            onSelectArea={(id) => {
              setSavedOpen(false);
              selectedFrom("saved", explorer.selectAndZoom)(id);
            }}
            onShowPoint={(at) => map?.flyTo({ center: at, zoom: Math.max(map.getZoom(), 15) })}
          />
        ) : matchPanel && !matchSheet ? (
          matchArea ? areaView(false) : matchPanelNode
        ) : explorer.panelMetric ? (
          <EvidencePanel
            selected={explorer.selected}
            metric={explorer.panelMetric}
            period={explorer.requestPeriod}
            mode={explorer.mode}
            release={explorer.release}
            connection={explorer.connection}
            scope={explorer.scope}
            onConnection={explorer.onConnection}
            uprn={explorer.uprn}
            addressId={explorer.addressId}
            excludedCrime={explorer.excludedCrime}
            onSelect={selectedFrom("panel", explorer.selectMapArea)}
            open={dockOpen}
            phone={phone}
            onSummary={setSummary}
            onExample={tryExample}
          />
        ) : null}
        </>)}
      </MapDock>
    </main>
  );
}

/** A ranking's card closed: its ?rank= leaves the address too (the map's writes keep it until then; lib/map-state.ts). */
function dropRankParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("rank")) return;
  url.searchParams.delete("rank");
  window.history.replaceState(null, "", url);
}

/** The footer's "Demo data" (or "Offline"): the whole warning on hover and for screen readers, never cut off on a phone. */
function publicDataStatus(status: string | null) {
  if (!status) return null;
  const { shown, hidden } = compactDataStatus(status);
  return <span title={status}>{shown}{hidden && <span className="sr-only">{hidden}</span>}</span>;
}

/**
 * The collapsed sheet's reopen row: "Pitshanger · W5 · £7,650/m²", the
 * area's friendly name and the shown value in the shared formats (never the
 * official code or a doubled unit). Loaded with the selection, so it is ready when the sheet folds.
 */
function useReopenLabel(selected: GeographyId | null, metric: MetricDefinition | null, period: string, mode: DataMode, release: string): { name: string; text: string } | null {
  const [label, setLabel] = useState<{ key: string; name: string; text: string } | null>(null);
  // No month yet (a linked layer's definition still on its way): wait, never ask the price month.
  const key = selected && metric && PERIOD_PATTERN.test(period) ? `${selected}|${metric.id}|${period}|${mode}|${release}` : null;
  useEffect(() => {
    if (!key || !selected || !metric) return;
    const controller = new AbortController();
    // A month the metric is published for (deprivation has 2025-01 only, never a 404).
    // The panel asks for the same evidence at the same moment: one request between them.
    void sharedPoliteFetch(areaEvidencePath({ selected, metric: metric.id, period: periodForMetric(metric, period), mode, release }), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { summary?: { name?: string; value: number | null }; friendlyName?: string | null; postcodeDistrict?: string | null } | null) => {
        if (!payload?.summary) return;
        const name = friendlyTitle(payload) ?? payload.summary.name ?? "Selected area";
        const value = mapValueText(payload.summary.value, metric);
        setLabel({ key, name, text: value ? `${name} · ${value}` : name });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [key, selected, metric, period, mode, release]);
  return label && label.key === key ? label : null;
}

/** An area chosen on the map, the ranking, the match pins or a panel: counted for "which places people look at". */
function selectedFrom(from: string, select: (id: GeographyId) => void) {
  return (id: GeographyId) => {
    track("area_select", { area: id, from });
    select(id);
  };
}

/** My match's phone sheet: lowered to its summary line, half, or full for the ten. */
const MATCH_SNAPS: readonly SheetSnap[] = ["collapsed", "half", "full"];

/**
 * The pack for the search on screen: the API's when it answers this search (`key`), else re-scored on the client from
 * the API's components (a reorder, Soften or a card's edit shows at once; the API confirms a moment later).
 */
function currentPack(pack: MatchPack | null, key: string | null, profile: PreferenceProfile): MatchPack | null {
  if (!pack) return null;
  return key === searchKey(profile) ? pack : rescore(pack, profile);
}


/** True at phone width (bottom sheets), following the window. */
function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}
