import type { MatchZone } from "./contracts";
import type { CustomCriterion } from "./custom-criteria";
import { isCustomLayerId } from "./custom-criteria";
import { presetFor } from "./custom-presets";
import type { UsageProps } from "./usage";

/**
 * Which analytic a map layer is, for usage (docs/product-analytics.md › layer_view): a built-in metric by
 * its id, My match, or a custom criterion as a ready-made preset (its slug) or the reader's own (its label,
 * built from neutral place types). `name` is the key engaged time is split by.
 */
export function layerUsage(layer: string, criterion: CustomCriterion | null): { name: string; props: UsageProps } {
  if (!isCustomLayerId(layer)) return { name: layer, props: { layer } };
  const preset = criterion ? presetFor(criterion) : null;
  if (preset) return { name: `custom:${preset.slug}`, props: { layer: "custom", custom: "preset", preset: preset.slug, label: criterion?.label } };
  return { name: "custom:own", props: { layer: "custom", custom: "own", label: criterion?.label ?? null } };
}

/**
 * A zone added to or removed from Find my area (zone_change): its kind and the place it names (a station,
 * borough or neighbourhood, public names); a drawn shape by its corner count and coarse centre only.
 */
export function zoneUsage(action: "add" | "remove", zone: MatchZone, zonesAfter: number): UsageProps {
  const base = { action, kind: zone.kind, zones: zonesAfter };
  if (zone.kind === "polygon") {
    // Corners are [latitude, longitude] (contracts.ts › MatchZone).
    const lat = zone.points.reduce((sum, point) => sum + point[0], 0) / Math.max(zone.points.length, 1);
    const lng = zone.points.reduce((sum, point) => sum + point[1], 0) / Math.max(zone.points.length, 1);
    return { ...base, corners: zone.points.length, lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
  }
  if (zone.kind === "station") return { ...base, place: zone.label ?? zone.stationId, walk: zone.maxWalkMinutes };
  if (zone.kind === "borough") return { ...base, place: zone.label ?? zone.id };
  if (zone.kind === "lsoas") return { ...base, place: zone.label ?? null, areas: zone.ids.length };
  return base;
}
