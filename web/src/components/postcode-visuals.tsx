/**
 * The postcode page's infographics: the headline figures, the postcode
 * against its neighbourhood, borough and region, the mix of homes, the
 * "living here" strip from the area card, and the one Sources fold at the
 * foot of the page. Presentational only (the page loads the data); the
 * sales-over-time chart is postcode-sales-chart.tsx.
 * Places, not people: every figure is about homes, sales and places nearby.
 */
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import type { AskingBasis } from "@/components/asking-price-check";
import { BarList, StackedBar } from "@/components/charts";
import { formatDay } from "@/lib/market";
import { formatMoney, formatPerArea } from "@/lib/money-format";
import { bandLabel, floodOverviewValue, formatShare, homesFlood, mediumOrHighShare, type AreaFloodResponse, type HomeFloodBands } from "@/lib/flood-risk";
import type { AreaProfileResponse, AreaSummary } from "@/lib/contracts";
import { formatDistance, stationWalkMinutes, type AreaPlacesResponse } from "@/lib/places";
import { addressPlace } from "@/lib/postcode-groups";
import {
  compareRows, crimeVersusRegion, RECENT_YEARS, relativeWords, typicalHeadline, typicalSpan,
  type HomesMix, type MixPart, type PostcodeSummary, type Typical,
} from "@/lib/postcode-visuals";
import { councilWord, localNote } from "@/lib/coverage-words";
import { plainWords } from "@/lib/property-profile";

const homesWord = (count: number) => `${count} ${count === 1 ? "home" : "homes"}`;
const salesWord = (count: number) => `${count} ${count === 1 ? "sale" : "sales"}`;

function Stat({ label, value, detail, lead = false, testId }: {
  label: string; value: ReactNode; detail: ReactNode; lead?: boolean; testId: string;
}) {
  return (
    <div className="postcode-stat" data-lead={lead ? "" : undefined} data-testid={testId}>
      <span className="postcode-stat__label">{label}</span>
      <strong className="postcode-stat__value" data-long={typeof value !== "string" || value.length > 12 ? "" : undefined}>{value}</strong>
      <span className="postcode-stat__detail">{detail}</span>
    </div>
  );
}

const kindWord = { flat: "Flats", house: "Houses" } as const;
const kindSingular = { flat: "flat", house: "house" } as const;
/** Typical prices are middles of real sales, said roughly: "~£440k". */
const roughly = (value: number) => `~${formatMoney(value)}`;

/** The area's typical price now, for the headline; null while unknown. */
export interface HeroArea { name: string; typicalPrice: number | null }

/**
 * At a glance: the last sale leads; then the typical price here, honest
 * about mixes ("Flats ~£440k · Houses ~£1.31m"), or "Too few recent sales"
 * with the area's typical price now beside it. A middle of every sale since
 * the 1990s is never a headline (it sits in the chart's caption).
 */
export function PostcodeHero({ summary, postcode, lastSaleAddress, area = null }: {
  summary: PostcodeSummary; postcode: string; lastSaleAddress: string | null; area?: HeroArea | null;
}) {
  const { lastSale } = summary;
  const headline = typicalHeadline(summary);
  const areaNow = area?.typicalPrice != null ? `${area.name} now: ${roughly(area.typicalPrice)}` : null;
  const span = (figure: Typical) => `Middle of ${typicalSpan(figure)}`;
  let typical: ReactNode;
  if (headline.kind === "too-few") {
    typical = (
      <Stat testId="postcode-typical-price" label="Typical price here" value="Too few recent sales"
        detail={areaNow ?? `Fewer than 3 sales in the last ${RECENT_YEARS * 2} years`} />
    );
  } else {
    const value = headline.kind === "split" ? (
      <span className="postcode-stat__kinds" data-testid="postcode-typical-by-kind">
        {headline.parts.map(({ kind, typical: figure }, index) => (
          <span key={kind}>{index > 0 && <span className="postcode-stat__sep"> · </span>}{kindWord[kind]} {roughly(figure.value)}</span>
        ))}
      </span>
    ) : headline.kind === "one-kind"
      ? `${kindWord[headline.part.kind]} ${roughly(headline.part.typical.value)}`
      : roughly(headline.typical.value);
    const basis = headline.kind === "split" ? `Recent sales of each, ${headline.parts[0].typical.fromYear}–${Math.max(...headline.parts.map((part) => part.typical.toYear))}`
      : headline.kind === "one-kind" ? `Too few recent ${kindSingular[headline.missing]} sales to say`
        : span(headline.typical);
    typical = (
      <Stat testId="postcode-typical-price" label="Typical price here" value={value}
        detail={<>{basis}{areaNow && <span className="postcode-stat__area">{areaNow}</span>}</>} />
    );
  }
  const tiles = [
    <Stat key="last" lead testId="postcode-last-sale" label="Last sale"
      value={lastSale ? formatMoney(lastSale.price) : "—"}
      detail={lastSale ? `${formatDay(lastSale.date)}${lastSaleAddress ? ` · ${addressPlace(lastSaleAddress, postcode).home}` : ""}` : "None recorded"} />,
    <Fragment key="typical">{typical}</Fragment>,
    <Stat key="counts" testId="postcode-counts" label="Homes · sales"
      value={`${summary.homes} · ${summary.sales}`}
      detail={summary.firstYear !== null ? `${salesWord(summary.sales)} since ${summary.firstYear}` : homesWord(summary.homes)} />,
  ].filter(Boolean);
  return (
    <section className="postcode-hero" data-count={tiles.length} aria-label={`${postcode} at a glance`} data-testid="postcode-hero">
      {tiles}
    </section>
  );
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The friendly line under the postcode: the figures the headline tiles
 * already show, said as a sentence ("The last recorded sale here was £570k,
 * in November 2022. Recent sales here went for about £440k."). Null with no sales.
 */
export function postcodeSummaryLine(summary: PostcodeSummary): string | null {
  const last = summary.lastSale;
  if (!last) return null;
  const [year, month] = last.date.split("-");
  const when = `${MONTH_NAMES[Number(month) - 1] ?? ""} ${year}`.trim();
  const headline = typicalHeadline(summary);
  const typical = headline.kind === "split"
    ? ` Recent flats went for about ${formatMoney(headline.parts.find((part) => part.kind === "flat")!.typical.value)} and houses for about ${formatMoney(headline.parts.find((part) => part.kind === "house")!.typical.value)}.`
    : headline.kind === "single" ? ` Recent sales here went for about ${formatMoney(headline.typical.value)}.`
      : headline.kind === "one-kind" ? ` Recent ${kindWord[headline.part.kind].toLowerCase()} went for about ${formatMoney(headline.part.typical.value)}.`
        : " There are too few recent sales here to give a typical price.";
  return `The last recorded sale here was ${formatMoney(last.price)}, in ${when}.${typical}`;
}

/** One panel heading (H2) for the postcode page's panels. */
export function PanelTitle({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="postcode-panel__head">
      <h2 id={id}>{children}</h2>
      {aside}
    </div>
  );
}

export interface CompareFigures {
  postcode: string;
  postcodePrice: Typical | null;
  area: { name: string; perSquareMetre: number | null; medianPrice: number | null; marketName: string | null };
  borough: { name: string; perSquareMetre: number | null; medianPrice: number | null } | null;
  region: { name: string; perSquareMetre: number | null } | null;
  period: string | null;
  marketWindow: string | null;
}

/**
 * The postcode's typical price against its neighbourhood and borough, and the areas' £/m² (one scale per
 * chart). The postcode has no £/m² of its own: no per-sale £/m² while the EPC licence is pending.
 */
export function PostcodeComparison({ figures }: { figures: CompareFigures }) {
  const { postcode, area, borough } = figures;
  // Only recent postcode figures stand next to today's area figures.
  const recent = (figure: Typical | null) => figure?.basis === "recent" ? figure.value : null;
  const perArea = compareRows([
    { id: "area", label: area.name, value: area.perSquareMetre },
    { id: "borough", label: borough?.name ?? "Borough", value: borough?.perSquareMetre ?? null },
    { id: "region", label: figures.region?.name ?? "Region", value: figures.region?.perSquareMetre ?? null },
  ], (value) => formatPerArea(value));
  const prices = compareRows([
    { id: "postcode", label: postcode, value: recent(figures.postcodePrice) },
    { id: "area", label: area.marketName ?? area.name, value: area.medianPrice },
    { id: "borough", label: borough?.name ?? "Borough", value: borough?.medianPrice ?? null },
  ], (value) => formatMoney(value));
  const mine = recent(figures.postcodePrice);
  // Any figure besides the postcode's own: without one there is nothing to compare (the area calls failed).
  const hasArea = [...perArea, ...prices].some((row) => row.id !== "postcode");
  const areaPrice = area.medianPrice;
  const when = [figures.period ? `£ per m² for the year to ${figures.period}` : null, figures.marketWindow ? `prices ${figures.marketWindow}` : null]
    .filter(Boolean).join(" · ");
  return (
    <section className="postcode-panel" aria-labelledby="postcode-compare-title">
      <PanelTitle id="postcode-compare-title">Compared with the area</PanelTitle>
      <div className="postcode-compare" data-testid="postcode-compare">
        {mine !== null && areaPrice ? (
          <p className="postcode-compare__lead">The typical price here is{" "}
            <strong>{relativeWords(mine, areaPrice)} {area.marketName ?? area.name}</strong>.</p>
        ) : !hasArea ? (
          <p className="postcode-compare__lead" data-testid="postcode-compare-missing">
            The area&apos;s figures did not load, so there is nothing to set {postcode} against right now; reload, or open the area card.
          </p>
        ) : mine === null ? (
          <p className="postcode-compare__lead" data-testid="postcode-compare-thin">
            Too few recent sales here to compare; the bars show the area.
          </p>
        ) : null}
        {hasArea && (
          <div className="postcode-compare__chart">
            <h3>£ per m²</h3>
            {perArea.length > 0 ? <BarList rows={perArea} label={`Price per square metre: ${postcode} and its areas`} />
              : <p className="chart-unknown">Not enough figures to compare.</p>}
          </div>
        )}
        {hasArea && prices.length > 0 && (
          <div className="postcode-compare__chart">
            <h3>Typical price</h3>
            <BarList rows={prices} label={`Typical price: ${postcode} and its areas`} />
          </div>
        )}
        {when && <p className="postcode-panel__note">{when}. Different years and mixes of homes, so read the gap, not the pounds.</p>}
      </div>
    </section>
  );
}

function known(count: number, total: number, what: string): string {
  return count === total ? `All ${homesWord(total)}` : `${what} known for ${count} of ${homesWord(total)}`;
}

/** A bar for a mix; one category covering every known home is said in words, not drawn as a full bar. */
function MixBar({ parts, label, unknown }: { parts: MixPart[]; label: string; unknown: string }) {
  if (parts.length === 0) return <p className="chart-unknown">{unknown}</p>;
  if (parts.length === 1) return <p className="postcode-mix__single" data-testid="postcode-mix-single">{parts[0].label.replace(/ \(\d+\)$/, "")}</p>;
  return <StackedBar parts={parts} label={label} />;
}

/** Types, sizes, energy ratings (from certificates) and tenure of the homes here. */
export function HomesMixPanel({ mix, postcode, homesHref }: { mix: HomesMix; postcode: string; homesHref: string }) {
  return (
    <section className="postcode-panel" aria-labelledby="postcode-mix-title">
      <PanelTitle id="postcode-mix-title">The homes here</PanelTitle>
      <div className="postcode-mix" data-testid="postcode-mix">
        <div className="postcode-mix__part">
          <h3>Type</h3>
          <MixBar parts={mix.types} label={`Home types in ${postcode}`} unknown="Unknown" />
          <small>{known(mix.typesKnown, mix.total, "Type")}</small>
        </div>
        <div className="postcode-mix__part postcode-mix__part--size" data-short={mix.sizes.length <= 2 ? "" : undefined}>
          <h3>Size{mix.medianSize !== null ? ` · typical ${Math.round(mix.medianSize)} m²` : ""}</h3>
          {mix.sizesKnown > 0 ? <BarList rows={mix.sizes} label={`Floor areas in ${postcode}`} /> : <p className="chart-unknown">No floor areas on record</p>}
          <small>{known(mix.sizesKnown, mix.total, "Floor area")}</small>
        </div>
        <div className="postcode-mix__part">
          <h3>Energy rating</h3>
          <MixBar parts={mix.energy} label={`Energy ratings in ${postcode}`} unknown="No energy certificates on record" />
          <small>{known(mix.energyKnown, mix.total, "Rating")}</small>
        </div>
        <div className="postcode-mix__part">
          <h3>Tenure</h3>
          <MixBar parts={mix.tenure} label={`Tenure in ${postcode}`} unknown="Unknown" />
          <small>{known(mix.tenureKnown, mix.total, "Tenure")}</small>
        </div>
      </div>
      <p className="panel-links"><Link href={homesHref} data-testid="postcode-homes-link">Every home in {postcode}: type, size, energy rating</Link></p>
    </section>
  );
}

export interface LivingFacts {
  areaHref: string;
  areaName: string;
  stationWalk: AreaSummary | null;
  places: AreaPlacesResponse | null;
  profile: AreaProfileResponse | null;
  flood: AreaFloodResponse | null;
  /** The postcode's homes: their own flood bands lead the flood tile when they have them. */
  homes?: readonly { flood?: HomeFloodBands | null }[];
  foodHygiene: AreaSummary | null;
  /** The area's own region ("London", "North West"): what its crime percentile is of; null when not known. */
  region: string | null;
}

interface Tile { id: string; label: string; value: string; detail: string }

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The tiles that have data; each says what it measures in one short line. */
export function livingTiles(facts: LivingFacts): Tile[] {
  const tiles: Tile[] = [];
  const station = facts.places?.stations[0] ?? null;
  if (facts.stationWalk?.value != null || station) {
    tiles.push({
      id: "station", label: "Station walk",
      value: facts.stationWalk?.value != null ? `${Math.round(facts.stationWalk.value)} min` : `about ${stationWalkMinutes(station!.distanceMetres)} min`,
      detail: station ? `${station.name}, ${formatDistance(station.distanceMetres)}` : "Typical walk from homes here",
    });
  }
  const schools = facts.profile?.schools;
  if (schools) {
    tiles.push({ id: "schools", label: "Schools", value: `${schools.primary + schools.secondary}`,
      detail: `${schools.primary} primary, ${schools.secondary} secondary within 1 km` });
  }
  const own = homesFlood(facts.homes ?? []);
  if (own) {
    // The homes' own bands: the area's land may hold a floodplain no home here is in (W5 1LR).
    tiles.push({
      id: "flood", label: "Flood risk · rivers, sea", value: bandLabel(own.riversSea),
      detail: (own.counted === own.total ? `All ${homesWord(own.total)}` : `${own.counted} of ${homesWord(own.total)}`)
        + (own.surfaceWater ? ` · surface water ${bandLabel(own.surfaceWater).toLowerCase()}` : ""),
    });
  } else if (facts.flood) {
    // No home here has its own bands: the area's land, said as the area's.
    // The headline is rivers and sea; surface water gets its share of the land, so "Very low"
    // never sits over a bare "surface water high" (its highest band, often a few streets).
    const badge = floodOverviewValue(facts.flood);
    const surface = facts.flood.surfaceWater;
    const rivers = facts.flood.riversSea;
    tiles.push({
      id: "flood", label: rivers ? "Area flood · rivers, sea" : "Area flood risk",
      value: badge.label === "unknown" ? "Unknown" : badge.label,
      detail: rivers && surface
        ? `Surface water: ${formatShare(mediumOrHighShare(surface))} of land, up to ${bandLabel(surface.highestBand).toLowerCase()}`
        : badge.detail,
    });
  }
  const crime = facts.profile?.metrics.find((metric) => metric.metricId === "crime" && metric.value !== null) ?? null;
  const versus = crimeVersusRegion(crime?.regionPercentile, facts.region);
  if (crime && versus !== null) {
    // The area brief's words; crime counts where it happens, so the caveat travels with the figure.
    tiles.push({ id: "crime", label: "Recorded crime", value: versus,
      detail: `${Math.round(crime.value as number)} crimes per 1,000 people a year · shops and stations included` });
  }
  if (facts.foodHygiene?.value != null) {
    const rated = facts.foodHygiene.sampleCount;
    tiles.push({ id: "food", label: "Food hygiene", value: `${Math.round(facts.foodHygiene.value)}%`,
      detail: `of ${rated ? `${rated} ` : ""}food places within 800 m score 4 or 5` });
  }
  const noise = facts.profile?.noise;
  if (noise?.available && noise.any55Share !== null) {
    tiles.push({ id: "noise", label: "Noise", value: percent(noise.any55Share), detail: "of homes at 55 dB+ from road or rail" });
  }
  return tiles;
}

/** "Living here": the area card's essentials in one strip, each linking to the full card. */
export function LivingHere({ facts }: { facts: LivingFacts }) {
  const tiles = livingTiles(facts);
  if (tiles.length === 0) return null;
  return (
    <section className="postcode-living" aria-labelledby="postcode-living-title" data-testid="postcode-living">
      <div className="postcode-section-head">
        <h2 id="postcode-living-title">Living here</h2>
      </div>
      <ul className="postcode-living__tiles">
        {tiles.map((tile) => (
          <li key={tile.id}>
            <Link href={facts.areaHref} className="postcode-tile" data-testid="postcode-living-tile" data-tile={tile.id}>
              <span className="postcode-stat__label">{tile.label}</span>
              <strong className="postcode-tile__value" data-long={tile.value.length > 12 ? "" : undefined}>{tile.value}</strong>
              <span className="postcode-stat__detail">{tile.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="quality-note">Area facts describe the neighbourhood this postcode sits in ({facts.areaName}) and the places around it, not the people who live there.</p>
    </section>
  );
}

/**
 * The page's one Sources fold: the record's own disclaimers and how each
 * panel is worked out, said once at the foot instead of under every chart.
 */
export function PostcodeSources({ disclaimers, london = true }: { disclaimers: string[]; london?: boolean }) {
  return (
    <details className="postcode-sources" data-testid="postcode-sources">
      <summary>Sources</summary>
      <div className="postcode-sources__body">
        {disclaimers.map((text) => <p key={text}>{localNote(plainWords(text), london)}</p>)}
        <p>
          Sales: achieved prices HM Land Registry recorded for homes in this postcode, never valuations or asking prices.
          Coordinates are at postcode precision. Area lines: yearly medians of standard sales only in the neighbourhood,
          or the wider area when it has too few, and in the {councilWord(london)}.
        </p>
        <p>
          Compared with the area: the postcode&apos;s figures are the middle of its recent sales; areas use typical £ per m²
          of recorded sales (an area without its own figure takes the middle of its neighbourhoods) and median prices of standard sales.
        </p>
        <p>
          The homes here: type and tenure from each home&apos;s latest HM Land Registry sale; floor area and energy rating from its
          latest energy certificate (facts about the building, never the occupant). Sales without a matched floor area show no £ per m².
        </p>
        <p>Living here: the area card&apos;s figures for the neighbourhood around the postcode.</p>
      </div>
    </details>
  );
}

/**
 * The asking-price check on a postcode: the typical recent price here (one
 * kind of home, so it means something), else the area's typical price now;
 * and the middle half of recent sale prices in the area.
 */
export function postcodeAskingBasis(summary: PostcodeSummary, areaName: string,
  area: { medianPrice: number | null; p25: number | null; p75: number | null } | null): AskingBasis {
  const own = summary.typicalPrice?.basis === "recent" && !summary.blended ? summary.typicalPrice : null;
  const reference = own
    ? { price: own.value, words: `the typical recent price here (~${formatMoney(own.value)}, middle of ${typicalSpan(own)})` }
    : area?.medianPrice ? { price: area.medianPrice, words: `the typical price in ${areaName} now (~${formatMoney(area.medianPrice)})` } : null;
  const band = area?.p25 && area.p75 ? { p25: area.p25, p75: area.p75, per: "price" as const, what: `recent sale prices in ${areaName}` } : null;
  return { reference, band };
}
