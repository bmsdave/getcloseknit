import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { budgetsFor, formatMoneyDraft, parseMoney, validateBudgetOnBlur, validateNeeds } from "../src/lib/needs-validation";

describe("validateNeeds", () => {
  it("accepts a valid buying profile with one budget", () => {
    assert.deepEqual(validateNeeds({ market: "buy", budget: "650,000", bedrooms: "2" }), []);
  });

  it("accepts a valid renting profile", () => {
    assert.deepEqual(validateNeeds({ market: "rent", budget: "2,000", bedrooms: "0" }), []);
  });

  it("rejects empties without coercing them to zero", () => {
    const errors = validateNeeds({ market: "buy", budget: "", bedrooms: "" });
    assert.deepEqual(errors.map((error) => error.field), ["budget", "bedrooms"]);
    assert.match(errors[0].message, /£600,000/);
  });

  it("rejects zero and nonsense budgets", () => {
    for (const budget of ["0", "-5", "abc"]) {
      assert.deepEqual(validateNeeds({ market: "buy", budget, bedrooms: "2" }).map((error) => error.field), ["budget"]);
    }
  });

  it("rejects a purchase-scale budget for renting", () => {
    const errors = validateNeeds({ market: "rent", budget: "650,000", bedrooms: "2" });
    assert.deepEqual(errors.map((error) => error.field), ["budget"]);
  });

  it("rejects fractional and out-of-range bedrooms", () => {
    for (const bedrooms of ["2.5", "9", "-1"]) {
      const errors = validateNeeds({ market: "buy", budget: "650000", bedrooms });
      assert.deepEqual(errors.map((error) => error.field), ["bedrooms"]);
    }
  });

  it("rejects an unknown market", () => {
    const errors = validateNeeds({ market: "", budget: "650000", bedrooms: "2" });
    assert.deepEqual(errors.map((error) => error.field), ["market"]);
  });
});

describe("money drafts", () => {
  it("groups digits as typed and reads them back", () => {
    assert.equal(formatMoneyDraft("650000"), "650,000");
    assert.equal(formatMoneyDraft("£6500a00"), "650,000");
    assert.equal(formatMoneyDraft(""), "");
    assert.equal(parseMoney("£650,000"), 650_000);
    assert.equal(parseMoney("650k"), 650_000);
    assert.equal(parseMoney("1.2m"), 1_200_000);
    assert.equal(parseMoney(""), null);
  });

  it("derives the comfortable target from the one budget", () => {
    assert.deepEqual(budgetsFor(650_000), { maximumBudget: 650_000, targetBudget: 520_000 });
    assert.deepEqual(budgetsFor(2_000), { maximumBudget: 2_000, targetBudget: 1_600 });
  });
});

describe("budget checked on blur", () => {
  it("waits on an empty field and checks a typed one at once", () => {
    assert.deepEqual(validateBudgetOnBlur("buy", "  "), []);
    assert.deepEqual(validateBudgetOnBlur("buy", "600,000"), []);
    assert.deepEqual(validateBudgetOnBlur("buy", "lots").map((error) => error.message), ["Enter your budget, for example £600,000."]);
    assert.deepEqual(validateBudgetOnBlur("rent", "600,000").map((error) => error.field), ["budget"]);
  });
});
