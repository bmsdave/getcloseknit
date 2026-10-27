"use client";

import { useMemo } from "react";

import { SatinStacked } from "@/components/knit/satin";
import type { GeographyId } from "@/lib/contracts";
import { type AreaPipelineResponse, pipelinePath, readAreaPipeline } from "@/lib/development-pipeline";
import { SatinSquare } from "./ramp-knit";
import { useSectionJson } from "./section-seed";
import { regionShare } from "@/lib/evidence-format";

const NOT_STARTED = "var(--chart-1)";
const BUILDING = "var(--chart-3)";
const KIND_WORDS = { "opportunity-area": "Opportunity Area", "housing-zone": "Housing Zone" } as const;

/** New homes on the way: the 1 km count split by status, the rate with its London percentile, growth areas. */
export function DevelopmentPipelineBlock({ pipeline }: { pipeline: AreaPipelineResponse | null | "unknown" }) {
  if (pipeline === null) return null;
  const value = pipeline === "unknown" ? null : pipeline.value;
  if (!value) return null;
  const { within1km: near } = value;
  return (
    <div className="development-pipeline" data-testid="development-pipeline">
      <h3>New homes on the way</h3>
      <p className="metric-description" data-testid="pipeline-nearby">
        {near.total ? <>≈ <strong>{near.total.toLocaleString("en-GB")}</strong> within 1 km</> : "None within 1 km"}
      </p>
      {near.total > 0 && (
        <>
          <SatinStacked width={240} height={12} parts={[
            { value: near.notStarted, colour: NOT_STARTED }, { value: near.underConstruction, colour: BUILDING }]} />
          <ul className="location-notes" data-testid="pipeline-split">
            <li><SatinSquare colour={NOT_STARTED} size={12} className="chart-swatch chart-swatch--satin" /> {near.notStarted.toLocaleString("en-GB")} not started</li>
            <li><SatinSquare colour={BUILDING} size={12} className="chart-swatch chart-swatch--satin" /> {near.underConstruction.toLocaleString("en-GB")} being built</li>
          </ul>
        </>
      )}
      {value.per1000 !== null && (
        <p className="metric-description" data-testid="pipeline-rate">
          In this area: <strong>{value.per1000.toLocaleString("en-GB")}</strong> per 1,000 homes
          {value.regionPercentile !== null && <> · higher than {regionShare(value.regionPercentile)}% of London</>}
        </p>
      )}
      <p className="metric-description">Built in 5 years: {value.completed5y.toLocaleString("en-GB")}</p>
      {value.growthAreas.map((area) => (
        <p key={`${area.kind}:${area.name}`} className="metric-description" data-testid="pipeline-growth-area">
          {area.presence === "inside" ? "Inside" : "Partly in"} the{" "}
          <a href={area.url} target="_blank" rel="noreferrer">{area.name} {KIND_WORDS[area.kind]}</a>
        </p>
      ))}
    </div>
  );
}

/** For the section's sources menu: every release behind the block, then the caveats. */
export function PipelineSourceItems({ pipeline }: { pipeline: AreaPipelineResponse | null | "unknown" }) {
  if (!pipeline || pipeline === "unknown" || !pipeline.value) return null;
  return (
    <>
      {pipeline.sources.map((source) => <li key={source.release}>{source.attribution}</li>)}
      {pipeline.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
    </>
  );
}

/** The area's pipeline payload: null while loading, "unknown" when it is not served. */
export function useAreaPipeline(geographyId: GeographyId): AreaPipelineResponse | null | "unknown" {
  const payload = useSectionJson(pipelinePath(geographyId));
  return useMemo(() => payload === undefined ? null : readAreaPipeline(payload) ?? "unknown", [payload]);
}

export function DevelopmentPipeline({ geographyId }: { geographyId: GeographyId }) {
  return <DevelopmentPipelineBlock pipeline={useAreaPipeline(geographyId)} />;
}

/** Mounted inside the section's sources list (one fetch: section-fetch caches by URL). */
export function PipelineSources({ geographyId }: { geographyId: GeographyId }) {
  return <PipelineSourceItems pipeline={useAreaPipeline(geographyId)} />;
}
