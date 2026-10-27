import assert from "node:assert/strict";
import test from "node:test";

import { GLOSSARY, glossaryTerm } from "../src/lib/glossary";
import { statutoryVersionFor } from "../src/lib/housing-cost";

test("every glossary term links to official GOV.UK guidance", () => {
  for (const entry of GLOSSARY) {
    assert.match(entry.url, /^https:\/\/www\.gov\.uk\//, entry.id);
    assert.ok(entry.term.trim() !== "" && entry.short.trim() !== "" && entry.long.trim() !== "", entry.id);
  }
});

test("glossary ids are unique and cover the newcomer terms", () => {
  const ids = GLOSSARY.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["leasehold", "service-charge", "ground-rent", "gazumping", "chain", "sdlt", "epc", "council-tax-bands"]) {
    assert.ok(ids.includes(id as (typeof ids)[number]), id);
  }
});

test("unknown glossary ids fail loudly", () => {
  assert.throws(() => glossaryTerm("freehold" as never), /unknown glossary term/);
});

test("SDLT surcharges in the glossary match versioned statutory entries", () => {
  const sdlt = glossaryTerm("sdlt");
  assert.match(sdlt.long, /2 percentage points/);
  assert.match(sdlt.long, /5% surcharge/);
  assert.match(statutoryVersionFor("sdlt-non-resident-surcharge", "england", "2026-10-05")?.detail ?? "", /\+2 percentage points/);
  assert.match(statutoryVersionFor("sdlt-additional-dwelling-surcharge", "england", "2026-10-05")?.detail ?? "", /5%/);
  assert.equal(statutoryVersionFor("sdlt-additional-dwelling-surcharge", "england", "2024-10-30"), null);
});
