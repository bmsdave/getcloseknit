import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { AreaPricesCard } from "@/components/area-prices-card";
import { AskingPriceCheck, type AskingBasis } from "@/components/asking-price-check";
import { Breadcrumbs, WhatsNext } from "@/components/entity-nav";
import { HomeCorrectionSection } from "@/components/evidence-panel";
import { HomeInvestorTools } from "@/components/home-investor-tools";
import { HomeMiniMap } from "@/components/home-mini-map";
import { HomeOverview } from "@/components/home-overview";
import { ListingPhotoLinks } from "@/components/listing-photo-links";
import { PostcodePhotos } from "@/components/postcode-photos";
import {
  AreaRangesCard, askingBasis, DemoNotice, FactsCard, HomeTools, homeSummary, NextSteps, OtherHomesCard, SalesCard, ValuationCard,
} from "@/components/property-profile";
import { PropertyShare } from "@/components/property-share";
import { SiteHeader } from "@/components/site-header";
import { SaveHome } from "@/components/user-candidates";
import { WatchListings } from "@/components/watch-listings";
import { contactEmail } from "@/lib/contact";
import type { GeographyId } from "@/lib/contracts";
import { upLinks, type Crumb } from "@/lib/entity-nav";
import { homesFlood, type HomeFloodContext } from "@/lib/flood-risk";
import { listingLinks } from "@/lib/listing-links";
import { DEFAULT_MAP_STATE, withHomeQuery, type DataMode } from "@/lib/map-state";
import { formatMonth, type AreaMarketResponse } from "@/lib/market";
import { cleanAddress } from "@/lib/postcode-groups";
import {
  isWithheld, plainWords, postcodeHomesPath, REPORT_HOME_ANCHOR,
  type PostcodeHome, type PropertyFacts, type PropertyProfile, type Withheld,
} from "@/lib/property-profile";
import { latestRateHint } from "@/lib/rate-hint";
import { areaPriceRanges } from "@/lib/searched-home";
import { streetHomeNote, type StreetHome } from "@/lib/street-home";

/** A home with a UPRN (its profile), or one found at street level with no recorded sale. */
export type HomeData =
  | { kind: "uprn"; profile: PropertyProfile; productReleaseId?: string | null }
  | {
    kind: "street"; street: StreetHome;
    /** The area's recorded sales by type and what to call the area; null when not available. */
    areaMarket?: { market: AreaMarketResponse; name: string | null } | null;
    /** The recorded homes at its postcode; null when the list could not be loaded. */
    otherHomes: PostcodeHome[] | null;
  };

/** A home known only from its energy certificate (CLOSE_KNIT_EPC_ADDRESSES). */
export const EPC_HOME_NOTE = "No recorded sale. Address from its energy certificate.";

/** A street-level home has no record: no type, tenure or certificate. */
const NO_FACTS: PropertyFacts = {
  propertyType: null, tenure: null, newBuildSale: null, epcPropertyType: null, builtForm: null,
  constructionAgeBand: null, floorAreaSquareMetres: null, habitableRooms: null, floorLevel: null,
  energyRating: null, potentialEnergyRating: null, energyCertificateDate: null,
};

/** What both kinds of home share, for the header and the closing rows. */
interface HomeBasics {
  address: string;
  summary: string | null;
  areaId: GeographyId | null;
  areaName: string | null;
  point: { lat: number; lon: number } | null;
  postcode: string | null;
  uprn: string | null;
  withheld: readonly Withheld[] | undefined;
  mapHref: string;
}

/**
 * What a home page knows of flood besides its area's land: the home's own EA bands (a UPRN home), then
 * its postcode's homes' worst. The Overview chip and the Environment row both choose from it.
 */
export function homeFloodContext(home: HomeData): HomeFloodContext {
  if (home.kind === "uprn") {
    const { profile } = home;
    return { own: profile.flood ?? null, postcode: profile.postcode, homes: homesFlood(profile.otherHomes) };
  }
  return { own: null, postcode: home.street.postcode, homes: homesFlood(home.otherHomes ?? []) };
}

function basics(home: HomeData, mode: DataMode): HomeBasics {
  if (home.kind === "uprn") {
    const { profile } = home;
    const lsoa = profile.areas.lsoa.id;
    const [lon, lat] = profile.location;
    return {
      address: cleanAddress(profile.displayAddress), summary: homeSummary(profile), areaId: lsoa,
      // The name people use ("Peckham Rye Common"), never the official "Southwark 028".
      areaName: profile.areas.lsoa.displayName && profile.areas.lsoa.displayName !== profile.areas.lsoa.name
        ? profile.areas.lsoa.displayName.split(" · ")[0] : null,
      point: { lat, lon }, postcode: profile.postcode,
      uprn: profile.uprn, withheld: profile.withheld,
      // The map opens on this home, not just its area (?uprn=…&address=…).
      mapHref: `/?${withHomeQuery(new URLSearchParams({ selected: lsoa, mode }).toString(), { uprn: profile.uprn, addressId: profile.addressId })}`,
    };
  }
  const { street } = home;
  const areaId = street.areaId as GeographyId | null;
  return {
    address: street.label, summary: null, areaId, areaName: null, point: street.point, postcode: street.postcode,
    uprn: null, withheld: street.withheld,
    mapHref: areaId ? `/?${new URLSearchParams({ selected: areaId, mode }).toString()}` : "/",
  };
}

/**
 * Every home's page, for /property/{uprn} and /property/at/{postcode}/{house}: the header
 * (address, breadcrumbs, mini map, outbound links and actions), then the price, the home, its
 * recorded sales and the other homes at its postcode. A street-level home has no sale or record,
 * so its blocks fall back to the area's prices by type and "No recorded sale". Nothing here says
 * what a home is worth (owner decision).
 */
export function HomePage({ home, mode, release, crumbs = [], areaSections = null }: {
  home: HomeData; mode: DataMode;
  /** The home's area sections, after block 5 (AreaSectionsForHome, or HomeAreaSections on a street-level home). */
  areaSections?: ReactNode;
  /** The map release the mini map paints (the deployment's default; the map's own default when unset). */
  release: string | undefined;
  /** London › borough › area › postcode › this home. */
  crumbs?: readonly Crumb[];
}) {
  const view = basics(home, mode);
  const [, carrier, code] = view.areaId?.split(":") ?? [];
  const listings = view.postcode ? listingLinks(view.postcode) : null;
  const lastSale = home.kind === "uprn" ? home.profile.sales.at(-1) ?? null : null;
  const lastPrice = lastSale?.price ?? null;
  return (
    <main className="property-page home-page" data-testid="property-page">
      <SiteHeader />
      <header className="home-head" data-testid="home-header">
        <Breadcrumbs crumbs={crumbs} />
        <h1>{view.address}</h1>
        {view.summary && <p className="property-summary" data-testid="property-summary">{view.summary}</p>}
        <DemoNotice mode={mode} />
        {/* r3 #28 (CUJ02 board step 3): one primary (Check this home), Stamp duty, Watch and ♡ (the one save);
            the map, Share, Report and the area page sit in ⋯. */}
        <nav className="property-actions" aria-label="Page links">
          <HomeTools areaId={view.areaId} uprn={view.uprn} sale={lastSale} address={view.address} />
          <WatchListings place={view.postcode ?? view.address} className="property-button" label="Watch" />
          <SaveHome address={view.address} uprn={view.uprn} geographyId={view.areaId} heart />
          <details className="property-more" data-testid="property-more">
            <summary className="property-button" aria-label="More">⋯</summary>
            <div className="property-more__menu">
              <Link href={view.mapHref} data-testid="property-map-link">On map</Link>
              <PropertyShare title={view.address} className="property-more__item" />
              <a href={`#${REPORT_HOME_ANCHOR}`} data-testid="property-report-link">Report or hide this home</a>
              {view.areaId && <Link href={`/area/${carrier}/${code}`} data-testid="property-area-link">Area page</Link>}
            </div>
          </details>
        </nav>
      </header>
      <div className="home-block" data-testid="home-price">
        {home.kind === "uprn" ? <UprnPrices profile={home.profile} /> : <StreetPrices home={home} />}
        {listings && <ListingPhotoLinks links={listings} testId="property-listings" className="property-card" heading="h2" />}
        <AskingPriceCheck basis={home.kind === "uprn" ? askingBasis(home.profile) : streetAskingBasis(home.areaMarket?.market ?? null)}
          className="property-card" />
      </div>
      {/* One mini map: after the price on phones, so the price stays in the first screen (owner ruling);
          from 760px the page grid lifts it beside the header (property.css › .home-page). */}
      {(view.point || view.areaId) && (
        <HomeMiniMap point={view.point} geographyId={view.areaId} mode={mode} release={release ?? DEFAULT_MAP_STATE.release} />
      )}
      <div className="home-block" data-testid="home-facts">
        <FactsCard facts={home.kind === "uprn" ? home.profile.facts : NO_FACTS} withheld={view.withheld} noRecord={home.kind === "street"} />
      </div>
      <div className="home-block" data-testid="home-sales">
        <SalesCard sales={home.kind === "uprn" ? home.profile.sales : []} withheld={view.withheld}
          change={home.kind === "uprn" ? home.profile.salesSummary?.changeSinceLastSale : null}
          propertyType={home.kind === "uprn" ? home.profile.facts.propertyType : null}
          none={home.kind === "street"
            ? <p data-testid="street-home-note">{streetHomeNote(home.street)}</p>
            : home.profile.addressSource === "epc"
              ? <p data-testid="epc-home-note">{EPC_HOME_NOTE}</p> : undefined} />
      </div>
      <div className="home-block" data-testid="home-other-homes">
        <OtherHomesCard postcode={view.postcode}
          homes={home.kind === "uprn" ? home.profile.otherHomes : home.otherHomes} />
      </div>
      {/* Block 6: the area's layers as rating tiles and band chips (seeded on a UPRN page, read in the browser on a street one). */}
      {view.areaId && <HomeOverview geographyId={view.areaId} mode={mode} flood={homeFloodContext(home)} />}
      {/* Blocks 7–16: the area's sections (the route chooses how they load). */}
      {areaSections && <div className="home-area" data-testid="home-area-sections">{areaSections}</div>}
      {/* Tools, folded, after the area's Living costs: the investor calculator (the only calculator on this page). */}
      <HomeInvestorTools areaId={view.areaId} mode={mode} price={lastPrice} address={view.address} rateHint={latestRateHint()} />
      <NextSteps areaId={view.areaId} areaName={view.areaName} uprn={view.uprn} address={view.address} />
      {/* Next steps above are this home's actions; this block is where to go from it. */}
      <WhatsNext columns={{
        up: upLinks(crumbs),
        nearby: [
          view.postcode && { label: `Homes in ${view.postcode}`, href: postcodeHomesPath(view.postcode), testId: "next-homes" },
          { label: "On map", href: view.mapHref, reload: true },
        ],
      }} />
      {/* Block 17: photos nearby, then sources and the privacy note (the postcode page's photos, real mode only). */}
      {mode === "real" && view.postcode && (
        <Suspense fallback={null}>
          <PostcodePhotos postcode={view.postcode} testId="home-photos" />
        </Suspense>
      )}
      <FinePrint home={home} />
    </main>
  );
}

/**
 * The model estimate while `valuation` is not withheld; otherwise today's area prices (the fallback).
 * A payload from before the field (no `valuation` key) also gets the fallback.
 */
function UprnPrices({ profile }: { profile: PropertyProfile }) {
  return isWithheld(profile.withheld, "valuation") || profile.valuation === undefined
    ? <AreaPricesCard prices={profile.areaPrices} />
    : <ValuationCard valuation={profile.valuation ?? null} propertyType={profile.facts.propertyType} />;
}

function StreetPrices({ home }: { home: Extract<HomeData, { kind: "street" }> }) {
  const market = home.areaMarket?.market ?? null;
  return <AreaRangesCard ranges={areaPriceRanges(market)} name={home.areaMarket?.name ?? null} window={market?.window ?? null} />;
}

/**
 * A street-level home's type is not known, so the asking price is set against the middle half of
 * every recorded sale in the area (all types), never a figure for the home.
 */
export function streetAskingBasis(market: AreaMarketResponse | null): AskingBasis {
  const all = market?.summary;
  const window = market?.window;
  const band = all && all.p25 !== null && all.p75 !== null
    ? { p25: all.p25, p75: all.p75, per: "price" as const, what: `sales here${window ? `, ${formatMonth(window.start)} to ${formatMonth(window.end)}` : ""}` }
    : null;
  return { reference: null, band };
}

/** Caveats, sources and the report-or-hide form. A street-level home has no record to hide. */
function FinePrint({ home }: { home: HomeData }) {
  if (home.kind === "uprn") {
    const { profile } = home;
    return (
      <section className="property-card property-card--fine" data-testid="home-sources">
        <ul>{profile.caveats.map((caveat) => <li key={caveat}>{plainWords(caveat)}</li>)}</ul>
        <p>
          Public-record data: HM Land Registry Price Paid (OGL v3.0) and Energy Performance Certificates, MHCLG
          (OGL v3.0).
        </p>
        <HomeCorrectionSection anchor={REPORT_HOME_ANCHOR} uprn={profile.uprn} addressId={profile.addressId} contact={contactEmail()}
          sourceReleaseId={profile.sourceVersion} productReleaseId={home.productReleaseId ?? null} />
      </section>
    );
  }
  const contact = contactEmail();
  return (
    <section className="property-card property-card--fine" data-testid="home-sources">
      <p>
        Street from OS Open Names: contains OS data © Crown copyright and database right (OGL v3.0). Area sales: HM Land
        Registry Price Paid (OGL v3.0).
      </p>
      <section className="home-correction" data-testid="home-correction" id={REPORT_HOME_ANCHOR}>
        <p className="quality-note" data-testid="home-privacy-note">
          We hold no record of this home, only its street. To have it hidden, write to <a href={`mailto:${contact}`}>{contact}</a>.
        </p>
      </section>
    </section>
  );
}
