import Link from "next/link";
import type { ReactNode } from "react";

import type { AskingBasis } from "@/components/asking-price-check";
import { BandScale, ChartIcon, type ChartTone } from "@/components/charts";
import { HelpTip } from "@/components/help-tip";
import { SiteHeader } from "@/components/site-header";
import { SaveHome } from "@/components/user-candidates";
import { WatchListings } from "@/components/watch-listings";
import { Term } from "@/components/term";
import { isCodeName } from "@/lib/area-labels";
import { withHomeQuery, type DataMode } from "@/lib/map-state";
import { formatDay, formatMonth } from "@/lib/market";
import { formatMoney } from "@/lib/money-format";
import { checkHomeHref, datedSalePrefill, toolHref } from "@/lib/tools";
import {
  UNKNOWN,
  VALUATION_WORDING,
  changeSinceLastSaleLine,
  factRows,
  isWithheld,
  EPC_WITHHELD_COPY,
  floorArea,
  homeKey,
  monthYear,
  plainWords,
  postcodeHomesPath,
  pounds,
  propertyPath,
  reportHomePath,
  signedPercent,
  typePlural,
  type ChangeSinceLastSale,
  type PostcodeHome,
  type PropertyFacts,
  type ProfileSale,
  type ProfileValuation,
  type PropertyProfile,
  type Withheld,
} from "@/lib/property-profile";
import { Breadcrumbs, WhatsNext } from "@/components/entity-nav";
import { upLinks, type Crumb } from "@/lib/entity-nav";
import type { GeographyId } from "@/lib/contracts";
import type { AreaPriceRange } from "@/lib/searched-home";

export function DemoNotice({ mode }: { mode: DataMode }) {
  if (mode !== "demo") return null;
  return <p className="property-notice property-notice--demo">Demo data · not for decisions <HelpTip id="demo-data" /></p>;
}

/** A link to the full property page, for the map's Property tab. */
export function PropertyProfileLink({ uprn }: { uprn: string }) {
  return <Link className="property-link" href={propertyPath(uprn)} data-testid="property-profile-link">Full property page</Link>;
}

const HOME_KINDS: Record<string, string> = {
  "Flat or maisonette": "flat or maisonette",
  Terraced: "terraced house",
  "Semi-detached": "semi-detached house",
  Detached: "detached house",
};

/**
 * One plain sentence under the address: what the home is, where, and its last
 * recorded sale ("A leasehold flat or maisonette of 54 m² in Westminster, last
 * sold for £570,000 in November 2022."). Recorded facts only, never an estimate.
 */
export function homeSummary(profile: PropertyProfile): string {
  const { facts } = profile;
  const kind = HOME_KINDS[facts.propertyType ?? ""] ?? "home";
  const tenure = facts.tenure ? `${facts.tenure.toLowerCase()} ` : "";
  const words = `${tenure}${kind}`;
  const size = facts.floorAreaSquareMetres ? ` of ${Math.round(facts.floorAreaSquareMetres)}\u00a0m²` : "";
  const place = placeName(profile);
  const last = profile.sales.at(-1);
  const sold = last
    ? `last sold for ${pounds(last.price)} in ${new Date(last.date).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`
    : "with no recorded sale";
  return `${/^[aeiou]/.test(words) ? "An" : "A"} ${words}${size}${place ? ` in ${place}` : ""}, ${sold}.`;
}

/**
 * Where the home is, by name: its neighbourhood's friendly name ("Peckham Rye Common"),
 * else its borough; never an official code like "Southwark 028".
 */
export function placeName(profile: Pick<PropertyProfile, "areas">): string | null {
  const { lsoa, msoa, borough } = profile.areas;
  for (const area of [msoa, lsoa]) {
    const name = area?.displayName?.split(" · ")[0]?.trim();
    if (name && !isCodeName(name, area?.id)) return name;
  }
  const own = borough?.displayName ?? borough?.name ?? null;
  return own && !isCodeName(own, borough?.id) ? own : null;
}

/** Find my area, started from an area (cross-lane contract 1). Nothing is saved until the reader finishes. */
export function findLikeHref(geographyId: string): string {
  const [, carrier, code] = geographyId.split(":");
  return `/?find=like&area=${encodeURIComponent(`${carrier}:${code}`)}`;
}

/**
 * Check this home and stamp duty, the first of the header's actions, both at
 * the last recorded sale when it is dated, the year beside the
 * price and the month carried into the tool; with no dated sale
 * they open bare and the tools show their example price.
 */
export function HomeTools({ areaId, uprn, sale, address }: {
  areaId: GeographyId | null; uprn: string | null; sale: { price: number; date: string | null } | null; address: string;
}) {
  const prefill = datedSalePrefill(sale, address);
  const priced = prefill.price == null || !prefill.sold ? "" : ` · ${formatMoney(prefill.price)} · ${prefill.sold.slice(0, 4)}`;
  // r3 #28 (CUJ02 board step 3): Check this home is the page's one primary action, Stamp duty beside it.
  return (
    <>
      <Link className="property-button property-button--primary" data-testid="next-check-home"
        href={checkHomeHref({ area: areaId ?? undefined, uprn, ...prefill })}>Check this home{priced}</Link>
      <Link className="property-button" href={toolHref("stamp-duty", prefill)} data-testid="next-stamp-duty">Stamp duty</Link>
    </>
  );
}

/** The page's closing row: where to go from one home. Watch new listings is in the header, not repeated here. */
export function NextSteps({ areaId, areaName, uprn, address }: {
  areaId: GeographyId | null; areaName: string | null; uprn: string | null; address: string;
}) {
  return (
    <section className="next-steps" data-testid="property-next-steps" aria-labelledby="next-steps-heading">
      <h2 id="next-steps-heading">Next steps</h2>
      <ul className="next-steps__list">
        {areaId && (
          <li>
            <Link className="property-button" href={findLikeHref(areaId)} data-testid="next-compare-area">Like this</Link>
            <p>My match, starting from {areaName ?? "this neighbourhood"}</p>
          </li>
        )}
        <li>
          <SaveHome address={address} uprn={uprn} geographyId={areaId} label="Add to my brief" testId="next-save-home" />
          <p>Saved on this device with your asking price</p>
        </li>
      </ul>
    </section>
  );
}

/** "flat sales here", "terraced sales here": how the asking-price check names the area range. */
const RANGE_WHAT: Record<string, string> = {
  "Flat or maisonette": "flat sales here", Terraced: "terraced sales here",
  "Semi-detached": "semi-detached sales here", Detached: "detached sales here",
};

/**
 * What the asking-price check sets a listing against: the latest recorded
 * sale as recorded (a fact, with its date) and the middle half of same-type
 * sales in the area today. Never a figure for this home, and no per-home
 * floor area.
 */
export function askingBasis(profile: PropertyProfile): AskingBasis {
  const latest = profile.sales.at(-1) ?? null;
  const range = profile.areaPrices.range;
  const what = RANGE_WHAT[profile.areaPrices.propertyType ?? ""] ?? "sales here";
  return {
    reference: latest ? { price: latest.price, words: `this home's last recorded sale (${formatMoney(latest.price)}, ${formatDay(latest.date)})` } : null,
    band: range ? { p25: range.p25, p75: range.p75, per: "price", what: `${what}, adjusted to ${monthYear(range.adjustedTo)}` } : null,
  };
}

const ENERGY_BANDS = (["A", "B", "C", "D", "E", "F", "G"] as const).map((band, index) => ({
  id: band, label: band, tone: (["good", "good", "c3", "c5", "c2", "bad", "bad"] as const)[index] as ChartTone,
}));

/** Thread glyphs for the facts grid (lib/thread-icons.ts, "fact-…"). */
const FACT_ICONS: Record<string, string> = {
  "Built form": "fact-built-form",
  Tenure: "fact-tenure",
  Built: "fact-built",
  "Floor area": "fact-floor-area",
  "Habitable rooms": "fact-habitable-rooms",
  Floor: "fact-floor",
};

function FactIcon({ label }: { label: string }) {
  return <ChartIcon name={FACT_ICONS[label] ?? "home"} />;
}

/** Energy certificate's current and potential band, A–G; "Unknown" text when there is no certificate. */
export function EnergyBands({ current, potential, date }: { current: string | null; potential: string | null; date: string | null }) {
  return (
    <div className="energy-bands" data-testid="property-energy">
      <h3>Energy rating</h3>
      <BandScale bands={ENERGY_BANDS} current={current} potential={potential} label="Energy rating" />
      {current && <small>Certificate {date ? formatDay(date) : "date unknown"}</small>}
    </div>
  );
}

/**
 * About the home: type and tenure always; certificate facts unless `epc` is withheld ("Not shown per home yet").
 * `noRecord` (a street-level home): type and tenure only, with no size or energy rows at all.
 */
export function FactsCard({ facts, withheld, noRecord = false }: { facts: PropertyFacts; withheld?: readonly Withheld[]; noRecord?: boolean }) {
  const epcWithheld = isWithheld(withheld, "epc");
  const rows = factRows(facts, withheld).filter((row) => noRecord
    ? row.label === "Type" || row.label === "Tenure"
    : row.label !== "Energy rating" && row.label !== "Certificate date");
  return (
    <section className="property-card" data-testid="property-facts" aria-labelledby="facts-heading">
      <h2 id="facts-heading">About the home <HelpTip id="property-facts" /></h2>
      {!epcWithheld && !noRecord && <EnergyBands current={facts.energyRating} potential={facts.potentialEnergyRating} date={facts.energyCertificateDate} />}
      <dl className="fact-grid">
        {rows.map((row) => (
          <div key={row.label} data-unknown={row.value === UNKNOWN ? "" : undefined}>
            <FactIcon label={row.label} />
            <dt>{row.label}</dt>
            <dd>{row.label === "Tenure" && /leasehold/i.test(row.value) ? <Term id="leasehold">{row.value}</Term> : row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function saleFlags(sale: ProfileSale): string {
  return `${sale.newBuild ? " · new build" : ""}${sale.standardSale ? "" : " · non-standard"}`;
}

/** "HM Land Registry record" for a sale, or nothing when the record id is unknown. */
function SaleSource({ sale }: { sale: ProfileSale }) {
  if (!sale.sourceUrl) return null;
  return (
    <a href={sale.sourceUrl} target="_blank" rel="noopener noreferrer" data-testid="sale-source"
      aria-label={`HM Land Registry record of the ${formatDay(sale.date)} sale (opens in a new tab)`}>Land Registry record ↗</a>
  );
}

/**
 * Recorded sales, newest first: the facts. Desktop: a table. Phones: one
 * stacked row per sale ("11 Jan 2023 · £1.21m"), nothing clipped. A £/m² column
 * only while `pricePerSqm` is not withheld.
 */
/**
 * Block 2 while `valuation` is not withheld (CLOSE_KNIT_PER_HOME_VALUATION): the model estimate with
 * its range, set against the local same-type median. "Not available" when the API had no inputs.
 */
export function ValuationCard({ valuation, propertyType }: { valuation: ProfileValuation | null; propertyType: string | null }) {
  const type = typePlural(propertyType);
  return (
    <section className="property-card" data-testid="home-valuation" aria-labelledby="valuation-heading">
      <h2 id="valuation-heading">Model estimate</h2>
      {valuation ? (
        <>
          <p className="area-prices__lead" data-testid="valuation-value">{pounds(valuation.value)}</p>
          <p data-testid="valuation-range">{pounds(valuation.low)}–{pounds(valuation.high)}</p>
          <p className="property-meta" data-testid="valuation-compare">
            {[`${signedPercent(valuation.vsLocalTypeMedian)} vs local ${type ? `${type} ` : ""}median`,
              ...(valuation.vsLocalMedianPerSqm === null ? [] : [`£/m² ${signedPercent(valuation.vsLocalMedianPerSqm)} vs local median`])].join(" · ")}
          </p>
        </>
      ) : <p data-testid="valuation-none">Not available</p>}
      <p className="area-prices__footer" data-testid="valuation-wording">{VALUATION_WORDING}</p>
    </section>
  );
}

export function SalesCard({ sales: recorded, withheld, none, change = null, propertyType = null }: {
  sales: readonly ProfileSale[]; withheld?: readonly Withheld[];
  /** What stands in for the table when there is no sale. */
  none?: ReactNode;
  /** The annualised change since the last sale (salesSummary), against the borough's same type. */
  change?: ChangeSinceLastSale | null;
  propertyType?: string | null;
}) {
  const sales = [...recorded].reverse();
  const showPerSqm = !isWithheld(withheld, "pricePerSqm");
  const changeLine = sales.length > 0 ? changeSinceLastSaleLine(change, propertyType) : null;
  return (
    <section className="property-card" data-testid="property-sales" aria-labelledby="sales-heading">
      <h2 id="sales-heading">Recorded sales</h2>
      {sales.length === 0 ? none ?? <p>No recorded sale.</p> : (
        <>
          <div className="property-table-wrap property-sales-table" tabIndex={0} role="region" aria-label="Recorded sales table">
            <table className="sales-table">
              <caption className="sr-only">Every recorded sale of this home, newest first, with its HM Land Registry record</caption>
              <thead><tr><th>Date</th><th>Price</th>{showPerSqm && <th>£/m²</th>}<th>Type</th><th>Tenure</th><th>Source</th></tr></thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={`${sale.date}-${sale.price}`}>
                    <td>{formatDay(sale.date)}</td>
                    <td>{pounds(sale.price)}{saleFlags(sale)}</td>
                    {showPerSqm && <td>{pounds(sale.pricePerSquareMetre ?? null)}</td>}
                    <td>{sale.propertyType ?? UNKNOWN}</td>
                    <td>{sale.tenure ?? UNKNOWN}</td>
                    <td>{sale.sourceUrl ? <SaleSource sale={sale} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="property-sales-rows" aria-label="Recorded sales" data-testid="property-sales-rows">
            {sales.map((sale) => (
              <li key={`${sale.date}-${sale.price}`}>
                {[formatDay(sale.date), formatMoney(sale.price), ...(showPerSqm && sale.pricePerSquareMetre ? [`${pounds(sale.pricePerSquareMetre)}/m²`] : [])].join(" · ")}
                {saleFlags(sale)}
                {sale.sourceUrl && <> · <SaleSource sale={sale} /></>}
              </li>
            ))}
          </ul>
          {changeLine && <p className="property-meta" data-testid="sales-change">{changeLine}</p>}
        </>
      )}
      <p className="property-meta">
        Achieved prices from{" "}
        <a href="https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads" target="_blank" rel="noopener noreferrer">HM Land Registry Price Paid</a>,
        never asking prices.
      </p>
    </section>
  );
}

export function OtherHomesCard({ postcode, homes }: {
  postcode: string | null;
  /** null when the list could not be loaded (not the same as no other homes). */
  homes: readonly Pick<PostcodeHome, "addressId" | "uprn" | "displayAddress" | "lastSale">[] | null;
}) {
  if (!postcode) return null;
  return (
    <section className="property-card" data-testid="property-neighbours" aria-labelledby="neighbours-heading">
      <h2 id="neighbours-heading">Other homes at {postcode}</h2>
      {homes === null ? <p data-testid="other-homes-unavailable">List unavailable</p> : homes.length === 0 ? <p>No other recorded homes.</p> : (
        <ul className="property-list">
          {homes.slice(0, 12).map((home) => <HomeLine key={homeKey(home)} home={home} />)}
        </ul>
      )}
      <Link className="property-button" href={postcodeHomesPath(postcode)} data-testid="postcode-homes-link">
        All homes in {postcode}
      </Link>
    </section>
  );
}

function HomeLine({ home }: { home: Pick<PostcodeHome, "uprn" | "displayAddress" | "lastSale"> }) {
  const name = home.displayAddress.split(",").slice(0, 2).join(",");
  return (
    <li>
      {home.uprn ? <Link href={propertyPath(home.uprn)}>{name}</Link> : <span>{name}</span>}
      <span className="property-meta">{home.lastSale ? `${formatMoney(home.lastSale.price)} · ${formatDay(home.lastSale.date)}` : "No recorded sale"}</span>
    </li>
  );
}

/**
 * A home with no recorded sale of its own type: the middle half of the area's
 * recorded sales of each type (searched-home.ts › areaPriceRanges), only from
 * enough sales. About the area, never this home.
 */
export function AreaRangesCard({ ranges, name, window }: {
  ranges: readonly AreaPriceRange[]; name: string | null; window: { start: string; end: string } | null;
}) {
  const where = name ?? "this area";
  return (
    <section className="property-card" data-testid="area-price-ranges" aria-labelledby="area-ranges-heading">
      <h2 id="area-ranges-heading">Prices in this area today</h2>
      {ranges.length === 0 ? <p>Not enough recorded sales here to show a range.</p> : (
        <div className="property-table-wrap" tabIndex={0} role="region" aria-label={`Recorded sale prices in ${where}`}>
          <table className="sales-table">
            <caption>Recorded sale prices in {where}{window ? `, ${formatMonth(window.start)} to ${formatMonth(window.end)}` : ""}</caption>
            <thead><tr><th>Type</th><th>Middle half of sales</th><th>Sales</th></tr></thead>
            <tbody>
              {ranges.map((range) => (
                <tr key={range.label}>
                  <th scope="row">{range.label}</th>
                  <td>{formatMoney(range.low)}–{formatMoney(range.high)}</td>
                  <td>{range.sales}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="property-meta">About this area&apos;s sales, not a valuation of this home.</p>
    </section>
  );
}

export function PostcodeHomesView({ postcode, homes, disclaimer, mode, withheld, crumbs: trail, geographyId = null }: {
  postcode: string; homes: PostcodeHome[]; disclaimer: string; mode: DataMode; withheld?: readonly Withheld[];
  /** London › borough › area › postcode › Homes (the page's server read); London › postcode › Homes without it. */
  crumbs?: Crumb[];
  /** The postcode's neighbourhood: On map, and the map's card for a home with no page of its own. */
  geographyId?: GeographyId | null;
}) {
  const showEpc = !isWithheld(withheld, "epc");
  const crumbs: Crumb[] = trail ?? [
    { label: "London", href: "/area/london" },
    { label: postcode, href: `/postcode/${postcode.replace(/\s+/g, "-")}` },
    { label: "Homes", href: null },
  ];
  const mapQuery = geographyId ? new URLSearchParams({ selected: geographyId, mode }).toString() : null;
  // Every row is a link: its page, or (no UPRN, so no page) the map's card with its sales.
  const homeHref = (home: PostcodeHome) => (home.uprn ? propertyPath(home.uprn)
    : mapQuery ? `/?${withHomeQuery(mapQuery, { uprn: null, addressId: home.addressId })}` : null);
  return (
    <main className="property-page" data-testid="postcode-homes-page">
      {/* The site header on every page (≡, logo, Search, ♡ N, Map →). */}
      <SiteHeader />
      <Breadcrumbs crumbs={crumbs} />
      {/* r3 #31 (CUJ04 step 4): On map and Watch by the title. */}
      <div className="postcode-homes-title">
        <h1>Homes in {postcode}</h1>
        <div className="postcode-homes-title__actions" role="group" aria-label={`Next steps for ${postcode}`}>
          {mapQuery && <a className="property-button property-button--primary" href={`/?${mapQuery}`} data-testid="postcode-homes-on-map">On map</a>}
          <WatchListings place={postcode} className="property-button" label="Watch" />
        </div>
      </div>
      <DemoNotice mode={mode} />
      <p className="property-meta">{homes.length} {homes.length === 1 ? "home" : "homes"} <HelpTip id="postcode-homes" /></p>
      <div className="property-table-wrap property-homes-table" tabIndex={0} role="region" aria-label={`Homes in ${postcode}`}>
        <table className="sales-table property-homes">
          <caption className="sr-only">Every recorded home in {postcode}: type, tenure{showEpc ? ", floor area, energy rating" : ""} and last sale</caption>
          <thead>
            <tr>
              <th>Address</th><th>Type</th><th>Tenure</th>{showEpc && <th>Floor area</th>}{showEpc && <th>Energy</th>}<th>Last sale</th>
              <th><span className="sr-only">Report or hide</span></th>
            </tr>
          </thead>
          <tbody>
            {homes.map((home) => {
              const name = home.displayAddress.split(",").slice(0, 2).join(",");
              const href = homeHref(home);
              return (
                <tr key={homeKey(home)} data-testid="postcode-home">
                  <td>{href ? (home.uprn ? <Link href={href}>{name}</Link> : <a href={href} data-testid="postcode-home-map">{name}</a>) : name}</td>
                  <td>{home.propertyType ?? UNKNOWN}</td>
                  <td>{home.tenure ?? UNKNOWN}</td>
                  {showEpc && <td>{floorArea(home.floorAreaSquareMetres)}</td>}
                  {showEpc && <td>{home.energyRating ?? UNKNOWN}</td>}
                  <td>{home.lastSale ? `${pounds(home.lastSale.price)} (${formatDay(home.lastSale.date)})` : "None recorded"}</td>
                  <td className="property-homes__report">
                    {home.uprn && (
                      <Link className="property-report" href={reportHomePath(home.uprn)} data-testid="postcode-home-report"
                        aria-label={`Report or hide this home: ${home.displayAddress.split(",")[0]}`}>
                        Report
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!showEpc && <p className="property-meta" data-testid="postcode-epc-withheld">Floor area and energy rating: {EPC_WITHHELD_COPY}</p>}
      <HomeCards homes={homes} postcode={postcode} showEpc={showEpc} href={homeHref} />
      <p className="quality-note">{plainWords(disclaimer)}</p>
      <WhatsNext columns={{ up: upLinks(crumbs) }} />
    </main>
  );
}

/** Phones (≤ 560px): each home as a short card of terms, so nothing scrolls sideways. */
function HomeCards({ homes, postcode, showEpc, href }: {
  homes: PostcodeHome[]; postcode: string; showEpc: boolean; href: (home: PostcodeHome) => string | null;
}) {
  return (
    <ul className="property-home-cards" aria-label={`Homes in ${postcode}`} data-testid="postcode-home-cards">
      {homes.map((home) => {
        const name = home.displayAddress.split(",").slice(0, 2).join(",");
        const to = href(home);
        return (
          <li key={homeKey(home)}>
            <h2 className="property-home-cards__name">{to ? (home.uprn ? <Link href={to}>{name}</Link> : <a href={to}>{name}</a>) : name}</h2>
            <dl>
              <div><dt>Type</dt><dd>{home.propertyType ?? UNKNOWN}</dd></div>
              <div><dt>Tenure</dt><dd>{home.tenure ?? UNKNOWN}</dd></div>
              {showEpc && <div><dt>Floor area</dt><dd>{floorArea(home.floorAreaSquareMetres)}</dd></div>}
              {showEpc && <div><dt>Energy</dt><dd>{home.energyRating ?? UNKNOWN}</dd></div>}
              <div><dt>Last sale</dt><dd>{home.lastSale ? `${pounds(home.lastSale.price)} (${formatDay(home.lastSale.date)})` : "None recorded"}</dd></div>
            </dl>
            {home.uprn && (
              <Link className="property-report" href={reportHomePath(home.uprn)}
                aria-label={`Report or hide this home: ${home.displayAddress.split(",")[0]}`}>
                Report or hide this home
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
