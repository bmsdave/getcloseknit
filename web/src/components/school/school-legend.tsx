"use client";

/**
 * Show › Schools: the Schools filter (Schools filter v2, board "School filter · 5 UI options", options 2 + 4).
 * The live count and Reset, the filter read back in words, then grouped toggles: Phase and Ofsted (each swatch
 * drawn as the real marker, with counts and "All · None"), Results (one measure that colours the markers, with its
 * colour key and one threshold slider), Type, Intake and Faith (the chips the /schools hub shows too), Sixth forms
 * by A-level results; then the awards key. "Use in My match" adds the same filter as a place. The filter travels in
 * the address (?schools=…, lib/school-filter.ts).
 */
import { useEffect, useMemo, useState } from "react";

import { FilterGroup } from "@/components/collision-panel";
import { SchoolChipRows } from "@/components/schools/school-filter-chips";
import { toggleIn } from "@/lib/map-collisions";
import {
  OFSTED_FILTERS, SCHOOL_MIN_ZOOM, SCHOOL_TYPES, loadSchoolPoints, schoolCounts,
  type SchoolPoint, type SchoolType,
} from "@/lib/map-school-layer";
import { schoolPointsPath } from "@/lib/release-url";
import {
  DEFAULT_SCHOOL_FILTER, SCHOOL_MEASURES, describeSchoolFilter, isDefaultSchoolFilter, schoolMeasure, schoolShown, thresholdLabel,
  type SchoolFilter, type SchoolMeasure, type SchoolMeasureId,
} from "@/lib/school-filter";
import {
  MEASURE_COLOUR, MEASURE_NONE_COLOUR, RANK_TIERS, SCHOOL_ICON_UNITS, TIER_NAME, schoolIconLabel, schoolIconMarkup,
  type RankTier, type SchoolIcon,
} from "@/lib/school-icons";

import { OfstedIcon } from "./ofsted-icon";

/** A marker as on the map. Our own markup (lib/school-icons.ts), never user text. */
export function SchoolCap({ icon, className = "school-key__cap" }: { icon: SchoolIcon; className?: string }) {
  return <svg className={className} viewBox={`0 0 ${SCHOOL_ICON_UNITS} ${SCHOOL_ICON_UNITS}`} aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: schoolIconMarkup(icon) }} />;
}

const TYPE_ICON: Record<SchoolType, SchoolIcon> = {
  primary: { kind: "state", stage: "primary", ofsted: null, tier: null },
  secondary: { kind: "state", stage: "secondary", ofsted: null, tier: null },
  "all-through": { kind: "state", stage: "all-through", ofsted: null, tier: null },
  private: { kind: "independent", stage: "secondary", ofsted: null, tier: null },
};

const count = (value: number | undefined) => (value === undefined ? "" : value.toLocaleString("en-GB"));

/** The points, from the same one load as the map (null until it lands). */
function useSchoolPoints(release: string | null | undefined): SchoolPoint[] | null {
  const [points, setPoints] = useState<SchoolPoint[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadSchoolPoints(schoolPointsPath(release)).then((loaded) => { if (live && loaded) setPoints(loaded); });
    return () => { live = false; };
  }, [release]);
  return points;
}

/** The chosen measure's colour key: four steps light to dark, then "no data" (faded on the map). */
export function SchoolMeasureKey({ measure }: { measure: SchoolMeasure }) {
  return (
    <ul className="school-measure-key" aria-label={`${measure.label} colours`} data-testid="school-measure-key">
      {measure.legend.map((words, step) => (
        <li key={words}><span className="school-measure-key__swatch" style={{ background: MEASURE_COLOUR[step] }} aria-hidden="true" />{words}</li>
      ))}
      <li><span className="school-measure-key__swatch" data-none="" style={{ background: MEASURE_NONE_COLOUR }} aria-hidden="true" />no data</li>
    </ul>
  );
}

/** The map's colour key while a measure colours the school markers (bottom-left, as the Recent sales key). */
export function SchoolMeasureLegend({ filter }: { filter: SchoolFilter }) {
  if (!filter.measure) return null;
  const measure = schoolMeasure(filter.measure.id);
  return (
    <div className="school-measure-legend" data-testid="school-measure-legend">
      <p className="school-measure-legend__title">Schools · {measure.label} · {measure.source}, latest year</p>
      <SchoolMeasureKey measure={measure} />
    </div>
  );
}

const round = (value: number) => Math.round(value * 100) / 100;

function ResultsGroup({ filter, change }: { filter: SchoolFilter; change: (filter: SchoolFilter) => void }) {
  const measure = filter.measure ? schoolMeasure(filter.measure.id) : null;
  const threshold = filter.measure?.threshold ?? null;
  const pick = (id: string) => change({ ...filter, measure: id ? { id: id as SchoolMeasureId, threshold: null } : null });
  return (
    <fieldset className="school-filter__group school-filter__measure" data-testid="school-results">
      <legend>Results · colour markers by</legend>
      <select className="knit-field" data-testid="school-measure" aria-label="Colour markers by" value={filter.measure?.id ?? ""}
        onChange={(event) => pick(event.target.value)}>
        <option value="">Ofsted</option>
        {SCHOOL_MEASURES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      {measure && (
        <>
          <SchoolMeasureKey measure={measure} />
          <label className="collision-panel__children" data-testid="school-threshold-on">
            <input type="checkbox" checked={threshold !== null}
              onChange={() => change({ ...filter, measure: { id: measure.id, threshold: threshold === null ? measure.initial : null } })} />
            {threshold === null ? `Only ${measure.atMost ? "up to" : "from"} a value` : `Only ${thresholdLabel(measure, threshold)}`}
          </label>
          {threshold !== null && (
            <label className="school-filter__threshold">
              <span className="sr-only">{measure.label} threshold</span>
              <input type="range" data-testid="school-threshold" min={measure.min} max={measure.max} step={measure.step} value={threshold}
                aria-valuetext={thresholdLabel(measure, threshold)}
                onChange={(event) => change({ ...filter, measure: { id: measure.id, threshold: round(Number(event.target.value)) } })} />
            </label>
          )}
          <small className="places-hint">Latest published year per school; cohorts under 30 and hidden figures show as no data.</small>
        </>
      )}
    </fieldset>
  );
}

export function SchoolPanel({ filter = DEFAULT_SCHOOL_FILTER, zoom, release, onChange, onUseInMatch }: {
  filter?: SchoolFilter; zoom: number; release?: string | null; onChange?: (filter: SchoolFilter) => void;
  /** Adds this filter to My match as "near a school like this". */
  onUseInMatch?: (filter: SchoolFilter) => void;
}) {
  const points = useSchoolPoints(release);
  const counts = useMemo(() => (points ? schoolCounts(points) : null), [points]);
  const shown = useMemo(() => (points ? points.filter((point) => schoolShown(point, filter)).length : null), [points, filter]);
  const change = onChange ?? (() => undefined);
  const plain = isDefaultSchoolFilter(filter);
  return (
    <section className="places-panel school-key school-filter" data-testid="school-legend" aria-label="Schools filter">
      <div className="school-filter__head">
        <span className="school-filter__count" data-testid="school-filter-count" aria-live="polite">
          {shown === null ? "Schools" : `${shown.toLocaleString("en-GB")} ${shown === 1 ? "school" : "schools"}`}
        </span>
        <button type="button" className="chip-button" data-testid="school-filter-reset" disabled={plain}
          onClick={() => change(DEFAULT_SCHOOL_FILTER)}>Reset</button>
      </div>
      {!plain && <p className="school-filter__summary" data-testid="school-filter-summary">{describeSchoolFilter(filter)}</p>}
      <FilterGroup prefix="school" id="type" label="Phase" className="school-key__list" picked={filter.phases.length} total={SCHOOL_TYPES.length}
        onAll={() => change({ ...filter, phases: SCHOOL_TYPES.map((type) => type.id) })} onNone={() => change({ ...filter, phases: [] })}>
        {SCHOOL_TYPES.map((type) => (
          <label key={type.id} data-testid={`school-type-${type.id}`} title={schoolIconLabel(TYPE_ICON[type.id])}>
            <input type="checkbox" checked={filter.phases.includes(type.id)} onChange={() => change({ ...filter, phases: toggleIn(filter.phases, type.id) })} />
            <SchoolCap icon={TYPE_ICON[type.id]} />
            <span className="school-key__name">{type.label}</span>
            <span className="school-key__count">{count(counts?.types[type.id])}</span>
          </label>
        ))}
      </FilterGroup>
      <FilterGroup prefix="school" id="ofsted" label="Ofsted" className="school-key__list" picked={filter.ofsted.length} total={OFSTED_FILTERS.length}
        onAll={() => change({ ...filter, ofsted: OFSTED_FILTERS.map((grade) => grade.id) })} onNone={() => change({ ...filter, ofsted: [] })}>
        {OFSTED_FILTERS.map((grade) => (
          <label key={grade.id} data-testid={`school-ofsted-${grade.id}`}>
            <input type="checkbox" checked={filter.ofsted.includes(grade.id)} onChange={() => change({ ...filter, ofsted: toggleIn(filter.ofsted, grade.id) })} />
            <OfstedIcon mark={grade.mark} label={null} size={22} className="school-key__top" />
            <span className="school-key__name">{grade.label}</span>
            <span className="school-key__count">{count(counts?.ofsted[grade.id])}</span>
          </label>
        ))}
      </FilterGroup>
      <ResultsGroup filter={filter} change={change} />
      <SchoolChipRows filter={filter} rows={["type", "intake", "faith"]} onChange={change} testPrefix="school-filter" />
      <label className="collision-panel__children" data-testid="school-alevel">
        <input type="checkbox" checked={filter.aLevelOnly} onChange={() => change({ ...filter, aLevelOnly: !filter.aLevelOnly })} />
        Sixth forms by A-level results
        <span className="school-key__count">{count(counts?.sixthForms)}</span>
      </label>
      <ul className="school-key__row school-key__awards" aria-label="England rank" data-testid="school-awards">
        {[...RANK_TIERS].map((tier: RankTier) => (
          <li key={tier} title={`${TIER_NAME[tier]}: top ${tier}% in England${counts ? `, ${count(counts.tiers[tier])} schools` : ""}`}>
            <SchoolCap icon={{ kind: "state", stage: "primary", ofsted: null, tier }} />
            <span>{tier}%{counts ? <span className="school-key__count"> {count(counts.tiers[tier])}</span> : null}</span>
          </li>
        ))}
      </ul>
      <p className="places-hint">
        {zoom < SCHOOL_MIN_ZOOM ? "Zoom in to see schools." : "P primary · S secondary · PS all-through · +N: tap to zoom in."}
      </p>
      {onUseInMatch && (
        <button type="button" className="chip-button school-filter__match" data-testid="school-filter-match" onClick={() => onUseInMatch(filter)}>
          Use in My match
        </button>
      )}
    </section>
  );
}
