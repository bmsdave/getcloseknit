/** Every /guide/<slug> article. Help texts link only to these. */
export const GUIDE_SLUGS = [
  "reading-the-map",
  "home-cost",
  "price-per-m2",
  "price-trend",
  "sold-prices",
  "stock-value",
  "typical-price",
  "crime",
  "deprivation",
  "income",
  "social-renting",
  "schools",
  "schools-101",
  "noise",
  "clean-air",
  "flood",
  "nature",
  "planning",
  "people-and-homes",
  "getting-around",
  "local-government",
  "local-market",
  "energy-rating",
  "stamp-duty",
  "mortgage-rates",
  "buy-to-let",
  "your-match",
  "demo-vs-real",
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

export function guidePath(slug: GuideSlug): string {
  return `/guide/${slug}`;
}
