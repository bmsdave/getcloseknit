// Wave 1 / feature 6: the printable area evidence pack for professionals.
// Turns area-evidence-pack.v1 into cited lines, reusing the decision brief's
// source and Markdown helpers. Aggregates only: counts, shares and gated
// medians — no valuation, no listing, no address list; the leasehold figure
// is a share of SALES, never of homes.
import type { AreaEvidencePack, MarketMedian, NearbySaleSummary, PackSourceRelease } from "./contracts";
import { briefSectionsMarkdown, briefSource, type BriefLine, type BriefSource } from "./decision-brief";
import { formatPerArea } from "./money-format";
import { toPricePerSquareFoot } from "./price-history";

export const PACK_MEDIAN_MIN = 10;
export const NEARBY_PACK_MEDIAN_MIN = 5;

export interface PackSection {
  id: "market" | "nearby" | "crime" | "noise" | "schools" | "limits";
  heading: string;
  lines: BriefLine[];
}

export interface MarketPackDocument {
  title: string;
  generatedAt: string;
  release: string;
  areaName: string;
  geographyId: string;
  demo: boolean;
  /** Conclusions first: a handful of plain lines, each backed by a section below. */
  summary: string[];
  sections: PackSection[];
  sources: BriefSource[];
}

export interface MarketPackOptions {
  generatedAt?: string;
  demo?: boolean;
}

const SOURCE_LABELS: [RegExp, string][] = [
  [/hmlr|price-paid|ppd/i, "HM Land Registry Price Paid Data"],
  [/police/i, "data.police.uk recorded crime"],
  [/noise/i, "Defra strategic noise mapping"],
  [/ofsted|school|dfe/i, "Ofsted and DfE school records"],
];

export function sourceLabel(source: PackSourceRelease): string {
  const known = SOURCE_LABELS.find(([pattern]) => pattern.test(source.release));
  return known ? known[1] : (source.attribution ?? source.release);
}

export function buildMarketPack(pack: AreaEvidencePack, options: MarketPackOptions = {}): MarketPackDocument {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const observedAt = generatedAt.slice(0, 10);
  const sources = new Map(pack.sources.map((source) => [
    source.release, briefSource(sourceLabel(source), source.sourceUrl, source.release, observedAt),
  ]));
  const cite = (release: string | null | undefined) => (release ? sources.get(release) : undefined);
  const sections: PackSection[] = [marketSection(pack, cite)];
  if (pack.nearbySales) sections.push(nearbySection(pack.nearbySales, cite(pack.market.sourceVersion)));
  sections.push(crimeSection(pack, cite), noiseSection(pack, cite), schoolsSection(pack, cite), {
    id: "limits",
    heading: "Limits of this pack",
    lines: pack.caveats.map((text) => ({ text, kind: "constraint" as const })),
  });
  return {
    title: `Area evidence pack: ${pack.name}`,
    generatedAt,
    release: pack.productReleaseId,
    areaName: pack.name,
    geographyId: pack.geographyId,
    demo: options.demo ?? false,
    summary: packSummary(pack),
    sections,
    sources: [...sources.values()],
  };
}

export function renderPackMarkdown(doc: MarketPackDocument): string {
  const head = [
    `# ${doc.title}`,
    "",
    `${doc.generatedAt.slice(0, 10)} · ${doc.geographyId} · Release ${doc.release}` +
      (doc.demo ? " · Preview data, not for decisions." : "."),
    "",
  ];
  const sources = ["## Sources", "", ...doc.sources.map((source) =>
    `- ${source.url ? `[${source.label}](${source.url})` : source.label}, release ${source.release}`), ""];
  const summary = ["## In short", "", ...doc.summary.map((line) => `- ${line}`), ""];
  return [...head, ...summary, ...briefSectionsMarkdown(doc.sections), ...sources].join("\n");
}

/** "£10,500/m² (£975/sq ft)": per m² to the nearest £10, per sq ft to £1. */
export function perArea(value: number): string {
  return `${formatPerArea(value)} (${formatPerArea(toPricePerSquareFoot(value), "/sq ft")})`;
}

/** "more than most of London" for a London percentile, in either direction. */
function londonWords(percentile: number, more: string, less: string): string {
  if (percentile >= 67) return `${more} than most of London`;
  if (percentile <= 33) return `${less} than most of London`;
  return "about average for London";
}

/**
 * The pack's conclusions in a few plain lines, read before the detail.
 * Each restates a figure from a section below (which carries the source);
 * nothing new, no valuation, and the gated medians stay gated.
 */
export function packSummary(pack: AreaEvidencePack): string[] {
  const lines: string[] = [];
  const market = pack.market;
  if (market.available && market.periodEnd !== null) {
    const resale = market.resale;
    const growth = market.growth?.growth1y ?? null;
    const trend = growth === null ? "" : `; ${signed(growth)} over the last year`;
    lines.push(resale && resale.medianPricePerSquareMetre !== null && resale.sampleSize >= PACK_MEDIAN_MIN
      ? `Price: resale homes sold for a median ${formatPerArea(resale.medianPricePerSquareMetre)}${trend}.`
      : `Price: too few sales with a floor area for a fair median${trend}.`);
    const sales = market.salesCount ?? 0;
    const leasehold = market.leaseholdShareOfSales === null ? "" : `, ${Math.round(market.leaseholdShareOfSales * 100)}% of them leasehold`;
    lines.push(`Market: ${sales} standard ${sales === 1 ? "sale" : "sales"} in 12 months${leasehold}.`);
  } else {
    lines.push("Market: depth is published for LSOAs and MSOAs only.");
  }
  if (pack.crime && pack.crime.value !== null) {
    const versus = pack.crime.regionPercentile === null ? "" : `, ${londonWords(pack.crime.regionPercentile, "more", "less")}`;
    lines.push(`Crime: ${pack.crime.value.toFixed(1)} recorded crimes ${pack.crime.unit}${versus}.`);
  }
  if (pack.noise.available && pack.noise.any55Share !== null) {
    lines.push(`Noise: ${Math.round(pack.noise.any55Share * 100)}% of homes at 55 dB or more from road or rail.`);
  }
  const schools = pack.schools;
  const nearest = schools.nearest[0];
  const near = nearest ? `; nearest ${nearest.name}${nearest.distanceMetres === null ? "" : ` (${nearest.distanceMetres} m)`}` : "";
  lines.push(`Schools: ${schools.count} state-funded within ${(schools.radiusMetres / 1000).toFixed(1)} km${near}.`);
  return lines;
}

export function medianText(label: string, median: MarketMedian | null, windowMonths: number): string {
  const sample = median?.sampleSize ?? 0;
  if (!median || median.medianPricePerSquareMetre === null || sample < PACK_MEDIAN_MIN) {
    return `${label} median not shown: it needs ${PACK_MEDIAN_MIN} standard sales with a floor area ` +
      `in ${windowMonths} months (${sample} here).`;
  }
  return `${label} median ${perArea(median.medianPricePerSquareMetre)} across ${sample} standard sales ` +
    `in ${windowMonths} months.`;
}

export function leaseholdText(share: number | null, sales: number | null): string {
  if (share === null || !sales) return "Leasehold share of sales not available: no sales with a recorded tenure.";
  return `Leasehold share of sales: ${Math.round(share * 100)}% of the ${sales} sales with a recorded tenure ` +
    "in 12 months were leasehold (a share of sales, not of homes).";
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function monthLabel(date: string): string {
  return new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

type Cite = (release: string | null | undefined) => BriefSource | undefined;

function marketSection(pack: AreaEvidencePack, cite: Cite): PackSection {
  const market = pack.market;
  const source = cite(market.sourceVersion);
  if (!market.available || market.periodEnd === null) {
    return {
      id: "market",
      heading: "Local market",
      lines: [{ text: "Market depth is not published for this area: it is built for LSOAs and MSOAs.", kind: "unknown" }],
    };
  }
  const lines: BriefLine[] = [
    { text: `${market.salesCount} standard (category A) sales in the 12 months to ${monthLabel(market.periodEnd)}.`, kind: "fact", source },
    {
      text: market.turnoverPercent === null
        ? "Turnover not available: no homes with an EPC-linked UPRN here."
        : `Turnover ${market.turnoverPercent.toFixed(1)}%: ${market.dwellingsSold} of ${market.dwellings} homes ` +
          "with an EPC-linked UPRN had a standard sale in 12 months (not the full housing stock).",
      kind: market.turnoverPercent === null ? "unknown" : "fact",
      source,
    },
    { text: leaseholdText(market.leaseholdShareOfSales, market.tenureKnownSales), kind: market.leaseholdShareOfSales === null ? "unknown" : "fact", source },
    { text: medianText("New-build", market.newBuild, market.priceWindowMonths), kind: market.newBuild?.medianPricePerSquareMetre == null ? "unknown" : "fact", source },
    { text: medianText("Resale", market.resale, market.priceWindowMonths), kind: market.resale?.medianPricePerSquareMetre == null ? "unknown" : "fact", source },
    market.newBuildPremiumPercent === null
      ? { text: `New-build premium not shown: it needs ${PACK_MEDIAN_MIN} new-build and ${PACK_MEDIAN_MIN} resale sales.`, kind: "unknown" }
      : { text: `New-build premium over resale: ${signed(market.newBuildPremiumPercent)} on median £/m² (the mix of flats and houses can differ).`, kind: "fact", source },
  ];
  const growth = market.growth;
  if (growth) {
    const parts = ([["1 year", growth.growth1y], ["3 years", growth.growth3y], ["5 years", growth.growth5y], ["10 years", growth.growth10y]] as const)
      .filter(([, value]) => value !== null)
      .map(([label, value]) => `${label} ${signed(value as number)}`);
    lines.push({ text: `£/m² index change to ${monthLabel(growth.period)}: ${parts.join(", ")}.`, kind: "fact", source });
  } else {
    lines.push({ text: "£/m² growth is published per LSOA; this area has no index of its own.", kind: "unknown" });
  }
  return { id: "market", heading: "Local market", lines };
}

function nearbyLine(scope: string, group: NearbySaleSummary | null, windowYears: number, source?: BriefSource): BriefLine {
  if (!group) return { text: `${scope}: the address's sale record has nothing to match on.`, kind: "unknown" };
  const noun = group.saleCount === 1 ? "sale" : "sales";
  const median = group.medianPricePerSquareMetre === null || group.medianSampleSize < NEARBY_PACK_MEDIAN_MIN
    ? `median not shown (needs ${NEARBY_PACK_MEDIAN_MIN} standard sales with a floor area, ${group.medianSampleSize} here)`
    : `median ${perArea(group.medianPricePerSquareMetre)} from ${group.medianSampleSize} standard sales`;
  return { text: `${scope}: ${group.saleCount} other ${noun} in ${windowYears} years; ${median}.`, kind: "fact", source };
}

function nearbySection(nearby: NonNullable<AreaEvidencePack["nearbySales"]>, source?: BriefSource): PackSection {
  return {
    id: "nearby",
    heading: "Same building and street",
    lines: [
      nearbyLine("Same building", nearby.building, nearby.windowYears, source),
      nearbyLine("Same street, other buildings", nearby.street, nearby.windowYears, source),
      { text: nearby.disclaimer, kind: "constraint" },
    ],
  };
}

function crimeSection(pack: AreaEvidencePack, cite: Cite): PackSection {
  const crime = pack.crime;
  if (!crime || crime.value === null) {
    return { id: "crime", heading: "Crime", lines: [{ text: "Recorded crime is published per LSOA; no rate for this area.", kind: "unknown" }] };
  }
  const percentile = crime.regionPercentile === null ? "" : `, London percentile ${crime.regionPercentile}`;
  return {
    id: "crime",
    heading: "Crime",
    lines: [{
      text: `${crime.value.toFixed(1)} recorded crimes ${crime.unit} in the 12 months to ${monthLabel(crime.period)}${percentile}.`,
      kind: crime.quality === "observed" ? "fact" : "estimate",
      source: cite(crime.sourceVersion),
    }],
  };
}

function noiseSection(pack: AreaEvidencePack, cite: Cite): PackSection {
  const noise = pack.noise;
  if (!noise.available || noise.any55Share === null) {
    return { id: "noise", heading: "Road and rail noise", lines: [{ text: "Noise shares are not loaded for this area.", kind: "unknown" }] };
  }
  const pct = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
  return {
    id: "noise",
    heading: "Road and rail noise",
    lines: [{
      text: `${pct(noise.any55Share)} of ${noise.dwellings} homes at or above 55 dB Lden from road or rail ` +
        `(${pct(noise.any65Share)} at 65 dB; road ${pct(noise.road55Share)}, rail ${pct(noise.rail55Share)} at 55 dB). Modelled 2022 levels.`,
      kind: "estimate",
      source: cite(noise.sourceVersion),
    }],
  };
}

function schoolsSection(pack: AreaEvidencePack, cite: Cite): PackSection {
  const schools = pack.schools;
  const lines: BriefLine[] = [{
    text: `${schools.count} state-funded schools within ${(schools.radiusMetres / 1000).toFixed(1)} km ` +
      `(${schools.primary} primary, ${schools.secondary} secondary). Distance says nothing about admission.`,
    kind: schools.count > 0 ? "fact" : "unknown",
  }];
  for (const school of schools.nearest) {
    const distance = school.distanceMetres === null ? "" : `, ${school.distanceMetres} m`;
    const inspection = school.reportCard?.areas.length
      ? `; Ofsted report card${school.reportCard.year ? ` ${school.reportCard.year}` : ""}: `
        + school.reportCard.areas.map((area) => `${area.label} ${(area.grade ?? "").toLowerCase()}`).join(", ")
        + (school.reportCard.safeguarding ? `; safeguarding ${school.reportCard.safeguarding.toLowerCase()}` : "")
      : school.latestInspection ? `; latest Ofsted: ${school.latestInspection}` : "; no Ofsted outcome loaded";
    lines.push({ text: `${school.name} (${school.phase}${distance})${inspection}.`, kind: "fact", source: cite(school.sourceVersion) });
  }
  return { id: "schools", heading: "Schools nearby", lines };
}
