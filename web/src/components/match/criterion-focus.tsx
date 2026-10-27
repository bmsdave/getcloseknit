"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { areaPageHref } from "@/lib/area-brief";
import type { GeographyId, PreferenceProfile } from "@/lib/contracts";
import {
  describeCounts,
  describeFormula,
  lensEnds,
  formatCustomValue,
  PLACES_NOT_PEOPLE,
  tiedEndWords,
  withCustom,
  withoutCustom,
  type CustomCriterion,
  type CustomPreference,
  type CustomSummaryEntry,
} from "@/lib/custom-criteria";

import { presetFor } from "@/lib/custom-presets";

import { BivariateLegendDetails } from "../bivariate-legend";
import { useShareLink } from "./share-link";
import { useCustomPack } from "./use-custom-pack";
import { useScope } from "@/components/scope-context";

interface CriterionFocusProps {
  criterion: CustomCriterion;
  profile: PreferenceProfile;
  onChange: (profile: PreferenceProfile) => void;
  /** Show another criterion, or null to go back to My match. */
  onShow: (criterion: CustomCriterion | null) => void;
  onSelect: (id: GeographyId) => void;
  /** The area picked on the map or in the lists, so the pick reads here instead of vanishing behind the key. */
  selected?: GeographyId | null;
  selectedName?: string | null;
  /** The picked area's key numbers (price, crime, getting around, …), the same whatever layer is shown. */
  keyNumbers?: ReactNode;
  /** Where "← Back" goes when the comparison came from another layer (an "Explore:" chip over Crime). */
  back?: { label: string; go: () => void } | null;
  /** The phone sheet's header carries "← Back" (MapSheet lead): not again over the name. */
  backInHeader?: boolean;
}

const LISTED = 5;

/**
 * The panel while a criterion of the household's own is painted on the map:
 * its name, "Add to my match" (which asks which way and how much it matters)
 * and Share, then the picked area and the areas at each end as counts in words
 * ("4 kebab shops, no cafés"). No scale of its own: the legend chip is the one
 * scale, and its "?" says what is counted. The formula, the colour
 * square in full, the caveats and the licences sit behind "How this works".
 * Places on the map, never people.
 */
export function CriterionFocus({ criterion, profile, onChange, onShow, onSelect, selected = null, selectedName = null, keyNumbers = null, back = null, backInHeader = false }: CriterionFocusProps) {
  const added = profile.custom?.find((entry) => entry.criterion.id === criterion.id) ?? null;
  const pack = useCustomPack(criterion);
  const place = useScope().name;
  const [high, low] = lensEnds(criterion);
  const caveats = [...new Set([...(pack?.caveats ?? []), PLACES_NOT_PEOPLE])];
  const here = selected ? pack?.values?.find((value) => value.geographyId === selected) ?? null : null;
  // A pick from the lists below (or the map) scrolls its line into view, so the answer is not off-screen.
  const pickRef = useRef<HTMLDivElement | null>(null);
  const hasPack = pack !== null;
  useEffect(() => {
    if (selected && hasPack) pickRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected, hasPack]);
  return (
    <section className="criterion-focus" data-testid="criterion-focus" aria-labelledby="criterion-focus-title">
      {!backInHeader && (
        <button type="button" className="criterion-back" onClick={back ? back.go : () => onShow(null)}>
          ← Back to {back ? back.label : "My match"}
        </button>
      )}
      <h1 id="criterion-focus-title">{criterion.label}</h1>
      {/* The legend chip is the one scale; what is counted (the OpenStreetMap tags) is its "?". */}
      {!pack && <p role="status" className="metric-description">Counting places across {place}…</p>}
      <AddToMatch criterion={criterion} added={added} profile={profile} onChange={onChange} />
      <ShareLens criterion={criterion} />
      {selected && pack && (
        <div ref={pickRef} className="criterion-selected tradeoff-actions" data-testid="criterion-selected">
          <p>
            <strong>{selectedName ?? "Selected area"}</strong>
            <span>{here ? areaWords(here, criterion) : "No places counted"}</span>
          </p>
          <button type="button" onClick={() => onShow(null)}>Open its card in My match</button>
          <Link className="area-brief__secondary" href={areaPageHref(selected)} data-testid="open-area-page">Open area page</Link>
          {keyNumbers}
        </div>
      )}
      {pack && (
        <p className="criterion-london" data-testid="criterion-london">
          Across {place}: {pack.summary.areas.toLocaleString("en-GB")} areas scored.
        </p>
      )}
      {pack && (
        <div className="criterion-ends">
          <EndList title={high} entries={pack.summary.top.slice(0, LISTED)} tie={tiedEndWords(pack, "top", LISTED)}
            criterion={criterion} onSelect={onSelect} testId="criterion-top" />
          <EndList title={low} entries={pack.summary.bottom.slice(0, LISTED)} tie={tiedEndWords(pack, "bottom", LISTED)}
            criterion={criterion} onSelect={onSelect} testId="criterion-bottom" />
        </div>
      )}
      <details className="criterion-how" data-testid="criterion-how">
        <summary>How this works</summary>
        <p className="criterion-focus-what">{describeFormula(criterion)}.</p>
        {pack?.bivariate && <BivariateLegendDetails square={pack.bivariate} title={criterion.label} />}
        <ul className="criterion-caveats" data-testid="criterion-caveats">
          {caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
        </ul>
        {pack && pack.sources.length > 0 && (
          <p className="criterion-sources">
            {pack.sources.map((source) => `${source.name} (${source.licence})`).join(" · ")}. {pack.sources.map((source) => source.attribution).join(" ")}
          </p>
        )}
      </details>
    </section>
  );
}

/**
 * A ready-made comparison shares the map coloured by it (/?layer=custom:<id>), never the household's
 * match. A home-made criterion has no layer anyone else can open, so it has no share button.
 */
function ShareLens({ criterion }: { criterion: CustomCriterion }) {
  const preset = presetFor(criterion);
  const { share, status } = useShareLink("anyone with it sees this comparison, not your match");
  if (!preset) return null;
  return (
    <div className="criterion-focus-actions criterion-share">
      <button type="button" data-testid="criterion-share"
        onClick={() => void share(`${window.location.origin}/?layer=custom:${preset.criterion.id}`, criterion.label)}>
        Share this comparison
      </button>
      {status}
    </div>
  );
}

/** Counts in words where the criterion counts places; otherwise its value ("8 min walk", "62%"). */
function areaWords(area: { value: number | null; counts: CustomSummaryEntry["counts"] }, criterion: CustomCriterion): string {
  const counts = describeCounts(area.counts, criterion);
  if (counts && criterion.formula !== "nearest" && criterion.formula !== "share" && criterion.formula !== "per_resident") return counts;
  const value = formatCustomValue(area.value, criterion.formula);
  return counts ? `${value} · ${counts}` : value;
}

/** The two ways a household can want this criterion, in its own words. */
function directionWords(criterion: CustomCriterion): { higher: string; lower: string } {
  const a = criterion.sets.a.label.toLowerCase();
  const b = criterion.sets.b?.label.toLowerCase() ?? "";
  switch (criterion.formula) {
    case "balance": return { higher: `More ${a}`, lower: `More ${b}` };
    case "share": return { higher: `More ${a}`, lower: `More ${b}` };
    case "nearest": return { higher: "Closer is better", lower: "Further is better" };
    case "variety": return { higher: "More variety", lower: "Less variety" };
    default: return { higher: `More ${a}`, lower: `Fewer ${a}` };
  }
}

/**
 * "Add to my match": the one main action. It has no preset way: it asks
 * which way the household wants it and how much it matters, then adds it.
 * Once added: what was chosen, to change or remove.
 */
function AddToMatch({ criterion, added, profile, onChange }: {
  criterion: CustomCriterion; added: CustomPreference | null; profile: PreferenceProfile; onChange: (profile: PreferenceProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<CustomPreference["direction"] | null>(added?.direction ?? null);
  const [weight, setWeight] = useState(added?.weight ?? 3);
  const words = directionWords(criterion);
  if (added && !open) {
    return (
      <div className="criterion-added tradeoff-actions" data-testid={`my-criterion-${criterion.id}`}>
        <p><span className="criterion-status">In your match</span>: {words[added.direction]} · matters {added.weight}/5</p>
        <button type="button" onClick={() => setOpen(true)}>Change</button>
        <button type="button" onClick={() => onChange(withoutCustom(profile, criterion.id))}>Remove from my match</button>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="criterion-focus-actions" data-testid={`my-criterion-${criterion.id}`}>
        <button type="button" className="criterion-add" data-testid="criterion-add" onClick={() => setOpen(true)}>Add to my match</button>
      </div>
    );
  }
  return (
    <fieldset className="criterion-choose" data-testid="criterion-choose">
      <legend>What do you prefer?</legend>
      <div className="segmented" role="group" aria-label="Prefer">
        {(["higher", "lower"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={direction === value} data-testid={`criterion-direction-${value}`}
            onClick={() => setDirection(value)}>
            {words[value]}
          </button>
        ))}
      </div>
      <label className="criterion-weight">
        How much it matters
        <select value={weight} data-testid="criterion-weight" onChange={(event) => setWeight(Number(event.target.value))}>
          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} of 5{value === 1 ? " (a little)" : value === 5 ? " (a lot)" : ""}</option>)}
        </select>
      </label>
      <div className="criterion-focus-actions">
        <button type="button" className="criterion-add" data-testid="criterion-confirm" disabled={direction === null}
          onClick={() => {
            if (!direction) return;
            onChange(withCustom(profile, { criterion, direction, weight }));
            setOpen(false);
          }}>
          {added ? "Save" : "Add"}
        </button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </fieldset>
  );
}

/** An end's areas, or one line when more areas tie at its value than the list could show. */
function EndList({ title, entries, tie, criterion, onSelect, testId }: {
  title: string; entries: CustomSummaryEntry[]; tie: string | null; criterion: CustomCriterion;
  onSelect: (id: GeographyId) => void; testId: string;
}) {
  if (!entries.length) return null;
  return (
    <div className="criterion-end" data-testid={testId}>
      <h2>{title}</h2>
      {tie ? <p className="criterion-end-tie">{tie}</p> : <ol>
        {entries.map((area) => (
          <li key={area.geographyId}>
            <button type="button" onClick={() => onSelect(area.geographyId)}>
              <span className="criterion-end-name">{area.title ?? area.name}</span>
              <span className="criterion-end-counts">{areaWords(area, criterion)}</span>
            </button>
          </li>
        ))}
      </ol>}
    </div>
  );
}
