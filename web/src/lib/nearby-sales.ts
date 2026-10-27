// Wave 1 / feature 3: other homes' recorded sales in the same building and on
// the same street. The API sends no per-sale floor area or £/m²; the only
// £/m² figure is the group median, which it withholds under 5 sales.
import type { NearbySale, NearbySaleGroup } from "./contracts";
import { formatPounds } from "./evidence-format";
import { toPricePerSquareFoot } from "./price-history";
import type { AreaUnit } from "./profile-state";

export const NEARBY_MEDIAN_MIN = 5;

const PROPERTY_TYPE_LABELS: Record<NearbySale["propertyType"], string> = {
  detached: "Detached house",
  "semi-detached": "Semi-detached house",
  terraced: "Terraced house",
  flat: "Flat",
  other: "Other",
};

/** "Flat · leasehold · new build" */
export function nearbySaleLabel(sale: NearbySale): string {
  const parts = [PROPERTY_TYPE_LABELS[sale.propertyType], sale.tenure === "unknown" ? "tenure not recorded" : sale.tenure];
  if (sale.newBuild) parts.push("new build");
  return parts.join(" · ");
}

/** Median £/m² (or £/sqft) of the group, or why it is withheld. */
export function nearbyMedianText(group: NearbySaleGroup, unit: AreaUnit): string {
  const median = group.medianPricePerSquareMetre;
  if (median === null || group.medianSampleSize < NEARBY_MEDIAN_MIN) {
    return `Median price per ${unit === "sqft" ? "sq ft" : "m²"} not shown: it needs at least ` +
      `${NEARBY_MEDIAN_MIN} standard sales with a recorded floor area (${group.medianSampleSize} here).`;
  }
  const value = unit === "sqft" ? toPricePerSquareFoot(median) : median;
  const label = unit === "sqft" ? "/sqft" : "/m²";
  return `Median ${formatPounds(Math.round(value))}${label} across ${group.medianSampleSize} standard sales ` +
    "with a recorded floor area.";
}

/** "3 sales in the last 10 years" / "showing the newest 50 of 63 …" */
export function nearbyCountText(group: NearbySaleGroup, windowYears: number): string {
  const noun = group.saleCount === 1 ? "sale" : "sales";
  if (group.saleCount > group.sales.length) {
    return `Newest ${group.sales.length} of ${group.saleCount} ${noun} in the last ${windowYears} years.`;
  }
  return `${group.saleCount} ${noun} in the last ${windowYears} years.`;
}
