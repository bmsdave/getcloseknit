import { councilWord } from "@/lib/coverage-words";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AreaFaq, AreaUnavailable, DemoNote } from "./area-pages";
import { AreaPageActions } from "./area-save-actions";
import { KeyNumbers, SectionFrame, type MaybeRow } from "./area-section-frame";
import { AreaVerdict } from "./area-standouts";
import { AreaTitle } from "./area-title";
import { BoroughAreas, BoroughLivingCosts, BoroughTiles } from "./borough-page-client";
import { Breadcrumbs, WhatsNext } from "./entity-nav";
import { SectionTabs, type TabSection } from "./section-tabs";
import { SiteHeader } from "./site-header";
import { friendlyTitle } from "@/lib/area-labels";
import {
  areaFacts, breadcrumb, countOf, descendants, formatCrimeRate, formatPercent, formatPerSquareMetre, indexScopeName, LONDON, median, neighbourhoodsWithPrice,
  type AreaFacts, type AreaIndex, type PageMetricId,
} from "@/lib/area-pages";
import { loadAreaProfile, loadAreaPages } from "@/lib/area-pages-data";
import { boroughAreaRows, boroughAreaSortParam, sortBoroughAreas } from "@/lib/borough-areas";
import { compareHref } from "@/lib/compare-table";
import type { GeographyId } from "@/lib/contracts";
import { serverDefaults, serverStandouts } from "@/lib/deployment";
import { findLikeHref } from "@/lib/profile-state";
import { areaCrumbs, upLinks } from "@/lib/entity-nav";
import { formatPounds, regionShare } from "@/lib/evidence-format";
import { REAL_PILOT_RELEASE } from "@/lib/map-state";
import { formatPoundsShort } from "@/lib/market";
import type { StandoutTile, StandoutTileId } from "@/lib/standouts";
import { AreaWords, SourceNote } from "@/components/source-note";

/** The sticky chips, in the page's order; "At a glance" is the tiles. */
const SECTIONS: readonly TabSection[] = [
  { id: "overview", title: "At a glance" },
  { id: "areas", title: "Areas" },
  { id: "price", title: "Price" },
  { id: "safety", title: "Safety" },
  { id: "schools", title: "Schools" },
  { id: "getting-around", title: "Getting around" },
  { id: "environment", title: "Green & quiet" },
  { id: "people", title: "People" },
  { id: "living-costs", title: "Living costs" },
  { id: "questions", title: "Questions" },
];

const TYPES: readonly [PageMetricId, string][] = [
  ["typical-price-flat", "Flat"], ["typical-price-terraced", "Terraced"], ["typical-price-semi", "Semi"], ["typical-price-detached", "Detached"],
];

const mapLink = (geography: GeographyId, layer?: string) =>
  `/?${new URLSearchParams({ selected: geography, ...(layer ? { layer } : {}) }).toString()}`;

/** The middle of a figure over the borough's neighbourhoods (null with none). */
function middle(index: AreaIndex, metric: PageMetricId, lsoas: readonly { geographyId: GeographyId }[]): number | null {
  return median(lsoas.flatMap((area) => {
    const value = index.values[metric].get(area.geographyId)?.value;
    return value == null ? [] : [value];
  }));
}

/**
 * The neighbourhood that stands for the borough in Find similar (My match starts from one neighbourhood): the one
 * whose £/m² is nearest the borough's middle; the first by name when none has a price.
 */
function typicalNeighbourhood(index: AreaIndex, lsoas: readonly { geographyId: GeographyId }[]): GeographyId | null {
  const target = middle(index, "price-per-square-metre", lsoas);
  const values = index.values["price-per-square-metre"];
  const nearest = target === null ? null : lsoas
    .flatMap((area) => {
      const value = values.get(area.geographyId)?.value;
      return value == null ? [] : [{ id: area.geographyId, gap: Math.abs(value - target) }];
    })
    .sort((a, b) => a.gap - b.gap)[0]?.id ?? null;
  return nearest ?? lsoas[0]?.geographyId ?? null;
}

/** "Pricier than 70% of boroughs": a neutral position among the region's boroughs, never a rank. */
function priceChip(tile: StandoutTile | null, units: string): string | null {
  const percentile = tile?.regionPercentile ?? null;
  if (percentile === null) return null;
  return percentile >= 50 ? `Pricier than ${regionShare(percentile)}% of ${units}` : `Cheaper than ${regionShare(100 - percentile)}% of ${units}`;
}

/** "£3,300": a £/m² rounded to £100, as the Price tile shows it. */
const roundedPerSquareMetre = (value: number) => `£${(Math.round(value / 100) * 100).toLocaleString("en-GB")}`;

/** "£9,100 · London £10,200": the borough beside its region (`region`: London, North West, …). */
const versus = (here: string, other: string | null, region = "London") => (other ? `${here} · ${region} ${other}` : here);

/** What the region's local authorities are called: London's are boroughs, the rest councils (as the tags say). */
const unitsOf = (region: string) => councilWord(region === "London", true);

/** One of them in copy: "borough" in London, "council" elsewhere (no London words on other regions' pages). */
const unitOf = (region: string) => councilWord(region === "London");

/** The region's figure beside a page's, where it is the middle of the region's neighbourhoods, not a pooled one. */
const typicalOf = (region: string) => `typical ${region} neighbourhood`;

/**
 * A borough (any English local authority) in the area page's frame: breadcrumbs, name, verdict and tags, the
 * actions row, the same 12 tiles at borough level, one sticky chip bar, then its neighbourhoods as a
 * sortable list and each topic in the area-page section frame. Income and social renting are rows (the owner
 * allows ranking them; tags wait for CLOSE_KNIT_PEOPLE_STANDOUTS); deprivation may make a tag.
 */
export async function BoroughPage({ geography, sort }: { geography: GeographyId; sort: string | string[] | undefined }) {
  await connection();
  const loaded = await loadAreaPages(geography);
  if (!loaded) return <AreaUnavailable />;
  const { index, mode } = loaded;
  const area = index.byId.get(geography);
  if (!area || area.carrier !== "lad") notFound();
  const [profile, standouts, defaults] = await Promise.all([
    loadAreaProfile(loaded, geography), serverStandouts(geography, mode), serverDefaults(),
  ]);
  const facts = areaFacts(index, geography, profile);
  const london = areaFacts(index, LONDON);
  if (!facts) notFound();
  const [, carrier, code] = geography.split(":");
  const name = friendlyTitle(area) ?? area.name;
  const release = defaults.release ?? (mode === "real" ? REAL_PILOT_RELEASE : "demo");
  const crumbs = areaCrumbs(breadcrumb(index, geography));
  const lsoas = descendants(index, geography, "lsoa");
  const order = boroughAreaSortParam(sort);
  const rows = sortBoroughAreas(boroughAreaRows(index, geography, standouts?.neighbourhoods ?? []), order);
  const tile = (id: StandoutTileId) => standouts?.tiles.find((entry) => entry.id === id && entry.available) ?? null;
  const map = mapLink(geography);
  const typical = typicalNeighbourhood(index, lsoas);
  const sectionIds = SECTIONS.map((section) => section.id);
  const region = indexScopeName(index);
  const units = unitsOf(region);
  const unit = unitOf(region);
  return (
    <AreaWords london={region === "London"}>
    <main className="methodology area-page area-full borough-page" data-testid="area-guide-page">
      <SiteHeader />
      <header className="area-head">
        <div className="area-head__main">
          <Breadcrumbs crumbs={crumbs} label="Where this area sits" />
          <AreaTitle officialName={area.name} fields={area} fallback={area.name} testId="area-page-title" />
          <p className="area-head__borough" data-testid="area-level">{region === "London" ? "London borough" : `Local authority in ${region}`} · {countOf(lsoas.length, "neighbourhood")}</p>
          <AreaVerdict standouts={standouts ?? "unknown"} />
        </div>
        {/* r3 #38 (V4-17 board): ♡ · Compare · On map · ⋯ with Watch new listings, Find similar and the evidence pack. */}
        <AreaPageActions carrier={carrier} code={code} mode={mode} release={release} name={name} mapHref={map}
          packHref={`/area/${carrier}/${code}/pack`} homeHref={null} compareLink={compareHref("places", [geography])}
          similarHref={typical ? findLikeHref(typical) : null} watchLabel="Watch new listings" />
      </header>
      <DemoNote mode={mode} />
      <BoroughTiles standouts={standouts} sections={sectionIds} mapHref={map} />
      <div className="area-card-body">
        <SectionTabs sections={SECTIONS} />
        <section id="areas" className="area-section borough-page__areas" data-section="areas" data-testid="area-children" aria-labelledby="areas-title">
          <div className="area-section__head">
            <h2 className="area-section__title" id="areas-title" tabIndex={-1}><span>Areas</span></h2>
            <span className="area-section__headline">{countOf(rows.length, "area")}</span>
          </div>
          <BoroughAreas rows={rows} initial={order} scope={region} />
        </section>
        <PriceSection index={index} geography={geography} facts={facts} london={london} lsoas={lsoas} tile={tile} units={units} unit={unit} />
        <SectionFrame id="safety" title="Safety" icon="crime"
          headline={facts.crime ? `${formatCrimeRate(facts.crime.value)} / 1,000` : null}
          chip={tile("safety") ? `${tile("safety")!.display} of ${units}` : null} mapHref={mapLink(geography, "crime")}
          about={<p>Recorded crime per 1,000 residents a year (police.uk), the {unit}&apos;s own figure; {region} pools every {unit}&apos;s crimes and residents.</p>}>
          <KeyNumbers testId="safety-key-numbers" rows={[
            facts.crime && { term: "Crime", value: versus(`${formatCrimeRate(facts.crime.value)} per 1,000 a year`, london?.crime ? formatCrimeRate(london.crime.value) : null, region) },
            tile("safety") && { term: `Among ${units}`, value: tile("safety")!.display },
          ]} />
        </SectionFrame>
        <SectionFrame id="schools" title="Schools" icon="school"
          headline={facts.schools ? `${(facts.schools.primary + facts.schools.secondary).toLocaleString("en-GB")} state schools` : null}
          about={<p>State primaries and secondaries inside its boundary (DfE GIAS, Ofsted). The standing is each neighbourhood&apos;s best primary within 1 km, among {region}&apos;s primaries.</p>}>
          <KeyNumbers testId="schools-key-numbers" rows={[
            facts.schools && { term: "Primary", value: facts.schools.primary.toLocaleString("en-GB") },
            facts.schools && { term: "Secondary", value: facts.schools.secondary.toLocaleString("en-GB") },
            tile("schools")?.detail && { term: "Outstanding", value: tile("schools")!.detail!.replace(/ Outstanding$/, "") },
            tile("schools")?.standing != null && { term: "Primaries nearby", value: `Stronger than in ${regionShare(tile("schools")!.standing!)}% of ${units}` },
          ]} />
          <Link className="area-section__more" href="/rankings">School rankings <span aria-hidden="true">→</span></Link>
        </SectionFrame>
        <SectionFrame id="getting-around" title="Getting around" icon="train" headline={tile("station-walk")?.display ?? null}
          mapHref={mapLink(geography, "station-access")}
          about={<p>The typical (middle) neighbourhood&apos;s walk to a station; protected cycle lanes and Cycleways inside the {unit}{region === "London" ? " (TfL Cycling Infrastructure Database). Powered by TfL Open Data" : ""}.</p>}>
          <KeyNumbers testId="getting-around-key-numbers" rows={rowsFor([["station-walk", "Station walk"], ["cycling", "Cycle lanes"]], tile)} />
        </SectionFrame>
        <SectionFrame id="environment" title="Green & quiet" icon="tree" headline={tile("nature")?.display ?? null}
          mapHref={mapLink(geography, "nature-score")}
          about={<p>The typical (middle) neighbourhood: green space, the share of homes at 55 dB or more from road or rail, and air where it is published.</p>}>
          <KeyNumbers testId="environment-key-numbers" rows={rowsFor([["nature", "Green space"], ["noise", "Noise"], ["air", "Air"]], tile)} />
        </SectionFrame>
        <PeopleSection facts={facts} london={london} region={region} unit={unit} />
        <SectionFrame id="living-costs" title="Living costs" icon="income">
          <BoroughLivingCosts geographyId={geography} mode={mode} />
        </SectionFrame>
        <div id="questions" className="borough-page__questions"><AreaFaq facts={facts} london={london} /></div>
      </div>
      <WhatsNext columns={{
        up: upLinks(crumbs),
        inside: [{ label: "Areas", href: "#areas" }],
        nearby: [{ label: "On map", href: map, reload: true }, { label: "Rankings", href: "/rankings" }],
        act: [{ label: "Evidence pack", href: `/area/${carrier}/${code}/pack` }],
      }} />
      <footer className="area-full__sources" data-testid="area-sources">
        <h2>Sources</h2>
        <p data-testid="area-official-name">Official name: {area.name} ({code}).</p>
        {standouts?.caveats.map((caveat) => <SourceNote key={caveat} text={caveat} />)}
      </footer>
    </main>
    </AreaWords>
  );
}

/** Rows straight from tiles that have a value: "Station walk: 11 min · typical walk". */
function rowsFor(entries: readonly [StandoutTileId, string][], tile: (id: StandoutTileId) => StandoutTile | null): MaybeRow[] {
  return entries.map(([id, term]) => {
    const found = tile(id);
    return found && { term, value: found.detail ? `${found.display} · ${found.detail}` : found.display };
  });
}

function PriceSection({ index, geography, facts, london, lsoas, tile, units, unit }: {
  index: AreaIndex; geography: GeographyId; facts: AreaFacts; london: AreaFacts | null;
  lsoas: readonly { geographyId: GeographyId }[]; tile: (id: StandoutTileId) => StandoutTile | null; units: string; unit: string;
}) {
  const price = tile("price");
  const region = london?.name ?? "London";
  const types = TYPES.flatMap(([metric, label]) => {
    const value = middle(index, metric, lsoas);
    return value === null ? [] : [`${label} ${formatPoundsShort(value)}`];
  });
  const trend = price?.trend ?? null;
  return (
    <SectionFrame id="price" title="Price" icon="trend"
      headline={price?.display ?? (facts.price ? formatPerSquareMetre(facts.price.value) : null)}
      chip={priceChip(price, units)} mapHref={mapLink(geography, "price-per-square-metre")}
      about={<p>HM Land Registry sales: the middle of the {unit}&apos;s neighbourhoods&apos; prices per m², beside the middle of {region}&apos;s, and typical prices by type from the area price bands. Area figures only, never a home&apos;s value.</p>}>
      <KeyNumbers testId="price-key-numbers" rows={[
        // One £/m² in the section: with a tile, the row is the headline's figure (the middle of its
        // neighbourhoods) beside the middle of the region's, both rounded as the tile is.
        price?.value != null
          ? { term: "Per m²", value: versus(`${roundedPerSquareMetre(price.value)} per m²`, london?.price ? roundedPerSquareMetre(london.price.value) : null, typicalOf(region)) }
          : facts.price && { term: "Per m²", value: versus(formatPerSquareMetre(facts.price.value), london?.price ? formatPerSquareMetre(london.price.value) : null, region) },
        types.length > 0 && { term: "By type", value: types.join(" · ") },
        trend && { term: "1-year change", value: `${trend.percent > 0 ? "+" : trend.percent < 0 ? "−" : ""}${Math.abs(trend.percent)}%` },
        { term: "Neighbourhoods", value: neighbourhoodsWithPrice(index, lsoas) },
      ]} />
    </SectionFrame>
  );
}

/** Income and social renting beside the region's typical neighbourhood; deprivation's shares of England's fifths. */
function PeopleSection({ facts, london, region, unit }: { facts: AreaFacts; london: AreaFacts | null; region: string; unit: string }) {
  const pounds = (value: number) => formatPounds(Math.round(value / 100) * 100);
  const share = (value: number) => `${Math.round(value)}%`;
  const rows: MaybeRow[] = [
    facts.income && { term: "Household income", value: versus(`${pounds(facts.income.value)} a year`, london?.income ? pounds(london.income.value) : null, typicalOf(region)) },
    facts.socialRenting && { term: "Social renting", value: versus(`${share(facts.socialRenting.value)} of homes`, london?.socialRenting ? share(london.socialRenting.value) : null, typicalOf(region)) },
    facts.deprivation && { term: "Most-deprived fifth", value: `${formatPercent(facts.deprivation.mostDeprived)} of its neighbourhoods` },
    facts.deprivation && { term: "Least-deprived fifth", value: `${formatPercent(facts.deprivation.leastDeprived)} of its neighbourhoods` },
  ];
  return (
    <SectionFrame id="people" title="People" icon="people" headline="Census 2021"
      about={<p>Income (ONS) and social renting (Census 2021) beside the middle of {region}&apos;s neighbourhoods. Deprivation is the official Index of Multiple Deprivation for each neighbourhood, not its people: the share of the {unit}&apos;s neighbourhoods in England&apos;s most and least deprived fifths.</p>}>
      <KeyNumbers testId="people-key-numbers" rows={rows} />
    </SectionFrame>
  );
}
