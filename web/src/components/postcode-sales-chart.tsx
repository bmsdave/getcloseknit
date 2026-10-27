"use client";

import { useEffect, useRef, useState } from "react";

import { formatDay, formatPoundsShort } from "@/lib/market";
import { salesChart, type SalePoint, type TrendLine } from "@/lib/postcode-visuals";

import { StemDivider, StemLine } from "./knit/satin";

const HEIGHT = 240;
const MARGIN = { left: 50, right: 10, top: 10, bottom: 24 };
const TONES = ["c1", "c2"] as const;

const money = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;
const KIND_WORD = { flat: "Flat", house: "House" } as const;

/**
 * Every recorded sale in the postcode as a dot on a time axis, with the
 * neighbourhood's and the borough's yearly medians as lines for context.
 * No sale is drawn by £ per m² (no per-sale £/m² while the EPC licence is
 * pending). Where the postcode
 * has flats and houses, house sales are drawn hollow so the two price levels
 * read apart. The SVG is drawn
 * at its on-screen width so its labels stay readable on a phone.
 */
export function PostcodeSalesChart({ postcode, sales, lines, totalSales = sales.length, caption = null }: {
  postcode: string;
  sales: SalePoint[];
  lines: TrendLine[];
  /** Sales on record in the postcode; more than `sales` when the page read only some homes. */
  totalSales?: number;
  /** One line under the chart, e.g. the middle of every sale since the 1990s (never a headline). */
  caption?: string | null;
}) {
  const [asTable, setAsTable] = useState(false);
  const [width, setWidth] = useState(640);
  const plot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = plot.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const mixed = sales.some((sale) => sale.kind === "flat") && sales.some((sale) => sale.kind === "house");
  const kindOf = (sale: SalePoint) => sale.kind ?? "other";
  const geometry = salesChart(sales, lines, { width, height: HEIGHT, ...MARGIN });
  const label = `${sales.length} recorded ${sales.length === 1 ? "sale" : "sales"} in ${postcode} by date and price`;
  const table = (
    <table className="sales-table">
      <thead><tr><th>Date</th>{mixed && <th>Home</th>}<th>Price</th></tr></thead>
      <tbody>
        {[...sales].reverse().map((sale) => (
          <tr key={`${sale.addressId}-${sale.date}-${sale.price}`}>
            <td>{formatDay(sale.date)}</td>{mixed && <td>{sale.kind ? KIND_WORD[sale.kind] : "Other"}</td>}<td>{money(sale.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <div className="postcode-panel__head">
        <h2 id="postcode-chart-title">Sales over time</h2>
        <button type="button" className="chart-frame__toggle" aria-pressed={asTable} onClick={() => setAsTable((value) => !value)}>
          <span>Show as table</span>
        </button>
      </div>
      {asTable ? <div className="chart-table"><StemDivider className="stem-divider table-stem" />{table}</div> : (
      <div className="postcode-chart" data-testid="postcode-sales-chart">
        <div className="postcode-chart__switch">
          <span className="postcode-chart__count">
            {totalSales > sales.length ? `${sales.length} of ${totalSales} recorded sales loaded` : `${sales.length} ${sales.length === 1 ? "sale" : "sales"}`}
          </span>
        </div>
        <div className="postcode-chart__plot" ref={plot}>
          {geometry ? (
            <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="img" aria-label={label}>
              {geometry.yTicks.map((tick) => (
                <g key={tick.value} className="market-grid">
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={tick.y} y2={tick.y} />
                  <text x={MARGIN.left - 6} y={tick.y} dy="0.32em" textAnchor="end">{formatPoundsShort(tick.value)}</text>
                </g>
              ))}
              {geometry.xTicks.map((tick) => (
                <text key={tick.year} className="market-axis" x={tick.x} y={HEIGHT - 6} textAnchor="middle">{tick.year}</text>
              ))}
              {geometry.lines.map((line, index) => (
                // Stem stitch; the second series is a finer thread, so colour is not the only cue.
                <g key={line.key} className="postcode-chart__series" data-chart-tone={TONES[index % TONES.length]}>
                  <StemLine d={line.path} colour="var(--tone)" width={index % 2 ? 1.6 : 2.7} />
                </g>
              ))}
              {geometry.dots.map((dot) => (
                <circle key={`${dot.sale.addressId}-${dot.sale.date}-${dot.sale.price}`} className="postcode-chart__dot"
                  cx={dot.x} cy={dot.y} r={4.5} data-testid="postcode-sale-dot" data-kind={mixed ? kindOf(dot.sale) : undefined}>
                  <title>{`${formatDay(dot.sale.date)}${mixed && dot.sale.kind ? `, ${KIND_WORD[dot.sale.kind].toLowerCase()}` : ""}: ${money(dot.sale.price)}`}</title>
                </circle>
              ))}
            </svg>
          ) : <p className="chart-unknown">No recorded sale to draw.</p>}
        </div>
        <ul className="postcode-chart__legend">
          {mixed ? <>
            <li><span className="postcode-chart__key postcode-chart__key--dot" data-kind="flat" />A flat sold in {postcode}</li>
            <li><span className="postcode-chart__key postcode-chart__key--dot" data-kind="house" />A house sold</li>
            {sales.some((sale) => sale.kind === null) && <li><span className="postcode-chart__key postcode-chart__key--dot" data-kind="other" />Other or unknown</li>}
          </> : <li><span className="postcode-chart__key postcode-chart__key--dot" />A sale in {postcode}</li>}
          {lines.map((line, index) => (
            <li key={line.key}>
              <span className="postcode-chart__key postcode-chart__key--stem" data-chart-tone={TONES[index % TONES.length]}>
                <svg viewBox="0 0 16 4" aria-hidden="true"><StemLine d="M1 2H15" colour="var(--tone)" width={index % 2 ? 1.6 : 2.7} /></svg>
              </span>
              {line.label}
            </li>
          ))}
        </ul>
        {caption && <p className="postcode-chart__caption" data-testid="postcode-chart-caption">{caption}</p>}
      </div>
      )}
    </>
  );
}
