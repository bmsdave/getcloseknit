"use client";

import { useEffect, useRef, type ReactNode } from "react";

import {
  COLLISION_ATTRIBUTION, COLLISION_HEAT_RAMP, COLLISION_POINT_ZOOM, COLLISION_YEARS, ROAD_USERS, SEVERITIES, collisionIconMarkup,
  streetOnlyFilters, toggleIn, type CollisionLight, type CollisionView,
} from "@/lib/map-collisions";
import { showMapToast } from "@/lib/map-toast";

const LIGHT: { id: CollisionLight; label: string }[] = [
  { id: "any", label: "Any light" }, { id: "dark", label: "Dark" }, { id: "day", label: "Daylight" },
];

/** A burst as on the map (variant C), for the key. Our own markup, never user text. */
function Burst({ severity }: { severity: 1 | 2 | 3 }) {
  const size = SEVERITIES[severity - 1].px;
  return <svg className="collision-key__burst" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: collisionIconMarkup(severity, "walk") }} />;
}

/**
 * The Road collisions overlay's own controls under its "Show on map" checkbox: the heat's key,
 * children only, who was hurt, severity (keyed by the bursts), then year and light, which apply at street
 * zoom where each burst is one person. Each list of tick-boxes has "All · None" (like Crime's types); a
 * list left empty draws nothing and says "Pick at least one". Method, privacy and licence sit behind "How this is drawn".
 */
export function CollisionPanel({ view, zoom, onChange }: { view: CollisionView; zoom: number; onChange: (view: CollisionView) => void }) {
  const street = zoom >= COLLISION_POINT_ZOOM;
  return (
    <section className="places-panel collision-panel" data-testid="collision-panel" aria-label="Road collisions">
      <div className="collision-key" data-testid="collision-heat-key">
        <span className="collision-key__title">Casualties weighted by severity</span>
        <span className="collision-key__ramp" aria-hidden="true"
          style={{ background: `linear-gradient(90deg, ${COLLISION_HEAT_RAMP.slice(1).join(", ")})` }} />
        <span className="collision-key__ends"><span>fewer</span><span>more</span></span>
      </div>
      <label className="collision-panel__children" data-testid="collision-children">
        <input type="checkbox" checked={view.children} onChange={() => onChange({ ...view, children: !view.children })} />
        Children only (0–15)
      </label>
      <FilterGroup id="users" label="Who was hurt" className="places-groups" picked={view.users.length}
        onAll={() => onChange({ ...view, users: ROAD_USERS.map((user) => user.id) })} onNone={() => onChange({ ...view, users: [] })} total={ROAD_USERS.length}>
        {ROAD_USERS.map((user) => (
          <label key={user.id} data-testid={`collision-user-${user.id}`}>
            <input type="checkbox" checked={view.users.includes(user.id)} onChange={() => onChange({ ...view, users: toggleIn(view.users, user.id) })} />
            {user.label}
          </label>
        ))}
      </FilterGroup>
      <FilterGroup id="severity" label="How badly" className="places-groups collision-panel__severity" picked={view.severities.length}
        onAll={() => onChange({ ...view, severities: SEVERITIES.map((severity) => severity.id) })} onNone={() => onChange({ ...view, severities: [] })} total={SEVERITIES.length}>
        {SEVERITIES.map((severity) => (
          <label key={severity.id} data-testid={`collision-severity-${severity.id}`}>
            <input type="checkbox" checked={view.severities.includes(severity.id)}
              onChange={() => onChange({ ...view, severities: toggleIn(view.severities, severity.id) })} />
            <Burst severity={severity.id} />
            {severity.label}
          </label>
        ))}
      </FilterGroup>
      <FilterGroup id="year" label="Year" className="collision-panel__row" picked={view.years.length}
        onAll={() => onChange({ ...view, years: [...COLLISION_YEARS] })} onNone={() => onChange({ ...view, years: [] })} total={COLLISION_YEARS.length}>
        {COLLISION_YEARS.map((year) => (
          <label key={year} data-testid={`collision-year-${year}`}>
            <input type="checkbox" checked={view.years.includes(year)} onChange={() => onChange({ ...view, years: toggleIn(view.years, year) })} />
            {year}
          </label>
        ))}
      </FilterGroup>
      <div className="collision-panel__row" role="radiogroup" aria-label="Light">
        {LIGHT.map((light) => (
          <label key={light.id}>
            <input type="radio" name="collision-light" checked={view.light === light.id} onChange={() => onChange({ ...view, light: light.id })} />
            {light.label}
          </label>
        ))}
      </div>
      {!street && streetOnlyFilters(view) && (
        <p className="places-hint" data-testid="collision-street-hint">Year and light apply when you zoom in to streets.</p>
      )}
      <details className="places-about">
        <summary>How this is drawn</summary>
        <p className="places-hint">
          Everyone hurt in a road collision in London over the last five years. Zoomed out, a heat map of casualties
          weighted by how badly: fatal 10, serious 3, slight 1. Zoomed in to streets, one burst per person, its colour and
          size by how badly, with who was hurt drawn on it. Points show the collision&apos;s place, the year and an age band
          only: never the date, time or sex.
        </p>
        <p className="licence-note">{COLLISION_ATTRIBUTION}.</p>
      </details>
    </section>
  );
}

/**
 * One list of tick-boxes under its name with "All · None"; emptied, the map toast says "Pick at least one."
 * Road collisions and Schools share it; `prefix` names their test ids.
 */
export function FilterGroup({ id, label, className, picked, total, onAll, onNone, children, prefix = "collision" }: {
  id: string; label: string; className: string; picked: number; total: number;
  onAll: () => void; onNone: () => void; children: ReactNode; prefix?: string;
}) {
  const before = useRef(picked);
  useEffect(() => {
    if (picked === 0 && before.current > 0) showMapToast("Pick at least one.", { ms: 4000, kind: "pick-one" });
    before.current = picked;
  }, [picked]);
  return (
    <div className="collision-group" data-testid={`${prefix}-group-${id}`}>
      <div className="collision-group__head">
        <span className="collision-group__label">{label}</span>
        <button type="button" className="collision-group__action" data-testid={`${prefix}-${id}-all`} disabled={picked === total}
          aria-label={`${label}: all`} onClick={onAll}>All</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="collision-group__action" data-testid={`${prefix}-${id}-none`} disabled={picked === 0}
          aria-label={`${label}: none`} onClick={onNone}>None</button>
      </div>
      <div className={className} role="group" aria-label={label} data-empty={picked === 0 || undefined}>{children}</div>
    </div>
  );
}
