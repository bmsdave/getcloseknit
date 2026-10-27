import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_LEASEHOLD_FACTS,
  GUIDANCE_LINKS,
  PROFESSIONAL_PROMPT,
  BUILDING_SAFETY_QUESTIONS,
  LEASE_BANDS,
  LEASE_BAND_NOTE,
  addQuestion,
  assessLeaseTerm,
  buildingSafetyQuestions,
  heightTier,
  leaseBand,
  serviceChargeShare,
  yearsRemaining,
  attachQuestionUrl,
  buildDiligenceBrief,
  hasLeaseEvidence,
  setQuestionAnswered,
  tenureWithoutLeaseEvidence,
  unansweredQuestions,
  type LeaseholdFacts,
} from "../src/lib/leasehold";

const TODAY = "2026-09-06";

function factsWithExpiry(expiry: string, observedAt: string): LeaseholdFacts {
  return {
    ...EMPTY_LEASEHOLD_FACTS,
    leaseExpiry: { value: expiry, evidence: { source: "lease", observedAt, status: "document" } },
    leaseExpiryAsOf: { value: observedAt, evidence: { source: "lease", observedAt, status: "document" } },
  };
}

test("an unknown lease term stays unknown and never gets a reassuring default", () => {
  const term = assessLeaseTerm(EMPTY_LEASEHOLD_FACTS, TODAY);
  assert.equal(term.state, "unknown");
  assert.match(term.note, /unknown/i);
  assert.doesNotMatch(term.note, /sufficient|adequate|no concern|nothing to check/i);
});

test("two sources that disagree on the expiry date are a conflict", () => {
  const facts: LeaseholdFacts = {
    ...factsWithExpiry("2140-03-24", "2026-08-01"),
    extraExpiryObservations: [
      { expiry: "2105-03-24", source: "listing", observedAt: "2026-08-02", status: "unverified" },
    ],
  };
  const term = assessLeaseTerm(facts, TODAY);
  assert.equal(term.state, "conflict");
});

test("an as-of date later than the expiry date is a conflict", () => {
  const facts: LeaseholdFacts = {
    ...factsWithExpiry("2001-01-01", "2026-08-01"),
  };
  const term = assessLeaseTerm(facts, TODAY);
  assert.equal(term.state, "conflict");
});

test("an observation older than the freshness window is treated as expired", () => {
  const term = assessLeaseTerm(factsWithExpiry("2140-03-24", "2025-01-01"), TODAY);
  assert.equal(term.state, "stale");
});

test("a fresh single-source expiry is known", () => {
  const term = assessLeaseTerm(factsWithExpiry("2140-03-24", "2026-08-01"), TODAY);
  assert.equal(term.state, "known");
});

test("a leasehold transaction tenure with no lease evidence is flagged", () => {
  const facts: LeaseholdFacts = { ...EMPTY_LEASEHOLD_FACTS, transactionTenure: "leasehold" };
  assert.equal(hasLeaseEvidence(facts), false);
  assert.equal(tenureWithoutLeaseEvidence(facts), true);
});

test("a freehold tenure, or lease evidence on file, clears the flag", () => {
  assert.equal(
    tenureWithoutLeaseEvidence({ ...EMPTY_LEASEHOLD_FACTS, transactionTenure: "freehold" }),
    false,
  );
  assert.equal(tenureWithoutLeaseEvidence(factsWithExpiry("2140-03-24", "2026-08-01")), false);
});

test("blank questions are ignored; real ones start unanswered", () => {
  assert.deepEqual(addQuestion([], "   "), []);
  const questions = addQuestion([], "Who manages the building?");
  assert.equal(questions.length, 1);
  assert.equal(questions[0].answered, false);
  assert.deepEqual(unansweredQuestions({ ...EMPTY_LEASEHOLD_FACTS, questions }), questions);
});

test("only http(s) reference URLs attach; answering clears the unanswered list", () => {
  const questions = addQuestion([], "Any major works planned?");
  const id = questions[0].id;
  assert.deepEqual(attachQuestionUrl(questions, id, "not a url")[0].url, null);
  const attached = attachQuestionUrl(questions, id, "https://example.com/notice.pdf");
  assert.equal(attached[0].url, "https://example.com/notice.pdf");
  const answered = setQuestionAnswered(attached, id, true);
  assert.equal(answered[0].answered, true);
  assert.deepEqual(unansweredQuestions({ ...EMPTY_LEASEHOLD_FACTS, questions: answered }), []);
});

test("the brief preserves the recorded tenure and lists unknowns explicitly", () => {
  const facts: LeaseholdFacts = {
    ...EMPTY_LEASEHOLD_FACTS,
    transactionTenure: "leasehold",
    questions: addQuestion([], "Who manages the building?"),
  };
  const brief = buildDiligenceBrief(facts, TODAY);
  const text = brief.lines.join("\n");
  assert.match(text, /leasehold/);
  assert.match(text, /unknown/i);
  assert.match(text, /Who manages the building\?/);
  assert.match(text, /unanswered/i);
});

test("the brief applies no automatic price adjustment and no fixed year rule", () => {
  const brief = buildDiligenceBrief(factsWithExpiry("2090-06-30", "2026-08-01"), TODAY);
  const text = [...brief.lines, PROFESSIONAL_PROMPT].join("\n");
  assert.doesNotMatch(text, /discount|deduct/i);
  assert.doesNotMatch(text, /\b80\b/);
  assert.doesNotMatch(text, /£[\d,]+/);
});

test("the brief links current official guidance and an independent professional", () => {
  const brief = buildDiligenceBrief(EMPTY_LEASEHOLD_FACTS, TODAY);
  const urls = brief.guidance.map((link) => link.url);
  assert.ok(urls.includes("https://www.gov.uk/leasehold-property"));
  assert.ok(urls.includes("https://www.lease-advice.org/"));
  assert.ok(GUIDANCE_LINKS.some((link) => link.kind === "official-guidance"));
  assert.ok(GUIDANCE_LINKS.some((link) => link.kind === "independent-advice"));
  assert.match(brief.professional, /independent/i);
  assert.match(brief.professional, /solicitor|conveyancer/i);
});

test("lease bands split at 80, 100 and 125 years", () => {
  assert.equal(leaseBand(null), null);
  assert.equal(leaseBand(0)?.id, "under-80");
  assert.equal(leaseBand(79)?.id, "under-80");
  assert.equal(leaseBand(80)?.id, "80-99");
  assert.equal(leaseBand(99)?.id, "80-99");
  assert.equal(leaseBand(100)?.id, "100-125");
  assert.equal(leaseBand(125)?.id, "100-125");
  assert.equal(leaseBand(126)?.id, "over-125");
  assert.equal(leaseBand(990)?.id, "over-125");
});

test("remaining years come from the expiry date and never go negative", () => {
  assert.equal(yearsRemaining("2106-09-07", TODAY), 80);
  assert.equal(yearsRemaining("2106-09-05", TODAY), 79);
  assert.equal(yearsRemaining("2020-01-01", TODAY), 0);
  assert.equal(yearsRemaining(null, TODAY), null);
  assert.equal(yearsRemaining("soon", TODAY), null);
});

test("lease bands are context text only: no discount, no money figure", () => {
  for (const band of Object.values(LEASE_BANDS)) {
    assert.ok(band.context.length > 0, band.id);
    assert.doesNotMatch(band.context, /discount|deduct|%|£/i, band.id);
  }
  assert.match(LEASE_BAND_NOTE, /no price adjustment/i);
});

test("the service charge share flags at 1% and 2% of the price", () => {
  assert.equal(serviceChargeShare(null, 500_000), null);
  assert.equal(serviceChargeShare(2_000, null), null);
  assert.equal(serviceChargeShare(2_000, 0), null);
  assert.deepEqual(
    [4_999, 5_000, 9_999, 10_000].map((charge) => serviceChargeShare(charge, 500_000)?.flag),
    ["under-1", "1-to-2", "1-to-2", "2-plus"],
  );
  assert.equal(serviceChargeShare(2_800, 560_000)?.percent, 0.5);
});

test("building height picks Building Safety Act questions at 11 m and 18 m", () => {
  assert.equal(heightTier({ metres: null, storeys: null }), "unknown");
  assert.equal(heightTier({ metres: 10.9, storeys: null }), "under-11");
  assert.equal(heightTier({ metres: 11, storeys: null }), "11-to-18");
  assert.equal(heightTier({ metres: 17.9, storeys: null }), "11-to-18");
  assert.equal(heightTier({ metres: 18, storeys: null }), "18-plus");
  assert.equal(heightTier({ metres: null, storeys: 4 }), "under-11");
  assert.equal(heightTier({ metres: null, storeys: 5 }), "11-to-18");
  assert.equal(heightTier({ metres: 12, storeys: 7 }), "18-plus");
  assert.deepEqual(buildingSafetyQuestions({ metres: null, storeys: null }).questions, []);
  const tall = buildingSafetyQuestions({ metres: 30, storeys: null }).questions.join(" ");
  assert.match(tall, /EWS1/);
  assert.match(tall, /Building Safety Regulator/);
  assert.match(buildingSafetyQuestions({ metres: 12, storeys: null }).questions.join(" "), /deed of certificate/);
  assert.doesNotMatch(BUILDING_SAFETY_QUESTIONS["11-to-18"].join(" "), /Building Safety Regulator/);
});
