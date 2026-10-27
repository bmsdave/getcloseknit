/**
 * Money for people: rounded the way an estate agent would say it. Records
 * (a sale-history row) keep their exact price; summaries, medians and
 * estimates use these. Estimates carry a "~" so nobody reads them as exact.
 *
 *   1_834_000 → "£1.83m"   682_400 → "£682k"   9_450 → "£9,450"
 *   estimate  → "~£682k"   12_783 £/m² → "£12,780/m²"
 */

const MINUS = "−";

function plain(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

/** "£1.83m", "£682k", "£9,450"; negative values keep their sign. Null or NaN → "—". */
export function formatMoney(value: number | null | undefined, options: { estimate?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? MINUS : "";
  const amount = Math.abs(value);
  const thousands = Math.round(amount / 1000);
  let text: string;
  if (thousands >= 1000) {
    // Two decimals, trailing zeros dropped: £1.83m, £1.8m, £2m.
    text = `£${Number((amount / 1_000_000).toFixed(2)).toString()}m`;
  } else if (amount >= 10_000) {
    text = `£${thousands}k`;
  } else {
    text = plain(amount);
  }
  return `${options.estimate ? "~" : ""}${sign}${text}`;
}

/** An estimate: "~£682k". */
export function formatEstimate(value: number | null | undefined): string {
  return formatMoney(value, { estimate: true });
}

/**
 * Price per area: per m² to the nearest £10 ("£12,780/m²"); per sq ft to
 * the nearest £1 (it is ten times smaller). `unit` is the suffix shown.
 */
export function formatPerArea(value: number | null | undefined, unit = "/m²"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const step = /ft/.test(unit) ? 1 : 10;
  const rounded = Math.round(value / step) * step;
  return `${rounded < 0 ? MINUS : ""}${plain(Math.abs(rounded))}${unit}`;
}
