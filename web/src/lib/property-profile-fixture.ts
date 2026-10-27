/**
 * Demo answers for the property profile and postcode home list, used when no
 * evidence API is configured. Numbers line up with the demo address history
 * (10 Sample Street: £280,000 in 2006, £570,000 in 2022, 54 m²), so the demo
 * pages tell one story. 10 Sample Street shows the area price range and the
 * position of its last sale; 12 Sample Street is a terraced house with too
 * few same-type sales nearby, so it shows only its recorded sale.
 */
import type {
  AreaPrices, PostcodeHome, PostcodeHomesResponse, PropertyProfile, PropertyProfileResponse, Withheld,
} from "./property-profile";

const RELEASE = "preview-2026-09";
const DEMO_UPRN = "100000000001";
const THIN_UPRN = "100000000012";
const EPC_ONLY_UPRN = "100000000014";
const POSTCODE = "SW1A 1AB";
const DISCLAIMER = "Recorded sale prices from HM Land Registry and facts from the latest energy certificate. "
  + "No home here is valued.";
const AREA_DISCLAIMER = "About this area's sales, not a valuation of this home. It can't see condition or improvements.";
const PPD_RECORD = "https://landregistry.data.gov.uk/data/ppi/transaction/";

const HOMES: PostcodeHomesResponse["homes"] = [
  {
    addressId: "uk:addr:a1b2c3d4e5f6" as PostcodeHomesResponse["homes"][number]["addressId"],
    uprn: DEMO_UPRN,
    displayAddress: "10 Sample Street, Westminster, London, SW1A 1AB",
    propertyType: "Flat or maisonette",
    tenure: "Leasehold",
    floorAreaSquareMetres: 54,
    energyRating: "C",
    saleCount: 2,
    lastSale: { date: "2022-11-03", price: 570_000 },
    // The home's own EA bands (dwelling_flood), as lib/flood-risk-fixture gives its flood read.
    flood: { riversSea: "low", surfaceWater: "very-low" },
  },
  {
    addressId: "uk:addr:0000000000b2" as PostcodeHomesResponse["homes"][number]["addressId"],
    uprn: THIN_UPRN,
    displayAddress: "12 Sample Street, Westminster, London, SW1A 1AB",
    propertyType: "Terraced",
    tenure: "Freehold",
    floorAreaSquareMetres: 96,
    energyRating: "D",
    saleCount: 1,
    lastSale: { date: "2015-04-17", price: 1_150_000 },
    flood: { riversSea: "very-low", surfaceWater: "very-low" },
  },
  {
    addressId: "uk:addr:0000000000b3" as PostcodeHomesResponse["homes"][number]["addressId"],
    uprn: null,
    displayAddress: "Flat 3, 14 Sample Street, Westminster, London, SW1A 1AB",
    propertyType: null,
    tenure: null,
    floorAreaSquareMetres: null,
    energyRating: null,
    saleCount: 0,
    lastSale: null,
    flood: null,
  },
];

/** Flat 4, 14 Sample Street: no recorded sale, known only from its energy certificate (migration 089). */
const EPC_HOME: PostcodeHome = {
  addressId: null,
  uprn: EPC_ONLY_UPRN,
  displayAddress: "Flat 4, 14 Sample Street, Westminster, London, SW1A 1AB",
  propertyType: "Flat or maisonette",
  tenure: null,
  floorAreaSquareMetres: 47,
  energyRating: "D",
  saleCount: 0,
  lastSale: null,
  flood: null,
  addressSource: "epc",
};

/**
 * CLOSE_KNIT_EPC_ADDRESSES as the API reads it (api/area_api/feature_flags.py): "1" on, "0" off, unset on
 * only in a private preview (CLOSE_KNIT_ACCESS=private). Read per call, so a test can switch it.
 */
export function demoEpcAddresses(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.CLOSE_KNIT_EPC_ADDRESSES?.trim();
  if (value === "0" || value === "1") return value === "1";
  return env.CLOSE_KNIT_ACCESS?.trim() === "private";
}

/** The demo's withheld list: `epcAddresses` drops out while the flag is on. */
function demoWithheld(): Withheld[] {
  return demoEpcAddresses() ? DEMO_WITHHELD.filter((name) => name !== "epcAddresses") : DEMO_WITHHELD;
}

/** The demo postcode's homes, with the EPC-only one while the flag is on (natural order: Flat 3 before Flat 4). */
function demoHomes(): PostcodeHome[] {
  return demoEpcAddresses() ? [...HOMES, EPC_HOME] : HOMES;
}

/** W5 1LR: the recorded homes either side of the street-level demo home (120 Meadvale Road, no recorded sale). */
const STREET_POSTCODE = "W5 1LR";
const STREET_HOMES: PostcodeHomesResponse["homes"] = [116, 124].map((number, index) => ({
  addressId: `uk:addr:00000000${index ? "c124" : "c116"}` as PostcodeHomesResponse["homes"][number]["addressId"],
  uprn: null,
  displayAddress: `${number} Meadvale Road, Ealing, London, ${STREET_POSTCODE}`,
  propertyType: "Semi-detached",
  tenure: "Freehold",
  floorAreaSquareMetres: null,
  energyRating: null,
  saleCount: 1,
  lastSale: index ? { date: "2019-06-28", price: 905_000 } : { date: "2021-03-12", price: 1_010_000 },
}));

/** The preview shows certificate facts but, like the live site, no per-home £/m², estimate or flagged extras. */
const DEMO_WITHHELD: Withheld[] = ["pricePerSqm", "valuation", "epcAddresses", "councilTaxBand", "laeiAir"];

export function demoPostcodeHomes(postcode: string): PostcodeHomesResponse | null {
  if (postcode !== POSTCODE && postcode !== STREET_POSTCODE) return null;
  const street = postcode === STREET_POSTCODE;
  return {
    schemaVersion: "postcode-homes.v1",
    productReleaseId: RELEASE,
    postcode,
    geographyId: "uk:lsoa:E01000001",
    homes: street ? STREET_HOMES : demoHomes(),
    disclaimer: DISCLAIMER,
    withheld: demoWithheld(),
  };
}

const AREAS: PropertyProfile["areas"] = {
  lsoa: { id: "uk:lsoa:E01000001", name: "Westminster preview", displayName: "St James's · SW1A" },
  msoa: { id: "uk:msoa:E02000001", name: "Westminster preview MSOA", displayName: "St James's · SW1A" },
  borough: { id: "uk:lad:E09000001", name: "Westminster preview borough", displayName: "Westminster preview borough" },
};

/** Flats in the demo LSOA: 41 sales since 2023, adjusted to Jun 2026; the 2022 sale sat in the upper middle. */
const FLAT_PRICES: AreaPrices = {
  propertyType: "Flat or maisonette",
  minimumSales: 5,
  range: {
    level: "lsoa", areaId: AREAS.lsoa.id, areaName: AREAS.lsoa.displayName ?? AREAS.lsoa.name, sales: 41, since: "2023-01", adjustedTo: "2026-06",
    p10: 430_000, p25: 520_000, p50: 620_000, p75: 760_000, p90: 905_000,
  },
  position: {
    saleDate: "2022-11-03", year: 2022, band: "upper-middle", bandWords: "upper middle", yearSales: 23,
    today: { from: 620_000, to: 760_000 },
  },
  note: null,
  disclaimer: AREA_DISCLAIMER,
};

/** Terraced houses are rare here: fewer than 5 sales even across the borough's preview, so nothing is shown. */
const THIN_PRICES: AreaPrices = {
  propertyType: "Terraced",
  minimumSales: 5,
  range: null,
  position: null,
  note: "Not enough sales of this type nearby to show a range.",
  disclaimer: AREA_DISCLAIMER,
};

const CAVEATS = [
  "Type and tenure come from the last Land Registry record; rooms, age and rating from the latest energy certificate, which can be years old.",
  "Area prices use standard market sales only (Price Paid category A), each adjusted to the latest month by the local price index; at least 5 sales of the type, or nothing is shown.",
];

const PROFILES: Record<string, PropertyProfile> = {
  [DEMO_UPRN]: {
    uprn: DEMO_UPRN,
    addressId: HOMES[0].addressId,
    displayAddress: HOMES[0].displayAddress,
    postcode: POSTCODE,
    location: [-0.1416, 51.501],
    areas: AREAS,
    facts: {
      propertyType: "Flat or maisonette",
      tenure: "Leasehold",
      newBuildSale: null,
      epcPropertyType: "Flat",
      builtForm: "Mid-Terrace",
      constructionAgeBand: "1900-1929",
      floorAreaSquareMetres: 54,
      habitableRooms: 3,
      floorLevel: "Middle floor",
      energyRating: "C",
      potentialEnergyRating: "B",
      energyCertificateDate: "2022-08-19",
    },
    areaPrices: FLAT_PRICES,
    flood: HOMES[0].flood,
    sales: [
      { date: "2006-06-15", price: 280_000, propertyType: "Flat or maisonette", tenure: "Leasehold", newBuild: false,
        standardSale: true, floorAreaSquareMetres: null,
        sourceUrl: `${PPD_RECORD}2F8E5C0A-0000-4000-8000-000000000006/current` },
      { date: "2022-11-03", price: 570_000, propertyType: "Flat or maisonette", tenure: "Leasehold", newBuild: false,
        standardSale: true, floorAreaSquareMetres: 54,
        sourceUrl: `${PPD_RECORD}E7D1A2B3-0000-4000-8000-000000000022/current` },
    ],
    valuation: null,
    // 2006 is before the borough's ten-year trend, so only the home's own change is known.
    salesSummary: { changeSinceLastSale: { home: 4.4, borough: null, since: 2006, until: 2022 } },
    otherHomes: HOMES.filter((home) => home.uprn !== DEMO_UPRN)
      .map(({ addressId, uprn, displayAddress, lastSale, flood }) => ({ addressId, uprn, displayAddress, lastSale, flood })),
    disclaimer: "Recorded sales are facts from HM Land Registry. Area prices describe this area's sales, not a valuation of this home.",
    caveats: CAVEATS,
    sourceVersion: "preview-os-uprn-2026-08",
  },
  [THIN_UPRN]: {
    uprn: THIN_UPRN,
    addressId: HOMES[1].addressId,
    displayAddress: HOMES[1].displayAddress,
    postcode: POSTCODE,
    location: [-0.1412, 51.5012],
    areas: AREAS,
    facts: {
      propertyType: "Terraced",
      tenure: "Freehold",
      newBuildSale: null,
      epcPropertyType: "House",
      builtForm: "Mid-Terrace",
      constructionAgeBand: "1900-1929",
      floorAreaSquareMetres: 96,
      habitableRooms: 5,
      floorLevel: null,
      energyRating: "D",
      potentialEnergyRating: "C",
      energyCertificateDate: "2014-11-02",
    },
    areaPrices: THIN_PRICES,
    flood: HOMES[1].flood,
    sales: [
      { date: "2015-04-17", price: 1_150_000, propertyType: "Terraced", tenure: "Freehold", newBuild: false,
        standardSale: true, floorAreaSquareMetres: 96,
        sourceUrl: `${PPD_RECORD}9A4B6C2D-0000-4000-8000-000000000015/current` },
    ],
    valuation: null,
    salesSummary: { changeSinceLastSale: null },
    otherHomes: HOMES.filter((home) => home.uprn !== THIN_UPRN)
      .map(({ addressId, uprn, displayAddress, lastSale, flood }) => ({ addressId, uprn, displayAddress, lastSale, flood })),
    disclaimer: "Recorded sales are facts from HM Land Registry. Area prices describe this area's sales, not a valuation of this home.",
    caveats: CAVEATS,
    sourceVersion: "preview-os-uprn-2026-08",
  },
};

/** The EPC-only home's page: certificate facts and its area's flat prices, but no sale, tenure or position. */
const EPC_PROFILE: PropertyProfile = {
  uprn: EPC_ONLY_UPRN,
  addressId: null,
  addressSource: "epc",
  displayAddress: EPC_HOME.displayAddress,
  postcode: POSTCODE,
  location: [-0.1414, 51.5011],
  areas: AREAS,
  facts: {
    propertyType: "Flat or maisonette",
    tenure: null,
    newBuildSale: null,
    epcPropertyType: "Flat",
    builtForm: "Mid-Terrace",
    constructionAgeBand: "1950-1966",
    floorAreaSquareMetres: 47,
    habitableRooms: 2,
    floorLevel: "Ground floor",
    energyRating: "D",
    potentialEnergyRating: "C",
    energyCertificateDate: "2023-05-01",
  },
  areaPrices: { ...FLAT_PRICES, position: null },
  // No band of its own: the page falls back to its postcode's homes.
  flood: null,
  sales: [],
  valuation: null,
  salesSummary: { changeSinceLastSale: null },
  otherHomes: HOMES.map(({ addressId, uprn, displayAddress, lastSale, flood }) => ({ addressId, uprn, displayAddress, lastSale, flood })),
  disclaimer: "Recorded sales are facts from HM Land Registry. Area prices describe this area's sales, not a valuation of this home.",
  caveats: CAVEATS,
  sourceVersion: "preview-epc-2026-08",
};

/** The demo per-address pages that exist (the sitemap's demo shard; the flagged EPC-only home is not listed). */
export const DEMO_HOME_INDEX = { postcodes: [POSTCODE], uprns: Object.keys(PROFILES) };

export function demoPropertyProfile(uprn: string): PropertyProfileResponse | null {
  const epcHome = demoEpcAddresses() ? EPC_HOME : null;
  const profile = uprn === EPC_ONLY_UPRN ? (epcHome && EPC_PROFILE) : PROFILES[uprn];
  if (!profile) return null;
  // While the flag is on, the recorded homes list the EPC-only one among their neighbours, as the API does.
  const otherHomes = epcHome && profile !== EPC_PROFILE
    ? [...profile.otherHomes, { addressId: null, uprn: epcHome.uprn, displayAddress: epcHome.displayAddress, lastSale: null, flood: null }]
    : profile.otherHomes;
  return {
    schemaVersion: "property-profile.v2", productReleaseId: RELEASE,
    profile: { ...profile, otherHomes, withheld: demoWithheld() },
  };
}
