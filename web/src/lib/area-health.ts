import type { GeographyId } from "./contracts";
import type { RatingInput } from "./rating";

/** Mirrors api/area_api/health.py (area-health.v1): air, summer heat and GP access, each with its London percentile. */
export interface AreaHealthResponse {
  schemaVersion: "area-health.v1";
  productReleaseId: string;
  geographyId: GeographyId;
  available: boolean;
  /** False while CLOSE_KNIT_AIR_QUALITY is off (FLAGS.md): air is null and Clean air is not shown. */
  airEnabled?: boolean;
  /** µg/m³ annual means at the area's homes (London: GLA LAEI, 20 m grid; elsewhere in England: Defra's 1 km
   * background map, gridMetres 1000, coarse); percentiles 0-100 within the region, higher = more polluted. */
  air: { no2: number; pm25: number | null; year: number | null; gridMetres?: number; regionPercentile: number | null;
    no2Percentile: number | null; pm25Percentile: number | null } | null;
  /** Mean midnight air temperature in summer; higher percentile = warmer. */
  heat: { value: number; unit: string | null; year: number | null; regionPercentile: number | null } | null;
  /** Higher percentile = more patients per GP. */
  gp: { patientsPerGp: number | null; practices: number; nearestMetres: number | null; month: string | null;
    regionPercentile: number | null;
    /** 1000 for a neighbourhood (practices within 1 km of its centre); null for an MSOA or borough (practices inside it). */
    withinMetres: number | null } | null;
  /** Short card lines, written by the API so the site, the brief and Claude say the same thing. */
  notes: string[];
  /** Features the API withholds ("laeiAir": the air row is left out, not shown as "no data"); absent in an old payload. */
  withheld?: string[];
  sources: { release: string; sourceUrl: string; licence: string; attribution: string }[];
  caveats: string[];
}

export function healthPath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/health`;
}

/** The payload when it is an area-health.v1 document, else null. */
export function readAreaHealth(payload: unknown): AreaHealthResponse | null {
  const value = payload as AreaHealthResponse | null;
  return value?.schemaVersion === "area-health.v1" && Array.isArray(value.notes) ? value : null;
}

/** WHO 2021 annual guideline and UK legal limit, µg/m³. */
export const AIR_LIMITS = { no2: { who: 10, uk: 40 }, pm25: { who: 5, uk: 20 } } as const;

const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

/** "within 1 km" for a neighbourhood, "in the area" for an MSOA or borough. */
export function gpWhere(withinMetres: number | null): string {
  return withinMetres ? `within ${number.format(withinMetres / 1000)} km` : "in the area";
}

/** "389 m" / "1.27 km": a GP's straight-line distance. */
export function gpDistance(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(2)} km`;
}

/**
 * Local places' GP row from NHS England's practices, as Health, its tile and its tag read them (never
 * OpenStreetMap's, which can show a branch surgery beside "No GP within 1 km"): "None within 1 km" · "1.27 km".
 */
export function gpEssential(gp: AreaHealthResponse["gp"]): { name: string; distance: string } | null {
  if (!gp || gp.nearestMetres === null) return null;
  return { name: `${gp.practices === 0 ? "None" : gp.practices} ${gpWhere(gp.withinMetres)}`, distance: gpDistance(gp.nearestMetres) };
}

/** Whether the Health section shows air (the LAEI grid): not while the API withholds `laeiAir` or sends
 * airEnabled false; an older payload without either field does. */
export function airShown(health: AreaHealthResponse | null): boolean {
  return health?.airEnabled !== false && !health?.withheld?.includes("laeiAir");
}

/**
 * The three ratings of the Health section, lower is better for each; null figures say "No rating".
 * Clean air is left out while the API's air flag is off.
 */
export function healthRatings(health: AreaHealthResponse | null): RatingInput[] {
  const air = health?.air ?? null;
  const heat = health?.heat ?? null;
  const gp = health?.gp ?? null;
  const ratings: RatingInput[] = [
    { label: "Clean air", percentile: air?.regionPercentile ?? null, higherIsBetter: false, comparative: "cleaner air",
      fact: air ? `NO₂ ${number.format(air.no2)}${air.pm25 === null ? "" : ` · PM2.5 ${number.format(air.pm25)}`} µg/m³` : undefined },
    { label: "Cool nights", percentile: heat?.regionPercentile ?? null, higherIsBetter: false, comparative: "cooler",
      fact: heat ? `${number.format(heat.value)}${heat.unit === "°C" ? "°C" : heat.unit ? ` ${heat.unit}` : ""} on summer nights` : undefined },
    { label: "GP access", percentile: gp?.regionPercentile ?? null, higherIsBetter: false, comparative: "fewer patients per GP",
      fact: gp ? gp.practices === 0 ? `No GP ${gpWhere(gp.withinMetres)}`
        : gp.patientsPerGp === null ? `${gp.practices} GP ${gp.practices === 1 ? "practice" : "practices"} ${gpWhere(gp.withinMetres)}`
          : `${gp.patientsPerGp.toLocaleString("en-GB")} patients per GP` : undefined },
  ];
  return ratings.filter((rating) => rating.label !== "Clean air" || airShown(health));
}
