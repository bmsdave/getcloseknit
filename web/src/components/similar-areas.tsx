"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SatinMeter } from "@/components/ramp-knit";
import type { GeographyId, MatchZone, SimilarArea, SimilarAreasResponse } from "@/lib/contracts";
import { formatFactorLabel } from "@/lib/evidence-format";
import { fetchSectionJson } from "@/lib/section-fetch";
import { similarAreasPath } from "@/lib/similar-areas";

import { ChartFrame } from "./charts";
import { HelpTip } from "./help-tip";

type Load = SimilarAreasResponse | "loading" | "unavailable" | null;

/**
 * "Areas with similar figures": neighbourhoods whose crime, deprivation, income,
 * price-level and station-access percentiles sit closest to this one's,
 * optionally only cheaper ones or only those outside the user's zones.
 * Browsable content, not an action: the one way to search from an area is the
 * "Like this" link (findLikeHref). Results read as bars of
 * similarity (0-100); each row opens that area (a link with hrefFor, else a
 * button calling onSelect).
 */
export function SimilarAreasSection({ geographyId, zones, hrefFor, onSelect }: {
  geographyId: GeographyId;
  zones: MatchZone[] | undefined;
  hrefFor?: (id: GeographyId) => string;
  onSelect?: (id: GeographyId) => void;
}) {
  const [cheaper, setCheaper] = useState(false);
  const [outside, setOutside] = useState(false);
  const [result, setResult] = useState<Load>(null);
  const hasZones = Boolean(zones?.length);
  useEffect(() => {
    if (!geographyId.startsWith("uk:lsoa:")) return;
    let current = true;
    setResult("loading");
    const path = similarAreasPath(geographyId, { cheaper, outsideZones: outside && zones?.length ? zones : null });
    void fetchSectionJson<SimilarAreasResponse>(path).then((payload) => {
      if (current) setResult(payload?.schemaVersion === "similar-areas.v1" ? payload : "unavailable");
    });
    return () => { current = false; };
  }, [cheaper, outside, geographyId, zones]);

  if (!geographyId.startsWith("uk:lsoa:")) return null;
  return (
    <section className="overview-card similar-areas" data-testid="similar-areas" aria-label="Areas with similar figures">
      <div className="overview-card__head">
        <h2>Areas with similar figures</h2>
        <HelpTip id="similar-areas" label="areas with similar figures" />
      </div>
      <div className="similar-areas__filters">
        <label><input type="checkbox" checked={cheaper} onChange={(event) => setCheaper(event.target.checked)} /> Cheaper only</label>
        {hasZones && (
          <label><input type="checkbox" checked={outside} onChange={(event) => setOutside(event.target.checked)} /> Outside my zones</label>
        )}
      </div>
      <SimilarList result={result} hrefFor={hrefFor} onSelect={onSelect} />
    </section>
  );
}

function SimilarList({ result, hrefFor, onSelect }: {
  result: Load; hrefFor?: (id: GeographyId) => string; onSelect?: (id: GeographyId) => void;
}) {
  if (result === "loading" || result === null) return <p role="status">Finding similar areas…</p>;
  if (result === "unavailable") return <p role="status">Similar areas are unavailable right now.</p>;
  if (result.values.length === 0) return <p role="status" data-testid="similar-areas-empty">No area is close enough on this evidence.</p>;
  return (
    <ChartFrame
      title="How similar"
      sources={(
        <>
          <p>Compared on {result.factors.map((factor) => formatFactorLabel(factor).toLowerCase()).join(", ")}.</p>
          {result.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
        </>
      )}
    >
      <ul className="chart chart-bars chart-bars__list similar-areas__rows" aria-label="Similarity out of 100">
        {result.values.map((area) => (
          <li key={area.geographyId} className="similar-areas__item" data-testid="similar-area">
            <SimilarRow area={area} hrefFor={hrefFor} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}

/**
 * One bar row, and the row itself is the way into that area: a link on the full
 * page, a button where a click selects it in place. Named the way the rest of
 * the site names areas ("Pitshanger · W5"), the official name small beneath.
 */
function SimilarRow({ area, hrefFor, onSelect }: {
  area: SimilarArea; hrefFor?: (id: GeographyId) => string; onSelect?: (id: GeographyId) => void;
}) {
  const title = area.title?.trim() || area.name;
  const body = (
    <>
      <span className="chart-bars__label similar-areas__label">
        <span className="similar-areas__name">{title}</span>
        {title !== area.name && <span className="similar-areas__code">{area.name}</span>}
      </span>
      <span className="chart-bars__track">
        <SatinMeter value={Math.max(0, area.similarity) / 100} colour="var(--chart-1)" width={160} height={12} className="chart-bars__satin" />
      </span>
      <span className="chart-bars__value">{Math.round(area.similarity)}/100</span>
    </>
  );
  const className = "chart-bars__row similar-areas__row";
  if (hrefFor) return <Link className={className} href={hrefFor(area.geographyId)}>{body}</Link>;
  if (onSelect) return <button type="button" className={className} onClick={() => onSelect(area.geographyId)}>{body}</button>;
  return <span className={className}>{body}</span>;
}
