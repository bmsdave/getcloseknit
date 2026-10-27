import { censusLegendTitle, censusValueText, isMsoaFigure, MSOA_FIGURES_NOTE } from "./census-layers";
import { natureLegendTitle, natureValueText } from "./nature-layers";
import type { MetricDefinition } from "./contracts";
import { formatMoney, formatPerArea } from "./money-format";

// UX-57: single source of truth for map colour meaning. The unknown fill
// here must stay identical to the null-value branch of the map paint so
// the legend swatch always matches what the map renders. No layer's ramp
// carries a grey, so it never reads as a class.
export const UNKNOWN_FILL_COLOR = "#d1d5d3";

export type ScaleDirection = MetricDefinition["direction"];

export function scaleDirectionNote(direction: ScaleDirection): string {
  if (direction === "higher-is-better") return "Higher is better";
  if (direction === "higher-is-more") return "Higher means more";
  return "Neither end is better or worse";
}

/** What each layer's colours show, in the legend's words with their units. */
const LEGEND_TITLES: Readonly<Record<string, string>> = {
  "price-per-square-metre": "Price per m²",
  "stock-value-per-square-metre": "Value per m²",
  crime: "Crimes per 1,000 people a year",
  deprivation: "Deprivation (1 = most deprived)",
  income: "Household income a year",
  "station-access": "Minutes' walk to a station",
  "food-hygiene": "% of food places rated 4–5",
  noise: "% of homes at 55 dB or more",
  "road-collisions": "Pedestrians and cyclists hurt per 1,000 people a year",
  "air-no2": "NO₂ µg/m³, yearly mean",
  "ownership-company-share": "UK-company titles per 100 homes",
  "ownership-overseas-share": "Overseas-company titles per 100 homes",
  "typical-price": "Typical home price, all homes",
  "typical-price-flat": "Typical home price, flats",
  "typical-price-terraced": "Typical home price, terraced",
  "typical-price-semi": "Typical home price, semi-detached",
  "typical-price-detached": "Typical home price, detached",
  "hpi-change-5y": "Borough price change, 5 years",
  "hpi-change-10y": "Borough price change, 10 years",
  "pipeline-homes-per-1000": "New homes on the way per 1,000 homes",
  // Every scored area from least like the search to best match; failed Musts hatched.
  "personal-match": "My match",
  "mobile-4g-indoor": "% of premises with 4G indoors, all networks",
  "mobile-5g-outdoor": "% of premises with 5G outdoors",
  // Layers v5 PR 3.
  "typical-rent": "Typical rent a month, 2 bedrooms (borough)",
  "typical-rent-1-bed": "Typical rent a month, 1 bedroom (borough)",
  "typical-rent-3-bed": "Typical rent a month, 3 bedrooms (borough)",
  "flood-risk": "% of homes at medium or high flood risk",
  "good-schools-nearby": "Good primary schools within 1.5 km",
  "good-schools-nearby-secondary": "Good secondary schools within 1.5 km",
  "student-share": "% of residents 16+ in full-time study (Census 2021)",
  // Layers v5 PR 3 batch 2.
  "supermarket-walk": "Minutes' walk to a supermarket",
  "gp-walk": "Minutes' walk to a GP",
  "broadband-gigabit": "% of premises with gigabit broadband",
};

/** "Price per m²" for the price layer; the layer's own label for any other. */
export function legendTitle(metric: { id: string; label: string; legend?: readonly { label: string }[] }): string {
  return LEGEND_TITLES[metric.id] ?? censusLegendTitle(metric.id) ?? natureLegendTitle(metric.id) ?? metric.label;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06" → "Jun 2026": the map's dates read as words, never as "2026-06". */
export function mapPeriodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${month} ${match[1]}` : period;
}

/**
 * The legend's one line: "Price per m² · Jun 2026" (grey, no data, is in the
 * colour key). My match and a criterion of the household's own are calculated
 * now and leave other areas clear, so they carry no date.
 */
export function legendCaption(metric: { id: string; label: string; legend?: readonly { label: string }[] }, period: string | null): string {
  if (metric.id === "personal-match" || metric.id.startsWith("custom:")) return legendTitle(metric);
  // A Census layer has one date, already in its title ("(Census 2021)"); Nature spans summer 2025 and
  // five years of records, which one month would misstate (the guide says which).
  const date = period && !censusLegendTitle(metric.id) && !natureLegendTitle(metric.id) ? mapPeriodLabel(period) : null;
  // A detailed table ONS publishes down to MSOAs only is one figure per MSOA: the legend says so, never
  // implying street detail.
  const wider = isMsoaFigure(metric.id) ? MSOA_FIGURES_NOTE : null;
  return [legendTitle(metric), date, wider].filter(Boolean).join(" · ");
}

/**
 * The legend's line split for layout: `name` says which layer, `rest` (" · Dec 2022") the
 * rest. A title that does not start with the layer's name gets it in front ("Noise · % of homes at 55 dB
 * or more · Dec 2022"); "Price per m² · Jun 2026" and "Crimes per 1,000 people a year" already name it.
 * A phone on its side shows `name` only, wrapped, never cut.
 */
export function legendCaptionParts(caption: string, title: string, layerName?: string | null): { name: string; rest: string } {
  const named = !layerName || title.toLocaleLowerCase("en-GB").startsWith(layerName.toLocaleLowerCase("en-GB"));
  if (named) return caption.startsWith(title) ? { name: title, rest: caption.slice(title.length) } : { name: caption, rest: "" };
  return { name: layerName, rest: ` · ${caption}` };
}

/**
 * One area's value in plain words for the map's short lines (the folded
 * sheet's row): "£7,650/m²", "61 crimes per 1,000", "93% rated 4–5". null
 * when there is no value.
 */
export function mapValueText(value: number | null, metric: { id: string; unit: string }): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  switch (metric.id) {
    case "price-per-square-metre":
    case "stock-value-per-square-metre": return formatPerArea(value);
    case "crime": return `${value >= 100 ? Math.round(value).toLocaleString("en-GB") : value.toFixed(1)} crimes per 1,000`;
    case "food-hygiene": return `${Math.round(value)}% rated 4–5`;
    case "road-collisions": return `${Math.round(value * 10) / 10} hurt per 1,000 residents a year`;
    case "noise": return `${Math.round(value)}% of homes at 55 dB+`;
    case "air-no2": return `NO₂ ${value.toFixed(1)} µg/m³`;
    case "hpi-change-5y":
    case "hpi-change-10y": return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}% (borough)`;
    case "ownership-company-share":
    case "ownership-overseas-share": return `${value < 1 ? value.toFixed(1) : Math.round(value)} company titles per 100 homes`;
    case "mobile-4g-indoor": return `${value.toFixed(1)}% 4G indoors (borough)`;
    case "mobile-5g-outdoor": return `${value.toFixed(1)}% 5G outdoors (borough)`;
    case "station-access": return `${Math.round(value)} min walk to a station`;
    case "deprivation": return `Deprivation decile ${Math.round(value)}`;
    case "income": return `${formatMoney(value)} a year`;
    case "typical-price":
    case "typical-price-flat":
    case "typical-price-terraced":
    case "typical-price-semi":
    case "typical-price-detached": return `${formatMoney(value)} typical`;
    case "social-renting": return `${Math.round(value)}% socially rented`;
    case "typical-rent":
    case "typical-rent-1-bed":
    case "typical-rent-3-bed": return `${formatMoney(value)} a month (borough)`;
    case "flood-risk": return `${Math.round(value)}% of homes at flood risk`;
    case "good-schools-nearby":
    case "good-schools-nearby-secondary": return `${Math.round(value)} good ${Math.round(value) === 1 ? "school" : "schools"} within 1.5 km`;
    case "student-share": return `${Math.round(value)}% full-time students`;
    case "supermarket-walk": return `${Math.round(value)} min walk to a supermarket`;
    case "gp-walk": return `${Math.round(value)} min walk to a GP`;
    case "broadband-gigabit": return `${Math.round(value)}% gigabit broadband`;
    default: return censusValueText(metric.id, value) ?? natureValueText(metric.id, value) ?? `${Math.round(value * 10) / 10} ${metric.unit}`.trim();
  }
}
