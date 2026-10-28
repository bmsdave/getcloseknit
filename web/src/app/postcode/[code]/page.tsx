import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache, Suspense } from "react";

import { AskingPriceCheck } from "@/components/asking-price-check";
import { HomesHere } from "@/components/homes-here";
import { PostcodeHomesHere } from "@/components/postcode-homes-here";
import { PostcodePhotos } from "@/components/postcode-photos";
import { PostcodeSalesChart } from "@/components/postcode-sales-chart";
import { SaveItemButton } from "@/components/save-item-button";
import { WatchListings } from "@/components/watch-listings";
import { Breadcrumbs, WhatsNext } from "@/components/entity-nav";
import { BreadcrumbData } from "@/components/breadcrumb-data";
import { retryLaterForCrawlers, unavailablePage } from "@/components/unavailable-page";
import { loadAreaTrail } from "@/lib/area-pages-data";
import { londonOnlyWords, outsideLondon } from "@/lib/coverage-reason";
import { LONDON_SCOPE, regionScope, scopeName } from "@/lib/scope-name";
import { areaCrumbs, upLinks, type Crumb } from "@/lib/entity-nav";
import { HomesMixPanel, LivingHere, PostcodeComparison, PostcodeHero, PostcodeSources, postcodeAskingBasis, postcodeSummaryLine } from "@/components/postcode-visuals";
import { DemoNotice, findLikeHref } from "@/components/property-profile";
import type { GeographyId } from "@/lib/contracts";
import { serverPostcode } from "@/lib/deployment";
import { formatPounds } from "@/lib/evidence-format";
import type { DataMode } from "@/lib/map-state";
import { formatDay, formatMonth } from "@/lib/market";
import { formatMoney } from "@/lib/money-format";
import { distinctDisclaimers, groupByBuilding, type BuildingGroup } from "@/lib/postcode-groups";
import { postcodeFromParam, postcodeHomesState, postcodeSlug, rentTableWords } from "@/lib/postcode-page";
import { sectorOfPostcode, sectorPath } from "@/lib/sector";
import {
  dominantType, homesMix, marketTrend, postcodeSummary, salePoints,
  type PostcodeSummary, type SalePoint, type TrendLine,
} from "@/lib/postcode-visuals";
import { postcodeHomesPath } from "@/lib/property-profile";
import type { PostcodeHome } from "@/lib/property-profile";
import { RENT_BEDROOM_LABELS, type AreaRentsResponse } from "@/lib/area-rents";
import { parseSearchedHome } from "@/lib/searched-home";
import { streetHomePath } from "@/lib/street-home";
import { areaPath } from "@/lib/area-pages";
import { addressJsonLd, areaCard, NOT_FOUND_METADATA, pageMetadata, siteOrigin } from "@/lib/seo";

import { loadAreaFriendly, loadPostcodeAreaContext } from "./area-context";
import "./postcode.css";
import { SiteHeader } from "@/components/site-header";

interface PostcodePageProps {
  params: Promise<{ code: string }>;
  /** ?address= when an old street-search link opened this page for a home with no recorded sale. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Buildings shown before "Show all": the rest fold away. */
const FIRST_BUILDINGS = 5;
/** A street address (a house number first) can be a street-level home; anything else is ignored. */
const STARTS_WITH_NUMBER = /^\d/;

/** One read per request, shared by the metadata and the page. */
const loadPostcode = cache(serverPostcode);

/**
 * The postcode's neighbourhood by the name people use ("Barnsbury West"), else the API's. Never with the
 * neighbourhood's own district ("· LS16" beside LS6 3QS): the postcode already says where it is.
 */
async function postcodeArea(page: Awaited<ReturnType<typeof serverPostcode>>): Promise<string | null> {
  const friendly = page.geography ? await loadAreaFriendly(page.geography) : null;
  return friendly?.name ?? page.areaName;
}

// The title names the postcode and its area, the preview is the area's card, and an
// unknown postcode is a 404 with its own title.
export async function generateMetadata({ params }: PostcodePageProps): Promise<Metadata> {
  const postcode = postcodeFromParam((await params).code);
  if (!postcode) return NOT_FOUND_METADATA;
  const page = await loadPostcode(postcode);
  if (!page.geography && page.addresses.length === 0) return NOT_FOUND_METADATA;
  const area = await postcodeArea(page);
  // The postcode first, in the words people search with ("W5 1AA house prices", "flood risk W5 1AA").
  return pageMetadata({
    title: `${postcode} house prices${area ? `, ${area}` : ""}`,
    description: `${postcode}${area ? `, ${area}` : ""}: sold house prices and the homes here, ` +
      "with flood risk, crime, schools and stations nearby. Achieved prices, not valuations.",
    path: `/postcode/${postcodeSlug(postcode)}`,
    image: areaCard(page.geography),
  });
}

// Permanent postcode page. Server-rendered so people and agents get the
// numbers without the map: the headline (last sale, an honest typical price)
// and the homes mix come straight from the postcode's recorded sales and
// homes; the sales chart, the area comparison and "living here" stream in
// once the area evidence arrives. Every sale stays below, grouped by
// building (five, then "Show all"). One caveat line at the top, one Sources
// fold at the foot.
export default async function PostcodePage({ params, searchParams }: PostcodePageProps) {
  const postcode = postcodeFromParam((await params).code);
  if (!postcode) notFound();
  // Old street-search links (?address=120+Meadvale+Road&near=…) now live at the street-level home.
  const searched = parseSearchedHome(await searchParams);
  if (searched && STARTS_WITH_NUMBER.test(searched.address)) permanentRedirect(streetHomePath(postcode, searched.address));
  const page = await loadPostcode(postcode);
  // A refused or failed read is "try again" (a 500 for a crawler), never a 404 for a real postcode; a crawler
  // never gets the page without its sales either.
  if (page.unavailable && page.addresses.length === 0) {
    if (!page.geography) return unavailablePage(page.unavailable, "postcode");
    await retryLaterForCrawlers(page.unavailable, "postcode");
  }
  if (!page.geography && page.addresses.length === 0) notFound();
  const [friendly, trail] = page.geography
    ? await Promise.all([loadAreaFriendly(page.geography), loadAreaTrail(page.geography)])
    : [null, []];
  // The neighbourhood's friendly name ("Barnsbury West"), never "Islington 019E (LSOA …)" nor another district.
  const areaName = friendly?.name ?? page.areaName;
  // Region first (London when unknown, as the crumbs): London-only data says so elsewhere, never a dead link.
  const region = scopeName(regionScope(trail[0]?.regionCode));
  const inLondon = region === LONDON_SCOPE.name;
  // Every home's page needs the postcode's homes list (London's addresses for now); without it no link goes there.
  const homesState = postcodeHomesState(page.homes, inLondon);
  const homesListed = homesState === "listed";
  const groups = groupByBuilding(page.histories, postcode);
  const summary = postcodeSummary(page.histories, page.homes);
  const sales = salePoints(page.histories, page.homes);
  const lastSaleAddress = summary.lastSale
    ? page.histories.find((history) => history.addressId === summary.lastSale?.addressId)?.displayAddress ?? null
    : null;
  const homes = page.homes ?? [];
  const disclaimers = distinctDisclaimers(page.histories);
  const hero = { summary, postcode, lastSaleAddress };
  const summaryLine = postcodeSummaryLine(summary);
  const perHomeLondonOnly = outsideLondon(trail[0]?.regionCode);
  // London › borough › area › this postcode.
  const crumbs: Crumb[] = [
    ...(page.geography ? areaCrumbs(trail, friendly?.name ?? page.areaName) : [{ label: "London", href: "/area/london" }]),
    { label: postcode, href: null },
  ];
  const origin = await siteOrigin();
  const centre = page.addresses[0]?.center ?? null;
  const mapHref = page.geography ? postcodeMapHref(page.geography, page.mode, page.release) : null;
  const ld = origin ? addressJsonLd(origin, {
    type: "Place", name: postcode, path: `/postcode/${postcodeSlug(postcode)}`, postcode,
    latitude: centre ? centre[1] : null, longitude: centre ? centre[0] : null,
    area: page.geography && areaName ? { name: areaName, path: areaPath({ geographyId: page.geography }) } : null,
    region,
  }) : null;
  return (
    <main className="methodology postcode-page" data-testid="postcode-page">
      <SiteHeader />
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />}
      <Breadcrumbs crumbs={crumbs} />
      <BreadcrumbData crumbs={crumbs} path={`/postcode/${postcodeSlug(postcode)}`} />
      {/* r3 #31 (CUJ02 step 2): On map, Watch and ♡ by the title; no "Postcode" eyebrow (the crumbs say it). */}
      <div className="postcode-title">
        <h1>{postcode}</h1>
        <PostcodeActions postcode={postcode} mapHref={mapHref} centre={centre && (centre[0] !== 0 || centre[1] !== 0) ? centre : null} />
      </div>
      <SectorChip postcode={postcode} />
      <DemoNotice mode={page.mode} />
      {summaryLine && <p className="postcode-summary" data-testid="postcode-summary">{summaryLine}</p>}
      {/* The homes first, in the phone's first screen (board CUJ-02 step 2); the figures follow. */}
      <PostcodeHomesHere postcode={postcode} homes={homes}
        mapQuery={page.geography ? new URLSearchParams({ selected: page.geography, mode: page.mode }).toString() : null} />
      {sales.length > 0 && (page.geography ? (
        <Suspense fallback={<PostcodeHero {...hero} />}>
          <HeroWithArea geography={page.geography} areaName={areaName} mode={page.mode} hero={hero} />
        </Suspense>
      ) : <PostcodeHero {...hero} />)}
      <p className="methodology-intro postcode-intro">
        {introSentence(page.histories.length, groups.length, summary, areaName)}
      </p>
      {page.histories.length > 0 && (
        <p className="quality-note postcode-disclaimer" data-testid="postcode-disclaimer">
          Achieved sale prices from HM Land Registry, not valuations or asking prices.
        </p>
      )}
      {page.geography && mapHref && (
        <AreaLinks geography={page.geography} crumbs={crumbs} mapHref={mapHref} postcode={postcode}
          homes={homesState} />
      )}
      {page.geography ? (
        <Suspense fallback={sales.length > 0 ? <InsightsSkeleton /> : null}>
          <PostcodeInsights geography={page.geography} areaName={areaName} mode={page.mode}
            postcode={postcode} summary={summary} sales={sales} homes={homes} />
        </Suspense>
      ) : sales.length > 0 && (
        <section className="postcode-panel" aria-labelledby="postcode-chart-title">
          <PostcodeSalesChart postcode={postcode} sales={sales} lines={[]} caption={longRunCaption(summary)} />
        </section>
      )}
      {homes.length > 0 ? (
        <HomesMixPanel mix={homesMix(homes)} postcode={postcode} homesHref={postcodeHomesPath(postcode)} />
      ) : homesListed && page.histories.length > 0 && (
        <p className="panel-links"><Link href={postcodeHomesPath(postcode)} data-testid="postcode-homes-link">Every home in {postcode}: type, size, energy rating</Link></p>
      )}
      {page.geography && (
        <Suspense fallback={null}>
          <PostcodeLiving geography={page.geography} areaName={areaName} mode={page.mode} homes={homes} region={region} />
        </Suspense>
      )}
      {page.mode === "real" && (
        <Suspense fallback={null}>
          <PostcodePhotos postcode={postcode} />
        </Suspense>
      )}
      {groups.length > 0 && (
        <section className="postcode-sales" aria-labelledby="postcode-sales-title">
          <div className="postcode-section-head">
            <h2 id="postcode-sales-title">Every recorded sale</h2>
            <span className="metric-description">
              {page.histories.length} {page.histories.length === 1 ? "address" : "addresses"}
              {groups.length < page.histories.length && <> in {groups.length} {groups.length === 1 ? "building" : "buildings"}</>}
            </span>
          </div>
          {groups.slice(0, FIRST_BUILDINGS).map((group) => <BuildingCard key={group.key} group={group} />)}
          {groups.length > FIRST_BUILDINGS && (
            <details className="postcode-more" data-testid="postcode-show-all">
              <summary>
                <span className="postcode-more__closed">Show all {groups.length}</span>
                <span className="postcode-more__open">Show fewer</span>
              </summary>
              {groups.slice(FIRST_BUILDINGS).map((group) => <BuildingCard key={group.key} group={group} />)}
            </details>
          )}
        </section>
      )}
      {/* Per-home data is London's alone (FLAGS.md CLOSE_KNIT_ENGLAND): elsewhere one notice and the portals' searches. */}
      {page.histories.length === 0 && (perHomeLondonOnly ? (
        <section className="methodology-card" data-testid="per-home-london-only"><p>{londonOnlyWords("Individual homes")}</p></section>
      ) : (
        <section className="methodology-card"><p>No recorded sales are published for this postcode yet.</p></section>
      ))}
      {perHomeLondonOnly && page.geography && (
        <HomesHere geographyId={page.geography} from="postcode_page" outcodes={[postcode.split(" ")[0]]} />
      )}
      <PostcodeSources disclaimers={disclaimers} london={inLondon} />
      <p className="quality-note" data-testid="postcode-privacy-note">
        Public-record data (HM Land Registry Price Paid; energy certificate facts about the building, never the occupant).
        Wrong, or your home? {homesListed
          ? <>Use <Link href={postcodeHomesPath(postcode)}>Report or hide this home</Link> beside it in the list of homes, or read</>
          : "Read"} the <Link href="/privacy">privacy notice</Link>.
      </p>
    </main>
  );
}

/** "Sector W5 1": the postcode's sector page (£/m² range, index since 2004, nearby sectors, streets). */
function SectorChip({ postcode }: { postcode: string }) {
  const sector = sectorOfPostcode(postcode);
  if (!sector) return null;
  return <Link className="sector-chip" href={sectorPath(sector)} data-testid="postcode-sector-link">Sector {sector}</Link>;
}

function introSentence(addresses: number, buildings: number, summary: PostcodeSummary, areaName: string | null): string {
  if (summary.sales === 0) return `No recorded sales here yet${areaName ? `; it sits in ${areaName}` : ""}.`;
  const where = buildings > 0 && buildings < addresses ? ` in ${buildings} ${buildings === 1 ? "building" : "buildings"}` : "";
  return `${addresses} ${addresses === 1 ? "address" : "addresses"} with recorded sales${where}${areaName ? `, in ${areaName}` : ""}.`;
}

/** "Middle of all 16 sales, 1996–2022: £250k": the long-run figure, said under the chart. */
function longRunCaption(summary: PostcodeSummary): string | null {
  const figure = summary.longRun;
  if (!figure || figure.count < 2) return null;
  const years = figure.fromYear === figure.toYear ? `${figure.fromYear}` : `${figure.fromYear}–${figure.toYear}`;
  return `Middle of all ${figure.count} sales here, ${years}: ${formatMoney(figure.value)}.`;
}

const areaHref = (geography: GeographyId) => {
  const [, carrier, code] = geography.split(":");
  return `/area/${carrier}/${code}`;
};

/** The headline with the area's typical price now beside the postcode's own figures. */
async function HeroWithArea({ geography, areaName, mode, hero }: {
  geography: GeographyId; areaName: string | null; mode: DataMode;
  hero: { summary: PostcodeSummary; postcode: string; lastSaleAddress: string | null };
}) {
  const context = await loadPostcodeAreaContext(mode, geography, areaName);
  const typicalPrice = context.areaMarket?.summary?.medianPrice ?? null;
  return <PostcodeHero {...hero} area={{ name: context.areaMarketName ?? context.area.name, typicalPrice }} />;
}

/** The parts that need the area's evidence: sales over time with area lines and the comparison. */
async function PostcodeInsights({ geography, areaName, mode, postcode, summary, sales, homes }: {
  geography: GeographyId; areaName: string | null; mode: DataMode; postcode: string;
  summary: PostcodeSummary; sales: SalePoint[]; homes: PostcodeHome[];
}) {
  const context = await loadPostcodeAreaContext(mode, geography, areaName);
  const type = dominantType(homes);
  const marketName = context.areaMarketName ?? context.area.name;
  const lines = [
    marketTrend(context.areaMarket, "price", type, `${marketName} median`, "area"),
    marketTrend(context.boroughMarket, "price", type, `${context.borough?.name ?? "Borough"} median`, "borough"),
  ].filter((line): line is TrendLine => line !== null);
  const window = context.areaMarket?.window ?? null;
  return (
    <>
      {sales.length > 0 && (
        <section className="postcode-panel" aria-labelledby="postcode-chart-title">
          <PostcodeSalesChart postcode={postcode} sales={sales} totalSales={summary.sales} caption={longRunCaption(summary)}
            lines={lines} />
        </section>
      )}
      {sales.length > 0 && (
        <PostcodeComparison figures={{
          postcode,
          // A middle of flats and houses together describes neither: no postcode bar then.
          postcodePrice: summary.blended ? null : summary.typicalPrice,
          area: {
            name: context.area.name, perSquareMetre: context.perSquareMetre.area,
            medianPrice: context.areaMarket?.summary?.medianPrice ?? null,
            marketName: context.areaMarket?.basis?.widened && marketName !== context.area.name ? marketName : null,
          },
          borough: context.borough ? {
            name: context.borough.name, perSquareMetre: context.perSquareMetre.borough,
            medianPrice: context.boroughMarket?.summary?.medianPrice ?? null,
          } : null,
          region: context.region ? { name: context.region, perSquareMetre: context.perSquareMetre.region } : null,
          period: context.perSquareMetre.period ? formatMonth(context.perSquareMetre.period) : null,
          marketWindow: window ? `${formatMonth(window.start)} to ${formatMonth(window.end)}` : null,
        }} />
      )}
      <AskingPriceCheck className="postcode-panel" basis={postcodeAskingBasis(summary, marketName, context.areaMarket?.summary ?? null)} />
    </>
  );
}

/** The chart and comparison panels as quiet blocks of their own size while the area evidence loads. */
function InsightsSkeleton() {
  return (
    <div aria-busy="true" data-testid="postcode-insights-loading">
      <div className="postcode-panel postcode-skeleton postcode-skeleton--chart" />
      <div className="postcode-panel postcode-skeleton postcode-skeleton--compare" />
      <p className="sr-only" role="status">Loading the area comparison…</p>
    </div>
  );
}

/** "Living here": the area card's essentials, below the homes mix, then the borough's rents. */
async function PostcodeLiving({ geography, areaName, mode, homes, region }: {
  geography: GeographyId; areaName: string | null; mode: DataMode; homes: PostcodeHome[]; region: string;
}) {
  const context = await loadPostcodeAreaContext(mode, geography, areaName);
  return (
    <>
      <LivingHere facts={{
        // The neighbourhood's own name, never its district ("· LS16" beside LS6 3QS).
        areaHref: areaHref(geography), areaName: areaName ?? context.area.name,
        stationWalk: context.stationWalk, places: context.places, profile: context.profile,
        flood: context.flood, homes, foodHygiene: context.foodHygiene, region: context.region,
      }} />
      {context.rents && <BoroughRents rents={context.rents} region={region} />}
    </>
  );
}

/**
 * The borough's (council's) average private rents by bedroom count, with its region's (`region`: London, North West, …;
 * the API's regionMonthlyRent is the area's own region): never one home's rent.
 */
function BoroughRents({ rents, region }: { rents: AreaRentsResponse; region: string }) {
  const { name, unit } = rentTableWords(rents.borough?.name, region);
  return (
    <section className="postcode-panel" data-testid="postcode-rents" aria-labelledby="postcode-rents-title">
      <h2 id="postcode-rents-title">Private rents in {name}</h2>
      <div className="property-table-wrap" tabIndex={0} role="region" aria-label={`Private rents in ${name}`}>
        <table className="sales-table">
          <caption className="sr-only">Average monthly private rent in {name} and {region}</caption>
          <thead><tr><th>Home</th><th>{name}, a month</th><th>{region}, a month</th></tr></thead>
          <tbody>
            {rents.rents.map((rent) => (
              <tr key={rent.bedrooms}>
                <th scope="row">{RENT_BEDROOM_LABELS[rent.bedrooms]}</th>
                <td>{formatPounds(rent.monthlyRent)}</td>
                <td>{rent.regionMonthlyRent === null ? "—" : formatPounds(rent.regionMonthlyRent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="quality-note">
        Average rent of new and existing private tenancies across the whole {unit}
        {rents.period ? `, ${formatMonth(rents.period)}` : ""}. ONS Price Index of Private Rents.
      </p>
    </section>
  );
}

/** The map on the postcode's area, in the page's data mode and release. */
function postcodeMapHref(geography: GeographyId, mode: string, release: string | undefined): string {
  const query = new URLSearchParams({ selected: geography, mode });
  if (release) query.set("release", release);
  return `/?${query.toString()}`;
}

/**
 * The title row's actions (CUJ02 step 2): On map, Watch and ♡. ♡ keeps the postcode in Saved › Places
 * (a saved place with its page and its pin), on this device only.
 */
function PostcodeActions({ postcode, mapHref, centre }: { postcode: string; mapHref: string | null; centre: [number, number] | null }) {
  const slug = postcodeSlug(postcode);
  return (
    <div className="postcode-title__actions" role="group" aria-label={`Next steps for ${postcode}`} data-testid="postcode-actions">
      {mapHref && <a className="area-full__primary" href={mapHref} data-testid="postcode-on-map">On map</a>}
      <WatchListings place={postcode} className="area-save-actions__button" label="Watch" />
      <SaveItemButton testId="postcode-save" item={{
        kind: "place", id: `postcode:${slug}`, name: postcode, meta: "Postcode", href: `/postcode/${slug}`, ...(centre ? { at: centre } : {}),
      }} />
    </div>
  );
}

/**
 * What's next from a postcode: up to its area, in to its homes, the map and Like this (Watch and ♡ are by the title).
 * `homes`: the homes list exists ("listed"), or not: outside London a notice, as the map's (DESIGN.md §6), never a 404.
 */
function AreaLinks({ geography, crumbs, mapHref, postcode, homes }: {
  geography: GeographyId; crumbs: readonly Crumb[]; mapHref: string; postcode: string; homes: ReturnType<typeof postcodeHomesState>;
}) {
  return (
    <WhatsNext testId="postcode-area" columns={{
      up: upLinks(crumbs).map((link, index) => (index === 0 ? { ...link, testId: "postcode-area-link" } : link)),
      inside: [
        homes === "listed" && { label: `Homes in ${postcode}`, href: postcodeHomesPath(postcode), testId: "next-homes" },
        homes === "london-only" && {
          key: "homes", node: <span className="metric-description" data-testid="next-homes-london-only">Home pages: London only</span>,
        },
      ],
      nearby: [
        { label: "On map", href: mapHref, reload: true },
        // The one "Like this" (My match, starting from this area).
        { label: "Like this", href: findLikeHref(geography), testId: "postcode-find-like", reload: true },
      ],
    }} />
  );
}

/**
 * One building: its homes' sales in one table. Columns with no figure for
 * any sale here are left out. Every building starts folded: the charts above
 * carry the overview, these rows are the record. Prices are exact.
 */
function BuildingCard({ group }: { group: BuildingGroup }) {
  const several = group.homes > 1;
  return (
    <details className="methodology-card address-card building-card" data-testid="postcode-building">
      <summary>
        <h3>{group.title}</h3>
        <span className="metric-description">{group.summary}</span>
      </summary>
      <div className="property-table-wrap" tabIndex={0} role="region" aria-label={`Sales at ${group.title}`}>
        <table className="sales-table">
          <caption className="sr-only">Recorded sales at {group.title}</caption>
          <thead>
            <tr>
              {several && <th>Home</th>}
              <th>Date</th>
              <th>Price</th>
              {group.hasFloorArea && <th>Floor area</th>}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={`${row.addressId}-${row.sale.date}-${row.sale.nominalPrice}`} data-testid="postcode-sale">
                {several && row.first && <th scope="row" rowSpan={row.span}>{row.home}</th>}
                <td>{formatDay(row.sale.date)}</td>
                <td>{formatPounds(row.sale.nominalPrice)}</td>
                {group.hasFloorArea && (
                  <td>{row.sale.floorAreaSquareMetres === null ? "—" : `${row.sale.floorAreaSquareMetres} m²`}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
