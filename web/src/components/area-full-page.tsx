"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";

import type {
  AddressHistory,
  AddressId,
  AreaLondonRanks,
  AreaResponse,
  AreaSummary,
  GeographyId,
  MarketSection as MarketDepth,
  MetricDefinition,
  MetricId,
  PreferenceProfile,
  PropertyHistory,
  PropertySummary,
} from "@/lib/contracts";
import { FLOOD_CHECK_URL, type PlaceCategory } from "@/lib/contracts";
import { carrierWords, friendlyTitle, isCodeName, type FriendlyAreaFields } from "@/lib/area-labels";
import { createEvidenceRequestScope, SAVED_MAP_STATE_KEY, savedMapView, type DataMode } from "@/lib/map-state";
import { formatEvidenceValue, formatPounds, regionShare } from "@/lib/evidence-format";
import { fallbackMetric, isPlaceholderMetric } from "@/lib/fixtures";
import { findLikeHref, isUnsetProfile } from "@/lib/profile-state";
import { AREA_CARDS, cardFromHash, mapHref, type AreaCardId } from "@/lib/area-brief";
import { civicPath, PRECEPT_LABELS, readCivic, type CivicResponse } from "@/lib/civic";
import { withCollisionsOn } from "@/lib/map-collisions";
import {
  formatMonth, formatPoundsShort, marketPath, perSquareFoot, readAreaMarket, readRecentSales, recentSalesPath, formatDay,
  type AreaMarketResponse,
} from "@/lib/market";
import { marketDepthPath, readMarketDepth } from "@/lib/market-depth";
import { FLOOD_BAND_LABEL, FLOOD_SOURCES, floodPath, homeFloodRow, type AreaFloodResponse, type HomeFloodContext } from "@/lib/flood-risk";
import { BUSY_CENTRE_NOTE, busyCentre, homeCost, roundPricePerSquareMetre } from "@/lib/overview-scorecard";
import type { AreaFacts } from "@/lib/overview-text";
import { AMENITY_SINGULAR, amenityName, lineNames, placesPath, stationWalkMinutes, walkMinutes, zoneLabel, type AreaPlacesState } from "@/lib/places";
import { areaSchoolsPath, METRICS_PATH, naturePath, noisePath } from "@/lib/section-seed";
import { checkHomeHref, searchBudgetPrefill } from "@/lib/tools";
import { councilTaxBandLabel, postcodeHomesPath, propertyPath } from "@/lib/property-profile";
import { upLinks, type Crumb } from "@/lib/entity-nav";
import { describePriceSample, priceEnglandComparison } from "@/lib/price-history";
import { areaSafetyPath, londonRateChip, offenceLabel, perThousand, readAreaSafety, safetyScope, spanWords, stableWords, type AreaSafety } from "@/lib/area-safety";
import { personalTags, type PageTailor } from "@/lib/area-tailor";
import { deprivationWords } from "@/lib/share-rows";
import { readAreaRents, rentsPath, RENT_BEDROOM_LABELS, type AreaRentsResponse } from "@/lib/area-rents";
import { LONDON_NOISE } from "@/lib/noise-evidence";
import type { AreaStandouts, StandoutTile } from "@/lib/standouts";
import type { AreaCommute } from "@/lib/commute";
import { homePath, sharePercent as homeShare, type AreaHomeResponse } from "@/lib/area-home";
import { airShown, gpDistance, gpEssential, healthPath, type AreaHealthResponse } from "@/lib/area-health";
import { locationPath, type AreaLocationResponse } from "@/lib/area-location";
import { kidsPath } from "@/lib/kids";
import { areaPeoplePath } from "@/lib/people-profile";
import {
  CorrectionSection,
  FreshnessWarning,
  officialUprn,
  priceDisplay,
  QualityNote,
  UnavailableState,
  useAddressHistory,
  useAreaEvidence,
  useAreaFacts,
  useDataHealth,
  usePropertyHistory,
  useHomeSummary,
} from "./evidence-panel";
import { AreaPageActions } from "./area-save-actions";
import { useFailedReads, useSectionJson } from "./section-seed";
import { SectionTabs } from "./section-tabs";
import { Breadcrumbs, WhatsNext } from "./entity-nav";
import { SavedHomesHere } from "./saved-homes-here";
import { HomesHere } from "./homes-here";
import { track } from "@/lib/usage";
import { whenIdle } from "@/lib/shared-fetch";
import { AreaTitle } from "./area-title";
import { DemoNote } from "./area-pages";
import { Sparkline } from "./sparkline";
import { HealthNotes, useAreaHealth } from "./area-health";
import { useTailor } from "./tailor-card";
import { PageTailorChip, usePageTailor } from "./page-tailor";
import { AreaTiles, AreaVerdict, useStandouts } from "./area-standouts";
import { budgetFitRow, PriceTypes } from "./area-price";
import { MarketDetail, MarketSection } from "./market-section";
import { RentTrend, RentTrendSources } from "./rent-trend";
import { ShortLetsSources } from "./short-lets";
import { PeopleNotes, PeopleSection, useAreaPeople } from "./people-section";
import { outstandingCount, SchoolPhaseRows, useAreaSchoolList, type SchoolPhase } from "./area-school-rows";
import { AmenityGroups, Parks } from "./places-section";
import { FOOD_HYGIENE_METHOD, useFoodHygiene } from "./food-hygiene";
import { KIDS_METHOD, useAreaKids } from "./kids-tiles";
import { STATION_WALK_METHOD } from "./station-access";
import { useAreaNoise, type AreaNoise } from "./area-noise";
import { NatureNotes, useAreaNature, type AreaNature } from "./area-nature";
import { AreaLocationSection, useAreaLocation } from "./area-location";
import { HomeSources, useAreaHome } from "./area-home";
import { AreaMobile, MobileSources } from "./area-mobile";
import { HmoBlock, HmoSources, useAreaHmo } from "./hmo";
import { PlanningContextSection } from "./planning-context";
import { NearbySalesSection } from "./nearby-sales";
import { RateRowList } from "./share-rows";
import { isRow, KeyNumbers, SectionFrame, type KeyRow, type MaybeRow } from "./area-section-frame";
import { nearestRows, tripRows } from "./your-places";
import { HELP } from "@/lib/help-texts";
import { scopeName } from "@/lib/scope-name";
import { SiteHeader } from "@/components/site-header";
import { OpenOnPrint } from "@/app/area/[carrier]/[code]/pack/open-on-print";

const PRICE_METRIC: MetricId = "price-per-square-metre";
/** The full page has no connection banner of its own: a lost connection reads as "Evidence cannot load". */
const IGNORE_CONNECTION = () => undefined;
/** Sections only: the header and tiles above the chips are the overview. */
const SECTION_TABS = AREA_CARDS.filter((card) => card.id !== "overview");

export interface AreaFullPageProps {
  geographyId: GeographyId;
  mode: DataMode;
  release: string;
  /** The newest price period the deployment serves. */
  period: string;
  /** Server-rendered name and friendly fields, for the first paint. */
  officialName: string | null;
  friendly: FriendlyAreaFields;
  /** The home chosen on the map, when the link carried one. */
  uprn: string | null;
  addressId: AddressId | null;
  /** The chosen home's tenure from its property record (null: unknown). */
  tenure: string | null;
  /** London › borough › this area, for the page's breadcrumbs and What's next › Up (the map sheet has none). */
  crumbs?: readonly Crumb[];
  /** Open on map, for What's next › Nearby. */
  mapHref?: string;
  /** The verdict, tags and 12 tiles read on the server, so the first paint (and crawlers) get them whole. */
  standouts?: AreaStandouts | null;
}

/**
 * Release metric definitions in real mode (freshness, caveats, periods); a
 * placeholder without source lines until /api/v1/metrics answers (never the
 * fixture's), and the fixture definitions in demo mode.
 */
function useMetricDefinitions(mode: DataMode): (id: MetricId) => MetricDefinition {
  const payload = useSectionJson<{ metrics?: MetricDefinition[] }>(mode === "real" ? METRICS_PATH : null);
  const metrics = useMemo(() => payload?.metrics?.length ? new Map(payload.metrics.map((metric) => [metric.id, metric])) : null, [payload]);
  return useCallback((id: MetricId) => metrics?.get(id) ?? fallbackMetric(id, mode), [metrics, mode]);
}

/** The area's price evidence, as the map sheet and a home page read it: the price metric at `period`, else its newest. */
function useAreaPriceEvidence(geographyId: GeographyId, mode: DataMode, release: string, period: string | null) {
  const metricFor = useMetricDefinitions(mode);
  const metric = useMemo(() => metricFor(PRICE_METRIC), [metricFor]);
  const scope = useMemo(() => createEvidenceRequestScope(), []);
  const read = period ?? metric.defaultPeriod;
  // Real mode before /api/v1/metrics answers: the placeholder has no month yet. Wait for it rather than ask
  // with an empty period (a 400 on every desktop selection, final prod check).
  const outcome = useAreaEvidence(read ? geographyId : null, metric, read, mode, release, scope, IGNORE_CONNECTION);
  return { metricFor, metric, outcome, period: read };
}

/** The map view last saved on this device (where it looked, what coloured it), read after hydration. */
function useSavedMapView() {
  const [view, setView] = useState<ReturnType<typeof savedMapView>>(null);
  useEffect(() => {
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(SAVED_MAP_STATE_KEY); } catch { raw = null; }
    setView(savedMapView(raw));
  }, []);
  return view;
}

/** The household's profile and what it changes on the page (read after hydration, so the server render is the default). */
interface Tailoring {
  profile: PreferenceProfile;
  save: (profile: PreferenceProfile) => void;
  tailor: PageTailor;
  commute: AreaCommute | null;
}

function useTailoring(geographyId: GeographyId): Tailoring {
  const { profile, save } = useTailor();
  const { tailor, commute } = usePageTailor(geographyId, profile);
  return { profile, save, tailor, commute };
}

/** The household's own tags ("Within budget", "Fails: King's Cross 52 min") from the local market and its trip. */
function usePersonalTags(geographyId: GeographyId, mode: DataMode, tailor: PageTailor) {
  const market = useSectionValue(marketPath(geographyId), (payload) => readAreaMarket(payload, mode));
  const ready = market && market !== "unknown" && market.available ? market : null;
  return personalTags(tailor, ready?.byType ?? [], ready?.summary ?? null);
}

/** A tag or tile's link: shows its section under the chips, as the chips do. */
function sectionLink(geographyId: GeographyId, sheet: boolean) {
  return (section: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goToSection(section as AreaCardId, sheet, geographyId, "tile");
  };
}

/**
 * The full page for one neighbourhood: name, borough and a one-line verdict with up to
 * three pros and two cons, one row of actions, the Tailor chip and the 12 fixed tiles; then one sticky
 * chip bar and every section in the one fixed order. Everything is on the page for everyone; the
 * household's profile only reorders and highlights.
 */
export function AreaFullPage(props: AreaFullPageProps) {
  const { geographyId, mode, release, period } = props;
  const metricFor = useMetricDefinitions(mode);
  const metric = useMemo(() => metricFor(PRICE_METRIC), [metricFor]);
  const scope = useMemo(() => createEvidenceRequestScope(), []);
  const outcome = useAreaEvidence(geographyId, metric, period, mode, release, scope, IGNORE_CONNECTION);
  const [, carrier, code] = geographyId.split(":");
  const uprn = officialUprn(props.uprn);
  const map = mapHref(geographyId, { mode, release }, useSavedMapView());
  const officialName = outcome.evidence?.summary.name ?? props.officialName;
  const standouts = useStandouts(geographyId, mode, props.standouts ?? null);
  const tailoring = useTailoring(geographyId);
  const personal = usePersonalTags(geographyId, mode, tailoring.tailor);
  const go = sectionLink(geographyId, false);
  const borough = props.crumbs && props.crumbs.length >= 3 ? props.crumbs[1].label : null;
  const name = friendlyTitle(outcome.evidence ?? props.friendly) ?? officialName ?? "This area";
  return (
    <main className="methodology area-page area-full" data-testid="area-full-page">
      <SiteHeader />
      <header className="area-head">
        <div className="area-head__main">
          <Breadcrumbs crumbs={props.crumbs ?? []} label="Where this area sits" />
          <AreaTitle officialName={officialName}
            fields={outcome.evidence ?? props.friendly} fallback="London neighbourhood" testId="area-page-title" />
          {borough && <p className="area-head__borough" data-testid="area-borough">{borough}</p>}
          <AreaVerdict standouts={standouts} personal={personal} onGo={go} />
        </div>
        <AreaPageActions carrier={carrier} code={code} mode={mode} release={release} name={name} mapHref={map}
          packHref={`/area/${carrier}/${code}/pack`} homeHref={uprn ? propertyPath(uprn) : null} />
      </header>
      <PageTailorChip profile={tailoring.profile} tailor={tailoring.tailor} onSave={tailoring.save} />
      <SavedHomesHere geographyId={geographyId} />
      <DemoNote mode={mode} />
      <AreaTiles standouts={standouts} onGo={go} />
      {/* On paper every section carries its folds open: the ⓘ sources and the folded lists. */}
      <OpenOnPrint selector=".area-full .area-section" />
      {outcome.evidence
        ? <AreaFullBody {...props} mapHref={map} evidence={outcome.evidence} metric={metric} metricFor={metricFor} sheet={false}
          tailoring={tailoring} standouts={standouts} />
        : (
          <>
            {/* The server could not read it (lib/area-page-seed.ts): say so; the browser reads it now. */}
            {outcome.rejection
              ? <UnavailableState {...outcome.rejection} />
              : <p className="area-section__status" role="status" data-testid="area-evidence-loading">Loading this area&apos;s evidence…</p>}
            <AreaSources officialName={officialName} code={code} ranks={null} />
          </>
        )}
    </main>
  );
}

/**
 * The same card in the map sheet at full height: the verdict, tags and tiles, then the sections. It
 * reads the price evidence itself (the map may be showing another layer) and keeps every link on the map.
 */
export function AreaFullCard({ geographyId, mode, release, period, uprn, addressId, friendly, actions = null }: {
  geographyId: GeographyId; mode: DataMode; release: string;
  /** The price period to read; the price metric's newest when null. */
  period: string | null;
  uprn: string | null; addressId: AddressId | null; friendly: FriendlyAreaFields;
  /** The panel's action row (Watch · Compare · Like this), under the verdict as on the area page. */
  actions?: ReactNode;
}) {
  const { metricFor, metric, outcome } = useAreaPriceEvidence(geographyId, mode, release, period);
  const standouts = useStandouts(geographyId, mode);
  const tailoring = useTailoring(geographyId);
  const personal = usePersonalTags(geographyId, mode, tailoring.tailor);
  const go = sectionLink(geographyId, true);
  // The sections' dozen reads wait until the page is idle, so the map's own (its colours, the fit to the
  // area) go first: the desktop side panel shows this card on every selection.
  const [idle, setIdle] = useState(false);
  useEffect(() => whenIdle(() => setIdle(true)), []);
  // The header and tiles have their own read (standouts): they show at once; the sections wait for the price evidence.
  return (
    <>
      <AreaVerdict standouts={standouts} personal={personal} prefix="sheet-" onGo={go} />
      {actions}
      <PageTailorChip profile={tailoring.profile} tailor={tailoring.tailor} onSave={tailoring.save} />
      <AreaTiles standouts={standouts} prefix="sheet-" onGo={go} />
      {outcome.evidence && idle
        ? <AreaFullBody geographyId={geographyId} mode={mode} release={release} period={period ?? metric.defaultPeriod}
          officialName={null} friendly={friendly} uprn={uprn} addressId={addressId} tenure={null}
          evidence={outcome.evidence} metric={metric} metricFor={metricFor} sheet tailoring={tailoring} standouts={standouts} />
        : outcome.rejection
          ? <UnavailableState {...outcome.rejection} />
          : <p className="area-section__status" role="status" data-testid="area-evidence-loading">Loading this area&apos;s evidence…</p>}
    </>
  );
}

/** Tiles a phone sheet shows at its peek (half height), 2 × 2. */
const PEEK_TILES = 4;

/**
 * The map sheet at its peek: the same verdict, tags and tiles as at full height, only the
 * first four tiles. A tag or tile opens the full area page at its section (`href`); none of the sections
 * are in the sheet yet.
 */
export function AreaPeek({ geographyId, mode, href }: {
  geographyId: GeographyId; mode: DataMode;
  /** The full area page at a section. */
  href: (section: string) => string;
}) {
  const router = useRouter();
  const standouts = useStandouts(geographyId, mode);
  const tailoring = useTailoring(geographyId);
  const personal = usePersonalTags(geographyId, mode, tailoring.tailor);
  const go = (section: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    track("section_open", { section, from: "tile", area: geographyId });
    router.push(href(section));
  };
  return (
    <>
      <AreaVerdict standouts={standouts} personal={personal} href={href} onGo={go} />
      <AreaTiles standouts={standouts} limit={PEEK_TILES} href={(tile) => href(tile.section ?? "overview")} onGo={go} />
    </>
  );
}

/** Where a home page's distances start: the home itself (a UPRN), or its postcode's area for a street-level home. */
export type HomeOrigin = { uprn: string } | { postcode: string };

/**
 * The area's sections on a home page (blocks 6–17's area part): the home's LSOA, every section in the one
 * order, without the area's header, verdict or tiles. Distances start at the home when it has a UPRN, else at
 * the area. A read that fails shows "Couldn't load" with a retry in its own section (or in place of all of
 * them when the area itself fails); the rest, and the home's own blocks, still render.
 */
export function AreaSectionsForHome(props: {
  geographyId: GeographyId; mode: DataMode; release: string;
  /** The price period to read; the price metric's newest when null. */
  period: string | null;
  addressId: AddressId | null;
  origin: HomeOrigin;
  /** The standouts read on the server (section headlines and chips), so the first paint has them. */
  standouts?: AreaStandouts | null;
  /** The home's own flood bands and its postcode's homes' worst: they lead the Environment flood row. */
  flood?: HomeFloodContext | null;
}) {
  // Retry remounts the sections: their reads start again, and failed reads are never cached (lib/section-fetch.ts).
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return <HomeAreaBody key={attempt} {...props} retry={retry} />;
}

function HomeAreaBody({ geographyId, mode, release, period, addressId, origin, standouts: initial = null, flood = null, retry }:
  Parameters<typeof AreaSectionsForHome>[0] & { retry: () => void }) {
  const { metricFor, metric, outcome, period: read } = useAreaPriceEvidence(geographyId, mode, release, period);
  const standouts = useStandouts(geographyId, mode, initial);
  const tailoring = useTailoring(geographyId);
  if (!outcome.evidence) {
    return outcome.rejection
      ? (
        <>
          <UnavailableState heading={outcome.rejection.heading} detail={outcome.rejection.detail} guidance={outcome.rejection.guidance} />
          <button type="button" className="text-button" onClick={retry} data-testid="area-evidence-retry">Retry</button>
        </>
      )
      : <p className="area-section__status" role="status" data-testid="area-evidence-loading">Loading this area&apos;s evidence…</p>;
  }
  return (
    <AreaFullBody geographyId={geographyId} mode={mode} release={release} period={read}
      officialName={null} friendly={outcome.evidence} uprn={"uprn" in origin ? origin.uprn : null} addressId={addressId} tenure={null}
      evidence={outcome.evidence} metric={metric} metricFor={metricFor} sheet={false} homePage retry={retry}
      tailoring={tailoring} standouts={standouts} homeFlood={flood} />
  );
}

/** Links only: the area's official ONS record and every source behind the London ranks; a section's own sources sit behind its ⓘ. */
function AreaSources({ officialName, code, ranks, sheet = false, plainName = null }: {
  officialName: string | null | undefined; code: string; ranks: AreaLondonRanks | null; sheet?: boolean;
  /** A home page: the area's own name on the ONS link, no official name or code. */
  plainName?: string | null;
}) {
  const rankSources = ranks?.sources ?? [];
  const id = sheet ? "sheet-area-sources" : "area-sources";
  return (
    <footer className="area-full__sources" id={id} data-testid="area-sources" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Sources</h2>
      <ul className="area-full__rank-sources" data-testid="area-rank-sources" aria-label="Sources">
        <li data-testid="area-official-name">
          <a href={`https://statistics.data.gov.uk/id/statistical-geography/${code}`} target="_blank" rel="noreferrer">
            {plainName ? `${plainName}: ONS area record` : officialName ? `${officialName} (${code}) · ONS` : `${code} · ONS`}
          </a>
        </li>
        {rankSources.map((source) => (
          <li key={source.id}>
            {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.attribution}</a> : source.attribution}
            {source.licence ? ` · ${source.licence}` : ""}
          </li>
        ))}
      </ul>
    </footer>
  );
}

/** A section's element id: plain on /area (#safety), prefixed in the map sheet so it never clashes with the map's own. */
function sectionDomId(id: AreaCardId, sheet: boolean): string {
  return sheet ? `sheet-${id}` : id;
}

/** Records the section in the address (on /area) and shows it under the sticky chips. */
function goToSection(id: AreaCardId, sheet: boolean, geographyId: GeographyId, from: "tab" | "tile" | "link") {
  if (!sheet) window.history.replaceState(null, "", `#${id}`);
  track("section_open", { section: id, from, area: geographyId });
  showSection(id, sheet);
}

/** Scrolls a section to the top (under the sticky tab chips) and moves focus to its heading. */
function showSection(id: AreaCardId, sheet: boolean, smooth = true) {
  const section = document.getElementById(sectionDomId(id, sheet));
  if (!section) return;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  section.scrollIntoView({ block: "start", behavior: smooth && !still ? "smooth" : "auto" });
  section.querySelector<HTMLElement>(".area-section__title")?.focus({ preventScroll: true });
  holdSection(section);
}

/**
 * Sections above may still be loading and grow: for a moment, keep the shown
 * section at the top as they do, until the reader scrolls or presses a key.
 */
let releaseHold: (() => void) | null = null;

function holdSection(section: HTMLElement) {
  releaseHold?.();
  const body = section.parentElement;
  if (!body || typeof ResizeObserver === "undefined") return;
  let top = section.getBoundingClientRect().top;
  const observer = new ResizeObserver(() => {
    const now = section.getBoundingClientRect().top;
    if (Math.abs(now - top) > 2) section.scrollIntoView({ block: "start", behavior: "auto" });
    top = section.getBoundingClientRect().top;
  });
  let held = true;
  const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  const stop = () => {
    held = false;
    observer.disconnect();
    for (const event of inputs) window.removeEventListener(event, stop);
    if (releaseHold === stop) releaseHold = null;
  };
  releaseHold = stop;
  for (const event of inputs) window.addEventListener(event, stop, { passive: true });
  // Once the first (possibly smooth) scroll has settled, land it again (content above may have grown
  // while it ran), then hold the section's place.
  window.setTimeout(() => {
    if (!held) return;
    section.scrollIntoView({ block: "start", behavior: "auto" });
    top = section.getBoundingClientRect().top;
    observer.observe(body);
  }, 700);
  window.setTimeout(stop, 3000);
}

/** A headline rate: "3,916.8", "54" (at most one decimal, thousands separated). */
const headRate = (rate: number) => rate.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** A home page's block whose data this area lacks: said, never a 0. */
const NO_DATA = "No data for this area";

/** The title row's parts: the headline figure, London in words, the map layer it opens on. */
interface SectionHead { headline?: ReactNode; chip?: string | null; layer?: string | null }

/**
 * One section, always in the same frame: title row (icon · name · headline · London chip ·
 * On map ↗), at most one chart, at most five rows, then the sources folded behind ⓘ. Nothing folds the
 * content itself, so every word can be selected and copied.
 */
function Section({ id, area, place, sheet, head, about, report, map, failed, children }: {
  id: AreaCardId; area: string; sheet: boolean; head?: SectionHead; about?: ReactNode;
  /** The area's name, for the report form's figure line. */
  place: string;
  /** Its read failed: "Couldn't load" and a retry in place of the body (home pages only). */
  failed?: (() => void) | null;
  /** "Report" in the title row, on /area only (the map panel has its own report; CUJ15 board). */
  report?: { period: string; sourceReleaseId: string; productReleaseId: string | null } | null;
  /** Where "On map ↗" opens the map; null in the map sheet (it is the map). */
  map: ((layer: string) => string) | null;
  children: ReactNode;
}) {
  const { title, icon } = AREA_CARDS.find((entry) => entry.id === id)!;
  // "Safety · 3,916.8 / 1,000 · London 89.2 · St James's": the figure the report is about.
  const figure = [title, typeof head?.headline === "string" ? head.headline : null, place].filter(Boolean).join(" · ");
  return (
    <SectionFrame id={id} domId={sectionDomId(id, sheet)} title={title} icon={icon} headline={head?.headline} chip={head?.chip}
      mapHref={map && head?.layer ? map(head.layer) : null} about={about}
      report={report && (
        <span className="area-section__report">
          <CorrectionSection observationId={`${area}:${id}:${report.period}`} sourceReleaseId={report.sourceReleaseId}
            productReleaseId={report.productReleaseId} label="Report" figure={figure} />
        </span>
      )}>
      {failed
        ? (
          <>
            <p className="area-section__status" role="status" data-testid={`section-failed-${id}`}>Couldn&apos;t load</p>
            <button type="button" className="text-button" onClick={failed}>Retry</button>
          </>
        )
        : children}
    </SectionFrame>
  );
}

/** A tile by id, when the standouts are in and it has a value. */
function tileOf(standouts: AreaStandouts | null | "unknown", id: StandoutTile["id"]): StandoutTile | null {
  const tile = standouts && standouts !== "unknown" ? standouts.tiles.find((entry) => entry.id === id) : null;
  return tile?.available ? tile : null;
}

/** The region in words for an oriented tile: "Safer than 98% of London" style, from its standing. */
function standingWords(tile: StandoutTile | null, better: string, worse: string, scope = "London"): string | null {
  if (!tile || tile.standing === null) return null;
  return tile.standing >= 50 ? `${better} than ${regionShare(tile.standing)}% of ${scope}` : `${worse} than ${regionShare(100 - tile.standing)}% of ${scope}`;
}

/** The households a section reorders for. */
const KIDS = ["kids-under5", "kids-primary", "kids-secondary", "kids-mixed"];

function AreaFullBody({ geographyId, mode, release, uprn, addressId, friendly, evidence, metric, metricFor, sheet, officialName, crumbs, mapHref,
  tailoring, standouts, homePage = false, homeFlood = null, retry }: Omit<AreaFullPageProps, "standouts"> & {
  evidence: AreaResponse; metric: MetricDefinition; metricFor: (id: MetricId) => MetricDefinition;
  /** In the map sheet: section ids are prefixed and the address bar is left alone. */
  sheet: boolean;
  tailoring: Tailoring;
  standouts: AreaStandouts | null | "unknown";
  /** On a home page: a section whose read failed says so with `retry`, and the page has its own What's next. */
  homePage?: boolean;
  /** A home page's own and postcode flood bands (AreaSectionsForHome's `flood`). */
  homeFlood?: HomeFloodContext | null;
  retry?: () => void;
}) {
  const { profile, tailor, commute } = tailoring;
  const home = officialUprn(uprn);
  const { demo: demoHistory } = usePropertyHistory(home, mode);
  const stock = useHomeSummary(home);
  const address = useAddressHistory(addressId);
  const health = useDataHealth();
  const area = useAreaFacts({ evidence, metric, mode, release, uprn: home, bedrooms: tailor.bedrooms });
  const { summary } = evidence;
  // Area topics read the evidence's own carrier (a fallback area answers for its parent), as the map did;
  // the market and the home's sales keep the neighbourhood itself.
  const areaId = summary.geographyId;
  const [, carrier, code] = geographyId.split(":");
  const display = priceDisplay(summary, metric, "sqm");
  const market = useSectionValue(marketPath(geographyId), (payload) => readAreaMarket(payload, mode));
  const depth = useSectionValue(marketDepthPath(geographyId), (payload) => readMarketDepth(payload, mode));
  const civic = useSectionValue(civicPath({ geographyId: areaId }), (payload) => {
    const state = readCivic(payload, mode);
    return state.status === "available" ? state.civic : null;
  });
  const safety = useSectionValue(geographyId.startsWith("uk:lsoa:") ? areaSafetyPath(geographyId) : "", (payload) => readAreaSafety(payload, mode));
  const rents = useSectionValue(rentsPath(areaId), (payload) => readAreaRents(payload, mode));
  const typicalPrice = homeCost(area.price?.value ?? null, area.homeSize);
  const ranks = area.facts.regionRanks ?? null;
  const noise = useAreaNoise(areaId, home);
  const nature = useAreaNature(areaId, home);
  const homeTheme = useAreaHome(areaId, mode);
  const hmo = useAreaHmo(areaId, mode);
  const location = useAreaLocation(areaId, mode);
  const food = useFoodHygiene(areaId);
  const healthLayers = useAreaHealth(areaId, mode);
  const kids = useAreaKids(areaId);
  const schools = useAreaSchoolList(areaId);
  const people = useAreaPeople(areaId, mode);
  const withKids = KIDS.includes(tailor.household ?? "");

  // A #section in the address (a tile link from the map, a shared link) shows that section once the card is in.
  useEffect(() => {
    if (sheet) return;
    const fromHash = () => {
      const id = cardFromHash(window.location.hash);
      if (!id) return;
      track("section_open", { section: id, from: "link" });
      requestAnimationFrame(() => showSection(id, false, false));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [sheet]);

  const recent = useSectionValue(recentSalesPath(geographyId, 1, "nearest"), (payload) => readRecentSales(payload, mode));
  const homesPostcode = recent && recent !== "unknown" ? recent.sales.find((sale) => sale.postcode)?.postcode ?? null : null;
  const report = sheet ? null : {
    period: summary.period, sourceReleaseId: summary.sourceVersion,
    productReleaseId: evidence.productReleaseId ?? health?.productReleaseId ?? null,
  };
  const layerHref = sheet ? null : (layer: string) => `/?${new URLSearchParams({ selected: geographyId, layer, mode, release }).toString()}`;
  const section = (id: AreaCardId) => ({ id, area: areaId, place: name, sheet, report, map: layerHref, failed: failedIf(reads[id] ?? []) });
  const ready = <T,>(value: T | null | "unknown"): T | null => (value && value !== "unknown" ? value : null);
  const marketReady = ready(market);
  const marketLive = marketReady?.available ? marketReady : null;
  const name = friendlyTitle(friendly ?? evidence)?.split(" · ")[0] ?? "This area";
  const priceTile = tileOf(standouts, "price");
  // What every "of London" compares with: the area's region (API rankScope, from the tiles or the area's own read; London when absent).
  const scope = scopeName(standouts, evidence);
  const placesData = area.places?.status === "available" ? area.places.places : null;
  const kidsData = kids && kids !== "unavailable" && kids.available ? kids : null;
  const schoolList = schools && schools !== "unavailable" ? schools : null;
  const phase: SchoolPhase = tailor.household === "kids-secondary" ? "secondary" : "primary";
  const under5 = tailor.household === "kids-under5";
  const nurseries = <KeyNumbers testId="schools-key-numbers" rows={[nurseryRow(kidsData, under5)]} />;
  // On a home page, each section's own reads decide its "Couldn't load" (a 404 is "not here", never a failure).
  const readFailed = useFailedReads();
  const failedIf = (urls: readonly (string | null)[]) => (homePage && retry && readFailed(urls) ? retry : null);
  const places = placesPath({ selected: areaId, uprn: home, mode, release });
  const priceKeyRows = priceRows(display.value, ready(depth), marketLive, tailor, evidence.priceTimeline);
  const roadMissing = homePage && kids !== null && !kidsData?.roadSafety;
  /** The URLs each section reads (the same ones its hooks ask for; lib/section-seed.ts builds the seed from them). */
  const reads: Partial<Record<AreaCardId, readonly (string | null)[]>> = {
    price: [marketPath(geographyId), marketDepthPath(geographyId)],
    "getting-around": [places],
    // Road casualties come with the kids read.
    safety: [geographyId.startsWith("uk:lsoa:") ? areaSafetyPath(geographyId) : null, kidsPath(areaId)],
    schools: [areaSchoolsPath(areaId), kidsPath(areaId)],
    "local-places": [places],
    environment: [noisePath(areaId, home), naturePath(areaId, home), floodPath(areaId, home)],
    health: [healthPath(areaId)],
    homes: [areaPeoplePath(areaId), homePath(areaId), locationPath(areaId)],
    people: [areaPeoplePath(areaId)],
    "living-costs": [civicPath({ geographyId: areaId }), rentsPath(areaId), locationPath(areaId)],
  };

  return (
    <div className="area-card-body" data-sheet={sheet ? "" : undefined}>
      <FreshnessWarning health={health} />
      <SectionTabs sections={SECTION_TABS} prefix={sheet ? "sheet-" : ""} scrollRoot={sheet ? ".dock-area" : null}
        onGo={(id) => goToSection(id as AreaCardId, sheet, geographyId, "tab")} />

      <Section {...section("price")}
        head={{
          headline: display.value === null ? null : `£${roundPricePerSquareMetre(display.value).toLocaleString("en-GB")}/m²`,
          chip: priceChip(priceTile?.regionPercentile ?? area.facts.price?.regionPercentile ?? null, scope),
          layer: "price-per-square-metre",
        }}
        about={<MetricSources metrics={[metric]} extra={<><PriceNotes summary={summary} market={market} /><RentTrendSources geographyId={geographyId} mode={mode} /><ShortLetsSources geographyId={geographyId} mode={mode} /></>} />}>
        {market === null && <p className="area-section__status">Loading prices…</p>}
        {market !== null && !marketLive && <p className="area-section__status" data-testid="price-types-unknown">Too few recent sales to show prices by type.</p>}
        {/* A home page shows each type once, in its table and spread (MarketDetail), not as the card's bands too. */}
        {marketLive && !homePage && <PriceTypes market={marketLive} tailor={tailor} />}
        {priceKeyRows.length > 0 && <div data-testid="market-summary"><KeyNumbers testId="price-key-numbers" rows={priceKeyRows} /></div>}
        <RentTrend geographyId={geographyId} mode={mode} bedrooms={tailor.bedrooms} />
        {homePage && marketLive && <MarketDetail market={marketLive} />}
        {stock && <LastSaleSection property={stock} />}
        {demoHistory && <PropertySection history={demoHistory} />}
        {address && <AddressSection history={address} />}
        {addressId && <NearbySalesSection addressId={addressId} />}
        <div data-testid="recent-sales"><MarketSection geographyId={geographyId} mode={mode} part="sales" inCard /></div>
        <HomesHere geographyId={geographyId} from="area_page" outcodes={friendly?.postcodeDistrict ? [friendly.postcodeDistrict] : []}
          profile={isUnsetProfile(profile) ? null : profile} />
      </Section>

      <Section {...section("getting-around")} about={<><p>{STATION_WALK_METHOD}</p><PlacesNotes places={area.places} /><p>Powered by TfL Open Data.</p></>}
        head={{
          headline: placesData?.stations[0] ? `about ${stationWalkMinutes(placesData.stations[0].distanceMetres)} min to ${placesData.stations[0].name}` : tileOf(standouts, "station-walk")?.display ?? null,
          // London in words, as every other section's chip (no x/10 in the area view).
          chip: standingWords(tileOf(standouts, "station-walk"), "Shorter walk", "Longer walk", scope),
          layer: "station-access",
        }}>
        <KeyNumbers testId="getting-around-key-numbers" rows={transportRows(area.places, tileOf(standouts, "station-walk"), tileOf(standouts, "cycling"), kidsData, profile, commute, scope)} />
        {tailor.place === null && !sheet && <Link className="area-section__more" href="/?layer=personal-match" data-testid="pin-a-place">Pin a place <span aria-hidden="true">→</span></Link>}
      </Section>

      <Section {...section("safety")}
        head={{
          // r3 #8 (CUJ15 board): the rate beside London's, both with thousands separators.
          headline: safety && safety !== "unknown" && safety.rate !== null
            ? `${headRate(safety.rate)} / 1,000${safety.regionRate != null ? ` · ${safetyScope(safety)} ${headRate(safety.regionRate)}` : ""}` : null,
          chip: tileOf(standouts, "safety") ? `${tileOf(standouts, "safety")!.display} of ${scope}` : null,
          layer: "crime",
        }}
        about={<SafetyNotes facts={area.facts} metric={metricFor("crime")} safety={ready(safety)} />}>
        <div data-testid="crime-categories">
          <SafetyBody safety={safety} name={name} metric={metricFor("crime")} geographyId={areaId} mode={mode} release={release} scope={scope} />
        </div>
        <KeyNumbers testId="safety-key-numbers" rows={safetyRows(ready(safety), kidsData, withKids, roadMissing, layerHref && withCollisionsOn(layerHref("crime")))} />
      </Section>

      <Section {...section("schools")} about={<SchoolNotes scope={scope} />}
        head={{
          headline: schoolList ? `${schoolList.length} within 1.5 km${outstandingCount(schoolList) ? ` · ${outstandingCount(schoolList)} Outstanding` : ""}` : null,
          chip: schoolChip(tileOf(standouts, "schools"), scope),
          layer: null,
        }}>
        {/* With children under 5 the nurseries come first (lit); otherwise after the schools. */}
        {under5 && nurseries}
        {schools === null && <p className="area-section__status">Loading schools…</p>}
        {schools === "unavailable" && <p className="area-section__status">School evidence is unavailable for this area.</p>}
        {schoolList && <div data-testid="schools-list"><SchoolPhaseRows schools={schoolList} geographyId={areaId} first={phase} rows={homePage ? 16 : undefined} /></div>}
        {!under5 && nurseries}
      </Section>

      <Section {...section("local-places")} about={<><p>{HELP["places-amenities"].short}</p><p>{FOOD_HYGIENE_METHOD}</p><PlacesNotes places={area.places} /></>}
        head={{ headline: localHeadline(area.places), chip: standingWords(tileOf(standouts, "food-hygiene"), "Food hygiene better", "Food hygiene worse", scope), layer: "food-hygiene" }}>
        {/* CUJ13: the household's own places first ("▸ Gym GYMPODS Dalston · 5 min walk"), then the essentials
            without the kinds they already answer, so the nearest gym is said once. */}
        <KeyNumbers testId="your-places-key-numbers" rows={nearestRows(profile, commute)} />
        <Essentials places={area.places} health={ready(healthLayers)} skip={ownEssentials(profile, commute)} />
        <KeyNumbers testId="local-places-key-numbers" rows={localRows(area.places, food, standouts, scope)} />
        {homePage && placesData && <AmenityGroups places={placesData} />}
        {homePage && placesData && <div data-testid="parks-list"><Parks places={placesData} /></div>}
        {homePage && area.places?.status === "unavailable" && (
          <KeyNumbers testId="local-places-missing" rows={[
            { term: "Everyday places", value: NO_DATA, valueTestId: "amenities-list" },
            { term: "Parks", value: NO_DATA, valueTestId: "parks-list" },
          ]} />
        )}
        <Link className="area-section__more" href={`/area/${carrier}/${code}/places`} data-testid="all-places">All places <span aria-hidden="true">→</span></Link>
      </Section>

      <Section {...section("environment")} about={<><EnvironmentNotes flood={area.flood} noise={noise} places={area.places} scope={scope} /><NatureNotes nature={nature} scope={scope} /></>}
        head={{
          headline: tileOf(standouts, "nature")?.display ?? null,
          chip: standingWords(tileOf(standouts, "noise"), "Quieter", "Noisier", scope),
          layer: "nature-score",
        }}>
        <KeyNumbers testId="environment-key-numbers" rows={environmentRows(nature, area.flood, noise, homePage, homeFlood, scope)} />
      </Section>

      <Section {...section("health")} about={<HealthNotes health={healthLayers} />}
        head={{ ...healthHead(ready(healthLayers), tileOf(standouts, "gp")), layer: null }}>
        {healthLayers === null && <p className="area-section__status">Loading…</p>}
        {healthLayers === "unknown" && !homePage && <p className="area-section__status" data-testid="health-unavailable">Air, heat and GP figures are not loaded for this area.</p>}
        <KeyNumbers testId="health-key-numbers" rows={healthRows(ready(healthLayers), homePage && healthLayers === "unknown", scope)} />
      </Section>

      <Section {...section("homes")}
        head={{ headline: homesHeadline(people, tailor), layer: homesLayer(people, tailor) }}
        about={<><PeopleNotes geographyId={areaId} mode={mode} part="homes" /><HomeSources home={homeTheme} /><MobileSources geographyId={areaId} mode={mode} /><HmoSources hmo={hmo} /></>}>
        <div data-testid="homes-census"><PeopleSection geographyId={areaId} mode={mode} part="homes" name={name} types={tailor.types} /></div>
        <KeyNumbers testId="homes-key-numbers" rows={homeRows(ready(homeTheme), ready(location), homePage && homeTheme !== null, scope)} />
        <AreaMobile geographyId={areaId} mode={mode} scope={scope} />
        <HmoBlock hmo={hmo} />
      </Section>

      <Section {...section("people")} head={{ headline: "Census 2021", layer: null }}
        about={(
          <>
            <PeopleNotes geographyId={areaId} mode={mode} part="people" />
            <p>Deprivation is the official Index of Multiple Deprivation for the area, not its people.</p>
          </>
        )}>
        <div data-testid="people-census">
          <PeopleSection geographyId={areaId} mode={mode} part="people" name={name}
            facts={[deprivationWords(area.facts.deprivation?.regionPercentile ?? null, scope)].filter((fact): fact is string => fact !== null)} />
        </div>
      </Section>

      <Section {...section("living-costs")} head={livingHead(civic)}
        about={civic && civic !== "unknown" ? <>{civic.sources.map((entry) => <p key={entry.id}>{entry.attribution}</p>)}{ready(rents)?.attribution && <p>{ready(rents)!.attribution}</p>}</> : undefined}>
        <LivingCosts civic={civic} areaId={areaId} homePage={homePage}
          rows={livingRows(ready(location), ready(rents), tailor, homePage && rents !== null)} />
      </Section>

      {!sheet && !homePage && (
        <WhatsNext columns={{
          up: upLinks(crumbs ?? []),
          inside: [
            homesPostcode
              ? { label: `Homes in ${homesPostcode}`, href: postcodeHomesPath(homesPostcode), testId: "next-homes" }
              : { label: "Homes", href: "#homes", testId: "next-homes" },
            { label: "Schools", href: "#schools" },
            { label: "Places", href: `/area/${carrier}/${code}/places` },
          ],
          nearby: [
            // The one "Like this" on the page (My match, starting from this area).
            { label: "Like this", href: findLikeHref(geographyId), testId: "next-like-this", reload: true },
            mapHref ? { label: "On map", href: mapHref, reload: true } : null,
            { label: "Rankings", href: "/rankings" },
          ],
          act: [{ label: "Check a home", href: checkFor(geographyId, home, typicalPrice, area.homeSize, profile), testId: "footer-check-home" }],
        }} />
      )}
      <AreaFooter sheet={sheet} geographyId={geographyId} areaId={areaId} mode={mode} uprn={home}
        price={typicalPrice} size={area.homeSize} profile={profile} packHref={`/area/${carrier}/${code}/pack`} />
      {/* A home page names its area as people do, never by its code. */}
      <AreaSources officialName={officialName ?? summary.name} code={code} ranks={ranks} sheet={sheet} plainName={homePage ? name : null} />
    </div>
  );
}

/**
 * The card's footer: big links to what lives elsewhere: the home's tools,
 * the evidence pack, planning (folded here) and the sources.
 */
function AreaFooter({ sheet, geographyId, areaId, mode, uprn, price, size, profile, packHref }: {
  sheet: boolean; geographyId: GeographyId; areaId: GeographyId; mode: DataMode;
  uprn: string | null; price: number | null; size: number; profile: PreferenceProfile; packHref: string;
}) {
  const [planning, setPlanning] = useState(false);
  useEffect(() => {
    if (sheet) return;
    const fromHash = () => { if (window.location.hash === "#planning") setPlanning(true); };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [sheet]);
  const check = checkFor(geographyId, uprn, price, size, profile);
  const toSources = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(sheet ? "sheet-area-sources" : "area-sources")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <nav className="area-footer" aria-label="More for this area" data-testid="area-footer">
      {/* On /area this sits in What's next. Like this is the map card's own. */}
      {sheet && <Link className="area-footer__link" href={check} data-testid="footer-check-home">Check a home <span aria-hidden="true">→</span></Link>}
      {geographyId.startsWith("uk:lsoa:") && (
        <Link className="area-footer__link" href={packHref} data-testid="footer-pack">Evidence pack <span aria-hidden="true">→</span></Link>
      )}
      <details className="area-footer__planning" id={sheet ? "sheet-planning" : "planning"} data-testid="footer-planning"
        open={planning} onToggle={(event) => setPlanning(event.currentTarget.open)}>
        <summary className="area-footer__link">Planning applications</summary>
        {planning && (mode === "real" ? <AreaLocationSection geographyId={areaId} /> : <PlanningContextSection selected={areaId} />)}
      </details>
      <a className="area-footer__link" href={sheet ? "#sheet-area-sources" : "#area-sources"} onClick={toSources} data-testid="footer-sources">Sources</a>
    </nav>
  );
}

/**
 * Check a home for this area (and the home the map chose): from the My match budget when the household
 * set one to buy (one price carried across), else from the area's typical home's price.
 */
function checkFor(geographyId: GeographyId, uprn: string | null, price: number | null, size: number, profile: PreferenceProfile): string {
  const area = geographyId.startsWith("uk:lsoa:") ? geographyId : null;
  const budget = searchBudgetPrefill(profile);
  return checkHomeHref(budget ? { area, uprn, ...budget } : {
    area, uprn, price, from: price === null ? null : `the area's typical ${size} m² home`,
  });
}

/** Price is neutral (dearer is not worse): the region in plain words; no chip without a rank. */
function priceChip(percentile: number | null, scope = "London"): string | null {
  if (percentile === null) return null;
  return percentile >= 50 ? `Pricier than ${regionShare(percentile)}% of ${scope}` : `Cheaper than ${regionShare(100 - percentile)}% of ${scope}`;
}

const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;

/**
 * Price rows (at most five, plus the household's budget fit on top): resale £/m² over 36 months, the
 * 1- and 5-year change, sales and turnover, leasehold and new-build, and all homes. Area figures only.
 */
function priceRows(perSquareMetre: number | null, depth: MarketDepth | null, market: AreaMarketResponse | null, tailor: PageTailor,
  timeline: AreaSummary[]): KeyRow[] {
  const live = depth?.available ? depth : null;
  const growth = live?.growth ?? null;
  const fit = market ? budgetFitRow(market, tailor) : null;
  const all = market?.summary ?? null;
  const yearAgo = timeline.length > 12 ? timeline.at(-13)?.value ?? null : null;
  const changes = growth
    ? [growth.growth1y !== null && `1 y ${signed(growth.growth1y)}`, growth.growth5y !== null && `5 y ${signed(growth.growth5y)}`].filter(Boolean).join(" · ")
    : perSquareMetre !== null && yearAgo ? `1 y ${signed((perSquareMetre / yearAgo - 1) * 100)}` : "";
  const resale = live?.resale?.medianPricePerSquareMetre ?? null;
  const rows: MaybeRow[] = [
    fit && { ...fit, mine: true, testId: "price-budget-fit" },
    resale !== null && {
      term: "Resale £/m²", testId: "price-per-sqm",
      value: `£${roundPricePerSquareMetre(resale).toLocaleString("en-GB")} (£${Math.round(perSquareFoot(resale)!).toLocaleString("en-GB")}/sq ft) · ${live!.resale!.sampleSize} sales, ${live!.priceWindowMonths} mo`,
    },
    changes && { term: "Change", value: changes, testId: "price-change" },
    live && live.dwellingsSold !== null && live.dwellings !== null && {
      term: "Sales & turnover", testId: "price-turnover",
      value: `${live.dwellingsSold} of ${live.dwellings.toLocaleString("en-GB")} recorded homes in ${live.salesWindowMonths} mo${live.turnoverPercent === null ? "" : ` · ${live.turnoverPercent.toFixed(1)}%`}`,
    },
    live && {
      term: "Leasehold · new-build", testId: "price-leasehold",
      value: `${live.leaseholdShareOfSales === null ? "—" : `${Math.round(live.leaseholdShareOfSales * 100)}%`} · ${live.newBuildPremiumPercent === null ? "—" : `${signed(live.newBuildPremiumPercent)} premium`}`,
    },
    all?.medianPrice != null && {
      term: "All homes", testId: "market-median",
      value: `${formatPoundsShort(all.medianPrice)} median · ${all.sales.toLocaleString("en-GB")} sales${all.p25 != null && all.p75 != null ? ` · middle half ${formatPoundsShort(all.p25)}–${formatPoundsShort(all.p75)}` : ""}${market?.basis?.widened ? ` · ${isCodeName(market.basis.name) ? "wider area" : market.basis.name}` : ""}`,
    },
  ];
  return rows.filter(isRow);
}

/**
 * Getting around: the nearest stations as rows (walk · zone · lines; no bars), the household's pinned
 * places first (door to door, TfL), connectivity and cycle lanes.
 */
function transportRows(places: AreaPlacesState | null, walk: StandoutTile | null, cycling: StandoutTile | null,
  kids: { cycling: { protectedKm: number; cyclewayKm: number } | null } | null, profile: PreferenceProfile, commute: AreaCommute | null, scope = "London"): KeyRow[] {
  const data = places?.status === "available" ? places.places : null;
  const lanes = kids?.cycling ? kids.cycling.protectedKm + kids.cycling.cyclewayKm : null;
  const rows: MaybeRow[] = [
    ...tripRows(profile, commute),
    walk && { term: "Typical walk from homes", testId: "station-walk", value: `${walk.display} to a station${walk.standing !== null ? ` · shorter than ${regionShare(walk.standing)}% of ${scope}` : ""}` },
    ...(data?.stations.slice(0, 3) ?? []).map((station) => ({
      term: station.name, testId: "station-row", valueTestId: "stations-list",
      value: [`about ${stationWalkMinutes(station.distanceMetres)} min walk`, zoneLabel(station), lineNames(station).join(", ")].filter(Boolean).join(" · "),
    })),
    (lanes !== null || cycling) && {
      term: "Cycle lanes ≤ 1 km", testId: "cycle-lanes",
      // None at all ties with much of London: no "more than n%" for nothing.
      value: [lanes !== null ? `${lanes > 0 ? lanes.toFixed(1) : "0"} km protected` : cycling!.display,
        cycling?.standing != null && (lanes ?? cycling.value ?? 0) > 0 ? `more than ${regionShare(cycling.standing)}% of ${scope}` : null].filter(Boolean).join(" · "),
    },
    places?.status === "unavailable" && { term: "Stations", value: "Unknown for this area" },
  ];
  return rows.filter(isRow);
}

/** Offence types against the region (no rank of their own), then the line only when crime moved 15% or more. */
function SafetyBody({ safety, name, metric, geographyId, mode, release, scope }: {
  safety: AreaSafety | null | "unknown"; name: string; metric: MetricDefinition; geographyId: GeographyId; mode: DataMode; release: string; scope: string;
}) {
  if (safety === null) return <p className="area-section__status">Loading…</p>;
  if (safety === "unknown" || !safety.available) return <p className="area-section__status">Crime figures are unknown for this area.</p>;
  // Each row shows London's own rate (▲ / ▼ when it differs by a quarter or more), never only the gap.
  const rows = safety.types.map((type) => ({
    id: type.category, label: offenceLabel(type.category), value: type.rate, london: type.regionRate,
    display: type.rate === null ? "unknown" : perThousand(type.rate), chip: londonRateChip(type.rate, type.regionRate, safetyScope(safety)),
  }));
  return (
    <>
      {rows.length > 0 && (
        <div className="safety-types" data-testid="safety-types">
          <p className="share-legend"><span className="share-legend__item">Top offences per 1,000 a year · {name}</span>
            <span className="share-legend__item"><span className="share-legend__tick" aria-hidden="true" />{scope}</span></p>
          <RateRowList rows={rows} colour="var(--chart-1)" label="Top offences per 1,000 residents a year" />
        </div>
      )}
      {safety.trend && !safety.trend.stable && !isPlaceholderMetric(metric) && (
        <MetricHistory geographyId={geographyId} metric={metric} mode={mode} release={release} />
      )}
    </>
  );
}

/** Trend, road casualties (first and lit for a household with children), who was hurt and the period. */
function safetyRows(safety: AreaSafety | null, kids: { roadSafety: { casualties: number; children: number; seriousOrFatal: number; pedestrians: number; cyclists: number; byYear: { year: number; count: number }[] } | null } | null,
  withKids: boolean, roadMissing = false, collisionsHref: string | null = null): KeyRow[] {
  const road = kids?.roadSafety ?? null;
  const stable = stableWords(safety?.trend ?? null);
  const years = road?.byYear.length ?? 5;
  const byYear = road?.byYear.length ? [...road.byYear].sort((a, b) => a.year - b.year) : [];
  const rows: MaybeRow[] = [
    stable && { term: "Trend", value: stable, testId: "crime-stable" },
    safety?.trend && !safety.trend.stable && safety.trend.changePercent !== null && {
      term: "Trend", value: `${signed(safety.trend.changePercent)} over ${spanWords(safety.trend.months)}`, testId: "crime-trend",
    },
    road && {
      term: "Road casualties ≤ 500 m", mine: withKids, testId: "road-casualties", valueTestId: "road-safety",
      value: (
        <>
          {`${road.casualties} in ${years} years · ${road.children} ${road.children === 1 ? "child" : "children"} · ${road.seriousOrFatal} serious or fatal`}
          {collisionsHref && <>{" · "}<Link href={collisionsHref} data-testid="road-safety-map">On map</Link></>}
        </>
      ),
    },
    roadMissing && { term: "Road casualties ≤ 500 m", value: NO_DATA, valueTestId: "road-safety" },
    road && { term: "Who was hurt", value: `${road.pedestrians} pedestrians · ${road.cyclists} cyclists` },
    byYear.length > 1 && {
      term: "Per year", testId: "road-casualties-years",
      value: `${byYear.map((entry) => entry.count).join(" · ")} (${byYear[0].year}–${byYear.at(-1)!.year})`,
    },
    safety?.period && { term: "Period", value: `12 months to ${formatMonth(safety.period)}` },
  ];
  return rows.filter(isRow);
}

/** Schools rank by the best nearby school's results among the region's; no chip without a rank. */
function schoolChip(tile: StandoutTile | null, scope = "London"): string | null {
  if (!tile || tile.standing === null) return null;
  return `Best nearby: top ${Math.max(1, 100 - tile.standing)}% of ${scope}`;
}

/** "2 well rated: Little Angels 665 m · Bright Start 783 m" (first and lit for a household with under-5s). */
function nurseryRow(kids: { nurseries: { wellRated: number; nearest: { name: string; wellRated: boolean; distanceMetres: number }[] } | null } | null, under5: boolean): KeyRow | null {
  const nurseries = kids?.nurseries;
  if (!nurseries) return null;
  const named = nurseries.nearest.filter((entry) => entry.wellRated).slice(0, 2)
    .map((entry) => `${entry.name} ${entry.distanceMetres < 1000 ? `${entry.distanceMetres} m` : `${(entry.distanceMetres / 1000).toFixed(1)} km`}`);
  return { term: "Nurseries ≤ 1 km", mine: under5, testId: "nurseries",
    value: `${nurseries.wellRated} well rated${named.length ? `: ${named.join(" · ")}` : ""}` };
}

/** Where the station figures come from: straight-line distances, the places' caveats and licences. */
function PlacesNotes({ places }: { places: AreaPlacesState | null }) {
  if (places?.status !== "available") return null;
  const data = places.places;
  return (
    <>
      <p>Straight-line distances from {data.origin.kind === "home" ? "this home" : "the middle of the area"}.</p>
      {data.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
      {data.sources.map((source) => <p key={source.id}>{source.attribution}</p>)}
    </>
  );
}

/** The crime figure's method: its metric source, the busy-centre note and where crime is counted. */
function SafetyNotes({ facts, metric, safety }: { facts: AreaFacts; metric: MetricDefinition; safety: AreaSafety | null }) {
  return (
    <>
      {busyCentre(facts.crime) && <p data-testid="crime-busy-centre">{BUSY_CENTRE_NOTE}.</p>}
      {(safety?.caveats ?? ["Crime is counted where it happens, so busy shopping and night-life streets score high."]).map((caveat) => <p key={caveat}>{caveat}</p>)}
      {safety?.source && <p>{safety.source.attribution}</p>}
      <p>Road casualties: Department for Transport, Road Safety Data (STATS19), OGL v3.0. Many slight injuries are never reported to the police.</p>
      <MetricSources metrics={[metric]} />
    </>
  );
}

/** How the schools are chosen and compared: never a catchment, never a merged Ofsted grade. */
function SchoolNotes({ scope }: { scope: string }) {
  return (
    <>
      <p>State schools within 1.5 km, nearest first, by straight-line distance. Not a catchment: being close does not guarantee a place.</p>
      <p>Top 10%: the school is in the top tenth of {scope}&apos;s schools on its latest published results and rated Good or better.</p>
      <p>Older Ofsted grades and the new report cards are not comparable; each badge says which it is.</p>
      <p>{KIDS_METHOD}</p>
    </>
  );
}

/** The essentials a household reaches on foot: Shop, Pharmacy, GP, Gym, Pool, with walk minutes. A list, no bars. */
const ESSENTIALS = ["groceries", "pharmacies", "gps", "gyms", "pools"] as const;
const ESSENTIAL_LABEL: Record<(typeof ESSENTIALS)[number], string> = { groceries: "Shop", pharmacies: "Pharmacy", gps: "GP", gyms: "Gym", pools: "Pool" };

/** The essentials a household place of that kind answers (its own row says the nearest one, routed). */
const ESSENTIAL_OF: Partial<Record<PlaceCategory, (typeof ESSENTIALS)[number]>> = {
  supermarket: "groceries", pharmacy: "pharmacies", gp: "gps", gym: "gyms", pool: "pools",
};

/** The essential groups the household's own places already answer with a row (nearestRows). */
function ownEssentials(profile: PreferenceProfile, commute: AreaCommute | null): ReadonlySet<string> {
  const answered = new Set(nearestRows(profile, commute).map((row) => row.term));
  return new Set((profile.places ?? []).flatMap((place) => place.target.kind === "category" && answered.has(place.label)
    && ESSENTIAL_OF[place.target.category] ? [ESSENTIAL_OF[place.target.category]!] : []));
}

/** The GP row reads NHS England's practices when loaded (gpEssential), as Health, its tile and its tag do. */
function Essentials({ places, health, skip }: { places: AreaPlacesState | null; health: AreaHealthResponse | null; skip?: ReadonlySet<string> }) {
  if (places?.status !== "available") return null;
  const gp = gpEssential(health?.available ? health.gp : null);
  const rows = ESSENTIALS.filter((group) => !skip?.has(group)).map((group) => {
    if (group === "gps" && gp) return { group, name: gp.name, walk: gp.distance };
    const entry = places.places.amenities.find((item) => item.group === group);
    const nearest = entry?.nearest.find((amenity) => amenity.name !== null) ?? entry?.nearest[0];
    return {
      group, name: nearest ? amenityName(nearest) : `No ${AMENITY_SINGULAR[group]} within 1.5 km`,
      walk: nearest ? `${walkMinutes(nearest.distanceMetres)} min` : "—",
    };
  });
  return (
    <ul className="essentials" aria-label="Nearest essentials, walk" data-testid="essentials">
      {rows.map(({ group, name, walk }) => (
        <li key={group} className="essentials__row" data-testid={`essential-${group}`}>
          <span className="essentials__label">{ESSENTIAL_LABEL[group]}</span>
          <span className="essentials__name">{name}</span>
          <span className="essentials__walk">{walk}</span>
        </li>
      ))}
    </ul>
  );
}

function localHeadline(places: AreaPlacesState | null): string | null {
  if (places?.status !== "available") return null;
  const shop = places.places.amenities.find((item) => item.group === "groceries")?.nearest[0];
  return shop ? `Shop ${walkMinutes(shop.distanceMetres)} min` : null;
}

/** Counts within the walk, food hygiene, nightlife and family places (the household's own places sit above). */
function localRows(places: AreaPlacesState | null, food: AreaSummary | null | "unavailable", standouts: AreaStandouts | null | "unknown", scope = "London"): KeyRow[] {
  const data = places?.status === "available" ? places.places : null;
  const count = (group: string) => data?.amenities.find((entry) => entry.group === group)?.countWithinWalk;
  const rated = food && food !== "unavailable" && food.value !== null ? food : null;
  const good = rated?.breakdown?.["rated-4-or-5"];
  const foodTile = tileOf(standouts, "food-hygiene");
  // Bars and pubs have their own row (the Nightlife tile's count), so they are not counted twice here.
  const shops = count("groceries");
  const counts = data ? [
    count("food") !== undefined && `${count("food")} to eat`,
    shops !== undefined && `${shops} shop${shops === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ") : "";
  const nightlife = tileOf(standouts, "nightlife");
  const families = tileOf(standouts, "families");
  // The household's own places have their block above the essentials.
  const rows: MaybeRow[] = [
    counts && { term: `Within ${walkMinutes(data!.walkRadiusMetres)} min walk`, value: counts, testId: "places-counts" },
    rated && {
      term: "Food hygiene 4–5", testId: "food-hygiene-share",
      value: `${Math.round(rated.value!)}%${good !== undefined && rated.sampleCount ? ` (${good.toLocaleString("en-GB")} of ${rated.sampleCount.toLocaleString("en-GB")})` : ""}`
        + (foodTile?.standing != null ? ` · above ${regionShare(foodTile.standing)}% of ${scope}` : ""),
    },
    nightlife && { term: "Bars, pubs and clubs", testId: "nightlife",
      value: `${nightlife.display}${nightlife.regionPercentile !== null && (nightlife.value ?? 0) > 0 ? ` · more than ${regionShare(nightlife.regionPercentile)}% of ${scope}` : ""}` },
    families && { term: "Playgrounds, nurseries, libraries", value: `${families.display} in this area` },
    places?.status === "unavailable" && { term: "Places", value: "Unknown for this area" },
  ];
  return rows.filter(isRow);
}

const SITE_WORDS: Record<string, string> = { lnr: "Local Nature Reserve", sssi: "SSSI" };

/** A site's name with its designation in capitals, as the source writes it in title case ("Crofton Woods Sssi"). */
const siteName = (name: string) => name.replace(/\b(sssi|lnr|nnr)\b/gi, (word) => word.toUpperCase());

/** Green & quiet in numbers and the region's words (no strips: the tiles carry them): site, noise, trees, flood. */
function environmentRows(nature: AreaNature | null | "unavailable", flood: AreaFloodResponse | null | "unknown", noise: AreaNoise | null | "unavailable",
  homePage = false, homeFlood: HomeFloodContext | null = null, scope = "London"): KeyRow[] {
  const green = nature && nature !== "unavailable" ? nature : null;
  const loud = noise && noise !== "unavailable" ? noise : null;
  const bands = flood && flood !== "unknown" ? flood : null;
  const home = bands?.dwelling ?? null;
  const homeNoise = loud?.dwelling ?? null;
  const share = (value: number | null) => value === null ? "unknown" : `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
  const rows: MaybeRow[] = [
    green?.site && {
      term: "Nearest nature site", testId: "nature-site", valueTestId: "nature",
      value: [siteName(green.site.name), siteName(green.site.name).match(/\b(SSSI|LNR|NNR|nature reserve)\b/i) ? null : SITE_WORDS[green.site.kind] ?? "nature site",
        green.site.metres !== null ? `${walkMinutes(green.site.metres)} min` : null].filter(Boolean).join(" · "),
    },
    loud && { term: "Homes over 55 dB", testId: "noise-share", valueTestId: "noise", value: `${share(loud.any55Share)}${scope === "London" ? ` · London ${Math.round(LONDON_NOISE.value.any55Share * 100)}%` : ""}` },
    loud && {
      term: "Road noise",
      value: [loud.roadLdenMedian !== null && `Median ${loud.roadLdenMedian.toFixed(1)} dB${loud.roadLdenMappedShare !== null && loud.roadLdenMappedShare < 1 ? ` (${share(loud.roadLdenMappedShare)} of homes mapped)` : ""}`, loud.any65Share !== null && `${share(loud.any65Share)} over 65 dB`,
        loud.rail55Share === 0 ? "no rail" : loud.rail55Share !== null && `rail ${share(loud.rail55Share)} over 55 dB`].filter(Boolean).join(" · "),
    },
    green?.trees && {
      term: "Trees per hectare", testId: "trees", valueTestId: green.site ? undefined : "nature",
      value: `${green.trees.perHectare}${green.trees.percentile !== null ? ` · more than ${regionShare(green.trees.percentile)}% of ${scope}` : ""}`,
    },
    // A home page leads with the home's own band, then its postcode's homes', then the area's (said as such).
    homePage ? homeFloodKeyRow(homeFlood, bands) : bands && {
      term: "Flood (highest band)", testId: "flood-bands", valueTestId: "flood",
      value: FLOOD_SOURCES.map(({ key, label }) => `${label.toLowerCase()}: ${bands[key] ? FLOOD_BAND_LABEL[bands[key]!.highestBand].toLowerCase() : "unknown"}`).join(" · "),
    },
    ...FLOOD_SOURCES.map(({ key, label }) => !homePage && home && { term: `This home, ${label.toLowerCase()}`, value: home[key] ? FLOOD_BAND_LABEL[home[key]!] : "Unknown", mine: true }),
    // A home page says which blocks this area has no figures for (each once its read answered).
    homePage && nature === "unavailable" && { term: "Green & trees", value: NO_DATA, valueTestId: "nature" },
    homePage && noise === "unavailable" && { term: "Noise", value: NO_DATA, valueTestId: "noise" },
    homePage && flood === "unknown" && !homeFloodRow(homeFlood, null) && { term: "Flood", value: NO_DATA, valueTestId: "flood" },
    homeNoise && { term: "This home, road noise", value: homeNoise.roadLden === null ? "Under 40 dB (not mapped)" : `${homeNoise.roadLden.toFixed(0)} dB Lden`, mine: true },
  ];
  return rows.filter(isRow);
}

/** A home page's flood row: its own bands (the read's `dwelling` when the page passed none), its postcode's, its area's. */
function homeFloodKeyRow(context: HomeFloodContext | null, bands: AreaFloodResponse | null): MaybeRow {
  const own = context?.own ?? (bands?.dwelling ? { riversSea: bands.dwelling.riversSea, surfaceWater: bands.dwelling.surfaceWater } : null);
  const row = homeFloodRow({ own, postcode: context?.postcode ?? null, homes: context?.homes ?? null }, bands);
  return row && { term: row.term, value: row.value, testId: "flood-bands", valueTestId: "flood", mine: row.scope === "home" };
}

/** Flood and noise method and caveats, word for word, then the parks' sources. */
function EnvironmentNotes({ flood, noise, places, scope = "London" }: {
  flood: AreaFloodResponse | null | "unknown"; noise: AreaNoise | null | "unavailable"; places: AreaPlacesState | null; scope?: string;
}) {
  const known = flood && flood !== "unknown" ? flood : null;
  const figures = noise && noise !== "unavailable" ? noise : null;
  return (
    <>
      <p>Flood: shares of the area&apos;s land by Environment Agency band, not of its buildings. Highest: the highest band covering at least 1% of the land.</p>
      <p data-testid="flood-area-caveat">Environment Agency: these bands show the likelihood of flooding for an area, not for a specific property. <a href={FLOOD_CHECK_URL} target="_blank" rel="noreferrer">Check one address</a>.</p>
      {known?.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
      {known?.attribution && <p>{known.attribution}</p>}
      {figures ? (
        <>
          <p>Noise: modelled whole-day average (Lden) at {figures.dwellings.toLocaleString("en-GB")} recorded homes, road or rail; no aircraft noise.{scope === "London" && <> London: {Math.round(LONDON_NOISE.value.any55Share * 100)}% of homes over 55 dB ({LONDON_NOISE.source}).</>}</p>
          {figures.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
          {figures.attribution && <p>{figures.attribution}</p>}
        </>
      ) : noise === "unavailable" && <p>Noise: no strategic noise figures for this area yet. <Link href="/guide/noise">Why?</Link></p>}
      <PlacesNotes places={places} />
    </>
  );
}

/** "Cool nights" / "Warm nights" from summer heat, and the GP chip ("No GP ≤ 1 km"). */
function healthHead(health: AreaHealthResponse | null, gp: StandoutTile | null): SectionHead {
  const heat = health?.available ? health.heat : null;
  const headline = heat?.regionPercentile == null ? null
    : heat.regionPercentile <= 20 ? "Cool nights" : heat.regionPercentile >= 80 ? "Warm nights" : `${heat.value} °C nights`;
  const practices = health?.gp?.practices;
  const chip = practices === 0 ? "No GP ≤ 1 km" : gp ? `GP ${gp.display}` : null;
  return { headline, chip };
}

/** Summer nights, GP and air, numbers with the region in words (no strips: the tiles carry them). */
export function healthRows(health: AreaHealthResponse | null, missing = false, scope = "London"): KeyRow[] {
  if (missing) return [{ term: "Air NO₂ / PM2.5", value: NO_DATA, valueTestId: "air" }, { term: "Summer nights", value: NO_DATA }];
  if (!health?.available) return [];
  const { heat, gp, air } = health;
  const rows: MaybeRow[] = [
    heat && {
      term: "Summer nights", testId: "health-heat",
      value: `${heat.value} °C${heat.regionPercentile !== null ? ` · ${heat.regionPercentile <= 50 ? `cooler than ${regionShare(100 - heat.regionPercentile)}%` : `warmer than ${regionShare(heat.regionPercentile)}%`} of ${scope}` : ""}${heat.year ? ` (${heat.year})` : ""}`,
    },
    gp && {
      term: "GP", testId: "health-gp",
      value: gp.practices === 0
        ? `No surgery within 1 km${gp.nearestMetres !== null ? ` · nearest ${gpDistance(gp.nearestMetres)}` : ""}`
        : [`${gp.practices} within 1 km`, gp.patientsPerGp !== null && `${gp.patientsPerGp.toLocaleString("en-GB")} patients per GP`,
          gp.nearestMetres !== null && `nearest ${gpDistance(gp.nearestMetres)}`].filter(Boolean).join(" · "),
    },
    // The LAEI grid: no row at all (not "No modelled value here") while air is off (`laeiAir` withheld or airEnabled false).
    airShown(health) && {
      term: "Air NO₂ / PM2.5", testId: "air-quality", valueTestId: "air",
      value: air ? `${air.no2} / ${air.pm25 ?? "—"} µg/m³${air.regionPercentile !== null ? ` · cleaner than ${regionShare(100 - air.regionPercentile)}% of ${scope}` : ""}` : "No modelled value here",
    },
  ];
  return rows.filter(isRow);
}

const HOME_WORDS: Record<string, string> = {
  detached: "detached", "semi-detached": "semis", terraced: "terraces", "purpose-built-flat": "flats", "converted-flat": "converted flats",
};

/** Homes is descriptive: "Your types: 98% of homes" when chosen, else the two commonest types. */
function homesHeadline(people: ReturnType<typeof useAreaPeople>, tailor: PageTailor): string | null {
  const topic = people?.status === "available" ? people.people.topics.find((entry) => entry.id === "accommodation") : null;
  if (!topic || topic.total === null) return null;
  const ids: Record<string, string> = { T: "terraced", S: "semi-detached", D: "detached" };
  if (tailor.types.length) {
    const wanted = tailor.types.flatMap((code) => code === "F" ? ["purpose-built-flat", "converted-flat", "other-converted"] : [ids[code]]);
    const share = topic.categories.filter((category) => wanted.includes(category.id)).reduce((sum, category) => sum + (category.share ?? 0), 0);
    return `Your types: ${Math.round(share * 100)}% of homes`;
  }
  const top = [...topic.categories].filter((category) => category.share !== null).sort((a, b) => b.share! - a.share!).slice(0, 2);
  return top.length ? `Mostly ${top.map((category) => HOME_WORDS[category.id] ?? category.label.toLowerCase()).join(" and ")}` : null;
}

/** Census home types → their map layer. */
const HOME_LAYER: Record<string, string> = {
  detached: "census-accommodation-detached", "semi-detached": "census-accommodation-semi-detached", terraced: "census-accommodation-terraced",
  "purpose-built-flat": "census-accommodation-flat", "converted-flat": "census-accommodation-flat", "other-converted": "census-accommodation-flat",
};
const TYPE_LAYER: Record<string, string> = { D: "detached", S: "semi-detached", T: "terraced", F: "purpose-built-flat" };

/** Homes "On map": the household's first type, else the area's commonest. */
function homesLayer(people: ReturnType<typeof useAreaPeople>, tailor: PageTailor): string | null {
  if (tailor.types.length) return HOME_LAYER[TYPE_LAYER[tailor.types[0]]] ?? null;
  const topic = people?.status === "available" ? people.people.topics.find((entry) => entry.id === "accommodation") : null;
  const top = topic?.categories.filter((category) => category.share !== null).sort((a, b) => b.share! - a.share!)[0];
  return top ? HOME_LAYER[top.id] ?? "census-accommodation-other" : null;
}

/** Extending, broadband, settledness and planning: neutral rows with the region beside them. */
function homeRows(home: AreaHomeResponse | null, location: AreaLocationResponse | null, answered = false, scope = "London"): KeyRow[] {
  const value = home?.available ? home : null;
  const extend = value?.extend ?? null;
  const planning = location?.available ? location.planning ?? null : null;
  const rows: MaybeRow[] = [
    extend && {
      term: "Extending", testId: "home-extending",
      value: [`Conservation ${homeShare(extend.conservationShare) ?? "unknown"}`,
        extend.article4Data === "not-published" ? `Article 4 not published (${value?.borough?.name ?? "borough"})` : `Article 4 ${homeShare(extend.article4Share) ?? "unknown"}`,
        `${extend.listed.total} listed building${extend.listed.total === 1 ? "" : "s"}`].join(" · "),
    },
    value?.broadband && {
      term: "Gigabit broadband", testId: "home-broadband", valueTestId: "broadband",
      value: `${homeShare(value.broadband.share) ?? "unknown"} of homes${value.broadband.regionShare !== null ? ` (${scope} ${homeShare(value.broadband.regionShare)})` : ""}`,
    },
    value?.settled && {
      term: "Settled", testId: "home-settled",
      value: `${homeShare(value.settled.share) ?? "unknown"} at the same address a year earlier${value.settled.regionShare !== null ? ` (${scope} ${homeShare(value.settled.regionShare)})` : ""}`,
    },
    answered && !value?.broadband && { term: "Gigabit broadband", value: NO_DATA, valueTestId: "broadband" },
    planning && {
      term: "Planning", testId: "home-planning",
      value: `${planning.applications} applications in 2 years${planning.regionMedian !== null ? ` (${scope} median ${planning.regionMedian})` : ""}`,
    },
  ];
  return rows.filter(isRow);
}

/** Council tax in whole pounds on the page ("£2,140"); the pence stay on /civic. */
const pounds = (amount: number) => `£${Math.round(amount).toLocaleString("en-GB")}`;

function livingHead(civic: CivicResponse | null | "unknown"): SectionHead {
  const tax = civic && civic !== "unknown" ? civic.councilTax : null;
  const bandD = tax?.bands.find((band) => band.band === "D")?.amount ?? null;
  return { headline: bandD === null ? null : `Band D ${pounds(bandD)}`, chip: tax ? `${tax.boroughName ?? ""} ${tax.financialYear}`.trim() : null, layer: null };
}

const RENT_SHORT: Record<string, string> = { oneBedroom: "1 bed", twoBedrooms: "2 bed", threeBedrooms: "3 bed", fourOrMoreBedrooms: "4+ bed" };

/** Driving zones and the borough's average rents: the household's bedrooms when known (with the 30× note), else every count. */
function livingRows(location: AreaLocationResponse | null, rents: AreaRentsResponse | null, tailor: PageTailor, answered = false): KeyRow[] {
  const zones = location?.available ? location : null;
  const zoneWord = (presence: string | undefined, name: string) => presence === "inside" ? `Inside ${name}` : presence === "partly" ? `Partly in ${name}` : presence === "outside" ? `outside ${name}` : null;
  const driving = zones ? [zoneWord(zones.ulez?.presence, "ULEZ"), zoneWord(zones.congestionCharge?.presence, "the Congestion Charge")].filter(Boolean).join(" · ") : "";
  const own = rents?.available ? rents : null;
  const key = tailor.bedrooms ? (["oneBedroom", "twoBedrooms", "threeBedrooms", "fourOrMoreBedrooms"] as const)[Math.min(4, Math.max(1, tailor.bedrooms)) - 1] : null;
  const mineRent = key && tailor.market === "rent" ? own?.rents.find((rent) => rent.bedrooms === key) ?? null : null;
  const rows: MaybeRow[] = [
    driving && { term: "Driving", value: driving.charAt(0).toUpperCase() + driving.slice(1), testId: "living-driving" },
    mineRent && {
      term: `Renting, ${RENT_BEDROOM_LABELS[mineRent.bedrooms].replace(/ bedrooms?/, " bed")}`, mine: true, testId: "living-rent-mine",
      value: `${own!.borough?.name ?? "Borough"} average £${mineRent.monthlyRent.toLocaleString("en-GB")} / month · agents look for ~30× monthly rent a year`,
    },
    own && own.rents.length > 0 && {
      term: `Renting, ${own.borough?.name ?? "borough"} average`, testId: "living-rents", valueTestId: "borough-rents",
      value: own.rents.filter((rent) => rent.bedrooms !== "all").map((rent) => `${RENT_SHORT[rent.bedrooms]} £${rent.monthlyRent.toLocaleString("en-GB")}`).join(" · "),
    },
    answered && !own?.rents.length && { term: "Renting, borough average", value: NO_DATA, valueTestId: "borough-rents" },
  ];
  return rows.filter(isRow);
}

/** Council tax as one row ("Band D £2,140 · A £1,427 … H £4,280"; band ratios are fixed by law), then the zones and rents. */
export function LivingCosts({ civic, areaId, rows, homePage = false }: {
  civic: CivicResponse | null | "unknown"; areaId: GeographyId; rows: KeyRow[];
  /** A home page lists every band, A to H (area360). */
  homePage?: boolean;
}) {
  if (civic === null) return <p className="area-section__status">Loading council tax…</p>;
  const tax = civic === "unknown" ? null : civic.councilTax;
  const bands = tax?.bands.filter((band): band is typeof band & { amount: number } => band.amount !== null) ?? [];
  const bandD = bands.find((band) => band.band === "D");
  const first = bands[0];
  const last = bands.at(-1);
  const line = homePage && bands.length > 0 ? bands.map((band) => `${band.band} ${pounds(band.amount)}`).join(" · ")
    : bandD && first && last ? `Band D ${pounds(bandD.amount)} · ${first.band} ${pounds(first.amount)} … ${last.band} ${pounds(last.amount)}`
      : null;
  const pence = (amount: number) => `£${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const precepts = tax?.precepts ?? (tax?.bandDGla != null ? [{ kind: "gla" as const, amount: tax.bandDGla }] : []);
  const homeBand = civic && civic !== "unknown" ? councilTaxBandLabel(civic.councilTaxBand, civic.withheld) : null;
  return (
    <>
      <KeyNumbers testId="living-costs-key-numbers" rows={[
        tax ? { term: `Council tax ${tax.financialYear}`, value: line ?? "Unknown", testId: "civic-council", valueTestId: "council-tax" }
          : { term: "Council tax", value: "Unknown for this area", valueTestId: "council-tax" },
        homeBand && { term: homePage ? "This home" : "Council tax band", value: homeBand, testId: "living-tax-band" },
        // Who the Band D bill goes to: the council, then the GLA or the county, police, fire… (the pence as set).
        bandD && tax?.bandDBorough != null && precepts.length > 0 && {
          term: "Band D", testId: "civic-band-d-split",
          value: `${pence(bandD.amount)} = ${tax.boroughName ?? "Council"} ${pence(tax.bandDBorough)} + `
            + precepts.map((part) => `${PRECEPT_LABELS[part.kind]} ${pence(part.amount)}`).join(" + "),
        },
        ...rows,
      ]} />
      <Link className="area-section__more" href={`/civic?area=${encodeURIComponent(areaId)}`} data-testid="civic-more">Councillors, MP and area codes</Link>
    </>
  );
}

/** A metric's own history (crime over time), read from its area evidence. */
function MetricHistory({ geographyId, metric, mode, release }: {
  geographyId: GeographyId; metric: MetricDefinition; mode: DataMode; release: string;
}) {
  const scope = useMemo(() => createEvidenceRequestScope(), []);
  const { evidence } = useAreaEvidence(geographyId, metric, metric.periods.at(-1) ?? metric.defaultPeriod, mode, release, scope, IGNORE_CONNECTION);
  if (!evidence || evidence.metricTimeline.length < 2) return null;
  return (
    <MetricSparkline metric={metric} values={evidence.metricTimeline}
      carrier={carrierWords(evidence.summary.carrier)} period={evidence.summary.period} />
  );
}

/** A section payload read once per page (shared with the section that renders it): null while loading; "" reads nothing. */
function useSectionValue<T>(path: string, read: (payload: unknown) => T | null): T | null | "unknown" {
  const payload = useSectionJson(path || null);
  const [reader] = useState(() => read);
  return useMemo(() => {
    if (payload === undefined) return null;
    return payload === null ? "unknown" : reader(payload) ?? "unknown";
  }, [payload, reader]);
}

/** Each metric's source, freshness and caveats, word for word, with its method page. */
function MetricSources({ metrics, extra }: { metrics: MetricDefinition[]; extra?: ReactNode }) {
  return (
    <>
      {metrics.map((metric) => (
        <div key={metric.id} className="area-card__source" data-testid={`metric-sources-${metric.id}`}>
          <p><strong>{metric.label}.</strong> {metric.description}</p>
          {!isPlaceholderMetric(metric) && <p>{metric.provenance.sourceName} · {metric.freshness}</p>}
          {metric.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
          <p><Link href={metric.methodologyPath}>How this is worked out</Link></p>
        </div>
      ))}
      {extra}
    </>
  );
}

/** The price figure's own caveats (fallback level, sample, England comparison), then the market's licence and caveats. */
function PriceNotes({ summary, market }: { summary: AreaSummary; market: AreaMarketResponse | null | "unknown" }) {
  const sample = describePriceSample({
    allSales: summary.breakdown?.allSales ?? summary.sampleCount ?? 0,
    matchedSales: summary.breakdown?.matchedSales ?? summary.sampleCount ?? 0,
    excludedSales: summary.breakdown?.excludedSales ?? 0,
    carrierSales: summary.carrierSampleCount ?? summary.sampleCount ?? 0,
    carrier: summary.carrier,
  });
  const ready = market && market !== "unknown" && market.available ? market : null;
  return (
    <>
      <QualityNote summary={summary} isCrime={false} />
      <p data-testid="price-sample-explanation">Price sample: {sample.explanation}</p>
      <p>Compared with England: {priceEnglandComparison().note}</p>
      <p>Based on {summary.sampleCount === null ? "the published dataset" : `${summary.sampleCount} sales`} · {summary.period} · release {summary.sourceVersion}</p>
      {ready?.basis?.widened && <p data-testid="price-widened">Sales by type are widened to {ready.basis.name} (at least {ready.basis.minimumSales} sales).</p>}
      <p>Recent sales: standard sales from the last 18 months, nearest first.</p>
      {ready?.attribution && <p data-testid="market-sources">{ready.attribution}</p>}
      {ready?.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
    </>
  );
}

/** A metric's history line (crime); its latest figure and types sit in the title row and rows, not under the line. */
function MetricSparkline({ metric, values, carrier, period }: {
  metric: MetricDefinition; values: AreaSummary[]; carrier: string; period: string;
}) {
  return (
    <figure className="price-chart metric-chart" data-testid="metric-history-chart">
      <figcaption>{metric.label} history · {carrier} · {period}</figcaption>
      <Sparkline
        values={values.map((entry) => entry.value)}
        periods={values.map((entry) => entry.period)}
        format={(value) => formatEvidenceValue(value, metric.unit)}
        subject={metric.label}
        summary={false}
      />
    </figure>
  );
}

/**
 * The chosen home's last recorded standard sale, and where its area's prices
 * are. Never a figure for the home itself (owner decision).
 */
function LastSaleSection({ property }: { property: PropertySummary }) {
  const sale = property.lastSale;
  return (
    <section className="stock-value" data-testid="home-last-sale">
      <h2>{property.displayAddress}</h2>
      <p data-testid="home-last-sale-amount">
        {sale ? <>Last sold <strong>{formatPounds(sale.nominalPrice)}</strong> · {formatDay(sale.date)}</> : "No recorded standard sale"}
      </p>
      <p className="stock-value__facts">
        <Link href={propertyPath(property.uprn)}>Prices in this area today</Link> are on the home&apos;s page.
      </p>
    </section>
  );
}

function AddressSection({ history }: { history: AddressHistory }) {
  return (
    <section className="property-history" data-testid="address-history">
      <p className="eyebrow">Building sale history</p>
      <h2>{history.displayAddress}</h2>
      <p className="metric-description">
        {history.saleCount} recorded sales · coordinates at postcode precision, never the building.
      </p>
      {history.transactions.map((transaction) => (
        <article key={`${transaction.date}-${transaction.nominalPrice}`}>
          <strong>{formatPounds(transaction.nominalPrice)}</strong><time dateTime={transaction.date}>{formatDay(transaction.date)}</time>
          <dl>
            <div><dt>Floor area</dt><dd>{transaction.floorAreaSquareMetres === null ? "Not recorded" : `${transaction.floorAreaSquareMetres} m²`}</dd></div>
          </dl>
        </article>
      ))}
      <p className="quality-note">{history.estimateDisclaimer}</p>
    </section>
  );
}

/** The Property tab's demo history card: every recorded sale, newest first. Facts only, no restated price. */
function PropertySection({ history }: { history: PropertyHistory }) {
  const last = history.transactions.at(-1);
  return (
    <section className="property-history property-value-card" data-testid="property-history">
      <p className="eyebrow">Property history</p>
      <h2>{history.address}</h2>
      {!last && <p className="chart-unknown">No recorded sale for this home</p>}
      <ul className="property-sales-list" aria-label="Recorded sales">
        {[...history.transactions].reverse().map((transaction) => (
          <li key={transaction.date}>
            <strong>{formatPounds(transaction.nominalPrice)}</strong>
            <time dateTime={transaction.date}>{formatDay(transaction.date)}</time>
          </li>
        ))}
      </ul>
      <p className="quality-note">{history.estimateDisclaimer}</p>
    </section>
  );
}
