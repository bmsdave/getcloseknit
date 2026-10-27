import { NATURE_METRIC_IDS } from "./nature-layers";
import { CENSUS_METRIC_IDS } from "./census-layers";
import type { GlossaryTermId } from "./glossary";
import { GUIDE_SLUGS, guidePath, type GuideSlug } from "./guide-slugs";
import type { StandoutTileId } from "./standouts";

/** The guide article that explains each map metric. */
export const METRIC_GUIDE: Record<string, GuideSlug> = {
  "price-per-square-metre": "price-per-m2",
  "stock-value-per-square-metre": "stock-value",
  crime: "crime",
  deprivation: "deprivation",
  income: "income",
  "social-renting": "social-renting",
  "station-access": "getting-around",
  "food-hygiene": "getting-around",
  noise: "noise",
  "road-collisions": "crime",
  "air-no2": "clean-air",
  "typical-price": "typical-price",
  "typical-price-flat": "typical-price",
  "typical-price-terraced": "typical-price",
  "typical-price-semi": "typical-price",
  "typical-price-detached": "typical-price",
  "rent-change-1y": "home-cost",
  "rent-change-5y": "home-cost",
  "council-tax-band-mean": "local-government",
  "personal-match": "your-match",
  "hpi-change-5y": "local-market",
  "hpi-change-10y": "local-market",
  "pipeline-homes-per-1000": "planning",
  ...Object.fromEntries(CENSUS_METRIC_IDS.map((id) => [id, "people-and-homes" as const])),
  ...Object.fromEntries(NATURE_METRIC_IDS.map((id) => [id, "nature" as const])),
  "ownership-company-share": "local-market",
  "ownership-overseas-share": "local-market",
  "short-lets-per-1000": "local-market",
  "mobile-4g-indoor": "people-and-homes",
  "mobile-5g-outdoor": "people-and-homes",
  "future-station-distance": "getting-around",
  "hmo-per-1000": "people-and-homes",
  // Layers v5 PR 3 (migration 100).
  "typical-rent": "home-cost",
  "typical-rent-1-bed": "home-cost",
  "typical-rent-3-bed": "home-cost",
  "flood-risk": "flood",
  "good-schools-nearby": "schools",
  "good-schools-nearby-secondary": "schools",
  "student-share": "people-and-homes",
  // Layers v5 PR 3 batch 2 (migration 101).
  "supermarket-walk": "getting-around",
  "gp-walk": "getting-around",
  "broadband-gigabit": "people-and-homes",
};

/** Where a metric's "Read more" link goes; the guide index when unknown. */
export function metricGuidePath(metricId: string): string {
  return Object.hasOwn(METRIC_GUIDE, metricId) ? guidePath(METRIC_GUIDE[metricId]) : "/guide";
}

/**
 * Anchors of the retired /methodology page. /methodology redirects to
 * /guide and the fragment survives, so /guide sends these on to an article.
 */
export const LEGACY_ANCHORS: Record<string, GuideSlug> = {
  ...METRIC_GUIDE,
  "real-data": "demo-vs-real",
  "stock-value": "stock-value",
  "sold-prices": "sold-prices",
};

/** "#real-data" -> "/guide/demo-vs-real"; null for no or an unknown anchor. */
export function legacyAnchorPath(hash: string): string | null {
  const anchor = hash.replace(/^#/, "");
  return Object.hasOwn(LEGACY_ANCHORS, anchor) ? guidePath(LEGACY_ANCHORS[anchor]) : null;
}

/**
 * The map layer an article explains, the reverse of METRIC_GUIDE (the first
 * metric that links to it): "/?layer=crime" for the crime article. Null for
 * topics that have no layer of their own.
 */
export function guideMapPath(slug: GuideSlug): string | null {
  const metricId = Object.keys(METRIC_GUIDE).find((id) => METRIC_GUIDE[id] === slug);
  return metricId ? `/?layer=${encodeURIComponent(metricId)}` : null;
}

/** What an article ends with: its layer on the map, else its tool or another layer, else the map. */
export interface GuideAction {
  href: string;
  label: string;
  /** "map" opens the map; "tool" opens a tool or another page. */
  kind: "map" | "tool";
}

const PRICES_ON_MAP: GuideAction = { href: "/?layer=price-per-square-metre", label: "Prices on the map", kind: "map" };

/** Articles with no layer of their own, or (Home cost) a tool that suits them better. */
const GUIDE_ACTIONS: Partial<Record<GuideSlug, GuideAction>> = {
  "stamp-duty": { href: "/tools/stamp-duty", label: "Stamp duty calculator", kind: "tool" },
  "mortgage-rates": { href: "/tools/mortgage-rates", label: "Mortgage rates", kind: "tool" },
  "buy-to-let": { href: "/tools/investor", label: "Buy-to-let calculator", kind: "tool" },
  "home-cost": { href: "/tools/check-a-home", label: "Check a home", kind: "tool" },
  "sold-prices": PRICES_ON_MAP,
  "price-trend": PRICES_ON_MAP,
  "local-market": PRICES_ON_MAP,
  schools: { href: "/rankings", label: "Rankings", kind: "tool" },
  "schools-101": { href: "/schools", label: "Schools in London", kind: "tool" },
};

/** The "Use it" link that ends every article: a chosen tool first (Home cost keeps Check a home, though Rent change links to it). */
export function guideAction(slug: GuideSlug): GuideAction {
  const chosen = GUIDE_ACTIONS[slug];
  if (chosen) return chosen;
  const mapPath = guideMapPath(slug);
  return mapPath ? { href: mapPath, label: "See this on the map", kind: "map" } : { href: "/", label: "Open the map", kind: "map" };
}

/**
 * The article's "Use it" block (board CUJ-11): after the main action, a second way to use
 * it (a ranking or the next tool). Income and social renting are described, never ranked: no ranking here.
 */
const GUIDE_MORE: Partial<Record<GuideSlug, GuideAction>> = {
  crime: { href: "/rankings/lowest-crime", label: "Safest areas", kind: "tool" },
  deprivation: { href: "/rankings/least-deprived", label: "Least deprived areas", kind: "tool" },
  "price-per-m2": { href: "/rankings/least-expensive", label: "Least expensive areas", kind: "tool" },
  "typical-price": { href: "/rankings/lowest-flat-prices", label: "Lowest flat prices", kind: "tool" },
  "getting-around": { href: "/rankings/closest-to-a-station", label: "Closest to a station", kind: "tool" },
  "stamp-duty": { href: "/tools/check-a-home", label: "Check a home", kind: "tool" },
  "mortgage-rates": { href: "/tools/check-a-home", label: "Check a home", kind: "tool" },
  "buy-to-let": { href: "/tools/stamp-duty", label: "Stamp duty", kind: "tool" },
  "home-cost": { href: "/tools/stamp-duty", label: "Stamp duty", kind: "tool" },
};

export function guideMore(slug: GuideSlug): GuideAction | null {
  return GUIDE_MORE[slug] ?? null;
}

/** The area tile an article's "Your areas" line reads (the saved areas in London words, never x/10); null: no line. */
const GUIDE_TILE = {
  crime: "safety", "price-per-m2": "price", noise: "noise", "clean-air": "air", nature: "nature",
  schools: "schools", "getting-around": "station-walk",
} as const satisfies Partial<Record<GuideSlug, StandoutTileId>>;

export function guideTile(slug: GuideSlug): StandoutTileId | null {
  return Object.hasOwn(GUIDE_TILE, slug) ? GUIDE_TILE[slug as keyof typeof GUIDE_TILE] : null;
}

/** The article after this one in the guide's order, for "Next"; null after the last. */
export function nextGuideSlug(slug: GuideSlug): GuideSlug | null {
  const index = GUIDE_SLUGS.indexOf(slug);
  return index >= 0 && index < GUIDE_SLUGS.length - 1 ? GUIDE_SLUGS[index + 1] : null;
}

/** Glossary terms a guide article explains further; the others link only to GOV.UK. */
export const GLOSSARY_GUIDE: Partial<Record<GlossaryTermId, GuideSlug>> = {
  sdlt: "stamp-duty",
  epc: "energy-rating",
  "council-tax-bands": "local-government",
  "price-paid": "sold-prices",
};
