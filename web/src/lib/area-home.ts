import type { GeographyId } from "./contracts";
import type { RatingInput } from "./rating";

/** Mirrors api/area_api/home.py (area-home.v1): can I extend, broadband, settledness. */
interface Ranked { share: number | null; regionPercentile: number | null; regionShare: number | null }

export interface AreaHomeResponse {
  schemaVersion: "area-home.v1";
  productReleaseId: string;
  geographyId: GeographyId;
  available: boolean;
  borough?: { id: GeographyId; name: string } | null;
  extend?: {
    restrictedShare: number | null; conservationShare: number | null; article4Share: number | null;
    listed: { gradeI: number; gradeIIStar: number; gradeII: number; total: number };
    regionPercentile: number | null; regionShare: number | null;
    /** null: unknown; "not-published": the borough has no Article 4 data, so none mapped means nothing. */
    article4Data: "published" | "not-published" | null;
  } | null;
  broadband?: (Ranked & { premises: number; boroughFullFibreShare: number | null }) | null;
  settled?: (Ranked & { residents: number }) | null;
  /** Short card lines, written by the API so the site and Claude say the same thing. */
  notes: string[];
  sources: { release: string; sourceUrl: string; licence: string; attribution: string }[];
  caveats: string[];
}

export function homePath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/home`;
}

/** The payload when it is an area-home.v1 document, else null. */
export function readAreaHome(payload: unknown): AreaHomeResponse | null {
  const value = payload as AreaHomeResponse | null;
  return value?.schemaVersion === "area-home.v1" && Array.isArray(value.notes) ? value : null;
}

/** Demo mode has no Home layers: an honest "not available" shaped like the real thing. */
export function demoAreaHome(geographyId: GeographyId): AreaHomeResponse {
  return {
    schemaVersion: "area-home.v1", productReleaseId: "preview-release", geographyId, available: false,
    notes: [], sources: [], caveats: ["Planning limits, broadband and settledness are loaded in real mode only."],
  };
}

/** "70%"; "Under 1%" rather than a bare 0; null when unknown. */
export function sharePercent(share: number | null | undefined): string | null {
  if (share === null || share === undefined || !Number.isFinite(share)) return null;
  if (share > 0 && share < 0.005) return "Under 1%";
  return `${Math.round(Math.min(1, share) * 100)}%`;
}

/** The three Home ratings, in card order. Missing layers keep their tile and say "No rating". */
export function homeRatings(home: AreaHomeResponse | null): RatingInput[] {
  const extend = home?.extend ?? null;
  const broadband = home?.broadband ?? null;
  const settled = home?.settled ?? null;
  const listed = extend?.listed.total ?? 0;
  const restricted = sharePercent(extend?.restrictedShare);
  const fibre = sharePercent(broadband?.boroughFullFibreShare);
  return [
    {
      label: "Extending", percentile: extend?.regionPercentile ?? null, higherIsBetter: false, comparative: "freer to extend",
      fact: extend ? [restricted && `${restricted} of land protected`, listed > 0 && `${listed.toLocaleString("en-GB")} listed`,
        extend.article4Data === "not-published" && "Article 4 not published"].filter(Boolean).join(" · ") : undefined,
    },
    {
      label: "Broadband", percentile: broadband?.regionPercentile ?? null, higherIsBetter: true, comparative: "better connected",
      fact: broadband ? [`Gigabit ${sharePercent(broadband.share)}`, fibre && `full fibre ${fibre} (borough)`].filter(Boolean).join(" · ") : undefined,
    },
    {
      label: "Settled", percentile: settled?.regionPercentile ?? null, higherIsBetter: true, comparative: "more settled",
      fact: settled ? `${sharePercent(settled.share)} at the same address a year on` : undefined,
    },
  ];
}

/** The figures behind the ratings, for the one-tap details: [term, value] pairs, unknowns left out. */
export function homeFigures(home: AreaHomeResponse | null): [string, string][] {
  const rows: [string, string | null][] = [];
  const extend = home?.extend;
  if (extend) {
    rows.push(["Conservation area", sharePercent(extend.conservationShare) && `${sharePercent(extend.conservationShare)} of land`]);
    rows.push(["Article 4 (householder)", extend.article4Data === "not-published"
      ? `Not published by ${home?.borough?.name ?? "the borough"}`
      : sharePercent(extend.article4Share) && `${sharePercent(extend.article4Share)} of land`]);
    rows.push(["Listed buildings", `${extend.listed.total.toLocaleString("en-GB")}`
      + (extend.listed.total ? ` (I: ${extend.listed.gradeI}, II*: ${extend.listed.gradeIIStar}, II: ${extend.listed.gradeII})` : "")]);
    rows.push(["Protected, London", sharePercent(extend.regionShare)]);
  }
  const broadband = home?.broadband;
  if (broadband) {
    rows.push(["Gigabit available", sharePercent(broadband.share) && `${sharePercent(broadband.share)} of ${broadband.premises.toLocaleString("en-GB")} homes`]);
    rows.push(["Gigabit, London", sharePercent(broadband.regionShare)]);
    rows.push([`Full fibre, ${home?.borough?.name ?? "borough"}`, sharePercent(broadband.boroughFullFibreShare)]);
  }
  const settled = home?.settled;
  if (settled) {
    rows.push(["Same address a year on", sharePercent(settled.share)]);
    rows.push(["Same address, London", sharePercent(settled.regionShare)]);
  }
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}
