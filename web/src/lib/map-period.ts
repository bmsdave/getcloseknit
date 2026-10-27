import type { MetricDefinition } from "./contracts";

/**
 * The month the map asks the layer's value packs for. "" means wait: a link naming a layer but no month, while that
 * layer's definition is still the placeholder (the release catalogue has not answered). Asking for the default month
 * then was a 404 for census (2021-03) and station access, and built crime twice (2026-06, then its own 2026-08):
 * about 6 s of server time each (perf/layer-load/analysis-2026-10-23.md).
 *
 * Once the definition is known, the month the explorer is about to switch to is used straight away (the layer's
 * own default for such a link, or for a month the layer does not have), so the first request is the right one.
 */
export function mapPeriod(input: {
  metric: Pick<MetricDefinition, "periods" | "defaultPeriod"> | null;
  period: string;
  /** The explorer's requestPeriod is "" (the linked layer's definition is still the placeholder). */
  waiting: boolean;
  placeholder: boolean;
  /** The address named this layer and no month, and its definition has not set the month yet. */
  followsLayer: boolean;
}): string {
  const { metric, period } = input;
  if (!metric) return period;
  if (input.waiting) return "";
  if (input.placeholder || !metric.periods.length) return period;
  if ((input.followsLayer || !metric.periods.includes(period)) && metric.defaultPeriod) return metric.defaultPeriod;
  return period;
}
