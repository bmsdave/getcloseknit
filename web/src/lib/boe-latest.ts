// The latest complete month of Bank of England rates from the committed IADB
// extract, with its source and month, for every page that quotes a rate.
import dataset from "./mortgage-rates-boe.json";
import { latestComplete, type RateDataset, type RatePoint } from "./mortgage-rates";
import type { Sourced } from "./sourced";

const DATA = dataset as RateDataset;
const latest = latestComplete(DATA.points);

/** Bank Rate and 2-, 3- and 5-year fixes at 75% loan-to-value; asOf is the data month. */
export const LATEST_BOE_RATES: Sourced<RatePoint> | null = latest && {
  value: latest,
  kind: "published",
  source: "Bank of England",
  sourceUrl: "https://www.bankofengland.co.uk/boeapps/database/",
  asOf: latest.month,
};

/** When the extract was downloaded (YYYY-MM-DD). */
export const BOE_RETRIEVED = DATA.meta.retrieved;
