/**
 * No data on the map (DESIGN.md §6, England map): one look instead of three. Inside a layer's coverage an area without a
 * value is grey at 90% (NO_DATA_COLOUR, Night its own), whatever the reason (few sales, suppressed, no source there):
 * the reason is the area's card's, not the map's. Outside the coverage (a source that does not reach there) an area
 * is clear, and a hatch means only "fails a Must" (My match). The legend shows a "No data" square while such an area
 * is in view (noDataInView).
 */
import type { ExpressionSpecification } from "maplibre-gl";

import { carrierOfId, type Carrier, type GeographyId, type ValuePackEntry } from "./contracts";
import type { AreaBox } from "./area-boxes";
import { intersects, LONDON_REGION, type Bbox, type MapCoverage } from "./map-coverage";
import type { ResolvedTheme } from "./ui-themes";

export const NO_DATA_COLOUR: Readonly<Record<ResolvedTheme, string>> = { day: "#d1d5d3", night: "#3d4862" };
export const NO_DATA_OPACITY = 0.9;
export const NO_DATA_LABEL = "No data";

export function noDataColour(theme: ResolvedTheme): string {
  return NO_DATA_COLOUR[theme];
}

/** A fill colour `["case", <no value>, <grey>, <ramp>]` (lib/map-morph.ts) with another grey: Day and Night. */
export function withNoDataColour(expression: ExpressionSpecification, colour: string): ExpressionSpecification {
  const parts = expression as unknown as unknown[];
  if (parts[0] !== "case" || parts.length !== 4) return expression;
  return [parts[0], parts[1], colour, parts[3]] as unknown as ExpressionSpecification;
}

/**
 * The region an area of a paint lies in: its piece's (a region or LAD chunk), else, for a LAD of England's one piece,
 * its own chunk's region (London's boroughs are London's).
 */
export function areaRegion(box: AreaBox, coverage: MapCoverage): string | null {
  if (box.region) return box.region;
  const code = box.id.slice(box.id.lastIndexOf(":") + 1);
  if (carrierOfId(box.id) !== "lad") return null;
  if (code.startsWith("E09")) return LONDON_REGION;
  return coverage.chunks.find((chunk) => chunk.id === code)?.region ?? null;
}

/**
 * The areas of the paint's pieces (of the carrier painted) that have no value but lie in a region where the layer has
 * values: each as a value-less entry, so the fill draws it grey. A region without any value (London-only data, seen
 * in Manchester) is outside the coverage and stays clear.
 */
export function noDataEntries(values: readonly ValuePackEntry[], areas: readonly AreaBox[], carrier: Carrier,
  regionOf: (box: AreaBox) => string | null): ValuePackEntry[] {
  const first = values[0];
  if (!first) return [];
  const valued = new Set(values.map((entry) => entry.geographyId as string));
  const byId = new Map(areas.map((box) => [box.id as string, box]));
  const covered = new Set<string | null>();
  for (const entry of values) {
    const box = byId.get(entry.geographyId);
    if (box && entry.value !== null) covered.add(regionOf(box));
  }
  const missing: ValuePackEntry[] = [];
  const seen = new Set<string>();
  for (const box of areas) {
    if (valued.has(box.id) || seen.has(box.id) || carrierOfId(box.id) !== carrier || !covered.has(regionOf(box))) continue;
    seen.add(box.id);
    missing.push({
      geographyId: box.id as GeographyId, name: "", metricId: first.metricId, period: first.period, value: null,
      regionPercentile: null, countryPercentile: null, sampleCount: null, quality: "suppressed",
      sourceVersion: first.sourceVersion, carrier,
    } as ValuePackEntry);
  }
  return missing;
}

/** What a paint shows in `view`: a value-less area ("No data" in the legend), and any area with a value at all. */
export interface ViewCoverage {
  noData: boolean;
  values: boolean;
}

export function viewCoverage(values: readonly ValuePackEntry[], boxes: ReadonlyMap<string, Bbox>, view: Bbox): ViewCoverage {
  const shown = { noData: false, values: false };
  for (const entry of values) {
    const box = boxes.get(entry.geographyId);
    if (!box || !intersects(box, view)) continue;
    if (entry.value === null) shown.noData = true;
    else shown.values = true;
    if (shown.noData && shown.values) break;
  }
  return shown;
}

/** Before any paint: nothing to say. */
const UNKNOWN: ViewCoverage = { noData: false, values: true };
let inView: ViewCoverage = UNKNOWN;
const listeners = new Set<() => void>();

/** The main map sets it on every paint and move (components/map-controller); the legend and its banner read it. */
export function setViewCoverage(value: ViewCoverage | null): void {
  const next = value ?? UNKNOWN;
  if (next.noData === inView.noData && next.values === inView.values) return;
  inView = next;
  for (const listener of listeners) listener();
}

export function subscribeViewCoverage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function currentViewCoverage(): ViewCoverage {
  return inView;
}
