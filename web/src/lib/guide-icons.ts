import type { GuideSlug } from "./guide-slugs";

/** The plied-yarn icon (lib/thread-icons.ts) for each guide article's card. */
export const GUIDE_ICONS: Record<GuideSlug, string> = {
  "reading-the-map": "layers",
  "home-cost": "home",
  "price-per-m2": "fact-floor-area",
  "price-trend": "trend",
  "sold-prices": "key",
  "stock-value": "fact-built-form",
  "typical-price": "home",
  crime: "crime",
  deprivation: "people",
  income: "income",
  "social-renting": "fact-tenure",
  schools: "school",
  "schools-101": "book",
  noise: "noise",
  "clean-air": "heart",
  flood: "flood",
  nature: "tree",
  planning: "planning",
  "people-and-homes": "family",
  "getting-around": "tube",
  "local-government": "building-school",
  "local-market": "place-shop",
  "energy-rating": "star",
  "stamp-duty": "note",
  "mortgage-rates": "fact-floor",
  "buy-to-let": "fact-built",
  "your-match": "heart",
  "demo-vs-real": "swap",
};

/** One yarn per index group, so a section's icons read as one skein. */
export const GUIDE_GROUP_YARN: Record<string, string> = {
  "Reading the map": "var(--yarn-cobalt)",
  Prices: "var(--yarn-cherry)",
  "Living here": "var(--yarn-tangerine)",
  "Buying a home": "var(--yarn-sky)",
  "Your match": "var(--yarn-pink)",
  "The data": "var(--yarn-cobalt)",
};
