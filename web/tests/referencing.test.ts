import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PROFILE, RENT_INDEX_LABEL, rentIndexCaption } from "../src/lib/fixtures";
import {
  GUARANTOR_INCOME_MULTIPLE,
  NO_UK_CREDIT_HISTORY_NOTES,
  REFERENCING_DISCLAIMER,
  RENTERS_RIGHTS_EXPLAINER,
  TENANT_INCOME_MULTIPLE,
  assessReferencing,
  defaultMonthlyRent,
  householdIncome,
  requiredAnnualIncome,
  type ReferencingInput,
} from "../src/lib/referencing";

const BASE: ReferencingInput = {
  monthlyRent: 2_000,
  incomes: [null, null],
  guarantorIncome: null,
  noUkCreditHistory: false,
};

test("the usual threshold is 30x the monthly rent, 36x for a guarantor", () => {
  assert.equal(TENANT_INCOME_MULTIPLE, 30);
  assert.equal(GUARANTOR_INCOME_MULTIPLE, 36);
  assert.equal(requiredAnnualIncome(2_000), 60_000);
  assert.equal(requiredAnnualIncome(2_000, GUARANTOR_INCOME_MULTIPLE), 72_000);
  assert.throws(() => requiredAnnualIncome(0), /positive/);
});

test("household income sums every earner and ignores blanks", () => {
  assert.equal(householdIncome([35_000, null, 28_000]), 63_000);
  assert.equal(householdIncome([null, -5]), 0);
});

test("a couple can meet the threshold together that neither meets alone", () => {
  const single = assessReferencing({ ...BASE, incomes: [35_000, null] }, "2026-10-05");
  assert.equal(single.meetsIncome, false);
  assert.equal(single.shortfall, 25_000);
  const couple = assessReferencing({ ...BASE, incomes: [35_000, 28_000] }, "2026-10-05");
  assert.equal(couple.requiredIncome, 60_000);
  assert.equal(couple.householdIncome, 63_000);
  assert.equal(couple.meetsIncome, true);
  assert.equal(couple.shortfall, 0);
});

test("a guarantor is judged against 36x rent only once entered", () => {
  assert.equal(assessReferencing(BASE).guarantorMeets, null);
  assert.equal(assessReferencing({ ...BASE, guarantorIncome: 72_000 }).guarantorMeets, true);
  assert.equal(assessReferencing({ ...BASE, guarantorIncome: 71_999 }).guarantorMeets, false);
});

test("no rent means no threshold and no verdict", () => {
  const result = assessReferencing({ ...BASE, monthlyRent: null, incomes: [50_000, null] });
  assert.equal(result.requiredIncome, null);
  assert.equal(result.meetsIncome, null);
  assert.equal(result.requiredGuarantorIncome, null);
});

test("no UK credit history adds guarantor and guarantor-service notes", () => {
  assert.deepEqual(assessReferencing(BASE).notes, []);
  const notes = assessReferencing({ ...BASE, noUkCreditHistory: true }).notes;
  assert.deepEqual(notes, NO_UK_CREDIT_HISTORY_NOTES);
  assert.ok(notes.some((note) => /guarantor service/i.test(note)));
  assert.ok(notes.some((note) => /36×/.test(note)));
});

test("the Renters' Rights Act entry applies from 1 May 2026 only", () => {
  assert.equal(assessReferencing(BASE, "2026-04-30").statutory, null);
  const statutory = assessReferencing(BASE, "2026-05-01").statutory;
  assert.equal(statutory?.instrument, "renters-rights-act");
  assert.match(statutory?.detail ?? "", /above the advertised rent/);
  assert.match(statutory?.detail ?? "", /one month's rent in advance/);
  assert.ok(RENTERS_RIGHTS_EXPLAINER.some((line) => /1 May 2026/.test(line)));
});

test("the default rent is the profile target only for a monthly rent budget", () => {
  assert.equal(defaultMonthlyRent({ ...DEFAULT_PROFILE, market: "rent", targetBudget: 2_100, maximumBudget: 2_400 }), 2_100);
  assert.equal(defaultMonthlyRent({ ...DEFAULT_PROFILE, market: "rent" }), null);
  assert.equal(defaultMonthlyRent({ ...DEFAULT_PROFILE, targetBudget: 2_100 }), null);
});

test("the check is framed as a self-check, never a decision", () => {
  assert.match(REFERENCING_DISCLAIMER, /not a referencing decision/);
});

test("the rent index label names ONS achieved rents, not listings, with its window", () => {
  assert.match(RENT_INDEX_LABEL, /ONS/);
  assert.match(RENT_INDEX_LABEL, /Price Index of Private Rents/);
  assert.match(RENT_INDEX_LABEL, /borough average/);
  assert.match(RENT_INDEX_LABEL, /not listing prices/);
  assert.equal(
    rentIndexCaption("preview-ons-rent-2026-07"),
    `${RENT_INDEX_LABEL} · 12-month window · preview-ons-rent-2026-07`,
  );
});
