import assert from "node:assert/strict";
import test from "node:test";

import { COST_PREFILL_ASSUMPTION } from "../src/lib/area-brief";
import { LATEST_BOE_RATES } from "../src/lib/boe-latest";
import { glossaryTerm } from "../src/lib/glossary";
import { BRRR_EXAMPLE, BUY_TO_LET_EXAMPLE, FLIP_EXAMPLE, HMO_EXAMPLE } from "../src/lib/investor";
import { BUY_ASSUMPTION, LONDON_SERVICE_CHARGE, RENTERS_RIGHTS, TRAVELCARD_7DAY, buildMonthlyCost } from "../src/lib/monthly-cost";
import { LONDON_NOISE } from "../src/lib/noise-evidence";
import { REFERENCING_DISCLAIMER, REFERENCING_RULE } from "../src/lib/referencing";
import { formatAsOf, type Sourced, sourceLabel } from "../src/lib/sourced";
import { SDLT_RATES } from "../src/lib/stamp-duty";
import { EXAMPLE_PRICE_SOURCED } from "../src/lib/tools";

/** Every hardcoded figure a visitor sees, with its label. */
const FIGURES: Record<string, Sourced<unknown> | null> = {
  LATEST_BOE_RATES,
  SDLT_RATES,
  LONDON_SERVICE_CHARGE,
  TRAVELCARD_7DAY,
  RENTERS_RIGHTS,
  BUY_ASSUMPTION,
  REFERENCING_RULE,
  BUY_TO_LET_EXAMPLE,
  HMO_EXAMPLE,
  BRRR_EXAMPLE,
  FLIP_EXAMPLE,
  EXAMPLE_PRICE_SOURCED,
  COST_PREFILL_ASSUMPTION,
  LONDON_NOISE,
};

test("every labelled figure has a value, a source and a dated asOf", () => {
  for (const [name, figure] of Object.entries(FIGURES)) {
    assert.ok(figure, `${name} is missing`);
    assert.notEqual(figure.value, undefined, `${name} has no value`);
    assert.ok(figure.source.trim(), `${name} has no source`);
    assert.match(figure.asOf, /^\d{4}(-\d{2}(-\d{2})?)?$/, `${name} asOf must be YYYY, YYYY-MM or YYYY-MM-DD`);
    if (figure.asOf.length > 4) assert.notEqual(formatAsOf(figure.asOf), figure.asOf, `${name} asOf does not format`);
    if (figure.sourceUrl !== undefined) assert.match(figure.sourceUrl, /^https:\/\//, `${name} sourceUrl`);
  }
});

test("labels name the source and the date, and unsourced figures say they are assumptions", () => {
  assert.equal(formatAsOf("2026-08"), "Aug 2026");
  assert.equal(formatAsOf("2026-10-05"), "5 Oct 2026");
  assert.equal(formatAsOf("2022"), "2022");
  assert.equal(sourceLabel(LATEST_BOE_RATES!), "Bank of England, Aug 2026");
  assert.equal(sourceLabel(SDLT_RATES), "gov.uk rates checked 5 Oct 2026");
  assert.equal(sourceLabel(LONDON_SERVICE_CHARGE), "Hamptons, Mar 2026");
  assert.equal(sourceLabel(TRAVELCARD_7DAY), "TfL fares from 1 Mar 2026");
  assert.equal(sourceLabel(LONDON_NOISE), "Defra Round 4, 2022");
  assert.equal(sourceLabel(REFERENCING_RULE), "typical agent rule, not law (Close Knit research, Oct 2026)");
  for (const figure of [BUY_TO_LET_EXAMPLE, HMO_EXAMPLE, BRRR_EXAMPLE, FLIP_EXAMPLE, EXAMPLE_PRICE_SOURCED, COST_PREFILL_ASSUMPTION, BUY_ASSUMPTION]) {
    assert.equal(figure.kind, "assumption");
    assert.match(sourceLabel(figure), /^example assumption, not market data \(/);
  }
});

test("the visible copy carries the labels of the figures it quotes", () => {
  const cost = buildMonthlyCost({
    market: "buy", bedrooms: 2, propertyType: "flat", price: 500_000, monthlyRent: null,
    councilTax: null, mortgageRate: { ratePct: 4.92, month: "2026-08" }, zone: "2", travelsByTransit: true, firstTimeBuyer: false,
  });
  const note = (id: string) => [...cost.lines, ...cost.upfront].find((line) => line.id === id)?.note ?? "";
  assert.match(note("mortgage"), /Bank of England, Aug 2026/);
  assert.match(note("mortgage"), /example assumption, not market data/);
  assert.match(note("service-charge"), /£2,801 a year \(Hamptons, Mar 2026\)/);
  assert.match(note("travel"), /TfL fares from 1 Mar 2026/);
  assert.match(note("stamp-duty"), /gov\.uk rates checked 5 Oct 2026/);
  assert.match(REFERENCING_DISCLAIMER, /typical agent rule, not law/);
  assert.match(glossaryTerm("service-charge").long, /£2,800 a year \(Hamptons, Mar 2026\)/);
});
