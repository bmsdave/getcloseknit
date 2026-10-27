import type { AreaLondonRanks, AreaProfileResponse, AreaSummary } from "./contracts";
import { formatPounds, regionShare } from "./evidence-format";
import { crimeVerdict, formatPricePerSquareMetre, noiseShareWords, type HomeSize } from "./overview-scorecard";
import type { PriceChange } from "./price-change";
import type { RatingTrend } from "./rating";

/**
 * Plain sentences for the Overview, generated from the area profile. Every
 * generator skips or says "unknown" for a missing figure — never a guessed 0.
 */
export interface AreaFacts {
  name: string | null;
  /** £/m² */
  price: AreaSummary | null;
  change: PriceChange | null;
  crime: AreaSummary | null;
  deprivation: AreaSummary | null;
  income: AreaSummary | null;
  socialRenting: AreaSummary | null;
  schools: AreaProfileResponse["schools"];
  noise: AreaProfileResponse["noise"];
  homeSize: HomeSize;
  /** London ranks (getting around, quiet, green space, best primary); null or absent when not published. */
  regionRanks?: AreaLondonRanks | null;
  /** Crime now against a year before; null when unknown or the sample is too small. */
  crimeTrend?: RatingTrend | null;
}

const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

function known(summary: AreaSummary | null): summary is AreaSummary & { value: number } {
  return summary !== null && summary.value !== null;
}

/** "more than in 92% of London areas" / "fewer than in 70% …" / "about average for London". */
export function versusLondon(percentile: number | null, more: string, less: string): string | null {
  if (percentile === null) return null;
  if (percentile >= 60) return `${more} ${regionShare(percentile)}% of London areas`;
  if (percentile <= 40) return `${less} ${regionShare(100 - percentile)}% of London areas`;
  return "about average for London";
}

function withComparison(sentence: string, comparison: string | null): string {
  return comparison ? `${sentence}, ${comparison}.` : `${sentence}.`;
}

function schoolCount(schools: NonNullable<AreaProfileResponse["schools"]>): string {
  const total = schools.primary + schools.secondary;
  return `${schools.primary} primary and ${schools.secondary} secondary state ${total === 1 ? "school" : "schools"} within ${schools.radiusMetres / 1000} km`;
}

/** Top recorded crime types with their rate per 1,000 people, largest first. */
export function crimeCategories(crime: AreaSummary | null, limit = 3): Array<{ name: string; rate: number }> {
  if (!known(crime) || !crime.breakdown) return [];
  const entries = Object.entries(crime.breakdown).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return [];
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name: name.replace(/-/g, " "), rate: Math.round((crime.value * count / total) * 10) / 10 }));
}

export type TopicId = "price" | "crime" | "deprivation" | "income" | "social-renting" | "schools" | "noise";

/** One plain sentence per topic; "unknown" when the figure is missing. */
export function topicSentence(topic: TopicId, facts: AreaFacts): string {
  switch (topic) {
    case "price":
      return known(facts.price)
        ? withComparison(`About ${formatPricePerSquareMetre(facts.price.value)}`, versusLondon(facts.price.regionPercentile, "pricier than", "cheaper than"))
        : "unknown";
    case "crime": {
      if (!known(facts.crime)) return "unknown";
      const sentence = `${crimeVerdict(facts.crime)}.`;
      const top = crimeCategories(facts.crime);
      return top.length === 0 ? sentence
        : `${sentence} Most recorded: ${top.map((entry) => `${entry.name} (${number.format(entry.rate)})`).join(", ")} per 1,000.`;
    }
    case "deprivation": {
      // A higher deprivation percentile means less deprived.
      const comparison = known(facts.deprivation) ? versusLondon(facts.deprivation.regionPercentile, "Less deprived than", "More deprived than") : null;
      if (comparison === null) return "unknown";
      return comparison === "about average for London" ? "Deprivation is about average for London." : `${comparison}.`;
    }
    case "income":
      return known(facts.income)
        ? withComparison(`Typical household income about ${formatPounds(facts.income.value)} a year`, versusLondon(facts.income.regionPercentile, "higher than in", "lower than in"))
        : "unknown";
    case "social-renting":
      return known(facts.socialRenting)
        ? withComparison(`${number.format(facts.socialRenting.value)}% of homes are rented from a council or housing association`, versusLondon(facts.socialRenting.regionPercentile, "more than in", "fewer than in"))
        : "unknown";
    case "schools":
      return facts.schools ? `${capitalise(schoolCount(facts.schools))}.` : "unknown";
    case "noise": {
      const words = noiseShareWords(facts.noise);
      return words ? `${capitalise(words)}.` : "unknown";
    }
  }
}

function capitalise(text: string): string {
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}
