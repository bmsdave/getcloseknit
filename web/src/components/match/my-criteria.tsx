"use client";

import { useState, type ReactNode } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import type { PreferenceProfile } from "@/lib/contracts";
import {
  withoutCustom,
  type CustomCriterion,
  type CustomFormula,
} from "@/lib/custom-criteria";
import { buildCriterion, CUSTOM_PRESETS, FEATURED_PRESET_IDS, PLACE_TYPES } from "@/lib/custom-presets";

interface MyCriteriaProps {
  profile: PreferenceProfile;
  onChange: (profile: PreferenceProfile) => void;
  /** The criterion painted on the map, if any. */
  shown: CustomCriterion | null;
  onShow: (criterion: CustomCriterion | null) => void;
}

const FORMULA_WORDS: Record<CustomFormula, string> = {
  nearest: "Walk to the nearest", per_resident: "How many per 1,000 residents", count: "How many", density: "How many per km²",
  variety: "How many kinds", share: "Share of A among A and B", balance: "A vs B (balance, advanced)",
};
// "Is one close" and "how much per resident" first; the balance last, as an advanced option: with few places
// of either kind it keeps an area near 0, so no ready-made criterion uses it.
const BUILDER_FORMULAS = Object.keys(FORMULA_WORDS) as CustomFormula[];
// Criteria count the places inside each area's boundary, so the builder has no radius: the definition keeps
// radiusMetres (share links, saved criteria) at its default and no formula reads it.
const RADIUS_METRES = 800;

/**
 * "My criteria": the household's own criteria from places on the map ("kebab shops vs cafés"). Picking a
 * preset or a home-made criterion paints it on the map, and the panel then reads that criterion
 * (CriterionFocus: key, both ends, add to the match with a direction and a weight). Six everyday
 * presets show first and the rest wait behind "More…". Places, never people: CriterionFocus and the
 * guide say so.
 */
export function MyCriteria({ profile, onChange, shown, onShow }: MyCriteriaProps) {
  const [building, setBuilding] = useState(false);
  const [more, setMore] = useState(false);
  const added = profile.custom ?? [];
  // A preset already on the map stays in view even when it is not a featured one.
  const presets = CUSTOM_PRESETS.filter((preset) => more || FEATURED_PRESET_IDS.includes(preset.criterion.id) || shown?.id === preset.criterion.id);
  return (
    <section className="your-search my-criteria" data-testid="my-criteria" aria-labelledby="my-criteria-title">
      <div className="your-search-head">
        <h2 id="my-criteria-title">My criteria</h2>
        <button type="button" aria-expanded={building} onClick={() => setBuilding(!building)}>
          {building ? "Close" : "Build your own"}
        </button>
      </div>
      {added.length > 0 && (
        <ul className="my-places" aria-label="Your criteria in the match">
          {added.map((entry) => (
            <li key={entry.criterion.id} className="my-place my-criterion-row" data-testid={`my-criterion-${entry.criterion.id}`}>
              <span>
                <strong>{entry.criterion.label}</strong>
                <small className="criterion-status">{entry.direction === "lower" ? "Less of it" : "More of it"} · importance {entry.weight}</small>
              </span>
              <span className="tradeoff-actions">
                <button type="button" aria-pressed={shown?.id === entry.criterion.id} onClick={() => onShow(entry.criterion)}>Show on map</button>
                <button type="button" onClick={() => onChange(withoutCustom(profile, entry.criterion.id))}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="search-chips" aria-label="Ready-made criteria">
        {presets.map((preset) => (
          <li key={preset.criterion.id}>
            <button type="button" className="search-chip criteria-chip"
              aria-pressed={shown?.id === preset.criterion.id} data-testid={`preset-${preset.criterion.id}`}
              onClick={() => onShow(preset.criterion)}>
              {preset.criterion.label}
            </button>
          </li>
        ))}
        {!more && presets.length < CUSTOM_PRESETS.length && (
          <li>
            <button type="button" className="search-chip criteria-chip" data-testid="presets-more" onClick={() => setMore(true)}>More…</button>
          </li>
        )}
      </ul>
      {building && <Builder onUse={(criterion) => { onShow(criterion); setBuilding(false); }} />}
    </section>
  );
}

/** "Build your own": two kinds of place and a measure; "Show it" paints the result. Also in the map's "Explore: More". */
export function Builder({ onUse }: { onUse: (criterion: CustomCriterion) => void }) {
  const [a, setA] = useState(PLACE_TYPES[5].id);
  const [b, setB] = useState(PLACE_TYPES[0].id);
  const [formula, setFormula] = useState<CustomFormula>("nearest");
  const pair = formula === "balance" || formula === "share";
  const typeA = PLACE_TYPES.find((type) => type.id === a)!;
  const typeB = PLACE_TYPES.find((type) => type.id === b)!;
  const same = pair && a === b;
  return (
    <div className="criteria-builder" data-testid="criteria-builder">
      <label>
        <span>Places</span>
        <KnitSelect value={a} onChange={setA}>
          {PLACE_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
        </KnitSelect>
      </label>
      <label>
        <span>Measure</span>
        <KnitSelect value={formula} onChange={(value) => setFormula(value as CustomFormula)}>
          {BUILDER_FORMULAS.map((value) => <option key={value} value={value}>{FORMULA_WORDS[value]}</option>)}
        </KnitSelect>
      </label>
      {pair && (
        <label>
          <span>Against</span>
          <KnitSelect value={b} onChange={setB}>
            {PLACE_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
          </KnitSelect>
        </label>
      )}
      <button type="button" className="primary-action criteria-builder__show" disabled={same} onClick={() => onUse(buildCriterion(typeA, pair ? typeB : null, formula, RADIUS_METRES))}>
        {same ? "Pick two different kinds" : "Show it"}
      </button>
    </div>
  );
}

/** A styled select: a field with a yarn chevron sewn in on the right. */
function KnitSelect({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <span className="knit-select">
      <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
      <KnitIcon name="chevron-down" className="knit-select__chevron" />
    </span>
  );
}
