import { connection } from "next/server";

import { valueLine } from "@/lib/coverage-words";
import { serverCoversEngland, serverDefaults } from "@/lib/deployment";
import { CARD_SIZE, CARD_TYPE, renderCard } from "@/lib/og-card";

// The site card: every page without its own card, and every shared match link (its hash is
// invisible to link previews, so the card never carries anyone's search). Its words follow the coverage.
export const alt = "Close Knit: what homes really sold for, area by area";
export const size = CARD_SIZE;
export const contentType = CARD_TYPE;

export default async function SiteCard() {
  await connection();
  const [{ mode }, england] = await Promise.all([serverDefaults(), serverCoversEngland()]);
  return renderCard({
    eyebrow: england ? "England, area by area" : "London, area by area",
    title: valueLine(england),
    source: "Free and open · HM Land Registry, police.uk, Ofsted · no paid placement",
    demo: (mode ?? "demo") !== "real",
  });
}
