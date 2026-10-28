/**
 * Link previews and search readiness: the public origin, canonical + OpenGraph metadata per page, and
 * schema.org JSON-LD. Pages are indexed only when the site is public (`searchIndexable`): private previews stay
 * noindex (layout.tsx, and the X-Robots-Tag header in deploy/access-private.caddy). Per-address pages index like the rest; a hidden home 404s.
 * Pure helpers stay unit-testable (tests/seo.test.ts); only `siteOrigin` reads the request.
 */
import type { Metadata } from "next";

import { AGENT_TABS, agentPath } from "./agents";
import { CHANGELOG_PATH, CHANGELOG_RSS_PATH, changelogPath } from "./changelog";
import { valueLine } from "./coverage-words";
import { areaPath, LONDON, RANKINGS, type RankingDefinition } from "./area-pages";
import type { GeographyId } from "./contracts";
import { GUIDE_SLUGS, guidePath } from "./guide-slugs";
import { LONDON_REGION, regionSlug, type RankScope } from "./scope-name";
import { postcodeSlug } from "./postcode-page";
import { sectorPath, sectorSlug } from "./sector";
import { TOOLS } from "./tools";

export const SITE_NAME = "Close Knit";
/** The default title and description (layout.tsx), mirrored by the site card: the value line (lib/coverage-words). */
export function siteTitle(england = false): string {
  const line = valueLine(england);
  return `${SITE_NAME}: ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}
export function siteDescription(england = false): string {
  return `${valueLine(england)}. Free and open: ` +
    "every figure sourced from HM Land Registry, police.uk, Ofsted and other public records; nothing here is paid placement.";
}/** The site card (app/opengraph-image.tsx); pages without a card of their own point at it. */
export const SITE_CARD = "/opengraph-image";

/** A neighbourhood's link-preview card (app/area/[carrier]/[code]/opengraph-image.tsx): homes, postcodes and schools in it share it. */
export function areaCard(geographyId: string | null | undefined): string {
  const match = /^uk:lsoa:(E\d{8})$/.exec(geographyId ?? "");
  return match ? `/area/lsoa/${match[1]}/opengraph-image` : SITE_CARD;
}

/** Every 404's title and description: never the home page's. Next adds the noindex itself. */
export const NOT_FOUND_METADATA: Metadata = {
  title: "Page not found",
  description: "This page is not on Close Knit. Search for a postcode, street or area, or go back to the map.",
};

interface HeaderSource { get(name: string): string | null }

/**
 * The public origin: CLOSE_KNIT_PUBLIC_URL when set, else the origin the request came in on (behind
 * Caddy, its forwarded host and scheme). Never a local address baked in; null with neither.
 */
export function publicOrigin(configured: string | undefined, request: HeaderSource | null): string | null {
  const fixed = configured?.trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = first(request?.get("x-forwarded-host")) ?? first(request?.get("host"));
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const protocol = first(request?.get("x-forwarded-proto")) ?? (local ? "http" : "https");
  return `${protocol}://${host}`;
}

function first(value: string | null | undefined): string | null {
  const head = value?.split(",")[0].trim();
  return head ? head : null;
}

/**
 * Whether search engines may list the site: only with CLOSE_KNIT_ACCESS=public set explicitly for the web
 * container (deploy/docker-compose.yml passes it, default private). Unset (local, tests) stays noindex.
 */
export function searchIndexable(access: string | undefined = process.env.CLOSE_KNIT_ACCESS): boolean {
  return access?.trim() === "public";
}

type Robots = NonNullable<Metadata["robots"]>;

/**
 * The layout's meta robots: none when public (indexable is the default, and a 404 then carries only Next's own
 * noindex, never "index, follow" beside it); noindex, nofollow on a private preview.
 */
export function siteRobots(indexable: boolean): Robots | undefined {
  return indexable ? undefined : { index: false, follow: false };
}

/**
 * Crawl traps a public site keeps crawlers out of: map states on the home page (/?selected=…&layer=…, one per area
 * and layer, every one canonical to /) and the /go/ click-outs (redirects off the site, one per link and page).
 */
export const CRAWL_TRAPS: readonly string[] = ["/?", "/go/"];

/** robots.txt: the API and MCP stay out; a public site lists its sitemap index and keeps out of CRAWL_TRAPS, a private one keeps pages crawlable so the noindex is seen. */
export function robotsRules(origin: string | null, indexable: boolean): { rules: { userAgent: string; allow: string; disallow: string[] }; sitemap?: string } {
  const rules = { userAgent: "*", allow: "/", disallow: ["/api/", "/mcp", ...(indexable ? CRAWL_TRAPS : [])] };
  return indexable && origin ? { rules, sitemap: `${origin}${SITEMAP_INDEX}` } : { rules };
}

/** The origin for this request (server components, metadata, sitemap, OG images). */
export async function siteOrigin(): Promise<string | null> {
  let request: HeaderSource | null = null;
  try {
    const { headers } = await import("next/headers");
    request = await headers();
  } catch {
    // Outside a request (build, unit tests): only the configured URL.
  }
  return publicOrigin(process.env.CLOSE_KNIT_PUBLIC_URL, request);
}

/** A page title with the site name once: the layout's template adds it, so a title already naming it stays as it is. */
export function fullTitle(title: string): string {
  return title.includes("Close Knit") ? title : `${title} · ${SITE_NAME}`;
}

/** What a search result shows before it cuts a title or a description off. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;

/** The page's <title>: with the site name when that still fits TITLE_MAX, else the page's own words alone. */
export function searchTitle(title: string): string {
  const titled = fullTitle(title);
  return titled.length <= TITLE_MAX ? titled : title;
}

/** A meta description within DESCRIPTION_MAX: whole sentences while they fit, else cut at a word with an ellipsis. */
export function searchDescription(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= DESCRIPTION_MAX) return clean;
  let kept = "";
  for (const sentence of clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? []) {
    if ((kept + sentence).trim().length > DESCRIPTION_MAX) break;
    kept += sentence;
  }
  if (kept.trim().length >= 70) return kept.trim();
  const cut = clean.slice(0, DESCRIPTION_MAX - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:·–-]+$/, "")}…`;
}

/** The home page's <title> and description: the value line (lib/coverage-words), short enough for a search result. */
export function homeTitle(): string {
  return `${SITE_NAME}: what homes sold for, areas that fit your budget`;
}
export function homeDescription(england = false): string {
  return `${valueLine(england)}. Free, from HM Land Registry, police.uk, Ofsted and other public records.`;
}

type AreaCarrier = "lad" | "msoa" | "lsoa";

/**
 * An area page's title, place first, in the words people search with ("Lambeth house prices", "crime rate"):
 * "Lambeth, London: house prices, crime and schools". A local authority names its region (several share a
 * name with a town elsewhere); a neighbourhood's name already carries its district ("Clapham South · SW4").
 */
export function areaSearchTitle(name: string, carrier: AreaCarrier, region: string): string {
  return `${carrier === "lad" ? `${name}, ${region}` : name}: house prices, crime and schools`;
}

/** An area page's description, place first: what the page answers ("is it a good place to live?"), and its price when known. */
export function areaSearchDescription(name: string, carrier: AreaCarrier, region: string, price?: string | null): string {
  const where = carrier === "lad" ? `${name}, ${region}` : name;
  const what = carrier === "lad"
    ? "house prices, crime, schools, deprivation and income, and every area inside it"
    : "house prices, crime, schools, transport and green space";
  const full = `${where}: is it a good place to live?${price ? ` Typical price ${price}.` : ""} See ${what}.`;
  // A long name keeps what the page holds over the question.
  return searchDescription(full.length <= DESCRIPTION_MAX ? full : `${where}: ${what}.`);
}

interface PageMetadataInput {
  title: string;
  description: string;
  /** The canonical path ("/rankings"), resolved against metadataBase. */
  path: string;
  /** The card for og:image; null where the segment has its own opengraph-image file. */
  image?: string | null;
}

/** Canonical and OpenGraph (Twitter copies it) for one page; the title names the site once. */
export function pageMetadata({ title, description: text, path, image = SITE_CARD }: PageMetadataInput): Metadata {
  const titled = searchTitle(title);
  const description = searchDescription(text);
  return {
    // The layout's template adds the site name; a title that names it already, or has no room for it, is absolute.
    title: titled !== title ? title : { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website", siteName: SITE_NAME, locale: "en_GB", url: path, title: titled, description,
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: titled }] } : {}),
    },
  };
}

/** pageMetadata for /changelog pages, with the feed's autodiscovery <link rel="alternate" type="application/rss+xml">. */
export function changelogMetadata(input: PageMetadataInput): Metadata {
  const metadata = pageMetadata(input);
  return {
    ...metadata,
    alternates: { ...metadata.alternates, types: { "application/rss+xml": [{ url: CHANGELOG_RSS_PATH, title: "Close Knit changelog" }] } },
  };
}

/** Every permanent page for the sitemap: fixed pages, guide (glossary included), tools, rankings (school ones
 *  included when shown), every area with each neighbourhood's Places and evidence pack, every school with
 *  evidence (`schools`: URNs; a school with no result or inspection is noindex) and every postcode sector
 *  (`sectors`: codes, "W5 1") and the changelog with each entry (`changelog`: slugs). Per-address pages are too many for one file: homeSitemapPaths, per sector. */
export function sitemapPaths(
  areas: readonly { geographyId: GeographyId }[],
  rankings: readonly RankingDefinition[] = RANKINGS.filter((ranking) => ranking.kind === "metric"),
  schools: readonly string[] = [],
  sectors: readonly string[] = [],
  changelog: readonly string[] = [],
  /** Each council's schools list (/schools?borough=lambeth): its own canonical page, "schools in Lambeth". */
  schoolBoroughs: readonly string[] = [],
): string[] {
  return [
    "/", "/about", CHANGELOG_PATH, ...changelog.map((slug) => changelogPath(slug)), ...AGENT_TABS.map((tab) => agentPath(tab.slug)), "/guide", "/guide/glossary", ...GUIDE_SLUGS.map((slug) => guidePath(slug)),
    "/tools", ...TOOLS.map((tool) => `/tools/${tool.slug}`),
    "/privacy", "/terms",
    // The rankings with a page (area-pages.ts › availableRankings): a lens with an empty pack is left out.
    areaPath(LONDON), "/area/england", "/rankings", ...rankings.map((ranking) => `/rankings/${ranking.slug}`),
    // The schools hub (Menu v5), and each council's list on it (self-canonical, app/schools/page.tsx).
    "/schools", ...schoolBoroughs.map((slug) => `/schools?borough=${encodeURIComponent(slug)}`),
    ...areaSitemapPaths(areas),
    ...schools.map((urn) => `/school/${urn}`),
    ...sectors.map((code) => sectorPath(code)),
  ];
}

/** Every area's page, with each neighbourhood's Places and evidence pack (3 per LSOA). */
export function areaSitemapPaths(areas: readonly { geographyId: GeographyId }[]): string[] {
  return areas.flatMap((area) => {
    const path = areaPath(area);
    return area.geographyId.startsWith("uk:lsoa:") ? [path, `${path}/places`, `${path}/pack`] : [path];
  });
}

/** Google's limit per sitemap file; every shard stays under it. */
export const SITEMAP_LIMIT = 50_000;

/**
 * The shards beside /sitemap.xml (fixed pages, London's areas, schools): postcode sectors, then one per other
 * English region the data serves (/area/sitemap/north-west.xml), each region's pages well under SITEMAP_LIMIT
 * (the largest, South East, ≈ 19,000). England would be ≈ 120,000 URLs in one file.
 */
export function areaSitemapIds(regions: readonly RankScope[]): string[] {
  return ["sectors", ...regions.filter((region) => region.code !== LONDON_REGION).map(regionSlug)];
}

/** One area shard: /area/sitemap/north-west.xml. */
export function areaSitemapPath(id: string): string {
  return `/area/sitemap/${id}.xml`;
}

/** The sitemap index robots.txt names: the main sitemap, then one per postcode sector (app/postcode/sitemap.ts). */
export const SITEMAP_INDEX = "/sitemap-index.xml";

/** One sector's shard of the per-address pages: /postcode/sitemap/W5-1.xml. */
export function homeSitemapPath(sectorCode: string): string {
  return `/postcode/sitemap/${sectorSlug(sectorCode)}.xml`;
}

/** Per-address pages: each postcode with its homes list, and each home (`uprns`). The API leaves hidden homes out;
 *  their pages 404, which carries Next's noindex. */
export function homeSitemapPaths(postcodes: readonly string[], uprns: readonly string[]): string[] {
  return [
    ...postcodes.flatMap((postcode) => [`/postcode/${postcodeSlug(postcode)}`, `/postcode/${postcodeSlug(postcode)}/homes`]),
    ...uprns.map((uprn) => `/property/${uprn}`),
  ];
}

/** The day a data release was cut ("rel-202610280650-prices-england" → "2026-10-28"); null for any other id. */
export function releaseDate(releaseId: string | null | undefined): string | null {
  const match = /^rel-(\d{4})(\d{2})(\d{2})/.exec(releaseId ?? "");
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Pages whose figures change with each data release; fixed pages (guide, about, tools) carry no lastmod. */
const DATA_PAGE = /^\/(area|school|schools|rankings|sector|postcode|property)(\/|\?|$)/;

/** Sitemap entries: absolute URLs, and a data page's lastmod the day its release was cut (when known). */
export function sitemapEntries(origin: string, paths: readonly string[], releaseId?: string | null): { url: string; lastModified?: string }[] {
  const modified = releaseDate(releaseId);
  return paths.map((path) => ({ url: `${origin}${path}`, ...(modified && DATA_PAGE.test(path) ? { lastModified: modified } : {}) }));
}

/** sitemaps.org index XML over absolute sitemap URLs. */
export function sitemapIndexXml(urls: readonly string[]): string {
  const escape = (url: string) => url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((url) => `<sitemap><loc>${escape(url)}</loc></sitemap>\n`).join("")
    + "</sitemapindex>\n";
}

// ---- JSON-LD ------------------------------------------------------------------------------------

/** Serialised for a <script type="application/ld+json">: nothing inside can close the script early. */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify({ "@context": "https://schema.org", ...data }).replace(/</g, "\\u003c");
}

/** The home page: the site, and its postcode search as a SearchAction. */
export function websiteJsonLd(origin: string, england = false): string {
  return jsonLd({
    "@type": "WebSite", name: SITE_NAME, url: `${origin}/`, description: siteDescription(england), inLanguage: "en-GB",
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${origin}/postcode/{postcode}` },
      "query-input": "required name=postcode",
    },
  });
}

/** A point worth publishing: inside the UK's bounds, never the 0,0 an unknown centre falls back to. */
export function ukPoint(latitude: number | null | undefined, longitude: number | null | undefined): { latitude: number; longitude: number } | null {
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return latitude >= 49 && latitude <= 61 && longitude >= -9 && longitude <= 2.5 ? { latitude, longitude } : null;
}

function geo(latitude: number | null, longitude: number | null): Record<string, unknown> {
  const point = ukPoint(latitude, longitude);
  return point ? { geo: { "@type": "GeoCoordinates", ...point } } : {};
}

/**
 * schema.org BreadcrumbList mirroring a page's visible crumbs (components/entity-nav.tsx › Breadcrumbs): each step
 * with its page; the last is this page (`path`). Null for a lone crumb.
 */
export function breadcrumbJsonLd(origin: string, crumbs: readonly { label: string; href: string | null }[], path: string): string | null {
  if (crumbs.length < 2) return null;
  return jsonLd({
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem", position: index + 1, name: crumb.label,
      item: `${origin}${index === crumbs.length - 1 ? path : crumb.href ?? path}`,
    })),
  });
}

/** The place an area sits in: London is a City; another English region an AdministrativeArea. */
export function regionPlace(region = "London"): Record<string, string> {
  return region === "London" ? { "@type": "City", name: "London" } : { "@type": "AdministrativeArea", name: region };
}

/** An area page: the place (a local authority's an AdministrativeArea), inside its region (London unless `region` says otherwise). */
export function placeJsonLd(origin: string, area: { name: string; path: string; description: string; region?: string; administrative?: boolean }): string {
  return jsonLd({
    "@type": area.administrative ? "AdministrativeArea" : "Place", name: area.name, url: `${origin}${area.path}`, description: area.description,
    containedInPlace: regionPlace(area.region),
  });
}

/** /school/[urn]: the school by phase (ElementarySchool, HighSchool or School), where it is and its page. No aggregateRating. */
export function schoolJsonLd(origin: string, school: {
  type: "ElementarySchool" | "HighSchool" | "School"; name: string; path: string;
  postcode: string | null; locality: string | null; latitude: number | null; longitude: number | null;
}): string {
  return jsonLd({
    "@type": school.type, name: school.name, url: `${origin}${school.path}`,
    address: {
      "@type": "PostalAddress", addressCountry: "GB",
      ...(school.postcode ? { postalCode: school.postcode } : {}),
      ...(school.locality ? { addressLocality: school.locality } : {}),
    },
    ...geo(school.latitude, school.longitude),
  });
}

/** /area/london: the figures as an open dataset. */
export function datasetJsonLd(origin: string, input: { description: string; period: string | null }): string {
  return jsonLd({
    "@type": "Dataset",
    name: "London area figures: prices, crime, schools and deprivation",
    description: input.description,
    url: `${origin}/area/london`,
    spatialCoverage: { "@type": "Place", name: "London" },
    ...(input.period ? { temporalCoverage: input.period } : {}),
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: SITE_NAME, url: `${origin}/about` },
    license: `${origin}/terms`,
    citation: ["HM Land Registry Price Paid Data", "police.uk", "Ofsted", "English Indices of Deprivation"],
  });
}

/**
 * A home (/property/[uprn], type Residence) or a postcode (/postcode/[code], type Place): its postal
 * address and point, inside its neighbourhood and region (London by default). Never a price or a valuation.
 */
export function addressJsonLd(origin: string, input: {
  type: "Residence" | "Place"; name: string; path: string; postcode: string | null;
  latitude: number | null; longitude: number | null; area: { name: string; path: string } | null; region?: string;
}): string {
  const region = regionPlace(input.region);
  return jsonLd({
    "@type": input.type, name: input.name, url: `${origin}${input.path}`,
    address: {
      "@type": "PostalAddress", addressCountry: "GB", addressRegion: region.name,
      ...(input.postcode ? { postalCode: input.postcode } : {}),
    },
    ...geo(input.latitude, input.longitude),
    containedInPlace: input.area
      ? { "@type": "Place", name: input.area.name, url: `${origin}${input.area.path}`, containedInPlace: region }
      : region,
  });
}
