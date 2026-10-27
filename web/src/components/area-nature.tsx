"use client";

import { useMemo } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { SatinBar } from "@/components/knit/satin";
import type { GeographyId } from "@/lib/contracts";
import { naturePath } from "@/lib/section-seed";
import { useSectionJson } from "./section-seed";

export interface AreaNature {
  available: boolean;
  green: { share: number | null; percentile: number | null } | null;
  trees: { count: number; perHectare: number; percentile: number | null; top: { name: string; count: number }[] } | null;
  site: { name: string; kind: "lnr" | "sssi"; metres: number | null; percentile: number | null } | null;
  score: { percentile: number | null } | null;
  home: { uprn: string; greenShare: number | null; streetTrees: number | null } | null;
  wildlife: {
    radiusMetres: number; firstYear: number; lastYear: number; records: number; enough: boolean;
    birds: number; mammals: number; amphibians: number; notable: string[];
  } | null;
  sources: { id: string; licence: string; attribution: string; caveats: string[] }[];
}

// Street trees per hectare that fill the bar: a leafy London street runs at 20+.
const TREES_FULL = 25;
const SITE_KIND = { lnr: "nature reserve", sssi: "SSSI" } as const;

const percent = (share: number) => `${Math.round(share * 100)}%`;
const distance = (metres: number) => metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${Number((metres / 1000).toFixed(1))} km`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The area's nature evidence (real releases only), null while loading. */
export function useAreaNature(geographyId: GeographyId, uprn: string | null): AreaNature | null | "unavailable" {
  const payload = useSectionJson<AreaNature>(naturePath(geographyId, uprn));
  return useMemo(() => payload === undefined ? null : payload?.available ? payload : "unavailable", [payload]);
}

/** The Nature rating's one fact: how green the land is. */
export function natureFact(nature: AreaNature | null | "unavailable"): string | undefined {
  const share = nature && nature !== "unavailable" ? nature.green?.share ?? null : null;
  return share === null ? undefined : `${percent(share)} of the land is green`;
}

/**
 * Green land and street trees as satin bars, the nearest nature reserve, the chosen home's
 * surroundings, and wildlife recorded nearby: what was seen, never what is missing.
 */
export function AreaNatureBlock({ nature }: { nature: AreaNature | null | "unavailable" }) {
  if (nature === null) return <p className="area-nature__status">Loading nature…</p>;
  if (nature === "unavailable") return null;
  const { green, trees, site, home, wildlife } = nature;
  return (
    <section className="area-nature" data-testid="area-nature" aria-label="Nature">
      <h3><KnitIcon name="tree" /> Nature</h3>
      <dl className="area-nature__bars">
        {green?.share != null && (
          <div>
            <dt>Green land</dt>
            <dd><SatinBar value={green.share} colour="var(--chart-1)" width={140} height={12} /></dd>
            <dd className="area-nature__value">{percent(green.share)}</dd>
          </div>
        )}
        {trees && (
          <div>
            <dt>Street trees</dt>
            <dd><SatinBar value={trees.perHectare / TREES_FULL} colour="var(--chart-1)" width={140} height={12} /></dd>
            <dd className="area-nature__value">{trees.perHectare.toFixed(1)} / ha</dd>
          </div>
        )}
      </dl>
      {trees && trees.top.length > 0 && (
        <p className="area-nature__line" data-testid="nature-trees">
          {trees.count.toLocaleString("en-GB")} street trees, mostly {trees.top.slice(0, 3).map((tree) => tree.name).join(", ")}
        </p>
      )}
      {site && site.metres !== null && (
        <p className="area-nature__line" data-testid="nature-site">
          Nearest {SITE_KIND[site.kind]}: <strong>{site.name}</strong> · {distance(site.metres)}
        </p>
      )}
      {home && (home.greenShare !== null || home.streetTrees !== null) && (
        <p className="et-home-line" data-testid="nature-home">
          This home, within ~100 m:{" "}
          {home.greenShare !== null && <strong>{percent(home.greenShare)} green</strong>}
          {home.greenShare !== null && home.streetTrees !== null && " · "}
          {home.streetTrees !== null && <strong>{plural(home.streetTrees, "street tree")}</strong>}
        </p>
      )}
      {wildlife && (
        <div className="area-nature__wildlife" data-testid="nature-wildlife">
          <p className="area-nature__line">
            Seen within {distance(wildlife.radiusMetres)}, {wildlife.firstYear}–{wildlife.lastYear}:{" "}
            <strong>{plural(wildlife.birds, "bird species", "bird species")}</strong>
            {wildlife.mammals > 0 && <> · {plural(wildlife.mammals, "mammal")}</>}
            {wildlife.amphibians > 0 && <> · {plural(wildlife.amphibians, "amphibian")}</>}
          </p>
          {wildlife.notable.length > 0 && (
            <ul className="area-nature__tags" aria-label="Notable wildlife seen">
              {wildlife.notable.map((name) => <li key={name}>{name}</li>)}
            </ul>
          )}
          {!wildlife.enough && (
            <p className="area-nature__status" data-testid="nature-few-records">
              Few records here: what&apos;s listed is a minimum, not everything that lives here.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Method, caveats and attributions, word for word from each source release. */
export function NatureNotes({ nature, scope = "London" }: { nature: AreaNature | null | "unavailable"; scope?: string }) {
  if (!nature || nature === "unavailable") return null;
  return (
    <>
      <p>Nature: the score combines green land, street trees per hectare and the distance to the nearest nature reserve or SSSI, each ranked among {scope} neighbourhoods.</p>
      <p>Wildlife: species people recorded within 1 km (birds, mammals, amphibians). Records follow where people look, so a short list can mean few observers, not few animals.</p>
      {nature.sources.map((source) => (
        <div key={source.id}>
          {source.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
          <p>{source.attribution}</p>
        </div>
      ))}
    </>
  );
}
