/**
 * Property profile and postcode home list (track K): the API contracts
 * (property-profile.v2, postcode-homes.v1) and the pure wording/maths the
 * pages use. Missing data is null and always reads "Unknown", never 0.
 */
import type { AddressId, AddressSale, GeographyId, MapLayerId } from "./contracts";
import { isCodeName } from "./area-labels";
import type { HomeFloodBands } from "./flood-risk";
import { postcodeSlug } from "./postcode-page";

export interface PriceAtDate {
  date: string;
  price: number;
}

/** Features the API withholds until a review clears them (api/area_api/feature_flags.py `withheld()`). */
export type Withheld = "epc" | "pricePerSqm" | "valuation" | "epcAddresses" | "councilTaxBand" | "laeiAir";

/** An old payload has no list: nothing is withheld. Fallbacks come from the list, never from nulls. */
export function isWithheld(list: readonly Withheld[] | undefined, key: Withheld): boolean {
  return list?.includes(key) ?? false;
}

/** Shown where a home's certificate facts would be while `epc` is withheld. */
export const EPC_WITHHELD_COPY = "Not shown per home yet";

export interface PostcodeHome {
  /** Null for a home known only from its energy certificate (`addressSource: "epc"`). */
  addressId: AddressId | null;
  uprn: string | null;
  displayAddress: string;
  propertyType: string | null;
  tenure: "Freehold" | "Leasehold" | null;
  floorAreaSquareMetres: number | null;
  energyRating: string | null;
  saleCount: number;
  lastSale: PriceAtDate | null;
  /** The home's own Environment Agency flood bands; null with none on record, absent from an old API. */
  flood?: HomeFloodBands | null;
  /** Every recorded sale, as the address history lists them; only when asked for (?sales=true). */
  sales?: AddressSale[];
  /** "epc": no recorded sale, addressed from its energy certificate; listed only while `epcAddresses` is not withheld. */
  addressSource?: "epc";
}

/** A list row's React key: its address, or its UPRN for a home known only from its certificate. */
export function homeKey(home: Pick<PostcodeHome, "addressId" | "uprn" | "displayAddress">): string {
  return home.addressId ?? home.uprn ?? home.displayAddress;
}

export interface PostcodeHomesResponse {
  schemaVersion: "postcode-homes.v1";
  productReleaseId: string;
  postcode: string;
  geographyId: GeographyId | null;
  homes: PostcodeHome[];
  disclaimer: string;
  withheld?: Withheld[];
  /** The address histories' sale-price disclaimer; only with ?sales=true. */
  salesDisclaimer?: string;
}

export interface PropertyFacts {
  propertyType: string | null;
  tenure: "Freehold" | "Leasehold" | null;
  newBuildSale: string | null;
  epcPropertyType: string | null;
  builtForm: string | null;
  constructionAgeBand: string | null;
  floorAreaSquareMetres: number | null;
  habitableRooms: number | null;
  floorLevel: string | null;
  energyRating: string | null;
  potentialEnergyRating: string | null;
  energyCertificateDate: string | null;
  /** "A"–"H"; null until a licensed per-home source is loaded. Read it only behind `councilTaxBandLabel`. */
  councilTaxBand?: string | null;
}

/** Where an area price range comes from: the first level with enough sales. */
export type AreaLevel = "lsoa" | "msoa" | "borough";

/** Coarse positions of a recorded sale against its year, low to high. Never a percentile. */
export const POSITION_BANDS = ["bottom-10", "bottom-quarter", "lower-middle", "upper-middle", "top-quarter", "top-10"] as const;
export type PositionBand = (typeof POSITION_BANDS)[number];

/** Same-type sales since `since`, each adjusted to `adjustedTo` by the local price index; £5k steps. */
export interface AreaPriceRange {
  level: AreaLevel;
  areaId: GeographyId;
  areaName: string | null;
  sales: number;
  since: string;
  adjustedTo: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface AreaPricePosition {
  saleDate: string;
  year: number;
  band: PositionBand;
  bandWords: string;
  yearSales: number;
  /** Today's prices of the same band in the area: open at the top (to null) and bottom (from null). */
  today: { from: number | null; to: number | null };
}

/** "Prices in this area today" (property-profile.v2): area statistics, never a figure for the home. */
export interface AreaPrices {
  propertyType: string | null;
  minimumSales: number;
  range: AreaPriceRange | null;
  position: AreaPricePosition | null;
  note: string | null;
  disclaimer: string;
}

export interface ProfileSale {
  date: string;
  price: number;
  propertyType: string | null;
  tenure: "Freehold" | "Leasehold" | null;
  newBuild: boolean;
  standardSale: boolean;
  floorAreaSquareMetres: number | null;
  /** Price per m², rounded; null unless `pricePerSqm` is not withheld. Read it only behind `isWithheld`. */
  pricePerSquareMetre?: number | null;
  /** The sale's public HM Land Registry Price Paid record. */
  sourceUrl?: string | null;
}

/** The flagged model estimate (CLOSE_KNIT_PER_HOME_VALUATION): read it only behind `isWithheld(…, "valuation")`. */
export interface ProfileValuation {
  value: number;
  low: number;
  high: number;
  method: "floor-area" | "indexed-sale";
  /** This home's last sale, indexed to today, per m² against the local same-type median, %; null without one. */
  vsLocalMedianPerSqm: number | null;
  /** The estimate against the local same-type median price, %. */
  vsLocalTypeMedian: number;
}

/** The only wording for the flagged estimate. */
export const VALUATION_WORDING = "An indicative model estimate, not a valuation";

/**
 * Yearly % change from `since` to `until`: the home's own last two standard sales, and the borough's
 * same type over the same span (or from a single sale to the newest trend year). Never a figure for
 * the home today.
 */
export interface ChangeSinceLastSale {
  home: number | null;
  borough: number | null;
  since: number;
  until: number | null;
}

interface NamedArea {
  id: GeographyId;
  /** The official name ("Southwark 028"): never shown. */
  name: string | null;
  /** The one name to show: "Peckham Rye Common · SE22", else the official name; absent from an old API. */
  displayName?: string | null;
}

export interface PropertyProfile {
  uprn: string;
  addressId: AddressId | null;
  /** "epc": a home known only from its energy certificate (no recorded sale; CLOSE_KNIT_EPC_ADDRESSES). */
  addressSource?: "epc";
  displayAddress: string;
  postcode: string | null;
  location: [number, number];
  areas: { lsoa: NamedArea; msoa: NamedArea | null; borough: NamedArea | null };
  facts: PropertyFacts;
  areaPrices: AreaPrices;
  sales: ProfileSale[];
  /** Null unless `valuation` is not withheld; absent in an old payload. */
  valuation?: ProfileValuation | null;
  salesSummary?: { changeSinceLastSale: ChangeSinceLastSale | null };
  /** The home's own Environment Agency flood bands; null with none on record, absent from an old API. */
  flood?: HomeFloodBands | null;
  otherHomes: Pick<PostcodeHome, "addressId" | "uprn" | "displayAddress" | "lastSale" | "flood">[];
  disclaimer: string;
  caveats: string[];
  sourceVersion: string;
  withheld?: Withheld[];
}

export interface PropertyProfileResponse {
  schemaVersion: "property-profile.v2";
  productReleaseId: string;
  profile: PropertyProfile;
}

export const UNKNOWN = "Unknown";
const UPRN_PATTERN = /^\d{1,12}$/;

export function isUprn(value: string): boolean {
  return UPRN_PATTERN.test(value);
}

export function propertyPath(uprn: string): string {
  return `/property/${uprn}`;
}

/** The property page's report / hide-my-home form: the anchor opens it. */
export const REPORT_HOME_ANCHOR = "report-home";

export function reportHomePath(uprn: string): string {
  return `${propertyPath(uprn)}#${REPORT_HOME_ANCHOR}`;
}

export function postcodeHomesPath(postcode: string): string {
  return `/postcode/${postcodeSlug(postcode)}/homes`;
}

/** Outbound Google links for a point (Maps search pin and Street View panorama). */
export function mapLinks({ lat, lon }: { lat: number; lon: number }): { maps: string; streetView: string } {
  const point = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return {
    maps: `https://www.google.com/maps/search/?api=1&query=${point}`,
    streetView: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point}`,
  };
}

/** The home page's mini map layers, as area360's map has them; ids are the main map's. */
export const HOME_MAP_LAYERS = [
  { id: "price-per-square-metre", label: "Price" },
  { id: "crime", label: "Crime" },
  { id: "deprivation", label: "Deprivation" },
  { id: "income", label: "Income" },
  { id: "social-renting", label: "Social housing" },
] as const satisfies readonly { id: MapLayerId; label: string }[];
export type HomeMapLayer = (typeof HOME_MAP_LAYERS)[number]["id"];

/** The main map on an area with a layer on: where a click on the mini map goes. */
export function homeMapHref(id: GeographyId, layer: HomeMapLayer): string {
  return `/?${new URLSearchParams({ selected: id, layer }).toString()}`;
}

export function signedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNKNOWN;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toLocaleString("en-GB")}%`;
}

export function pounds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNKNOWN;
  return `${value < 0 ? "−" : ""}£${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
}

/** True when the certificate's built form only repeats the type ("Mid-Terrace" under "Terraced"). */
export function repeatsType(builtForm: string | null, propertyType: string | null): boolean {
  if (!builtForm || !propertyType) return false;
  const [form, type] = [builtForm, propertyType].map((text) => text.toLowerCase().replace(/[^a-z]/g, ""));
  return form === type || (type.startsWith("terrace") && form.includes("terrace"));
}

/** Plain words for record jargon: "(Price Paid category A)" → "standard sales only", EPC → energy certificate. */
export function plainWords(text: string): string {
  return text
    .replace(/standard (market )?sales( only)? \(Price Paid category A\)/gi, "standard sales only")
    .replace(/\(?Price Paid category A\)?/gi, "standard sales only")
    .replace(/\bEPCs\b/g, "energy certificates")
    .replace(/\bEPC\b/g, "energy certificate");
}

export function floorArea(value: number | null): string {
  return value === null ? UNKNOWN : `${value} m²`;
}

/** "Band D", or null (nothing to show) while `councilTaxBand` is withheld or the home has no band. */
export function councilTaxBandLabel(band: string | null | undefined, withheld?: readonly Withheld[]): string | null {
  return band && !isWithheld(withheld, "councilTaxBand") ? `Band ${band}` : null;
}

export function factRows(facts: PropertyFacts, withheld?: readonly Withheld[]): { label: string; value: string }[] {
  const band = councilTaxBandLabel(facts.councilTaxBand, withheld);
  return [...certificateRows(facts, withheld), ...(band ? [{ label: "Council tax band", value: band }] : [])];
}

function certificateRows(facts: PropertyFacts, withheld?: readonly Withheld[]): { label: string; value: string }[] {
  if (isWithheld(withheld, "epc")) {
    return [
      { label: "Type", value: facts.propertyType ?? UNKNOWN },
      { label: "Tenure", value: facts.tenure ?? UNKNOWN },
      { label: "Size and energy", value: EPC_WITHHELD_COPY },
    ];
  }
  const certificate = facts.energyRating
    ? `${facts.energyRating}${facts.potentialEnergyRating ? ` (could reach ${facts.potentialEnergyRating})` : ""}`
    : UNKNOWN;
  const type = [facts.builtForm, facts.epcPropertyType].filter(Boolean).join(" ").toLowerCase();
  return [
    { label: "Type", value: facts.propertyType ?? (type ? capitalise(type) : UNKNOWN) },
    // Left out when it only repeats the type ("Mid-Terrace" under "Terraced").
    ...(repeatsType(facts.builtForm, facts.propertyType) ? [] : [{ label: "Built form", value: facts.builtForm ?? UNKNOWN }]),
    { label: "Tenure", value: facts.tenure ?? UNKNOWN },
    { label: "Built", value: facts.constructionAgeBand ?? UNKNOWN },
    { label: "Floor area", value: floorArea(facts.floorAreaSquareMetres) },
    { label: "Habitable rooms", value: facts.habitableRooms === null ? UNKNOWN : String(facts.habitableRooms) },
    { label: "Floor", value: facts.floorLevel ?? (facts.epcPropertyType === "House" || facts.epcPropertyType === "Bungalow" ? "Whole house" : UNKNOWN) },
    { label: "Energy rating", value: certificate },
    { label: "Certificate date", value: facts.energyCertificateDate ?? UNKNOWN },
  ];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The noun for a Price Paid type, plural: "Terraced" → "terraced houses". */
const TYPE_PLURAL: Record<string, string> = {
  "Flat or maisonette": "flats", Terraced: "terraced houses", "Semi-detached": "semi-detached houses", Detached: "detached houses",
};
/** The adjective before "sales": "Terraced" → "terraced sales". */
const TYPE_ADJECTIVE: Record<string, string> = {
  "Flat or maisonette": "flat", Terraced: "terraced", "Semi-detached": "semi-detached", Detached: "detached",
};
const LEVEL_WORDS: Record<AreaLevel, string> = {
  lsoa: "this neighbourhood",
  msoa: "the wider neighbourhood",
  borough: "the borough",
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" → "Oct 2026". */
export function monthYear(period: string): string {
  const [year, month] = period.split("-");
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
}

/** £ rounded for people: "£680k", "£1.2m". */
export function shortPounds(value: number): string {
  if (value >= 1_000_000) return `£${(Math.round(value / 10_000) / 100).toLocaleString("en-GB")}m`;
  return `£${Math.round(value / 1_000).toLocaleString("en-GB")}k`;
}

/** "£680k–£820k", "above £850k", "below £410k". */
export function priceSpan(from: number | null, to: number | null): string {
  if (from !== null && to !== null) return `${shortPounds(from)}–${shortPounds(to)}`;
  if (from !== null) return `above ${shortPounds(from)}`;
  return to !== null ? `below ${shortPounds(to)}` : UNKNOWN;
}

/**
 * Which area a range uses, in words: "the wider neighbourhood: St James's · SW1A". The level in plain
 * words, never "LSOA"; an official code ("Southwark 028A") is never shown.
 */
export function areaUsed(range: AreaPriceRange): string {
  const name = range.areaName && !isCodeName(range.areaName, range.areaId) ? range.areaName : null;
  return `${LEVEL_WORDS[range.level]}${name ? `: ${name}` : ""}`;
}

/**
 * The card's lead: "Terraced houses here: most sell for £680k–£820k (middle
 * half of 41 sales since 2023, adjusted to Oct 2026)". Null without a range.
 */
export function rangeSentence(prices: AreaPrices): string | null {
  const range = prices.range;
  if (!range) return null;
  const homes = TYPE_PLURAL[prices.propertyType ?? ""] ?? "homes";
  return `${capitalise(homes)} here: most sell for ${priceSpan(range.p25, range.p75)} `
    + `(middle half of ${range.sales.toLocaleString("en-GB")} sales since ${range.since.slice(0, 4)}, adjusted to ${monthYear(range.adjustedTo)})`;
}

/**
 * "When this home sold in May 2015, its price was in the top 10% of terraced
 * sales in this area that year." A coarse band only; null without a position.
 */
export function positionSentence(prices: AreaPrices): string | null {
  const position = prices.position;
  if (!position || !prices.range) return null;
  const sold = new Date(`${position.saleDate}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const kind = TYPE_ADJECTIVE[prices.propertyType ?? ""] ?? "";
  return `When this home sold in ${sold}, its price was in the ${position.bandWords} of ${kind ? `${kind} ` : ""}sales in this area that year.`;
}

/** The bridge, about the area: "Today, the top 10% of terraced sales here are above £850k." */
export function bridgeSentence(prices: AreaPrices): string | null {
  const position = prices.position;
  if (!position || !prices.range) return null;
  const kind = TYPE_ADJECTIVE[prices.propertyType ?? ""] ?? "";
  return `Today, the ${position.bandWords} of ${kind ? `${kind} ` : ""}sales here are ${priceSpan(position.today.from, position.today.to)}.`;
}

/** Price Paid types as a plural for "borough flats", "local terraced median". */
const TYPE_PLURALS: Record<string, string> = {
  "Flat or maisonette": "flats", Terraced: "terraced", "Semi-detached": "semi-detached", Detached: "detached", Other: "other",
};

export function typePlural(propertyType: string | null): string | null {
  return propertyType ? TYPE_PLURALS[propertyType] ?? propertyType.toLowerCase() : null;
}

/**
 * "+x% a year between its {since} and {until} sales · borough {type} +y%" (the same span). With a
 * single sale only the borough's change since it, worded about the borough, never the home.
 */
export function changeSinceLastSaleLine(change: ChangeSinceLastSale | null | undefined, propertyType: string | null): string | null {
  if (!change || (change.home === null && change.borough === null)) return null;
  const borough = ["borough", typePlural(propertyType)].filter(Boolean).join(" ");
  if (change.home === null) return `${borough[0].toUpperCase()}${borough.slice(1)} ${signedPercent(change.borough)} a year since ${change.since}`;
  const home = `${signedPercent(change.home)} a year between its ${change.since} and ${change.until} sales`;
  return change.borough === null ? home : `${home} · ${borough} ${signedPercent(change.borough)}`;
}
