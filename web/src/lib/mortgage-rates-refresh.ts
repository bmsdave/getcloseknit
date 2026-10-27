// Rebuilds mortgage-rates-boe.json from an IADB CSV export:
//   npx tsx src/lib/mortgage-rates-refresh.ts ~/data/boe/iadb-mortgage-rates-YYYY-MM-DD.csv YYYY-MM-DD
// The CSV comes from IADB_CSV_URL below (record it in ~/data/MANIFEST.tsv).
import { readFileSync, writeFileSync } from "node:fs";

import { IADB_SERIES, RATE_KEYS, parseIadbCsv, type RateDataset, type RateKey } from "./mortgage-rates";

export const IADB_CSV_URL =
  "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/1995&Dateto=now"
  + `&SeriesCodes=${RATE_KEYS.map((key) => IADB_SERIES[key]).join(",")}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`;

const TITLES: Record<RateKey, string> = {
  bankRate: "Monthly average of official Bank Rate",
  fixed2: "Monthly interest rate of UK MFIs sterling 2 year (75% LTV) fixed rate mortgage to households, not seasonally adjusted",
  fixed3: "Monthly interest rate of UK MFIs sterling 3 year (75% LTV) fixed rate mortgage to households, not seasonally adjusted",
  fixed5: "Monthly interest rate of UK MFIs sterling 5 year (75% LTV) fixed rate mortgage to households, not seasonally adjusted",
};

export function buildDataset(csv: string, retrieved: string): RateDataset {
  return {
    meta: {
      source: "Bank of England Database (IADB)",
      url: IADB_CSV_URL,
      retrieved,
      licence: "Open Government Licence v3.0 (Bank of England Database terms)",
      attribution: "Source: Bank of England. Data © the Governor and Company of the Bank of England, reproduced under the Open Government Licence v3.0.",
      series: Object.fromEntries(
        RATE_KEYS.map((key) => [key, { code: IADB_SERIES[key], title: TITLES[key] }]),
      ) as RateDataset["meta"]["series"],
      refresh: "npx tsx src/lib/mortgage-rates-refresh.ts <iadb.csv> <retrieved YYYY-MM-DD>",
    },
    points: parseIadbCsv(csv),
  };
}

if (process.argv[1]?.endsWith("mortgage-rates-refresh.ts")) {
  const [csvPath, retrieved] = process.argv.slice(2);
  if (!csvPath || !/^\d{4}-\d{2}-\d{2}$/.test(retrieved ?? "")) throw new Error("usage: <iadb.csv> <YYYY-MM-DD>");
  const dataset = buildDataset(readFileSync(csvPath, "utf8"), retrieved);
  const out = new URL("./mortgage-rates-boe.json", import.meta.url);
  // One month per line keeps refresh diffs readable.
  const points = dataset.points.map((point) => `  ${JSON.stringify(point)}`).join(",\n");
  writeFileSync(out, `{"meta":${JSON.stringify(dataset.meta, null, 1)},\n"points":[\n${points}\n]}\n`);
  console.log(`wrote ${dataset.points.length} months to ${out.pathname}`);
}
