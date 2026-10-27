"use client";

import { useEffect, useRef, useState } from "react";

import type { SectorDistribution, SectorIndexPoint, SectorIndexZone } from "@/lib/contracts";
import { formatPoundsShort } from "@/lib/market";
import { formatPerArea } from "@/lib/money-format";
import {
  boxGeometry, distributionDomain, histogramBars, indexChart, linearScale, niceDomain,
} from "@/lib/sector";

import { SatinBlock, StemLine } from "./knit/satin";

/** Charts are drawn at their on-screen width so the 12px labels stay 12px on a phone. */
function useMeasuredWidth(initial = 640) {
  const [width, setWidth] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const SECTOR_TONE = "var(--chart-1)";
// Categorical, never the alarm red.
const DISTRICT_TONE = "var(--chart-4)";

const DIST = { left: 64, right: 12, top: 6, plot: 112, strip: 24, axis: 22 };

/**
 * £/m² of the sector's sales as a histogram, with the sector and its district as box
 * strips underneath on the same scale: p09–p91 whiskers, the p25–p75 box, the p50 line.
 */
export function SectorDistributionChart({ code, district, sector, districtDistribution, label }: {
  code: string;
  district: string;
  sector: SectorDistribution;
  districtDistribution: SectorDistribution | null;
  label: string;
}) {
  const { ref, width } = useMeasuredWidth();
  const { domain, ticks } = niceDomain(...distributionDomain(sector, districtDistribution), 4);
  const x = linearScale(domain, [DIST.left, width - DIST.right]);
  const bars = histogramBars(sector.buckets, x, DIST.plot);
  const strips = [
    { key: "sector", name: code, distribution: sector, tone: SECTOR_TONE },
    ...(districtDistribution ? [{ key: "district", name: district, distribution: districtDistribution, tone: DISTRICT_TONE }] : []),
  ];
  const stripTop = DIST.top + DIST.plot + 8;
  const height = stripTop + strips.length * DIST.strip + DIST.axis;
  return (
    <div className="postcode-chart__plot" ref={ref} data-testid="sector-distribution">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
        {bars.map((bar) => bar.height > 0 && (
          <g key={bar.from}>
            <SatinBlock x={bar.x} y={DIST.top + DIST.plot - bar.height} width={bar.width} height={Math.max(2, bar.height)}
              colour={SECTOR_TONE} slant={3} seed={bar.from % 7} />
            <title>{`${formatPerArea(bar.from)} to ${formatPerArea(bar.to)}: ${bar.count} ${bar.count === 1 ? "sale" : "sales"}`}</title>
          </g>
        ))}
        <line className="sector-chart__base" x1={DIST.left} x2={width - DIST.right} y1={DIST.top + DIST.plot + 0.5} y2={DIST.top + DIST.plot + 0.5} />
        {strips.map((strip, index) => {
          const y = stripTop + index * DIST.strip;
          const box = boxGeometry(strip.distribution, x);
          const mid = y + DIST.strip / 2 - 2;
          return (
            <g key={strip.key} data-testid={`sector-strip-${strip.key}`}>
              <text className="market-axis" x={DIST.left - 8} y={mid} dy="0.32em" textAnchor="end">{strip.name}</text>
              <StemLine d={`M${box.whiskerFrom} ${mid}H${box.whiskerTo}`} colour="var(--muted)" width={1.6} />
              <SatinBlock x={box.boxFrom} y={mid - 7} width={box.boxTo - box.boxFrom} height={14} colour={strip.tone} slant={4} seed={index + 3} />
              <rect className="sector-chart__median" x={box.median - 1.5} y={mid - 10} width={3} height={20} rx={1.5} />
            </g>
          );
        })}
        {ticks.map((tick) => (
          <text key={tick} className="market-axis" x={x(tick)} y={height - 6} textAnchor="middle">{formatPoundsShort(tick)}</text>
        ))}
      </svg>
    </div>
  );
}

const INDEX_HEIGHT = 240;
const INDEX_MARGIN = { left: 40, right: 14, top: 10, bottom: 24 };
const ZONE_TONE: Record<SectorIndexZone, string> = { sector: "c1", district: "c2", "borough-house": "c3", "borough-flat": "c3" };

/**
 * The price index since its base year (= 100): the sector and its district, with the
 * borough's houses or flats on a toggle. Real (after CPIH) is the solid stem stitch,
 * nominal the dotted thread; a dot marks the latest real year.
 */
export function SectorIndexChart({ code, district, borough, base, series }: {
  code: string;
  district: string;
  borough: string | null;
  base: number;
  series: { zone: SectorIndexZone; points: SectorIndexPoint[] }[];
}) {
  const { ref, width } = useMeasuredWidth();
  const has = (zone: SectorIndexZone) => series.some((entry) => entry.zone === zone);
  const [kind, setKind] = useState<"borough-house" | "borough-flat">(has("borough-house") ? "borough-house" : "borough-flat");
  const zones: SectorIndexZone[] = ["sector", "district", kind];
  const chart = indexChart(series, zones, { width, height: INDEX_HEIGHT, ...INDEX_MARGIN });
  const names: Record<SectorIndexZone, string> = {
    sector: code, district,
    "borough-house": `${borough ?? "Borough"} houses`, "borough-flat": `${borough ?? "Borough"} flats`,
  };
  const latest = chart?.lines.filter((line) => line.end).map((line) => `${names[line.zone]} ${Math.round(line.end?.value ?? 0)}`) ?? [];
  const label = `Price index, ${base} = 100, after inflation: ${latest.join(", ") || "no data"}`;
  return (
    <div className="postcode-chart" data-testid="sector-index">
      {(has("borough-house") || has("borough-flat")) && (
        <div className="postcode-chart__switch" role="group" aria-label={`Compare with ${borough ?? "the borough"}`}>
          {(["borough-house", "borough-flat"] as const).map((zone) => (
            <button key={zone} type="button" aria-pressed={kind === zone} disabled={!has(zone)} onClick={() => setKind(zone)}>
              {zone === "borough-house" ? "Houses" : "Flats"} in {borough ?? "the borough"}
            </button>
          ))}
        </div>
      )}
      <div className="postcode-chart__plot" ref={ref}>
        {chart ? (
          <svg viewBox={`0 0 ${width} ${INDEX_HEIGHT}`} width={width} height={INDEX_HEIGHT} role="img" aria-label={label}>
            {chart.yTicks.map((tick) => (
              <g key={tick.value} className="market-grid">
                <line x1={INDEX_MARGIN.left} x2={width - INDEX_MARGIN.right} y1={tick.y} y2={tick.y} />
                <text x={INDEX_MARGIN.left - 6} y={tick.y} dy="0.32em" textAnchor="end">{tick.value}</text>
              </g>
            ))}
            {chart.xTicks.map((tick) => (
              <text key={tick.year} className="market-axis" x={tick.x} y={INDEX_HEIGHT - 6} textAnchor="middle">{tick.year}</text>
            ))}
            {chart.lines.map((line) => (
              <g key={line.zone} data-chart-tone={ZONE_TONE[line.zone]} data-zone={line.zone}>
                {line.nominal.map((d) => <path key={`n${d}`} className="sector-chart__nominal" d={d} />)}
                {line.real.map((d) => <StemLine key={`r${d}`} d={d} colour="var(--tone)" width={line.zone === "sector" ? 2.7 : 1.8} />)}
                {line.end && <circle className="sector-chart__end" cx={line.end.x} cy={line.end.y} r={4.5}><title>{`${names[line.zone]}, ${line.end.year}: ${Math.round(line.end.value)}`}</title></circle>}
              </g>
            ))}
          </svg>
        ) : <p className="chart-unknown">Too few sales a year to draw an index.</p>}
      </div>
      <ul className="postcode-chart__legend">
        {chart?.lines.map((line) => (
          <li key={line.zone}><span className="sector-chart__key" data-chart-tone={ZONE_TONE[line.zone]} />{names[line.zone]}</li>
        ))}
        <li><svg className="sector-chart__style" viewBox="0 0 18 4" aria-hidden="true"><StemLine d="M1 2H17" colour="var(--ink)" width={2.2} /></svg>After inflation (CPIH)</li>
        <li><svg className="sector-chart__style" viewBox="0 0 18 4" aria-hidden="true"><path className="sector-chart__nominal" d="M1 2H17" style={{ stroke: "var(--ink)" }} /></svg>In pounds of the day</li>
      </ul>
    </div>
  );
}
