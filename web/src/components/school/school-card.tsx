/**
 * One school on one page (docs/area-card-2026-10/school-card-open-spec.md): the header (name, type tags, the Ofsted
 * badge and one ☰ menu holding every source, licence, definition and method note), then every section open, in the
 * order a parent decides by: Results, Getting in, Visit & links, Inspections, Pupils, Parent View, Workforce, Financials, Destinations.
 * Each figure sits against London and its borough on one CompareRow; a disclosure only holds long detail (Ofsted's
 * words, results by year, the preference table). Every figure is published open data with its year (said once, in the
 * section heading, or beside a figure from another year); a section with none says "No data" and why.
 * Server-rendered: the menu is a native popover, no client state.
 */
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { SaveItemButton } from "@/components/save-item-button";

import { Dot } from "@/components/knit";
import { KnitIcon } from "@/components/knit/knit-icon";
import { SatinBar, SatinBlock, SatinStacked, SatinSteps, StemLine } from "@/components/knit/satin";
import { areaPath } from "@/lib/area-pages";
import type { GeographyId } from "@/lib/contracts";
import { guidePath } from "@/lib/guide-slugs";
import { ratingLabel, ratingModel } from "@/lib/rating";
import {
  cardSections, compareText, compareTone, distanceVerdict, entryPointLabel, formatDay, formatFte, formatKm, formatMeasure, shownPlaces, followUpShare,
  formatMonthYear, formatPounds, HEADLINE_MEASURES, inspectionDot, inspectionMark, latestPoint, lowestArea, missingLine, offeredGroups, offeredText, ofstedStanding,
  oversubscriptionGroups, firstChoiceOfferedPercent, rankSlots, resultsSlots, schoolHeaderTags, schoolPath, standingMark,
  type CardSection, type CompareKey, type CompareMeasure, type GradeTone, type LastOffered, type NationalRank, type OfferedGroup, type OfstedStanding,
  type ParentViewQuestion, type ResultsSlot, type SchoolCard, type SchoolInspection, type SchoolDemand, type SchoolDestination, type SchoolKpi,
  type SchoolMeasure, type SectionId, type TopBadge, scopeName,
} from "@/lib/school-card";

import { OFSTED_COLOUR, OFSTED_LABEL, type OfstedMark } from "@/lib/school-icons";

import { OfstedIcon } from "./ofsted-icon";
import { SchoolLinksBody } from "./school-links";
import "./school-card.css";

const TONE_COLOUR: Record<GradeTone | "none", string> = {
  good: "var(--chart-good)", neutral: "var(--chart-neutral)", bad: "var(--chart-bad)", none: "color-mix(in srgb, var(--muted) 40%, var(--surface))",
};

/** An inspection's dot: the map cap's Ofsted colour for a single grade, else its tone. */
function inspectionColour(inspection: SchoolInspection, tone: GradeTone | "none"): string {
  const mark = inspectionMark(inspection);
  return mark ? OFSTED_COLOUR[mark] : TONE_COLOUR[tone];
}

const capitalise = (text: string) => text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;

/** Straight-line km from the centre of the area the card was opened from (?from=), and that area's name. */
export type FromArea = { name: string; km: number };

/** "inspected May 2024": the one Ofsted date the card shows (the day the inspection started). */
const inspected = (date: string | null) => (date ? `inspected ${formatMonthYear(date)}` : "date unknown");

/** `homesNear`: "Homes near this school", right under the header (it carries the area link too). */
export function SchoolCardView({ card, distance = null, homesNear = null }: { card: SchoolCard; distance?: FromArea | null; homesNear?: ReactNode }) {
  const standing = ofstedStanding(card.history.inspections);
  const sections = cardSections(card);
  return (
    <article className="school-card-view" data-testid="school-card" data-phase={card.school.phase}>
      <SchoolHeader card={card} standing={standing} distance={distance} sections={sections} />
      {homesNear}
      <div className="sc-sections" data-testid="school-sections">
        {sections.map((section) => (
          <Section key={section.id} section={section}>
            {/* Getting in still shows how far the user's area is when no distance was published. */}
            {(section.missing === null || (section.id === "getting-in" && distance)) && (
              <SectionBody section={section} card={card} standing={standing} distance={distance} />
            )}
          </Section>
        ))}
      </div>
      {!homesNear && card.areaId && /^uk:(lsoa|msoa|lad):E\d{8}$/.test(card.areaId) && (
        <p className="sc-homes">
          <Link href={areaPath({ geographyId: card.areaId as GeographyId })} data-testid="school-area-link">
            <KnitIcon name="home" className="sc-icon" /> Homes and area around this school
          </Link>
        </p>
      )}
    </article>
  );
}

function SectionBody({ section, card, standing, distance }: { section: CardSection; card: SchoolCard; standing: OfstedStanding | null; distance: FromArea | null }) {
  switch (section.id) {
    case "results": return <ResultsBody card={card} />;
    case "getting-in": return <GettingIn card={card} distance={distance} />;
    case "links": return card.links ? <SchoolLinksBody links={card.links} standing={standing} /> : null;
    case "inspections": return <InspectionsBody card={card} standing={standing} />;
    case "pupils": return <PupilsBody card={card} year={section.year} />;
    case "parent-view": return card.parentView ? <ParentViewBody card={card} /> : null;
    case "workforce": return card.workforce ? <WorkforceBody card={card} /> : null;
    case "finance": return card.finance ? <FinanceBody card={card} /> : null;
    case "destinations": return card.destinations ? <DestinationsBody card={card} /> : null;
  }
}

const SECTION_ICON: Record<SectionId, string> = {
  results: "trend", "getting-in": "key", links: "home", inspections: "note", pupils: "people", "parent-view": "heart", workforce: "family", finance: "income", destinations: "school",
};

/** A section: its heading with the year once, then its content, always open; or one muted line saying why it is empty. */
function Section({ section, children }: { section: CardSection; children: ReactNode }) {
  const { id, title, year, missing } = section;
  return (
    <section className="sc-section" data-testid="school-section" data-section={id} data-empty={missing !== null ? "" : undefined} aria-labelledby={`sc-${id}`}>
      <h2 className="sc-h2" id={`sc-${id}`}>
        <KnitIcon name={SECTION_ICON[id]} className="sc-h2__icon" />
        <span>{title}{year && <span className="sc-h2__year"> · {year}</span>}</span>
      </h2>
      {missing !== null && <p className="sc-unknown" data-testid="school-section-missing">{missingLine(missing).line}</p>}
      {children}
    </section>
  );
}

// ---- Header -------------------------------------------------------------------------------------

function SchoolHeader({ card, standing, distance, sections }: { card: SchoolCard; standing: OfstedStanding | null; distance: FromArea | null; sections: CardSection[] }) {
  const { school } = card;
  const tags = schoolHeaderTags(card);
  return (
    <header className="sc-head">
      <div className="sc-head__top">
        <p className="sc-eyebrow">
          <KnitIcon name={school.phase === "primary" ? "building-school" : "school"} className="sc-icon" />
          {capitalise(school.phase)} school
        </p>
        <span className="sc-head__actions">
          <SaveItemButton item={{ kind: "school", id: card.urn, name: school.name, meta: `${capitalise(school.phase)} school`,
            href: schoolPath(card.urn), at: [school.longitude, school.latitude] }} testId="school-save" />
          <SourcesMenu card={card} standing={standing} distance={distance} sections={sections} />
        </span>
      </div>
      <h1 className="sc-name">{school.name}</h1>
      <ul className="sc-tags" data-testid="school-tags">{tags.map((tag, index) => <li key={index}>{tag}</li>)}</ul>
      <div className="sc-badges" data-testid="school-badges">
        <OfstedBadge standing={standing} />
        {/* No result chips: Results says how high and how it moved; why a school is Top sits in the ☰ menu. */}
        <TopSchoolBadge badge={card.topBadge} />
      </div>
    </header>
  );
}

/** The latest Ofsted standing, once: a legacy grade, or (report card, 2024–25) the lowest area's colour and never an overall word. */
function OfstedBadge({ standing }: { standing: OfstedStanding | null }) {
  if (!standing) return <span className="sc-chip" data-testid="ofsted-badge">Ofsted: not inspected yet</span>;
  const areas = standing.kind === "areas" ? standing : null;
  const tone = areas ? lowestArea(areas)?.tone ?? "none" : standing.kind === "legacy" ? standing.tone : "none";
  const title = standing.kind === "legacy" ? `Ofsted ${standing.grade}`
    : standing.framework === "report-card" ? "Ofsted report card" : "Ofsted areas (no overall grade)";
  const mark = standingMark(standing);
  // The map cap's top for a single grade or a report card; 2024–25 area grades: the weakest area's tone.
  const swatch = mark || !areas
    ? <OfstedIcon mark={mark} label={null} size={20} className="sc-ofsted__top" />
    : <Dot colour={TONE_COLOUR[tone]} size={12} />;
  const body = <>{swatch}{title} · {inspected(standing.date)}</>;
  const framework = areas ? areas.framework : "legacy";
  return standing.reportUrl
    ? <a className="sc-ofsted" data-tone={tone} data-framework={framework} data-testid="ofsted-badge" href={standing.reportUrl}>{body}</a>
    : <span className="sc-ofsted" data-tone={tone} data-framework={framework} data-testid="ofsted-badge">{body}</span>;
}

function TopSchoolBadge({ badge }: { badge: TopBadge }) {
  if (!badge.isTop) return null;
  return (
    <span className="sc-chip sc-top" title={badge.criteria} data-testid="top-school-badge">
      <KnitIcon name="star" colour="currentColor" className="sc-icon" /> Top school {badge.year}
    </span>
  );
}

// ---- Shared pieces ------------------------------------------------------------------------------------

/** A disclosure for long detail only ("Read what Ofsted said (5)", "Show by year", "By preference"). */
function More({ summary, className, testId, children }: { summary: string; className?: string; testId?: string; children: React.ReactNode }) {
  return (
    <details className={`sc-more${className ? ` ${className}` : ""}`} data-testid={testId}>
      <summary>{summary}<KnitIcon name="chevron-down" colour="currentColor" className="sc-more__chevron" /></summary>
      <div className="sc-more__body">{children}</div>
    </details>
  );
}

/** Short facts joined by "·", each wrapping whole, never mid-phrase. */
function Facts({ items, testId }: { items: ReactNode[]; testId?: string }) {
  const shown = items.filter((item) => item !== null && item !== false && item !== undefined && item !== "");
  if (shown.length === 0) return null;
  return (
    <p className="sc-caption sc-facts" data-testid={testId}>
      {shown.map((item, index) => (
        <Fragment key={index}>
          <span>{item}{index < shown.length - 1 ? " ·" : ""}</span>{index < shown.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </p>
  );
}

/** Value + short label tiles (money). */
type Tile = { id: string; value: string; label: string; tone?: GradeTone; extra?: React.ReactNode };

function Tiles({ tiles, testId }: { tiles: Tile[]; testId?: string }) {
  if (tiles.length === 0) return null;
  return (
    <ul className="sc-numbers" data-testid={testId}>
      {tiles.map((tile) => (
        <li key={tile.id} className="sc-number" data-number={tile.id} data-tone={tile.tone}>
          <span className="sc-number__value">{tile.value}</span>
          <span className="sc-number__label">{tile.label}</span>
          {tile.extra}
        </li>
      ))}
    </ul>
  );
}

// ---- One comparison graphic, used everywhere ------------------------------------------------------------

/**
 * A figure against London and its borough: the label and value, then a dot on London's 10th–90th percentile
 * track with ticks for the London median (L) and the borough median (its initial, when 10+ of its schools have one),
 * and "London x · Ealing y" in grey. Colour only where a direction is clearly better (compareTone). Without a
 * comparison (preview data, a withheld figure) it is the label and value alone.
 */
function CompareRow({ id, label, value, year = null, measure = null }: { id: string; label: string; value: string; year?: string | null; measure?: CompareMeasure | null }) {
  const tone = measure ? compareTone(measure) : null;
  const shown = measure ? compareText(measure.value, measure.unit) : value;
  const text = (figure: number) => compareText(figure, measure!.unit);
  const scope = measure?.scope ?? "London";
  const spoken = `${label}${year ? ` (${year})` : ""}: ${shown}${measure
    ? `; ${scope} median ${text(measure.london.median)}${measure.borough ? `, ${measure.borough.name} median ${text(measure.borough.median)}` : ""}; ${scope}'s middle 80% ${text(measure.london.p10)} to ${text(measure.london.p90)}`
    : ""}`;
  return (
    <div className="sc-cmp" role="group" aria-label={spoken} data-testid="school-compare" data-measure={id} data-tone={tone ?? undefined}>
      <span className="sc-cmp__label">{label}{year && <small> · {year}</small>}</span>
      <span className="sc-cmp__value" data-testid="school-compare-value">{shown}</span>
      {measure && <CompareTrack measure={measure} tone={tone} />}
      {measure && (
        <span className="sc-cmp__ref" data-testid="school-compare-ref" aria-hidden="true">
          {scope} {text(measure.london.median)}{measure.borough && <> · {measure.borough.name} {text(measure.borough.median)}</>}
        </span>
      )}
    </div>
  );
}

const TRACK = { width: 140, height: 28, y: 19, label: 10 };

function CompareTrack({ measure, tone }: { measure: CompareMeasure; tone: GradeTone | null }) {
  const { value, london, borough } = measure;
  const points = [value, london.p10, london.p90, london.median, ...(borough ? [borough.median] : [])];
  let low = Math.min(...points);
  let high = Math.max(...points);
  const pad = (high - low) * 0.04 || Math.abs(high) * 0.1 || 1;
  low -= pad; high += pad;
  const x = (figure: number) => 7 + ((figure - low) / (high - low)) * (TRACK.width - 14);
  const xl = x(london.median);
  const xb = borough ? x(borough.median) : null;
  // Ticks closer than a letter: the two letters sit either side (the borough's on the left when they meet).
  const near = xb !== null && Math.abs(xb - xl) < 10;
  const left = xb !== null && xb <= xl;
  const label = (side: "left" | "right"): { textAnchor: "start" | "middle" | "end"; dx: number } =>
    (near ? { textAnchor: side === "left" ? "end" : "start", dx: side === "left" ? -2 : 2 } : { textAnchor: "middle", dx: 0 });
  return (
    <svg className="sc-cmp__track" width={TRACK.width} height={TRACK.height} viewBox={`0 0 ${TRACK.width} ${TRACK.height}`} aria-hidden="true">
      <line className="sc-cmp__axis" x1={0} x2={TRACK.width} y1={TRACK.y} y2={TRACK.y} />
      <SatinBlock x={x(london.p10)} y={TRACK.y - 4} width={x(london.p90) - x(london.p10)} height={8} colour="var(--wool)" slant={3} seed={7} />
      {xb !== null && (
        <g className="sc-cmp__tick sc-cmp__tick--borough">
          <line x1={xb} x2={xb} y1={TRACK.y - 7} y2={TRACK.y + 7} />
          <text x={xb} y={TRACK.label} {...label(left ? "left" : "right")}>{borough!.name[0]}</text>
        </g>
      )}
      <g className="sc-cmp__tick">
        <line x1={xl} x2={xl} y1={TRACK.y - 7} y2={TRACK.y + 7} />
        <text x={xl} y={TRACK.label} {...label(left ? "right" : "left")}>L</text>
      </g>
      <circle className="sc-cmp__dot" cx={x(value)} cy={TRACK.y} r={5} style={{ fill: tone ? TONE_COLOUR[tone] : "var(--ink)" }} />
    </svg>
  );
}

// ---- Results ---------------------------------------------------------------------------------------------

function ResultsBody({ card }: { card: SchoolCard }) {
  return (
    <>
      <div className="sc-cols">
        <NationalRankBlock card={card} />
        <SixthFormRankBlock card={card} />
        <KpiList card={card} />
      </div>
      <ResultsCharts card={card} />
    </>
  );
}

/** Against London: one compact row per measure (value, /10 steps, London median, trend arrow). */
function KpiList({ card }: { card: SchoolCard }) {
  if (card.kpis.length === 0) return null;
  const year = card.nationalRank?.year ?? card.kpis.find((kpi) => kpi.year)?.year ?? null;
  // The arrows' shared start year is said once, beside the heading: without it a red "−9 pts" reads as a gap to London.
  const trendFrom = kpiTrendFrom(card);
  return (
    <div className="sc-block">
      <h3 className="sc-h3">
        Against {scopeName(card)}
        {trendFrom && <small className="sc-h3__note" data-testid="school-kpi-trend-from">Arrows: {scopeName(card)} rank change since {trendFrom}</small>}
      </h3>
      <div className="sc-kpis" data-testid="school-kpis">
        {card.kpis.map((kpi) => <KpiLine key={kpi.measure} kpi={kpi} unit={unitOf(card, kpi.measure)} year={year} trendFrom={trendFrom} />)}
      </div>
    </div>
  );
}

/** The start year every trend arrow shares ("2018/19"), else null (each arrow then says its own). */
function kpiTrendFrom(card: SchoolCard): string | null {
  const froms = new Set(card.kpis.flatMap((kpi) => (kpi.trend && kpi.trend.direction !== "flat" ? [kpi.trend.fromYear] : [])));
  return froms.size === 1 ? [...froms][0] : null;
}

function unitOf(card: SchoolCard, measure: string): string | null {
  return card.history.measures.find((entry) => entry.id === measure)?.unit ?? null;
}

/** "2018/19" → "18/19". */
const shortYear = (year: string) => year.replace(/^\d{2}(\d{2}\/\d{2})$/, "$1");

function KpiLine({ kpi, unit, year, trendFrom }: { kpi: SchoolKpi; unit: string | null; year: string | null; trendFrom: string | null }) {
  // The London median to the school's own precision (Attainment 8 87.3 · London 50.2, not 50.15).
  const median = kpi.regionMedian !== null ? formatMeasure(kpi.regionMedian, unit, shownPlaces(kpi.valueText)) : null;
  const scope = kpi.scope ?? "London";
  const model = ratingModel(kpi.percentile, true, undefined, scope);
  const fact = kpi.percentile === null
    ? (kpi.missingReason ?? "Not enough data")
    : `${kpi.year ?? ""}${median ? ` · ${scope} median ${median}` : ""}${kpi.cohortSize ? ` · ${kpi.cohortSize} pupils` : ""}`;
  const trend = kpi.trend && kpi.trend.direction !== "flat" ? kpi.trend : null;
  return (
    <div className="sc-kpi" role="group" data-testid="school-kpi" data-measure={kpi.measure}
      aria-label={ratingLabel({ label: kpi.label, percentile: kpi.percentile, higherIsBetter: true, fact, scope })}>
      <span className="sc-kpi__label">{kpi.label}{kpi.year && kpi.year !== year && <span className="sc-kpi__year"> · {kpi.year}</span>}</span>
      <span className="sc-kpi__value">
        <span data-testid="school-kpi-value">{kpi.valueText}</span>
        {median && <small className="sc-kpi__median"> · {scope} {median}</small>}
      </span>
      {kpi.percentile === null
        ? <span className="sc-kpi__facts sc-kpi__missing">{kpi.missingReason ?? "Not enough data"}</span>
        : (
          <span className="sc-kpi__facts">
            <span className="rating sc-kpi__score" data-tone={model.tone}>
              <SatinSteps count={10} filled={model.steps} colour="var(--rating-colour)" width={60} height={8} className="sc-kpi__steps" />
              <span><strong>{model.score}</strong>/10 {model.band}</span>
            </span>
            {trend && (
              <span className="sc-kpi__trend" data-trend={trend.direction} title={`Change in ${scope} percentile points since ${trend.fromYear}`}>
                <KnitIcon name={trend.direction === "up" ? "rise" : "fall"} colour="currentColor" className="sc-icon" />
                {trend.deltaPoints > 0 ? "+" : "−"}{Math.abs(trend.deltaPoints)} pts
                {trend.fromYear !== trendFrom && <> since {shortYear(trend.fromYear)}</>}
              </span>
            )}
          </span>
        )}
    </div>
  );
}

// ---- Results by year -----------------------------------------------------------------------------

/** The yearly charts as small multiples behind "Show by year"; the latest values are in Against London, not repeated here. */
function ResultsCharts({ card }: { card: SchoolCard }) {
  const charts = HEADLINE_MEASURES[card.school.phase]
    .map((id) => card.history.measures.find((measure) => measure.id === id))
    .filter((measure): measure is SchoolMeasure => Boolean(measure?.series.some((point) => typeof point.value === "number" || point.suppressed)));
  if (charts.length === 0) return null;
  // Gaps every chart shares ("No exams 2019/20–21") are said once, under the legend.
  const gaps = charts.map((measure) => gapNotes(resultsSlots(measure, card.regionMedian[measure.id] ?? [])));
  const shared = gaps[0].filter((note) => gaps.every((notes) => notes.includes(note)));
  return (
    <More summary={`Show ${card.school.phase === "primary" ? "KS2 results" : "exam results"} by year`} className="sc-byyear" testId="school-by-year">
      <p className="sc-legend" aria-hidden="true">
        <span className="sc-legend__school">This school</span>
        <span className="sc-legend__london">{scopeName(card)} median</span>
        <span className="sc-legend__hollow">Withheld (few pupils)</span>
      </p>
      {shared.length > 0 && <p className="sc-chart__gaps" data-testid="school-chart-gaps">{shared.map((note) => <span key={note}>{note}</span>)}</p>}
      <div className="sc-charts">
        {charts.map((measure) => (
          <ResultsChart key={measure.id} measure={measure} shared={shared}
            label={card.kpis.find((kpi) => kpi.measure === measure.id)?.label ?? measure.label}
            medians={card.regionMedian[measure.id] ?? []} scope={scopeName(card)} />
        ))}
      </div>
    </More>
  );
}


/** A small multiple: about 120px tall at phone width, two to a row. */
const CHART = { width: 160, height: 116, top: 18, bottom: 16, left: 6, right: 6 };
/** Value labels stay at least 11px at phone width: at 390px two charts to a row draw the SVG at ~96% of its size. */
const LABEL_SIZE = 11.5;

/** Straight segments through the points: a smoothed curve would exaggerate a year-to-year swing. */
const straight = (points: readonly (readonly [number, number])[]) => `M${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join("L")}`;

/** A chart's gap notes: years with no exams, not published, or withheld. */
function gapNotes(slots: readonly ResultsSlot[]): string[] {
  const noExams = gapSpans(slots, "no-exams");
  const notPublished = slots.filter((slot) => slot.gap === "not-published").map((slot) => slot.year);
  const withheld = slots.filter((slot) => slot.suppressed).map((slot) => slot.year);
  return [
    noExams.length > 0 ? `No exams ${spanText(slots, noExams)}` : null,
    notPublished.length > 0 ? `Not published ${yearsText(notPublished)}` : null,
    withheld.length > 0 ? `Withheld ${yearsText(withheld)}` : null,
  ].filter((note): note is string => note !== null);
}

function ResultsChart({ measure, label, medians, shared, scope = "London" }: {
  measure: SchoolMeasure; label: string; medians: { academicYear: string; value: number }[]; shared: string[]; scope?: string;
}) {
  const slots = resultsSlots(measure, medians);
  const values = slots.flatMap((slot) => [slot.value, slot.median]).filter((value): value is number => value !== null);
  if (slots.length === 0 || values.length === 0) return null;
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = (high - low) * 0.15 || Math.abs(high) * 0.1 || 1;
  low -= pad; high += pad;
  const step = (CHART.width - CHART.left - CHART.right) / Math.max(1, slots.length - 1);
  const x = (index: number) => CHART.left + index * step;
  const y = (value: number) => CHART.top + (1 - (value - low) / (high - low)) * (CHART.height - CHART.top - CHART.bottom);
  const runs = splitRuns(slots, (slot) => slot.value);
  // Printed values, no hover needed: the lowest and highest year.
  const valued = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.value !== null);
  const highest = valued.reduce<typeof valued[number] | null>((best, entry) => (!best || entry.slot.value! > best.slot.value! ? entry : best), null);
  const lowest = valued.reduce<typeof valued[number] | null>((best, entry) => (!best || entry.slot.value! < best.slot.value! ? entry : best), null);
  const marks = [highest && { ...highest, place: "above" as const }, lowest && lowest.index !== highest?.index && { ...lowest, place: "below" as const }]
    .filter((mark): mark is NonNullable<typeof highest> & { place: "above" | "below" } => Boolean(mark));
  const anchor = (index: number) => (index === 0 ? "start" : index === slots.length - 1 ? "end" : "middle");
  const base = CHART.height - 3;
  const medianRuns = splitRuns(slots, (slot) => slot.median);
  const noExams = gapSpans(slots, "no-exams");
  const notes = gapNotes(slots).filter((note) => !shared.includes(note));
  const latest = [...slots].reverse().find((slot) => slot.value !== null);
  const first = slots.find((slot) => slot.value !== null);
  const fmt = (value: number) => formatMeasure(value, measure.unit);
  const spoken = `${label}: ${first ? `${fmt(first.value!)} in ${first.year}` : ""}${latest && latest !== first ? ` to ${fmt(latest.value!)} in ${latest.year}` : ""}`
    + `${latest?.median != null ? `; ${scope} median ${fmt(latest.median)}` : ""}.`;
  const half = step / 2;
  return (
    <figure className="sc-chart" data-testid="school-results-chart" data-measure={measure.id}>
      <figcaption className="sc-chart__head">
        <span className="sc-chart__label">{label}</span>
      </figcaption>
      <div className="sc-chart__plot">
        <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={spoken}>
          {noExams.map(([from, to]) => (
            <rect key={from} className="sc-chart__gap" x={x(from) - half} y={0} width={(to - from + 1) * step} height={CHART.height} />
          ))}
          <line className="sc-chart__base" x1={0} x2={CHART.width} y1={base} y2={base} />
          {medianRuns.map((run, index) => (
            <path key={`m${index}`} className="sc-chart__median" d={run.length > 1 ? `M${run.map((i) => `${x(i)},${y(slots[i].median!)}`).join("L")}` : `M${x(run[0]) - 4},${y(slots[run[0]].median!)}h8`} />
          ))}
          {runs.map((run, index) => (
            <g key={`s${index}`} className="stem">
              <StemLine d={straight(run.length > 1 ? run.map((i) => [x(i), y(slots[i].value!)] as const) : [[x(run[0]) - 2, y(slots[run[0]].value!)], [x(run[0]) + 2, y(slots[run[0]].value!)]])}
                colour="var(--chart-1)" width={2.2} />
            </g>
          ))}
          {slots.map((slot, index) => slot.value !== null ? (
            <circle key={slot.year} className="sc-chart__dot" cx={x(index)} cy={y(slot.value)} r={3.2}>
              <title>{`${slot.year}: ${fmt(slot.value)}${slot.cohortSize ? ` · ${slot.cohortSize} pupils` : ""}${slot.median !== null ? ` · ${scope} ${fmt(slot.median)}` : ""}`}</title>
            </circle>
          ) : slot.suppressed ? (
            <circle key={slot.year} className="sc-chart__hollow" cx={x(index)} cy={y(slot.median ?? (low + high) / 2)} r={3.2}>
              <title>{`${slot.year}: withheld${slot.cohortSize ? ` (${slot.cohortSize} pupils)` : ""}`}</title>
            </circle>
          ) : null)}
          {marks.map(({ slot, index, place }) => (
            <text key={place} className="sc-chart__value" data-testid="school-chart-value" data-place={place}
              x={x(index)} y={y(slot.value!) + (place === "above" ? -7 : 7 + LABEL_SIZE * 0.8)}
              textAnchor={anchor(index)} fontSize={LABEL_SIZE}>
              {fmt(slot.value!)}
            </text>
          ))}
        </svg>
        {noExams.map(([from, to]) => (
          <span key={from} className="sc-chart__gap-label" data-testid="school-chart-gap"
            style={{ left: `${((x(from) - half) / CHART.width) * 100}%`, width: `${(((to - from + 1) * step) / CHART.width) * 100}%` }}>
            No exams
          </span>
        ))}
      </div>
      <div className="sc-chart__years" aria-hidden="true"><span>{slots[0].year}</span><span>{slots.at(-1)!.year}</span></div>
      {notes.length > 0 && <p className="sc-chart__gaps">{notes.map((note) => <span key={note}>{note}</span>)}</p>}
    </figure>
  );
}

/** Indexes of consecutive slots with a value, one run per unbroken stretch. */
function splitRuns(slots: readonly ResultsSlot[], pick: (slot: ResultsSlot) => number | null): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  slots.forEach((slot, index) => {
    if (pick(slot) !== null) run.push(index);
    else if (run.length) { runs.push(run); run = []; }
  });
  if (run.length) runs.push(run);
  return runs;
}

/** [from, to] index spans of consecutive slots with this gap. */
function gapSpans(slots: readonly ResultsSlot[], gap: ResultsSlot["gap"]): [number, number][] {
  const spans: [number, number][] = [];
  slots.forEach((slot, index) => {
    if (slot.gap !== gap) return;
    const last = spans.at(-1);
    if (last && last[1] === index - 1) last[1] = index;
    else spans.push([index, index]);
  });
  return spans;
}

const spanText = (slots: readonly ResultsSlot[], spans: [number, number][]) =>
  spans.map(([from, to]) => from === to ? slots[from].year : `${slots[from].year}–${slots[to].year.slice(5)}`).join(", ");
const yearsText = (years: string[]) => years.join(", ");

// ---- Ofsted's words ----------------------------------------------------------------------------------

function OfstedWords({ card }: { card: SchoolCard }) {
  const tldr = card.tldr!;
  const date = tldr.inspectionDate ? inspected(tldr.inspectionDate) : `published ${formatDay(tldr.publicationDate)}`;
  return (
    <More summary={`Read what Ofsted said (${tldr.strengths.length + tldr.improve.length})`} testId="school-tldr">
      <p className="sc-caption">
        {tldr.reportUrl
          ? <a className="sc-link" href={tldr.reportUrl} data-testid="school-tldr-report">From Ofsted report, {date}</a>
          : <>From Ofsted report, {date}</>}
        {tldr.inspectedAsPredecessor && " (inspected as predecessor)"}
      </p>
      <div className="sc-tldr">
        {tldr.strengths.length > 0 && (
          <div className="sc-tldr__col">
            <h4 className="sc-h4"><KnitIcon name="thumb-up" className="sc-icon" /> Strengths</h4>
            <ul>{tldr.strengths.map((line) => <li key={line}>“{line}”</li>)}</ul>
          </div>
        )}
        {tldr.improve.length > 0 && (
          <div className="sc-tldr__col">
            <h4 className="sc-h4"><KnitIcon name="note" className="sc-icon" /> To improve</h4>
            <ul>{tldr.improve.map((line) => <li key={line}>“{line}”</li>)}</ul>
          </div>
        )}
      </div>
      <p className="sc-fine">{tldr.attribution}</p>
    </More>
  );
}

// ---- Inspections (with strengths & weaknesses) -----------------------------------------------------------

/** Single grades and report cards take the map cap's colours (OFSTED_COLOUR); area grades and visits keep these tones. */
const OFSTED_ORDER: OfstedMark[] = ["outstanding", "good", "requires-improvement", "inadequate", "report-card"];
const TIMELINE_KEY: { tone: GradeTone | "none"; label: string }[] = [
  { tone: "good", label: "Good or better" },
  { tone: "neutral", label: "Expected standard" },
  { tone: "bad", label: "Requires improvement or below" },
  { tone: "none", label: "Ungraded visit, no grade" },
];

/** The header badge holds the latest standing; here: the report card's areas, every inspection, what was strong and weak, Ofsted's words. */
function InspectionsBody({ card, standing }: { card: SchoolCard; standing: OfstedStanding | null }) {
  const areas = standing?.kind === "areas" ? standing : null;
  return (
    <div className="sc-block" data-testid="school-inspections">
      {areas && <AreaGrid standing={areas} />}
      <InspectionTimeline card={card} />
      {card.inspectionCounts && <StrengthsBody card={card} gridShown={areas !== null} />}
      {card.tldr && <OfstedWords card={card} />}
    </div>
  );
}

/** Report card (5 grades) or 2024–25 area grades (4 grades): one satin meter per area, never an overall word. */
function AreaGrid({ standing }: { standing: Extract<OfstedStanding, { kind: "areas" }> }) {
  const scale = standing.framework === "report-card"
    ? ["Urgent improvement", "Needs attention", "Expected", "Strong", "Exceptional"]
    : ["Inadequate", "Requires improvement", "Good", "Outstanding"];
  return (
    <ul className="sc-areas__grid" data-testid="school-ofsted-areas" data-framework={standing.framework}>
      {standing.areas.map((area) => (
        <li key={area.name}>
          <span className="sc-areas__name">{area.name}</span>
          <SatinSteps count={scale.length} filled={Math.max(1, scale.indexOf(area.grade) + 1)} colour={TONE_COLOUR[area.tone]}
            width={60} height={10} className="sc-areas__steps" />
          <span className="sc-areas__grade">{area.grade}</span>
        </li>
      ))}
      {standing.safeguarding && (
        <li>
          <span className="sc-areas__name">Safeguarding</span>
          <KnitIcon name={/^(Met|Effective)$/.test(standing.safeguarding) ? "check" : "cross"} colour="currentColor" className="sc-icon" />
          <span className="sc-areas__grade">{standing.safeguarding}</span>
        </li>
      )}
    </ul>
  );
}

/** A timeline stop's grade: "Report card, lowest Expected" → "Lowest Expected"; short: "Outstanding" → "Outst.". */
function stopLabel(label: string, short = false): string {
  const text = label.replace(/^(Report card|Areas graded), lowest /, "Lowest ");
  return short ? text.replace(/Outstanding/, "Outst.").replace(/Requires improvement/, "Req. impr.").replace(/^Ungraded visit$/, "Ungraded") : text;
}

/** Oldest → newest across the row: a coloured dot per inspection, its year and grade; each stop opens its report. One inspection is the badge alone. */
function InspectionTimeline({ card }: { card: SchoolCard }) {
  const inspections = card.history.inspections.slice(0, 8).map((inspection) => ({ inspection, dot: inspectionDot(inspection) }));
  if (inspections.length < 2) return null;
  const [latest] = inspections;
  return (
    <ol className="sc-timeline" data-testid="school-timeline" data-many={inspections.length >= 5 ? "" : undefined}>
      {[...inspections].reverse().map(({ inspection, dot }) => {
        // The latest stop's grade is the header badge's word: here only its dot and year (and, unseen, the grade for screen readers).
        const isLatest = inspection === latest.inspection;
        const stop = (
          <>
            <Dot colour={inspectionColour(inspection, dot.tone)} size={14} />
            <span className="sc-timeline__when">{(inspection.startDate ?? "").slice(0, 4) || "Date unknown"}</span>
            {isLatest ? <span className="sr-only">{stopLabel(dot.label)}</span> : (
              <>
                <span className="sc-timeline__grade">{stopLabel(dot.label)}</span>
                {/* Five or more stops on a phone: the short form, so neighbouring labels never run together. */}
                <span className="sc-timeline__grade sc-timeline__grade--short" aria-hidden="true">{stopLabel(dot.label, true)}</span>
              </>
            )}
            {inspection.inspectedUrn && inspection.inspectedUrn !== card.urn && <small>as predecessor</small>}
          </>
        );
        const title = `${formatMonthYear(inspection.startDate) || "Date unknown"}: ${dot.label}`;
        return (
          <li key={inspection.inspectionNumber} data-tone={dot.tone} data-latest={isLatest ? "" : undefined}>
            {inspection.reportUrl
              ? <a className="sc-timeline__stop" href={inspection.reportUrl} title={`${title} (Ofsted report)`}>{stop}</a>
              : <span className="sc-timeline__stop" title={title}>{stop}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Strong and weak areas of the latest graded inspection; under a report card the area grid already names and counts each one. */
function StrengthsBody({ card, gridShown }: { card: SchoolCard; gridShown: boolean }) {
  const counts = card.inspectionCounts!;
  const area = (name: string) => name.replace(/\s*\(where applicable\)/i, "");
  const facts = [
    !gridShown && `${counts.graded} areas graded`,
    !gridShown && counts.safeguarding && `safeguarding ${/^(Yes|Met|Effective)$/i.test(counts.safeguarding) ? "effective" : counts.safeguarding}`,
    counts.improvePoints !== null && `${counts.improvePoints} ${counts.improvePoints === 1 ? "point" : "points"} to improve`,
    counts.inspectedAsPredecessor && "inspected as predecessor",
  ];
  if (gridShown && !facts.some(Boolean)) return null;
  return (
    <div className="sc-block" data-testid="school-strengths">
      {!gridShown && (
        <div className="sc-tldr">
          <div className="sc-tldr__col">
            <h3 className="sc-h3"><KnitIcon name="thumb-up" colour="var(--chart-good)" className="sc-icon" /> {counts.strengths} strong areas</h3>
            {counts.strengthAreas.length > 0 && <ul className="sc-areas-list">{counts.strengthAreas.map((name) => <li key={name}>{area(name)}</li>)}</ul>}
          </div>
          <div className="sc-tldr__col">
            <h3 className="sc-h3"><KnitIcon name="thumb-down" colour="var(--chart-bad)" className="sc-icon" /> {counts.weaknesses} weak areas</h3>
            {counts.weaknessAreas.length > 0 && <ul className="sc-areas-list">{counts.weaknessAreas.map((name) => <li key={name}>{area(name)}</li>)}</ul>}
          </div>
        </div>
      )}
      <Facts items={facts} />
    </div>
  );
}

type Bar = { id: string; label: string; value: number | null; text: string; year?: string; note?: string };

/**
 * Figures as satin bars on one scale (0 to max), the figure as text beside each: colour is never the only cue.
 * `stacked`: a long name on its own line above its bar (survey questions).
 */
function BarRows({ bars, max = 100, testId, stacked = false }: { bars: Bar[]; max?: number; testId?: string; stacked?: boolean }) {
  if (bars.length === 0) return null;
  return (
    <ul className={`sc-bars${stacked ? " sc-bars--stacked" : ""}`} data-testid={testId}>
      {bars.map((bar) => {
        const cells = (
          <>
            <span className="sc-bars__label">
              {bar.label}
              {bar.year && <small> {bar.year}</small>}
              {bar.note && <small className="sc-bars__note"> · {bar.note}</small>}
            </span>
            {bar.value !== null
              ? <SatinBar value={max > 0 ? bar.value / max : 0} colour="var(--chart-1)" width={200} height={stacked ? 10 : 12} className="sc-bars__bar" />
              : <span className="sc-bars__bar" />}
            <span className="sc-bars__value">{bar.text}</span>
          </>
        );
        return (
          <li key={bar.id} data-bar={bar.id}>
            {stacked ? <span className="sc-bars__row">{cells}</span> : cells}
          </li>
        );
      })}
    </ul>
  );
}

const pct = (value: number | null | undefined) => (value === null || value === undefined ? "Withheld" : formatMeasure(value, "percent"));

// ---- Pupils ----------------------------------------------------------------------------------------------

type PupilKey = "fsm6Percent" | "ealPercent" | "senSupportPercent" | "ehcpPercent" | "overallAbsencePercent" | "persistentAbsencePercent";

const PUPIL_ROWS: [PupilKey, string][] = [
  ["fsm6Percent", "Free school meals (past 6 years)"],
  ["ealPercent", "First language not English"],
  ["senSupportPercent", "SEN support"],
  ["ehcpPercent", "EHC plan"],
  ["overallAbsencePercent", "Absence (sessions missed)"],
  ["persistentAbsencePercent", "Persistently absent pupils"],
];

function PupilsBody({ card, year }: { card: SchoolCard; year: string | null }) {
  const measures = card.compare?.measures ?? {};
  const profile = card.profile;
  const gias = profile?.gias ?? null;
  const latestPupils = latestPoint(card.history.measures, "pupils");
  const sixth = latestPoint(card.history.measures, "ks5-students");
  const capacity = gias?.capacity ?? card.school.capacity;
  const roll = gias?.pupils ?? (latestPupils?.value as number | undefined) ?? card.details.pupils;
  const rollWhen = gias?.pupils != null && gias.censusDate ? formatMonthYear(gias.censusDate) : latestPupils?.academicYear ?? null;
  const full = gias?.percentFull ?? (typeof capacity === "number" && capacity > 0 && typeof roll === "number" ? Math.round((roll / capacity) * 100) : null);
  const girls = profile?.girlsPercent, boys = profile?.boysPercent;
  return (
    <div className="sc-block" data-testid="school-pupils">
      <div className="sc-compares">
        {typeof roll === "number" && (
          <CompareRow id="pupils" label="On roll" year={rollWhen !== year ? rollWhen : null} value={roll.toLocaleString("en-GB")} measure={measures.pupils} />
        )}
        {PUPIL_ROWS.map(([key, label]) => {
          const figure = profile?.[key];
          if (!figure) return null;
          return (
            <CompareRow key={key} id={key} label={label} year={figure.academicYear !== year ? figure.academicYear : null}
              value={pct(figure.suppressed ? null : figure.value)} measure={figure.suppressed ? null : measures[key]} />
          );
        })}
      </div>
      {girls?.value != null && boys?.value != null && (
        <div className="sc-split" data-testid="school-gender-split">
          <SatinStacked parts={[{ value: girls.value, colour: "var(--chart-1)" }, { value: boys.value, colour: "var(--chart-2)" }]}
            width={320} height={10} className="sc-split__bar" />
          <p className="sc-split__text">
            <span><Dot colour="var(--chart-1)" size={10} />Girls {pct(girls.value)}</span>
            <span><Dot colour="var(--chart-2)" size={10} />Boys {pct(boys.value)}</span>
          </p>
          {/* A single-sex school's other sex is its sixth form: the shares are of every pupil. */}
          {profile?.intake?.mixedSixthForm && <p className="sc-split__note" data-testid="school-gender-note">all pupils, incl. sixth form</p>}
        </div>
      )}
      <Facts testId="school-pupils-facts" items={[
        full !== null && typeof capacity === "number" && `${Number(full.toFixed(1))}% full · ${capacity.toLocaleString("en-GB")} places`,
        typeof sixth?.value === "number" && `${sixth.value.toLocaleString("en-GB")} in sixth form${sixth.academicYear !== year ? ` (${sixth.academicYear})` : ""}`,
      ]} />
    </div>
  );
}

/** A glance line (stem stitch, a dot at the latest value) beside a number; the number carries the fact. */
function MiniLine({ values, label, width = 160, height = 32 }: { values: number[]; label?: string; width?: number; height?: number }) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const inset = height < 24 ? 2 : 3;
  const points = values.map((value, index) => [
    2 + (index / (values.length - 1)) * (width - 4),
    inset + (1 - (high === low ? 0.5 : (value - low) / (high - low))) * (height - inset * 2),
  ] as const);
  const [endX, endY] = points.at(-1)!;
  return (
    <svg className="sc-miniline" viewBox={`0 0 ${width} ${height}`} width={width} height={height}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <g className="stem"><StemLine d={straight(points)} colour="var(--chart-1)" width={height < 24 ? 1.8 : 2.2} /></g>
      <circle className="sc-chart__dot" cx={endX} cy={endY} r={height < 24 ? 2.6 : 3.5} />
    </svg>
  );
}

// ---- Results: England rank -------------------------------------------------------------------------------------

function NationalRankBlock({ card }: { card: SchoolCard }) {
  const rank = card.nationalRank;
  if (!rank) return null;
  if (rank.rank === null || rank.total === null || rank.topPercent === null) {
    return <p className="sc-unknown" data-testid="school-national-rank">England rank: {rank.missingReason ?? "not ranked"}</p>;
  }
  return (
    <div className="sc-block">
      <p className="sc-rank" data-testid="school-national-rank">
        Ranked <strong>{rank.rank.toLocaleString("en-GB")}</strong> of {rank.total.toLocaleString("en-GB")}
        {rank.measureId === "ks2-rwm-expected" ? " primaries" : " secondaries"} in England
        {" · "}<strong>top {rank.topPercent}%</strong>
      </p>
      {rank.history.length > 1 && <RankChart rank={rank} />}
    </div>
  );
}

const RANK_CHART = { width: 320, height: 84, top: 18, bottom: 6, left: 10, right: 10 };

// ---- Results: combined A-level rank (state and independent, issue #201) -------------------------------------------

/** The "A-level results" block: the school's place among London's sixth forms of every sector, with
 * the required selection note. */
function SixthFormRankBlock({ card }: { card: SchoolCard }) {
  const rank = card.combinedSixthFormRank;
  if (!rank) return null;
  return (
    <div className="sc-block" data-testid="school-sixth-form-rank">
      <h3 className="sc-h3">A-level results</h3>
      <p className="sc-rank">
        <strong>#{rank.regionRank.toLocaleString("en-GB")}</strong> of {rank.regionPool.toLocaleString("en-GB")}
        {" "}{rank.scope ?? "London"} sixth forms, state and independent, {rank.year}
      </p>
      <p className="sc-caption">{rank.selectionNote}</p>
    </div>
  );
}

/** Top % in England by year, the best (top 1%) at the top on a fixed 0–100 scale; the first, best and latest year printed. */
function RankChart({ rank }: { rank: NationalRank }) {
  const slots = rankSlots(rank);
  if (slots.length === 0) return null;
  const step = (RANK_CHART.width - RANK_CHART.left - RANK_CHART.right) / Math.max(1, slots.length - 1);
  const x = (index: number) => RANK_CHART.left + index * step;
  const y = (top: number) => RANK_CHART.top + (top / 100) * (RANK_CHART.height - RANK_CHART.top - RANK_CHART.bottom);
  const runs = splitRuns(slots, (slot) => slot.value);
  const noExams = gapSpans(slots, "no-exams");
  const half = step / 2;
  const valued = slots.filter((slot) => slot.value !== null);
  const spoken = `Top % of ${rank.measureId === "ks2-rwm-expected" ? "primaries" : "secondaries"} in England by year: ${valued.map((slot) => `${slot.value}% in ${slot.year}`).join(", ")}.`;
  const anchor = (index: number) => (index === 0 ? "start" : index === slots.length - 1 ? "end" : "middle");
  const indexed = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.value !== null);
  const best = indexed.reduce((top, entry) => (entry.slot.value! < top.slot.value! ? entry : top), indexed[0]);
  // The first and best years are printed; the latest is already in the "Ranked … · top x%" line above. A printed
  // year away from the ends names itself, so its figure is never read as the latest year's.
  const latest = indexed.at(-1);
  const printed = new Set([indexed[0]?.index, best?.index].filter((index) => index !== undefined && (latest?.slot.year !== rank.year || index !== latest.index)));
  return (
    <figure className="sc-chart sc-chart--rank" data-testid="school-rank-chart">
      <figcaption className="sc-chart__head"><span className="sc-chart__label">Top % in England, by year</span></figcaption>
      <div className="sc-chart__plot">
        <svg viewBox={`0 0 ${RANK_CHART.width} ${RANK_CHART.height}`} role="img" aria-label={spoken}>
          {noExams.map(([from, to]) => (
            <rect key={from} className="sc-chart__gap" x={x(from) - half} y={0} width={(to - from + 1) * step} height={RANK_CHART.height} />
          ))}
          <line className="sc-chart__median" x1={0} x2={RANK_CHART.width} y1={y(50)} y2={y(50)} />
          <line className="sc-chart__base" x1={0} x2={RANK_CHART.width} y1={y(100)} y2={y(100)} />
          {runs.map((run, index) => (
            <g key={index} className="stem">
              <StemLine d={straight(run.length > 1 ? run.map((i) => [x(i), y(slots[i].value!)] as const) : [[x(run[0]) - 2, y(slots[run[0]].value!)], [x(run[0]) + 2, y(slots[run[0]].value!)]])}
                colour="var(--chart-1)" width={2.6} />
            </g>
          ))}
          {slots.map((slot, index) => slot.value !== null && (
            <g key={slot.year}>
              <circle className="sc-chart__dot" cx={x(index)} cy={y(slot.value)} r={4}><title>{`${slot.year}: top ${slot.value}%`}</title></circle>
              {printed.has(index) && (
                <text className="sc-chart__value" data-testid="school-rank-value" x={x(index)} y={y(slot.value) - 8}
                  textAnchor={anchor(index)} fontSize={12.5}>{slot.value}%{index > 0 && index < slots.length - 1 ? ` · ${slot.year}` : ""}</text>
              )}
            </g>
          ))}
        </svg>
        {noExams.map(([from, to]) => (
          <span key={from} className="sc-chart__gap-label"
            style={{ left: `${((x(from) - half) / RANK_CHART.width) * 100}%`, width: `${(((to - from + 1) * step) / RANK_CHART.width) * 100}%` }}>
            No exams
          </span>
        ))}
      </div>
      <div className="sc-chart__years" aria-hidden="true"><span>{slots[0].year}</span><span>{slots.at(-1)!.year}</span></div>
    </figure>
  );
}

// ---- Parent View -------------------------------------------------------------------------------------------------

const HEADLINE_WORD: Record<ParentViewQuestion["headline"], string> = { agree: "agree", yes: "yes", positive: "positive" };

function ParentViewBody({ card }: { card: SchoolCard }) {
  const view = card.parentView!;
  const questions = view.questions ?? [];
  const bars = questions.map((question) => {
    const yes = followUpShare(question, questions);
    return {
      id: question.id, label: question.question, value: question.headlinePercent,
      text: question.headlinePercent === null ? "No data" : `${pct(question.headlinePercent)} ${HEADLINE_WORD[question.headline]}`,
      // Agree is of the parents it applies to; how many it did not apply to is said beside the question.
      note: question.notApplicable ? `${pct(question.notApplicable.percent)} ${question.notApplicable.option === "Not applicable" ? "not applicable" : "had no concerns to raise"}`
        : yes != null ? `asked only of the ${pct(yes)} who said Yes above` : undefined,
    };
  });
  // Without the per-question answers (older payloads), the headline figures stand alone.
  const tiles: Tile[] = bars.length > 0 ? [] : [
    view.happyPercent != null ? { id: "happy", value: pct(view.happyPercent), label: "say their child is happy" } : null,
    view.recommendPercent != null ? { id: "recommend", value: pct(view.recommendPercent), label: "would recommend the school" } : null,
  ].filter((tile): tile is Tile => tile !== null);
  const earlier = view.surveyEra === "earlier";
  const when = view.asAt ? `as at ${formatDay(view.asAt)}` : view.period;
  const responses = `${view.responses.toLocaleString("en-GB")} responses${view.responseRate != null ? ` (${pct(view.responseRate)} of pupils)` : ""}`;
  return (
    <div className="sc-block" data-testid="school-parent-view" data-survey={view.surveyEra}>
      <p className="sc-caption" data-testid="school-parent-view-survey">
        {earlier ? <><strong className="sc-era">{view.surveyLabel ?? "Earlier survey (before Nov 2025)"}</strong> · {when}</> : capitalise(when)} · {responses}
      </p>
      {bars.length === 0 && tiles.length === 0 && <p className="sc-lead"><strong>{pct(view.agreePercent)} agree</strong> · {view.question}</p>}
      <Tiles tiles={tiles} />
      <BarRows bars={bars} stacked testId="school-parent-view-questions" />
    </div>
  );
}

// ---- Getting in (admissions and catchment) ---------------------------------------------------------------------

function GettingIn({ card, distance }: { card: SchoolCard; distance: FromArea | null }) {
  // Only the latest intake: an entry point last seen years ago (a secondary's old reception class) is history.
  const latestYear = Math.max(...card.admissions.demand.map((row) => row.entryYear));
  const demand = card.admissions.demand.filter((row) => row.entryYear === latestYear);
  const groups = oversubscriptionGroups(card.admissions);
  const offered = offeredGroups(card.admissions.lastOffered);
  const you = distance ? distance.km * 1000 : null;
  const entry = card.school.phase === "primary" ? "reception" : "year7";
  return (
    <div className="sc-block" data-testid="school-getting-in">
      {demand.map((row) => {
        const series = groups.find((group) => group.entryPoint === row.entryPoint)?.rows ?? [];
        const latest = series[0] ?? row;
        const gotIn = firstChoiceOfferedPercent(latest);
        const trend = [...series].reverse().filter((point) => point.firstChoiceNotOfferedPercent != null);
        // Both ends say year and share, to the headline's one decimal.
        const shareText = (point: SchoolDemand) => compareText(100 - point.firstChoiceNotOfferedPercent!, "percent");
        const measure = row.entryPoint === entry ? card.compare?.measures.firstChoiceOfferedPercent ?? null : null;
        return (
          <div key={row.entryPoint} className="sc-demand" data-testid="school-oversubscription">
            {demand.length > 1 && <h3 className="sc-h3">{entryPointLabel(row.entryPoint)}</h3>}
            {gotIn !== null
              ? <CompareRow id="firstChoiceOfferedPercent" label="First-choice families who got in" value={`${gotIn}%`} measure={measure} />
              : row.offers !== null && <p className="sc-lead"><strong>{row.offers.toLocaleString("en-GB")}</strong> places offered</p>}
            <div className="sc-demand__more">
              {latest.firstPreferences != null && latest.firstPreferenceOffers != null && (
                <span className="sc-caption" data-testid="school-got-in-count">
                  {latest.firstPreferenceOffers.toLocaleString("en-GB")} of {latest.firstPreferences.toLocaleString("en-GB")} who put it first
                </span>
              )}
              {trend.length > 1 && (
                <span className="sc-trend" data-testid="school-got-in-trend">
                  <span>{trend[0].entryYear} · {shareText(trend[0])}</span>
                  <MiniLine values={trend.map((point) => firstChoiceOfferedPercent(point)!)}
                    label={`First-choice families who got a place, ${trend[0].entryYear} to ${trend.at(-1)!.entryYear}`} />
                  <span>{trend.at(-1)!.entryYear} · {shareText(trend.at(-1)!)}</span>
                </span>
              )}
            </div>
            <Preferences row={latest} />
          </div>
        );
      })}
      {offered.length === 0 && demand.length > 0 && <p className="sc-unknown" data-testid="school-no-distance">No last distance offered published</p>}
      {offered.map((group) => <LastOfferedChart key={group.key} group={group} titled={offered.length > 1} you={you} />)}
      {distance && (offered.length > 0
        ? <YouVerdict distance={distance} latest={offered[0].rows[0]} />
        : (
          <p className="sc-you" data-testid="school-distance">
            <KnitIcon name="home" className="sc-icon" />
            <span><strong>{formatKm(distance.km)}</strong> from {distance.name} <span className="sc-you__note">· approx.: from the area&apos;s centre, not your door</span></span>
          </p>
        ))}
    </div>
  );
}

/** Applications and offers by preference (1st, 2nd, 3rd) on national offer day, behind "By preference". */
function Preferences({ row }: { row: SchoolDemand }) {
  const lines = [
    ["1st", row.firstPreferences, row.firstPreferenceOffers],
    ["2nd", row.secondPreferences, row.secondPreferenceOffers],
    ["3rd", row.thirdPreferences, row.thirdPreferenceOffers],
  ] as const;
  if (row.secondPreferences == null && row.thirdPreferences == null) return null;
  const count = (value: number | null | undefined) => (value == null ? "–" : value.toLocaleString("en-GB"));
  return (
    <More summary="By preference" testId="school-preferences-more">
      <table className="sc-prefs" data-testid="school-preferences">
        <thead><tr><th scope="col">Choice</th><th scope="col">Applied</th><th scope="col">Offered</th></tr></thead>
        <tbody>
          {lines.map(([name, applied, offered]) => (
            <tr key={name}><th scope="row">{name}</th><td>{count(applied)}</td><td>{count(offered)}</td></tr>
          ))}
        </tbody>
      </table>
    </More>
  );
}

/** "Inside last year's distance" for the area the card was opened from, labelled approximate. */
function YouVerdict({ distance, latest }: { distance: FromArea; latest: LastOffered }) {
  const verdict = distanceVerdict(distance.km * 1000, latest);
  return (
    <p className="sc-you" data-testid="school-distance-verdict" data-verdict={verdict ?? undefined}>
      <KnitIcon name="home" className="sc-icon" />
      <span>
        {verdict && <><strong>{verdict === "inside" ? "Inside" : "Outside"}</strong> last year&apos;s distance · </>}
        <span className="sc-you__note">approx.: from the centre of {distance.name}, not your door</span>
      </span>
    </p>
  );
}

/** The last distance offered per year on one scale (0 to the furthest, or to "you"), with "you" as a tick on every year and its own row. */
function LastOfferedChart({ group, titled, you }: { group: OfferedGroup; titled: boolean; you: number | null }) {
  const max = Math.max(...group.rows.map((row) => row.distanceMetres ?? 0), you ?? 0, 1);
  const at = (metres: number) => `${((metres / max) * 100).toFixed(1)}%`;
  return (
    <figure className="sc-offered" data-testid="school-last-offered">
      <figcaption className="sc-h3">
        Last distance offered{titled ? ` · ${entryPointLabel(group.entryPoint)}${group.site !== "main" ? ` (${group.site})` : ""}` : ""}
      </figcaption>
      <ul className="sc-offered__rows">
        {group.rows.map((row) => (
          <li key={row.academicYear} title={row.rules.map((rule) => `${rule.criterion ?? rule.rule}: ${rule.rawValue ?? ""}`).join("; ")}>
            <span className="sc-offered__year">{row.academicYear}</span>
            <span className="sc-offered__track">
              {row.distanceMetres !== null && <SatinBar value={row.distanceMetres / max} colour="var(--chart-1)" width={240} height={12} className="sc-offered__bar" />}
              {you !== null && <i className="sc-offered__tick" style={{ left: at(you) }} aria-hidden="true" />}
            </span>
            <span className="sc-offered__value">{offeredText(row)}</span>
          </li>
        ))}
        {you !== null && (
          <li className="sc-offered__you">
            <span className="sc-offered__year">You</span>
            <span className="sc-offered__track"><i className="sc-offered__you-line" style={{ width: at(you) }} aria-hidden="true" /></span>
            <span className="sc-offered__value" data-testid="school-distance">{formatKm(you / 1000)}</span>
          </li>
        )}
      </ul>
    </figure>
  );
}

// ---- Workforce -------------------------------------------------------------------------------------------

function WorkforceBody({ card }: { card: SchoolCard }) {
  const staff = card.workforce!;
  const measures = card.compare?.measures ?? {};
  const fte = (value: number) => formatFte(value, 1);
  const { teachersFte: teachers, leadershipFte: leaders, teachingAssistantsFte: assistants, supportStaffFte: support } = staff;
  // Leadership is part of the teachers, TAs part of the support staff: one bar of the whole workforce, nothing counted twice.
  const otherSupport = support !== null && assistants !== null && support >= assistants ? support - assistants : null;
  const split = teachers !== null && leaders !== null && leaders <= teachers;
  // Classroom = rounded teachers − rounded leadership, so the two legend figures add up to the published teachers FTE.
  const classroom = split ? Number((Number(teachers.toFixed(1)) - Number(leaders.toFixed(1))).toFixed(1)) : null;
  const parts = [
    teachers !== null && { id: "teachers", value: split ? teachers - leaders : teachers, colour: "var(--chart-1)",
      text: classroom !== null ? `Classroom teachers ${fte(classroom)}` : `Teachers ${fte(teachers)}` },
    split && { id: "leaders", value: leaders, colour: "var(--chart-4)", text: `Leadership ${fte(leaders)}` },
    assistants !== null && { id: "assistants", value: assistants, colour: "var(--chart-3)", text: `Teaching assistants ${fte(assistants)}` },
    otherSupport !== null ? { id: "support", value: otherSupport, colour: "var(--chart-5)", text: `Other support ${fte(otherSupport)}` }
      : assistants === null && support !== null && { id: "support", value: support, colour: "var(--chart-5)", text: `Support staff ${fte(support)}` },
  ].filter((part): part is { id: string; value: number; colour: string; text: string } => Boolean(part));
  return (
    <div className="sc-block" data-testid="school-workforce">
      <div className="sc-compares">
        {staff.pupilsPerTeacher !== null && <CompareRow id="pupilsPerTeacher" label="Pupils per teacher" value={`${staff.pupilsPerTeacher}`} measure={measures.pupilsPerTeacher} />}
        {staff.pupilsPerAdult !== null && <CompareRow id="pupilsPerAdult" label="Pupils per adult" value={`${staff.pupilsPerAdult}`} measure={measures.pupilsPerAdult} />}
      </div>
      {parts.length > 0 && (
        <div className="sc-split" data-testid="school-workforce-split">
          <SatinStacked parts={parts} width={320} height={12} className="sc-split__bar" />
          <ul className="sc-split__text sc-split__legend">
            {parts.map((part) => <li key={part.id} data-number={part.id}><Dot colour={part.colour} size={10} />{part.text}</li>)}
          </ul>
          {(split || staff.workforceFte !== null) && (
            <p className="sc-caption" data-number="workforce">
              {[split ? `Teachers ${fte(teachers)} FTE` : null,
                staff.workforceFte !== null ? `Whole workforce ${fte(staff.workforceFte)}${staff.workforceHeadcount !== null ? ` · ${staff.workforceHeadcount} people` : ""}` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Financials ------------------------------------------------------------------------------------------

function FinanceBody({ card }: { card: SchoolCard }) {
  const money = card.finance!;
  const measures = card.compare?.measures ?? {};
  const signed = (value: number) => `${value > 0 ? "+" : ""}${formatPounds(value)}`;
  const income = money.incomePerPupil, spend = money.spendPerPupil;
  const trust = money.trust;
  const rows: [CompareKey, string, number | null][] = [
    ["incomePerPupil", "Income per pupil", income.total],
    ["spendPerPupil", "Spend per pupil", spend.total],
    ["staffSpendPerPupil", "Staff spend per pupil", spend.staff],
    ["reservePerPupil", "Reserve per pupil", money.revenueReservePerPupil],
  ];
  const tiles: Tile[] = [{
    id: "reserve", value: money.revenueReserve === null ? "No data" : signed(money.revenueReserve), label: "revenue reserve",
    tone: money.inDeficit === true ? "bad" : money.inDeficit === false ? "good" : undefined,
  }];
  if (money.inYearBalance !== null) {
    tiles.push({ id: "in-year", value: signed(money.inYearBalance), label: "in-year balance", tone: money.inYearBalance < 0 ? "bad" : "good" });
  }
  return (
    <div className="sc-block" data-testid="school-finance">
      {money.partialYear
        ? <p className="sc-unknown">Per-pupil figures left out: this return covers {money.periodMonths ?? "under 12"} months.</p>
        : (
          <div className="sc-compares">
            {rows.map(([key, label, value]) => value !== null && (
              <CompareRow key={key} id={key} label={label} value={formatPounds(value)} measure={measures[key]} />
            ))}
          </div>
        )}
      <Tiles tiles={tiles} />
      {!money.partialYear && (
        <Facts testId="school-finance-parts" items={[
          income.grants !== null && `Grants ${formatPounds(income.grants)}`,
          income.selfGenerated !== null && `self-generated ${formatPounds(income.selfGenerated)}`,
          spend.premises !== null && `premises ${formatPounds(spend.premises)} per pupil`,
        ]} />
      )}
      {trust && (
        <p className="sc-caption" data-testid="school-finance-trust">
          {trust.kind === "MAT" ? "Multi-academy trust" : "Single-academy trust"}{trust.name ? `: ${trust.name}` : ""}
          {trust.academies !== null && trust.kind === "MAT" ? ` (${trust.academies} academies)` : ""}
          {trust.revenueReserve !== null ? ` · trust reserve ${formatPounds(trust.revenueReserve)}` : ""}
          {trust.note ? ` · ${trust.note}` : ""}
        </p>
      )}
      {money.federation && <p className="sc-caption">{money.federation.note}</p>}
    </div>
  );
}

// ---- Destinations --------------------------------------------------------------------------------------------

function DestinationsBody({ card }: { card: SchoolCard }) {
  const { ks4, post16 } = card.destinations!;
  // The heading carries the leavers' year (ks4's, else post16's); a stage from another year says its own.
  const headingYear = (ks4 ?? post16)?.cohortYear;
  const stage = (title: string, row: SchoolDestination, testId: string) => (
    <div className="sc-demand" data-testid={testId}>
      <h3 className="sc-h3">{title}</h3>
      <p className="sc-caption">
        {row.cohort !== null ? `${row.cohort.toLocaleString("en-GB")} students` : "Students"}
        {row.cohortYear !== headingYear ? ` who left in ${row.cohortYear}` : ""}, followed through {row.destinationYear}
        {row.version ? ` · ${row.version}` : ""}
      </p>
      <BarRows bars={[
        { id: "sustained", label: "Sustained", value: row.sustainedPercent, text: pct(row.sustainedPercent) },
        { id: "education", label: "Education", value: row.educationPercent, text: pct(row.educationPercent) },
        ...(row.higherEducationPercent !== null ? [{ id: "higher", label: "Higher education", value: row.higherEducationPercent, text: pct(row.higherEducationPercent) }] : []),
        { id: "apprenticeship", label: "Apprenticeship", value: row.apprenticeshipPercent, text: pct(row.apprenticeshipPercent) },
        { id: "employment", label: "Employment", value: row.employmentPercent, text: pct(row.employmentPercent) },
        { id: "not-sustained", label: "Not sustained", value: row.notSustainedPercent, text: pct(row.notSustainedPercent) },
        { id: "unknown", label: "Unknown", value: row.unknownPercent, text: pct(row.unknownPercent) },
      ]} />
    </div>
  );
  if (!ks4 && !post16) return null;
  return (
    <div className="sc-block" data-testid="school-destinations">
      <div className="sc-cols">
        {ks4 && stage("After Year 11", ks4, "school-destinations-ks4")}
        {post16 && stage("After sixth form (16–18)", post16, "school-destinations-post16")}
      </div>
    </div>
  );
}

// ---- The ☰ menu: every source, licence, definition and method note -------------------------------------------

/** One native popover (no client code): the ☰ button opens it, Esc, a tap outside or Close shuts it. */
function SourcesMenu({ card, standing, distance, sections }: { card: SchoolCard; standing: OfstedStanding | null; distance: FromArea | null; sections: CardSection[] }) {
  return (
    <>
      <button type="button" className="sc-menu" popoverTarget="school-sources" aria-label="Sources, definitions and method" title="Sources, definitions and method"
        data-testid="school-sources-button">
        <KnitIcon name="menu" colour="currentColor" className="sc-menu__icon" />
      </button>
      <div id="school-sources" popover="auto" role="dialog" aria-labelledby="school-sources-title" className="sc-sheet" data-testid="school-sources">
        <div className="sc-sheet__head">
          <h2 className="sc-h2" id="school-sources-title">Sources and method</h2>
          <button type="button" className="sc-menu" popoverTarget="school-sources" popoverTargetAction="hide" aria-label="Close" data-testid="school-sources-close">
            <KnitIcon name="cross" colour="currentColor" className="sc-menu__icon" />
          </button>
        </div>
        <MethodNotes card={card} standing={standing} distance={distance} sections={sections} />
      </div>
    </>
  );
}

function Note({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  return <section className="sc-note" data-testid={testId}><h3 className="sc-h3">{title}</h3>{children}</section>;
}

/** missing[] entries other sections explain. */
const NOT_RESULTS = new Set(["parent-view", "destinations", "destinations-ks4", "destinations-post16", "workforce", "finance"]);

const NOTE_LABEL: Record<string, string> = {
  "ks2-reading-progress": "KS2 progress (reading)", "ks2-writing-progress": "KS2 progress (writing)",
  "ks2-maths-progress": "KS2 progress (maths)", "ks4-progress8": "Progress 8",
};
const noteLabel = (measure: string) => NOTE_LABEL[measure] ?? measure;

function MethodNotes({ card, standing, distance, sections }: { card: SchoolCard; standing: OfstedStanding | null; distance: FromArea | null; sections: CardSection[] }) {
  const { school, details } = card;
  const gias = card.profile?.gias ?? null;
  const compare = card.compare ?? null;
  const accountsNote = compare ? Object.values(compare.measures).find((measure) => measure?.accountsNote)?.accountsNote : undefined;
  const borough = compare ? Object.values(compare.measures).find((measure) => measure?.borough)?.borough?.name ?? details.localAuthority : null;
  // Results
  const rank = card.nationalRank ?? null;
  const noun = school.phase === "primary" ? "primaries" : "secondaries";
  const unpublished = card.missing.filter((entry) => !NOT_RESULTS.has(entry.measure));
  const counted = card.kpis.filter((kpi) => kpi.cohortSize);
  const sameCohort = new Set(counted.map((kpi) => `${kpi.cohortSize} pupils (${kpi.year})`));
  const cohorts = sameCohort.size === 1 && counted.length > 1 ? [`${[...sameCohort][0]}, every measure`]
    : counted.map((kpi) => `${kpi.label} ${kpi.cohortSize} pupils (${kpi.year})`);
  const kpiNotes = card.kpis.filter((kpi) => kpi.note && !unpublished.some((entry) => entry.measure === kpi.measure));
  const byReason = new Map<string, string[]>();
  for (const entry of unpublished) byReason.set(entry.reason, [...(byReason.get(entry.reason) ?? []), noteLabel(entry.measure)]);
  // Inspections
  const inspections = card.history.inspections.slice(0, 8).map((inspection) => ({ inspection, dot: inspectionDot(inspection) }));
  const marks = OFSTED_ORDER.filter((mark) => inspections.some(({ inspection }) => inspectionMark(inspection) === mark));
  const tones = new Set(inspections.filter(({ inspection }) => !inspectionMark(inspection)).map(({ dot }) => dot.tone));
  // Getting in
  const offered = offeredGroups(card.admissions.lastOffered);
  const capacity = gias?.capacity ?? school.capacity;
  const staff = card.workforce ?? null;
  const money = card.finance ?? null;
  const view = card.parentView;
  const destinations = card.destinations ?? null;
  const asPublished = staff ? [
    staff.teachersFte !== null ? `teachers ${formatFte(staff.teachersFte)}` : null,
    staff.leadershipFte !== null ? `leadership ${formatFte(staff.leadershipFte)}` : null,
    staff.teachingAssistantsFte !== null ? `teaching assistants ${formatFte(staff.teachingAssistantsFte)}` : null,
    staff.supportStaffFte !== null ? `support staff incl. TAs ${formatFte(staff.supportStaffFte)}` : null,
    staff.workforceFte !== null ? `whole workforce ${formatFte(staff.workforceFte)}${staff.workforceHeadcount !== null ? ` (${staff.workforceHeadcount} people)` : ""}` : null,
    staff.teachersHeadcount !== null ? `${staff.teachersHeadcount} teachers by headcount` : null,
  ].filter(Boolean) : [];
  // Why a section is empty, in full, where the page shows a short line.
  const why = sections.flatMap((section) => {
    const detail = section.missing ? missingLine(section.missing).detail : null;
    return detail ? [`${section.title}: ${detail}`] : [];
  });
  // One line per publisher and dataset; the per-year releases behind it share the name.
  const names = [...new Set(card.sources.map((source) => (source.attribution ?? "").split(" (")[0].split(". ")[0]
    .replace(/,? (for )?\d{4}\/\d{2}.*$/, "").trim()).filter(Boolean))];
  return (
    <div className="sc-notes-list">
      <Note title="This school" testId="school-record">
        {/* Attribution only: the GIAS record itself is under Visit & links (one place for every destination). */}
        <p>
          URN {card.urn}{details.predecessorUrn ? ` · before conversion URN ${details.predecessorUrn}` : ""}
          {gias?.laestab ? ` · LAESTAB ${gias.laestab}` : ""} · Source: Get Information about Schools, DfE, OGL v3.0
          {card.links ? " (record under Visit & links)" : ""}.
        </p>
        {/* Financials names the trust when it shows one; said here only otherwise. */}
        {gias?.trust?.name && !card.finance?.trust && <p>Trust: {gias.trust.name}</p>}
        {school.senProvision.length > 0 && <p>SEN provision: {school.senProvision.join(", ")}</p>}
      </Note>
      {card.topBadge.isTop && (
        <Note title={`Top school ${card.topBadge.year}`} testId="school-top-method">
          <p>{card.topBadge.reasons.join(" · ")}.</p>
          <p>{card.topBadge.criteria}{card.topBadge.criteria.endsWith(".") ? "" : "."}</p>
        </Note>
      )}
      {compare && (
        <Note title={`Against ${scopeName(card)}${borough ? ` and ${borough}` : ""}`} testId="school-compare-method">
          <p>Track: {scopeName(card)}&apos;s middle 80% (10th to 90th percentile); L = {scopeName(card)} median; {borough ? `${borough[0]} = ${borough} median` : "the borough median"}, shown when {compare.minBoroughSchools} or more of its schools have a figure; the dot is this school.</p>
          <p>{compare.pool}. {compare.method}.</p>
          <p>Colour only where lower or higher is clearly better (absence: lower): blue = better than the {scopeName(card)} median, red = in {scopeName(card)}&apos;s worst 10%.</p>
          {accountsNote && <p>Money: {accountsNote}.</p>}
        </Note>
      )}
      {(rank || card.kpis.length > 0 || unpublished.length > 0) && (
        <Note title="Results">
          {rank && (
            <p>
              England rank: {rank.measure}{rank.rankedUrn && rank.rankedUrn !== card.urn ? ` (published under URN ${rank.rankedUrn})` : ""}.
              {rank.total !== null ? ` Ranked among ${rank.total.toLocaleString("en-GB")} ${noun} in England, ${rank.year}.` : ""} {rank.pool}.
            </p>
          )}
          {rank && rank.history.length > 1 && <p>Top % in England by year: the first and best years are labelled; the dashed line is the middle (top 50%).</p>}
          {card.kpis.length > 0 && <p>Against {scopeName(card)}: {card.pool.description}. Steps: the score out of 10 against {scopeName(card)} (10 = top 10%).</p>}
          {card.kpis.some((kpi) => kpi.trend && kpi.trend.direction !== "flat") && (
            <p data-testid="school-kpi-trend-key">Arrows: change in {scopeName(card)} percentile points{kpiTrendFrom(card) ? ` since ${kpiTrendFrom(card)}` : ""}.</p>
          )}
          {cohorts.length > 0 && <p>Pupils counted: {cohorts.join(" · ")}.</p>}
          {kpiNotes.map((kpi) => <p key={kpi.measure}>{kpi.label}: {kpi.note}</p>)}
          {unpublished.length > 0 && (
            <p data-testid="school-unpublished">{[...byReason].map(([reason, labels]) => `${labels.join(", ")}: ${reason}`).join(". ")}.</p>
          )}
        </Note>
      )}
      <Note title="Getting in">
        <p>Got in = first-choice families offered a place on national offer day ÷ families who put the school first. Putting a school first gives no priority: siblings and distance decide.</p>
        {card.admissions.oversubscriptionDefinition && <p>{card.admissions.oversubscriptionDefinition}</p>}
        <p>Source: DfE, Primary and secondary school applications and offers.</p>
        <p>Last distance offered: the straight line from the school to the furthest child offered a place under the distance rule. Not a catchment: it changes every year.</p>
        {offered.map((group) => {
          const latest = group.rows[0];
          return (
            <p key={group.key} data-testid="school-offered-licence">
              <a className="sc-link" href={latest.sourceUrl} data-testid="school-offered-source">{group.council}</a>
              , {entryPointLabel(group.entryPoint)}{group.site !== "main" ? ` (${group.site})` : ""}, {group.rows.at(-1)!.academicYear}–{latest.academicYear.slice(5)}
              {latest.licence === "OGL-3.0" ? ". Open Government Licence v3.0." : `. ${latest.licence}; shown credited, with a link to the council's table.`}
              {latest.measurementMethod ? ` Measured: ${latest.measurementMethod}.` : ""}
            </p>
          );
        })}
        {distance && <p data-testid="school-distance-method">You: the straight line from the centre of {distance.name} (the area you came from) to the school, not from your door; inside or outside compares it with the latest distance offered.</p>}
      </Note>
      {inspections.length > 0 && (
        <Note title="Inspections">
          <p className="sc-legend sc-legend--dots" data-testid="school-timeline-key">
            {marks.map((mark) => (
              <span key={mark}><Dot colour={OFSTED_COLOUR[mark]} size={10} />{OFSTED_LABEL[mark]}</span>
            ))}
            {TIMELINE_KEY.filter((entry) => tones.has(entry.tone)).map((entry) => (
              <span key={entry.tone}><Dot colour={TONE_COLOUR[entry.tone]} size={10} />{entry.label}</span>
            ))}
          </p>
          <p>
            Dates are the day each inspection started:{" "}
            {inspections.map(({ inspection, dot }) => `${formatMonthYear(inspection.startDate) || "date unknown"} ${dot.label}`).join(" · ")}.
            {" "}Each dot opens its Ofsted report.{standing?.kind === "areas" ? " Report cards and 2024–25 inspections have no overall grade: the badge takes the lowest area's colour." : ""}
          </p>
          {card.inspectionCounts && <p>{card.inspectionCounts.definition}. Counted from Ofsted&apos;s grades, never scored from the report text.</p>}
          <p>Source: Ofsted, state-funded schools inspections and outcomes.</p>
        </Note>
      )}
      <Note title="Pupils">
        {capacity != null && <p>Full = pupils on roll ÷ the school&apos;s capacity ({capacity.toLocaleString("en-GB")} places), from Get Information about Schools.</p>}
        <p>Pupil profile and absence: DfE school census and pupil absence (Compare school and college performance). Free school meals = eligible at any time in the past 6 years; persistently absent = missed 10% or more of sessions. Withheld = suppressed by DfE.</p>
      </Note>
      {view && (
        <Note title="Parent View">
          <p>
            Survey period {view.period}{view.asAt ? `, as at ${formatDay(view.asAt)}` : ""}. Source: Ofsted Parent View management information,
            OGL v3.0 (<a className="sc-link" href={view.sourceUrl}>dataset</a>).{card.links?.parentView.href ? " The school's own survey page is under Visit & links." : ""}
          </p>
          <p>Ofsted changed the survey on 10 Nov 2025. The card shows the newest survey with 10 or more responses; an earlier survey is labelled and never mixed with the current one.</p>
          {view.definition && <p>{view.definition}</p>}
        </Note>
      )}
      {staff && (
        <Note title="Workforce">
          <p>School workforce census, {staff.academicYear}. Staff in FTE (full-time equivalent), rounded to 1 decimal on the card. As published: {asPublished.join(", ")}.</p>
          {staff.supportStaffFte !== null && staff.teachingAssistantsFte !== null && <p>Other support = support staff incl. TAs minus teaching assistants.</p>}
          <p>Per adult counts teachers, TAs and other classroom support; excludes admin staff.</p>
          {Object.values(staff.definitions).length > 0 && <ul className="sc-notes">{Object.entries(staff.definitions).map(([key, text]) => <li key={key}>{text}</li>)}</ul>}
        </Note>
      )}
      {money && (
        <Note title="Financials" testId="school-finance-how">
          <p data-testid="school-finance-accounts">{money.accountsLabel} · {money.periodLabel}.</p>
          <p>{money.perPupilDefinition}</p>
          <p>{money.notComparable}</p>
        </Note>
      )}
      {destinations && (
        <Note title="Destinations">
          <p>{destinations.definition}</p>
          <p>Source: DfE destination measures.</p>
        </Note>
      )}
      {why.length > 0 && (
        <Note title="Why some figures are missing" testId="school-missing-why">
          {why.map((line) => <p key={line}>{line}.</p>)}
        </Note>
      )}
      <Note title={`All sources and licences (${names.length})`} testId="school-sources-list">
        <ul className="sc-notes">{names.map((text) => <li key={text}>{text}</li>)}</ul>
        {card.sources.some((source) => source.licence === "OGL-3.0") && <p>Contains public sector information licensed under the Open Government Licence v3.0.</p>}
        {card.sources.some((source) => source.licence === "OGL-2.0") && <p>GLA London Schools Atlas data licensed under the Open Government Licence v2.0.</p>}
        <p><Link className="sc-link" href={guidePath("schools")}>How we compare schools</Link> · release {card.productReleaseId}</p>
      </Note>
    </div>
  );
}
