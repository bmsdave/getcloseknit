import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

import type {
  AddressHistory,
  AddressId,
  AreaEvidencePack,
  AreaSummary,
  Carrier,
  FactorDefinition,
  GeographyId,
  JourneyResult,
  MapDefinition,
  MetricDefinition,
  MetricId,
  NearbySales,
  PreferenceProfile,
  PriceForecast,
  PropertyHistory,
  PropertySummary,
  SchoolSummary,
  SchoolTopBadge,
  ValuePack,
  ValuePackEntry,
} from "./contracts";
import { carrierOf, isDescriptiveLayer } from "./contracts";
import { CENSUS_METRIC_IDS, censusView, isCensusMetric, isMsoaFigure, MSOA_FIGURES_NOTE, type CensusMetricId } from "./census-layers";
import { metricGuidePath } from "./guide-routes";
import type { DataMode } from "./map-state";
import { MATCH_BANDS } from "./match-map";
import { NATURE_METRIC_IDS, WILDLIFE_SPECIES, type WildlifeMetricId } from "./nature-layers";
import { fixtureAreaPeople } from "./people-fixture";
import { isQuickFactor } from "./quick-criteria";
import { TYPICAL_PRICE_TYPES, type TypicalPriceLayer } from "./typical-price";

/** Each preview area's share of a detailed category (lib/census-picks.ts), as a multiple of London's. */
const DETAILED_FACTORS = { "1": 1.3, "2": 0.8, "3": 1.1, london: 1 } as const;

interface PreviewArea {
  name: string;
  codes: Record<Carrier, string>;
  polygon: Polygon | MultiPolygon;
}

/** What a search row is: the search box groups its rows by it (postcode-search.ts searchGroups). */
export type SearchKind =
  | "postcode" | "sector" | "address" | "street" | Carrier | "school" | "station" | "place";

export interface SearchResult {
  id: string;
  /** Set by /api/v1/search; rows without it are read from their ids (postcode-search.ts kindOf). */
  kind?: SearchKind;
  label: string;
  secondaryLabel: string;
  geographyId: GeographyId;
  uprn: string | null;
  addressId: AddressId | null;
  center: [number, number];
  /** A page to open instead of an area to select (the postcode's own page). */
  href?: string;
  /** A street found for a typed address with no recorded sale (OS Open Names). */
  street?: StreetMatch | null;
}

/** search: a street for a typed address no recorded sale knows; never a particular home. */
export interface StreetMatch {
  name: string;
  /** The house number typed, if any. */
  number: number | null;
  locality: string | null;
  borough: string | null;
  postcodeDistrict: string | null;
  /** Set only when the nearest recorded homes either side on the same side of the street share it. */
  likelyPostcode: string | null;
  /** The house numbers that decided likelyPostcode. */
  neighbours: number[];
  /** Every postcode with a recorded home at the typed number (a tower's flats share one
      number across several postcodes); empty when the number has no recorded home. */
  numberPostcodes: string[];
  /** The street's postcodes from recorded homes, most homes first. */
  postcodes: string[];
}

const PRICE_PERIODS = monthlyPeriods("2006-06", "2026-06");
const CRIME_PERIODS = monthlyPeriods("2024-07", "2026-06");
const PREVIEW_CHECKSUM = "0".repeat(64);

export const FACTORS: FactorDefinition[] = [
  factor("affordability", "Affordability", "budget fit", ["lower", "target-range"], "target-range"),
  factor("market-level", "Present market level", "£/m²", ["higher", "lower", "target-range"], "lower"),
  factor("growth-outlook", "Growth outlook", "% real growth", ["higher", "lower"], "higher"),
  factor("crime", "Recorded crime", "per 1,000", ["lower", "higher"], "lower"),
  // The official deprivation decile is a match criterion again (user decision); household
  // income and social renting describe who lives somewhere, not the place, and stay retired.
  factor("deprivation", "Deprivation decile", "decile, 1 = most deprived", ["higher", "lower"], "higher"),
  factor("commute", "Commute", "minutes", ["lower"], "lower"),
  factor("schools", "Schools", "quality and access", ["higher"], "higher"),
  factor("station-access", "Walk to a station", "minutes", ["lower", "higher"], "lower"),
  // Quick criteria (migration 028): offered in the wizard, absent from new profiles until weighted.
  factor("noise", "Noise (road, rail)", "% of homes ≥55 dB", ["lower", "higher"], "lower"),
  factor("disorder", "Visible disorder (ASB, damage, public order)", "per 1,000", ["lower", "higher"], "lower"),
  factor("epc-share", "Energy rating A–C", "% of homes rated A-C", ["higher", "lower"], "higher"),
  factor("leasehold-share", "Leasehold share of sales", "% of sales leasehold", ["lower", "higher"], "lower"),
];

/**
 * Factors that described people rather than places: never offered, dropped from old profiles on load.
 * Kept in step with RETIRED_FACTOR_IDS in api/area_api/matching.py (api/tests/test_matching.py checks).
 */
export const RETIRED_FACTOR_IDS: readonly string[] = ["income", "social-renting"];

/** Offered in the wizard but absent from new profiles until weighted, like the quick criteria. */
const OPT_IN_FACTOR_IDS: readonly string[] = ["deprivation"];

/** Nothing chosen yet: every priority Off, no places. The wizard shows the budget empty until it is set. */
export const DEFAULT_PROFILE: PreferenceProfile = {
  schemaVersion: "preference-profile.v1",
  market: "buy",
  targetBudget: 500_000,
  maximumBudget: 650_000,
  bedrooms: 2,
  forecastHorizon: "1y",
  factors: FACTORS.filter((definition) => !isQuickFactor(definition.id) && !OPT_IN_FACTOR_IDS.includes(definition.id)).map((definition) => ({
    factorId: definition.id,
    // The budget always counts (it is asked first); every priority starts Off.
    weight: definition.id === "affordability" ? 3 : 0,
    direction: definition.defaultDirection,
    minimumUtility: null,
    maximumUtility: null,
  })),
  commuteDestinations: [],
  school: {
    phases: ["primary"],
    characteristics: [],
    facetWeights: { progress: 3, attainment: 2, attendance: 1 },
    shortlistUrns: [],
    desiredSchoolCount: 3,
  },
  analyticsConsent: false,
};

// Rent affordability reads the ONS Price Index of Private Rents, as the API
// does: the borough's average rent for the bedroom count, new and existing
// tenancies. Asking rents on the portals run higher, so the label always says
// which index is shown.
export const RENT_INDEX_LABEL =
  "ONS Price Index of Private Rents, borough average of new and existing tenancies, not listing prices";

export function rentIndexCaption(sourceVersion: string): string {
  return `${RENT_INDEX_LABEL} · 12-month window · ${sourceVersion}`;
}

/**
 * My match's legend: every scored area in one of 7 bands by its percentile among the scored
 * areas (lib/match-map.ts), RdBu from "Least like your search" (deep red) to "Best match" (deep blue);
 * the map paints the band index 0–6. An area that fails a Must has no band (grey) and is hatched.
 */
export const PERSONAL_MATCH_LEGEND: MapDefinition["legend"] = MATCH_BANDS.map((colour, band) => ({
  value: band, colour, label: band === 0 ? "Least like your search" : band === MATCH_BANDS.length - 1 ? "Best match" : "",
}));

export const PERSONAL_MATCH_DEFINITION: MapDefinition = {
  id: "personal-match",
  label: "My match",
  shortLabel: "My match",
  description: "A transparent match for your priorities, not an objective neighbourhood rating.",
  carrier: "lsoa",
  unit: "/100",
  direction: "higher-is-better",
  periods: ["2026-09"],
  defaultPeriod: "2026-09",
  legend: PERSONAL_MATCH_LEGEND,
  provenance: {
    sourceId: "personal-match",
    sourceName: "Your selected priorities",
    sourceUrl: "https://example.invalid/personal-match",
    release: "preview-2026-09",
    checksum: PREVIEW_CHECKSUM,
    licence: "Apache-2.0",
    attribution: "Calculated from the cited source releases.",
    transformationVersion: "personal-match-v1",
  },
  freshness: "Calculated on request",
  methodologyPath: metricGuidePath("personal-match"),
  caveats: ["The score changes with your priorities and evidence coverage."],
};

const PRICE_SOURCE = {
  sourceId: "hmlr-epc",
  sourceName: "HM Land Registry Price Paid + MHCLG EPC",
  sourceUrl: "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
  release: "preview-2026-06",
  checksum: PREVIEW_CHECKSUM,
  licence: "OGL-3.0",
  attribution: "Contains HM Land Registry and public sector information licensed under OGL v3.0. EPC address data (c) Crown copyright and database rights [2026] Ordnance Survey. Royal Mail data (c) Royal Mail.",
  transformationVersion: "preview-price-v1",
};

/** Five steps per type (the migration-040 legend shape), cheap to dear on the price ramp. */
const TYPICAL_COLOURS = ["#c7e9b4", "#7fcdbb", "#1d91c0", "#253494", "#081d58"];
function typicalLegend(values: number[]): [number, string, string][] {
  return values.map((value, index) => [value, TYPICAL_COLOURS[index],
    `£${value >= 1_000_000 ? `${value / 1_000_000}m` : `${value / 1_000}k`}${index === values.length - 1 ? "+" : ""}`]);
}
const TYPICAL_LEGENDS: Record<TypicalPriceLayer, [number, string, string][]> = {
  "typical-price": typicalLegend([350_000, 450_000, 550_000, 700_000, 1_000_000]),
  "typical-price-flat": typicalLegend([300_000, 380_000, 450_000, 550_000, 750_000]),
  "typical-price-terraced": typicalLegend([500_000, 650_000, 800_000, 1_000_000, 1_500_000]),
  "typical-price-semi": typicalLegend([550_000, 700_000, 850_000, 1_100_000, 1_600_000]),
  "typical-price-detached": typicalLegend([750_000, 1_000_000, 1_300_000, 1_800_000, 2_500_000]),
};

export const METRICS: MetricDefinition[] = [
  metric({
    id: "price-per-square-metre",
    label: "Price per square metre",
    shortLabel: "Price / m²",
    description: "Rolling 12-month median sold price joined to recorded EPC floor area.",
    carrier: "lsoa",
    unit: "£/m²",
    direction: "higher-is-more",
    periods: PRICE_PERIODS,
    legend: [
      [4_000, "#2a6f97", "£4k"],
      [8_000, "#f4d35e", "£8k"],
      [12_000, "#c44536", "£12k+"],
    ],
    provenance: PRICE_SOURCE,
    caveats: ["Areas with fewer than 20 matched transactions fall back to a larger geography."],
  }),
  metric({
    id: "stock-value-per-square-metre",
    label: "Stock value per square metre",
    shortLabel: "Stock value",
    description: "Median of every dwelling's last achieved £/m², restated to the latest period by its area's price change. A restated sale, not a valuation.",
    carrier: "lsoa",
    unit: "£/m²",
    direction: "higher-is-more",
    periods: ["2026-06"],
    legend: [
      [4_000, "#2a6f97", "£4k"],
      [8_000, "#f4d35e", "£8k"],
      [12_000, "#c44536", "£12k+"],
    ],
    provenance: provenance("hmlr-epc-os-uprn", "HM Land Registry Price Paid + EPC + OS Open UPRN", "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads", "preview-2026-06"),
    caveats: ["Each dwelling counts once at its last recorded sale; homes never sold since 1995 are absent.", "A home whose last sale predates the price per m² index (June 2006) is not restated and is left out of the median and the count; it is never moved forward as if it had sold in June 2006.", "Restated sales carry no condition, layout or tenure information: they are not valuations."],
  }),
  metric({
    id: "crime",
    label: "Recorded crime",
    shortLabel: "Crime",
    description: "Police-recorded offences per 1,000 residents in the 12 months to each month, excluding anti-social behaviour and British Transport Police.",
    carrier: "lsoa",
    unit: "per 1,000",
    direction: "higher-is-more",
    periods: CRIME_PERIODS,
    legend: [
      [0, "#3a7d44", "0"],
      [6, "#7ba05b", "6"],
      [14, "#d4c759", "14"],
      [30, "#f4d35e", "30"],
      [60, "#ee964b", "60"],
      [110, "#c96a3b", "110"],
      [200, "#b23a48", "200+"],
    ],
    provenance: provenance("police-uk", "data.police.uk", "https://data.police.uk/", "preview-2026-06"),
    caveats: [
      "Published crime coordinates are deliberately anonymised and never identify a building.",
      "Rates use resident population; central areas with high footfall (West End, City) read high.",
    ],
  }),
  metric({
    id: "deprivation",
    label: "Deprivation decile",
    shortLabel: "Deprivation",
    description: "Official Index of Multiple Deprivation decile for each LSOA.",
    carrier: "lsoa",
    unit: "decile",
    direction: "higher-is-better",
    periods: ["2025-01"],
    legend: [
      [1, "#b23a48", "1"],
      [5, "#f4d35e", "5"],
      [10, "#3a7d44", "10"],
    ],
    provenance: provenance("mhclg-imd", "MHCLG IMD 2025", "https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025", "preview-2025"),
    caveats: ["A decile summarises an area and says nothing about an individual household."],
  }),
  metric({
    id: "income",
    label: "Estimated household income",
    shortLabel: "Income",
    description: "Model-based gross disposable household income at the published MSOA geography.",
    carrier: "msoa",
    unit: "£/year",
    direction: "higher-is-more",
    periods: ["2023-01"],
    legend: [
      // London MSOAs run from about £60k (10th percentile) to £108k (98th): the top colour is the top few percent.
      [55_000, "#2a6f97", "£55k"],
      [75_000, "#8ecae6", "£75k"],
      [95_000, "#f4d35e", "£95k"],
      [110_000, "#e07a1f", "£110k+"],
    ],
    provenance: provenance("ons-income", "Office for National Statistics", "https://www.ons.gov.uk/", "preview-2023"),
    caveats: ["Income is modelled at MSOA level and is not an estimate for an individual household."],
  }),
  metric({
    id: "social-renting",
    label: "Social renting",
    shortLabel: "Social rent",
    description: "Share of households recorded as social renting in Census 2021.",
    carrier: "lsoa",
    unit: "%",
    direction: "neutral",
    periods: ["2021-03"],
    legend: [
      [5, "#edf6f9", "5%"],
      [25, "#83c5be", "25%"],
      [50, "#006d77", "50%+"],
    ],
    provenance: provenance("ons-census", "Office for National Statistics Census 2021", "https://www.ons.gov.uk/census", "preview-2021"),
    caveats: ["Tenure is an area composition measure, not a quality judgement."],
  }),
  metric({
    id: "station-access",
    label: "Walk to a station",
    shortLabel: "Station walk",
    description: "Median walking minutes from the area's homes to the nearest rail, Underground, Overground, DLR or tram station entrance, along mapped paths and streets at 4.8 km/h.",
    carrier: "lsoa",
    unit: "minutes",
    direction: "higher-is-more",
    periods: ["2026-09"],
    legend: [
      [5, "#3a7d44", "5 min"],
      [8, "#7ba05b", "8 min"],
      [11, "#f4d35e", "11 min"],
      [15, "#c96a3b", "15 min"],
      [30, "#b23a48", "30+ min"],
    ],
    provenance: { ...provenance("osm", "OpenStreetMap", "https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html", "preview-osm-2026-09"), licence: "ODbL-1.0", attribution: "© OpenStreetMap contributors (ODbL)" },
    caveats: ["Network walking distance, not a straight line; lifts, stairs and crossings are not timed."],
  }),
  metric({
    id: "food-hygiene",
    label: "Food hygiene nearby",
    shortLabel: "Food hygiene",
    description: "Share of the rated cafés, restaurants, takeaways and pubs within 800 m of the area's centre point that hold a food hygiene rating of 4 or 5 (good or very good). It describes nearby food places, not the people who live in the area.",
    carrier: "lsoa",
    unit: "%",
    direction: "higher-is-better",
    periods: ["2026-10"],
    legend: [
      [73, "#b23a48", "73%"],
      [81, "#c96a3b", "81%"],
      [86, "#f4d35e", "86%"],
      [91, "#7ba05b", "91%"],
      [100, "#3a7d44", "100%"],
    ],
    provenance: { ...provenance("fsa-fhrs", "Food Standards Agency, Food Hygiene Rating Scheme", "https://ratings.food.gov.uk/open-data", "preview-fhrs-2026-10"), licence: "OGL-3.0", attribution: "Food hygiene ratings: Food Standards Agency (ratings.food.gov.uk). Contains public sector information licensed under the Open Government Licence v3.0." },
    caveats: ["Exempt businesses and those awaiting inspection are left out; areas with fewer than 5 rated places nearby show no share."],
  }),
  metric({
    id: "noise",
    label: "Road, rail and aircraft noise",
    shortLabel: "Noise",
    description: "Share of the area's homes where modelled road, rail or aircraft noise reaches 55 dB Lden or more (Defra strategic noise mapping, 2022; airport noise where the load includes it).",
    carrier: "lsoa",
    unit: "%",
    direction: "higher-is-more",
    periods: ["2022-12"],
    legend: [
      [0, "#3a7d44", "0%"],
      [10, "#7ba05b", "10%"],
      [25, "#f4d35e", "25%"],
      [45, "#c96a3b", "45%"],
      [70, "#b23a48", "70%+"],
    ],
    provenance: { ...provenance("defra-noise", "Defra strategic noise mapping (Round 4)", "https://environment.data.gov.uk/", "preview-defra-noise"), licence: "OGL-3.0", attribution: "Defra strategic noise mapping Round 4, Open Government Licence v3.0" },
    caveats: ["Modelled at 4 m above ground at each home's point, not measured; aircraft noise is included where the load carries it."],
  }),
  metric({
    id: "road-collisions",
    label: "Road collisions (rate)",
    shortLabel: "Road collisions",
    description: "Pedestrians and cyclists hurt in police-reported road collisions over five years, a year, for every 1,000 residents of the neighbourhood.",
    carrier: "lsoa",
    unit: "per-1000-residents-per-year",
    direction: "higher-is-more",
    periods: ["2024-01"],
    legend: [
      [0.2, "#3a7d44", "0.2"],
      [0.4, "#7ba05b", "0.4"],
      [0.7, "#f4d35e", "0.7"],
      [1.2, "#c96a3b", "1.2"],
      [3, "#b23a48", "3+"],
    ],
    provenance: { ...provenance("dft-stats19", "DfT road safety data (STATS19)", "https://www.gov.uk/government/statistical-data-sets/road-safety-open-data", "preview-stats19"), licence: "OGL-3.0", attribution: "Department for Transport, Road Safety Data (STATS19). Open Government Licence v3.0." },
    caveats: ["Pedestrians and cyclists only, every severity; many slight injuries are never reported to the police.", "Busy centres with few residents come out high."],
  }),
  metric({
    id: "air-no2",
    label: "Clean air",
    shortLabel: "Air",
    description: "Modelled yearly mean nitrogen dioxide (NO₂, µg/m³) at the area's homes, 2022 (GLA London Atmospheric Emissions Inventory). Lower is cleaner; the WHO guideline is 10, the UK legal limit 40.",
    carrier: "lsoa",
    unit: "µg/m³",
    direction: "higher-is-more",
    periods: ["2022-12"],
    // Mirrors deploy/tools/etl_health.py AIR_LEGEND.
    legend: [
      [17, "#3a7d44", "17"],
      [19, "#7ba05b", "19"],
      [21, "#f4d35e", "21"],
      [24, "#c96a3b", "24"],
      [28, "#b23a48", "28+"],
    ],
    provenance: { ...provenance("gla-laei", "London Atmospheric Emissions Inventory 2022 (GLA, TfL)", "https://data.london.gov.uk/dataset/london-atmospheric-emissions-inventory-laei-2022-2lg5g", "preview-gla-laei"), licence: "London Datastore terms", attribution: "London Atmospheric Emissions Inventory 2022, Greater London Authority and Transport for London." },
    caveats: ["Modelled yearly means on a 20 m grid, read at each home's point and averaged over the area's homes; not measurements."],
  }),
  ...([["rent-change-1y", "1 year", [[1.4, "+1.4%"], [2.1, "+2.1%"], [2.9, "+2.9%"], [3.4, "+3.4%"], [5.1, "+5.1%+"]]],
    ["rent-change-5y", "5 years", [[28.7, "+28.7%"], [33.3, "+33.3%"], [34.9, "+34.9%"], [36.1, "+36.1%"], [39.7, "+39.7%+"]]]] as const)
    .map(([id, words, stops]) => metric({
      id,
      label: `Rent change, ${words}`,
      shortLabel: "Rent change",
      description: `How much the borough's private rents moved over ${words}, from the ONS Price Index of Private Rents for all homes. Borough level: every area in a borough shows the same change.`,
      carrier: "lad",
      unit: "%",
      direction: "higher-is-more",
      periods: ["2026-08"],
      legend: stops.map(([value, label], index) => [value, ["#3a7d44", "#7ba05b", "#f4d35e", "#c96a3b", "#b23a48"][index], label] as [number, string, string]),
      provenance: { ...provenance("ons-pipr", "ONS Price Index of Private Rents", "https://www.ons.gov.uk/", "preview-ons-pipr-series"), licence: "OGL-3.0", attribution: "Source: Office for National Statistics, Price Index of Private Rents. Open Government Licence v3.0." },
      caveats: ["Borough-wide: every neighbourhood in a borough reads the borough's change.", "No City of London figures are published."],
    })),
  ...TYPICAL_PRICE_TYPES.map(({ id, words }, index) => metric({
    id,
    label: index === 0 ? "Typical home price" : `Typical home price: ${words}`,
    shortLabel: "Typical home price",
    description: `Median price of standard sales of ${words} since 2023, each adjusted to Jun 2026 by the local price index. Area-level only: not a valuation of any home.`,
    carrier: "lsoa",
    unit: "£",
    direction: "higher-is-more",
    periods: ["2026-06"],
    legend: TYPICAL_LEGENDS[id],
    provenance: provenance("hmlr-price-paid", "HM Land Registry Price Paid", "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads", "preview-2026-06"),
    caveats: [
      "Areas with fewer than 20 sales of the type use their MSOA, then their borough (at least 5 sales); below that no value is shown.",
      "Standard market sales only (Price Paid category A). The index adjusts for the market, not for condition or improvements.",
    ],
  })),
  ...censusDefinitions(),
  ...natureDefinitions(),
  // Mirrors migration 080 rebuild_hpi_layers: the borough's change, painted on every level.
  ...([5, 10] as const).map((years) => metric({
    id: `hpi-change-${years}y` as const,
    label: `Price change over ${years} years`,
    shortLabel: `Price change ${years}y`,
    description: `Change in the borough's official house price index (all homes) over ${years} years to Jul 2026 (HM Land Registry UK HPI). Borough-wide.`,
    carrier: "lsoa",
    unit: "%",
    direction: "neutral",
    periods: ["2026-07"],
    legend: [
      [-years, "#b2182b", `-${years}%`],
      [0, "#f4a582", "0%"],
      [years, "#d1e5f0", `+${years}%`],
      [years * 2, "#67a9cf", `+${years * 2}%`],
      [years * 4, "#2166ac", `+${years * 4}%+`],
    ],
    provenance: { ...provenance("hmlr-uk-hpi", "HM Land Registry UK House Price Index", "https://www.gov.uk/government/statistical-data-sets/uk-house-price-index-data-downloads", "preview-hmlr-uk-hpi"), licence: "OGL-3.0", attribution: "Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0." },
    caveats: ["Borough-wide: every neighbourhood in a borough shows the same figure."],
  })),
  metric({
    id: "council-tax-band-mean",
    label: "Council tax band",
    shortLabel: "Council tax band",
    description: "Average council tax band of the area's homes, A = 1 to H = 8 (VOA valuation list, March 2025). Bands come from 1991 values, not today's prices.",
    carrier: "lsoa",
    unit: "band",
    direction: "higher-is-more",
    periods: ["2025-03"],
    // Mirrors deploy/migrations/082-council-tax-band.sql.
    legend: [
      [2, "#2a6f97", "B"],
      [3, "#8ecae6", "C"],
      [4, "#f4d35e", "D"],
      [5, "#e07a1f", "E"],
      [6, "#c44536", "F+"],
    ],
    provenance: { ...provenance("voa-ctsop", "VOA Council Tax: stock of properties", "https://www.gov.uk/government/statistics/council-tax-stock-of-properties-2025", "preview-voa-ctsop-2025"), licence: "OGL-3.0", attribution: "Valuation Office Agency, Council Tax: stock of properties 2025. Contains public sector information licensed under the Open Government Licence v3.0." },
    caveats: ["Homes on the valuation list, rounded by VOA to the nearest 10; areas with fewer than 50 homes show no band."],
  }),
  // Company and overseas ownership (migration 083 load_ownership_metrics): titles per 100 homes.
  ...([
    ["ownership-company-share", "Company-owned homes", "Company owned", "UK companies (HM Land Registry CCOD)", [2, 5, 10, 20]],
    ["ownership-overseas-share", "Overseas-owned homes", "Overseas owned", "overseas companies (HM Land Registry OCOD)", [0.5, 1, 2, 5]],
  ] as const).map(([id, label, shortLabel, owners, stops]) => metric({
    id, label, shortLabel,
    description: `Land titles held by ${owners} per 100 homes in the area.`,
    carrier: "lsoa",
    unit: "%",
    direction: "higher-is-more",
    periods: ["2026-10"],
    // Mirrors deploy/migrations/083-area-ownership.sql.
    legend: [
      [0, "#f2f0f7", "0"],
      [stops[0], "#cbc9e2", `${stops[0]}`],
      [stops[1], "#9e9ac8", `${stops[1]}`],
      [stops[2], "#756bb1", `${stops[2]}`],
      [stops[3], "#54278f", `${stops[3]}+`],
    ],
    provenance: { ...provenance("hmlr-ccod-ocod", "HM Land Registry company and overseas ownership (CCOD, OCOD)", "https://use-land-property-data.service.gov.uk/datasets", "preview-hmlr-ownership"), licence: "HM Land Registry CCOD/OCOD licence", attribution: "Contains HM Land Registry data © Crown copyright and database right 2026." },
    caveats: ["Counts land titles, not homes: one title can hold a whole block, and a home can sit on more than one title."],
  })),
  metric({
    id: "short-lets-per-1000",
    label: "Short lets",
    shortLabel: "Short lets",
    description: "Airbnb listings per 1,000 homes (Census 2021 households), from Inside Airbnb's London snapshot.",
    carrier: "lsoa",
    unit: "per 1,000 homes",
    direction: "higher-is-more",
    periods: ["2026-09"],
    // Mirrors deploy/tools/etl_short_lets.py LEGEND.
    legend: [
      [0, "#3a7d44", "0"],
      [5, "#7ba05b", "5"],
      [15, "#f4d35e", "15"],
      [40, "#c96a3b", "40"],
      [100, "#b23a48", "100+"],
    ],
    provenance: { ...provenance("inside-airbnb", "Inside Airbnb (London)", "https://insideairbnb.com/get-the-data/", "preview-inside-airbnb-2026-09"), licence: "CC-BY-4.0", attribution: "Inside Airbnb, insideairbnb.com, CC BY 4.0." },
    caveats: ["Airbnb moves each listing's point by up to about 150 m; Airbnb only; a snapshot of one day."],
  }),
  metric({
    id: "pipeline-homes-per-1000",
    label: "New homes in the pipeline",
    shortLabel: "Homes pipeline",
    description: "Net new homes permitted but not started, or under construction, per 1,000 homes in the area (London Development Database). Permissions are not completions; dates slip.",
    carrier: "lsoa",
    unit: "per 1,000 homes",
    direction: "neutral",
    periods: ["2026-10"],
    // Mirrors the colours of migration 085's legend (its stops follow the loaded data).
    legend: [
      [2, "#c7e9b4", "2"],
      [5, "#7fcdbb", "5"],
      [10, "#1d91c0", "10"],
      [20, "#253494", "20"],
      [40, "#081d58", "40+"],
    ],
    provenance: { ...provenance("gla-ldd", "London Development Database (Planning London Datahub)", "https://www.london.gov.uk/programmes-strategies/planning/digital-planning/planning-london-datahub", "preview-gla-ldd"), licence: "OGL-3.0", attribution: "London Development Database, Planning London Datahub, Greater London Authority, licensed under the Open Government Licence v3.0." },
    caveats: ["Permissions are not completions: start and finish dates slip, and some permissions lapse unbuilt."],
  }),
  ...mobileDefinitions(),
  metric({
    id: "future-station-distance",
    label: "Distance to a new station",
    shortLabel: "New station",
    description: "Straight-line km from the middle of the area to the nearest new rail, Tube, DLR, Overground or tram station under construction or consented (TfL, GLA and DfT pages).",
    carrier: "lsoa",
    unit: "km",
    direction: "higher-is-more",
    periods: ["2026-10"],
    legend: [
      [0.5, "#3a7d44", "500 m"],
      [1, "#7ba05b", "1 km"],
      [2, "#f4d35e", "2 km"],
      [4, "#c96a3b", "4 km"],
      [8, "#b23a48", "8 km+"],
    ],
    provenance: provenance("future-transport", "TfL, GLA and DfT scheme pages (curated list)", "https://tfl.gov.uk/travel-information/improvements-and-projects/", "preview-future-transport-2026-10"),
    caveats: ["Plans change: a proposed scheme is shown as proposed, never as coming; the layer counts stations under construction or consented only."],
  }),
  metric({
    id: "hmo-per-1000",
    label: "Licensed HMOs per 1,000 homes",
    shortLabel: "HMOs",
    description: "Houses in multiple occupation on the borough's public licence register, per 1,000 households (Census 2021). It counts licensed shared houses, not the people in them.",
    carrier: "lsoa",
    unit: "per 1,000 homes",
    direction: "higher-is-more",
    periods: ["2026-10"],
    legend: [
      [2, "#c7e9b4", "2"],
      [5, "#7fcdbb", "5"],
      [9, "#1d91c0", "9"],
      [16, "#253494", "16"],
      [60, "#081d58", "60"],
    ],
    provenance: { ...provenance("hmo-registers", "London borough HMO licence registers", "https://www.legislation.gov.uk/ukpga/2004/34/section/232", "preview-hmo-2026-10"), licence: "Public registers (Housing Act 2004 s.232)", attribution: "Contains public sector information from London boroughs' HMO licence registers." },
    caveats: ["Licensed HMOs only; grey areas: the borough has not published its register."],
  }),
  // Layers v5 PR 3 (migration 100, deploy/tools/etl_layers_v5.py): mirrors the definitions rebuild_layer_* write.
  ...([["typical-rent", "2 bedrooms", "2-bedroom", [1650, 1900, 2150, 2500, 3200]],
    ["typical-rent-1-bed", "1 bedroom", "1-bedroom", [1350, 1550, 1700, 1950, 2500]],
    ["typical-rent-3-bed", "3 bedrooms", "3-bedroom", [2000, 2350, 2700, 3200, 4300]]] as const)
    .map(([id, words, home, stops]) => metric({
      id,
      label: `Typical rent: ${words}`,
      shortLabel: "Typical rent",
      description: `Average monthly private rent for a ${home} home in the borough (mean of new and existing tenancies, ONS Price Index of Private Rents, August 2026). Borough level: every area in a borough shows the same rent. A ballpark, not the rent of any home.`,
      carrier: "lad",
      unit: "£ a month",
      direction: "higher-is-more",
      periods: ["2026-08"],
      legend: stops.map((value, index) => [value, TYPICAL_COLOURS[index], `£${value.toLocaleString("en-GB")}${index === stops.length - 1 ? "+" : ""}`] as [number, string, string]),
      provenance: { ...provenance("ons-pipr", "ONS Price Index of Private Rents", "https://www.ons.gov.uk/", "preview-layer-typical-rent"), licence: "OGL-3.0", attribution: "Source: Office for National Statistics, Price Index of Private Rents. Open Government Licence v3.0." },
      caveats: ["Borough-wide: every neighbourhood in a borough reads the borough's rent.", "The mean rent of new and existing tenancies, not asking rents for homes on the market today.", "No City of London figures are published."],
    })),
  metric({
    id: "flood-risk",
    label: "Homes at flood risk",
    shortLabel: "Flood risk",
    description: "Share of the area's homes in a medium or high flood-risk band (a 1% chance a year or more) from rivers and the sea or from surface water, read at each home's point (Environment Agency NaFRA2, 2025).",
    carrier: "lsoa",
    unit: "%",
    direction: "higher-is-more",
    periods: ["2025-01"],
    legend: [
      [0, "#3a7d44", "0%"],
      [5, "#7ba05b", "5%"],
      [15, "#f4d35e", "15%"],
      [30, "#c96a3b", "30%"],
      [50, "#b23a48", "50%+"],
    ],
    provenance: { ...provenance("ea-nafra2", "Environment Agency National Flood Risk Assessment (NaFRA2)", "https://www.gov.uk/government/collections/flooding-and-coastal-erosion-risk-management-data", "preview-layer-flood-risk"), attribution: "Contains public sector information licensed under the Open Government Licence v3.0. © Environment Agency copyright and/or database right." },
    caveats: ["Modelled chance of flooding each year, not a record of past floods.", "Areas with fewer than 10 homes with a point show no share."],
  }),
  ...([["good-schools-nearby", "primary", "KS2 reading, writing and maths"], ["good-schools-nearby-secondary", "secondary", "KS4 Attainment 8"]] as const)
    .map(([id, phase, measure]) => metric({
      id,
      label: `Good ${phase} schools within 1.5 km`,
      shortLabel: "Good schools nearby",
      description: `Open state ${phase} schools within 1.5 km of the area's centre that rank in England's top 25% (${measure}, latest year).`,
      carrier: "lsoa",
      unit: "schools",
      direction: "higher-is-better",
      periods: ["2025-07"],
      legend: [
        [0, TYPICAL_COLOURS[0], "0"],
        [1, TYPICAL_COLOURS[1], "1"],
        [2, TYPICAL_COLOURS[2], "2"],
        [4, TYPICAL_COLOURS[3], "4"],
        [6, TYPICAL_COLOURS[4], "6+"],
      ],
      provenance: { ...provenance("dfe-performance", "DfE school performance tables", "https://www.compare-school-performance.service.gov.uk/download-data", "preview-layer-good-schools"), attribution: "Department for Education school performance data and Get Information about Schools. Open Government Licence v3.0." },
      caveats: ["Straight-line distance from a point inside the area, not walking distance or a catchment.", "Only London state schools are counted, so areas near London's edge may read low."],
    })),
  metric({
    id: "student-share",
    label: "Full-time students",
    shortLabel: "Student areas",
    description: "% of residents aged 16 and over who were full-time students on census day, 21 March 2021 (ONS Census 2021, table TS066). It describes the area; it is never ranked or used to match areas.",
    carrier: "lsoa",
    unit: "%",
    direction: "higher-is-more",
    periods: ["2021-03"],
    legend: [3, 6, 9, 14, 24].map((value, index, all) => [value, TYPICAL_COLOURS[index], `${value}%${index === all.length - 1 ? "+" : ""}`] as [number, string, string]),
    provenance: { ...provenance("ons-census-2021", "Office for National Statistics, Census 2021", "https://www.nomisweb.co.uk/sources/census_2021_bulk", "preview-layer-student-share"), attribution: "Census 2021: Office for National Statistics. Contains public sector information licensed under the Open Government Licence v3.0." },
    caveats: ["Census day fell during the pandemic: some students were counted at their family home, away from term-time addresses."],
  }),
  // Layers v5 PR 3 batch 2 (migration 101): mirrors the definitions rebuild_supermarket_walk, rebuild_gp_walk
  // and rebuild_broadband_gigabit write. Walks: short (green) to long (red), as Station walk.
  ...([["supermarket-walk", "Walk to a supermarket", "Supermarket", "the nearest supermarket on OpenStreetMap (shop=supermarket, September 2026)",
    { ...provenance("osm", "OpenStreetMap", "https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html", "preview-layer-supermarket-walk"), licence: "ODbL-1.0", attribution: "© OpenStreetMap contributors (ODbL)" },
    "Large and small supermarkets count alike; corner shops do not."],
  ["gp-walk", "Walk to a GP", "GP", "the nearest GP practice (NHS England, Patients Registered at a GP Practice, September 2026)",
    { ...provenance("nhs-gp-practices", "NHS England, Patients Registered at a GP Practice", "https://digital.nhs.uk/data-and-information/publications/statistical/patients-registered-at-a-gp-practice", "preview-layer-gp-walk"), attribution: "Contains information from NHS England, licensed under the current version of the Open Government Licence." },
    "Being near a practice is not registration: each practice sets its own catchment."]] as const)
    .map(([id, label, shortLabel, nearest, source, caveat]) => metric({
      id,
      label,
      shortLabel,
      description: `Walking minutes from a point inside the area to ${nearest}, along a straight line at 4.8 km/h with a 1.3 detour factor.`,
      carrier: "lsoa",
      unit: "minutes",
      direction: "higher-is-more",
      periods: ["2026-09"],
      legend: [
        [0, "#3a7d44", "0 min"],
        [3, "#7ba05b", "3 min"],
        [6, "#f4d35e", "6 min"],
        [10, "#c96a3b", "10 min"],
        [15, "#b23a48", "15 min+"],
      ],
      provenance: source,
      caveats: ["A straight-line estimate, not a walking route.", caveat],
    })),
  metric({
    id: "broadband-gigabit",
    label: "Gigabit broadband",
    shortLabel: "Broadband",
    description: "Share of the area's premises where a gigabit-capable line (1,000 Mbit/s) can be ordered (Ofcom Connected Nations, May 2026).",
    carrier: "lsoa",
    unit: "%",
    direction: "higher-is-better",
    periods: ["2026-05"],
    legend: [
      [0, TYPICAL_COLOURS[0], "0%"],
      [50, TYPICAL_COLOURS[1], "50%"],
      [75, TYPICAL_COLOURS[2], "75%"],
      [90, TYPICAL_COLOURS[3], "90%"],
      [95, TYPICAL_COLOURS[4], "95%+"],
    ],
    provenance: { ...provenance("ofcom-connected-nations", "Ofcom Connected Nations", "https://www.ofcom.org.uk/phones-and-broadband/coverage-and-speeds/connected-nations-update-spring-2026", "preview-layer-broadband-gigabit"), attribution: "Contains Ofcom data licensed under the Open Government Licence v3.0." },
    caveats: ["Availability, not take-up: a line can be ordered, not that a home has it.", "Areas with fewer than 10 premises show no share."],
  }),
];

/**
 * Each preview LSOA's Census share of a category, in %, from the demo People payload; null where it has none.
 * A detailed category (country of birth, language, …) is London's share scaled for the preview area.
 */
function censusShares(metricId: CensusMetricId, area: "1" | "2" | "3" | "london"): number | null {
  const { layer, view } = censusView(metricId)!;
  if (view.perMille !== undefined) return Math.round(view.perMille * DETAILED_FACTORS[area] * 10) / 100;
  const topic = fixtureAreaPeople(`uk:lsoa:E0100000${area === "london" ? "1" : area}`)?.topics.find((entry) => entry.id === layer.topic);
  const members = topic?.categories.filter((category) => view.categories.includes(category.id)) ?? [];
  const shares = members.map((category) => area === "london" ? category.regionShare : category.share);
  if (shares.length === 0 || shares.some((share) => share === null)) return null;
  return Math.round(shares.reduce((sum: number, share) => sum + (share ?? 0), 0) * 1000) / 10;
}

/** Census 2021 layers (lib/census-layers.ts): five steps around London's share, on the neutral ramp. */
function censusDefinitions(): MetricDefinition[] {
  // In CENSUS_METRIC_IDS order: each item's views and subviews, then the detailed tables' picks.
  return CENSUS_METRIC_IDS.map((id) => {
    const { layer, view } = censusView(id)!;
    const london = censusShares(view.metric as CensusMetricId, "london") ?? 10;
    const steps = [0.25, 0.5, 1, 1.5, 2].map((factor) => {
      const value = london * factor;
      return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    }).filter((value, index, all) => index === 0 || value > all[index - 1]);  // rare groups: coinciding steps kept once
    if (steps.length < 2) steps.push(Math.round((steps[0] + 0.1) * 10) / 10);  // nobody at all: still a two-step ramp
    return metric({
      id: view.metric as CensusMetricId,
      label: `${layer.label}: ${view.label}`,
      shortLabel: layer.label,
      description: `Share of ${layer.universe} in the ${view.words} category, Census 2021.${view.msoa ? ` ${MSOA_FIGURES_NOTE}.` : ""} Describes the area as counted on census day; not a ranking.`,
      carrier: "lsoa",
      unit: "%",
      direction: "higher-is-more",
      periods: ["2021-03"],
      legend: steps.map((value, index) => [value, TYPICAL_COLOURS[index], `${value}%${index === steps.length - 1 ? "+" : ""}`]),
      provenance: provenance("ons-census-2021", "Office for National Statistics Census 2021", "https://www.nomisweb.co.uk/sources/census_2021_bulk", "preview-census-2021"),
      caveats: [
        ...(view.msoa ? [`${MSOA_FIGURES_NOTE}. ONS publishes this detailed table down to MSOAs only; the broad groups and world regions are per area.`] : []),
        "Census day was 21 March 2021, during the pandemic: some students and workers were counted away from London.",
        "Census 2021 counts by the Office for National Statistics, Open Government Licence v3.0.",
      ],
    });
  });
}

/** Nature rank and Wildlife seen (lib/nature-layers.ts), on the blue ramp the ETL publishes. */
function natureDefinitions(): MetricDefinition[] {
  const NATURE_BLUES = ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"];
  const gbif = provenance("gbif", "GBIF.org occurrence records (CC0 / CC BY)", "https://www.gbif.org/occurrence/search", "preview-2025");
  return NATURE_METRIC_IDS.map((id) => id === "nature-score"
    ? metric({
      id, label: "Green & trees", shortLabel: "Green & trees",
      description: "A London rank of green land (Sentinel-2), street trees per hectare (GLA) and the nearest nature reserve or SSSI.",
      carrier: "lsoa", unit: "percentile", direction: "higher-is-better", periods: ["2025-01"],
      legend: [[0, NATURE_BLUES[0], "Least green"], [50, NATURE_BLUES[2], "Middle"], [100, NATURE_BLUES[4], "Greenest"]],
      provenance: provenance("close-knit-nature", "Close Knit from Sentinel-2, GLA trees and Natural England", "https://registry.opendata.aws/sentinel-2-l2a-cogs/", "preview-2025"),
      caveats: ["Satellite greenness counts gardens and green roofs as well as parks."],
    })
    : metric({
      id, label: `Wildlife seen: ${WILDLIFE_SPECIES.find((species) => species.id === id)!.label}`, shortLabel: "Wildlife seen",
      description: "How often it turns up among the bird, mammal and amphibian records within 1 km. Grey: under 200 records, too few to say.",
      carrier: "lsoa", unit: "band", direction: "higher-is-more", periods: ["2025-01"],
      legend: [[0, NATURE_BLUES[0], "No record"], [1, NATURE_BLUES[1], "Rarely"], [2, NATURE_BLUES[3], "Sometimes"], [3, NATURE_BLUES[4], "Often"]],
      provenance: gbif,
      caveats: ["Records follow where people look: 'No record' never means absent."],
    }));
}

/** Mobile signal per borough (Ofcom), red (patchy) to green (full); mirrors deploy/migrations/086-area-mobile.sql. */
function mobileDefinitions(): MetricDefinition[] {
  const ofcom = { ...provenance("ofcom-connected-nations", "Ofcom Connected Nations", "https://www.ofcom.org.uk/phones-and-broadband/coverage-and-speeds/connected-nations-update-spring-2026", "preview-ofcom-2026-01"),
    licence: "OGL-3.0", attribution: "Ofcom Connected Nations, spring 2026 update, Open Government Licence v3.0" };
  const legend: [number, string, string][] = [[90, "#b23a48", "90%"], [95, "#c96a3b", "95%"], [98, "#f4d35e", "98%"], [99, "#7ba05b", "99%"], [100, "#3a7d44", "100%"]];
  const caveats = ["Predicted coverage from the networks' models, not measured speed.",
    "Published per borough only: every neighbourhood shows its borough's figure."];
  return [
    metric({ id: "mobile-4g-indoor", label: "Mobile signal: 4G indoors", shortLabel: "4G indoors",
      description: "Share of the borough's homes and offices predicted to get 4G indoors from all four networks (Ofcom).",
      carrier: "lad", unit: "%", direction: "higher-is-better", periods: ["2026-01"], legend, provenance: ofcom, caveats }),
    metric({ id: "mobile-5g-outdoor", label: "Mobile signal: 5G outdoors", shortLabel: "5G outdoors",
      description: "Share of the borough's homes and offices predicted to get 5G outdoors from at least one network (Ofcom).",
      carrier: "lad", unit: "%", direction: "higher-is-better", periods: ["2026-01"], legend, provenance: ofcom, caveats }),
  ];
}

const PREVIEW_AREAS: PreviewArea[] = [
  previewArea("Westminster preview", ["E01000001", "E02000001", "E09000001"], [
    [-0.168, 51.493], [-0.143, 51.489], [-0.119, 51.497], [-0.113, 51.512],
    [-0.123, 51.528], [-0.147, 51.525], [-0.161, 51.514], [-0.168, 51.493],
  ]),
  previewArea("North London preview", ["E01000002", "E02000002", "E09000002"], [
    [-0.123, 51.527], [-0.103, 51.523], [-0.079, 51.531], [-0.068, 51.548],
    [-0.078, 51.566], [-0.101, 51.57], [-0.121, 51.555], [-0.123, 51.527],
  ]),
  previewIslands("South Bank preview", ["E01000003", "E02000003", "E09000003"], [
    [
      [-0.119, 51.501], [-0.101, 51.492], [-0.083, 51.479], [-0.075, 51.495],
      [-0.085, 51.51], [-0.1, 51.512], [-0.119, 51.501],
    ],
    [
      [-0.061, 51.485], [-0.058, 51.508], [-0.071, 51.528], [-0.05, 51.53],
      [-0.04, 51.515], [-0.045, 51.495], [-0.061, 51.485],
    ],
  ]),
];

const CURRENT_VALUES: Record<Exclude<MetricId, "price-per-square-metre" | CensusMetricId>, (number | null)[]> = {
  // Nature rank (0-100) and Wildlife seen (0-3 band; null: fewer than 200 records nearby).
  "nature-score": [34, 58, 41],
  ...Object.fromEntries(WILDLIFE_SPECIES.map((species, index) => [species.id, [null, index % 4, index % 3 === 0 ? 0 : 2.5]])) as
    Record<WildlifeMetricId, (number | null)[]>,
  crime: [54, 112, 76],
  deprivation: [8, 4, 6],
  income: [72_000, 43_000, 52_000],
  "social-renting": [14, 37, 29],
  "stock-value-per-square-metre": [9_100, 5_400, 7_200],
  "station-access": [4.2, 13.5, 7.8],
  "food-hygiene": [88.9, 72.4, 81.0],
  // % of homes at 55 dB Lden or more from road or rail (the area cards' any55Share × 100).
  noise: [43, 61, 28],
  // Pedestrians and cyclists hurt per 1,000 residents a year.
  "road-collisions": [0.8, 0.3, 0.5],
  // Mean NO2 at the homes, µg/m³ (central London runs higher).
  "air-no2": [31.4, 22.6, 27.9],
  // Land titles per 100 homes held by UK and overseas companies (central London runs higher).
  "ownership-company-share": [18.2, 4.1, 7.6],
  "ownership-overseas-share": [6.3, 0.4, 1.2],
  // Km to the nearest new station under construction or consented.
  "future-station-distance": [4.6, 9.8, 6.1],
  // Typical home price (adjusted £): Westminster, North London, South Bank. Null: under 5 sales, suppressed.
  "typical-price": [690_000, 520_000, 575_000],
  "typical-price-flat": [620_000, 455_000, 510_000],
  "typical-price-terraced": [1_350_000, 905_000, 980_000],
  "typical-price-semi": [1_650_000, 1_100_000, 1_050_000],
  "typical-price-detached": [null, 1_850_000, null],
  // Borough change in the official index, %: Westminster, Islington, Southwark (made up).
  "hpi-change-5y": [-12.4, 6.1, 8.3],
  "hpi-change-10y": [-4.0, 14.9, 21.6],
  // Rent change over 1 and 5 years (%, borough figures, ONS PIPR).
  "rent-change-1y": [1.0, 4.2, 2.8],
  "rent-change-5y": [34.7, 27.5, 31.2],
  // Mean council tax band (A = 1 ... H = 8): Westminster, North London, South Bank.
  "council-tax-band-mean": [5.4, 3.6, 4.1],
  // Airbnb listings per 1,000 homes: Westminster, North London, South Bank.
  "short-lets-per-1000": [96.4, 31.2, 44.8],
  // New homes permitted or being built per 1,000 homes.
  "pipeline-homes-per-1000": [12.5, 4.1, 38],
  // % of the borough's premises (Ofcom): 4G indoors from all four networks, 5G outdoors from any.
  "mobile-4g-indoor": [99.9, 99.6, 98.8],
  "mobile-5g-outdoor": [100, 100, 99.9],
  // Licensed HMOs per 1,000 homes (borough registers); null: the borough has not published its register.
  "hmo-per-1000": [4.1, 17.6, null],
  // Layers v5 PR 3 (made up): borough rents (£ a month), % of homes at flood risk, good schools within 1.5 km,
  // % of residents 16+ who are full-time students (descriptive: no London percentile).
  "typical-rent": [3450, 2600, 2400],
  "typical-rent-1-bed": [2550, 2000, 1850],
  "typical-rent-3-bed": [5200, 3500, 3100],
  "flood-risk": [22.4, 1.8, 41.0],
  "good-schools-nearby": [3, 5, 1],
  "good-schools-nearby-secondary": [1, 2, 0],
  "student-share": [18.5, 9.2, 21.7],
  // Layers v5 PR 3 batch 2 (made up): minutes' walk to the nearest supermarket and GP, % of premises with gigabit.
  "supermarket-walk": [2.4, 4.1, 7.9],
  "gp-walk": [3.6, 6.2, 11.4],
  "broadband-gigabit": [96.2, 88.5, 71.0],
};

/** Sales behind each preview area's typical price; under 20 borrows the MSOA, under 5 shows nothing. */
const TYPICAL_SALES: Partial<Record<MetricId, number[]>> = {
  "typical-price": [64, 41, 58],
  "typical-price-flat": [41, 23, 37],
  "typical-price-terraced": [9, 24, 31],
  "typical-price-semi": [6, 22, 8],
  "typical-price-detached": [2, 21, 3],
};

export const SEARCH_RESULTS: SearchResult[] = [
  searchResult("SW1A 1AA", "Westminster, London", "uk:lsoa:E01000001", "100000000001", [-0.1416, 51.501]),
  searchResult("WC1A 1AA", "North London preview", "uk:lsoa:E01000002", null, [-0.094, 51.545]),
  searchResult("SE1 7PB", "South Bank, London", "uk:lsoa:E01000003", null, [-0.089, 51.503]),
  searchAddressResult(
    "10 Sample Street, SW1A 1AB", "2 recorded sales · preview address",
    "uk:lsoa:E01000001", "uk:addr:a1b2c3d4e5f6", [-0.1416, 51.501]),
  searchResult("St James's · SW1A", "Westminster preview MSOA · E02000001 · demo statistical geography", "uk:msoa:E02000001", null, [-0.143, 51.509]),
  searchResult("Westminster", "Westminster preview borough · E09000001 · demo statistical geography", "uk:lad:E09000001", null, [-0.14, 51.51]),
  searchResult("Highbury · N5", "North London preview MSOA · E02000002 · demo statistical geography", "uk:msoa:E02000002", null, [-0.094, 51.545]),
  searchResult("Islington", "North London preview borough · E09000002 · demo statistical geography", "uk:lad:E09000002", null, [-0.09, 51.55]),
  searchResult("Bankside · SE1", "South Bank preview MSOA · E02000003 · demo statistical geography", "uk:msoa:E02000003", null, [-0.085, 51.5]),
  searchResult("Southwark", "South Bank preview borough · E09000003 · demo statistical geography", "uk:lad:E09000003", null, [-0.08, 51.5]),
];

const GEOGRAPHY_PARENTS: Record<string, GeographyId> = Object.fromEntries(
  PREVIEW_AREAS.flatMap((area) => [
    [`uk:lsoa:${area.codes.lsoa}`, `uk:msoa:${area.codes.msoa}`],
    [`uk:msoa:${area.codes.msoa}`, `uk:lad:${area.codes.lad}`],
  ]),
);

export function parentGeographyId(id: GeographyId): GeographyId | null {
  return GEOGRAPHY_PARENTS[id] ?? null;
}

export const PROPERTY_HISTORIES: PropertyHistory[] = [
  {
    uprn: "100000000001",
    address: "1 Parliament Preview, London, SW1A 1AA",
    geographyId: "uk:lsoa:E01000001",
    transactions: [
      {
        date: "2006-06-15",
        nominalPrice: 280_000,
        floorAreaSquareMetres: 54,
        inflationAdjustedPrice: 467_000,
        localMarketAdjustedPrice: 611_000,
      },
      {
        date: "2022-11-03",
        nominalPrice: 570_000,
        floorAreaSquareMetres: 54,
        inflationAdjustedPrice: 625_000,
        localMarketAdjustedPrice: 668_000,
      },
    ],
    estimateDisclaimer: "Local-market comparisons follow area-level £/m² change. They are not property valuations.",
    sourceVersion: "preview-hmlr-epc-cpih-2026-06",
  },
];

export const ADDRESS_HISTORIES: AddressHistory[] = [
  {
    addressId: "uk:addr:a1b2c3d4e5f6",
    displayAddress: "10 Sample Street, Westminster, London, SW1A 1AB",
    postcode: "SW1A 1AB",
    geographyId: "uk:lsoa:E01000001",
    saleCount: 2,
    coordinatesPrecision: "postcode",
    transactions: [
      { date: "2006-06-15", nominalPrice: 280_000, floorAreaSquareMetres: null },
      { date: "2022-11-03", nominalPrice: 570_000, floorAreaSquareMetres: 54 },
    ],
    estimateDisclaimer: "Recorded achieved sale prices, not valuations or asking prices.",
    sourceVersion: "preview-hmlr-epc-2026-06",
  },
];

export function getAddressHistory(id: string): AddressHistory | null {
  return ADDRESS_HISTORIES.find((history) => history.addressId === id) ?? null;
}

// Preview: other flats at 10 Sample Street (too few for a median) and the
// rest of the street (enough). Mirrors nearby-sales.v1 from the API.
export const NEARBY_SALES: NearbySales[] = [
  {
    schemaVersion: "nearby-sales.v1",
    addressId: "uk:addr:a1b2c3d4e5f6",
    windowYears: 10,
    building: {
      saleCount: 2,
      sales: [
        { date: "2024-03-01", nominalPrice: 610_000, propertyType: "flat", tenure: "leasehold", newBuild: false },
        { date: "2021-06-30", nominalPrice: 495_000, propertyType: "flat", tenure: "leasehold", newBuild: false },
      ],
      medianPricePerSquareMetre: null,
      medianSampleSize: 2,
    },
    street: {
      saleCount: 6,
      sales: [
        { date: "2025-09-01", nominalPrice: 1_250_000, propertyType: "terraced", tenure: "freehold", newBuild: false },
        { date: "2024-05-20", nominalPrice: 980_000, propertyType: "terraced", tenure: "freehold", newBuild: false },
        { date: "2023-02-11", nominalPrice: 1_100_000, propertyType: "terraced", tenure: "freehold", newBuild: false },
        { date: "2022-08-08", nominalPrice: 875_000, propertyType: "flat", tenure: "leasehold", newBuild: true },
        { date: "2020-10-10", nominalPrice: 1_500_000, propertyType: "semi-detached", tenure: "freehold", newBuild: false },
        { date: "2018-04-04", nominalPrice: 760_000, propertyType: "flat", tenure: "leasehold", newBuild: false },
      ],
      medianPricePerSquareMetre: 10_500,
      medianSampleSize: 6,
    },
    disclaimer: "Preview data. Recorded achieved sale prices for other homes, not valuations; per-sale floor " +
      "area is not shown and the median £/m² appears only from 5 sales.",
  },
];

export function getNearbySales(id: string): NearbySales | null {
  return NEARBY_SALES.find((entry) => entry.addressId === id) ?? null;
}

// Preview: an area evidence pack for every preview LSOA, as the API serves one for every neighbourhood (the
// sitemap lists each LSOA's /pack), all with the same illustrative figures. Mirrors area-evidence-pack.v1 (the
// value of the API's evidence envelope). The preview addresses (NEARBY_SALES) all sit in the Westminster one.
const PREVIEW_PACK_AREA = "uk:lsoa:E01000001";

export function getAreaPack(geography: string, address?: string): AreaEvidencePack | "address-outside" | null {
  const area = PREVIEW_AREAS.find((candidate) => `uk:lsoa:${candidate.codes.lsoa}` === geography);
  if (!area) return null;
  let nearbySales: AreaEvidencePack["nearbySales"] = null;
  if (address) {
    const nearby = getNearbySales(address);
    if (!nearby || geography !== PREVIEW_PACK_AREA) return "address-outside";
    const summary = (group: NearbySales["building"]) => group && {
      saleCount: group.saleCount,
      medianPricePerSquareMetre: group.medianPricePerSquareMetre,
      medianSampleSize: group.medianSampleSize,
    };
    nearbySales = {
      addressId: nearby.addressId, windowYears: nearby.windowYears,
      building: summary(nearby.building), street: summary(nearby.street), disclaimer: nearby.disclaimer,
    };
  }
  return {
    schemaVersion: "area-evidence-pack.v1",
    productReleaseId: "demo-fixture-pack",
    geographyId: geography as GeographyId,
    name: `${area.name} LSOA`,
    carrier: "lsoa",
    market: {
      available: true, periodEnd: "2026-07-31", salesWindowMonths: 12, salesCount: 24, dwellings: 400,
      dwellingsSold: 16, turnoverPercent: 4, leaseholdShareOfSales: 0.625, tenureKnownSales: 24,
      priceWindowMonths: 36, minimumSample: 10,
      newBuild: { medianPricePerSquareMetre: null, sampleSize: 6 },
      resale: { medianPricePerSquareMetre: 10_500, sampleSize: 40 },
      newBuildPremiumPercent: null,
      growth: { period: "2026-06", growth1y: 2.5, growth3y: -1.2, growth5y: 8, growth10y: 31.4 },
      sourceVersion: "preview-hmlr-ppd",
    },
    crime: { period: "2026-06", value: 56, unit: "per 1,000 residents", regionPercentile: 40, quality: "observed", sourceVersion: "preview-police-uk" },
    noise: {
      available: true, dwellings: 400, road55Share: 0.41, rail55Share: 0.05, any55Share: 0.43,
      any65Share: 0.08, roadLdenMedian: 54.2, sourceVersion: "preview-defra-noise",
    },
    schools: {
      radiusMetres: 1500, count: 2, primary: 1, secondary: 1,
      nearest: [
        { urn: "100001", name: "Preview Primary School", phase: "Primary", distanceMetres: 350, latestInspection: "Good",
          standingInspection: { grade: "Good", framework: "legacy-overall", year: "2023", ungradedVisit: null }, reportCard: null, sourceVersion: "preview-ofsted" },
        { urn: "100002", name: "Preview Academy", phase: "Secondary", distanceMetres: 900, latestInspection: "Outstanding",
          standingInspection: { grade: "Outstanding", framework: "legacy-overall", year: "2022", ungradedVisit: null }, reportCard: null, sourceVersion: "preview-ofsted" },
      ],
    },
    nearbySales,
    sources: [
      { release: "preview-hmlr-ppd", sourceUrl: "https://www.gov.uk/government/collections/price-paid-data", licence: "OGL-3.0", attribution: "Contains HM Land Registry data © Crown copyright and database right" },
      { release: "preview-police-uk", sourceUrl: "https://data.police.uk/", licence: "OGL-3.0", attribution: "Police.uk open data" },
      { release: "preview-defra-noise", sourceUrl: "https://environment.data.gov.uk/", licence: "OGL-3.0", attribution: "Defra strategic noise mapping Round 4" },
      { release: "preview-ofsted", sourceUrl: "https://www.gov.uk/government/organisations/ofsted", licence: "OGL-3.0", attribution: "Ofsted inspection outcomes" },
    ],
    caveats: [
      "Preview data: illustrative, not for decisions.",
      "Leasehold share is the share of the last 12 months' sales recorded as leasehold, not the share of homes that are leasehold.",
    ],
  };
}

const DFE_PERFORMANCE_URL = "https://explore-education-statistics.service.gov.uk/";
const OFSTED_REPORT_CARDS_URL = "https://www.gov.uk/guidance/understanding-ofsted-report-cards-and-grades";

/** Preview Top school badges (school-card.v1 › topBadge): the list's Top chip and the demo card. */
const PRIMARY_BADGE: SchoolTopBadge = {
  isTop: false,
  chips: [{ id: "rising", label: "Rising (+12 pts since 2018/19)" }],
  line: null,
  year: "2024/25",
  reasons: ["Expected standard, RWM: P81 of London primaries (2024/25)", "Higher standard, RWM: P77 (2024/25)", "Ofsted report card 2026: nothing below Expected, safeguarding met"],
  missingReason: null,
  criteria: "Top 10% of London primaries on Expected standard, RWM and top 25% on Higher standard, RWM (2024/25, cohort 30+), and Ofsted Good or better or a report card with nothing below Expected",
};

const SECONDARY_BADGE: SchoolTopBadge = {
  isTop: true,
  chips: [{ id: "top-results", label: "Top 10% results" }, { id: "strong-sixth-form", label: "Strong sixth form" }],
  line: "Top school: top 10% London Attainment 8 2024/25 · Ofsted Good",
  year: "2024/25",
  reasons: ["Attainment 8: P93 of London secondaries (2024/25)", "Grade 5+ English and maths: P89 (2024/25)", "Ofsted Good (2023)"],
  missingReason: null,
  criteria: "Top 10% of London secondaries on Attainment 8 and top 25% on Grade 5+ English and maths (2024/25, cohort 30+), and Ofsted Good or better or a report card with nothing below Expected",
};

export const SCHOOLS: SchoolSummary[] = [
  {
    schoolId: "uk:school:100001",
    urn: "100001",
    name: "Westminster Primary Preview",
    previousNames: ["Old Town Primary Preview"],
    status: "open",
    closedDate: null,
    predecessorUrn: "100003",
    successorUrn: null,
    observations: [
      {
        kind: "performance",
        academicYear: "2024/25",
        measure: "progress",
        value: 0.4,
        cohortSize: 58,
        suppressed: false,
        sourceUrl: DFE_PERFORMANCE_URL,
        sourceRelease: "preview-dfe-performance-2026-09",
      },
      {
        kind: "performance",
        academicYear: "2024/25",
        measure: "attainment",
        value: 71,
        cohortSize: 58,
        suppressed: false,
        sourceUrl: DFE_PERFORMANCE_URL,
        sourceRelease: "preview-dfe-performance-2026-09",
      },
      {
        kind: "inspection-current",
        academicYear: "2024/25",
        measure: "achievement",
        value: 3,
        cohortSize: null,
        suppressed: false,
        sourceUrl: OFSTED_REPORT_CARDS_URL,
        sourceRelease: "preview-ofsted-2026-09",
      },
    ],
    missingObservations: [],
    phase: "primary",
    type: "Community school",
    ageRange: { from: 3, to: 11 },
    gender: "Mixed",
    faith: null,
    selectivity: "Non-selective",
    capacity: 420,
    senProvision: ["SEN support"],
    latitude: 51.503,
    longitude: -0.139,
    journeyMinutes: 14,
    qualityFacets: { achievement: 78, attendance: 72, inclusion: 84, parentView: 76 },
    inspectionFramework: "report-card",
    parentViewResponses: 42,
    topBadge: PRIMARY_BADGE,
    admissionEvidence: {
      kind: "historical-reach",
      academicYears: ["2023/24", "2024/25", "2025/26"],
      yearsWithin: 2,
      measurementMethod: "straight-line",
      sourceUrls: ["https://www.westminster.gov.uk/school-admissions"],
      cutoffs: [
        { academicYear: "2023/24", distanceMetres: 920, sourceUrl: "https://www.westminster.gov.uk/school-admissions", priorityGroup: "distance" },
        { academicYear: "2024/25", distanceMetres: 780, sourceUrl: "https://www.westminster.gov.uk/school-admissions", priorityGroup: "distance" },
        { academicYear: "2025/26", distanceMetres: 850, sourceUrl: "https://www.westminster.gov.uk/school-admissions", priorityGroup: "distance" },
      ],
      isProbability: false,
      authorityCode: "E09000033",
      authorityName: "Westminster",
      guidanceUrl: "https://www.westminster.gov.uk/school-admissions",
      priorityRules: ["Looked-after children", "Sibling priority", "Distance (straight-line)"],
      priorityArea: "No priority area published for this school — distance criterion only.",
      missingYears: [],
    },
    sourceVersion: "preview-dfe-ofsted-2026-06",
  },
  {
    schoolId: "uk:school:100002",
    urn: "100002",
    name: "North London Secondary Preview",
    previousNames: [],
    status: "open",
    closedDate: null,
    predecessorUrn: null,
    successorUrn: null,
    observations: [
      {
        kind: "inspection-legacy",
        academicYear: "2019/20",
        measure: "overall-judgement",
        value: "Good",
        cohortSize: null,
        suppressed: false,
        sourceUrl: OFSTED_REPORT_CARDS_URL,
        sourceRelease: "preview-ofsted-2026-09",
      },
      {
        kind: "performance",
        academicYear: "2024/25",
        measure: "attainment",
        value: 64,
        cohortSize: 4,
        suppressed: true,
        sourceUrl: DFE_PERFORMANCE_URL,
        sourceRelease: "preview-dfe-performance-2026-09",
      },
    ],
    missingObservations: ["progress:2024/25:cohort-size"],
    phase: "secondary",
    type: "Academy",
    ageRange: { from: 11, to: 18 },
    gender: "Mixed",
    faith: null,
    selectivity: "Non-selective",
    capacity: 1_100,
    senProvision: [],
    latitude: 51.545,
    longitude: -0.094,
    journeyMinutes: 21,
    qualityFacets: { achievement: 70, attendance: 68, inclusion: 75, parentView: null },
    inspectionFramework: "legacy-overall",
    parentViewResponses: null,
    topBadge: SECONDARY_BADGE,
    admissionEvidence: {
      kind: "unavailable",
      academicYears: ["2023/24", "2024/25"],
      yearsWithin: null,
      measurementMethod: null,
      sourceUrls: ["https://www.camden.gov.uk/school-admissions"],
      cutoffs: [
        { academicYear: "2023/24", distanceMetres: 1200, sourceUrl: "https://www.camden.gov.uk/school-admissions", priorityGroup: "distance" },
        { academicYear: "2024/25", distanceMetres: 940, sourceUrl: "https://www.camden.gov.uk/school-admissions", priorityGroup: "distance" },
        { academicYear: "2024/25", distanceMetres: 2100, sourceUrl: "https://www.camden.gov.uk/school-admissions", priorityGroup: "sibling" },
      ],
      isProbability: false,
      authorityCode: "E09000007",
      authorityName: "Camden",
      guidanceUrl: "https://www.camden.gov.uk/school-admissions",
      priorityRules: ["Looked-after children", "Sibling priority", "Distance (method changed 2024/25)"],
      priorityArea: "Published priority-area description — geometry held by the authority, never an inferred circle.",
      missingYears: ["2025/26"],
    },
    sourceVersion: "preview-dfe-ofsted-2026-06",
  },
  {
    schoolId: "uk:school:100003",
    urn: "100003",
    name: "Old Town Primary Preview",
    previousNames: [],
    status: "closed",
    closedDate: "2024-08-31",
    predecessorUrn: null,
    successorUrn: "100001",
    observations: [
      {
        kind: "performance",
        academicYear: "2022/23",
        measure: "attainment",
        value: 58,
        cohortSize: 44,
        suppressed: false,
        sourceUrl: DFE_PERFORMANCE_URL,
        sourceRelease: "preview-dfe-performance-2026-09",
      },
    ],
    missingObservations: ["progress:2022/23:cohort-size"],
    phase: "primary",
    type: "Community school",
    ageRange: { from: 3, to: 11 },
    gender: "Mixed",
    faith: null,
    selectivity: "Non-selective",
    capacity: null,
    senProvision: [],
    latitude: 51.501,
    longitude: -0.141,
    journeyMinutes: null,
    qualityFacets: { achievement: null, attendance: null, inclusion: null, parentView: null },
    inspectionFramework: "legacy-overall",
    parentViewResponses: null,
    admissionEvidence: {
      kind: "unavailable",
      academicYears: [],
      yearsWithin: null,
      measurementMethod: null,
      sourceUrls: [],
      cutoffs: [],
      isProbability: false,
    },
    sourceVersion: "preview-dfe-ofsted-2026-06",
  },
];

export function searchSchools(query: string): SchoolSummary[] {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  if (!needle) return SCHOOLS;
  return SCHOOLS.filter((school) => `${school.name} ${school.previousNames.join(" ")} ${school.phase} ${school.type}`.toLocaleLowerCase("en-GB").includes(needle));
}

export function getAreaSchools(id: GeographyId): SchoolSummary[] {
  const index = Number(id.slice(-1)) - 1;
  return index >= 0 ? SCHOOLS.map((school, position) => ({ ...school, journeyMinutes: school.journeyMinutes === null ? null : school.journeyMinutes + Math.abs(position - index) * 8 })) : [];
}

export const VALIDATED_FORECAST_HORIZONS: readonly ("1y" | "5y")[] = [];

export function isForecastHorizonValidated(horizon: "1y" | "5y"): boolean {
  return VALIDATED_FORECAST_HORIZONS.includes(horizon);
}

export function unvalidatedForecast(id: GeographyId, horizon: "1y" | "5y", release: string): PriceForecast {
  return {
    schemaVersion: "price-forecast.v1",
    geographyId: id,
    carrierGeographyId: id,
    horizon,
    status: "failed-backtest",
    range: null,
    scenarios: null,
    backtest: null,
    suppressionReason: `Price forecasts for the ${horizon} horizon have not passed predeclared validation yet (release ${release}).`,
    sourceVersion: release,
  };
}

export function isFixtureSourceVersion(sourceVersion: string): boolean {
  return sourceVersion.startsWith("preview-");
}

export function realPilotUnavailableReason(feature: string, release: string): string {
  return `${feature} is not published in this release yet (release ${release}).`;
}

export function unavailableForecast(id: GeographyId, horizon: "1y" | "5y", release: string): PriceForecast {
  return {
    schemaVersion: "price-forecast.v1",
    geographyId: id,
    carrierGeographyId: id,
    horizon,
    status: "insufficient-history",
    range: null,
    scenarios: null,
    backtest: null,
    suppressionReason: realPilotUnavailableReason("Price forecasts", release),
    sourceVersion: release,
  };
}

export function unavailableAreaSchools(id: GeographyId, release: string): {
  schemaVersion: "area-schools.v1";
  geographyId: GeographyId;
  schools: SchoolSummary[];
  unavailableReason: string;
} {
  return {
    schemaVersion: "area-schools.v1",
    geographyId: id,
    schools: [],
    unavailableReason: realPilotUnavailableReason("Schools", release),
  };
}

export function unavailableJourney(): JourneyResult {
  return {
    schemaVersion: "journey-result.v1",
    status: "unreachable",
    medianMinutes: null,
    rangeMinutes: null,
    transfers: null,
    walkingMinutes: null,
    networkVersion: "real-pilot-unpublished",
    timetableDate: "unpublished",
  };
}

export function getMetric(id: MetricId): MetricDefinition {
  const metricDefinition = METRICS.find((candidate) => candidate.id === id);
  if (!metricDefinition) throw new Error(`unknown metric: ${id}`);
  return metricDefinition;
}

const PLACEHOLDER_METRICS = new Map<MetricId, MetricDefinition>();

/**
 * Real mode before (or without) the release's own definition from
 * /api/v1/metrics: names, units and colours only. No fixture source,
 * release, freshness, caveats, periods or legend labels; one stable object
 * per metric so effects keyed on it do not re-run.
 */
export function placeholderMetric(id: MetricId): MetricDefinition {
  const cached = PLACEHOLDER_METRICS.get(id);
  if (cached) return cached;
  const fixture = getMetric(id);
  const placeholder: MetricDefinition = {
    ...fixture,
    periods: [],
    defaultPeriod: "",
    legend: fixture.legend.map((stop) => ({ ...stop, label: "" })),
    provenance: {
      sourceId: fixture.provenance.sourceId, sourceName: "", sourceUrl: "", release: "",
      checksum: "", licence: "", attribution: "", transformationVersion: "",
    },
    freshness: "",
    caveats: [],
  };
  PLACEHOLDER_METRICS.set(id, placeholder);
  return placeholder;
}

/** A metric's definition until the release's own arrives: the fixture in demo, the placeholder in real mode. */
export function fallbackMetric(id: MetricId, mode: DataMode): MetricDefinition {
  return mode === "real" ? placeholderMetric(id) : getMetric(id);
}

/** Whether a definition is the real-mode placeholder (its source lines are not known yet). */
export function isPlaceholderMetric(metric: MetricDefinition): boolean {
  return metric.provenance.release === "";
}

export function getValuePack(metricId: MetricId, requestedPeriod: string): ValuePack {
  const metricDefinition = getMetric(metricId);
  const period = metricDefinition.periods.includes(requestedPeriod)
    ? requestedPeriod
    : metricDefinition.defaultPeriod;
  const values = metricValues(metricId, period);
  return {
    schemaVersion: "area-value-pack.v1",
    metricId,
    period,
    sourceVersion: metricDefinition.provenance.release,
    values: PREVIEW_AREAS.map((area, index) => valueEntry(area, metricDefinition, period, values[index], index)),
  };
}

export function getAreaSummary(id: GeographyId, metricId: MetricId, period: string): AreaSummary | null {
  const pack = getValuePack(metricId, period);
  const exact = pack.values.find((entry) => entry.geographyId === id);
  if (exact) return exact;
  const officialSuffix = id.slice(-6);
  return pack.values.find((entry) => entry.geographyId.endsWith(officialSuffix)) ?? null;
}

export function getPriceTimeline(id: GeographyId): ValuePackEntry[] {
  return PRICE_PERIODS.map((period) =>
    getAreaSummary(id, "price-per-square-metre", period),
  ).filter((entry): entry is ValuePackEntry => entry !== null);
}

export function getMetricTimeline(id: GeographyId, metricId: MetricId): ValuePackEntry[] {
  const definition = getMetric(metricId);
  return definition.periods.map((period) => getAreaSummary(id, metricId, period))
    .filter((entry): entry is ValuePackEntry => entry !== null);
}

export const PROPERTY_SUMMARIES: PropertySummary[] = [
  {
    uprn: "100000000001",
    addressId: "uk:addr:a1b2c3d4e5f6",
    displayAddress: "1 Parliament Preview, London, SW1A 1AA",
    geographyId: "uk:lsoa:E01000001",
    parcelId: "preview-parcel-1",
    location: [-0.1416, 51.501],
    lastSale: { date: "2022-11-03", period: "2022-11", nominalPrice: 570_000, floorAreaSquareMetres: 54 },
    caveats: [
      "The last sale is the recorded achieved price of the last standard sale (HM Land Registry); no home is valued. Area price ranges are on the home's profile.",
    ],
    sourceVersion: "preview-os-uprn-2026-08",
  },
];

export function getPropertySummary(uprn: string): PropertySummary | null {
  return PROPERTY_SUMMARIES.find((property) => property.uprn === uprn) ?? null;
}

export function getPropertyHistory(uprn: string): PropertyHistory | null {
  return PROPERTY_HISTORIES.find((history) => history.uprn === uprn) ?? null;
}

export function searchFixtures(query: string): SearchResult[] {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  if (needle.length < 2) return [];
  return SEARCH_RESULTS.filter((result) =>
    `${result.label} ${result.secondaryLabel} ${result.geographyId} ${demoAreaName(result.geographyId) ?? ""}`
      .toLocaleLowerCase("en-GB").includes(needle),
  );
}

function demoAreaName(id: GeographyId): string | null {
  const code = id.split(":")[2];
  return PREVIEW_AREAS.find((area) => Object.values(area.codes).includes(code))?.name ?? null;
}

export function areaGeoJson(carrier: Carrier): FeatureCollection<Polygon | MultiPolygon, { name: string; geography_id: GeographyId }> {
  const features: Feature<Polygon | MultiPolygon, { name: string; geography_id: GeographyId }>[] = PREVIEW_AREAS.map((area) => ({
    type: "Feature",
    properties: {
      name: area.name,
      geography_id: `uk:${carrierOf(carrier)}:${area.codes[carrier]}`,
    },
    geometry: area.polygon,
  }));
  return { type: "FeatureCollection", features };
}

export function areaGeoJsonForValues(
  values: ValuePackEntry[],
): FeatureCollection<Polygon | MultiPolygon, { name: string; geography_id: GeographyId }> {
  const features = values.map((value) => {
    const area = PREVIEW_AREAS.find((candidate) =>
      Object.values(candidate.codes).some((code) => value.geographyId.endsWith(code)),
    );
    if (!area) throw new Error(`preview geometry missing for ${value.geographyId}`);
    return {
      type: "Feature" as const,
      properties: { name: area.name, geography_id: value.geographyId },
      geometry: area.polygon,
    };
  });
  return { type: "FeatureCollection", features };
}

export function previewBuildings(): FeatureCollection<
  Polygon,
  { render_height: number; render_min_height: number }
> {
  const footprints = [
    building([[-0.147, 51.501], [-0.142, 51.501], [-0.142, 51.505], [-0.147, 51.505], [-0.147, 51.501]], 36),
    building([[-0.102, 51.535], [-0.097, 51.535], [-0.097, 51.54], [-0.102, 51.54], [-0.102, 51.535]], 54),
    building([[-0.091, 51.498], [-0.085, 51.498], [-0.085, 51.503], [-0.091, 51.503], [-0.091, 51.498]], 42),
  ];
  return { type: "FeatureCollection", features: footprints };
}

function valueEntry(
  area: PreviewArea,
  definition: MetricDefinition,
  period: string,
  value: number | null,
  index: number,
): ValuePackEntry {
  const sampleCount = definition.id === "price-per-square-metre"
    ? [42, 18, 31][index]
    : definition.id === "station-access" ? [520, 610, 480][index]
    : definition.id === "food-hygiene" ? [126, 29, 58][index]
    : definition.id === "noise" || definition.id === "air-no2" ? [400, 620, 510][index]
    : definition.id === "road-collisions" ? [6, 2, 4][index]
    : TYPICAL_SALES[definition.id]?.[index] ?? null;
  const carrier = sampleCount !== null && sampleCount < 20 && value !== null ? "msoa" : definition.carrier;
  return {
    geographyId: `uk:${carrierOf(carrier)}:${area.codes[carrier]}`,
    name: area.name,
    metricId: definition.id,
    period,
    value,
    // A Census layer is descriptive only: no rank in London.
    regionPercentile: value === null || isDescriptiveLayer(definition.id) ? null : [92, 38, 61][index],
    countryPercentile: definition.id === "price-per-square-metre" || value === null || isDescriptiveLayer(definition.id) ? null : [98, 84, 91][index],
    sampleCount,
    ...(definition.id === "crime" && value !== null ? { breakdown: crimeBreakdown(value) } : {}),
    ...(definition.id === "price-per-square-metre" ? { breakdown: priceBreakdown(index) } : {}),
    ...(definition.id === "station-access" ? { breakdown: { "within-10-min": [412, 96, 301][index] } } : {}),
    ...(definition.id === "food-hygiene" ? { breakdown: { "rated-4-or-5": [112, 21, 47][index] } } : {}),
    // An MSOA table's category is its MSOA's figure: a wider area's value, like a fallback.
    quality: value === null ? "suppressed" : carrier === definition.carrier && !isMsoaFigure(definition.id) ? "observed" : "fallback",
    sourceVersion: definition.provenance.release,
    carrier,
  };
}

function priceBreakdown(index: number): Record<string, number> {
  const matchedSales = [42, 18, 31][index];
  const excludedSales = [8, 4, 7][index];
  return {
    allSales: matchedSales + excludedSales,
    matchedSales,
    excludedSales,
    newBuild: [6, 2, 5][index],
    flats: [20, 9, 14][index],
  };
}

function crimeBreakdown(total: number): Record<string, number> {
  const burglary = Math.round(total * 0.22 * 10) / 10;
  const violence = Math.round(total * 0.41 * 10) / 10;
  return { burglary, violence, other: Math.round((total - burglary - violence) * 10) / 10 };
}

function metricValues(metricId: MetricId, period: string): (number | null)[] {
  return metricId === "price-per-square-metre"
    ? priceValues(period)
    : metricId === "crime"
      ? crimeValues(period)
    : isCensusMetric(metricId)
      ? (["1", "2", "3"] as const).map((area) => censusShares(metricId, area))
    : CURRENT_VALUES[metricId];
}

function crimeValues(period: string): number[] {
  const offset = monthNumber(period) - monthNumber("2026-06");
  return [54 + offset * 0.35, 112 + offset * 0.2, 76 - offset * 0.15]
    .map((value) => Math.round(value * 10) / 10);
}

function priceValues(period: string): number[] {
  const start = monthNumber("2006-06");
  const progress = (monthNumber(period) - start) / (monthNumber("2026-06") - start);
  const beginnings = [4_150, 3_100, 3_450];
  const endings = [9_600, 6_800, 7_450];
  return beginnings.map((value, index) => Math.round(value + (endings[index] - value) * progress));
}

function monthlyPeriods(start: string, end: string): string[] {
  const periods = [];
  for (let value = monthNumber(start); value <= monthNumber(end); value += 1) {
    periods.push(`${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, "0")}`);
  }
  return periods;
}

function monthNumber(period: string): number {
  const [year, month] = period.split("-").map(Number);
  return year * 12 + month - 1;
}

function previewArea(name: string, codes: [string, string, string], ring: number[][]): PreviewArea {
  return {
    name,
    codes: { lsoa: codes[0], msoa: codes[1], lad: codes[2] },
    polygon: { type: "Polygon", coordinates: [ring] },
  };
}

function previewIslands(name: string, codes: [string, string, string], islands: number[][][]): PreviewArea {
  return {
    name,
    codes: { lsoa: codes[0], msoa: codes[1], lad: codes[2] },
    polygon: { type: "MultiPolygon", coordinates: islands.map((ring) => [ring]) },
  };
}

function building(ring: number[][], height: number): Feature<
  Polygon,
  { render_height: number; render_min_height: number }
> {
  return {
    type: "Feature",
    properties: { render_height: height, render_min_height: 0 },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function searchResult(
  label: string,
  secondaryLabel: string,
  id: GeographyId,
  uprn: string | null,
  center: [number, number],
): SearchResult {
  return { id: `${label}-${id}`, label, secondaryLabel, geographyId: id, uprn, addressId: null, center };
}

function searchAddressResult(
  label: string,
  secondaryLabel: string,
  geographyId: GeographyId,
  addressId: AddressId,
  center: [number, number],
): SearchResult {
  return { id: addressId, label, secondaryLabel, geographyId, uprn: null, addressId, center };
}

function metric(input: Omit<MetricDefinition, "defaultPeriod" | "freshness" | "methodologyPath" | "legend"> & {
  legend: [number, string, string][];
}): MetricDefinition {
  return {
    ...input,
    defaultPeriod: input.periods.at(-1) ?? "",
    freshness: input.provenance.release,
    methodologyPath: metricGuidePath(input.id),
    legend: input.legend.map(([value, colour, label]) => ({ value, colour, label })),
  };
}

function provenance(sourceId: string, sourceName: string, sourceUrl: string, release: string) {
  return {
    sourceId,
    sourceName,
    sourceUrl,
    release,
    checksum: PREVIEW_CHECKSUM,
    licence: "OGL-3.0",
    attribution: `Contains ${sourceName} information licensed under OGL v3.0`,
    transformationVersion: `preview-${sourceId}-v1`,
  };
}

function factor(
  id: FactorDefinition["id"],
  label: string,
  unit: string,
  allowedDirections: FactorDefinition["allowedDirections"],
  defaultDirection: FactorDefinition["defaultDirection"],
): FactorDefinition {
  return {
    id,
    label,
    unit,
    allowedDirections,
    defaultDirection,
    carrierPolicy: "Preserve the source carrier and disclose coarser evidence.",
    utilityDefinition: "London empirical percentile transformed by the selected direction.",
    periods: ["2026-09"],
    scoringEligibility: "eligible",
    caveats: [],
  };
}

