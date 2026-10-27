"use client";

import { useState, type ReactNode } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import type { PlaceMode, RangeCriterion } from "@/lib/contracts";
import { histogram, rangeFit } from "@/lib/match-ranges";
import { formatRangeValue, type RangeDomain } from "@/lib/range-layers";
import { rampAt } from "@/lib/palettes";

import type { RangeLayerData } from "./use-range-values";

const BINS = 20;

/** London's areas over the layer: bins in the layer's colours, grey where they are out, paler on the soft edge. */
export function Histogram({ criterion, data, domain }: { criterion: RangeCriterion; data: RangeLayerData | null; domain: RangeDomain }) {
  if (!data?.list.length) return <div className="range-histogram range-histogram--empty" aria-hidden="true" />;
  const counts = histogram(data.list, domain.low, domain.high, BINS);
  const top = Math.max(...counts, 1);
  const width = (domain.high - domain.low) / BINS;
  return (
    <div className="range-histogram" aria-hidden="true" data-testid="range-histogram">
      {counts.map((count, index) => {
        const fit = rangeFit(domain.low + (index + 0.5) * width, criterion);
        return (
          <span key={index} className={fit > 0 ? undefined : "range-histogram__out"}
            style={{ height: `${Math.max(4, (count / top) * 100)}%`, background: fit > 0 ? rampAt(data.ramp, index / (BINS - 1)) : undefined, opacity: fit >= 1 || fit <= 0 ? 1 : 0.35 + 0.5 * fit }} />
        );
      })}
    </div>
  );
}

/**
 * Two range handles on the top lane and two soft-edge handles on the lower lane, as native range inputs
 * (keyboard and screen readers work). A handle at the end of London's span leaves that side open.
 */
export function RangeSlider({ criterion, domain, name, highlight, onMove, onRelease }: {
  criterion: RangeCriterion; domain: RangeDomain; name: string; highlight: boolean;
  onMove: (criterion: RangeCriterion) => void; onRelease: () => void;
}) {
  const { low, high, step } = domain;
  const span = high - low;
  const at = (value: number) => `${Math.min(100, Math.max(0, ((value - low) / span) * 100))}%`;
  const lo = criterion.min ?? low;
  const hi = criterion.max ?? high;
  const softLo = criterion.softMin ?? lo;
  const softHi = criterion.softMax ?? hi;
  const clamp = (value: number) => Math.min(high, Math.max(low, value));
  const set = (key: "min" | "max" | "softMin" | "softMax", raw: number) => {
    const value = clamp(Math.round(raw / step) * step);
    // A handle at the end of London's span leaves that side open, unless the other side is open too: then
    // it holds the end (a range needs one bound).
    if (key === "min") {
      const min = value <= low && criterion.max !== null ? null : Math.min(value, hi);
      const softMin = criterion.softMin === null || min === null ? null : Math.min(criterion.softMin, min);
      onMove({ ...criterion, min, softMin: softMin === min ? null : softMin });
    } else if (key === "max") {
      const max = value >= high && criterion.min !== null ? null : Math.max(value, lo);
      const softMax = criterion.softMax === null || max === null ? null : Math.max(criterion.softMax, max);
      onMove({ ...criterion, max, softMax: softMax === max ? null : softMax });
    } else if (key === "softMin" && criterion.min !== null) {
      const edge = Math.min(value, criterion.min);
      onMove({ ...criterion, softMin: edge < criterion.min ? edge : null });
    } else if (key === "softMax" && criterion.max !== null) {
      const edge = Math.max(value, criterion.max);
      onMove({ ...criterion, softMax: edge > criterion.max ? edge : null });
    }
  };
  const handle = (key: "min" | "max" | "softMin" | "softMax", value: number, label: string, edge: boolean) => (
    <input type="range" className={`range-input${edge ? " range-input--edge" : ""}`} min={low} max={high} step={step} value={value}
      aria-label={`${name}, ${label}`} aria-valuetext={formatRangeValue(criterion.layer, value)}
      onChange={(event) => set(key, Number(event.target.value))}
      onPointerUp={onRelease} onKeyUp={onRelease} onBlur={onRelease} onTouchEnd={onRelease} />
  );
  return (
    <div className={`range-slider${highlight ? " range-slider--cut" : ""}`} data-testid="range-slider">
      <span className="range-slider__track" aria-hidden="true" />
      <span className="range-slider__soft" aria-hidden="true" style={{ left: at(softLo), width: `calc(${at(softHi)} - ${at(softLo)})` }} />
      <span className="range-slider__in" aria-hidden="true" style={{ left: at(lo), width: `calc(${at(hi)} - ${at(lo)})` }} />
      {handle("min", lo, "lowest", false)}
      {handle("max", hi, "highest", false)}
      {criterion.min !== null && handle("softMin", softLo, "soft edge below", true)}
      {criterion.max !== null && handle("softMax", softHi, "soft edge above", true)}
    </div>
  );
}

const MODE_WORD: Record<PlaceMode, string> = { walk: "walk", cycle: "bike", transit: "transit", car: "car" };
const MODE_ICON: Record<PlaceMode, string> = { walk: "walk", cycle: "bicycle", transit: "tube", car: "car" };
const MINUTES = [5, 10, 15, 20, 30, 40, 45, 60, 90];

/**
 * A trip as chips, "≤ 40 min · bike · Weekday 8am": time and mode open their choices in place (never native
 * selects); the time of day is fixed. `children` sit at the end of the row (the wizard's Must). Shared by the
 * place cards and the wizard's first step.
 */
export function TripChips({ name, minutes, mode, modes, onMinutes, onMode, children }: {
  name: string; minutes: number; mode: PlaceMode; modes: readonly PlaceMode[];
  onMinutes: (minutes: number) => void; onMode: (mode: PlaceMode) => void; children?: ReactNode;
}) {
  const [editing, setEditing] = useState<"minutes" | "mode" | null>(null);
  return (
    <div className="trip-chips" data-testid="trip-chips">
      <div className="place-chips" role="group" aria-label={`Trip to ${name}`}>
        <button type="button" className="place-chip" aria-expanded={editing === "minutes"} onClick={() => setEditing(editing === "minutes" ? null : "minutes")}
          aria-label={`Within ${minutes} minutes, change`}>≤ {minutes} min</button>
        <button type="button" className="place-chip" aria-expanded={editing === "mode"} onClick={() => setEditing(editing === "mode" ? null : "mode")}
          aria-label={`By ${MODE_WORD[mode]}, change`}>
          <KnitIcon name={MODE_ICON[mode]} colour="currentColor" className="knit-inline" style={{ width: 15, height: 15 }} /> {MODE_WORD[mode]}
        </button>
        <span className="place-chip place-chip--fixed" title="Journey times are for a weekday morning">Weekday 8am</span>
        {children}
      </div>
      {editing === "minutes" && (
        <div className="place-options" role="group" aria-label="Minutes">
          {MINUTES.map((option) => (
            <button key={option} type="button" aria-pressed={minutes === option}
              onClick={() => { onMinutes(option); setEditing(null); }}>{option} min</button>
          ))}
        </div>
      )}
      {editing === "mode" && (
        <div className="place-options" role="group" aria-label="How you get there">
          {modes.map((option) => (
            <button key={option} type="button" aria-pressed={mode === option} onClick={() => { onMode(option); setEditing(null); }}>
              <KnitIcon name={MODE_ICON[option]} colour="currentColor" className="knit-inline" style={{ width: 15, height: 15 }} /> {MODE_WORD[option]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
