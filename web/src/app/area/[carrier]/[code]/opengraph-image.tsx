import { connection } from "next/server";

import { areaTitle, friendlyTitle } from "@/lib/area-labels";
import { formatPerSquareMetre, indexScopeName, listPrice, monthLabel } from "@/lib/area-pages";
import { loadAreaPages, loadAreaTrail } from "@/lib/area-pages-data";
import { regionScope, scopeName } from "@/lib/scope-name";
import type { AreaSummary, GeographyId, Carrier } from "@/lib/contracts";
import { fetchApi, serverArea } from "@/lib/deployment";
import { getPriceTimeline } from "@/lib/fixtures";
import { CARD_SIZE, CARD_TYPE, cardNotFound, renderCard } from "@/lib/og-card";
import { periodYearsBefore, priceChange } from "@/lib/price-change";

// The area's link preview (and its places and pack pages'): its name, typical £/m² and the 5-year
// change, from the same source as the page. An area the page would 404 on 404s here too.
export const alt = "An area on Close Knit: its typical price per square metre";
export const size = CARD_SIZE;
export const contentType = CARD_TYPE;

const TREND_YEARS = 5;
const SOURCE = "Sold prices: HM Land Registry · floor areas: EPC";

interface CardProps { params: Promise<{ carrier: string; code: string }> }

export default async function AreaCard({ params }: CardProps) {
  await connection();
  const { carrier, code } = await params;
  if (!/^(lsoa|msoa|lad)$/.test(carrier) || !/^E\d{8}$/.test(code)) return cardNotFound();
  const geography: GeographyId = `uk:${carrier as Carrier}:${code}`;
  return carrier === "lsoa" ? neighbourhoodCard(geography) : guideCard(geography);
}

/** A neighbourhood: the summary the full area page shows, and its own price history. */
async function neighbourhoodCard(geography: GeographyId) {
  const area = await serverArea(geography);
  if (!area.known || !area.summary) return cardNotFound();
  const name = areaTitle(area.summary.name, area.friendly).title ?? "Neighbourhood";
  const value = area.summary.value;
  const [trend, trail] = await Promise.all([fiveYearChange(geography, area.summary, area.mode === "real"), loadAreaTrail(geography)]);
  return renderCard({
    eyebrow: `Neighbourhood in ${scopeName(regionScope(trail[0]?.regionCode))}`,
    title: name,
    figure: value != null ? formatPerSquareMetre(value) : null,
    aside: trend,
    source: `${SOURCE} · ${monthLabel(area.summary.period)}`,
    demo: area.mode !== "real",
  });
}

/** A borough or MSOA: the guide page's typical figure (the middle of its neighbourhoods). */
async function guideCard(geography: GeographyId) {
  const loaded = await loadAreaPages(geography);
  const area = loaded?.index.byId.get(geography);
  if (!loaded || !area || area.carrier === "lsoa") return cardNotFound();
  const price = listPrice(loaded.index, area);
  const region = indexScopeName(loaded.index);
  return renderCard({
    eyebrow: area.carrier === "lad" ? (region === "London" ? "London borough" : `Local authority in ${region}`) : `Neighbourhood group in ${region}`,
    title: friendlyTitle(area) ?? area.name,
    figure: price ? formatPerSquareMetre(price.value) : null,
    aside: price ? "typical, the middle of its neighbourhoods" : null,
    source: `${SOURCE} · ${monthLabel(loaded.index.data.periods["price-per-square-metre"] ?? null)}`,
    demo: loaded.mode !== "real",
  });
}

/** "+12.3% in 5 years", or null when either end is missing (never a guessed 0%). */
async function fiveYearChange(geography: GeographyId, latest: AreaSummary, real: boolean): Promise<string | null> {
  let timeline: AreaSummary[];
  if (!real) {
    timeline = getPriceTimeline(geography).filter((entry) => entry.period <= latest.period);
  } else {
    const base = periodYearsBefore(latest.period, TREND_YEARS);
    const earlier = base ? await fetchApi<{ summary: AreaSummary }>(
      `/api/v1/areas/${encodeURIComponent(geography)}?metric=price-per-square-metre&period=${base}`) : null;
    timeline = earlier?.body?.summary ? [earlier.body.summary, latest] : [latest];
  }
  const change = priceChange(timeline, TREND_YEARS);
  if (!change) return null;
  const sign = change.percent > 0 ? "+" : change.percent < 0 ? "−" : "";
  return `${sign}${Math.abs(change.percent).toFixed(1)}% in ${TREND_YEARS} years`;
}
