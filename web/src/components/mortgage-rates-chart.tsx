import { HelpTip } from "@/components/help-tip";
import { BOE_RETRIEVED, LATEST_BOE_RATES } from "@/lib/boe-latest";
import { Dot, YarnSwatch } from "@/components/knit";
import { StemDivider, StemLine } from "@/components/knit/satin";
import dataset from "@/lib/mortgage-rates-boe.json";
import {
  RATE_KEYS,
  RATE_LABELS,
  formatMonth,
  rateChart,
  spreadOverBankRate,
  type RateDataset,
  type RateKey,
  type RatePoint,
} from "@/lib/mortgage-rates";
import { formatAsOf, sourceLabel } from "@/lib/sourced";

const DATA = dataset as RateDataset;
// Chart drawn in a 1000 × 400 box and stretched to fit; labels sit in HTML so they stay readable on a phone.
const BOX = { width: 1000, height: 400, left: 0, right: 0, top: 8, bottom: 0 };

export function MortgageRatesChart() {
  const points = DATA.points;
  const chart = rateChart(points, BOX);
  const latest = LATEST_BOE_RATES?.value ?? null;
  const first = points[0];
  const last = points.at(-1);
  return (
    <>
      {latest && <LatestRates latest={latest} />}
      <section className="methodology-card tools-card" aria-labelledby="rates-chart">
        <h2 id="rates-chart">Since {first ? formatMonth(first.month) : "1996"}</h2>
        <ul className="rates-legend" aria-label="Lines">
          {RATE_KEYS.map((key) => <li key={key} data-rate={key}><RateMark rate={key} />{RATE_LABELS[key]}</li>)}
        </ul>
        <figure className="rates-chart" data-testid="rates-chart">
          <div className="rates-chart__plot">
            <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} preserveAspectRatio="none" role="img"
              aria-label={`Bank Rate and 2-, 3- and 5-year fixed mortgage rates at 75% loan-to-value, monthly, ${first ? formatMonth(first.month) : ""} to ${last ? formatMonth(last.month) : ""}. Figures in the table below.`}>
              {chart.yTicks.map((tick) => <line key={tick.value} className="rates-chart__grid" x1={0} x2={BOX.width} y1={tick.y} y2={tick.y} />)}
              {chart.lines.map((line) => (
                <g key={line.key} data-rate={line.key}>
                  {line.segments.map((segment, index) => line.key === "bankRate"
                    ? <path key={index} className="rates-chart__line rates-chart__bank" d={pathOf(segment)} />
                    : <StemLine key={index} className="rates-chart__line" d={pathOf(segment)} colour="var(--line-colour)" width={2.7} />)}
                </g>
              ))}
            </svg>
            {chart.lines.filter((line) => line.key !== "bankRate" && line.segments.length > 0).map((line) => {
              const [x, y] = line.segments.at(-1)!.split(" ").at(-1)!.split(",").map(Number);
              return (
                <span key={line.key} className="rates-chart__dot" data-rate={line.key}
                  style={{ left: `${(x / BOX.width) * 100}%`, top: `${(y / BOX.height) * 100}%` }}>
                  <Dot colour={`var(--rate-${line.key})`} size={13} />
                </span>
              );
            })}
            {chart.yTicks.map((tick) => (
              <span key={tick.value} className="rates-chart__y" style={{ top: `${(tick.y / BOX.height) * 100}%` }}>{tick.value}%</span>
            ))}
          </div>
          <div className="rates-chart__x" aria-hidden="true">
            {chart.xTicks.map((tick) => <span key={tick.label} style={{ left: `${(tick.x / BOX.width) * 100}%` }}>{tick.label}</span>)}
          </div>
          <figcaption className="tools-subtle">
            Monthly averages. Mortgage rates are the average quoted by lenders for a new loan at 75% loan-to-value
            <HelpTip id="mortgage-rates-ltv" />. A blank month means the Bank has not published it yet.
          </figcaption>
        </figure>
        <YearTable points={points} />
      </section>
      <details className="methodology-card tools-card tools-sources-fold" data-testid="rates-sources">
        <summary>Sources</summary>
        <p>
          {DATA.meta.source}, series {RATE_KEYS.map((key) => DATA.meta.series[key].code).join(", ")}.
          Downloaded {DATA.meta.retrieved}. {DATA.meta.attribution}
        </p>
        <ul className="tools-sources">
          <li><a href="https://www.bankofengland.co.uk/boeapps/database/" rel="noreferrer" target="_blank">Bank of England Database</a></li>
          <li><a href="https://www.bankofengland.co.uk/statistics/details/further-details-about-interest-rates-data" rel="noreferrer" target="_blank">About these interest rate figures</a></li>
        </ul>
      </details>
    </>
  );
}

/** A series' key: a strand of its yarn, or a dashed ink rule for Bank Rate. */
function RateMark({ rate }: { rate: RateKey }) {
  return rate === "bankRate"
    ? <span className="rates-mark rates-mark--bank" aria-hidden="true" />
    : <YarnSwatch colour={`var(--rate-${rate})`} className="rates-mark" />;
}

/** "x,y x,y …" (rateChart's segment) as an svg path through exactly those points. */
function pathOf(segment: string): string {
  const points = segment.split(" ");
  // A lone month is a short stitch, so it still shows.
  if (points.length === 1) {
    const [x, y] = points[0].split(",").map(Number);
    return `M${x - 1.5} ${y}H${x + 1.5}`;
  }
  return `M${points.join("L")}`;
}

function LatestRates({ latest }: { latest: RatePoint }) {
  return (
    <section className="methodology-card tools-card" aria-labelledby="rates-latest">
      <h2 id="rates-latest">Latest: {formatMonth(latest.month)}</h2>
      <dl className="tools-stats" data-testid="rates-latest">
        {RATE_KEYS.map((key) => {
          const spread = key === "bankRate" ? null : spreadOverBankRate(latest, key);
          return (
            <div key={key} data-rate={key}>
              <dt><RateMark rate={key} />{RATE_LABELS[key]}</dt>
              <dd>
                <strong>{latest[key]?.toFixed(2)}%</strong>
                {spread !== null && <span>{spread >= 0 ? "+" : "−"}{Math.abs(spread).toFixed(2)} points over Bank Rate</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      {LATEST_BOE_RATES && (
        <p className="tools-subtle" data-testid="rates-latest-source">
          {sourceLabel(LATEST_BOE_RATES)}, downloaded {formatAsOf(BOE_RETRIEVED)}.
        </p>
      )}
    </section>
  );
}

/** January of every year plus the latest month, so every number on the chart can be read. */
function YearTable({ points }: { points: readonly RatePoint[] }) {
  const last = points.at(-1);
  const rows = points.filter((point) => point.month.endsWith("-01") || point === last);
  return (
    <details className="tools-details">
      <summary>Show the figures</summary>
      <div className="tools-table-wrap">
        <StemDivider className="stem-divider table-stem" />
        <table className="tools-table" data-testid="rates-table">
          <thead><tr><th scope="col">Month</th>{RATE_KEYS.map((key) => <th key={key} scope="col">{RATE_LABELS[key]}</th>)}</tr></thead>
          <tbody>
            {rows.map((point) => (
              <tr key={point.month}>
                <th scope="row">{formatMonth(point.month)}</th>
                {RATE_KEYS.map((key) => <td key={key}>{point[key] === null ? "Not yet published" : `${point[key]?.toFixed(2)}%`}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
