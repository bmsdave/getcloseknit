// Wave 1 / feature 5: plain-English glossary of UK home-buying and renting
// terms that newcomers meet in the evidence panels. Every entry links to the
// official explanation on GOV.UK; the copy here is orientation, not advice.
import { LONDON_SERVICE_CHARGE } from "./monthly-cost";
import { sourceLabel } from "./sourced";

export type GlossaryTermId =
  | "leasehold"
  | "service-charge"
  | "ground-rent"
  | "gazumping"
  | "chain"
  | "sdlt"
  | "epc"
  | "council-tax-bands"
  | "lease-extension"
  | "building-safety-act"
  | "price-paid";

export interface GlossaryTerm {
  id: GlossaryTermId;
  term: string;
  short: string;
  long: string;
  url: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    id: "leasehold",
    term: "Leasehold",
    short: "You own the right to live in the home for a fixed number of years, not the building or its land.",
    long: "Most London flats are leasehold. The lease sets how many years remain and what you pay the " +
      "freeholder in service charge and ground rent. Short leases are dearer to extend and harder to sell " +
      "or mortgage; 80 remaining years is a widely watched threshold. Freehold means you own the building " +
      "and its land outright.",
    url: "https://www.gov.uk/leasehold-property",
  },
  {
    id: "service-charge",
    term: "Service charge",
    short: "Your share of the cost of running and repairing a leasehold building.",
    long: "Paid to the freeholder or managing agent on top of your mortgage. It can rise every year and can " +
      "include one-off bills for major works such as a new roof or lift. The London average is about " +
      `£${(Math.round(LONDON_SERVICE_CHARGE.value / 100) * 100).toLocaleString("en-GB")} a year (${sourceLabel(LONDON_SERVICE_CHARGE)}), so ask for recent statements and any planned works before you offer.`,
    url: "https://www.gov.uk/leasehold-property/service-charges-and-other-expenses",
  },
  {
    id: "ground-rent",
    term: "Ground rent",
    short: "A yearly payment to the freeholder that some leases require.",
    long: "Older leases can set a ground rent that rises over time, which can make a flat harder to sell or " +
      "mortgage. Reform has limited ground rent on most new leases, so check exactly what your lease says.",
    url: "https://www.gov.uk/leasehold-property/service-charges-and-other-expenses",
  },
  {
    id: "gazumping",
    term: "Gazumping",
    short: "A seller accepts a higher offer after already accepting yours.",
    long: "In England and Wales an accepted offer is not legally binding until contracts are exchanged, " +
      "which can take weeks. Until then the seller can switch to another buyer, and the survey and legal " +
      "fees you have already paid are lost.",
    url: "https://www.gov.uk/buy-sell-your-home/making-an-offer",
  },
  {
    id: "chain",
    term: "Chain",
    short: "Linked sales where each buyer must sell their own home before buying the next.",
    long: "If one sale in the chain is delayed or falls through, every linked sale can stall; around a " +
      "quarter of agreed sales fall through. Sellers and agents often prefer a chain-free or cash buyer, " +
      "sometimes over a higher offer, because that buyer is more likely to complete.",
    url: "https://www.gov.uk/buy-sell-your-home/making-an-offer",
  },
  {
    id: "sdlt",
    term: "Stamp Duty Land Tax (SDLT)",
    short: "A tax on buying a home in England above a price threshold, charged in bands.",
    long: "Buyers who are not UK resident pay 2 percentage points more on each band, and buying an " +
      "additional home adds a 5% surcharge. Rates and reliefs change, so check the current rates before " +
      "budgeting.",
    url: "https://www.gov.uk/stamp-duty-land-tax/residential-property-rates",
  },
  {
    id: "epc",
    term: "Energy Performance Certificate (EPC)",
    short: "An energy rating from A (most efficient) to G, needed when a home is sold or let.",
    long: "It estimates running costs and suggests improvements. Agents often take the floor area from the " +
      "EPC to quote a price per square foot. Privately rented homes are due to reach band C by " +
      "1 October 2030.",
    url: "https://www.gov.uk/find-energy-certificate",
  },
  {
    id: "council-tax-bands",
    term: "Council tax bands",
    short: "A local tax on every home, set by its band (A to H in England) and its borough.",
    long: "The occupier pays it, which usually means the tenant when renting. The same band costs " +
      "different amounts in different boroughs, so look up the band before budgeting. From April 2028 " +
      "homes worth £2 million or more pay an extra yearly charge.",
    url: "https://www.gov.uk/council-tax-bands",
  },
  {
    id: "lease-extension",
    term: "Lease extension",
    short: "Buying more years on a leasehold flat from the freeholder.",
    long: "Most flat leaseholders have a legal right to extend the lease. The premium depends on the " +
      "years left, the ground rent and the flat's value, and below 80 years it has traditionally risen " +
      "sharply. The Leasehold and Freehold Reform Act 2024 is changing these rules, so get a valuer's and " +
      "a solicitor's figure for your own lease rather than relying on a rule of thumb.",
    url: "https://www.gov.uk/leasehold-property/extending-changing-or-ending-a-lease",
  },
  {
    id: "building-safety-act",
    term: "Building Safety Act and EWS1",
    short: "The 2022 law on safety in taller residential buildings; EWS1 is a lender's external-wall form.",
    long: "Buildings of at least 11 metres or 5 storeys give qualifying leaseholders protection from most " +
      "cladding remediation costs, shown by a leaseholder deed of certificate. Buildings of at least " +
      "18 metres or 7 storeys with two or more homes are 'higher-risk' and must be registered with the " +
      "Building Safety Regulator. Lenders may still ask for an EWS1 external wall fire review form.",
    url: "https://www.gov.uk/guidance/the-building-safety-act",
  },
  {
    id: "price-paid",
    term: "Price Paid Data",
    short: "HM Land Registry's public record of every home sold in England and Wales.",
    long: "Each record has the price, completion date, property type, tenure and whether it was a new " +
      "build. It does not record the floor area or the condition, and it can take a few months for a " +
      "sale to appear. Close Knit shows these sales and area price ranges built from them; it never puts " +
      "a value on a single home.",
    url: "https://www.gov.uk/government/collections/price-paid-data",
  },
];

export function glossaryTerm(id: GlossaryTermId): GlossaryTerm {
  const entry = GLOSSARY.find((term) => term.id === id);
  if (!entry) throw new Error(`unknown glossary term: ${id}`);
  return entry;
}
