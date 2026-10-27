/**
 * Area evidence for the postcode page's charts: the neighbourhood's and the
 * borough's yearly price medians (trend lines), £/m² for the neighbourhood,
 * borough and its region (comparison bars), and the "living here" facts
 * (station walk, schools, flood, crime, food hygiene, noise). Demo mode
 * reads the fixtures; real mode the evidence API. Every part is optional:
 * a missing source leaves its tile or line out, never a zero.
 */
import { cache } from "react";

import { areaFacts, LONDON, type AreaFacts, type AreaIndex } from "@/lib/area-pages";
import { loadAreaPages, loadAreaProfile } from "@/lib/area-pages-data";
import type { AreaProfileResponse, AreaSummary, GeographyId, MetricId } from "@/lib/contracts";
import { friendlyTitle } from "@/lib/area-labels";
import { fetchApi, serverArea } from "@/lib/deployment";
import { getAreaSummary, getMetric } from "@/lib/fixtures";
import type { AreaFloodResponse } from "@/lib/flood-risk";
import { fixtureAreaFlood } from "@/lib/flood-risk-fixture";
import type { AreaMarketResponse } from "@/lib/market";
import { fixtureAreaMarket } from "@/lib/market-fixture";
import type { DataMode } from "@/lib/map-state";
import type { AreaPlacesResponse } from "@/lib/places";
import { fixtureAreaPlaces } from "@/lib/places-fixture";
import { fixtureAreaRents, type AreaRentsResponse } from "@/lib/area-rents";

export interface AreaRef { id: GeographyId; name: string }

/**
 * The neighbourhood's friendly name ("Barnsbury West · N1") and the bare
 * neighbourhood name ("Barnsbury West", which its wider MSOA shares); null
 * when the area has none, so the caller falls back to the official name.
 */
export const loadAreaFriendly = cache(async (id: GeographyId): Promise<{ title: string; name: string } | null> => {
  const { friendly } = await serverArea(id);
  const title = friendlyTitle(friendly);
  return title && friendly.friendlyName ? { title, name: friendly.friendlyName.trim() } : null;
});

/** What to call a market's basis. A market widened to the MSOA shares the neighbourhood name ("Barnsbury West"), never "Islington 019". */
export function marketBasisName(friendly: { title: string; name: string } | null, market: AreaMarketResponse | null): string | null {
  if (!friendly || !market?.basis) return market?.basis?.name ?? null;
  const { basis } = market;
  return basis.carrier === "lsoa" ? friendly.title : basis.carrier === "msoa" ? friendly.name : basis.name;
}

/** One area's recorded sales by type (the home page's "Prices in this area today"), null when not available. */
export const loadAreaMarket = cache(async (mode: DataMode, id: GeographyId): Promise<{ market: AreaMarketResponse; name: string | null } | null> => {
  const [friendly, market] = await Promise.all([
    loadAreaFriendly(id),
    mode === "demo" ? fixtureAreaMarket(id) : real<AreaMarketResponse>(path(id, "/market-by-type")),
  ]);
  return market?.available ? { market, name: marketBasisName(friendly, market) } : null;
});

export interface PostcodeAreaContext {
  area: AreaRef;
  borough: AreaRef | null;
  areaMarket: AreaMarketResponse | null;
  /** What to call the area market's basis: the friendly name, or its official one without it. */
  areaMarketName: string | null;
  boroughMarket: AreaMarketResponse | null;
  /** The area's own region ("London", "North West"): what the third bar compares with; null without its figures. */
  region: string | null;
  /** Typical £/m² (each area's own figure, or the middle of its neighbourhoods) and the month it describes. */
  perSquareMetre: { area: number | null; borough: number | null; region: number | null; period: string | null };
  profile: AreaProfileResponse | null;
  flood: AreaFloodResponse | null;
  places: AreaPlacesResponse | null;
  stationWalk: AreaSummary | null;
  foodHygiene: AreaSummary | null;
  /** The borough's private rents by bedroom count (ONS PIPR); null when not published. */
  rents: AreaRentsResponse | null;
}

const path = (id: GeographyId, rest = "") => `/api/v1/areas/${encodeURIComponent(id)}${rest}`;

async function real<T>(url: string): Promise<T | null> {
  return (await fetchApi<T>(url)).body;
}

function boroughOf(index: AreaIndex | null, id: GeographyId): AreaRef | null {
  for (let area = index?.byId.get(id); area; area = area.parentId ? index?.byId.get(area.parentId) : undefined) {
    if (area.carrier === "lad") return { id: area.geographyId, name: area.name };
  }
  return null;
}

function demoSummary(id: GeographyId, metric: MetricId): AreaSummary | null {
  try {
    return getAreaSummary(id, metric, getMetric(metric).defaultPeriod);
  } catch {
    return null;
  }
}

async function realSummaries(id: GeographyId, metrics: MetricId[]): Promise<(AreaSummary | null)[]> {
  const listed = await real<{ metrics: { id: string; defaultPeriod?: string }[] }>("/api/v1/metrics");
  return Promise.all(metrics.map(async (metric) => {
    const period = listed?.metrics.find((entry) => entry.id === metric)?.defaultPeriod;
    if (!period) return null;
    const body = await real<{ summary: AreaSummary }>(`${path(id)}?metric=${metric}&period=${encodeURIComponent(period)}`);
    return body?.summary ?? null;
  }));
}

/**
 * The area's own region's facts, named ("London", "North West"): loadAreaPages(id) loads the area's region, whose
 * root areaFacts(index, LONDON) is. A postcode in Manchester compares with the North West, never with London.
 */
export function regionFacts(index: AreaIndex | null): AreaFacts | null {
  return index ? areaFacts(index, LONDON) : null;
}

/** Once per request: the page's two streamed parts (charts, "living here") share it. */
export const loadPostcodeAreaContext = cache(async (mode: DataMode, id: GeographyId, areaName: string | null): Promise<PostcodeAreaContext> => {
  const pages = await loadAreaPages(id);
  const index = pages?.index ?? null;
  const borough = boroughOf(index, id);
  const facts = (target: GeographyId | typeof LONDON) => (index ? areaFacts(index, target) : null);
  const demo = mode === "demo";
  const [friendly, areaMarket, boroughMarket, profile, flood, places, summaries, rents] = await Promise.all([
    loadAreaFriendly(id),
    demo ? fixtureAreaMarket(id) : real<AreaMarketResponse>(path(id, "/market-by-type")),
    borough ? (demo ? fixtureAreaMarket(borough.id) : real<AreaMarketResponse>(path(borough.id, "/market-by-type"))) : null,
    pages ? loadAreaProfile(pages, id) : null,
    demo ? fixtureAreaFlood(id, null) : real<AreaFloodResponse>(path(id, "/flood")),
    demo ? fixtureAreaPlaces(id, null) : real<AreaPlacesResponse>(path(id, "/places")),
    demo ? (["station-access", "food-hygiene"] as const).map((metric) => demoSummary(id, metric))
      : realSummaries(id, ["station-access", "food-hygiene"]),
    demo ? fixtureAreaRents(id) : real<AreaRentsResponse>(path(id, "/rents")),
  ]);
  const own = facts(id);
  const region = regionFacts(index);
  return {
    area: { id, name: friendly?.title ?? areaName ?? own?.name ?? id.split(":").at(-1)! },
    areaMarketName: marketBasisName(friendly, areaMarket),
    borough,
    areaMarket: areaMarket?.available ? areaMarket : null,
    boroughMarket: boroughMarket?.available ? boroughMarket : null,
    region: region?.name ?? null,
    perSquareMetre: {
      area: own?.price?.value ?? null,
      borough: borough ? facts(borough.id)?.price?.value ?? null : null,
      region: region?.price?.value ?? null,
      period: own?.price?.period ?? region?.price?.period ?? null,
    },
    profile,
    flood: flood?.available ? flood : null,
    places: places?.available ? places : null,
    stationWalk: summaries[0]?.value != null ? summaries[0] : null,
    foodHygiene: summaries[1]?.value != null ? summaries[1] : null,
    rents: rents?.available ? rents : null,
  };
});
