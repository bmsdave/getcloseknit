"use client";

import {
  type BriefArea, type BriefLayer, BRIEF_LAYER_LABEL, BRIEF_LAYERS, type BriefDestination, type BriefRingArea, type BriefSchool, type BudgetFit,
  ballparkLabel, distanceKm, filterSchools, SCHOOL_TIER_LABEL, type SchoolFilter,
} from "@/lib/brief-model";
import { areaDisplayName } from "@/lib/area-labels";
import { KnitIcon } from "@/components/knit/knit-icon";

const FIT_LABEL: Record<BudgetFit, string> = { within: "within budget", stretch: "a stretch", over: "over budget", unknown: "price unknown" };

/** The ballpark and how it sits with the budget; with the search's bedrooms it says the home ("typical 2-bed ~£497k"). */
export function FitChip({ fit, price, monthly = false, bedrooms = null }: {
  fit: BudgetFit; price: number | null; monthly?: boolean; bedrooms?: number | null;
}) {
  return (
    <span className={`brief-fit brief-fit-${fit}`}>
      {price !== null ? `${ballparkLabel(price, { bedrooms, monthly })} · ` : ""}{FIT_LABEL[fit]}
    </span>
  );
}

export function RingTable({ area, ring }: { area: BriefArea; ring: BriefRingArea[] }) {
  if (ring.length === 0) return <p className="brief-empty">No touching neighbourhoods were found for this area.</p>;
  const rows = [{ ...area, self: true }, ...ring.map((entry) => ({ ...entry, self: false }))]
    .sort((a, b) => (a.pricePerSquareMetre ?? Infinity) - (b.pricePerSquareMetre ?? Infinity));
  return (
    <table className="brief-table" data-testid="ring-table">
      <thead><tr><th>Neighbourhood</th><th>£/m²</th><th>Ballpark</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.geographyId} className={row.self ? "brief-row-self" : undefined}>
            <td>{areaDisplayName(row) ?? row.name}{row.self ? " (recommended)" : ""}<small>{row.outcodes.slice(0, 2).join(", ")}</small></td>
            <td>{row.pricePerSquareMetre !== null ? `£${row.pricePerSquareMetre.toLocaleString("en-GB")}` : "—"}</td>
            <td><FitChip fit={row.budgetFit} price={row.estimatedPrice} monthly={Boolean(row.estimatedRent)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SchoolsList({ schools, areaId, filter, onFilter }: {
  schools: BriefSchool[]; areaId: string; filter: SchoolFilter; onFilter: (filter: SchoolFilter) => void;
}) {
  const setFilter = onFilter;
  const shown = filterSchools(schools, filter, areaId);
  const phases: SchoolFilter["phase"][] = ["all", "primary", "secondary"];
  return (
    <div data-testid="schools-list">
      <div className="brief-filters" role="group" aria-label="Filter schools">
        {phases.map((phase) => (
          <button key={phase} type="button" aria-pressed={filter.phase === phase} onClick={() => setFilter({ ...filter, phase })}>
            {phase === "all" ? "All" : phase === "primary" ? "Primary" : "Secondary"}
          </button>
        ))}
        <button type="button" aria-pressed={filter.topOnly} onClick={() => setFilter({ ...filter, topOnly: !filter.topOnly })}>
          Outstanding only
        </button>
      </div>
      {shown.length === 0 ? <p className="brief-empty">No schools match these filters within 1.5 km.</p> : (
        <ul className="brief-schools">
          {shown.map((school) => (
            <li key={school.urn}>
              <span className={`brief-star brief-star-${school.grade.tier}`} aria-hidden="true"><KnitIcon name="star" colour="currentColor" className="knit-glyph" style={{ width: 16, height: 16 }} /></span>
              <span>
                <strong>{school.name}</strong>
                <small>
                  {school.phase} · {school.distanceMetres !== null ? `${school.distanceMetres.toLocaleString("en-GB")} m` : "distance unknown"}
                  {" · "}{SCHOOL_TIER_LABEL[school.grade.tier]}{school.grade.year ? ` (${school.grade.year})` : ""}
                  {school.attainment8 !== null ? ` · Attainment 8: ${school.attainment8}` : ""}
                  {school.progress8 ? ` · Progress 8: ${formatProgress8(school.progress8.value)}${school.progress8.year ? ` (${school.progress8.year})` : ""}` : ""}
                  {school.selectivity === "Selective" ? " · selective" : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Progress 8 with its sign: 0 is the national average, +0.5 half a grade better per subject. */
export function formatProgress8(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function SchoolSummary({ schools, areaId }: { schools: BriefSchool[]; areaId: string }) {
  const near = schools.filter((school) => school.nearAreas.includes(areaId));
  const count = (tier: string) => near.filter((school) => school.grade.tier === tier).length;
  return (
    <div className="brief-stats">
      <div><b>{near.length}</b><span>state schools within 1.5 km</span></div>
      <div><b className="brief-star-outstanding">{count("outstanding")}</b><span>outstanding</span></div>
      <div><b className="brief-star-good">{count("good")}</b><span>good</span></div>
      <div><b>{count("requires-improvement") + count("inadequate")}</b><span>below good</span></div>
    </div>
  );
}

export function CommuteCards({ area, destinations }: { area: BriefArea; destinations: BriefDestination[] }) {
  return (
    <div className="brief-commute" data-testid="commute-cards">
      {area.station ? (
        <div className="brief-card">
          <strong>Nearest station: {area.station.name}</strong>
          <small>{area.station.walkMinutes} min walk · {area.station.modes.join(", ")}</small>
        </div>
      ) : <p className="brief-empty">No station within a 20-minute walk.</p>}
      {destinations.map((destination) => (
        <div className="brief-card" key={destination.label}>
          <strong>{destination.label}</strong>
          <small>{area.center ? `${distanceKm(area.center, destination).toFixed(1)} km as the crow flies` : ""}</small>
          <small className="brief-muted">Door-to-door routes (line, changes, bike, car) arrive with our route planner.</small>
        </div>
      ))}
    </div>
  );
}

/** A map-key symbol: the same thread icon the map label carries. */
const keyIcon = (name: string) => <KnitIcon name={name} colour="var(--icon-yarn, currentColor)" className="knit-inline" style={{ width: 13, height: 13 }} />;

export function LayerToggles({ layers, onToggle }: { layers: Record<BriefLayer, boolean>; onToggle: (layer: BriefLayer) => void }) {
  return (
    <div className="brief-layers" role="group" aria-label="Show on the map" data-testid="brief-layers">
      {BRIEF_LAYERS.map((layer) => (
        <button key={layer} type="button" aria-pressed={layers[layer]} onClick={() => onToggle(layer)}>
          {BRIEF_LAYER_LABEL[layer]}
        </button>
      ))}
      <p className="brief-key" data-testid="map-key">
        On the map: <b>1</b> your top matches with a ballpark price · coloured areas are your top 50 (the deeper the blue, the better) ·{" "}
        {keyIcon("bicycle")} {keyIcon("tube")} your places with the route and minutes · {keyIcon("school")} schools (only if you
        asked; otherwise "worth knowing" standouts) · {keyIcon("swap")} nearest station · dashed outline = neighbouring areas.
      </p>
    </div>
  );
}
