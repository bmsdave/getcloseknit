import assert from "node:assert/strict";
import test from "node:test";

import {
  crimeCategories,
  filteredCrimeValue,
  isCrimeFilterActive,
  toggleCrimeCategory,
} from "../src/lib/crime-filter";

test("categories union breakdown keys across pack values in stable order", () => {
  const categories = crimeCategories([
    { breakdown: { Shoplifting: 4, Burglary: 2 } },
    { breakdown: { Burglary: 1, Robbery: 3 } },
    {},
  ]);
  assert.deepEqual(categories, ["Burglary", "Robbery", "Shoplifting"]);
});

test("included categories rescale the headline rate by their share", () => {
  const value = filteredCrimeValue(20, { Burglary: 5, Shoplifting: 15 }, ["Shoplifting"]);
  assert.equal(value, 15);
});

test("excluding everything suppresses the value instead of showing zero", () => {
  assert.equal(filteredCrimeValue(20, { Burglary: 5 }, []), null);
});

test("null headline stays null whatever is selected", () => {
  assert.equal(filteredCrimeValue(null, { Burglary: 5 }, ["Burglary"]), null);
});

test("missing breakdown falls back to the headline rate", () => {
  assert.equal(filteredCrimeValue(20, undefined, ["Burglary"]), 20);
});

test("toggling adds and removes one category at a time", () => {
  assert.deepEqual(toggleCrimeCategory(["Burglary"], "Robbery"), ["Burglary", "Robbery"]);
  assert.deepEqual(toggleCrimeCategory(["Burglary", "Robbery"], "Burglary"), ["Robbery"]);
});

test("filter counts as active only when the selection differs", () => {
  const all = ["Burglary", "Robbery"];
  assert.equal(isCrimeFilterActive(["Burglary"], all), true);
  assert.equal(isCrimeFilterActive(["Burglary", "Robbery"], all), false);
});
