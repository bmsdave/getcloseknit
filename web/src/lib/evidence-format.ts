import { isQuickFactor, QUICK_FACTOR_LABELS } from "./quick-criteria";

/**
 * A London share in words, 1–99: an area (or borough) is part of the set it is compared with, so it is
 * never "more crime than 100%" (or 0%) of London; a rounded 99.6 or 0.4 stays inside.
 */
export function regionShare(percent: number): number {
  return Math.max(1, Math.min(99, Math.round(percent)));
}

export function formatPounds(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatEvidenceValue(value: number | null, unit: string): string {
  if (value === null) return "Not published";
  if (unit === "£/m²" || unit === "£/sqft" || unit === "£/year" || unit === "£/month") {
    return formatPounds(value);
  }
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value);
}

export function formatOptionalPounds(value: number | null): string {
  return value === null ? "Not available" : formatPounds(value);
}

export function formatFactorLabel(value: string): string {
  if (isQuickFactor(value)) return QUICK_FACTOR_LABELS[value];
  return value.split("-").filter(Boolean).map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
}

// UX-60: single ordinal source for evidence and peer-distribution
// surfaces. Whole numbers take English suffixes (teens always th);
// anything else passes through unchanged rather than gaining a lie.
export function formatOrdinal(value: number): string {
  if (!Number.isInteger(value)) return String(value);
  const magnitude = Math.abs(value);
  const lastTwo = magnitude % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  switch (magnitude % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}
