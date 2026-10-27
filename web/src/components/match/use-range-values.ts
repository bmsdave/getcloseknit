"use client";

import { useEffect, useState } from "react";

import type { MatchCriterionValues, MetricDefinition } from "@/lib/contracts";
import { customRamp, evaluateCustomCriterion } from "@/lib/custom-criteria";
import { presetBySlug } from "@/lib/custom-presets";
import { valuePackPath, type DataMode } from "@/lib/map-state";
import { DEFAULT_PALETTE, PRICE_RAMP, paletteById, paletteRamp } from "@/lib/palettes";
import { valuePackCache } from "@/lib/timeline-playback";

/** One layer's value for every London area (LSOA), and its colours low to high (the histogram's). */
export interface RangeLayerData {
  values: Map<string, number>;
  list: number[];
  ramp: readonly string[];
}

let metrics: Promise<MetricDefinition[]> | null = null;
const loaded = new Map<string, Promise<RangeLayerData | null>>();

function metricDefinitions(): Promise<MetricDefinition[]> {
  metrics ??= fetch("/api/v1/metrics", { headers: { accept: "application/json" } })
    .then(async (response) => (response.ok ? ((await response.json()) as { metrics?: MetricDefinition[] }).metrics ?? [] : []))
    .catch(() => []);
  return metrics;
}

/**
 * The values behind a range card: the map's own value pack at the layer's latest period, or a
 * ready-made criterion's place counts, or (every layer is loadable) the criterion's own values from
 * /api/v1/match-criteria/{layer} for a layer with no map value pack yet (Noise before its map layer is loaded,
 * disorder, schools …). Loaded once per layer and kept, so dragging only recolours.
 */
export function loadRangeLayer(layer: string, mode: DataMode, release: string): Promise<RangeLayerData | null> {
  const key = `${mode}|${release}|${layer}`;
  if (!loaded.has(key)) {
    loaded.set(key, (layer.startsWith("custom:") ? loadPreset(layer) : loadMetric(layer, mode, release)).catch(() => null));
    if (loaded.size > 24) loaded.delete(loaded.keys().next().value!);
  }
  return loaded.get(key)!;
}

async function loadMetric(layer: string, mode: DataMode, release: string): Promise<RangeLayerData | null> {
  const ramp = layer === "price-per-square-metre" ? PRICE_RAMP : paletteRamp(paletteById(DEFAULT_PALETTE), layer);
  const metric = (await metricDefinitions()).find((entry) => entry.id === layer);
  const pack = metric ? await valuePackCache.get(valuePackPath({ metric: metric.id, period: metric.defaultPeriod, mode, release })).catch(() => null) : null;
  const values = new Map<string, number>();
  for (const entry of pack?.values ?? []) if (entry.value !== null && Number.isFinite(entry.value)) values.set(entry.geographyId, entry.value);
  if (!values.size) for (const [id, value] of await loadCriterionValues(layer)) values.set(id, value);
  return values.size ? { values, list: [...values.values()], ramp } : null;
}

/** GET /api/v1/match-criteria/{layer}: the criterion's own values when the map has no value pack for it. */
async function loadCriterionValues(layer: string): Promise<Map<string, number>> {
  const response = await fetch(`/api/v1/match-criteria/${encodeURIComponent(layer)}`, { headers: { accept: "application/json" } }).catch(() => null);
  if (!response?.ok) return new Map();
  const body = (await response.json()) as MatchCriterionValues;
  return new Map(body.values.filter((entry) => Number.isFinite(entry.value)).map((entry) => [entry.geographyId, entry.value]));
}

async function loadPreset(layer: string): Promise<RangeLayerData | null> {
  const preset = presetBySlug(layer.slice("custom:".length));
  if (!preset) return null;
  const pack = await evaluateCustomCriterion(preset.criterion);
  if (!pack?.values) return null;
  const values = new Map<string, number>();
  for (const entry of pack.values) if (entry.value !== null) values.set(entry.geographyId, entry.value);
  return { values, list: [...values.values()], ramp: customRamp(preset.criterion) };
}

/** The layer's data once loaded; null while loading or when the layer has none. */
export function useRangeLayer(layer: string | null, mode: DataMode, release: string): RangeLayerData | null {
  const [data, setData] = useState<{ key: string; value: RangeLayerData | null } | null>(null);
  const key = layer ? `${mode}|${release}|${layer}` : null;
  useEffect(() => {
    if (!layer) return;
    let live = true;
    void loadRangeLayer(layer, mode, release).then((value) => { if (live) setData({ key: `${mode}|${release}|${layer}`, value }); });
    return () => { live = false; };
  }, [layer, mode, release]);
  return data && data.key === key ? data.value : null;
}
