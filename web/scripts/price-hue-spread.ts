/**
 * How the price layer's fixed scale spreads each year over its colour bands,
 * on the evidence API's real packs (the whole-London view shows every LSOA):
 *   CLOSE_KNIT_API_URL=http://127.0.0.1:8097 npx tsx scripts/price-hue-spread.ts [years…]
 * Prints the breaks and, per year, each band's share of LSOAs (band 0 is
 * everything under the second break, the last everything from the top break up).
 */
import { PRICE_METRIC_ID, priceBandCounts, priceBreaks, priceLabel, yearlyPeriods } from "../src/lib/price-scale";

const api = process.env.CLOSE_KNIT_API_URL ?? "http://127.0.0.1:8000";

async function json<T>(path: string): Promise<T> {
  const response = await fetch(`${api}${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function main() {
  const { metrics } = await json<{ metrics: { id: string; periods: string[] }[] }>("/api/v1/metrics");
  const periods = yearlyPeriods(metrics.find((metric) => metric.id === PRICE_METRIC_ID)!.periods);
  const packs = new Map<string, number[]>();
  for (const period of periods) {
    const pack = await json<{ values: { value: number | null }[] }>(`/api/v1/value-packs/${PRICE_METRIC_ID}/${period}`);
    packs.set(period, pack.values.flatMap((entry) => typeof entry.value === "number" ? [entry.value] : []));
  }
  const breaks = priceBreaks([...packs.values()].flat(), packs.get(periods.at(-1)!)!)!;
  console.log(`breaks ${breaks.map(priceLabel).join(" ")} [${breaks.join(", ")}]`);
  const wanted = process.argv.slice(2);
  for (const [period, values] of packs) {
    if (wanted.length && !wanted.some((year) => period.startsWith(year))) continue;
    const shares = priceBandCounts(values, breaks).map((count) => (count / values.length) * 100);
    const cells = shares.map((share) => `${share.toFixed(1)}%`.padStart(6));
    console.log(`${period} n=${values.length} max=${Math.max(...shares).toFixed(1)}% ${cells.join("")}`);
  }
}

void main();
