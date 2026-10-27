/**
 * Demo answer for the street-level home route, used when no evidence API is configured, shaped as the
 * API answers. Meadvale Road, W5 1LR, has recorded homes at 116 and 124, both without a UPRN (so they
 * answer with the postcode page). Any other number from 116 to 124 gets the street-level page; that is
 * also how the API answers a hidden home's number. Numbers outside that range are not found. The two
 * demo homes with a sale answer with their UPRN.
 */
import { normalisePostcode } from "./postcode-page";
import type { Withheld } from "./property-profile";
import type { StreetHomeAnswer, StreetHomePostcodePage } from "./street-home";

const WITHHELD: Withheld[] = ["pricePerSqm", "valuation", "epcAddresses", "councilTaxBand", "laeiAir"];

const RECORDED: Record<string, string> = {
  "SW1A 1AB/10-sample-street": "100000000001",
  "SW1A 1AB/12-sample-street": "100000000012",
};

const NO_UPRN = new Set(["W5 1LR/116-meadvale-road", "W5 1LR/124-meadvale-road"]);
const POSTCODE_PAGE: StreetHomePostcodePage = { postcodePage: true };

export function demoStreetHome(postcode: string, slug: string): StreetHomeAnswer | null {
  const code = normalisePostcode(postcode.replace(/\+/g, " "));
  if (!code) return null;
  const uprn = RECORDED[`${code}/${slug}`];
  if (uprn) return { uprn };
  if (NO_UPRN.has(`${code}/${slug}`)) return POSTCODE_PAGE;
  const match = /^(\d{1,5})([a-z]?)-meadvale-road$/i.exec(slug);
  const number = match ? Number(match[1]) : NaN;
  if (code !== "W5 1LR" || !(number >= 116 && number <= 124)) return null;
  // Same side as 116 and 124 (even): they give the postcode; across the road nothing does.
  const even = number % 2 === 0;
  return {
    label: `${number}${match![2].toLowerCase()} Meadvale Road`, postcode: code, likelyPostcode: even ? code : null,
    neighbours: even ? [116, 124] : [], areaId: "uk:lsoa:E01000001", point: { lat: 51.5105, lon: -0.3035 }, withheld: WITHHELD,
  };
}
