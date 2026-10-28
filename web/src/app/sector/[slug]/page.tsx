import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { SatinBlock, SatinValueBar } from "@/components/knit/satin";
import { DemoNotice } from "@/components/property-profile";
import { SectorDistributionChart, SectorIndexChart } from "@/components/sector-charts";
import { SiteHeader } from "@/components/site-header";
import { retryLaterForCrawlers } from "@/components/unavailable-page";
import type { NearbySector, SectorStreet, SectorValue } from "@/lib/contracts";
import { serverSector } from "@/lib/deployment";
import { formatMonth } from "@/lib/market";
import { formatPerArea } from "@/lib/money-format";
import {
  formatPpmRange, formatRate, outlinePath, rangeBar, returnsRows, sectorFromParam, sectorHeadline, sectorPath, sectorTitle, sharedRange,
} from "@/lib/sector";
import { pageMetadata, placeJsonLd, siteOrigin } from "@/lib/seo";

import "../../postcode/[code]/postcode.css";
import "./sector.css";

interface SectorPageProps {
  params: Promise<{ slug: string }>;
}

/** One API call per request for the page, its metadata and its JSON-LD. */
const loadSector = cache((slug: string) => serverSector(slug));

async function resolve(params: SectorPageProps["params"]) {
  const parsed = sectorFromParam((await params).slug);
  return parsed ? { ...parsed, loaded: await loadSector(parsed.slug) } : null;
}

/** "W5 1 · Ealing Broadway: £8,240/m² middle of 130 sales in the 24 months to Jul 2026, …". */
function describe(value: SectorValue): string {
  const headline = sectorHeadline(value);
  const title = sectorTitle(value.sector);
  const figure = headline.median !== null && headline.sales !== null
    ? `${formatPerArea(headline.median)} middle of ${headline.sales} sales${headline.periodEnd ? ` in the 24 months to ${formatMonth(headline.periodEnd)}` : ""}`
    : "too few recent sales with a floor area for a £/m² range";
  return `${title}: ${figure}; price index since 2004, nearby sectors and streets.`;
}

export async function generateMetadata({ params }: SectorPageProps): Promise<Metadata> {
  const found = await resolve(params);
  const value = found?.loaded.sector;
  if (!found || !value) return { title: "Postcode sector" };
  // This segment's opengraph-image.tsx is the card: no image here.
  return pageMetadata({
    title: `${sectorTitle(value.sector)}: house prices per m² and streets`,
    description: describe(value),
    path: sectorPath(found.code),
    image: null,
  });
}

// Permanent postcode sector page (docs/housemetric-gap-2026-10/sector-spec.md): what homes
// sold for per m² here, how that moved since 2004, and how it sits among its neighbours.
// Aggregates only: a sector's or a street's middle, never one home or an address.
// Server-rendered; the two charts measure themselves on the client.
export default async function SectorPage({ params }: SectorPageProps) {
  const found = await resolve(params);
  if (!found) notFound();
  if ((await params).slug !== found.slug) permanentRedirect(sectorPath(found.code));
  const { mode, status, sector: value } = found.loaded;
  // A refused read (429) is "try again", never a 404 for a real sector.
  if ((status >= 400 && status < 500 && status !== 429) || (!value && mode === "demo")) notFound();
  if (!value) {
    await retryLaterForCrawlers(status, "sector");
    return (
      <main className="methodology postcode-page sector-page" data-testid="sector-page">
        <SiteHeader />
        <p className="eyebrow">Postcode sector</p>
        <h1>{found.code}</h1>
        <p className="methodology-intro">This sector&apos;s figures can&apos;t be loaded right now. Please try again shortly.</p>
      </main>
    );
  }
  const { sector, distribution, index, nearby, streets } = value;
  const headline = sectorHeadline(value);
  const period = distribution?.periodEnd ? formatMonth(distribution.periodEnd) : null;
  const returns = returnsRows(value.returns);
  return (
    <main className="methodology postcode-page sector-page" data-testid="sector-page">
      <SiteHeader />
      <p className="eyebrow">Postcode sector</p>
      <div className="sector-head">
        <div>
          <h1>{sector.code}{sector.name && <span className="sector-head__name"> · {sector.name}</span>}</h1>
          <p className="sector-head__where">
            {[sector.borough?.name, `district ${sector.district}`, `${sector.postcodeCount} postcodes`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <SectorOutline sector={sector} />
      </div>
      <DemoNotice mode={mode} />
      <Headline headline={headline} period={period} />

      <section className="postcode-panel" aria-labelledby="sector-distribution-title">
        <div className="postcode-panel__head"><h2 id="sector-distribution-title">£/m² of sales{period ? `, 24 months to ${period}` : ""}</h2></div>
        {distribution?.sector ? (
          <>
            <SectorDistributionChart code={sector.code} district={sector.district} sector={distribution.sector}
              districtDistribution={distribution.district}
              label={`£ per m² of ${distribution.sector.sales} sales in ${sector.code}: middle half ${formatPerArea(distribution.sector.p25)} to ${formatPerArea(distribution.sector.p75)}, middle ${formatPerArea(distribution.sector.p50)}`} />
            <dl className="sector-figures">
              <SpreadFigure name={sector.code} distribution={distribution.sector} />
              {distribution.district
                ? <SpreadFigure name={`District ${sector.district}`} distribution={distribution.district} />
                : <div><dt>District {sector.district}</dt><dd>Too few sales to show</dd></div>}
            </dl>
            <p className="postcode-chart__caption">Bars: sales in each £/m² band. Strips: the box is the middle half, the line the middle, the whiskers the 9th to 91st percentile.</p>
          </>
        ) : <p className="chart-unknown" data-testid="sector-suppressed">Fewer than 20 sales with a floor area here in 24 months: too few to show a range.</p>}
      </section>

      {index && index.series.length > 0 && (
        <section className="postcode-panel" aria-labelledby="sector-index-title">
          <div className="postcode-panel__head"><h2 id="sector-index-title">Median £/m² since {index.base} ({index.base} = 100)</h2></div>
          <SectorIndexChart code={sector.code} district={sector.district} borough={sector.borough?.name ?? null} base={index.base} series={index.series} />
        </section>
      )}

      {returns.length > 0 && (
        <section className="postcode-panel" aria-labelledby="sector-returns-title">
          <div className="postcode-panel__head"><h2 id="sector-returns-title">Growth a year</h2></div>
          <div className="property-table-wrap" tabIndex={0} role="region" aria-label="Growth a year">
            <table className="sales-table sector-returns" data-testid="sector-returns">
              <caption className="sr-only">Compound growth in median £/m² a year, after inflation (CPIH) and in pounds of the day</caption>
              <thead>
                <tr><th rowSpan={2}>Over</th><th colSpan={2}>{sector.code}</th><th colSpan={2}>District {sector.district}</th></tr>
                <tr><th>Real</th><th>Nominal</th><th>Real</th><th>Nominal</th></tr>
              </thead>
              <tbody>
                {returns.map((row) => (
                  <tr key={row.years}>
                    <th scope="row">{row.years} {row.years === 1 ? "year" : "years"}</th>
                    <td>{row.sector?.real ?? "—"}</td><td>{row.sector?.nominal ?? "—"}</td>
                    <td>{row.district?.real ?? "—"}</td><td>{row.district?.nominal ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="postcode-chart__caption">Real is after inflation (ONS CPIH). A horizon with too few sales at either end is left out.</p>
        </section>
      )}

      {nearby.length > 0 && <NearbySectors rows={nearby} />}
      {streets.length > 0 && <Streets streets={streets} />}

      <details className="postcode-sources">
        <summary>Sources</summary>
        <div className="postcode-sources__body">
          <p>
            Sold prices: HM Land Registry Price Paid (category A sales). Floor areas: energy performance certificates (EPC).
            Inflation: ONS CPIH (series L522). Postcodes: ONS Postcode Directory. All under the Open Government Licence.
          </p>
          <p>£/m² uses EPC floor area; sector names are informal. Middles of many sales, never one home&apos;s value.</p>
        </div>
      </details>
      <SectorJsonLd value={value} />
    </main>
  );
}

function Headline({ headline, period }: { headline: ReturnType<typeof sectorHeadline>; period: string | null }) {
  const change = headline.realChange;
  return (
    <div className="postcode-hero" data-testid="sector-headline">
      <div className="postcode-stat" data-lead="">
        <span className="postcode-stat__label">Median £/m²</span>
        {headline.median !== null
          ? <span className="postcode-stat__value">{formatPerArea(headline.median)}</span>
          : <span className="postcode-stat__value" data-long="">Too few sales</span>}
        {period && <span className="postcode-stat__detail">Sales in the 24 months to {period}</span>}
      </div>
      <div className="postcode-stat">
        <span className="postcode-stat__label">Last year, after inflation</span>
        <span className="postcode-stat__value sector-change">
          {change !== null && change !== 0 && <KnitIcon name={change > 0 ? "rise" : "fall"} colour="currentColor" className="sector-change__icon" />}
          {formatRate(change)}
        </span>
      </div>
      <div className="postcode-stat">
        <span className="postcode-stat__label">Sales, 24 months</span>
        <span className="postcode-stat__value">{headline.sales ?? "—"}</span>
        <span className="postcode-stat__detail">with a floor area</span>
      </div>
    </div>
  );
}

function SpreadFigure({ name, distribution }: { name: string; distribution: { sales: number; p25: number; p50: number; p75: number } }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd><strong>{formatPerArea(distribution.p50)}</strong> middle · {formatPpmRange(distribution.p25, distribution.p75)} middle half · {distribution.sales} sales</dd>
    </div>
  );
}

/** The sector's boundary as a solid silhouette; nothing when the API sends no geometry. */
function SectorOutline({ sector }: { sector: SectorValue["sector"] }) {
  const d = outlinePath(sector.geometry, 120, 96, 6);
  if (!d) return null;
  return (
    <svg className="sector-head__map" viewBox="0 0 120 96" width={120} height={96} role="img" aria-label={`Outline of postcode sector ${sector.code}`}>
      <path d={d} className="sector-head__shape" fillRule="evenodd" />
    </svg>
  );
}

const BAR = { width: 150, height: 14 };

/** Neighbouring sectors, dearest first: each one's middle half on one shared £/m² scale, this sector highlighted. */
function NearbySectors({ rows }: { rows: NearbySector[] }) {
  const range = sharedRange(rows);
  return (
    <section className="postcode-panel" aria-labelledby="sector-nearby-title">
      <div className="postcode-panel__head">
        <h2 id="sector-nearby-title">Nearby sectors, middle half of £/m²</h2>
        {range && <span className="postcode-chart__count">{formatPpmRange(range.domain[0], range.domain[1])}</span>}
      </div>
      <ol className="sector-rows" data-testid="sector-nearby">
        {rows.map((row) => {
          const bar = range ? rangeBar(row, range.domain) : null;
          const name = <><strong>{row.code}</strong>{row.name && <span>{row.name}</span>}</>;
          return (
            <li key={row.code} data-self={row.isSelf ? "" : undefined}>
              {row.isSelf ? <span className="sector-rows__name" aria-current="page">{name}</span>
                : <Link className="sector-rows__name" href={sectorPath(row.code)}>{name}</Link>}
              <svg className="sector-rows__bar" viewBox={`0 0 ${BAR.width} ${BAR.height}`} width={BAR.width} height={BAR.height} aria-hidden="true">
                <rect x={0} y={0} width={BAR.width} height={BAR.height} rx={2.5} style={{ fill: "var(--wool)" }} />
                {bar && <SatinBlock x={bar.from * BAR.width} y={0} width={(bar.to - bar.from) * BAR.width} height={BAR.height}
                  colour={row.isSelf ? "var(--chart-1)" : "var(--chart-neutral)"} slant={3} seed={row.sales % 9} />}
                {bar?.median != null && <rect className="sector-chart__median" x={bar.median * BAR.width - 1.5} y={-3} width={3} height={BAR.height + 6} rx={1.5} />}
              </svg>
              <span className="sector-rows__value">
                {row.p25 !== null && row.p75 !== null ? formatPpmRange(row.p25, row.p75) : "Too few sales"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Streets with five or more sales in five years: name, sales, median size and median £/m² as a bar. */
function Streets({ streets }: { streets: SectorStreet[] }) {
  const top = Math.max(0, ...streets.map((street) => street.medianPpm ?? 0));
  return (
    <section className="postcode-panel" aria-labelledby="sector-streets-title">
      <div className="postcode-panel__head"><h2 id="sector-streets-title">Streets, last five years</h2></div>
      <div className="property-table-wrap" tabIndex={0} role="region" aria-label="Streets">
        <table className="sales-table sector-streets" data-testid="sector-streets">
          <caption className="sr-only">Streets with five or more sales in five years: sales, median floor area and median £ per m²</caption>
          <thead><tr><th>Street</th><th>Sales</th><th>Median size</th><th>Median £/m²</th></tr></thead>
          <tbody>
            {streets.map((street) => (
              <tr key={street.name}>
                <th scope="row">{street.name}</th>
                <td>{street.sales}</td>
                <td>{street.medianFloorArea === null ? "—" : `${Math.round(street.medianFloorArea)} m²`}</td>
                <td>{street.medianPpm === null ? "—"
                  : <SatinValueBar value={street.medianPpm} max={top} colour="var(--chart-1)" label={formatPerArea(street.medianPpm)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** schema.org Place for the sector, beside the page. */
async function SectorJsonLd({ value }: { value: SectorValue }) {
  const origin = await siteOrigin();
  if (!origin) return null;
  const data = placeJsonLd(origin, { name: sectorTitle(value.sector), path: sectorPath(value.sector.code), description: describe(value) });
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: data }} />;
}
