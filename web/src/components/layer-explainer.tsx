"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";

import type { GeographyId } from "@/lib/contracts";
import type { CustomCriterion } from "@/lib/custom-criteria";
import { explainLayer, scaleMarks, type LayerExplanation, type NatureParts, type PaintedStore, type ScaleMark } from "@/lib/layer-explainer";
import { currentViewValues, quantileOf, subscribeViewValues } from "@/lib/legend-range";

import { KnitIcon } from "./knit/knit-icon";
import { legendRamp, ownScaleKey, useOwnScale, useViewBreaks, type LegendRamp, type MapLegendProps } from "./map-legend";
import { RampSatin } from "./ramp-knit";

/**
 * The explainer for the layer on the map, built while it is open: the layer's own definition, the
 * painted values (London typical and the chosen area) and, for Green & trees, the area's three parts
 * (GET /api/v1/areas/{id}/nature; left out when the area has none).
 */
export function CurrentLayerExplainer({ legend, name, criterion, painted, selected, selectedName, onClose }: {
  legend: MapLegendProps;
  /** The selector's name for the layer ("Green & trees"). */
  name: string;
  criterion: CustomCriterion | null;
  /** What the map paints (area-map.tsx onPainted), read only while this is open. */
  painted: PaintedStore;
  selected: GeographyId | null;
  selectedName: string | null;
  onClose: () => void;
}) {
  const values = useSyncExternalStore(painted.subscribe, painted.get, () => null);
  const nature = useNatureParts(legend.metric.id === "nature-score" ? selected : null);
  // The rank scale split from the areas in view (lib/view-scale.ts): its middle break is the view's typical value.
  // The reader's own range (lib/legend-range.ts) paints measured values: no rank words, the view's typical value.
  const own = useOwnScale(legend);
  const viewBreaks = useViewBreaks(legend);
  const breaks = own.range ? null : viewBreaks;
  const viewValues = useSyncExternalStore(subscribeViewValues, currentViewValues, () => null);
  const ownKey = ownScaleKey(legend);
  const inViewMedian = own.range && viewValues && viewValues.key === ownKey && viewValues.values.length
    ? quantileOf(viewValues.values, 0.5) : null;
  const ramp = legendRamp(legend, breaks, own);
  const explanation = explainLayer(legend.metric, {
    name, period: legend.period, criterion, nature, scaleMode: own.range ? "linear" : ramp?.scaleMode, changeWindow: legend.changeWindow,
    rankScope: legend.rankScope, inView: !!breaks,
  });
  // Only values painted for this layer and scale count (and on the same kind of rank): a pack on its way says nothing yet.
  const fresh = ramp && values && values.metricId === legend.metric.id && values.scaleMode === ramp.scaleMode
    && !!values.inView === !!breaks && !!values.custom === !!own.range ? values : null;
  const marks = ramp && fresh ? scaleMarks({
    metric: legend.metric, scaleMode: own.range ? "linear" : fresh.scaleMode, values: fresh.values.map((entry) => entry.value),
    position: ramp.position, scope: legend.rankScope,
    inView: breaks ? { median: breaks[Math.round((breaks.length - 1) / 2)] } : inViewMedian !== null ? { median: inViewMedian } : null,
    selected: selected ? { name: selectedName ?? "Selected area", value: fresh.values.find((entry) => entry.geographyId === selected)?.value ?? null } : null,
  }) : { average: null, area: null };
  return <LayerExplainer explanation={explanation} ramp={ramp} average={marks.average} area={marks.area} onClose={onClose} />;
}

/**
 * A mark's place on the scale (0..1) for layout.css: the dot or caret sits on it, and its words slide
 * along by the same share of their own width, so they stay inside the panel wherever the mark is.
 */
function at(position: number): CSSProperties {
  return { "--at": position.toFixed(3) } as CSSProperties;
}

function useNatureParts(selected: GeographyId | null): NatureParts | null {
  const [parts, setParts] = useState<{ id: GeographyId; parts: NatureParts } | null>(null);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void fetch(`/api/v1/areas/${encodeURIComponent(selected)}/nature`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { available?: boolean; green?: { percentile: number | null } | null; trees?: { percentile: number | null } | null;
        site?: { percentile: number | null } | null } | null) => {
        if (!payload?.available) return;
        setParts({ id: selected, parts: { green: payload.green?.percentile ?? null, trees: payload.trees?.percentile ?? null, site: payload.site?.percentile ?? null } });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected]);
  return parts && parts.id === selected ? parts.parts : null;
}

/**
 * The legend "?" panel (map-layers.tsx), above the chip: the layer, one plain line on what it measures,
 * how it is counted (source and date under each point, the chosen area's own figure beside it when
 * there is one), the chip's scale with London typical (▲) and the area chosen (●), and "More in the
 * guide →". × and Escape close it. One panel for every layer; Nature is explained here, nowhere else.
 */
export function LayerExplainer({ explanation, ramp, average, area, related = null, onClose }: {
  explanation: LayerExplanation;
  ramp: LegendRamp | null;
  average: ScaleMark | null;
  area: ScaleMark | null;
  /** One line to a related view of the same thing (Green cover → Show › Street trees), as a switch. */
  related?: { label: string; onSelect: () => void } | null;
  onClose: () => void;
}) {
  const { name, line, points, guide } = explanation;
  return (
    <section className="layer-explainer" role="dialog" aria-label={`About ${name}`} data-testid="layer-explainer">
      <div className="layer-explainer__head">
        <h2 className="layer-explainer__name" tabIndex={-1} data-explainer-focus>{name}</h2>
        <button type="button" className="layer-explainer__close" aria-label="Close" data-testid="layer-explainer-close" onClick={onClose}>
          <KnitIcon name="cross" colour="var(--icon-yarn, currentColor)" style={{ width: 16, height: 16 }} />
        </button>
      </div>
      <p className="layer-explainer__line" data-testid="layer-explainer-line">{line}</p>
      {related && (
        <button type="button" className="link-button layer-explainer__related" data-testid="layer-explainer-related" onClick={related.onSelect}>{related.label}</button>
      )}
      {points.length > 0 && (
        <ul className="layer-explainer__points" data-testid="layer-explainer-points">
          {points.map((point) => (
            <li key={point.text}>
              <span className="layer-explainer__point">
                <strong>{point.text}</strong>
                {point.source && <span>{point.source}</span>}
              </span>
              {point.value && <span className="layer-explainer__value" data-testid="layer-explainer-value">{point.value}</span>}
            </li>
          ))}
        </ul>
      )}
      {ramp && (
        <figure className="layer-explainer__scale" data-testid="layer-explainer-scale" aria-label={[average?.label, area?.label].filter(Boolean).join(". ") || undefined}>
          {area && (
            <span className="layer-explainer__area" data-testid="layer-explainer-area" style={at(area.position)}>
              <span className="layer-explainer__label">{area.label}</span>
              <span className="layer-explainer__dot" aria-hidden="true" />
            </span>
          )}
          <RampSatin colours={ramp.colours} steps={Math.max(5, Math.min(9, ramp.colours.length))} width={340} height={12} className="layer-explainer__ramp" />
          {average && (
            <span className="layer-explainer__average" data-testid="layer-explainer-average" style={at(average.position)}>
              <span className="layer-explainer__caret" aria-hidden="true" />
              <span className="layer-explainer__label">{average.label}</span>
            </span>
          )}
          <figcaption className="layer-explainer__note">{ramp.note}</figcaption>
        </figure>
      )}
      <Link className="layer-explainer__guide" href={guide} data-testid="layer-explainer-guide">More in the guide →</Link>
    </section>
  );
}
