"use client";

import Link from "next/link";
import { useMemo } from "react";

import { ChartFrame, ScaleMarker, Waffle, scalePosition } from "@/components/charts";
import type { GeographyId } from "@/lib/contracts";
import { LONDON_NOISE } from "@/lib/noise-evidence";
import { noisePath } from "@/lib/section-seed";
import { useSectionJson } from "./section-seed";
import { sourceLabel } from "@/lib/sourced";

export interface AreaNoise {
  available: boolean;
  dwellings: number;
  road55Share: number | null;
  rail55Share: number | null;
  any55Share: number | null;
  any65Share: number | null;
  roadLdenMedian: number | null;
  air55Share: number | null;
  roadLdenMappedShare: number | null;
  dwelling: { uprn: string; roadLden: number | null; railLden: number | null } | null;
  sourceVersion: string | null;
  attribution: string | null;
  caveats: string[];
}

const LONDON = LONDON_NOISE.value;
const SCALE_MIN = 40;
const SCALE_MAX = 80;

const percent = (share: number | null) => share === null ? "unknown" : `${Math.round(share * 100)}%`;
const level = (value: number | null) => value === null ? "under 40 dB (not mapped)" : `${value.toFixed(1)} dB`;

/** The area's strategic noise figures (real releases only), null while loading. */
export function useAreaNoise(geographyId: GeographyId, uprn: string | null): AreaNoise | null | "unavailable" {
  const payload = useSectionJson<AreaNoise>(noisePath(geographyId, uprn));
  return useMemo(() => payload === undefined ? null : payload?.available ? payload : "unavailable", [payload]);
}

/**
 * Real strategic noise (Defra Round 4, 2022): how many of the area's homes sit
 * at or above 55 dB Lden — the level the WHO links to harmful road noise — as
 * a waffle, the typical road level on a 40–80 dB scale and, for a chosen
 * home, its own modelled road and rail levels.
 */
export function AreaNoiseSection({ geographyId, uprn }: { geographyId: GeographyId; uprn: string | null }) {
  const noise = useAreaNoise(geographyId, uprn);

  return (
    <section className="area-noise" data-testid="area-noise" aria-label="Road, rail and aircraft noise">
      <h2>Road, rail and aircraft noise</h2>
      {noise === null && <p>Loading noise evidence…</p>}
      {noise === "unavailable" && (
        <p data-testid="area-noise-unknown">No noise data here yet · <Link href="/guide/noise">Why?</Link></p>
      )}
      {noise && noise !== "unavailable" && <NoiseFigures noise={noise} />}
    </section>
  );
}

function NoiseFigures({ noise }: { noise: AreaNoise }) {
  const london = noise.sourceVersion === LONDON.sourceVersion ? LONDON : null;
  const median = noise.roadLdenMedian;
  return (
    <>
      {noise.dwelling && (
        <p className="et-home-line" data-testid="dwelling-noise">
          This home: road <strong>{level(noise.dwelling.roadLden)}</strong> · rail <strong>{level(noise.dwelling.railLden)}</strong> Lden
        </p>
      )}
      <ChartFrame
        title="Homes at 55 dB+"
        help="noise-lden"
        unknown={noise.any55Share === null ? "Unknown" : null}
        sources={(
          <>
            <p>{noise.dwellings.toLocaleString("en-GB")} homes · whole-day average (Lden) · road, rail and aircraft (airport) noise.</p>
            {london && <p>London: share of all mapped homes and median of area road levels, same release ({sourceLabel(LONDON_NOISE)}).</p>}
            {noise.caveats.length > 0 && <ul>{noise.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>}
            {noise.attribution && <p className="licence-note">{noise.attribution}</p>}
          </>
        )}
      >
        <div className="et-noise" data-testid="area-noise-share">
          <Waffle share={noise.any55Share} label="Homes at 55 dB or more, road, rail or aircraft" />
          <div className="et-noise__figures">
            <span className="et-big">{percent(noise.any55Share)}</span>
            <span className="et-caption">of homes, road or rail</span>
            {london && <span className="et-caption" data-testid="area-noise-london">London {percent(london.any55Share)} ({sourceLabel(LONDON_NOISE)})</span>}
            <dl className="et-noise__split">
              <div><dt>Road</dt><dd>{percent(noise.road55Share)}</dd></div>
              <div><dt>Rail</dt><dd>{percent(noise.rail55Share)}</dd></div>
              <div><dt>Air</dt><dd>{percent(noise.air55Share)}</dd></div>
              <div><dt>65 dB+</dt><dd>{percent(noise.any65Share)}</dd></div>
            </dl>
          </div>
        </div>
      </ChartFrame>
      <ChartFrame title="Typical road noise" unknown={median === null ? "Unknown" : null}>
        {median !== null && (
          <div className="et-road" data-testid="area-noise-road">
            <span className="et-road__value"><strong>{median.toFixed(0)} dB</strong> <span className="et-caption">middle home</span></span>
            {noise.roadLdenMappedShare !== null && noise.roadLdenMappedShare < 1 && (
              <span className="et-caption" data-testid="area-noise-mapped-share">{percent(noise.roadLdenMappedShare)} of homes mapped (under 40 dB not mapped)</span>
            )}
            <ScaleMarker
              position={scalePosition(median, SCALE_MIN, SCALE_MAX)}
              marker={london ? scalePosition(london.roadLdenMedian, SCALE_MIN, SCALE_MAX) : null}
              low="40 dB quiet"
              high="80 dB loud"
              label={`Typical home's road noise: ${median.toFixed(0)} dB Lden${london ? `, London ${london.roadLdenMedian.toFixed(0)} dB` : ""}, on a 40 to 80 dB scale`}
            />
          </div>
        )}
      </ChartFrame>
    </>
  );
}
