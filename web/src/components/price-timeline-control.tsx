"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { MetricDefinition } from "@/lib/contracts";
import { mapPeriodLabel } from "@/lib/map-legend";
import { activeViewPackPaths } from "@/lib/map-coverage";
import { valuePackPath, type DataMode } from "@/lib/map-state";
import { nextTimelinePeriod, PRICE_METRIC_ID, PRICE_PLAY_INTERVAL_MS, timelineIndex, timelinePeriods } from "@/lib/price-scale";
import { nextStepDue, PLAY_LEAD_MS, playbackBeat, upcomingPeriods, valuePackCache } from "@/lib/timeline-playback";
import { KnitIcon } from "./knit/knit-icon";

interface TimelineProps {
  metric: MetricDefinition;
  period: string;
  onPeriod: (period: string) => void;
  mode: DataMode;
  release: string;
}

/**
 * The price layer's timeline: one step per month, every month the release
 * has (2006–2026, about 241). ▶ advances a month every 200 ms on a steady
 * beat once the next month's pack is in memory (the next few are fetched
 * ahead), and the map morphs the colours from one month to the next in the
 * same time, so the months run together; ←/→ on the slider move one month.
 * A typed month outside the steps stays as typed and the slider rests on the
 * step before it.
 */
export function PriceTimelineControl({ metric, period, onPeriod, mode, release }: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  // When the next step is due, for the period playback last moved to.
  const beat = useRef<{ period: string; due: number } | null>(null);
  const steps = useMemo(() => timelinePeriods(metric.periods), [metric.periods]);
  const index = timelineIndex(steps, period);

  useEffect(() => {
    if (!playing || steps.length < 2) {
      beat.current = null;
      playbackBeat.clear();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPlaying(false);
      return;
    }
    // Each month's packs for the pieces the map shows (lib/map-coverage.ts: London whole on the London map).
    const paths = (step: string) => activeViewPackPaths(valuePackPath({ metric: metric.id, period: step, mode, release }), metric.carrier);
    const ahead = upcomingPeriods(steps, period).flatMap(paths);
    valuePackCache.prefetch(ahead);
    const next = nextTimelinePeriod(steps, period);
    if (next === null) {
      // Played through to the latest month: stop there rather than loop.
      setPlaying(false);
      return;
    }
    const now = performance.now();
    // On the beat while playback moved here; from now after ▶ or a slider move.
    const moving = beat.current?.period === period;
    const due = moving ? beat.current!.due : now + PRICE_PLAY_INTERVAL_MS;
    let live = true;
    // Handed over a little early; the map starts the morph on the beat.
    const timer = window.setTimeout(() => {
      // Wait for a slow pack rather than skip it; a failed one still advances. After ▶ the months
      // ahead load first, so their burst never stalls the morphs once they run.
      void Promise.all((moving ? paths(next) : ahead).map((entry) => valuePackCache.get(entry).catch(() => null))).then(() => {
        if (!live) return;
        beat.current = { period: next, due: nextStepDue(due, performance.now(), PRICE_PLAY_INTERVAL_MS) };
        playbackBeat.set(next, due);
        onPeriod(next);
      });
    }, Math.max(0, due - PLAY_LEAD_MS - now));
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [steps, onPeriod, period, playing, metric.id, mode, release]);

  if (metric.id !== PRICE_METRIC_ID) return null;
  return (
    <div className="timeline-control" role="group" aria-label="Price timeline" data-testid="price-timeline">
      <button type="button" onClick={() => {
          // ▶ on the latest month replays from the first.
          if (!playing && index === steps.length - 1) onPeriod(steps[0]);
          setPlaying(!playing);
        }} aria-label={playing ? "Pause timeline" : "Play timeline"}>
        <span aria-hidden="true"><KnitIcon name={playing ? "pause" : "play"} colour="var(--icon-yarn, currentColor)" className="knit-glyph" style={{ width: 14, height: 14 }} /></span>
      </button>
      <label>
        <span className="timeline-period">{mapPeriodLabel(period)}</span>
        <input
          id="price-period"
          aria-label="Price period"
          aria-valuetext={mapPeriodLabel(period)}
          type="range"
          min="0"
          max={Math.max(0, steps.length - 1)}
          step="1"
          value={index}
          onChange={(event) => onPeriod(steps[Number(event.target.value)] ?? period)}
        />
        {steps.length > 1 && (
          <span className="timeline-ends" aria-hidden="true"><span>{steps[0].slice(0, 4)}</span><span>{steps.at(-1)!.slice(0, 4)}</span></span>
        )}
      </label>
    </div>
  );
}
