"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import type { GeographyId } from "@/lib/contracts";
import { londonOnlyWords } from "@/lib/coverage-reason";
import type { DataMode } from "@/lib/map-state";
import {
  PROPERTY_TYPE_LABELS,
  RECENT_PAGE_SIZE,
  TENURE_LABELS,
  basisSentence,
  boxPlot,
  type MarketBasis,
  formatDay,
  formatMonth,
  formatPounds,
  formatPoundsShort,
  lineChart,
  marketPath,
  perSquareFoot,
  readAreaMarket,
  readRecentSales,
  recentSalesPath,
  typesWithSales,
  type AreaMarketResponse,
  type Box,
  type MarketSeriesType,
  type MarketTrendSeries,
  type RecentSalesResponse,
  type RecentSalesSort,
} from "@/lib/market";
import { fetchSectionJson } from "@/lib/section-fetch";

import { BarList, ChartFrame, ScaleMarker, scalePosition, type BarRow } from "./charts";
import { useSectionJson, useSeed } from "./section-seed";
import { Dot, threadPath } from "./knit";
import { SatinBlock, StemDivider, StemLine } from "./knit/satin";
import { HelpTip } from "./help-tip";
import { UkHpi } from "./uk-hpi";
import { CouncilTaxBandsBlock } from "./council-tax-bands";
import { Ownership } from "./ownership";
import { ShortLets } from "./short-lets";
import { SourceNote } from "@/components/source-note";

type Load<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "unavailable" };

const unknown = (value: number | null, format: (value: number) => string = formatPounds) =>
  value === null ? <span className="market-unknown">unknown</span> : format(value);

/**
 * The local market for the Housing tab: what homes sold for in the last
 * 12 months, by type of home, how that moved over ten years, and the
 * individual recent sales (HM Land Registry Price Paid, standard sales).
 */
export function MarketSection({ geographyId, mode, part = "all", inCard = false }: {
  geographyId: GeographyId;
  mode: DataMode;
  /** The full area page splits it: "market" (figures and charts) under Price & market, "sales" (the list) under Homes sold nearby. */
  part?: "all" | "market" | "sales";
  /** In the area card: the sales list folded as "Recent sales (N)", with no sources fold or notes of its own (the section's ⓘ holds them). */
  inCard?: boolean;
}) {
  const payload = useSectionJson(marketPath(geographyId));
  const market = useMemo<Load<AreaMarketResponse>>(() => {
    if (payload === undefined) return { status: "loading" };
    const parsed = readAreaMarket(payload, mode);
    return parsed?.available ? { status: "ready", value: parsed } : { status: "unavailable" };
  }, [payload, mode]);

  const figures = part !== "sales";
  const list = part !== "market";
  return (
    <section className="market" data-testid={part === "sales" ? "market-sales-section" : "market-section"} aria-labelledby={`market-title-${part}`}>
      <h2 id={`market-title-${part}`}>{part === "market" ? "Local market" : part === "sales" ? "Recent sales in this area" : "Homes sold nearby"}</h2>
      {market.status === "loading" && <p className="market-note">Loading sales…</p>}
      {market.status === "unavailable" && <p className="market-note" data-testid="market-unavailable">Sale prices are unknown for this area.</p>}
      {figures && market.status === "ready" && <MarketView market={market.value} />}
      {figures && <UkHpi geographyId={geographyId} mode={mode} />}
      {list && market.status === "ready" && <RecentSales key={geographyId} geographyId={geographyId} mode={mode} folded={inCard} />}
      {part !== "market" && <CouncilTaxBandsBlock geographyId={geographyId} mode={mode} />}
      <ShortLets geographyId={geographyId} mode={mode} />
      {market.status === "ready" && !inCard && <MarketSources market={market.value} />}
      {part !== "market" && <Ownership geographyId={geographyId} mode={mode} />}
    </section>
  );
}

/** The tab's one folded "Sources & method" line: licence and caveats, word for word. */
function MarketSources({ market }: { market: AreaMarketResponse }) {
  if (!market.attribution && market.caveats.length === 0) return null;
  return (
    <details className="chart-sources" data-testid="market-sources">
      <summary>Sources &amp; method</summary>
      <div className="chart-sources__body">
        {market.attribution && <p>{market.attribution}</p>}
        {market.caveats.map((caveat) => <SourceNote key={caveat} text={caveat} />)}
      </div>
    </details>
  );
}

export function MarketView({ market }: { market: AreaMarketResponse }) {
  const summary = market.summary;
  const basis = market.basis;
  if (!summary || !basis || !market.window) return null;
  return (
    <>
      <p className="market-basis" data-testid="market-basis">
        {marketBasisWords(basis, summary.sales)}
        {basis.widened && <HelpTip id="market-widened" />}
      </p>
      <SummaryTiles market={market} />
      <ByType market={market} />
      <h3 className="market-heading">How spread out prices are <HelpTip id="market-spread" /></h3>
      <SpreadChart market={market} />
      <h3 className="market-heading">Ten years of prices <HelpTip id="market-trend" /></h3>
      <TrendChart market={market} measure="price" />
      <TrendChart market={market} measure="perSquareFoot" />
    </>
  );
}

/**
 * The home page's fuller market (area360's blocks): percentiles by type, the spread by type, and ten
 * years by type in £ and £/sq ft. Its summary and per-type bands are the Price section's own rows.
 */
export function MarketDetail({ market }: { market: AreaMarketResponse }) {
  if (!market.summary) return null;
  // .market carries the series colours and the width the charts size to.
  return (
    <div className="market">
      {market.basis && <p className="market-basis" data-testid="market-basis">{marketBasisWords(market.basis, market.summary.sales)}</p>}
      <div data-testid="market-by-type">
        <h3 className="market-heading">By type of home</h3>
        <ByTypeTable rows={[...typesWithSales(market), market.summary]} />
      </div>
      <div data-testid="market-box">
        <h3 className="market-heading">How spread out prices are</h3>
        <SpreadChart market={market} />
      </div>
      <div data-testid="market-trend">
        <h3 className="market-heading">Ten years of prices</h3>
        <TrendChart market={market} measure="price" />
        <TrendChart market={market} measure="perSquareFoot" />
      </div>
    </div>
  );
}

/**
 * The basis in words without an official area name: a widened basis reads
 * "the wider area", which the page has already named once.
 */
function marketBasisWords(basis: MarketBasis, sales: number): string {
  if (!basis.widened) return basisSentence(basis, sales);
  const count = `${sales.toLocaleString("en-GB")} sale${sales === 1 ? "" : "s"}`;
  return `Fewer than ${basis.minimumSales} homes sold here in a year, so these figures cover the wider area (${count}).`;
}

/**
 * Typical sale and sales count as big numbers, then the middle half as a
 * range on the 5%–95% scale. The area's £/m² is the page's one price per
 * square metre (Price vs London and What a home costs), so it is not repeated
 * here from a different sample.
 */
function SummaryTiles({ market }: { market: AreaMarketResponse }) {
  const summary = market.summary!;
  const window = market.window!;
  const { medianPrice: median, p25, p75 } = summary;
  const low = summary.p5 ?? summary.minPrice;
  const high = summary.p95 ?? summary.maxPrice;
  const known = median !== null && p25 !== null && p75 !== null && low !== null && high !== null && high > low;
  const at = (value: number) => scalePosition(value, low!, high!);
  return (
    <dl className="market-tiles housing-tiles" data-testid="market-tiles">
      <div>
        <dt>Typical sale, all sizes <HelpTip id="market-median" /></dt>
        <dd data-testid="market-median">{unknown(median)}</dd>
        <dd className="market-tiles__note"><small>12 months to {formatMonth(window.end)}</small></dd>
      </div>
      <div>
        <dt>Homes sold</dt>
        <dd data-testid="market-count">{summary.sales.toLocaleString("en-GB")}</dd>
        <dd className="market-tiles__note"><small>in 12 months</small></dd>
      </div>
      <div className="housing-tiles__wide">
        <dt>Middle half sold for <HelpTip id="market-range" /></dt>
        <dd>
          <span data-testid="market-range">{p25 === null || p75 === null ? unknown(null) : `${formatPoundsShort(p25)} – ${formatPoundsShort(p75)}`}</span>
          <ScaleMarker
            position={known ? at(median!) : null}
            range={known ? [at(p25!), at(p75!)] : undefined}
            low={known ? formatPoundsShort(low!) : ""}
            high={known ? formatPoundsShort(high!) : ""}
            label={known
              ? `Middle half sold for ${formatPoundsShort(p25!)} to ${formatPoundsShort(p75!)}, typical ${formatPoundsShort(median!)}; scale from the cheapest 5% at ${formatPoundsShort(low!)} to the dearest 5% at ${formatPoundsShort(high!)}`
              : "Spread of sale prices unknown"}
          />
        </dd>
        {known && <dd className="market-tiles__note"><small>Dot: typical · ends: cheapest and dearest 5%</small></dd>}
      </div>
    </dl>
  );
}

const wholePounds = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;

/** Typical price per type as bars, with the full percentile table behind "Show as table". */
function ByType({ market }: { market: AreaMarketResponse }) {
  const rows = typesWithSales(market);
  const none = market.byType.filter((stats) => stats.sales === 0).map((stats) => PROPERTY_TYPE_LABELS[stats.propertyType].toLowerCase());
  const bars: BarRow[] = rows.map((stats) => ({
    id: stats.propertyType,
    label: `${PROPERTY_TYPE_LABELS[stats.propertyType]} · ${stats.sales.toLocaleString("en-GB")} ${stats.sales === 1 ? "sale" : "sales"}`,
    value: stats.medianPrice ?? 0,
    display: stats.medianPrice === null ? "unknown" : formatPoundsShort(stats.medianPrice),
  }));
  return (
    <div className="housing-by-type" data-testid="market-by-type">
      <ChartFrame title="By type of home" help="market-by-type" unknown={rows.length === 0 ? "No sales by type" : null}
        table={<ByTypeTable rows={[...rows, market.summary!]} />}>
        <BarList rows={bars} label="Typical sale price by type of home" />
      </ChartFrame>
      {none.length > 0 && <p className="market-note">No {joinWords(none)} homes sold in the last 12 months.</p>}
    </div>
  );
}

function ByTypeTable({ rows }: { rows: AreaMarketResponse["byType"] }) {
  return (
    <div className="market-table-wrap" tabIndex={0} role="region" aria-label="Sale prices by type of home">
      <table className="market-table" data-testid="market-by-type-table">
        <thead>
          <tr><th scope="col">Type</th><th scope="col">Sales</th><th scope="col">Typical</th><th scope="col">£/m²</th><th scope="col">£/sq ft</th>
            <th scope="col">P5</th><th scope="col">P25</th><th scope="col">P75</th><th scope="col">P95</th></tr>
        </thead>
        <tbody>
          {rows.map((stats) => (
            <tr key={stats.propertyType} data-type={stats.propertyType}>
              <th scope="row"><SeriesSwatch series={stats.propertyType} />{PROPERTY_TYPE_LABELS[stats.propertyType]}</th>
              <td>{stats.sales.toLocaleString("en-GB")}</td>
              <td>{unknown(stats.medianPrice, formatPoundsShort)}</td>
              <td>{unknown(stats.medianPricePerSquareMetre, wholePounds)}</td>
              <td>{unknown(perSquareFoot(stats.medianPricePerSquareMetre), wholePounds)}</td>
              <td>{unknown(stats.p5, formatPoundsShort)}</td>
              <td>{unknown(stats.p25, formatPoundsShort)}</td>
              <td>{unknown(stats.p75, formatPoundsShort)}</td>
              <td>{unknown(stats.p95, formatPoundsShort)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function joinWords(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}

const TREND_BOX: Box = { width: 340, height: 190, left: 46, right: 18, top: 10, bottom: 24 };

/** Unbroken runs of consecutive points: a gap in the data cuts the thread. */
function threads<T extends { index: number }>(points: readonly T[]): T[][] {
  const runs: T[][] = [];
  points.forEach((point, i) => {
    if (i > 0 && points[i - 1].index === point.index - 1) runs.at(-1)!.push(point);
    else runs.push([point]);
  });
  return runs;
}

function seriesValues(series: MarketTrendSeries, measure: "price" | "perSquareFoot"): (number | null)[] {
  return series.points.map((point) => measure === "price" ? point.medianPrice : perSquareFoot(point.medianPricePerSquareMetre));
}

/**
 * The plot's drawn width in px, so the chart spans its column with 12 px labels and round stitches
 * (v3 board 33a); the box's own width until it is measured (the server render).
 */
function usePlotWidth(plot: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = plot.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => { const next = Math.round(node.clientWidth); if (next > 0) setWidth(next); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [plot]);
  return width;
}

/** The yearly lines; `keys` keeps only those series (the area page: All homes, or the household's types). */
export function TrendChart({ market, measure, keys }: { market: AreaMarketResponse; measure: "price" | "perSquareFoot"; keys?: readonly MarketSeriesType[] }) {
  const [active, setActive] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const box: Box = { ...TREND_BOX, width: usePlotWidth(plot, TREND_BOX.width) };
  const shown = market.trend.filter((series) => (!keys || keys.includes(series.propertyType))
    && seriesValues(series, measure).some((value) => value !== null));
  const ends = market.trend[0]?.points.map((point) => point.windowEnd) ?? [];
  const geometry = lineChart(shown.map((series) => ({ key: series.propertyType, values: seriesValues(series, measure) })), ends.length, box);
  const title = measure === "price" ? "Typical sale price" : "Typical price per sq ft";
  const format = measure === "price" ? formatPoundsShort : (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;
  const testId = measure === "price" ? "market-trend-price" : "market-trend-sqft";
  if (!geometry) {
    return <p className="market-note" data-testid={testId}>{title}: too few sales to draw a trend.</p>;
  }
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * box.width;
    let nearest = 0;
    geometry.xs.forEach((candidate, index) => { if (Math.abs(candidate - x) < Math.abs(geometry.xs[nearest] - x)) nearest = index; });
    setActive(nearest);
  };
  const latest = shown.map((series) => seriesValues(series, measure).at(-1) ?? null);
  return (
    <figure className="market-chart" data-testid={testId}>
      <figcaption>{title} by type of home</figcaption>
      <Legend keys={shown.map((series) => series.propertyType)} />
      <div className="market-plot" ref={plot}>
        <svg ref={svg} viewBox={`0 0 ${box.width} ${box.height}`} style={{ height: box.height }} role="img"
          aria-label={`${title} by type of home from ${formatMonth(ends[0] ?? "")} to ${formatMonth(ends.at(-1) ?? "")}. ${shown.map((series, index) => `${PROPERTY_TYPE_LABELS[series.propertyType]} latest ${latest[index] === null ? "unknown" : format(latest[index]!)}`).join("; ")}.`}
          onPointerMove={move} onPointerDown={move} onPointerLeave={() => setActive(null)}>
          {geometry.ticks.map((tick) => (
            <g key={tick.value} className="market-grid">
              <line x1={box.left} x2={box.width - box.right} y1={tick.y} y2={tick.y} />
              <text x={box.left - 6} y={tick.y} dy="0.32em" textAnchor="end">{format(tick.value)}</text>
            </g>
          ))}
          {geometry.xs.map((x, index) => (index % 2 === 0) && (
            <text key={ends[index]} className="market-axis" x={x} y={box.height - 6} textAnchor="middle">{ends[index].slice(0, 4)}</text>
          ))}
          {active !== null && <line className="market-crosshair" x1={geometry.xs[active]} x2={geometry.xs[active]} y1={box.top} y2={box.height - box.bottom} />}
          {geometry.lines.map((line) => {
            const end = line.points.at(-1)!;
            return (
              <g key={line.key} className="market-line" data-series={line.key}>
                {/* Stem stitch exactly through the points; class "yarn" stays as the series-line hook. */}
                <g className="yarn" data-stitch="stem">
                  {threads(line.points).map((run) => <StemLine key={run[0].index} d={threadPath(run.map((point) => [point.x, point.y]))} colour="var(--series)" width={line.key === "all" ? 2.2 : 2.7} />)}
                </g>
                {active !== null && line.points.filter((point) => point.index === active).map((point) => <circle key={point.index} cx={point.x} cy={point.y} r={4} />)}
                <g transform={`translate(${end.x - 7} ${end.y - 7})`}><Dot colour="var(--series)" size={14} /></g>
              </g>
            );
          })}
        </svg>
        {active !== null && (
          <div className="market-tooltip" role="status" style={{ left: `${(geometry.xs[active] / box.width) * 100}%` }}>
            <strong>12 months to {formatMonth(ends[active])}</strong>
            {shown.map((series) => {
              const value = seriesValues(series, measure)[active];
              return <span key={series.propertyType}><SeriesSwatch series={series.propertyType} />{PROPERTY_TYPE_LABELS[series.propertyType]} {value === null ? "unknown" : format(value)} <small>({series.points[active].sales} sales)</small></span>;
            })}
          </div>
        )}
      </div>
      <details className="market-figures">
        <summary>Show the numbers</summary>
        <div className="market-table-wrap" tabIndex={0} role="region" aria-label={`${title} by year`}>
          <StemDivider className="stem-divider table-stem" />
          <table className="market-table">
            <thead><tr><th scope="col">12 months to</th>{shown.map((series) => <th key={series.propertyType} scope="col">{PROPERTY_TYPE_LABELS[series.propertyType]}</th>)}</tr></thead>
            <tbody>
              {ends.map((end, index) => (
                <tr key={end}><th scope="row">{formatMonth(end)}</th>
                  {shown.map((series) => <td key={series.propertyType}>{unknown(seriesValues(series, measure)[index], format)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A series' key: a short stem stitch in the series colour, like the line it names. */
function SeriesSwatch({ series }: { series: string }) {
  return (
    <svg className="market-swatch" data-series={series} viewBox="0 0 20 10" aria-hidden="true">
      <StemLine d="M2 5H18" colour="var(--series)" width={2.7} />
    </svg>
  );
}

function Legend({ keys }: { keys: MarketSeriesType[] }) {
  return (
    <ul className="market-legend">
      {keys.map((key) => <li key={key}><SeriesSwatch series={key} />{PROPERTY_TYPE_LABELS[key]}</li>)}
    </ul>
  );
}

const ROW_HEIGHT = 34;

/** Cheapest 5% to dearest 5% as one stem stitch, with a short stem tick at each end. */
function Whisker({ from, to, y }: { from: number; to: number; y: number }) {
  const strand = (points: [number, number][]) => <StemLine d={threadPath(points)} colour="var(--series)" width={1.8} />;
  return (
    <g className="market-whisker">
      {strand([[from, y], [to, y]])}
      {strand([[from, y - 5], [from, y + 5]])}
      {strand([[to, y - 5], [to, y + 5]])}
    </g>
  );
}

function SpreadChart({ market }: { market: AreaMarketResponse }) {
  const [active, setActive] = useState<MarketSeriesType | null>(null);
  const stats = [...typesWithSales(market), market.summary!];
  const rows = stats.filter((entry) => entry.p5 !== null);
  const box: Box = { width: 340, height: rows.length * ROW_HEIGHT + 28, left: 106, right: 14, top: 4, bottom: 24 };
  const plot = boxPlot(rows, box, ROW_HEIGHT);
  if (!plot) return <p className="market-note" data-testid="market-spread">Too few sales to show how prices are spread.</p>;
  const thin = stats.filter((entry) => entry.p5 === null).map((entry) => PROPERTY_TYPE_LABELS[entry.propertyType].toLowerCase());
  const shown = rows.find((entry) => entry.propertyType === active);
  return (
    <figure className="market-chart" data-testid="market-spread">
      <figcaption>Sale prices in the last 12 months, from the cheapest 5% to the dearest 5%</figcaption>
      <div className="market-plot">
        <svg viewBox={`0 0 ${box.width} ${box.height}`} role="img" onPointerLeave={() => setActive(null)}
          aria-label={`Spread of sale prices by type of home. ${rows.map((entry) => `${PROPERTY_TYPE_LABELS[entry.propertyType]}: middle half ${formatPoundsShort(entry.p25!)} to ${formatPoundsShort(entry.p75!)}, typical ${formatPoundsShort(entry.medianPrice!)}`).join("; ")}.`}>
          {plot.ticks.map((tick) => (
            <g key={tick.value} className="market-grid">
              <line x1={tick.x} x2={tick.x} y1={box.top} y2={box.height - box.bottom} />
              <text className="market-axis" x={tick.x} y={box.height - 6} textAnchor="middle">{formatPoundsShort(tick.value)}</text>
            </g>
          ))}
          {plot.rows.map((row) => (
            <g key={row.key} className="market-box" data-series={row.key} onPointerEnter={() => setActive(row.key)} onPointerDown={() => setActive(row.key)}>
              <rect className="market-hit" x={0} y={row.y - ROW_HEIGHT / 2} width={box.width} height={ROW_HEIGHT} />
              <text className="market-row-label" x={box.left - 8} y={row.y} dy="0.32em" textAnchor="end">{PROPERTY_TYPE_LABELS[row.key]}</text>
              <Whisker from={row.p5} to={row.p95} y={row.y} />
              {/* The middle half as a satin block in the series colour. */}
              <g className="market-iqr">
                <SatinBlock x={row.p25} y={row.y - 8} width={Math.max(4, row.p75 - row.p25)} height={16} colour="var(--series)" slant={4} seed={Math.round(row.y)} />
              </g>
              <line className="market-median-halo" x1={row.median} x2={row.median} y1={row.y - 10} y2={row.y + 10} />
              <line className="market-median" x1={row.median} x2={row.median} y1={row.y - 10} y2={row.y + 10} />
            </g>
          ))}
        </svg>
        {shown && (
          <div className="market-tooltip market-tooltip--below" role="status">
            <strong>{PROPERTY_TYPE_LABELS[shown.propertyType]} · {shown.sales} sales</strong>
            <span>Cheapest 5%: under {formatPounds(shown.p5)}</span>
            <span>Middle half: {formatPounds(shown.p25)} – {formatPounds(shown.p75)}</span>
            <span>Typical: {formatPounds(shown.medianPrice)}</span>
            <span>Dearest 5%: over {formatPounds(shown.p95)}</span>
          </div>
        )}
      </div>
      {thin.length > 0 && <p className="market-note">Too few {joinWords(thin)} sales to show their spread.</p>}
    </figure>
  );
}

function recentLoad(payload: unknown, mode: DataMode): Load<RecentSalesResponse> {
  const parsed = readRecentSales(payload, mode);
  return parsed ? { status: "ready", value: parsed } : { status: "unavailable" };
}

function RecentSales({ geographyId, mode, folded = false }: { geographyId: GeographyId; mode: DataMode; folded?: boolean }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<RecentSalesSort>("nearest");
  const [expanded, setExpanded] = useState(false);
  const path = recentSalesPath(geographyId, page, sort);
  // The area page's server read the first page (components/section-seed.tsx): start there, skip that fetch.
  const seeded = useSeed(path);
  const [list, setList] = useState<Load<RecentSalesResponse>>(() => seeded === undefined ? { status: "loading" } : recentLoad(seeded, mode));
  const seededPath = useRef(seeded === undefined ? null : path);
  useEffect(() => {
    if (path === seededPath.current) return;
    seededPath.current = null;
    let current = true;
    setList((previous) => previous.status === "ready" ? previous : { status: "loading" });
    void fetchSectionJson<unknown>(path).then((payload) => { if (current) setList(recentLoad(payload, mode)); });
    return () => { current = false; };
  }, [path, mode]);

  if (folded) {
    // Closed by default: the count in the summary, the rows one tap away.
    return (
      <details className="area-disclosure market-recent" data-testid="market-recent">
        <summary>Recent sales{list.status === "ready" && !list.value.coverage ? ` (${list.value.total.toLocaleString("en-GB")})` : ""}</summary>
        {list.status === "unavailable" && <span className="market-note">Unknown for this area.</span>}
        {list.status === "ready" && (
          <RecentSalesTable list={list.value} sort={sort} onSort={(next) => { setSort(next); setPage(1); }} onPage={setPage}
            collapsed={!expanded} onExpand={() => setExpanded(true)} note={false} />
        )}
      </details>
    );
  }
  return (
    <div className="market-recent" data-testid="market-recent">
      <h3 className="market-heading">Recent sales <HelpTip id="market-recent" /></h3>
      {list.status === "loading" && <p className="market-note">Loading recent sales…</p>}
      {list.status === "unavailable" && <p className="market-note">Recent sales are unknown for this area.</p>}
      {list.status === "ready" && (
        <RecentSalesTable list={list.value} sort={sort} onSort={(next) => { setSort(next); setPage(1); }} onPage={setPage}
          collapsed={!expanded} onExpand={() => setExpanded(true)} />
      )}
    </div>
  );
}

/** Rows shown before "Show all". */
export const RECENT_PREVIEW_ROWS = 5;

export function RecentSalesTable({ list, sort, onSort, onPage, collapsed = false, onExpand, note = true }: {
  list: RecentSalesResponse;
  sort: RecentSalesSort;
  onSort: (sort: RecentSalesSort) => void;
  onPage: (page: number) => void;
  collapsed?: boolean;
  onExpand?: () => void;
  /** The "Last N months, nearest first" line; the area card says it in its ⓘ. */
  note?: boolean;
}) {
  const first = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const last = Math.min(list.total, list.page * list.pageSize);
  const pages = Math.max(1, Math.ceil(list.total / (list.pageSize || RECENT_PAGE_SIZE)));
  const sales = collapsed ? list.sales.slice(0, RECENT_PREVIEW_ROWS) : list.sales;
  const more = collapsed && list.total > sales.length;
  // Each sale is per-home data, London's alone: elsewhere one line says so, never "No sales recorded".
  if (list.coverage) return <p className="market-note" data-testid="per-home-london-only">{londonOnlyWords("Individual homes")}</p>;
  return (
    <>
      {note && (
        <p className="market-note">
          Last {list.months} months{list.basis.widened ? " in the wider area" : ""}, {sort === "nearest" ? "nearest first" : "newest first"}.
        </p>
      )}
      {!collapsed && (
        <div className="market-sort" role="group" aria-label="Order of recent sales">
          <button type="button" aria-pressed={sort === "nearest"} onClick={() => onSort("nearest")}>Nearest</button>
          <button type="button" aria-pressed={sort === "newest"} onClick={() => onSort("newest")}>Newest</button>
        </div>
      )}
      {sales.length === 0 ? <p className="market-note">No sales recorded here in this time.</p> : (<>
        <StemDivider className="stem-divider table-stem" />
        <table className="market-sales" data-testid="market-sales">
          <thead><tr><th scope="col">Date</th><th scope="col">Address</th><th scope="col">Type</th><th scope="col">Tenure</th><th scope="col">Price</th></tr></thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale.transactionId}>
                <td data-label="Date">{formatDay(sale.date)}</td>
                <td data-label="Address">{sale.address}{sale.distanceMetres !== null && <small> · {formatDistance(sale.distanceMetres)}</small>}</td>
                <td data-label="Type">{PROPERTY_TYPE_LABELS[sale.propertyType]}{sale.newBuild && <small> · new</small>}</td>
                <td data-label="Tenure">{TENURE_LABELS[sale.tenure] ?? "Unknown"}</td>
                <td data-label="Price">{formatPounds(sale.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>)}
      {more && (
        <button type="button" className="housing-show-all" data-testid="market-show-all" onClick={onExpand}>
          <span>Show all {list.total.toLocaleString("en-GB")}</span>
        </button>
      )}
      {!collapsed && (
        <nav className="market-pager" aria-label="Recent sales pages">
          <button type="button" disabled={list.page <= 1} onClick={() => onPage(list.page - 1)}>Previous</button>
          <span data-testid="market-page">{first}–{last} of {list.total.toLocaleString("en-GB")}</span>
          <button type="button" disabled={list.page >= pages} onClick={() => onPage(list.page + 1)}>Next</button>
        </nav>
      )}
    </>
  );
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m away` : `${(metres / 1000).toFixed(1)} km away`;
}
