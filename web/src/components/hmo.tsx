"use client";

import { useMemo } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { SatinBar } from "@/components/knit/satin";
import { type AreaHmoResponse, hmoPath, readAreaHmo, shortDate } from "@/lib/area-hmo";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { HelpTip } from "./help-tip";
import { useSectionJson } from "./section-seed";
import { regionShare } from "@/lib/evidence-format";
import { SourceNote } from "@/components/source-note";

const SCHEME_LABEL = { additional: "Additional HMO licensing", selective: "Selective licensing" } as const;

/** The area's HMO payload: null while loading, "unknown" when not served (demo mode never fetches it). */
export function useAreaHmo(geographyId: GeographyId, mode: DataMode): AreaHmoResponse | null | "unknown" {
  const payload = useSectionJson(mode === "real" ? hmoPath(geographyId) : null);
  return useMemo(() => mode !== "real" ? "unknown" : payload === undefined ? null : readAreaHmo(payload) ?? "unknown", [mode, payload]);
}

/** Licensed HMOs per 1,000 homes, the area beside London, then the licensing schemes in force. */
export function HmoBlock({ hmo }: { hmo: AreaHmoResponse | null | "unknown" }) {
  if (hmo === null) return <p className="area-hmo__status">Loading HMOs…</p>;
  if (hmo === "unknown" || !hmo.value.available || !hmo.value.register) return null;
  const { register, per1000Homes, regionPer1000, licensedHmos, regionPercentile, schemes } = hmo.value;
  const published = register.status === "published" && per1000Homes != null;
  const full = Math.max(per1000Homes ?? 0, regionPer1000 ?? 0) * 1.25 || 1;
  return (
    <section className="area-hmo" data-testid="hmo" aria-label="HMOs and licensing">
      <h3><KnitIcon name="home" /> HMOs <HelpTip id="hmo-per-1000" label="HMO figures" /></h3>
      {published ? (
        <>
          <dl className="area-hmo__bars">
            <div>
              <dt>This area</dt>
              <dd><SatinBar value={per1000Homes / full} colour="var(--chart-1)" width={140} height={12} /></dd>
              <dd className="area-hmo__value">{per1000Homes}</dd>
            </div>
            {regionPer1000 != null && (
              <div>
                <dt>London</dt>
                <dd><SatinBar value={regionPer1000 / full} colour="var(--chart-neutral)" width={140} height={12} /></dd>
                <dd className="area-hmo__value">{regionPer1000}</dd>
              </div>
            )}
          </dl>
          <p className="area-hmo__line">
            {licensedHmos?.toLocaleString("en-GB")} licensed {licensedHmos === 1 ? "HMO" : "HMOs"} · per 1,000 homes
            {regionPercentile != null && <> · More than {regionShare(regionPercentile)}% of London</>}
          </p>
        </>
      ) : (
        <p className="area-hmo__line" data-testid="hmo-not-published">
          {register.page || register.url
            ? <a href={register.page ?? register.url ?? undefined} target="_blank" rel="noopener noreferrer">HMO register</a>
            : "HMO register"}: not published
        </p>
      )}
      {schemes.length > 0 && (
        <ul className="area-hmo__schemes">
          {schemes.map((scheme) => (
            <li key={`${scheme.kind}-${scheme.url}`}>
              <a href={scheme.url} target="_blank" rel="noopener noreferrer">{SCHEME_LABEL[scheme.kind]}</a>
              {scheme.coverage === "part" && " in part of the area"}
              {scheme.coverage === "streets" && ` on ${scheme.streets} named streets`}
              {scheme.until && ` until ${shortDate(scheme.until)}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** For the section's ⓘ: the registers' attribution, then the caveats. */
export function HmoSources({ hmo }: { hmo: AreaHmoResponse | null | "unknown" }) {
  if (!hmo || hmo === "unknown" || !hmo.value.available) return null;
  return (
    <>
      {hmo.sources.map((source) => <p key={source.sourceId}>{source.attribution ?? source.sourceName}</p>)}
      {hmo.caveats.map((caveat) => <SourceNote key={caveat} text={caveat} />)}
    </>
  );
}
