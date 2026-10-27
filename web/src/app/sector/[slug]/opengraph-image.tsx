import { connection } from "next/server";

import { serverSector } from "@/lib/deployment";
import { formatMonth } from "@/lib/market";
import { formatPerArea } from "@/lib/money-format";
import { CARD_SIZE, CARD_TYPE, cardNotFound, renderCard } from "@/lib/og-card";
import { formatRate, sectorFromParam, sectorHeadline, sectorTitle } from "@/lib/sector";

// The sector's link preview: its name, median £/m² and last year's real change, from the
// same source as the page. A sector the page would 404 on 404s here too.
export const alt = "A postcode sector on Close Knit: its median price per square metre";
export const size = CARD_SIZE;
export const contentType = CARD_TYPE;

interface CardProps { params: Promise<{ slug: string }> }

export default async function SectorCard({ params }: CardProps) {
  await connection();
  const parsed = sectorFromParam((await params).slug);
  if (!parsed) return cardNotFound();
  const { mode, sector: value } = await serverSector(parsed.slug);
  if (!value) return cardNotFound();
  const headline = sectorHeadline(value);
  return renderCard({
    eyebrow: `Postcode sector${value.sector.borough ? ` in ${value.sector.borough.name}` : ""}`,
    title: sectorTitle(value.sector),
    figure: headline.median !== null ? formatPerArea(headline.median) : null,
    aside: headline.realChange !== null ? `${formatRate(headline.realChange)} last year, after inflation` : null,
    source: `Sold prices: HM Land Registry · floor areas: EPC${headline.periodEnd ? ` · to ${formatMonth(headline.periodEnd)}` : ""}`,
    demo: mode !== "real",
  });
}
