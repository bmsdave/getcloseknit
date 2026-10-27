import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { FLOOD_CHECK_URL } from "@/lib/contracts";
import { FACTORS } from "@/lib/fixtures";
import { AREA_LEVEL_NOTE } from "@/lib/flood-evidence";
import type { GuideSlug } from "@/lib/guide-slugs";
import { describeReadingKind } from "@/lib/noise-evidence";
import { REVIEWED_PLANNING_SOURCE } from "@/lib/planning-evidence";
import { SDLT_ENGLAND_2026_10_05 as SDLT } from "@/lib/stamp-duty";
import { NOT_ADVICE } from "@/lib/tools";

import {
  BuyToLetDiagram,
  ConnectivityDiagram,
  CouncilTaxDiagram,
  CrimeRateDiagram,
  DecileDiagram,
  DemoRealDiagram,
  EnergyRatingDiagram,
  FloodShareDiagram,
  HomeCostDiagram,
  MarketSpreadDiagram,
  MatchDiagram,
  MedianDiagram,
  MortgageRatesDiagram,
  NestingDiagram,
  NoiseScaleDiagram, AirScaleDiagram, WildlifeShareDiagram,
  PeopleShareDiagram,
  PlanningStagesDiagram,
  PriceBandsDiagram,
  RollingMedianDiagram,
  SchoolPhasesDiagram,
  SchoolRadiusDiagram,
  SharedEstimateDiagram,
  StampDutyDiagram,
  TrendDiagram,
  WaffleDiagram,
} from "./diagrams";

export const GUIDE_GROUPS = ["Reading the map", "Prices", "Living here", "Buying a home", "Your match", "The data"] as const;
export type GuideGroup = (typeof GUIDE_GROUPS)[number];

/**
 * One guide article. Every article has the same shape: a one-line answer a
 * newcomer understands, a diagram, a worked example, how the figure is made,
 * and the fine print (caveats and licences, folded). `metricId` appends that
 * map metric's published description, caveats, source and licence.
 */
export interface GuideArticle {
  title: string;
  group: GuideGroup;
  answer: string;
  Diagram: ComponentType;
  caption: string;
  example: ReactNode;
  how: ReactNode;
  finePrint: ReactNode;
  metricId?: string;
  /** A long explainer's own sections after the example, each with an anchor (Schools 101). */
  sections?: readonly { id: string; title: string; body: ReactNode }[];
  /** The "How we calculate it" heading, when the article ranks rather than calculates. */
  howTitle?: string;
}

const PRICE_PAID_LICENCE =
  "Contains HM Land Registry data © Crown copyright and database right 2026. This data is licensed " +
  "under the Open Government Licence v3.0.";
const PUBLIC_SECTOR_LICENCE = "Contains public sector information licensed under the Open Government Licence v3.0.";
const ONS_LICENCE = "Source: Office for National Statistics licensed under the Open Government Licence v3.0.";

const pounds = (value: number) => `£${value.toLocaleString("en-GB")}`;
const bandRange = (band: { from: number; to: number | null }) =>
  band.to === null ? `above ${pounds(band.from)}` : `${pounds(band.from)} to ${pounds(band.to)}`;
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const GUIDE_ARTICLES: Record<GuideSlug, GuideArticle> = {
  "reading-the-map": {
    title: "Reading the map",
    group: "Reading the map",
    answer: "Each coloured shape is a small neighbourhood, and its colour shows how much of the chosen thing it has.",
    Diagram: NestingDiagram,
    caption: "Shapes nest: about 5,000 LSOAs make up about 1,000 MSOAs, which make up London's 33 boroughs.",
    example: (
      <p>
        Pick <strong>Recorded crime</strong>. A shape coloured like the low end of the legend had few crimes per
        1,000 residents; one coloured like the high end had many. Set the colour scale to <strong>London percentile</strong> and an
        area at the 80th percentile is coloured above four in five London areas, whatever its actual number.
      </p>
    ),
    how: (
      <ul>
        <li>The smallest shapes are LSOAs: official 2021 Census areas of roughly 1,000 to 3,000 people.</li>
        <li>Several LSOAs make an MSOA, and MSOAs make a borough.</li>
        <li>
          Each figure is drawn on the smallest shape its source supports. When the source is coarser, or too few
          things happened locally, the figure comes from the MSOA or borough instead, and the panel says so.
        </li>
        <li>
          <strong>Measured values</strong> colours each shape by its number against the legend.{" "}
          <strong>London percentile</strong> colours it by where it sits among all London areas.
        </li>
        <li>
          The <em>Compared with London</em> dots work the same way: more dots means more of that thing than most London
          areas, not better or worse.
        </li>
      </ul>
    ),
    finePrint: (
      <p>
        Personal matching starts at 2021 LSOA level. A metric can move to MSOA or borough when its source is coarser
        or its local sample is too small; the evidence panel always names that carrier. Streets and buildings are
        orientation context, while address selection can show recorded property history. We never paint an area
        statistic onto a street or house as if it had that precision.
      </p>
    ),
  },

  "home-cost": {
    title: "What a home costs here",
    group: "Prices",
    answer: "A rough price for a home of a chosen size: its floor area times the area's typical price per square metre.",
    Diagram: HomeCostDiagram,
    caption: "Floor area × typical price per m² = rough home cost.",
    example: (
      <p>
        A 2-bed of about 70 m² in an area where the typical price is £8,000 per m² comes to about
        <strong> £560,000</strong>. The same flat in an area at £5,500 per m² would be about £385,000.
      </p>
    ),
    how: (
      <ul>
        <li>Pick a size: 1-bed is taken as 50 m², 2-bed as 70 m², 3-bed as 95 m².</li>
        <li>
          Multiply it by the area&apos;s latest <Link href="/guide/price-per-m2">price per square metre</Link>: the
          median of homes sold there in the last 12 months.
        </li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>This is a rough guide, not a valuation. It knows nothing about a home&apos;s condition, layout, floor, outdoor space or tenure.</li>
        <li>The typical price mixes the houses and flats that happened to sell in the area; a 50 m² flat and a 50 m² house can sell for very different amounts.</li>
        <li>Where the area has too few sales, the price per m² (and so the home cost) comes from its MSOA or borough, and says so.</li>
        <li>The monthly cost comparison uses your own numbers side by side. It is not financial advice.</li>
      </ul>
    ),
  },

  "price-per-m2": {
    title: "Price per square metre",
    group: "Prices",
    answer: "The typical price paid for each square metre of floor space in homes sold here over the last 12 months.",
    Diagram: MedianDiagram,
    caption: "Each sale's price is divided by its floor area; the middle value of all the sales is the area's figure.",
    example: (
      <p>
        A 60 m² flat that sold for £480,000 is £8,000 per m². If the area&apos;s median is £8,000 per m², a 90 m² home
        there would cost roughly <strong>£720,000</strong>. Dividing by floor area lets you compare a studio with a
        family house.
      </p>
    ),
    how: (
      <ul>
        <li>Start from every standard sale recorded by HM Land Registry (Price Paid).</li>
        <li>Find each home&apos;s total floor area on its Energy Performance Certificate (EPC), and divide price by area.</li>
        <li>Take the median of the sales in the 12 months up to each month.</li>
        <li>An LSOA needs at least 20 qualifying sales in those 12 months. Fewer, and it shows its MSOA, then its borough figure, marked as a fallback.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>Only standard market sales count (Price Paid category A). Repossessions, buy-to-let and company sales (category B) and &quot;other&quot; property types are left out.</li>
        <li>Sales without an EPC floor area, under £20,000, outside 15–1,000 m², or outside £500–£40,000 per m² are left out.</li>
        <li>Land Registry registers sales with a lag of up to a few months, so the latest 12-month window is still filling.</li>
        <li>If no level has 20 sales, the figure is suppressed rather than guessed.</li>
      </ul>
    ),
    metricId: "price-per-square-metre",
  },

  "price-trend": {
    title: "Price trend",
    group: "Prices",
    answer: "How much the typical price per square metre has risen or fallen since the same month some years ago.",
    Diagram: TrendDiagram,
    caption: "Compare now with the same month 1, 3, 5, 10 or 20 years ago; on the map, arrows show which way each area moved.",
    example: (
      <p>
        In June 2021 an area&apos;s median was £6,400 per m²; in June 2026 it is £8,000. £8,000 ÷ £6,400 = 1.25, so
        prices there rose <strong>25% over 5 years</strong>.
      </p>
    ),
    how: (
      <ul>
        <li>Take the latest monthly <Link href="/guide/price-per-m2">price per m²</Link> and the one exactly 1, 3, 5, 10 or 20 years earlier.</li>
        <li>Change = (now ÷ then − 1) × 100%.</li>
        <li>If either end is missing, no change is shown. It is never filled in as 0%.</li>
        <li>On the map, the change scale colours areas from falling to rising, with ▲ and ▼ arrows when you zoom in close.</li>
        <li>On the sold-price map, <em>Growth</em> colours each home by the same change for its area.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>Changes are in pounds of the day, not adjusted for inflation.</li>
        <li>Both ends are medians of whatever sold, so a change can partly reflect which homes sold, not only what they were worth.</li>
        <li>An area on a fallback shows its MSOA or borough change.</li>
        <li>Forecasts describe area-level £/m² ranges, not individual homes, and are shown only after they have been checked against what really happened.</li>
      </ul>
    ),
  },

  "sold-prices": {
    title: "Sold prices",
    group: "Prices",
    answer: "Every recorded home sale in Greater London since 1995, one pin per home, from HM Land Registry.",
    Diagram: RollingMedianDiagram,
    caption: "Each dot is a sale. The area's price per m² is the median of the dots in the last 12 months.",
    example: (
      <p>
        Zoom into a street and tap a pin: <em>flat, leasehold, sold March 2019 for £415,000; before that £300,000 in
        2012</em>. That is about <strong>+4.7% a year</strong> between the two sales. Pins show recorded sales only,
        never a value for the home today.
      </p>
    ),
    how: (
      <ul>
        <li>One pin per home at its last recorded sale. Homes matched to an EPC sit at their exact address point; others sit at their postcode centre and look fainter.</li>
        <li>Zoomed out (zoom 11–14), pins merge into dots showing the median of homes sold in the last five years; a dot needs at least three homes.</li>
        <li>Unusual sales (repossessions, buy-to-let, company purchases) are shown and labelled, but never used for area prices.</li>
        <li>An owner can have their home hidden from search, history and the map through the <Link href="/privacy#hide-my-home">privacy notice</Link>.</li>
      </ul>
    ),
    finePrint: (
      <section data-testid="sold-prices-docs">
        <p>
          On the £/m² layers, <em>Show individual sales</em> places one pin per home at its last sale recorded by HM
          Land Registry Price Paid (Greater London, 1995 onwards). Homes matched to an EPC sit at their OS Open UPRN
          coordinate; others sit at their postcode centre and are drawn fainter. From zoom 15 each pin shows the sale
          price, date, type, tenure, new-build flag, the sale before it (with the annualised change between the two)
          and the area&apos;s growth. Between zoom 11 and 14 pins merge into dots of the median of homes sold in the
          last five years; a dot needs at least three homes. No pin carries a value for the home today.
        </p>
        <p>
          <em>Growth</em> colours each home by its area&apos;s change in the rolling 12-month median £/m² over 1, 3, 5,
          10 or 20 years (the LSOA index, or its MSOA/borough fallback). Non-standard sales (Price Paid category B:
          repossessions, buy-to-let and company purchases) are shown and labelled, but never enter the £/m² index or
          the area price ranges. &quot;Other&quot; property types are hidden until selected in the filters. A home with a
          confirmed privacy objection has no pin.
        </p>
        <p>
          Sale prices and addresses are public records. Price Paid addresses may be shown against the sale they belong
          to, but are not offered as an address list.
        </p>
        <p className="licence-note">{PRICE_PAID_LICENCE}</p>
      </section>
    ),
  },

  "stock-value": {
    title: "Stock value (area figure)",
    group: "Prices",
    answer: "An area's middle price per m² across its homes, each last sale moved forward by the area's price change. Never a value for one home.",
    Diagram: MedianDiagram,
    caption: "The middle of many homes' figures describes the area; no single home's figure is shown.",
    example: (
      <p>
        An area has 240 homes with a recorded sale and a floor area. Moving each last sale forward by the area&apos;s
        price change and taking the middle figure gives the area&apos;s <strong>stock value per m²</strong>. A home&apos;s
        own figure is never shown: on a home&apos;s page you see its recorded sales and{" "}
        <Link href="/guide/typical-price">prices in its area today</Link>.
      </p>
    ),
    how: (
      <ul>
        <li>Take each home&apos;s last standard sale that has a floor area, and move it forward by its LSOA&apos;s price per m² change since. The index starts in June 2006: a home whose last sale is older is not moved forward and is left out of the figure and its count, never treated as a June 2006 sale.</li>
        <li>The area figure is the median of those, shown only when the area has at least 10 such homes.</li>
        <li>Zoomed in, street blocks take their median when they hold three or more homes (fewer: the area&apos;s colour shows through). A sold home takes the coarse band of its last sale among similar homes sold in its area that year, from bottom 10% to top 10%; any other home takes its area&apos;s colour. Never a figure of its own.</li>
      </ul>
    ),
    finePrint: (
      <section data-testid="stock-value-docs">
        <p>
          Since 11 October 2026 Close Knit does not state what any single home is worth: no per-home estimate on the
          home&apos;s page, the map, the API or the agent tools. Restated sales are used only inside area statistics.
          From zoom 15 freehold parcels and dwellings are drawn as faint outlines over their area&apos;s colour (HM Land
          Registry INSPIRE index polygons; dwellings from OS Open UPRN). A home whose last recorded sale was a standard
          sale is filled with that sale&apos;s coarse band (bottom 10%, bottom quarter, lower middle, upper middle, top
          quarter, top 10%) against sales of the same type in its area that year, the position its page shows, only where
          that set holds at least 5 sales; a parcel of several homes, or with a hidden home on it, is never filled.
          Between zoom 12 and 14 the map shows street blocks, neighbouring parcels merged and cut along the OpenStreetMap
          road network, each coloured by the median £/m² of the homes inside it when it holds three or more.
        </p>
        <p data-testid="epc-use-note">
          Energy Performance Certificates link a sale to a UPRN and supply the floor area. For each home&apos;s latest
          certificate we also show the building facts: energy rating (current and potential), certificate date, property
          type, built form, age band, habitable rooms and floor level. The certificate&apos;s tenure (it describes the
          occupant), names, running costs, recommendations and address are never stored or served. Everything shown about a home is public-record data; an owner or occupier can have it hidden from
          search, history and the map through the <Link href="/privacy#hide-my-home">privacy notice</Link>.
        </p>
        <p className="licence-note">
          This information is subject to Crown copyright and database rights 2026 and is reproduced with the permission
          of HM Land Registry. The polygons (including the associated geometry, namely x, y co-ordinates) are subject to
          Crown copyright and database rights 2026 Ordnance Survey 100026316. Contains OS data © Crown copyright and
          database right 2026. Block boundaries follow roads from OpenStreetMap, © OpenStreetMap contributors, ODbL.
          {" "}
          <a href="https://use-land-property-data.service.gov.uk/datasets/inspire/#conditions">INSPIRE conditions of use</a>.
        </p>
      </section>
    ),
    metricId: "stock-value-per-square-metre",
  },

  "typical-price": {
    title: "Prices in an area today",
    group: "Prices",
    answer: "What the same kind of home sells for in an area now: recent sales adjusted to today, as a range. About the area, never one home.",
    Diagram: PriceBandsDiagram,
    caption: "Same-type sales since three years back, adjusted to today, in six bands. The middle half is the range we quote.",
    example: (
      <p>
        41 flats sold in a neighbourhood since January 2023. Adjusted to June 2026 by the local price index, the middle
        half of them sit between <strong>£520k and £760k</strong>: &quot;Flats here: most sell for £520k–£760k&quot;. A
        flat on that street that sold for £570,000 in November 2022 was in the <em>upper middle</em> of flat sales there
        that year, and today the upper middle of flat sales there is £620k–£760k. That describes the area&apos;s sales,
        not what that flat is worth: it can&apos;t see condition or improvements.
      </p>
    ),
    how: (
      <ul>
        <li>Take standard sales (no repossessions, buy-to-let or company purchases) of the same type: flat, terraced, semi-detached or detached, from HM Land Registry Price Paid.</li>
        <li>Use the home&apos;s small area (LSOA) when it has 20 or more such sales since 1 January three years back; otherwise the wider neighbourhood (MSOA), otherwise the borough. The card says which.</li>
        <li>Move each sale to the latest month with its area&apos;s price index (the rolling median price per m² of the LSOA), then take the 10th, 25th, 50th, 75th and 90th percentiles, rounded to £5,000.</li>
        <li>A home&apos;s last sale is placed in one of six coarse bands (bottom 10%, bottom quarter, lower middle, upper middle, top quarter, top 10%) against same-type sales in the same area that year. We never show a finer position.</li>
        <li>Below 5 sales of the type in the range, or 5 in that year, nothing is shown: only the recorded sales and a short note.</li>
        <li>The map layer <em>Typical home price</em> colours each area by the middle (median) adjusted price of a whole home, for all homes or one type: flats, terraced, semi-detached or detached.</li>
      </ul>
    ),
    finePrint: (
      <section data-testid="typical-price-docs">
        <p>
          No floor area enters these figures: they rank sale prices of the same type, not prices per m², so the size of
          one home is never used. The price index adjusts for how the market moved, not for the homes themselves:
          extensions, condition and the lease are invisible to it. A home hidden through{" "}
          <Link href="/privacy#hide-my-home">Report or hide this home</Link> has no page, so no position is shown for
          it; its sale still counts, anonymously, inside the area statistics.
        </p>
        <p className="licence-note">{PRICE_PAID_LICENCE}</p>
      </section>
    ),
    metricId: "typical-price",
  },

  crime: {
    title: "Recorded crime",
    group: "Living here",
    answer: "How many crimes the police recorded here in a year, for every 1,000 people who live here.",
    Diagram: CrimeRateDiagram,
    caption: "Crimes in the last 12 months ÷ residents × 1,000.",
    example: (
      <p>
        An LSOA of 1,800 residents had 54 crimes recorded in the year to June. 54 ÷ 1,800 × 1,000 =
        <strong> 30 crimes per 1,000 people</strong>. Untick crime types you don&apos;t care about and the colours
        stretch to fit only the ones you kept.
      </p>
    ),
    how: (
      <ul>
        <li>Count street-level crimes published by police.uk (each area&apos;s police force; in London the Metropolitan and City of London police) in the 12 months to each month.</li>
        <li>Divide by the number of residents (ONS mid-2024 estimates) and multiply by 1,000.</li>
        <li>For MSOAs and boroughs, add up the crimes and the residents first, then divide.</li>
        <li>Anti-social behaviour and British Transport Police records are left out of the rate.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>police.uk places each crime at an anonymous snap point. An LSOA with almost none of the crimes its MSOA rate predicts shows the MSOA rate instead, marked as a fallback.</li>
        <li>Rates use residents, so busy central areas with few residents and many visitors (the City, the West End) read high.</li>
        <li>Anti-social behaviour is listed separately by police.uk and is not in the headline rate.</li>
        <li>Where a police force did not publish every month of the 12, its areas show no figure for that window.</li>
      </ul>
    ),
    metricId: "crime",
  },

  deprivation: {
    title: "Deprivation",
    group: "Living here",
    answer: "An official ranking of how deprived each small area of England is, shown in tenths: 1 is the most deprived tenth, 10 the least.",
    Diagram: DecileDiagram,
    caption: "Every small area in England is ranked and split into ten equal groups (deciles).",
    example: (
      <p>
        An area in <strong>decile 6</strong> is less deprived than at least half of England&apos;s small areas, and more
        deprived than the 40% in deciles 7 to 10.
      </p>
    ),
    how: (
      <ul>
        <li>The figure is the Index of Multiple Deprivation from the English Indices of Deprivation 2025 (MHCLG).</li>
        <li>It combines income, employment, education, health, crime, barriers to housing and services, and the living environment.</li>
        <li>Every LSOA in England is ranked on it, and the ranks are cut into ten equal deciles.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>It is a rank, not an absolute amount: decile 1 means &quot;more deprived than most&quot;, not that everyone there is deprived.</li>
        <li>On the <em>Compared with London</em> dots, more dots means more deprived.</li>
        <li>An area&apos;s ranking figure is the average decile of the neighbourhoods inside it.</li>
      </ul>
    ),
    metricId: "deprivation",
  },

  income: {
    title: "Household income",
    group: "Living here",
    answer: "An official estimate of typical yearly household income for the wider neighbourhood (MSOA) the area sits in.",
    Diagram: SharedEstimateDiagram,
    caption: "Income is estimated for MSOAs, so every LSOA inside one shows the same figure.",
    example: (
      <p>
        If the MSOA estimate is <strong>£52,000 a year</strong>, all the LSOAs inside it show £52,000, even if one
        street is much better off than the next.
      </p>
    ),
    how: (
      <ul>
        <li>The Office for National Statistics models household income for each MSOA from survey and administrative data.</li>
        <li>We show that MSOA figure on each LSOA inside it, and label it as an MSOA figure.</li>
      </ul>
    ),
    finePrint: <p>The estimate describes a whole neighbourhood; it says nothing about any one household.</p>,
    metricId: "income",
  },

  "social-renting": {
    title: "Social renting",
    group: "Living here",
    answer: "The share of households here that rent from a council or housing association, from the 2021 Census.",
    Diagram: WaffleDiagram,
    caption: "29% means about 29 in every 100 households.",
    example: (
      <p>
        An LSOA showing <strong>29%</strong> had about 29 in every 100 households renting from a council or housing
        association on Census day, 21 March 2021.
      </p>
    ),
    how: (
      <ul>
        <li>Census 2021 asked every household how it occupies its home.</li>
        <li>Social renters ÷ all households in the LSOA = the share shown.</li>
        <li>No colour on this layer means good or bad: it only describes the mix of homes.</li>
      </ul>
    ),
    finePrint: <p>The Census is a snapshot of March 2021; tenure can change as estates are rebuilt or homes are sold.</p>,
    metricId: "social-renting",
  },

  schools: {
    title: "Schools nearby",
    group: "Living here",
    answer: "State-funded primary and secondary schools near the area, with their latest Ofsted grades and their key stage 2 or GCSE results.",
    Diagram: SchoolRadiusDiagram,
    caption: "Distances are straight lines from a point inside the area, not catchments.",
    example: (
      <p>
        The <em>Compared with London</em> card might say <strong>4 primary and 2 secondary schools within 1 km</strong>.
        The Schools tab then lists each one nearest first, for example a secondary 0.8 km away with its Ofsted grades
        and its 2024/25 GCSE results.
      </p>
    ),
    how: (
      <ul>
        <li>Schools come from the Ofsted register of state-funded schools.</li>
        <li>Each shows its Ofsted report-card grades (from November 2025) or, if it has none yet, its last overall judgement, labelled as a different scale.</li>
        <li>Primaries show Department for Education key stage 2 results for 2024/25: the share of pupils reaching the expected standard in reading, writing and maths, and the share reaching the higher standard. Progress scores are not published for 2024/25.</li>
        <li>Secondaries show Department for Education key stage 4 results for 2024/25: Attainment 8 and the share of pupils with grade 5 or above in English and maths. Progress 8 (how much pupils improve on their primary results; 0 is the national average) is not published for 2024/25, so schools show 2023/24, the latest year with it.</li>
        <li>The Schools tab lists up to 30 schools within 1.5 km; the <em>Compared with London</em> count uses 1 km.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>Distance is not a catchment and implies no chance of a place. Check each school&apos;s admissions.</li>
        <li>School admissions evidence is factual historical context, never a probability or guarantee.</li>
        <li>Report-card grades and legacy overall judgements are different scales and are never combined.</li>
        <li>Schools are placed at their postcode centre.</li>
        <li>The 2024/25 key stage 4 results are provisional; Progress 8 is not published for 2024/25.</li>
        <li className="licence-note">Ofsted state-funded schools inspections and outcomes; Ofsted inspection reports, © Crown copyright; Department for Education, Compare school and college performance; Department for Education, key stage 4 performance 2024/25 (provisional); Department for Education, Primary and secondary school applications and offers; Department for Education, Get Information About Schools; Lambeth Council and Harrow Council, school admissions: on-time offers. Contains public sector information licensed under the Open Government Licence v3.0.</li>
      </ul>
    ),
  },

  // Schools 101 (Menu v5 board): the long page behind the cards on /schools (lib/schools-101.ts);
  // each section's id is a card's anchor.
  "schools-101": {
    title: "Schools 101",
    group: "Living here",
    answer: "How English state schools work, for families new to the UK: the school years, school types, Ofsted grades, exam results and how to apply for a place.",
    Diagram: SchoolPhasesDiagram,
    caption: "Year groups run by age on 1 September. Tests come at 11 (SATs), 16 (GCSEs) and 18 (A levels).",
    example: (
      <p>
        A family moves to Hackney in summer with a 10-year-old and a 3-year-old. The older child starts Year 6 in
        September; the family applies to <strong>Hackney Council by 31 October</strong> for a secondary place the next
        September and hears on <strong>1 March</strong>. The younger child starts Reception the September after turning
        4: apply by <strong>15 January</strong>, offers on <strong>16 April</strong>. Both forms go to Hackney, even for a
        school in Islington.
      </p>
    ),
    sections: [
      {
        id: "phases", title: "The school years",
        body: (
          <ul>
            <li>Most children start <strong>Reception</strong> in the September after they turn 4; school is compulsory from the term after a child turns 5.</li>
            <li>A year group is everyone born from 1 September to 31 August. Children move up with their year, not by ability.</li>
            <li><strong>Primary</strong>: Reception and Years 1 to 6 (ages 4 to 11). Some areas split it into infant (to Year 2) and junior schools.</li>
            <li><strong>Secondary</strong>: Years 7 to 11 (ages 11 to 16), ending in GCSEs.</li>
            <li>From 16, young people in England stay in education or training until 18: a <strong>sixth form</strong> or college (A levels, T levels), or an apprenticeship.</li>
            <li><strong>Nursery</strong> from 3 is optional; every 3- and 4-year-old can have 15 free hours a week.</li>
          </ul>
        ),
      },
      {
        id: "types", title: "Types of school",
        body: (
          <ul>
            <li>All state schools are free. <strong>Community</strong> schools are run by the council, which also runs their admissions.</li>
            <li><strong>Academies</strong> and <strong>free schools</strong> are state schools run by trusts funded directly by government. They follow the national curriculum loosely and set their own admissions, within the national code.</li>
            <li><strong>Voluntary aided</strong>, <strong>foundation</strong> and many <strong>faith</strong> schools also set their own admissions.</li>
            <li><strong>Grammar</strong> schools select by a test, the 11-plus, taken at the start of Year 6. London has them in a few outer boroughs only.</li>
            <li><strong>Special</strong> schools teach pupils with special educational needs; a place usually comes through an education, health and care (EHC) plan.</li>
            <li><strong>Independent</strong> (private) schools charge fees, set their own rules and are inspected by Ofsted or the Independent Schools Inspectorate.</li>
          </ul>
        ),
      },
      {
        id: "ofsted", title: "Ofsted grades",
        body: (
          <ul>
            <li>Ofsted inspects every state school in England, usually every few years, and publishes the report.</li>
            <li>Until September 2024 each inspection gave one overall grade: <strong>Outstanding</strong>, <strong>Good</strong>, <strong>Requires improvement</strong> or <strong>Inadequate</strong>.</li>
            <li>Many schools still show that grade. Read its date: Outstanding schools were not routinely inspected from 2012 to 2020, so some grades are over ten years old.</li>
            <li>From September 2024 to November 2025, inspections graded the separate areas only, with no overall word.</li>
          </ul>
        ),
      },
      {
        id: "report-cards", title: "Report cards (since November 2025)",
        body: (
          <ul>
            <li>Inspections since 10 November 2025 give a <strong>report card</strong>: each area gets one of five grades, <strong>exceptional</strong>, <strong>strong standard</strong>, <strong>expected standard</strong>, <strong>needs attention</strong> or <strong>urgent improvement</strong>.</li>
            <li>The areas include inclusion, curriculum and teaching, achievement, attendance and behaviour, personal development and well-being, and leadership; early years and sixth form where the school has them. Safeguarding is met or not met.</li>
            <li>There is no overall grade. We show each area and never turn a report card into an old-style grade, or compare the two scales.</li>
          </ul>
        ),
      },
      {
        id: "ks2", title: "Primary results: key stage 2",
        body: (
          <ul>
            <li>In May of Year 6, pupils sit tests (SATs) in reading, maths, and grammar, punctuation and spelling. Teachers assess writing.</li>
            <li>Scores are scaled: 100 is the expected standard, 110 or more the higher standard.</li>
            <li>The headline is the share of pupils at the expected standard in reading, writing and maths together. School pages show it; London ranks primaries by Ofsted only so far.</li>
          </ul>
        ),
      },
      {
        id: "attainment-progress", title: "Secondary results: Attainment 8 and Progress 8",
        body: (
          <ul>
            <li><strong>Attainment 8</strong> adds a pupil&apos;s grades in eight GCSE slots: English and maths (each counted twice), three EBacc subjects and three others. A school&apos;s score is the average; 50 is about a grade 5 in each subject.</li>
            <li><strong>Progress 8</strong> compares each pupil&apos;s Attainment 8 with pupils across England who had the same results at 11. 0 is average; +1 means a grade higher in every subject.</li>
            <li>Progress 8 needs the tests at 11, which were cancelled in 2020 and 2021, so none is published for 2024/25. School pages show 2023/24, the latest year with it.</li>
          </ul>
        ),
      },
      {
        id: "grade-5", title: "Grade 5 in English and maths, and the EBacc",
        body: (
          <ul>
            <li>GCSEs are graded 9 (highest) to 1. A 4 is a standard pass, a 5 a strong pass. Pupils without a 4 in English and maths keep studying them after 16.</li>
            <li>The headline is the share of pupils with grade 5 or above in both English and maths.</li>
            <li>The <strong>English Baccalaureate</strong> (EBacc) is a set of GCSEs: English, maths, sciences, a language, and history or geography. We do not rank it yet.</li>
          </ul>
        ),
      },
      {
        id: "catchment", title: "Admissions: catchment and the last distance offered",
        body: (
          <ul>
            <li>When a school has more applicants than places, it ranks them by its published <strong>oversubscription criteria</strong>. By law, children in care and previously in care come first; a child whose EHC plan names the school gets a place before the rest.</li>
            <li>Most schools then put siblings, then distance from home, measured their own way. Some have a catchment area or feeder schools instead.</li>
            <li>The <strong>last distance offered</strong> is how far from the school the last place went on offer day. It moves every year with the number of siblings and applicants: a home inside last year&apos;s distance is a hint, not a place.</li>
            <li>Councils check addresses. A temporary or borrowed address can lose a place.</li>
          </ul>
        ),
      },
      {
        id: "faith", title: "Admissions: faith schools",
        body: (
          <ul>
            <li>When full, a faith school may put families of its faith first, usually with a supplementary form and a reference from a faith leader about regular worship, often over one or two years.</li>
            <li>A faith free school can give faith priority to at most half its places.</li>
            <li>Rules differ school by school; read each school&apos;s admissions policy before counting on a place.</li>
          </ul>
        ),
      },
      {
        id: "appeals", title: "Appeals and waiting lists",
        body: (
          <ul>
            <li>If you are refused a school, you can <strong>appeal</strong> to an independent panel. The offer letter says how and by when.</li>
            <li>You can also join the <strong>waiting list</strong>. It is kept in the order of the school&apos;s criteria, not the date you joined.</li>
            <li>Infant classes (Reception to Year 2) are limited by law to 30 pupils per teacher, so appeals for them rarely succeed.</li>
            <li>Arriving during the school year? Apply for an <strong>in-year</strong> place through your council or the school.</li>
          </ul>
        ),
      },
      {
        id: "key-dates", title: "Key dates",
        body: (
          <ul>
            <li><strong>Secondary</strong> (Year 7): apply in the autumn of Year 6, by <strong>31 October</strong>. Offers on <strong>1 March</strong>.</li>
            <li><strong>Primary</strong> (Reception, and junior schools at Year 3): apply by <strong>15 January</strong>. Offers on <strong>16 April</strong>.</li>
            <li>Apply to the council where you live, even for schools in another borough. London&apos;s councils share one scheme: list up to <strong>six</strong> schools in order of preference.</li>
            <li>The address that counts is where the child lives on the closing date. A form after the deadline is late and is looked at after the others.</li>
          </ul>
        ),
      },
    ],
    howTitle: "How we rank",
    how: (
      <ul>
        <li>Each list on <Link href="/schools">Schools</Link> and <Link href="/rankings">Rankings</Link> is one published measure for one phase: London state schools, latest year.</li>
        <li>Results lists count schools with 30 or more pupils in the year, from Department for Education performance tables.</li>
        <li>Ofsted lists use one framework each: the old overall grade, or report-card areas graded exceptional. The two are never combined.</li>
        <li>A rank says nothing about fit, travel or your chance of a place. Use it with the school&apos;s page, its admissions rules and a visit.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>This is general information for England, not advice. Admissions rules differ by school and council and change every year; the council&apos;s and the school&apos;s published arrangements decide.</li>
        <li>Sources: GOV.UK, <a href="https://www.gov.uk/schools-admissions">School admissions</a>, <a href="https://www.gov.uk/types-of-school">Types of school</a>, <a href="https://www.gov.uk/national-curriculum">The national curriculum</a>; Ofsted, <a href="https://www.gov.uk/government/organisations/ofsted">inspections and report cards</a> and <a href="https://reports.ofsted.gov.uk/">inspection reports</a>; Department for Education, <a href="https://www.compare-school-performance.service.gov.uk/">Compare school and college performance</a> and the School Admissions Code.</li>
        <li className="licence-note">Contains public sector information licensed under the Open Government Licence v3.0.</li>
      </ul>
    ),
  },

  noise: {
    title: "Road, rail and aircraft noise",
    group: "Living here",
    answer: "How many homes here sit in loud road, rail or aircraft noise, read from the government's official noise maps.",
    Diagram: NoiseScaleDiagram,
    caption: "Each home gets the mapped level at its address point; the area shows the share at 55 dB and 65 dB or more.",
    example: (
      <p>
        If 3 of an area&apos;s 10 homes are mapped at 55 dB or more, the area shows <strong>30% of homes at 55 dB+</strong>.
        A single home might read <em>road 61.2 dB · rail under 40 dB (not mapped)</em>.
      </p>
    ),
    how: (
      <ul>
        <li>Defra&apos;s strategic noise maps (Round 4, 2022) model road, rail and airport noise across England.</li>
        <li>Levels are Lden: a 24-hour average in which evening and night noise counts extra.</li>
        <li>Each home is read at its OS Open UPRN point; the area shows the share of its homes at 55 dB or more (road, rail, aircraft or any of them) and at 65 dB or more.</li>
      </ul>
    ),
    finePrint: (
      <>
        <ul>
          <li>Modelled annual averages at 4 m above ground on a 10 m grid, not measurements.</li>
          <li>Levels under 40 dB Lden are not mapped; aircraft noise is included where the load carries it (the current release does: road and rail 2022, airports 2021 operations).</li>
          <li>Each home is read at its OS Open UPRN point, which may sit at the building centre.</li>
        </ul>
        <p>
          Road, rail and airports are separate Defra layers from the same round, each read at every home; the area counts a home
          once when any of them reaches the threshold. A home with no mapped level is under 40 dB Lden or outside the model,
          not silent.
        </p>
        <p><strong>Modelled:</strong> Strategic modelled road, rail and aircraft exposure (Lden): useful for comparing places, never a prediction of what a visit will sound like.</p>
        <p><strong>Measured:</strong> {describeReadingKind("measured")}</p>
        <p className="licence-note">
          Defra strategic noise mapping Round 4 (2022), road, rail and airports. Contains public sector information licensed under
          the Open Government Licence v3.0.
        </p>
      </>
    ),
  },

  "clean-air": {
    title: "Clean air",
    group: "Living here",
    answer: "How much nitrogen dioxide (NO₂) the air holds where an area's homes are, from the GLA's model of London's air.",
    Diagram: AirScaleDiagram,
    caption: "Each home is read on the 20 m grid; the area shows the mean over its homes. Lower is cleaner.",
    example: (
      <p>
        An area whose homes read 18, 21 and 27 µg/m³ shows <strong>NO₂ 22.0 µg/m³</strong>: above the WHO guideline
        of 10, under the UK legal limit of 40.
      </p>
    ),
    how: (
      <ul>
        <li>The London Atmospheric Emissions Inventory 2022 models yearly mean NO₂ and PM2.5 on a 20 m grid.</li>
        <li>Each home is read at its OS Open UPRN point; the area value is the mean over its homes.</li>
        <li>The map colours each neighbourhood by its NO₂; the area card adds PM2.5 and London&apos;s rank.</li>
      </ul>
    ),
    finePrint: (
      <>
        <ul>
          <li>Modelled yearly means, not measurements; levels next to a busy road change within metres.</li>
          <li>Areas with fewer than 10 homes read show no value.</li>
        </ul>
        <p className="licence-note">
          London Atmospheric Emissions Inventory 2022, Greater London Authority and Transport for London (London
          Datastore).
        </p>
      </>
    ),
  },

  nature: {
    title: "Nature and wildlife",
    group: "Living here",
    answer: "How green an area is, how many street trees it has, how close a nature reserve is, and which animals people have recorded nearby.",
    Diagram: WildlifeShareDiagram,
    caption: "Wildlife is shown as a share of the records made nearby, so areas with many observers and areas with few compare fairly.",
    example: (
      <p>
        An area with <strong>46% green land</strong>, <strong>9 street trees per hectare</strong> and a nature reserve 600 m away
        ranks well on Nature. If 11 of every 100 records within 1 km are hedgehogs, the hedgehog map shades it <em>Often</em>.
      </p>
    ),
    how: (
      <ul>
        <li>Green land: Sentinel-2 satellite images from June and July 2025. Each 10 m square counts as green when its NDVI is 0.4 or more.</li>
        <li>Street trees: the GLA list of council, TfL and Royal Parks trees (Nov 2025), per hectare of the area.</li>
        <li>Nature sites: Natural England Local Nature Reserves and SSSIs. The Nature rank combines all three as London ranks.</li>
        <li>Wildlife seen: bird, mammal and amphibian records on GBIF within 1 km (2021–2025, CC0 or CC BY only). Each species is shown as its share of those records.</li>
      </ul>
    ),
    finePrint: (
      <>
        <ul>
          <li>Records follow where people look. &quot;No record&quot; never means absent, and areas with under 200 records are grey.</li>
          <li>Badgers, breeding raptors and other sensitive species are never mapped; no single sighting is ever shown.</li>
          <li>Satellite greenness counts gardens and green roofs as well as parks; it says nothing about access.</li>
          <li>Borough Sites of Importance for Nature Conservation are not openly licensed and are not included.</li>
        </ul>
        <p className="licence-note">
          Contains modified Copernicus Sentinel data (2025). Greater London Authority, London Datastore: Local Authority
          Maintained Trees, and © Natural England, both under the Open Government Licence v3.0. GBIF.org occurrence records,
          CC0 and CC BY 4.0.
        </p>
      </>
    ),
  },

  flood: {
    title: "Flood risk",
    group: "Living here",
    answer: "How likely flooding is here, from the Environment Agency's maps of rivers and the sea and of heavy rain (surface water).",
    Diagram: FloodShareDiagram,
    caption: "The share describes the area's outline, not every building in it.",
    example: (
      <p>
        If 18% of an area&apos;s outline falls inside the mapped extent, the area shows <strong>18% exposed</strong>.
        Most of its buildings may still be outside that corner; check a specific address with the official service.
      </p>
    ),
    how: (
      <ul>
        <li>The Environment Agency maps four bands, each a chance of flooding in any one year: very low (less than 1 in 1,000), low (1 in 1,000 to 1 in 100), medium (1 in 100 to 1 in 30) and high (more than 1 in 30).</li>
        <li>For an area we show the share of its land in each band and the highest band that covers at least 1% of the land. Rivers, lakes and reservoirs are left out, because the maps mark open water itself as high risk.</li>
        <li>For a home we show the band at its location.</li>
        <li>Rivers and sea, and surface water, are shown separately and never merged.</li>
        <li>No data means unknown, never very low.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>{AREA_LEVEL_NOTE}</li>
        <li>The bands come from the Environment Agency&apos;s national flood risk assessment (NaFRA2); they do not predict insurance costs or account for a building&apos;s own defences.</li>
        <li>Demo mode shows made-up screening for a few preview areas.</li>
        <li>Contains public sector information licensed under the Open Government Licence v3.0 (Environment Agency).</li>
        <li>For a specific property, use the <a href={FLOOD_CHECK_URL}>official long-term flood risk check</a>.</li>
      </ul>
    ),
  },

  planning: {
    title: "Planning applications",
    group: "Living here",
    answer: "Recent planning applications near the area, so you can see what might change. Not whether it will.",
    Diagram: PlanningStagesDiagram,
    caption: "Each record keeps its stage; withdrawn applications stay labelled instead of disappearing.",
    example: (
      <p>
        A proposal <em>awaiting decision</em> in a conservation area shows as <strong>planned</strong>. Once granted it
        shows as <strong>approved</strong>, and each record links to the council&apos;s own register.
      </p>
    ),
    how: (
      <ul>
        <li>Records come from the national Planning Data planning-application dataset ({REVIEWED_PLANNING_SOURCE.authority}).</li>
        <li>The pilot covers {REVIEWED_PLANNING_SOURCE.coverage.replace(/^Pilot: /, "")}. Other boroughs show no coverage: unknown, not empty.</li>
        <li>Duplicate references collapse to the latest entry; withdrawn applications are counted and labelled but left out of the results.</li>
        <li>Each record has a currency check: an old update is marked stale, and you are asked to confirm on the council register.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>There is no planning-risk score: a proposal nearby never decides for you.</li>
        <li>An empty search names the dataset covered; it never claims there is no development.</li>
        <li>Dataset updated {REVIEWED_PLANNING_SOURCE.datasetUpdated}, reviewed {REVIEWED_PLANNING_SOURCE.reviewDate}.</li>
        <li>With real data the card counts the area&apos;s planning applications over the last two years, next to its conservation areas and charging zones; the staged pilot records are demo only.</li>
      </ul>
    ),
  },

  "people-and-homes": {
    title: "Homes here",
    group: "Living here",
    answer: "What homes an area has, who lives there and how built-up it is: home type, tenure, households, age, ethnic group, country of birth, religion and density, beside London's.",
    Diagram: PeopleShareDiagram,
    caption: "Each bar is this area's share; the thin line is London's share of the same answer.",
    example: (
      <p>
        An area with 1,600 residents on 0.25 km² has <strong>6,400 people per km²</strong>. In its tenure bar, 35% of
        households rent privately. If the thin line sits at 30%, private renting is a little more common here than
        across London as a whole.
      </p>
    ),
    how: (
      <ul>
        <li>Residents come from the ONS mid-2024 population estimates for each LSOA (revised November 2025).</li>
        <li>
          Density is residents divided by the area&apos;s size in km². London&apos;s figure is all boroughs&apos;
          residents divided by their total size.
        </li>
        <li>
          The bars come from Census 2021: type of home, whether it is owned or rented, household type,
          residents&apos; age, ethnic group, country of birth (by part of the world) and religion. Qualifications and
          jobs are not shown.
        </li>
        <li>
          The same answers colour the map (People, and Tenure and Accommodation type under Homes &amp; area): each
          area&apos;s share of one answer, on a calm colour scale where neither end is better. They describe an area;
          we never rank areas by them or use them to match areas to you.
        </li>
        <li>
          Religion included: never a filter, a My match weight, a ranking or a custom criterion. AI agents using
          Close Knit get the same rule: quote the share with its source and year, nothing more.
        </li>
        <li>Each share is one answer&apos;s count divided by everyone who answered that question in the area.</li>
        <li>
          We load each LSOA, then add LSOAs together for MSOAs and boroughs. London&apos;s share is the sum over all
          London LSOAs.
        </li>
        <li>For every LSOA, a topic&apos;s answers must add up to the published total, or the load stops.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>Census counts are from Census day, 21 March 2021, during coronavirus restrictions. Residents are a mid-2024 estimate, so the two describe different years.</li>
        <li>ONS adjusts small counts slightly to protect privacy, so our MSOA and borough sums can differ a little from figures ONS publishes for those areas.</li>
        <li>Density counts parks, rivers and railways as area, so busy streets can feel more crowded than the number says.</li>
        <li>The religion question was optional. Occupation counts people in work in the week before the census and describes where they live, not where they work.</li>
        <li>Age groups follow the census&apos;s five-year bands, so they start 0 to 14 and 15 to 24.</li>
        <li>Household type groups the census&apos;s household composition: families where everyone is 66 or over count as a couple with no children, couples whose children are all grown up count as a couple with children, and other, including shared, covers flatmates, students and homes with more than one family.</li>
        <li>
          Country of birth is by part of the world for every area, and ethnic group by its 5 groups and 19 detailed ones.
          The detailed tables go further: one country of birth (190), an ethnic group as people wrote it in (Japanese,
          Polish, …), a passport, a national identity or a belief. ONS publishes these down to MSOAs of about 8,000
          residents only, so on the map each MSOA is one colour: they never show a street or an LSOA. Main language and
          year of arrival are per area. A group needs 1,000 residents across London to be on the list.
        </li>
        <li>An ethnic group written in counts the people who wrote it under the broad group in brackets: Japanese (Asian) and Japanese (Other) are two lists.</li>
        <li>A topic with no data says unknown, never zero.</li>
        <li className="licence-note">
          ONS Census 2021 tables TS003, TS004, TS007A, TS012, TS013, TS015, TS021, TS022, TS028, TS030, TS031, TS044, TS054, TS063, TS066 and TS067 (Nomis), country of birth and main language from the ONS API, and ONS mid-2024 LSOA
          population estimates. {ONS_LICENCE}
        </li>
      </ul>
    ),
  },

  "getting-around": {
    title: "Getting around and nearby",
    group: "Living here",
    answer: "Stations, parks and everyday places near the area, and a 1 to 10 score for how easy it is to get around by train.",
    Diagram: ConnectivityDiagram,
    caption: "A station within 400 m counts fully, then less and less, and nothing past 1,200 m.",
    example: (
      <p>
        Station A is 300 m away with two tube lines: 2 points. Station B is 800 m away with one Overground line, and
        at that distance counts half: 0.5. Station C, 1,500 m away, is out of reach. 2.5 points give a score of
        <strong> 7 out of 10</strong>.
      </p>
    ),
    how: (
      <ul>
        <li>Distances are straight lines from the area&apos;s centre, or from the home on a property page.</li>
        <li>
          The score adds up every station within 1,200 m (about a 15-minute walk). A station within 400 m counts fully;
          further away it counts less, down to nothing at 1,200 m.
        </li>
        <li>
          Each line at a station adds to it: tube, Elizabeth line, DLR and Overground lines 1 each, trams 0.7 and
          National Rail 0.6, because they run less often. One station counts at most 4.
        </li>
        <li>
          The points become 1 to 10 on a curve where the first nearby station lifts the score most. 1 means no station
          within 1,200 m; 10 starts at 6 points, about the best-connected twentieth of London neighbourhoods. A typical
          neighbourhood scores 5.
        </li>
        <li>Stations: the 6 nearest within 3 km, with fare zones and lines from TfL.</li>
        <li>
          Parks and green spaces: the 6 nearest within 2 km, measured to their nearest edge and sized by the London
          Plan&apos;s classes, from pocket parks under 0.4 hectares to regional parks over 400.
        </li>
        <li>
          Everyday places: supermarkets and corner shops, pubs and bars, cafés and restaurants, pharmacies and GPs. We
          show the 5 nearest of each within 1.5 km and count how many are within 800 m, about a 10-minute walk.
        </li>
        <li id="station-access" data-testid="station-access-docs">
          Walk to a station: each home is joined to the nearest OpenStreetMap path or street. The shortest walk to a
          rail, tube, metro, Overground, Elizabeth line, DLR or tram station entrance is timed at 4.8 km/h. An
          area&apos;s figure is the median over its homes, with the share of homes within 10 minutes. As a match
          factor, fewer minutes rank higher.
        </li>
        <li id="food-hygiene" data-testid="food-hygiene-docs">
          Food hygiene nearby: of the cafés, restaurants, canteens, takeaways, sandwich shops, pubs and bars within 800 m
          in a straight line of the area&apos;s centre that have a Food Hygiene Rating Scheme rating (0 to 5), the share
          rated 4 or 5. Exempt places and those awaiting inspection are left out, and an area with fewer than 5 rated
          places nearby shows no share. It describes the food places, not the people who live in the area.
        </li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>Buses are not counted in the score.</li>
        <li>
          Walk times skip motorways, trunk roads without a footway and private paths. Lifts, stairs, crossings and
          waiting are not timed. Stations up to 10 km beyond the region count; walks over about two hours can read
          long. Outside London, homes are the addresses with an energy certificate (EPC).
        </li>
        <li>Distances are straight lines, not walking routes; a river or railway can make the real walk longer.</li>
        <li>OpenStreetMap is kept up to date by volunteers, so a new shop or a closed pub may be missing.</li>
        <li>Fare zones and lines are TfL&apos;s; a station TfL does not list shows them as unknown.</li>
        <li>When no places are loaded the page says unknown, never &quot;nothing nearby&quot;.</li>
        <li className="licence-note">
          Places: OpenStreetMap (Geofabrik England extract, 20 October 2026), © OpenStreetMap contributors,
          Open Database Licence 1.0.
        </li>
        <li className="licence-note">
          Walk to a station: built from OpenStreetMap, © OpenStreetMap contributors, ODbL. Only the station list and
          area aggregates are published; the walking network is not redistributed.
        </li>
        <li>
          A food hygiene rating describes the business on the day of its last inspection, which can be months or years
          ago.
        </li>
        <li className="licence-note">
          Food hygiene ratings: Food Standards Agency (ratings.food.gov.uk), extract of 6 October 2026. Contains public
          sector information licensed under the Open Government Licence v3.0.
        </li>
        <li className="licence-note">
          Zones and lines: Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016 and
          Geomni UK Map data © and database rights [2019]. This is not endorsed by TfL.
        </li>
      </ul>
    ),
  },

  "local-government": {
    title: "Council, council tax and representatives",
    group: "Living here",
    answer: "Which council, ward and constituency a place is in, what each council tax band costs there, and who represents it.",
    Diagram: CouncilTaxDiagram,
    caption: "Each band pays a fixed share of Band D, set in law: band A pays 6/9 of it and band H 18/9.",
    example: (
      <p>
        If a borough&apos;s average Band D is £1,800 a year, band A pays <strong>£1,200</strong>, band E £2,200 and
        band H £3,600. An area whose postcodes sit 70% in one ward and 30% in another lists the councillors of both
        wards.
      </p>
    ),
    how: (
      <ul>
        <li>
          Where a place sits (borough, ward, constituency, police force and official codes) comes from the ONS Postcode
          Directory, August 2026, London postcodes only.
        </li>
        <li>
          A neighbourhood is linked to wards and constituencies by its share of live postcodes, so one that crosses a
          boundary lists both sides. We list councillors and MPs for every ward or constituency holding at least 20%
          of its postcodes, and always the largest.
        </li>
        <li>
          Council tax is the borough&apos;s average Band D for 2026-27 from the government&apos;s council tax tables,
          including the Greater London Authority&apos;s share and any parish charge.
        </li>
        <li>Bands A to H are worked out from Band D with the legal ratios: 6, 7, 8, 9, 11, 13, 15 and 18 ninths.</li>
        <li>
          Councillors are the winners of the 7 May 2026 borough elections (March 2025 in the City of London) and any
          later by-elections, from Democracy Club. MPs are the current members from the UK Parliament. Each list shows
          the day we checked.
        </li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>Council tax figures are borough averages, including an average parish charge. A council&apos;s own band amounts can differ from ours by pennies.</li>
        <li>Each home&apos;s band is set from its value in 1991; we do not know the band of a single home.</li>
        <li>Postcodes are placed in wards and constituencies by their ONS grid reference.</li>
        <li>A councillor who stood down without a by-election may still be listed.</li>
        <li className="licence-note">
          Source: Office for National Statistics licensed under the Open Government Licence v.3.0. Contains OS data ©
          Crown copyright and database right 2026. Contains Royal Mail data © Royal Mail copyright and database right
          2026.
        </li>
        <li className="licence-note">Council tax: MHCLG, Council Tax levels set by local authorities in England 2026-27. {PUBLIC_SECTOR_LICENCE}</li>
        <li className="licence-note">Councillor data from Democracy Club (democracyclub.org.uk), CC BY 4.0.</li>
        <li className="licence-note">Contains Parliamentary information licensed under the Open Parliament Licence v3.0.</li>
      </ul>
    ),
  },

  "local-market": {
    title: "Homes sold nearby",
    group: "Prices",
    answer: "What homes here really sold for in the last 12 months: the middle price, how spread out prices were, ten years of trend, recent sales.",
    Diagram: MarketSpreadDiagram,
    caption: "Too few sales in a small area? The bigger area around it is used, and the panel names it.",
    example: (
      <p>
        A neighbourhood had 7 ordinary sales in the last 12 months, fewer than the 10 we need, so the panel shows its
        MSOA with 64 sales. There half the homes sold for under <strong>£520,000</strong>, the middle half for
        £450,000 to £640,000, and all but the cheapest and dearest 5% for £330,000 to £850,000.
      </p>
    ),
    how: (
      <ul>
        <li>Sales come from HM Land Registry Price Paid: standard market sales only (category A), of £10,000 or more.</li>
        <li>Figures are split by type of home (detached, semi-detached, terraced, flat, other) and given for all types together.</li>
        <li>
          The middle price (median), lowest and highest need at least 3 sales; the 5th, 25th, 75th and 95th
          percentiles need at least 5. Percentiles sit between neighbouring sales when they fall between two.
        </li>
        <li>
          Price per m² divides each price by the floor area on the home&apos;s{" "}
          <Link href="/guide/energy-rating">energy certificate</Link>; its median needs 3 sales with one.
        </li>
        <li>A neighbourhood with fewer than 10 sales in the latest 12 months is widened to its MSOA, then its borough.</li>
        <li>The trend has 11 points, each covering 12 months: the newest ends at the latest month with sales, and each earlier one a year before.</li>
        <li>Recent sales list the last 18 months, nearest or newest first.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>Sales take weeks or months to appear in the public record, so the newest months look thin.</li>
        <li>A year&apos;s middle price depends on which homes happened to sell, not only on prices changing.</li>
        <li>Too few sales shows unknown or a gap in the trend, never 0.</li>
        <li>Homes whose owners asked to hide them are left out of the recent sales.</li>
        <li className="licence-note">{PRICE_PAID_LICENCE}</li>
        <li className="licence-note">Floor areas: Energy Performance Certificates, MHCLG. {PUBLIC_SECTOR_LICENCE}</li>
      </ul>
    ),
  },

  "energy-rating": {
    title: "Energy rating and home facts",
    group: "Buying a home",
    answer: "A home's energy band from A (most efficient) to G (least), with its size, age and rooms, from its latest energy certificate.",
    Diagram: EnergyRatingDiagram,
    caption: "The rating now, and the rating the certificate says the home could reach.",
    example: (
      <p>
        A flat shows <strong>Energy rating D (could reach C)</strong>, 64 m², 3 habitable rooms and a certificate
        from 2016. Anything done to the flat since 2016, such as new windows, is not in that rating.
      </p>
    ),
    how: (
      <ul>
        <li>
          Energy Performance Certificates are matched to a home by address within the same postcode. We keep the
          latest certificate for each home.
        </li>
        <li>
          From it we show the current and potential rating, the certificate date, the kind of building, when it was
          built (an age band), total floor area, habitable rooms and floor level.
        </li>
        <li>Type of home and tenure (freehold or leasehold) come from its last Land Registry sale record instead.</li>
        <li>
          The floor area is also what turns a sale price into a{" "}
          <Link href="/guide/price-per-m2">price per square metre</Link>.
        </li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>A certificate can be years old. Check its date before you rely on the rating, size or rooms.</li>
        <li>Matching is by address. A home whose address is written differently, or that has no certificate, shows unknown; we never guess a floor area.</li>
        <li>The rating does not feed the area price ranges, which use only sale prices of the same type of home.</li>
        <li className="licence-note">
          Energy Performance Certificates, MHCLG (open data). {PUBLIC_SECTOR_LICENCE} Certificate addresses are used
          only to match homes and are not shown.
        </li>
      </ul>
    ),
  },

  "stamp-duty": {
    title: "Stamp duty",
    group: "Buying a home",
    answer: "The tax you pay when you buy a home in England. The price is cut into slices, and each slice is taxed at its own rate.",
    Diagram: StampDutyDiagram,
    caption: "£500,000 at standard rates: £0 + £2,500 + £12,500 = £15,000.",
    example: (
      <p>
        A £500,000 home costs <strong>£15,000</strong> in stamp duty at standard rates. A first-time buyer pays
        nothing on the first £300,000 of a £450,000 home and 5% on the rest: £7,500. At £520,000 the first-time buyer
        relief is lost entirely and the bill is £16,000. Someone who will own another home pays £40,000 on £500,000.
        Try your own numbers in the <Link href="/tools/stamp-duty">stamp duty calculator</Link>.
      </p>
    ),
    how: (
      <ul>
        <li>
          Standard rates (from {longDate(SDLT.standardFrom)}):{" "}
          {SDLT.standard.map((band) => `${band.ratePct}% ${bandRange(band)}`).join("; ")}.
        </li>
        <li>
          First-time buyers (from {longDate(SDLT.firstTimeBuyerFrom)}):{" "}
          {SDLT.firstTimeBuyer.map((band) => `${band.ratePct}% ${bandRange(band)}`).join("; ")}. Above{" "}
          {pounds(SDLT.firstTimeBuyerMaxPrice)} standard rates apply to the whole price.
        </li>
        <li>
          Buying when you will own more than one home (from {longDate(SDLT.additionalPropertyFrom)}) adds{" "}
          {SDLT.additionalPropertySurchargePct} percentage points to every slice, unless the price is under{" "}
          {pounds(SDLT.additionalPropertyMinPrice)}.
        </li>
        <li>Buyers who are not UK resident for stamp duty (from {longDate(SDLT.nonResidentFrom)}) add {SDLT.nonResidentSurchargePct} points to every slice.</li>
        <li>The total is rounded down to the whole pound, as HMRC does.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>Rates were checked as in force on {longDate(SDLT.inForceOn)}. They change with budgets; check gov.uk before you rely on them.</li>
        <li>England only, for people buying homes. Not covered: companies, six or more homes in one purchase, shared ownership, rent on new leases, and reliefs other than first-time buyer.</li>
        <li>First-time buyer relief does not apply if you will own another home after the purchase.</li>
        <li>{NOT_ADVICE}</li>
        <li className="licence-note">
          Rates from gov.uk:{" "}
          {SDLT.sources.map((source, index) => (
            <span key={source.url}>{index > 0 && "; "}<a href={source.url}>{source.label}</a></span>
          ))}.
        </li>
      </ul>
    ),
  },

  "mortgage-rates": {
    title: "Mortgage rates",
    group: "Buying a home",
    answer: "The average rates UK lenders quoted each month for 2-, 3- and 5-year fixed mortgages since 1996, next to Bank Rate.",
    Diagram: MortgageRatesDiagram,
    caption: "Bank Rate against fixed rates for a loan of 75% of the price, August 2026.",
    example: (
      <p>
        In August 2026 Bank Rate averaged 3.75% and a 2-year fix at 75% loan-to-value 4.92%:{" "}
        <strong>1.17 percentage points above Bank Rate</strong>. September&apos;s fixed rates are blank because the
        Bank had not published them when we last downloaded the data. See the whole history in the{" "}
        <Link href="/tools/mortgage-rates">mortgage rates tracker</Link>.
      </p>
    ),
    how: (
      <ul>
        <li>
          Four monthly series from the Bank of England Database: the monthly average of Bank Rate (IUMABEDR) and the
          average quoted rate on new 2-, 3- and 5-year fixed mortgages at 75% loan-to-value (IUMBV34, IUMBV37, IUMBV42).
        </li>
        <li>The chart starts in January 1996. The data was downloaded on 5 October 2026 and is stored with the app.</li>
        <li>The gap is the fixed rate minus Bank Rate, in percentage points.</li>
        <li>A month the Bank has not published stays blank and breaks the line; it is never drawn as zero.</li>
        <li>The buy-to-let calculator shows the latest 2- and 5-year rates as a hint.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>These are averages across lenders for a 75% loan. Your own rate depends on your deposit, your circumstances and the lender; buy-to-let loans usually cost more.</li>
        <li>The fixed rates are not seasonally adjusted.</li>
        <li>{NOT_ADVICE}</li>
        <li className="licence-note">
          Source: Bank of England. Data © the Governor and Company of the Bank of England, reproduced under the Open
          Government Licence v3.0.
        </li>
      </ul>
    ),
  },

  "buy-to-let": {
    title: "Buy-to-let sums",
    group: "Buying a home",
    answer: "Rough yearly sums for a home you let out: rental yield, what is left after costs and the mortgage, and the cash needed to buy.",
    Diagram: BuyToLetDiagram,
    caption: "A year's rent, minus empty weeks, running costs and mortgage interest.",
    example: (
      <p>
        A £400,000 flat with a £100,000 deposit, an interest-only mortgage at 5%, £1,800 a month rent, 2 empty weeks,
        a 10% letting agent and £100 a month for repairs. Gross yield 5.4%, net yield 4.4%. The mortgage costs £1,250
        a month and about <strong>£208 a month</strong> is left. You need £132,000 on the day: the deposit, £30,000
        stamp duty at the rates for an extra home, and £2,000 legal and survey fees. Try it in the{" "}
        <Link href="/tools/investor">buy-to-let calculator</Link>.
      </p>
    ),
    how: (
      <ul>
        <li>Gross yield is a year&apos;s rent divided by the price.</li>
        <li>Rent after empty weeks is a year&apos;s rent times (52 − empty weeks) ÷ 52.</li>
        <li>Running costs are the agent&apos;s share of the rent collected plus service charge, ground rent, insurance and maintenance.</li>
        <li>Net yield is rent after empty weeks minus running costs, divided by the price. Mortgage payments are not taken off.</li>
        <li>Interest-only pays just the interest; repayment also pays off the loan over the term.</li>
        <li>Cash flow is what is left after the mortgage; below zero, you top it up yourself.</li>
        <li>
          Stamp duty uses the <Link href="/guide/stamp-duty">stamp duty</Link> table, with the extra-home rates unless
          you untick them. Cash needed is deposit plus stamp duty plus legal and survey fees and any work.
        </li>
        <li>The yearly return on that cash is the yearly cash flow divided by the cash needed.</li>
      </ul>
    ),
    finePrint: (
      <ul>
        <li>Everything is before income tax. Rental profit is taxed as income, and landlords who own in their own name get a 20% tax credit on mortgage interest instead of deducting it.</li>
        <li>Optional costs left blank are listed as unknown and left out of the totals, never quietly counted as zero.</li>
        <li>Rents, rates and costs change; nothing here predicts them.</li>
        <li>{NOT_ADVICE}</li>
      </ul>
    ),
  },

  "your-match": {
    title: "Your match",
    group: "Your match",
    answer: "A score out of 100 for how well an area fits what you asked for. It is not a rating of the neighbourhood.",
    Diagram: MatchDiagram,
    caption: "Each criterion gives a fit from 0 to 1; your importance dots combine them into one score. A fit of 0 puts the area out (grey).",
    example: (
      <p>
        You ask for crime ≤ 25 per 1,000 (Must) and a price per m² ≤ £7k with a soft edge to £8k, both at importance 3.
        An area with crime 20 and £7.4k/m² fits crime fully (1) and price 0.6, 40% across the soft edge.
        √(1 × 0.6) = <strong>77 out of 100</strong>. An area with crime 46 is out: grey on the map.
      </p>
    ),
    how: (
      <ul>
        <li>Any layer on the map can be a range: inside it an area fits fully, across the soft edge the fit falls to 0, and beyond it the area is out. Must means no soft edge.</li>
        <li>The score is the weighted geometric mean of the fits, with your importance dots (1–5) as the weights, so any criterion at 0 puts the area out.</li>
        <li>Priorities from the questions, places and your own criteria count by their 0–100 fit (the area&apos;s place among London areas, in the direction you chose). Without Must a fit never falls below 5%; with Must its minimum is a hard limit.</li>
        <li>Census layers and religion describe who lives in an area: they are never criteria.</li>
        <li>The official deprivation index, household income and social renting can be criteria and have their own rankings. A range on them is your choice; we never call either end better.</li>
        <li>A limit you relax lets its areas back in with a low fit, and you can restore it.</li>
        <li>Rent comes from the ONS Price Index of Private Rents: the borough&apos;s average monthly rent for each bedroom count (new and existing tenancies), so it covers bigger areas than the map shapes.</li>
        <li>Shops, parks and stops nearby are counts within a short walk, from OpenStreetMap.</li>
      </ul>
    ),
    finePrint: (
      <section data-testid="personal-match-docs">
        <p>
          Each criterion gives a fit between 0 and 1 (a 0–100 utility u counts as 0.05 + 0.95 × u/100) and the score is
          100 × Π fit^(weight ÷ total weight). Missing soft evidence is omitted and the remaining weights are
          renormalised; evidence completeness remains separate. Missing must-have evidence excludes an area. Coarse
          evidence keeps its true carrier label.
        </p>
        <ul>
          {FACTORS.map((factor) => <li key={factor.id}><strong>{factor.label}:</strong> {factor.carrierPolicy}</li>)}
        </ul>
        <p>
          Forecasts describe area-level £/m² ranges, not individual homes. School admissions evidence is factual
          historical context, never a probability or guarantee. Crime locations retain the publisher&apos;s
          anonymisation warning.
        </p>
        <p>The score changes with your priorities and evidence coverage.</p>
        <p className="licence-note">
          Profiles stay in this browser and are sent transiently for scoring. Usage analytics are opt-in and contain
          only budget bands, weights, counts, modes, and school phases—never exact destinations or raw profiles.
        </p>
      </section>
    ),
  },

  "demo-vs-real": {
    title: "Demo or real data",
    group: "The data",
    answer: "Demo shows made-up numbers so you can try the app; Real shows published official data, or says plainly what is missing.",
    Diagram: DemoRealDiagram,
    caption: "The live site always shows Real; the Demo / Real switch is a developer tool.",
    example: (
      <p>
        In Demo, <em>Westminster preview</em> shows the same sample figures every time. In Real the same panel names
        its source release, such as <strong>official-2026-06</strong>, or says the figure is unavailable.
      </p>
    ),
    how: (
      <ul>
        <li>Demo uses fixed preview areas and numbers built into the app. They are labelled &quot;not for decisions&quot;.</li>
        <li>Real reads published releases from the Close Knit data service. Every figure names its source and release.</li>
        <li>Real covers area boundaries, crime, price per m², stock value, sold prices, schools, road, rail and aircraft noise, commute times, flood screening and planning applications.</li>
        <li>Forecasts are not loaded yet; Real says so.</li>
        <li>The Demo / Real switch shows only for developers (with <code>?dev=1</code>); everyone else sees Real.</li>
      </ul>
    ),
    finePrint: (
      <section data-testid="real-data-docs">
        <p>
          This preview exercises the complete product contract with deterministic fixture values. It does not claim
          that the preview polygons or numbers are current official statistics. Production releases must publish
          immutable source manifests and reviewed calculations.
        </p>
        <p>
          Demo data is deterministic fixtures for exploring the product. Real data loads from the Close Knit data
          service reading validated storage. When that service cannot be reached, Real mode states exactly what is
          unavailable instead of rendering fixtures. Real data publishes a limited set of metrics in this release; anything
          unpublished stays explicitly unknown.
        </p>
      </section>
    ),
  },
};
