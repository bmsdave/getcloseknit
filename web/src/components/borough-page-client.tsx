"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { civicPath, readCivic } from "@/lib/civic";
import { readAreaRents, rentsPath, type RentBedrooms } from "@/lib/area-rents";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { BOROUGH_AREA_SORTS, FIRST_AREAS, sortBoroughAreas, type BoroughAreaRow, type BoroughAreaSort } from "@/lib/borough-areas";
import type { AreaStandouts, TileView } from "@/lib/standouts";

import { LivingCosts } from "./area-full-page";
import { AreaTiles, LondonStrip } from "./area-standouts";
import { useSectionJson } from "./section-seed";

/**
 * The borough page's 12 tiles: a tile whose section the page has leads to it; Health and
 * Local places, which a borough page does not break down, open the map on the borough instead.
 */
export function BoroughTiles({ standouts, sections, mapHref }: {
  standouts: AreaStandouts | null; sections: readonly string[]; mapHref: string;
}) {
  return (
    <AreaTiles standouts={standouts ?? "unknown"}
      href={(tile) => (tile.section && sections.includes(tile.section) ? `#${tile.section}` : mapHref)} />
  );
}

function strip(label: string, position: number | null, neutral = false): TileView {
  return {
    id: label, label, section: null, topic: null, available: position !== null, value: position, display: null,
    standing: neutral ? null : position, regionPercentile: neutral ? position : null,
    extreme: neutral || position === null ? null : position >= 90 ? "pro" : position <= 10 ? "con" : null,
    detail: null, trend: null, period: null,
  };
}

/**
 * The borough's neighbourhoods: sortable by price, crime, schools or name, each with mini
 * London strips and a link to its area page. The sort lives in the address (?sort=), so a shared link
 * opens the same order.
 */
export function BoroughAreas({ rows, initial, scope = "London" }: { rows: readonly BoroughAreaRow[]; initial: BoroughAreaSort; scope?: string }) {
  const [sort, setSort] = useState<BoroughAreaSort>(initial);
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => sortBoroughAreas(rows, sort), [rows, sort]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("sort") === sort || (sort === "price" && !url.searchParams.has("sort"))) return;
    url.searchParams.set("sort", sort);
    window.history.replaceState(window.history.state, "", url);
  }, [sort]);
  const shown = all ? sorted : sorted.slice(0, FIRST_AREAS);
  return (
    <div className="borough-areas" data-testid="borough-areas">
      <div className="borough-areas__sort" role="group" aria-label="Sort areas">
        {BOROUGH_AREA_SORTS.map((entry) => (
          <button key={entry.id} type="button" className="chip-button" aria-pressed={sort === entry.id}
            data-testid={`borough-areas-sort-${entry.id}`} onClick={() => setSort(entry.id)}>{entry.label}</button>
        ))}
      </div>
      {/* Price is neutral (pricier to the right), so the key says so beside Crime and Schools. */}
      <p className="borough-areas__key" data-testid="borough-areas-key">
        Against {scope}: to the right is safer, better schools, pricier. The tick is {scope}&apos;s middle.
      </p>
      <ol className="borough-areas__list" data-testid="borough-areas-list">
        {shown.map((row) => (
          <li key={row.id} className="borough-areas__row" data-testid="borough-area">
            <Link className="borough-areas__name" href={row.href}>
              <strong>{row.name}</strong>
              {row.note && <small>{row.note}</small>}
            </Link>
            <span className="borough-areas__price">{row.priceDisplay}</span>
            <span className="borough-areas__strips">
              {([["Price", row.pricePosition, true], ["Crime", row.safety, false], ["Schools", row.schools, false]] as const).map(([label, position, neutral]) => (
                <span key={label} className="borough-areas__strip" data-strip={label.toLowerCase()}>
                  <span className="borough-areas__strip-label">{label}</span>
                  <LondonStrip tile={strip(label, position, neutral)} scope={scope} />
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      {sorted.length > FIRST_AREAS && (
        <button type="button" className="text-button" aria-expanded={all} data-testid="borough-areas-more" onClick={() => setAll(!all)}>
          {all ? `Show first ${FIRST_AREAS}` : `Show all ${sorted.length} areas`}
        </button>
      )}
    </div>
  );
}

const RENT_SHORT: Partial<Record<RentBedrooms, string>> = { oneBedroom: "1 bed", twoBedrooms: "2 bed", threeBedrooms: "3 bed", fourOrMoreBedrooms: "4+ bed" };

/** Council tax (the area page's Living costs) and the borough's average rents. */
export function BoroughLivingCosts({ geographyId, mode }: { geographyId: GeographyId; mode: DataMode }) {
  const civicPayload = useSectionJson<unknown>(civicPath({ geographyId }));
  const rentsPayload = useSectionJson<unknown>(rentsPath(geographyId));
  const civicState = civicPayload === undefined ? null : readCivic(civicPayload, mode);
  const civic = civicState === null ? null : civicState.status === "available" ? civicState.civic : "unknown";
  const rents = rentsPayload ? readAreaRents(rentsPayload, mode) : null;
  const own = rents?.available ? rents.rents.filter((rent) => rent.bedrooms !== "all") : [];
  return (
    <LivingCosts civic={civic} areaId={geographyId} rows={own.length > 0 ? [{
      term: "Renting, average", testId: "living-rents", valueTestId: "borough-rents",
      value: own.map((rent) => `${RENT_SHORT[rent.bedrooms] ?? rent.bedrooms} £${rent.monthlyRent.toLocaleString("en-GB")}`).join(" · "),
    }] : []} />
  );
}
