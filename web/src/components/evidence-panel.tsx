"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";

import type {
  AddressHistory,
  AddressId,
  AreaResponse,
  AreaSummary,
  GeographyId,
  MetricDefinition,
  MetricId,
  PropertyHistory,
  PropertySummary,
  SaleRecord,
} from "@/lib/contracts";
import { carrierOfId, fromProfile } from "@/lib/contracts";
import {
  areaEvidencePath,
  createEvidenceRequestScope,
  periodForMetric,
  planEvidenceRequest,
  readAreaEvidenceBody,
  requestAreaEvidence,
  type ConnectionStatus,
  type DataMode,
  type EvidenceRequestScope,
  type SettledEvidenceResult,
} from "@/lib/map-state";
import { evidencePath, HEALTH_PATH } from "@/lib/section-seed";
import { useSeed } from "./section-seed";
import { filteredCrimeValue } from "@/lib/crime-filter";
import { formatEvidenceValue, formatPounds } from "@/lib/evidence-format";
import { DEFAULT_PROFILE, getMetric, isPlaceholderMetric, parentGeographyId } from "@/lib/fixtures";
import {
  homeCorrectionBody,
  objectionOutcomeMessage,
  prepareCorrectionReport,
  submitCorrection,
  type CorrectionKind,
  type CorrectionReport,
  type HomeCorrectionKind,
  type SubmissionState,
} from "@/lib/correction-report";
import { loadLocalProfile, type AreaUnit } from "@/lib/profile-state";
import { HelpTip } from "./help-tip";
import { useHomeSize } from "./overview-home-cost";
import { useOverviewPlaces, yearTrend } from "./overview-tiles";
import { useAreaProfile } from "@/lib/area-profile";
import { HOME_SIZES, homeCost, profileMetric, type HomeSize } from "@/lib/overview-scorecard";
import { areaTitle, carrierWords, friendlyTitle, isCodeName, widerAreaWords, widerCrumbs, type FriendlyAreaFields } from "@/lib/area-labels";
import type { AreaFacts } from "@/lib/overview-text";
import { priceChange } from "@/lib/price-change";
import { useAreaFlood } from "./flood-risk";
import { formatMonth } from "@/lib/market";
import { cleanAddress } from "@/lib/postcode-groups";
import { propertyPath, type PropertyProfileResponse } from "@/lib/property-profile";
import { areaPageHref, isAreaCardId, type AreaCardId } from "@/lib/area-brief";
import { toPricePerSquareFoot } from "@/lib/price-history";
import { politeFetch } from "@/lib/polite-fetch";
import { sharedPoliteFetch, whenIdle } from "@/lib/shared-fetch";
import { contactEmail } from "@/lib/contact";
import { ListingPhotoLinks } from "@/components/listing-photo-links";
import { homeCardLinks } from "@/lib/listing-links";
import { AreaPanelActions, SaveAreaButton } from "./area-save-actions";
import { WatchListings } from "./watch-listings";
import { KnitIcon } from "./knit/knit-icon";
import { scopeName } from "@/lib/scope-name";

export type PriceUnit = AreaUnit;

interface EvidencePanelProps {
  selected: GeographyId | null;
  metric: MetricDefinition;
  period: string;
  mode: DataMode;
  release: string;
  connection: ConnectionStatus;
  scope: EvidenceRequestScope;
  onConnection: (status: ConnectionStatus) => void;
  uprn: string | null;
  addressId: AddressId | null;
  excludedCrime: string[];
  onSelect: (id: GeographyId) => void;
  /** The dock shows this panel (it stays mounted while the dock is collapsed). */
  open: boolean;
  /** A phone's bottom sheet: the peek view at half height, the full view at full. Desktop: always the full view. */
  phone: boolean;
  /** "Area name · value unit" for the collapsed dock's reopen row; null while unknown. */
  onSummary: (summary: string | null) => void;
  /** With nothing chosen: shows the ready-made example search (the intro's "Try an example"). */
  onExample?: () => void;
  /**
   * Opened from My match (a row or the map): "← My match" over the header goes back to the list, and the
   * area's match score sits beside its name.
   */
  back?: {
    label: string; onBack: () => void; score: number | "out" | null; extra?: ReactNode;
    /** The way back sits in the phone sheet's own header (MapSheet lead): not again over the name. */
    inHeader?: boolean;
  } | null;
}

export interface DataHealth {
  status: "ready" | "degraded" | "not-ready" | "unknown";
  code: string;
  productReleaseId: string | null;
  unavailableReasons: string[];
}

/** The area card's verdict, tags and tiles and its sections (as on /area): one view at every height. */
const AreaFullCard = dynamic(() => import("./area-full-page").then((loaded) => loaded.AreaFullCard), {
  ssr: false, loading: () => <ViewLoading />,
});
const AreaPeek = dynamic(() => import("./area-full-page").then((loaded) => loaded.AreaPeek), {
  ssr: false, loading: () => <ViewLoading />,
});

function ViewLoading() {
  return <div className="standout-tiles standout-tiles--loading" aria-busy="true" />;
}

/**
 * Default-off flags for what the owner dropped from the panel (FLAGS.md, "Product choices"). Kept
 * in code so switching one back on is a one-word change, never a rebuild.
 */
export const PANEL_FLAGS: Readonly<Record<"AREA_HOME_COST_ESTIMATE", boolean>> = {
  /** "What a home costs here ≈ £…": a sum for a home of the chosen size; not shown (no per-home valuation). */
  AREA_HOME_COST_ESTIMATE: false,
};

/**
 * The map dock's snap ("collapsed", "half" or "full"), read from the data-snap
 * the dock already sets (map-dock.tsx), so the sheet's drag code stays its own.
 */
function useDockSnap(node: { current: HTMLElement | null }, selected: GeographyId | null): string | null {
  const [snap, setSnap] = useState<string | null>(null);
  useEffect(() => {
    const dock = node.current?.closest<HTMLElement>("[data-snap]") ?? null;
    if (!dock) return;
    const read = () => setSnap(dock.getAttribute("data-snap"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(dock, { attributes: true, attributeFilter: ["data-snap"] });
    return () => observer.disconnect();
    // The panel's node appears once an area is chosen.
  }, [node, selected]);
  return snap;
}

/**
 * The map's area view: one view at every height, the area page's own words. A header
 * (breadcrumbs, the name and ♡; the dock's ✕ beside it), the chosen home, then on a phone at half
 * height the verdict, tags and the first 4 tiles; at full height and in the desktop side panel the
 * verdict, tags, actions, Tailored chip, the 12 tiles and every section. A sticky footer leads to the
 * full area page. No x/10 ratings and no "Details ›": a tile opens its section.
 */
export function EvidencePanel(props: EvidencePanelProps) {
  const outcome = useAreaEvidence(
    props.selected, props.metric, props.period, props.mode, props.release, props.scope, props.onConnection, props.connection,
  );
  const addressHistory = useAddressHistory(props.addressId);
  const stockValue = useHomeSummary(props.uprn);
  const health = useDataHealth();
  const [profile] = useState(() => loadLocalProfile(DEFAULT_PROFILE));
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const snap = useDockSnap(panel, props.selected);
  const full = !props.phone || snap === "full";
  // The wider area: the API's own parent in real mode (none until evidence answers), the fixture's in demo.
  const parentId = !props.selected ? null
    : props.mode === "real" ? outcome.evidence?.parentId ?? null : parentGeographyId(props.selected);
  const summary = outcome.evidence?.summary ?? null;
  const summaryText = props.selected && summary ? areaSummaryText(summary, props.metric, props.excludedCrime) : null;
  const { onSummary } = props;
  useEffect(() => onSummary(summaryText), [onSummary, summaryText]);
  useEffect(() => {
    // The sheet's grabber keeps focus while its keys step the sheet open.
    if (document.activeElement?.matches("[data-testid='sheet-handle']")) return;
    if (props.selected && props.open) heading.current?.focus({ preventScroll: true });
  }, [props.selected, props.open]);

  // UX-42: before anything is selected there is no content to fill a panel:
  // one line names the next action and the map stays visible.
  if (!props.selected) {
    return (
      <aside className="evidence-panel evidence-panel--empty" data-testid="evidence-panel" aria-live="polite">
        {/* An h2: the page's one h1 is the intro's value line (cross-lane contract 6). */}
        <h2 ref={heading} tabIndex={-1} data-testid="selected-area" className="evidence-empty-line">
          Choose an area <span data-testid="evidence-empty">on the map or search</span>
        </h2>
        {props.onExample && (
          <button type="button" className="evidence-empty-example link-button" data-testid="empty-example" onClick={props.onExample}>
            Try an example
          </button>
        )}
      </aside>
    );
  }
  // A real address (no UPRN yet) still travels to the full page's home card.
  const home = { uprn: props.uprn, addressId: stockValue?.addressId ?? addressHistory?.addressId ?? props.addressId ?? null };
  const ownTitle = areaTitle(summary?.name, outcome.evidence).title;
  const name = friendlyTitle(outcome.evidence) ?? ownTitle ?? "this area";
  return (
    <aside ref={panel} className="evidence-panel area-brief" data-testid="evidence-panel" data-full={full ? "" : undefined}
      data-view={full ? "full" : "peek"} aria-live={full ? undefined : "polite"}>
      <header className="area-brief__head">
        {props.back && !props.back.inHeader && (
          <button type="button" className="area-brief__back link-button" data-testid="area-view-back" onClick={props.back.onBack}>
            <span aria-hidden="true">← </span>{props.back.label}
          </button>
        )}
        <WiderAreas parentId={parentId} ownName={outcome.evidence?.friendlyName?.trim() || summary?.name || null}
          region={scopeName(outcome.evidence?.rankScope)}
          metric={props.metric.id} period={props.period} mode={props.mode} release={props.release} onSelect={props.onSelect} />
        <div className="area-brief__title-row">
          <BriefTitle officialName={summary?.name} fields={outcome.evidence} headingRef={heading} />
          {props.back?.score === "out" ? (
            <span className="area-brief__score fit-popup__out" data-testid="area-view-score" title="A Must puts it out">
              Out<span className="sr-only"> of your search</span>
            </span>
          ) : props.back?.score != null && (
            <span className="area-brief__score" data-testid="area-view-score" title="Match score">
              {Math.round(props.back.score)}<span className="sr-only"> match score</span>
            </span>
          )}
          {/* Watch beside ♡ in the header (CUJ12 v4), at every height: the shared sheet with the portals' alerts. */}
          <WatchListings place={name} className="area-brief__watch" label="Watch" />
          {/* ♡ for every area kind (a wider neighbourhood had Watch and no ♡ on desktop). */}
          {/^uk:(lsoa|msoa|lad):/.test(props.selected) && (
            <SaveAreaButton geographyId={props.selected} name={name} mode={props.mode} release={props.release} testId="save-area" />
          )}
        </div>
        {props.back?.extra}
      </header>
      {props.connection === "offline" && (
        <p data-testid="evidence-offline" role="status">
          You are offline. Evidence cannot load until the connection returns.
        </p>
      )}
      {(stockValue || addressHistory) && (
        <BriefHome
          property={stockValue}
          address={addressHistory}
          uprn={officialUprn(props.uprn)}
          productReleaseId={health?.productReleaseId ?? null}
        />
      )}
      {outcome.evidence
        ? <AreaView key={outcome.evidence.summary.geographyId} selected={props.selected} mode={props.mode} release={props.release}
          evidence={outcome.evidence} metric={props.metric} health={health} bedrooms={profile.bedrooms ?? null} home={home}
          full={full} name={name} />
        : outcome.rejection
          ? <UnavailableState {...outcome.rejection} />
          : <EmptyState />}
    </aside>
  );
}

/**
 * The brief's heading: the area's name on one line (cut with an ellipsis, whole in
 * its tooltip). The postcode district sits on the line beneath, beside the
 * wider areas; screen readers still hear "Name · District" as the heading.
 */
function BriefTitle({ officialName, fields, headingRef }: {
  officialName: string | null | undefined; fields: FriendlyAreaFields | null | undefined; headingRef: Ref<HTMLHeadingElement>;
}) {
  const friendly = fields?.friendlyName?.trim() || null;
  const district = friendly ? fields?.postcodeDistrict?.trim() || null : null;
  const name = friendly ?? areaTitle(officialName, fields).title ?? "Choose an area";
  return (
    <div className="area-title area-brief__title">
      <h1 ref={headingRef} tabIndex={-1} data-testid="selected-area" title={name}>
        {name}{district && <span className="sr-only">{` · ${district}`}</span>}
      </h1>
    </div>
  );
}

interface WiderArea { id: GeographyId; carrier: string; name: string | null }

/**
 * The areas above the selected one (its district, then its borough), named from
 * their own evidence; empty until it answers.
 */
function useWiderAreas(parentId: GeographyId | null, metric: string, period: string, mode: DataMode, release: string): WiderArea[] {
  // Kept with the parent they answer for, so a new selection never shows the last one's names.
  const [named, setNamed] = useState<{ from: GeographyId | null; areas: WiderArea[] }>({ from: null, areas: [] });
  useEffect(() => {
    if (!parentId) return;
    const controller = new AbortController();
    const load = async (id: GeographyId, found: WiderArea[]): Promise<WiderArea[]> => {
      const response = await politeFetch(areaEvidencePath({ selected: id, metric, period, mode, release }), { signal: controller.signal });
      if (!response.ok) return found;
      const body = await response.json() as AreaResponse;
      // Its name without a postcode district, as the area page's breadcrumbs: one naming source.
      const next = [...found, { id, carrier: carrierOfId(id), name: body.friendlyName?.trim() || body.summary?.name || null }];
      const up = body.parentId;
      return up && next.length < 2 && !next.some((area) => area.id === up) ? load(up, next) : next;
    };
    // The wider areas' names are a line under the title, not the panel's figures: asked once the page is
    // idle, so their two evidence reads never race the map's colours and the area's own.
    const cancelIdle = whenIdle(() => {
      load(parentId, []).then((areas) => setNamed({ from: parentId, areas })).catch(() => undefined);
    });
    return () => { cancelIdle(); controller.abort(); };
  }, [parentId, metric, period, mode, release]);
  return named.from === parentId ? named.areas : [];
}

/**
 * The breadcrumbs over the title, as on the area page (one naming source): "London › Camden ›
 * Euston", or "North West › Manchester › …" outside London (the area's region, API rankScope), each wider area
 * by its name without a district, then the area's own name. Each wider area is one tap, selected on the map
 * (outlined and brought into view) with its own figures.
 */
export function WiderAreas({ parentId, ownName, region = "London", metric, period, mode, release, onSelect }: {
  parentId: GeographyId | null; ownName: string | null; region?: string; metric: string; period: string; mode: DataMode;
  release: string; onSelect: (id: GeographyId) => void;
}) {
  const named = useWiderAreas(parentId, metric, period, mode, release);
  const row = useCrumbFade(parentId);
  if (!parentId) return null;
  const crumbs = widerCrumbs(named, ownName);
  const own = ownName && !isCodeName(ownName) && ownName !== crumbs.at(-1)?.label ? ownName : null;
  return (
    <nav className="area-brief__parents area-page__crumbs" aria-label="Wider areas" data-testid="wider-areas">
      <ol ref={row}>
        <li data-testid="wider-areas-region">{region}</li>
        {crumbs.map((area) => (
          <li key={area.id}>
            <button type="button" className="area-brief__parent" data-testid={area.carrier === "lad" ? "view-borough" : "view-parent-area"}
              title={area.label} onClick={() => onSelect(area.id)}>
              {area.label}
            </button>
          </li>
        ))}
        {own && <li className="area-brief__district" aria-current="location" title={own}>{own}</li>}
      </ol>
    </nav>
  );
}

/**
 * The crumb row that swipes on a phone fades at the edge with more beyond it (CUJ16: never a name cut
 * mid-word with nothing to say there is more): data-fade is "end", "start", "both", or absent when it fits.
 */
function useCrumbFade(key: string | null) {
  const row = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const node = row.current;
    if (!node) return;
    const update = () => {
      const more = node.scrollWidth - node.clientWidth > 1;
      const start = more && node.scrollLeft > 1;
      const end = more && node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      const fade = start && end ? "both" : start ? "start" : end ? "end" : null;
      if (fade) node.dataset.fade = fade;
      else delete node.dataset.fade;
    };
    update();
    // The row's own size, and its names arriving (the wider areas load after the panel).
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    const names = new MutationObserver(update);
    names.observe(node, { childList: true, subtree: true, characterData: true });
    node.addEventListener("scroll", update, { passive: true });
    return () => { observer?.disconnect(); names.disconnect(); node.removeEventListener("scroll", update); };
  }, [key]);
  return row;
}

/** One line for the collapsed dock: the area and its value on the active layer. */
function areaSummaryText(summary: AreaSummary, metric: MetricDefinition, excludedCrime: string[]): string {
  const value = crimeSelectionFor(summary, excludedCrime).value;
  const name = summary.name ?? "Selected area";
  return value === null ? name : `${name} · ${formatEvidenceValue(value, metric.unit)} ${metric.unit}`;
}

/** A home picked by address carries its address id in place of a UPRN; the
 * flood, places and property endpoints take only a real UPRN. */
export function officialUprn(uprn: string | null): string | null {
  return uprn && /^[0-9]+$/.test(uprn) ? uprn : null;
}

/** Asks the profile for every topic at its newest published month. */
const LATEST_PROFILE_PERIOD = "9999-12";

/**
 * The figures the brief and the full page share: the area profile (today's
 * figures), flood bands, places and the price trend. The map's own reading
 * stands in for its metric only when the profile has none and the map shows
 * the newest period.
 */
export function useAreaFacts({ evidence, metric, mode, release, uprn, bedrooms }: {
  evidence: AreaResponse; metric: MetricDefinition; mode: DataMode; release: string;
  uprn: string | null; bedrooms: number | null;
}) {
  const { summary } = evidence;
  const geographyId = summary.geographyId;
  // The summary describes the area now, the same on every layer: each topic
  // at its own newest period (the profile reads "on or before" this month),
  // never the layer's or the timeline's period, so the crime figure does not
  // change when the map switches from price to crime.
  const areaProfile = useAreaProfile(geographyId, LATEST_PROFILE_PERIOD, mode, release);
  const [homeSize, setHomeSize] = useHomeSize(bedrooms);
  const scores = areaProfile?.status === "available" ? areaProfile.profile : null;
  const loading = areaProfile === null || areaProfile.status === "loading";
  const flood = useAreaFlood(geographyId, officialUprn(uprn), mode);
  const places = useOverviewPlaces(geographyId, officialUprn(uprn), mode, release);
  const pick = (id: MetricId) => profileMetric(scores, id)
    ?? (metric.id === id && summary.period === metric.periods.at(-1) ? summary : null);
  const price = pick("price-per-square-metre");
  const timeline = price ? evidence.priceTimeline.filter((point) => point.period <= price.period) : evidence.priceTimeline;
  const change = priceChange(timeline, 1);
  const crime = pick("crime");
  const crimeTrend = useCrimeTrend(geographyId, metric, evidence, crime, mode, release);
  const facts: AreaFacts = {
    name: summary.name ?? scores?.name ?? null,
    price,
    change,
    crime,
    deprivation: pick("deprivation"),
    income: pick("income"),
    socialRenting: pick("social-renting"),
    schools: scores?.schools ?? null,
    noise: scores?.noise ?? null,
    homeSize,
    regionRanks: scores?.regionRanks ?? null,
    crimeTrend,
  };
  return { facts, scores, loading, flood, places, timeline, change, price, homeSize, setHomeSize };
}

const CRIME = getMetric("crime");
const IGNORE_CONNECTION = () => undefined;

/**
 * Crime against a year before, for the Safety tile's trend: the map's own
 * timeline when it shows crime, else crime's area evidence at its newest month.
 * It ends at the tile's own crime month, so the arrow describes the figure shown.
 */
function useCrimeTrend(geographyId: GeographyId, metric: MetricDefinition, evidence: AreaResponse,
  crime: AreaSummary | null, mode: DataMode, release: string) {
  const scope = useMemo(() => createEvidenceRequestScope(), []);
  const onCrime = metric.id === "crime";
  const fetched = useAreaEvidence(onCrime ? null : geographyId, CRIME, CRIME.periods.at(-1) ?? CRIME.defaultPeriod, mode, release, scope, IGNORE_CONNECTION);
  const timeline = onCrime ? evidence.metricTimeline : fetched.evidence?.metricTimeline ?? [];
  return crime ? yearTrend(timeline.filter((point) => point.period <= crime.period), false) : null;
}

/**
 * The picked area's verdict, tags and first 4 tiles while a lens (a comparison of places) colours the
 * map: the same view as the area sheet's peek, each leading to the full area page.
 */
export function AreaKeyNumbers({ selected, mode, release }: { selected: GeographyId; mode: DataMode; release: string }) {
  const source = { mode, release };
  return <AreaPeek geographyId={selected} mode={mode} href={(section) => areaPageHref(selected, null, cardOf(section), source)} />;
}

/** A tag or tile's section as the full page's anchor (the overview when it names none). */
function cardOf(section: string): AreaCardId | null {
  return isAreaCardId(section) && section !== "overview" ? section : null;
}

/**
 * The area under the header: the peek (verdict, tags, 4 tiles) or the full view (verdict, tags, Tailored,
 * 12 tiles, sections), the same for a neighbourhood, a wider neighbourhood (MSOA) and a borough.
 * Then the sticky footer: Compare · Like this · Check a home (a neighbourhood's) and the way to the
 * full area page (a chosen home's page first).
 */
function AreaView({ selected, mode, release, evidence, metric, health, bedrooms, home, full, name }: {
  selected: GeographyId; mode: DataMode; release: string; evidence: AreaResponse; metric: MetricDefinition;
  health: DataHealth | null; bedrooms: number | null; home: { uprn: string | null; addressId: AddressId | null };
  full: boolean; name: string;
}) {
  const source = { mode, release };
  const fullPage = areaPageHref(selected, home, null, source);
  // A chosen home with a UPRN leads to its own page; the area page comes second.
  const homePage = home.uprn && /^[0-9]+$/.test(home.uprn) ? propertyPath(home.uprn) : null;
  return (
    <div className="area-brief__body" data-testid="area-view">
      {full
        ? <AreaFullCard key={selected} geographyId={selected} mode={mode} release={release} period={null}
          uprn={home.uprn} addressId={home.addressId} friendly={evidence} />
        : <AreaPeek geographyId={selected} mode={mode} href={(section) => areaPageHref(selected, home, cardOf(section), source)} />}
      {PANEL_FLAGS.AREA_HOME_COST_ESTIMATE && (
        <AreaHomeCost evidence={evidence} metric={metric} mode={mode} release={release} uprn={home.uprn} bedrooms={bedrooms} />
      )}
      {/* The full view's card says it once itself (area-full-page.tsx). */}
      {!full && <FreshnessWarning health={health} />}
      {full && <ReportFigure evidence={evidence} metric={metric} health={health} />}
      <div className="area-brief__actions" data-testid="area-view-footer">
        {selected.startsWith("uk:lsoa:") && <AreaPanelActions geographyId={selected} name={name} uprn={officialUprn(home.uprn)} />}
        {homePage ? (
          <>
            <Link className="area-brief__primary" href={homePage} data-testid="open-home-page">Open this home</Link>
            <Link className="area-brief__secondary" href={fullPage} data-testid="open-area-page">Area page</Link>
          </>
        ) : <Link className="area-brief__primary" href={fullPage} data-testid="open-area-page">Open full area page</Link>}
      </div>
    </div>
  );
}

/** Behind PANEL_FLAGS.AREA_HOME_COST_ESTIMATE (off): the area's figures for the one-line estimate below. */
function AreaHomeCost({ evidence, metric, mode, release, uprn, bedrooms }: {
  evidence: AreaResponse; metric: MetricDefinition; mode: DataMode; release: string; uprn: string | null; bedrooms: number | null;
}) {
  const area = useAreaFacts({ evidence, metric, mode, release, uprn, bedrooms });
  return <BriefHomeCost price={area.price} loading={area.price === null && area.loading} size={area.homeSize} onSize={area.setHomeSize}
    friendly={evidence} />;
}

/**
 * Behind PANEL_FLAGS.AREA_HOME_COST_ESTIMATE (off, owner): roughly what a home of the
 * chosen size costs here, as one line with its size picker. Dropped from the panel under the no
 * per-home valuation rule; the area page shows £/m², the area band and the budget fit instead.
 */
function BriefHomeCost({ price, loading, size, onSize, friendly }: {
  price: AreaSummary | null; loading: boolean; size: HomeSize; onSize: (size: HomeSize) => void;
  /** Names the wider area when the price is borrowed. */
  friendly: FriendlyAreaFields | null;
}) {
  const cost = homeCost(price?.value ?? null, size);
  return (
    <section className="brief-cost" data-testid="home-cost" aria-labelledby="brief-cost-title">
      <div className="brief-cost__row">
        <h2 id="brief-cost-title" className="brief-cost__title">What a home costs here <HelpTip id="home-cost" label="home cost" /></h2>
        <label className="sr-only" htmlFor="brief-home-size">Home size</label>
        <select id="brief-home-size" className="brief-cost__size" data-testid="home-size" value={size}
          onChange={(event) => onSize(Number(event.target.value) as HomeSize)}>
          {HOME_SIZES.map((option) => (
            <option key={option.squareMetres} value={option.squareMetres}>{option.label}</option>
          ))}
        </select>
      </div>
      <p className="brief-cost__row">
        <strong className="brief-cost__value">
          {cost !== null && <span aria-hidden="true">≈ </span>}
          <span data-testid="home-cost-value">{cost !== null ? formatPounds(cost) : loading ? "Loading…" : "No recent price"}</span>
        </strong>
        {/* Two words in view; the wider area is named on hover and to screen readers (no About this data fold). */}
        {price?.quality === "fallback" && (
          <small className="brief-cost__sum" data-testid="home-cost-wider" title={`Few sales here, so this uses the price for ${widerAreaWords(friendly)}`}>
            wider-area price<span className="sr-only">: few sales here, so this uses the price for {widerAreaWords(friendly)}</span>
          </small>
        )}
      </p>
    </section>
  );
}

/** The newest sale of a home: its recorded last standard sale, else its address record. */
function lastSaleOf(property: PropertySummary | null, address: AddressHistory | null): { price: number; date: string } | null {
  const sale = property?.lastSale;
  if (sale) return { price: sale.nominalPrice, date: sale.date };
  const newest = [...(address?.transactions ?? [])].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  return newest ? { price: newest.nominalPrice, date: newest.date } : null;
}

/**
 * The chosen home in short lines: its last recorded sale with the HM Land
 * Registry record, links out to the portals' listing photos, a pointer to the
 * area's prices on its own page (never a figure for the home itself), the
 * public-record note (with the report / hide-my-home form) and its page link.
 */
function BriefHome({ property, address, uprn, productReleaseId }: {
  property: PropertySummary | null; address: AddressHistory | null; uprn: string | null; productReleaseId: string | null;
}) {
  const name = cleanAddress(property?.displayAddress ?? address?.displayAddress ?? "This home");
  const sale = lastSaleOf(property, address);
  const sales = address?.saleCount ?? null;
  const links = homeCardLinks(property, address);
  return (
    <section className="brief-home" data-testid="brief-home" aria-labelledby="brief-home-title">
      <h2 id="brief-home-title" className="brief-home__address">{name}</h2>
      <p className="brief-home__line" data-testid="brief-home-sale">
        {sale
          ? <>Last sold <strong>{formatPounds(sale.price)}</strong> · <time dateTime={sale.date}>{formatMonth(sale.date.slice(0, 7))}</time>{sales !== null && sales > 1 ? ` · ${sales} sales` : ""}</>
          : "No recorded sale for this home"}
      </p>
      {sale && links && (
        <p className="brief-home__line brief-home__caveat" data-testid="brief-home-record">
          Price paid from <a href={links.priceRecord} target="_blank" rel="noopener noreferrer">HM Land Registry<span className="sr-only"> (opens in a new tab)</span></a>
        </p>
      )}
      {links && <ListingPhotoLinks links={links} testId="brief-home-listings" />}
      {uprn && (
        <p className="brief-home__line" data-testid="brief-home-area-prices">
          <Link href={propertyPath(uprn)}>Prices in this area today</Link> are on the home&apos;s page
        </p>
      )}
      <HomeCorrectionSection
        uprn={property?.uprn ?? null}
        addressId={property?.addressId ?? address?.addressId ?? null}
        sourceReleaseId={property?.sourceVersion ?? address?.sourceVersion ?? null}
        productReleaseId={productReleaseId}
        homePage={uprn ? propertyPath(uprn) : null}
      />
    </section>
  );
}

/**
 * The figure's "Report a wrong figure", always in view at the end of the brief. Method, source and date
 * live behind the legend's "?" (layer-explainer.tsx) and the full area page, not in a fold here.
 */
function ReportFigure({ evidence, metric, health }: { evidence: AreaResponse; metric: MetricDefinition; health: DataHealth | null }) {
  const { summary } = evidence;
  const productReleaseId = evidence.productReleaseId ?? health?.productReleaseId ?? null;
  return (
    <div className="overview-about">
      <CorrectionSection observationId={`${summary.geographyId}:${metric.id}:${summary.period}`}
        sourceReleaseId={summary.sourceVersion} productReleaseId={productReleaseId} />
    </div>
  );
}

export function QualityNote({ summary, isCrime }: { summary: AreaSummary; isCrime: boolean }) {
  if (summary.quality !== "fallback") return null;
  if (isCrime) {
    return (
      <p className="quality-note">Shown for {carrierWords(summary.carrier)} under the published crime coverage policy. Missing force-month evidence is never shown as zero; British Transport Police records are excluded.</p>
    );
  }
  // A real LSOA row on fallback carries its parent's median under its own id.
  if (summary.carrier === "lsoa") {
    return (
      <p className="quality-note">Too few matched sales in this neighbourhood ({summary.sampleCount ?? 0} in 12 months); the value is the median of the wider neighbourhood or the borough.</p>
    );
  }
  // The carrier's name when the API knows it, else its level in words (never "null").
  const where = summary.carrierName ?? carrierWords(summary.carrier);
  return (
    <p className="quality-note">Too few matched sales in this neighbourhood; shown for {where} from {summary.carrierSampleCount ?? summary.sampleCount ?? 0} matched sales.</p>
  );
}

/** A data-health problem stays visible: it changes how far to trust the numbers. */
export function FreshnessWarning({ health }: { health: DataHealth | null }) {
  const [open, setOpen] = useState(false);
  if (health === null || health.status === "ready" || health.status === "unknown") return null;
  const reason = health.unavailableReasons[0] ?? `Data health code: ${health.code}`;
  return (
    <div data-testid="freshness-warning" className="freshness-warning" role="alert">
      <p>{reason}</p>
      <button
        type="button"
        data-testid="freshness-warning-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide freshness details" : "Show freshness details"}
      </button>
      {open && (
        <p data-testid="freshness-details">
          Code {health.code} · release {health.productReleaseId ?? "none loaded"}
        </p>
      )}
    </div>
  );
}

/** "Report a wrong figure" (the map panel), "Looks wrong" (an area page section): opens the correction form for one figure. */
export function CorrectionSection({ observationId, sourceReleaseId, productReleaseId, label = "Report a wrong figure", figure = null }: {
  /** `${geographyId}:${metric or section}:${period}`. */
  observationId: string; sourceReleaseId: string; productReleaseId: string | null; label?: string;
  /** The figure in words under the form's title ("Safety · 8.1 per 1,000 · St James's"); null: none. */
  figure?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  // After ✕ the form is gone: focus returns to the link that opened it.
  useEffect(() => { if (!open && closed) opener.current?.focus(); }, [open, closed]);
  if (!open) {
    return (
      // A disclosure: it says it is closed; opened, the form takes its place and its title takes focus.
      <button ref={opener} type="button" className="overview-about__report link-button" data-testid="correction-report-open"
        aria-expanded={false} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <CorrectionForm observationId={observationId} sourceReleaseId={sourceReleaseId} productReleaseId={productReleaseId}
      figure={figure} onClose={() => { setClosed(true); setOpen(false); }} />
  );
}

/**
 * The correction form (knit fields): a titled card with ✕ naming the figure, "Who got it wrong?"
 * as two radio cards under a legend, "What looks wrong?", then Send (CUJ15 board: pick, send). The
 * report is built here from the figure's ids and the words typed, nothing else, and sent only on Send.
 */
export function CorrectionForm({ observationId, sourceReleaseId, productReleaseId, onClose, figure = null }: {
  observationId: string; sourceReleaseId: string; productReleaseId: string | null;
  /** The ✕: closes the form (back to the report link). */
  onClose?: () => void;
  figure?: string | null;
}) {
  const [kind, setKind] = useState<CorrectionKind>("publisher-error");
  const [description, setDescription] = useState("");
  const [outcome, setOutcome] = useState<SubmissionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptionId = useId();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  // Opened from its link: a screen reader hears the form arrive, not the page body.
  useEffect(() => {
    if (onClose) title.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <form className="correction-form" data-testid="correction-report-form" aria-labelledby={titleId}
      onSubmit={(event) => event.preventDefault()}>
      <div className="correction-form__head">
        <h3 id={titleId} ref={title} tabIndex={-1}>Report a figure</h3>
        {onClose && (
          <button type="button" className="correction-form__close" data-testid="correction-report-close" aria-label="Close" onClick={onClose}>
            <KnitIcon name="cross" className="knit-glyph" style={{ width: 14, height: 14 }} />
          </button>
        )}
      </div>
      {figure && <p className="correction-form__figure" data-testid="correction-figure">{figure}</p>}
      <CorrectionKindRadios kind={kind} onKind={setKind} />
      <label className="correction-form__label" htmlFor={descriptionId}>What looks wrong? (optional)</label>
      <textarea
        id={descriptionId}
        className="knit-field"
        data-testid="correction-description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <details className="correction-reference">
        <summary>Technical reference</summary>
        <p data-testid="correction-observation-id">{observationId}</p>
        <p data-testid="correction-source-release">{sourceReleaseId}</p>
      </details>
      {outcome ? <HomeCorrectionOutcome outcome={outcome} onReset={() => setOutcome(null)} /> : (
        <button type="button" className="correction-form__send" data-testid="correction-report-send" disabled={busy} onClick={() => {
          let report: CorrectionReport;
          try {
            report = prepareCorrectionReport({
              observationId, sourceReleaseId,
              productReleaseId: productReleaseId ?? undefined,
              kind, description: description || undefined,
            });
            setError(null);
          } catch (prepareError) {
            setError(prepareError instanceof Error ? prepareError.message : "Could not prepare the report.");
            return;
          }
          // What is sent is the report as built: nothing is added on the way out.
          const { status: _status, route: _route, ...body } = report;
          setBusy(true);
          void submitCorrection(body).then(setOutcome).finally(() => setBusy(false));
        }}>
          Send
        </button>
      )}
      {error && <p className="correction-form__error" data-testid="correction-report-error" role="alert">{error}</p>}
    </form>
  );
}

function CorrectionKindRadios({ kind, onKind }: {
  kind: CorrectionKind; onKind: (kind: CorrectionKind) => void;
}) {
  const name = useId();
  return (
    <fieldset className="correction-form__kinds">
      <legend className="correction-form__label">Who got it wrong?</legend>
      <label className="correction-form__kind">
        <input type="radio" name={name} data-testid="correction-kind-publisher"
          checked={kind === "publisher-error"} onChange={() => onKind("publisher-error")} />
        <span>The published source is wrong</span>
      </label>
      <label className="correction-form__kind">
        <input type="radio" name={name} data-testid="correction-kind-transformation"
          checked={kind === "transformation-error"} onChange={() => onKind("transformation-error")} />
        <span>Close Knit got it wrong</span>
      </label>
    </fieldset>
  );
}

export function priceDisplay(summary: AreaSummary, metric: MetricDefinition, unit: PriceUnit) {
  const useSqft = metric.id === "price-per-square-metre" && unit === "sqft";
  return {
    value: useSqft && summary.value !== null ? toPricePerSquareFoot(summary.value) : summary.value,
    unit: useSqft ? "£/sqft" : metric.unit,
  };
}

/** Headline value reduced to the crime types still included on the map;
 * percentiles keep describing the full published rate. */
export function crimeSelectionFor(
  summary: AreaSummary,
  excludedCrime: string[],
): { value: number | null; note: string | null } {
  if (summary.metricId !== "crime" || excludedCrime.length === 0) {
    return { value: summary.value, note: null };
  }
  const categories = Object.keys(summary.breakdown ?? {});
  const included = categories.filter((category) => !excludedCrime.includes(category));
  return {
    value: filteredCrimeValue(summary.value, summary.breakdown, included),
    note: `Showing ${included.length} of ${categories.length} recorded crime types. Percentiles describe the full headline rate.`,
  };
}

export const CONFIDENCE_LABEL = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" } as const;

const HOME_KIND_LABELS: Record<HomeCorrectionKind, string> = {
  "publisher-error": "The public record is wrong (price, date or address)",
  "transformation-error": "Our figure is wrong (floor area, £/m², area prices)",
  "privacy-objection": "I live here or own this home — hide it from the map",
};

/** Wording next to the numbers (privacy point 5) plus the report / hide-my-home form. */
export function HomeCorrectionSection({ uprn, addressId, sourceReleaseId, productReleaseId, homePage = null, lead = null, anchor, contact }: {
  uprn: string | null; addressId: string | null; sourceReleaseId: string | null; productReleaseId: string | null;
  /** The home's own page, linked beside the report button. */
  homePage?: string | null;
  /** Words that open the note line. */
  lead?: ReactNode;
  /** The section's id: a link to #anchor (the property page's "Report or hide this home") opens the form. */
  anchor?: string;
  /** Where to write to undo a hide: the server's CLOSE_KNIT_CONTACT_EMAIL, else hello@. */
  contact?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!anchor) return;
    const openOnHash = () => { if (window.location.hash === `#${anchor}`) setOpen(true); };
    openOnHash();
    window.addEventListener("hashchange", openOnHash);
    return () => window.removeEventListener("hashchange", openOnHash);
  }, [anchor]);
  return (
    <section className="home-correction" data-testid="home-correction" id={anchor}>
      <p className="quality-note" data-testid="home-privacy-note">
        {lead}Public-record data <HelpTip id="home-privacy" label="where these figures come from" />{" "}
        Wrong, or your home? <Link href="/privacy">Privacy notice</Link>
      </p>
      {(homePage || !open) && (
        <p className="home-correction__actions">
          {homePage && <Link className="home-correction__page" href={homePage} data-testid="brief-home-page">Home page</Link>}
          {!open && (
            <button type="button" className="chip-button" data-testid="home-correction-open" onClick={() => setOpen(true)}>
              Report or hide this home
            </button>
          )}
        </p>
      )}
      {open && (
        <HomeCorrectionForm uprn={uprn} addressId={addressId} contact={contact ?? contactEmail()}
          sourceReleaseId={sourceReleaseId} productReleaseId={productReleaseId} />
      )}
    </section>
  );
}

function HomeCorrectionForm({ uprn, addressId, sourceReleaseId, productReleaseId, contact }: {
  uprn: string | null; addressId: string | null; sourceReleaseId: string | null; productReleaseId: string | null; contact: string;
}) {
  const [kind, setKind] = useState<HomeCorrectionKind>("privacy-objection");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SubmissionState | null>(null);
  if (outcome) return <HomeCorrectionOutcome outcome={outcome} contact={contact} onReset={() => setOutcome(null)} />;
  return (
    <form data-testid="home-correction-form" onSubmit={(event) => {
      event.preventDefault();
      try {
        const body = homeCorrectionBody({ kind, uprn, addressId, sourceReleaseId, productReleaseId, email, description });
        setError(null);
        setBusy(true);
        void submitCorrection(body).then(setOutcome).finally(() => setBusy(false));
      } catch (validation) {
        setError(validation instanceof Error ? validation.message : "Could not send the request.");
      }
    }}>
      <p className="home-correction__reassure" data-testid="home-correction-reassure">
        You can hide your home at any time. We won&apos;t ask why.
      </p>
      <fieldset className="home-correction__kinds">
        <legend className="sr-only">What would you like to do?</legend>
        {(Object.keys(HOME_KIND_LABELS) as HomeCorrectionKind[]).map((option) => (
          <label key={option} className="home-correction__kind">
            <input type="radio" name="home-correction-kind" data-testid={`home-correction-kind-${option}`}
              checked={kind === option} onChange={() => setKind(option)} />
            <span>{HOME_KIND_LABELS[option]}</span>
          </label>
        ))}
      </fieldset>
      {kind === "privacy-objection" && (
        <>
          <ol className="home-correction__steps" data-testid="home-correction-steps" aria-label="How hiding works">
            <li>We e-mail you a link to confirm the request.</li>
            <li>Open it and the home is hidden from search, history and the map straight away (and in any case within 30 days).</li>
            <li>Changed your mind? Write to <a href={`mailto:${contact}`}>{contact}</a> and we will show it again.</li>
          </ol>
          <label htmlFor="home-correction-email" className="home-correction__email-label">Your e-mail (only a hash is kept)</label>
          <input id="home-correction-email" type="email" data-testid="home-correction-email" value={email}
            className="knit-field home-correction__email"
            autoComplete="email" onChange={(event) => setEmail(event.target.value)} />
          <p className="quality-note">
            Confirming removes this home from search, history and the map{" "}
            <HelpTip id="hide-home" label="hiding a home" />
          </p>
        </>
      )}
      <label htmlFor="home-correction-description">Details (optional)</label>
      <textarea id="home-correction-description" data-testid="home-correction-description" value={description} className="knit-field"
        onChange={(event) => setDescription(event.target.value)} />
      <button type="submit" data-testid="home-correction-send" disabled={busy}>
        {kind === "privacy-objection" ? "Send confirmation link" : "Send report"}
      </button>
      {error && <p data-testid="home-correction-error" role="alert">{error}</p>}
      <p className="home-correction__privacy">
        <Link href="/privacy#hide-my-home" data-testid="home-correction-privacy">How hiding works, in the privacy notice</Link>
      </p>
    </form>
  );
}

function HomeCorrectionOutcome({ outcome, contact = contactEmail(), onReset }: { outcome: SubmissionState; contact?: string; onReset: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  const checkEmail = outcome.status === "sent" && outcome.kind === "privacy-objection"
    && (outcome.confirmationChannel === "smtp" || outcome.confirmationChannel === "webhook");
  // The form (and its focused button) is gone: the panel's heading takes focus.
  useEffect(() => { title.current?.focus(); }, []);
  if (checkEmail) {
    return (
      <div className="home-correction__done" data-testid="home-correction-outcome" data-outcome={outcome.status} role="status">
        <h3 ref={title} tabIndex={-1}>Check your e-mail</h3>
        <p>
          {outcome.confirmationChannel === "smtp" ? "We have sent you a link to confirm the request." : "We will e-mail you a link to confirm the request shortly."}{" "}
          The home is hidden from search, history and the map as soon as you open it.
        </p>
        <p className="home-correction__done-note">
          Nothing there after a few minutes? Look in your spam folder, or write to <a href={`mailto:${contact}`}>{contact}</a>.
        </p>
        <button type="button" className="chip-button" onClick={onReset}>Back</button>
      </div>
    );
  }
  const message = outcome.status === "sent" && outcome.kind === "privacy-objection"
    ? objectionOutcomeMessage(outcome)
    : outcome.status === "sent" ? `Report received (reference ${outcome.id}). Thank you.`
    : outcome.status === "already-hidden" ? "This home is already hidden."
    : outcome.status === "too-many" ? "Too many requests today. Please try again tomorrow."
    : outcome.status === "invalid" ? outcome.message
    : "The request could not be sent. Please try again later.";
  return (
    <p data-testid="home-correction-outcome" data-outcome={outcome.status} role="status">
      {message} <button type="button" onClick={onReset}>Back</button>
    </p>
  );
}

export function EmptyState() {
  return <p className="empty-state">Search a postcode or tap a coloured area to inspect its raw value, comparisons, source, and limitations.</p>;
}

export interface RejectionGuidance {
  href: string;
  label: string;
}

export interface EvidenceRejection {
  heading: string;
  /** Plain words for people; "" for none. */
  detail: string;
  guidance: RejectionGuidance | null;
  /** The machine reason ("evidence-unavailable (status 404)"): a data attribute for support, never shown. */
  reason?: string;
  /** Asks again (a lost connection, a refused or failed read). */
  retry?: () => void;
}

export function UnavailableState({ heading, detail, guidance, reason, retry }: EvidenceRejection) {
  return (
    <div data-testid="evidence-unavailable" data-reason={reason} role="status">
      <p>{heading}</p>
      {detail && <p>{detail}</p>}
      {retry && (
        <p>
          <button type="button" className="link-button" data-testid="evidence-retry" onClick={retry}>Try again</button>
        </p>
      )}
      {guidance && (
        <p>
          <Link href={guidance.href}>{guidance.label}</Link>
        </p>
      )}
    </div>
  );
}

export function useDataHealth() {
  // The area page's server read it (components/section-seed.tsx): start there and skip the fetch.
  const seeded = useSeed(HEALTH_PATH) as DataHealth | null | undefined;
  const [health, setHealth] = useState<DataHealth | null>(() => typeof seeded?.code === "string" ? seeded : null);
  const fromSeed = useRef(seeded !== undefined);
  useEffect(() => {
    if (fromSeed.current) return;
    const controller = new AbortController();
    void fetch(HEALTH_PATH, { signal: controller.signal })
      .then((response) => response.json().catch(() => null))
      .then((payload: DataHealth | null) => {
        if (payload && typeof payload.code === "string") setHealth(payload);
      })
      .catch(reportRequestError);
    return () => controller.abort();
  }, []);
  return health;
}

interface AreaEvidenceOutcome {
  evidence: AreaResponse | null;
  rejection: EvidenceRejection | null;
}

export function useAreaEvidence(
  selected: GeographyId | null,
  metric: MetricDefinition,
  period: string,
  mode: DataMode,
  release: string,
  scope: EvidenceRequestScope,
  onConnection: (status: ConnectionStatus) => void,
  connection?: ConnectionStatus,
) {
  // Ask each metric for a month it is published for (a deep link's ?period is honoured where
  // the metric has it; deprivation on the map's 2026-06 asks for its own 2025-01, never a 404).
  const asked = periodForMetric(metric, period);
  // The area page's server read it (components/section-seed.tsx): start there and skip the fetch.
  const path = selected ? evidencePath(selected, metric, asked, mode, release) : null;
  const seeded = useSeed(path);
  const [outcome, setOutcome] = useState<AreaEvidenceOutcome>(() => seeded === undefined
    ? { evidence: null, rejection: null } : evidenceOutcome(readAreaEvidenceBody(seeded, { mode, release })));
  const seededPath = useRef(seeded === undefined ? null : path);
  // Try again on a failed read: one more attempt of the same request (never the server's seed).
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    seededPath.current = null;
    setOutcome({ evidence: null, rejection: null });
    setAttempt((count) => count + 1);
  }, []);
  // The connection back (window's online event, the probe, any answer elsewhere): a read that failed
  // for want of it is asked again by itself, as a tap on Try again would.
  const wasOffline = useRef(connection === "offline");
  useEffect(() => {
    const recovered = wasOffline.current && connection === "online";
    wasOffline.current = connection === "offline";
    if (recovered && outcome.rejection?.retry) outcome.rejection.retry();
  }, [connection, outcome]);
  useEffect(() => {
    if (path !== null && path === seededPath.current) return;
    seededPath.current = null;
    if (!selected) { setOutcome({ evidence: null, rejection: null }); return; }
    const planned = planEvidenceRequest({
      selected,
      layer: metric.id,
      layerLabel: metric.label,
      metric: metric.id,
      period: asked,
      mode,
      release,
    });
    if (planned.kind === "idle") { setOutcome({ evidence: null, rejection: null }); return; }
    if (planned.kind === "unavailable") {
      setOutcome({
        evidence: null,
        rejection: { heading: "Not in this release yet.", detail: planned.reason, reason: planned.reason, guidance: realConnectionGuidance(planned.reason) },
      });
      return;
    }
    const controller = new AbortController();
    const sequence = scope.issue();
    // A real-mode placeholder definition (the release's months not read yet) may ask a month the metric
    // lacks: its refusal is not an answer, the real definition asks again in a moment.
    const provisional = mode === "real" && isPlaceholderMetric(metric);
    void requestAreaEvidence({ path: planned.path, mode, release }, sharedPoliteFetch, {
      signal: controller.signal,
      scope,
      sequence,
      onConnection,
    })
      .then((result) => {
        if (result.status === "stale") return;
        const early = provisional && result.status === "unavailable" && /status 404\)$/.test(result.reason);
        setOutcome(early ? { evidence: null, rejection: null } : evidenceOutcome(result, retry));
      })
      .catch(reportRequestError);
    return () => controller.abort();
  }, [metric, asked, selected, mode, release, scope, onConnection, path, attempt, retry]);
  return outcome;
}

function evidenceOutcome(result: SettledEvidenceResult, retry?: () => void): AreaEvidenceOutcome {
  if (result.status !== "available") return { evidence: null, rejection: rejectionFor(result, retry) };
  return {
    evidence: {
      schemaVersion: "area-summary.v1",
      summary: result.payload.summary,
      priceTimeline: result.payload.priceTimeline,
      metricTimeline: result.payload.metricTimeline,
      friendlyName: result.payload.friendlyName ?? null,
      postcodeDistrict: result.payload.postcodeDistrict ?? null,
      parentId: result.payload.parentId ?? null,
      rankScope: result.payload.rankScope ?? null,
      bbox: result.payload.bbox ?? null,
    },
    rejection: null,
  };
}

const REAL_DATA_DOCS_HREF = "/guide/demo-vs-real";
const REAL_DATA_GUIDANCE_LABEL = "How real data connects";

const REAL_CONNECTION_REASONS = [
  "evidence-service-unavailable",
  "evidence-service-unreachable",
  "fixture-release-unavailable-in-real-mode",
];

function realConnectionGuidance(reason: string): RejectionGuidance | null {
  const disconnected = REAL_CONNECTION_REASONS.some((marker) => reason.includes(marker));
  return disconnected ? { href: REAL_DATA_DOCS_HREF, label: REAL_DATA_GUIDANCE_LABEL } : null;
}

/**
 * What a refused or failed read says, in plain words: never the machine reason
 * ("evidence-unavailable (status 404)"), which stays in data-reason for support. A lost connection or a
 * refused read (429, 5xx) offers Try again.
 */
function rejectionFor(
  result:
    | { status: "unavailable"; reason: string; sourceVersion?: string }
    | { status: "connection-lost"; reason: string },
  retry?: () => void,
): EvidenceRejection {
  if (result.status === "unavailable" && result.sourceVersion !== undefined) {
    return {
      heading: "Real data is unavailable for this area.",
      detail: "Only real figures show here, never examples.",
      reason: result.reason,
      guidance: { href: REAL_DATA_DOCS_HREF, label: REAL_DATA_GUIDANCE_LABEL },
    };
  }
  if (result.status === "connection-lost" || /status 429\)/.test(result.reason)) {
    return {
      heading: "This area didn't load.", detail: "Usually for a moment only.", reason: result.reason, retry,
      guidance: realConnectionGuidance(result.reason),
    };
  }
  return { heading: "No figure for this area yet.", detail: "Try another layer.", reason: result.reason, guidance: realConnectionGuidance(result.reason) };
}

const NO_HISTORY = { record: null, demo: null };

/**
 * The chosen home's recorded sales. Real mode reads the property profile
 * (the dossier route never answers for a real UPRN); demo mode reads the
 * dossier (its `demo` history; only its recorded sales are shown).
 */
export function usePropertyHistory(uprn: string | null, mode: DataMode) {
  const [history, setHistory] = useState<{ record: SaleRecord | null; demo: PropertyHistory | null }>(NO_HISTORY);
  useEffect(() => {
    if (!uprn) { setHistory(NO_HISTORY); return; }
    const controller = new AbortController();
    const path = `/api/v1/properties/${encodeURIComponent(uprn)}/${mode === "real" ? "profile" : "history"}`;
    void politeFetch(path, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: Partial<PropertyProfileResponse & { history: PropertyHistory }> | null) => {
        if (mode === "real") setHistory({ record: payload?.profile ? fromProfile(payload.profile) : null, demo: null });
        else setHistory({ record: payload?.history ?? null, demo: payload?.history ?? null });
      })
      .catch(reportRequestError);
    return () => controller.abort();
  }, [uprn, mode]);
  return history;
}

export function useHomeSummary(uprn: string | null) {
  const [property, setProperty] = useState<PropertySummary | null>(null);
  useEffect(() => {
    if (!uprn) { setProperty(null); return; }
    const controller = new AbortController();
    void politeFetch(`/api/v1/properties/${encodeURIComponent(uprn)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { property: PropertySummary } | null) => setProperty(payload?.property ?? null))
      .catch(reportRequestError);
    return () => controller.abort();
  }, [uprn]);
  return property;
}

export function useAddressHistory(addressId: AddressId | null) {
  const [history, setHistory] = useState<AddressHistory | null>(null);
  useEffect(() => {
    if (!addressId) { setHistory(null); return; }
    const controller = new AbortController();
    void politeFetch(`/api/v1/addresses/${encodeURIComponent(addressId)}/history`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { history: AddressHistory } | null) => setHistory(payload?.history ?? null))
      .catch(reportRequestError);
    return () => controller.abort();
  }, [addressId]);
  return history;
}

function reportRequestError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return;
  console.error("Close Knit evidence request failed", error);
}

