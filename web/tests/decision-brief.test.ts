import assert from "node:assert/strict";
import test from "node:test";

import { buildAreaComparison } from "../src/lib/area-comparison";
import { previewBrief } from "../src/lib/brief-fixture";
import { budgetsFor } from "../src/lib/needs-validation";
import type { GeographyId, PreferenceProfile } from "../src/lib/contracts";
import type { AreaBrief } from "../src/lib/brief-model";
import {
  buildDecisionBrief,
  isSafeSourceUrl,
  renderBriefMarkdown,
  REQUIRED_BRIEF_SECTIONS,
  type DecisionBriefInput,
} from "../src/lib/decision-brief";
import { DEFAULT_PROFILE, METRICS, PROPERTY_HISTORIES } from "../src/lib/fixtures";
import { weightedProfile } from "./weighted-profile";
import { EMPTY_ASSUMPTIONS } from "../src/lib/housing-cost";
import { EMPTY_LEASEHOLD_FACTS } from "../src/lib/leasehold";
import {
  buildMatchPack,
  scoreMatchPack,
  type RawMatchArea,
  type RawMatchFactor,
  type RentContext,
} from "../src/lib/matching";
import {
  buildUserCandidate,
  type KnownAddress,
  type UserCandidate,
} from "../src/lib/user-candidates";

const EMPTY_RENT: RentContext = { observed: [], lsoaToBorough: {} };
const WESTMINSTER: GeographyId = "uk:lsoa:E01000001";
const NORTH: GeographyId = "uk:lsoa:E01000002";
const SOUTH: GeographyId = "uk:lsoa:E01000003";

function profileWith(weights: Record<string, number>): PreferenceProfile {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.commuteDestinations = [];
  for (const factor of profile.factors) {
    factor.weight = weights[factor.factorId] ?? 0;
    factor.minimumUtility = null;
    factor.maximumUtility = null;
  }
  return profile;
}

function factorEvidence(
  rawValue: number,
  percentile: number,
  carrier: GeographyId,
  sourceVersion = "test-release-2026-01",
): RawMatchFactor {
  return {
    rawValue,
    percentile,
    carrierGeographyId: carrier,
    quality: "observed",
    sourceVersion,
  };
}

function rawArea(code: string, name: string, price: number): RawMatchArea {
  return {
    geographyId: `uk:lsoa:${code}`,
    name,
    price,
    monthlyRent: 1800,
    journeys: {},
    factors: {
      crime: factorEvidence(60, 20, `uk:lsoa:${code}`),
      income: factorEvidence(52_000, 62, "uk:msoa:E02000011"),
    },
  };
}

function demoInput(): DecisionBriefInput {
  const profile = weightedProfile();
  const pack = buildMatchPack(profile);
  const comparison = buildAreaComparison(pack, [NORTH, SOUTH], profile);
  return {
    profile,
    comparison,
    comparisonError: null,
    candidates: [],
    viewing: [],
    costs: null,
    metrics: METRICS,
    redaction: { includeDestinations: false, includeNotes: false },
  };
}

function candidateDirectory(): KnownAddress[] {
  return [{
    uprn: "100000000001",
    address: "1 Parliament Preview, London, SW1A 1AA",
    geographyId: WESTMINSTER,
  }];
}

function saleCandidate(amount = 600_000, notes = "Quiet close, second viewing booked"): UserCandidate {
  const result = buildUserCandidate(
    {
      addressText: "1 Parliament Preview, London, SW1A 1AA",
      uprn: "100000000001",
      referenceUrl: "https://example.invalid/listing/42",
      askingKind: "sale",
      askingAmount: amount,
      priceUnit: "gbp-total",
      bedrooms: 2,
      floorAreaSqm: 54,
      notes,
    },
    candidateDirectory(),
    [],
    "2026-09-01T10:00:00.000Z",
  );
  assert.equal(result.ok, true);
  return (result as { ok: true; candidate: UserCandidate }).candidate;
}

test("every required section exists even with areas alone", () => {
  const brief = buildDecisionBrief(demoInput());
  assert.deepEqual(brief.sections.map((section) => section.id), [...REQUIRED_BRIEF_SECTIONS]);
  for (const section of brief.sections) {
    assert.ok(section.heading.length > 0, `section ${section.id} needs a heading`);
    assert.ok(section.lines.length > 0, `section ${section.id} needs at least one line`);
  }
});

test("stated needs name budgets, bedrooms, weights, and destinations", () => {
  const input = demoInput();
  input.profile.commuteDestinations = [{
    id: "dest-1", label: "City office", latitude: 51.5, longitude: -0.12,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 45, weight: 3,
  }];
  input.redaction = { includeDestinations: true, includeNotes: false };
  const brief = buildDecisionBrief(input);
  const needs = brief.sections.find((section) => section.id === "needs")!;
  const text = needs.lines.map((line) => line.text).join("\n");
  const assumed = brief.sections.find((section) => section.id === "assumed")!;
  // The default comfortable budget is an assumption, never a stated need.
  assert.match(assumed.lines.map((line) => line.text).join("\n"), /£500,000/);
  assert.doesNotMatch(text, /£500,000/);
  assert.match(text, /£650,000/);
  assert.match(text, /2 bedrooms/);
  assert.match(text, /City office/);
  assert.match(text, /transit/);
});

test("your must-haves list utility bounds and unmet limits per area", () => {
  const input = demoInput();
  const affordability = input.profile.factors.find((factor) => factor.factorId === "affordability")!;
  affordability.minimumUtility = 60;
  const brief = buildDecisionBrief(input);
  const constraints = brief.sections.find((section) => section.id === "constraints")!;
  const text = constraints.lines.map((line) => line.text).join("\n");
  assert.equal(constraints.heading, "Your must-haves");
  assert.match(text, /^Price scores at least 60 out of 100\.$/m);
  assert.doesNotMatch(text, /hard (constraint|utility)/i);
  assert.ok(constraints.lines.some((line) => line.kind === "constraint"));
});

test("trade-offs reuse the comparison conclusions without recalculating", () => {
  const input = demoInput();
  const brief = buildDecisionBrief(input);
  const tradeoffs = brief.sections.find((section) => section.id === "tradeoffs")!;
  // Gap sentences ("… is missing 19% of weighted evidence") move to Limits, once each.
  const gaps = (line: string) => / is missing \d+% of weighted evidence\.$/.test(line) || /^We have no /.test(line);
  assert.deepEqual(
    tradeoffs.lines.filter((line) => line.kind === "tradeoff").map((line) => line.text),
    input.comparison!.conclusions.filter((line) => !gaps(line)),
  );
  assert.ok(!tradeoffs.lines.some((line) => line.text.includes(input.comparison!.release)));
});

test("an unavailable comparison becomes an explicit notice, not a silent gap", () => {
  const input = demoInput();
  input.comparison = null;
  input.comparisonError = "comparison needs at least two areas";
  input.candidates = [{ candidate: saleCandidate(), history: null, lease: EMPTY_LEASEHOLD_FACTS }];
  const brief = buildDecisionBrief(input);
  const tradeoffs = brief.sections.find((section) => section.id === "tradeoffs")!;
  assert.ok(tradeoffs.lines.some((line) =>
    line.kind === "unknown" && line.text.includes("comparison needs at least two areas")));
  assert.deepEqual(brief.sections.map((section) => section.id), [...REQUIRED_BRIEF_SECTIONS]);
});

test("mixed source versions across candidates stay flagged and separate", () => {
  const input = demoInput();
  const first = saleCandidate();
  const second = saleCandidate(450_000, "Other note");
  const recent = structuredClone(PROPERTY_HISTORIES[0]!);
  const older = structuredClone(PROPERTY_HISTORIES[0]!);
  recent.sourceVersion = "preview-hmlr-epc-cpih-2026-06";
  older.sourceVersion = "preview-hmlr-epc-cpih-2025-06";
  input.candidates = [
    { candidate: first, history: recent, lease: EMPTY_LEASEHOLD_FACTS },
    { candidate: second, history: older, lease: EMPTY_LEASEHOLD_FACTS },
  ];
  const brief = buildDecisionBrief(input);
  const evidence = brief.sections.find((section) => section.id === "evidence")!;
  const text = evidence.lines.map((line) => line.text).join("\n");
  assert.match(text, /preview-hmlr-epc-cpih-2026-06/);
  assert.match(text, /preview-hmlr-epc-cpih-2025-06/);
  assert.ok(evidence.lines.some((line) => /mixed|different/i.test(line.text)),
    "mixed releases must be called out explicitly");
  const candidates = brief.sections.find((section) => section.id === "candidates")!;
  const asking = candidates.lines.find((line) => line.text.includes("£600,000"));
  const achieved = candidates.lines.find((line) => line.text.includes("£570,000"));
  assert.ok(asking && achieved && asking !== achieved, "asking and achieved stay separate lines");
});

test("asking stays unverified and achieved stays official on one candidate", () => {
  const input = demoInput();
  input.candidates = [{
    candidate: saleCandidate(),
    history: PROPERTY_HISTORIES[0]!,
    lease: EMPTY_LEASEHOLD_FACTS,
  }];
  const brief = buildDecisionBrief(input);
  const candidates = brief.sections.find((section) => section.id === "candidates")!;
  const text = candidates.lines.map((line) => line.text).join("\n");
  assert.match(text, /Asking price \(you entered, unverified\)/);
  assert.match(text, /£600,000/);
  assert.match(text, /Achieved £570,000 on 2022-11-03 \(official record\)/);
  assert.match(text, /never combined/);
  assert.ok(candidates.lines.some((line) => line.kind === "estimate" && line.text.includes("£600,000")));
});

test("only http(s) reference URLs become links", () => {
  assert.equal(isSafeSourceUrl("https://example.invalid/x"), true);
  assert.equal(isSafeSourceUrl("http://example.invalid/x"), true);
  assert.equal(isSafeSourceUrl("javascript:alert(1)"), false);
  assert.equal(isSafeSourceUrl("data:text/html,hi"), false);
  assert.equal(isSafeSourceUrl(null), false);
  assert.equal(isSafeSourceUrl("not a url"), false);

  const input = demoInput();
  const candidate = saleCandidate();
  candidate.referenceUrl = { value: "javascript:alert(1)", verification: "unverified", observedAt: "2026-09-01" };
  input.candidates = [{ candidate, history: null, lease: EMPTY_LEASEHOLD_FACTS }];
  const brief = buildDecisionBrief(input);
  const candidates = brief.sections.find((section) => section.id === "candidates")!;
  assert.ok(candidates.lines.every((line) => line.source?.url !== "javascript:alert(1)"));
  assert.ok(candidates.lines.some((line) => /not shown as a link/i.test(line.text)));
  const markdown = renderBriefMarkdown(brief);
  assert.doesNotMatch(markdown, /\]\(javascript:/);
});

test("private destinations and notes stay redacted until explicitly included", () => {
  const withPrivate = demoInput();
  withPrivate.profile.commuteDestinations = [{
    id: "dest-1", label: "Secret office", latitude: 51.5, longitude: -0.12,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 45, weight: 3,
  }];
  withPrivate.candidates = [{ candidate: saleCandidate(), history: null, lease: EMPTY_LEASEHOLD_FACTS }];

  const redacted = buildDecisionBrief(withPrivate);
  assert.equal(redacted.redacted, true);
  const redactedText = redacted.sections.map((section) => section.lines.map((line) => line.text).join("\n")).join("\n");
  assert.doesNotMatch(redactedText, /Secret office/);
  assert.doesNotMatch(redactedText, /Quiet close/);
  assert.match(redactedText, /redacted/i);

  const open = buildDecisionBrief({
    ...withPrivate,
    redaction: { includeDestinations: true, includeNotes: true },
  });
  assert.equal(open.redacted, false);
  const openText = open.sections.map((section) => section.lines.map((line) => line.text).join("\n")).join("\n");
  assert.match(openText, /Secret office/);
  assert.match(openText, /Quiet close/);
});

test("every cited source carries its release and observation date", () => {
  const input = demoInput();
  input.candidates = [{
    candidate: saleCandidate(),
    history: PROPERTY_HISTORIES[0]!,
    lease: EMPTY_LEASEHOLD_FACTS,
  }];
  const brief = buildDecisionBrief(input);
  const sourced = brief.sections.flatMap((section) => section.lines).filter((line) => line.source);
  assert.ok(sourced.length > 0, "brief must cite sources");
  for (const line of sourced) {
    assert.ok(line.source!.label.length > 0);
    assert.ok(line.source!.release.length > 0, `source needs a release: ${line.text}`);
    assert.ok(line.source!.observedAt.length > 0, `source needs an observation date: ${line.text}`);
    assert.ok(line.source!.url === null || isSafeSourceUrl(line.source!.url));
  }
  const evidence = brief.sections.find((section) => section.id === "evidence")!;
  const text = evidence.lines.map((line) => line.text).join("\n");
  assert.match(text, /from LSOA E\d{8} · observed/);
  assert.match(text, /gov\.uk|ons\.gov\.uk|police\.uk/i);
});

test("uncertain estimates never harden into valuations", () => {
  const input = demoInput();
  input.candidates = [{
    candidate: saleCandidate(),
    history: PROPERTY_HISTORIES[0]!,
    lease: EMPTY_LEASEHOLD_FACTS,
  }];
  input.costs = { assumptions: { ...EMPTY_ASSUMPTIONS, price: 600_000, deposit: 60_000, annualInterestRatePct: 4.5, termYears: 25 } };
  const markdown = renderBriefMarkdown(buildDecisionBrief(input));
  const withoutAllowedDenial = markdown.replaceAll("not a valuation", "").replaceAll("Not a valuation", "");
  assert.doesNotMatch(withoutAllowedDenial, /valuat/i);
  assert.doesNotMatch(markdown, /\bworth\b/i);
  assert.doesNotMatch(markdown, /market value/i);
  assert.match(markdown, /not a valuation/i);
  assert.match(markdown, /unverified/i);
  assert.match(markdown, /comparison tool/i);
});

test("pending questions stay questions and never read as verified facts", () => {
  const input = demoInput();
  input.viewing = [{
    candidateName: "North London preview",
    items: [
      { text: "Ride the real commute before deciding", status: "unvisited", note: null },
      { text: "Listen on the visit; the map never predicts sound", status: "unresolved", note: null },
      { text: "Checked evening lighting", status: "checked", note: null },
    ],
  }];
  input.candidates = [{
    candidate: saleCandidate(),
    history: null,
    lease: {
      ...EMPTY_LEASEHOLD_FACTS,
      questions: [{ id: "q-1", text: "Confirm the service charge cap in writing", url: null, answered: false }],
    },
  }];
  const brief = buildDecisionBrief(input);
  const open = brief.sections.find((section) => section.id === "open-questions")!;
  const openText = open.lines.map((line) => line.text).join("\n");
  // The area's first open question leads its "At a glance" lines and is not asked twice.
  assert.equal(brief.verdicts.find((verdict) => verdict.area === "North London preview")?.question, "Ride the real commute before deciding");
  assert.doesNotMatch(openText, /Ride the real commute/);
  assert.match(openText, /Listen on the visit/);
  assert.match(openText, /service charge cap/);
  assert.ok(open.lines.filter((line) => line.kind === "question").length >= 2);
  for (const section of brief.sections) {
    if (section.id === "open-questions") continue;
    for (const line of section.lines) {
      assert.ok(!line.text.includes("Confirm the service charge cap in writing"),
        `pending question leaked into ${section.id}`);
    }
  }
  assert.match(openText, /never a verified fact/);
  assert.doesNotMatch(openText, /confirmed|proven|guaranteed/i);
});

test("costs reuse the worksheet model with unknowns kept unknown", () => {
  const input = demoInput();
  input.costs = { assumptions: { ...EMPTY_ASSUMPTIONS, monthlyRent: null } };
  input.profile.market = "rent";
  const brief = buildDecisionBrief(input);
  const costs = brief.sections.find((section) => section.id === "costs")!;
  const text = costs.lines.map((line) => line.text).join("\n");
  // Nothing known: say what to add, never a £0 total.
  assert.match(text, /Add a rent to see monthly costs/);
  assert.doesNotMatch(text, /£0\b/);
  assert.match(text, /comparison tool/i);

  const priced = demoInput();
  priced.profile.market = "rent";
  priced.costs = { assumptions: { ...EMPTY_ASSUMPTIONS, monthlyRent: 2400, councilTaxMonthly: 150 } };
  const pricedCosts = buildDecisionBrief(priced).sections.find((section) => section.id === "costs")!;
  const pricedText = pricedCosts.lines.map((line) => line.text).join("\n");
  assert.match(pricedText, /£2,400/);
  assert.match(pricedText, /£2,550/);
});

test("markdown exports every section as readable text with safe links only", () => {
  const input = demoInput();
  input.redaction = { includeDestinations: true, includeNotes: true };
  input.profile.commuteDestinations = [{
    id: "dest-1", label: "City office", latitude: 51.5, longitude: -0.12,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 45, weight: 3,
  }];
  input.candidates = [{
    candidate: saleCandidate(),
    history: PROPERTY_HISTORIES[0]!,
    lease: EMPTY_LEASEHOLD_FACTS,
  }];
  const markdown = renderBriefMarkdown(buildDecisionBrief(input));
  assert.match(markdown, /^# Decision brief/m);
  for (const section of REQUIRED_BRIEF_SECTIONS) {
    void section;
  }
  assert.match(markdown, /^## Stated needs/m);
  assert.match(markdown, /^## Your must-haves/m);
  assert.match(markdown, /^## Trade-offs/m);
  assert.match(markdown, /^## Homes you.re considering/m);
  assert.match(markdown, /^## Total housing costs/m);
  assert.match(markdown, /^## Sources/m);
  assert.match(markdown, /^## Open questions/m);
  assert.match(markdown, /^## Limits/m);
  assert.match(markdown, /\[.*\]\(https?:\/\/[^)]+\)/);
  assert.doesNotMatch(markdown, /\]\(javascript:/);
});

test("a brief needs at least one area or candidate", () => {
  const input = demoInput();
  input.comparison = null;
  input.comparisonError = "comparison needs at least two areas";
  assert.throws(() => buildDecisionBrief({ ...input, candidates: [], viewing: [] }), /at least one/);
});

test("unknown comparison areas are rejected like the comparison model", () => {
  const profile = profileWith({ affordability: 3 });
  const pack = scoreMatchPack(profile, [rawArea("E01000011", "Northend", 400_000)], EMPTY_RENT);
  assert.throws(() => buildAreaComparison(pack, [NORTH, SOUTH], profile), /unknown area/);
});

// Review #2: a brief from the wizard (one budget, a place, nothing else touched) states only what
// the household set: no "target budget", no "weights you set", no schools line, and no £0 total.
test("the brief never attributes defaults to the household and asks for a price instead of £0", () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  Object.assign(profile, budgetsFor(600_000));
  profile.places = [{
    id: "work", label: "Private Office 77", target: { kind: "point", latitude: 51.501, longitude: -0.1416 },
    mode: "transit", targetMinutes: 45, weight: 3, must: false,
  }];
  const ids: GeographyId[] = [NORTH, SOUTH];
  const pack = buildMatchPack(profile);
  const brief = previewBrief(ids, [profile.targetBudget, profile.maximumBudget], profile.bedrooms)!;
  const built = buildDecisionBrief({
    profile,
    comparison: buildAreaComparison(pack, ids, profile, { brief, redactPlaces: true }),
    comparisonError: null,
    candidates: [],
    viewing: [],
    costs: { assumptions: EMPTY_ASSUMPTIONS },
    metrics: METRICS,
    redaction: { includeDestinations: false, includeNotes: false },
  });
  const markdown = renderBriefMarkdown(built);
  assert.doesNotMatch(markdown, /target budget/i);
  assert.doesNotMatch(markdown, /weights you set/i);
  assert.doesNotMatch(markdown, /Schools: primary/);
  assert.doesNotMatch(markdown, /Private Office 77/);

  const section = (id: string) => built.sections.find((entry) => entry.id === id)!.lines.map((line) => line.text).join("\n");
  assert.match(section("needs"), /Buying, up to £600,000/);
  assert.match(section("assumed"), /comfortable budget of £480,000/);
  assert.match(section("assumed"), /Price counts at its standard weight/);
  assert.match(markdown, /## Assumed \(you didn't set these\)/);
  assert.match(section("costs"), /^Add a price to see monthly costs\.$/m);
  assert.doesNotMatch(section("costs"), /£0\b/);
  // The card's figures: the ballpark price and the place minutes, the place under its private name.
  assert.match(section("evidence"), /Price · North London preview: ~£440k \(estimate · within your £600k limit/);
  assert.match(section("evidence"), /Your place 1 · North London preview: \d+ min/);

  // Touched fields are stated as the household's own.
  profile.factors.find((factor) => factor.factorId === "crime")!.weight = 4;
  profile.school.phases = ["secondary"];
  const touched = buildDecisionBrief({
    profile, comparison: buildAreaComparison(pack, ids, profile), comparisonError: null, candidates: [], viewing: [], costs: null,
    metrics: [], redaction: { includeDestinations: true, includeNotes: false },
  });
  const needs = touched.sections.find((entry) => entry.id === "needs")!.lines.map((line) => line.text).join("\n");
  assert.match(needs, /Priorities you picked: Crime \(4 of 5\)/);
  assert.match(needs, /Schools: secondary phase/);
  assert.match(needs, /Private Office 77/);
});

// A profile with places scores the journey to each place, never the legacy commute factor: the brief
// says how the journey counts and never reports "commute" as left out of the score.
test("with places set, the journey is in the score and commute is never left out", () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  Object.assign(profile, budgetsFor(600_000));
  for (const factor of profile.factors) if (factor.factorId === "commute") factor.weight = 0;
  profile.places = [{
    id: "work", label: "Waterloo preview station", target: { kind: "point", latitude: 51.5031, longitude: -0.1132 },
    mode: "transit", targetMinutes: 25, weight: 4, must: false,
  }];
  const ids: GeographyId[] = [NORTH, SOUTH];
  const pack = buildMatchPack(profile);
  const build = (includeDestinations: boolean) => buildDecisionBrief({
    profile, comparison: buildAreaComparison(pack, ids, profile, { redactPlaces: !includeDestinations }), comparisonError: null,
    candidates: [], viewing: [], costs: null, metrics: METRICS, redaction: { includeDestinations, includeNotes: false },
  });
  const lines = (brief: ReturnType<typeof build>, id: string) => brief.sections.find((entry) => entry.id === id)!.lines.map((line) => line.text);
  const redacted = build(false);
  assert.ok(lines(redacted, "needs").includes("Journey to Your place 1: weight 4 of 5, limit 25 min."));
  assert.doesNotMatch(lines(redacted, "assumed").join("\n"), /Left out of your score:.*commute/);
  assert.doesNotMatch(renderBriefMarkdown(redacted), /Waterloo preview station/);
  const included = build(true);
  assert.ok(lines(included, "needs").includes("Journey to \u201cWaterloo preview station\u201d: weight 4 of 5, limit 25 min, by transit."));

  // With no place, an unweighted commute is still left out, as before.
  const placeless = { ...profile, places: [] };
  const legacy = buildDecisionBrief({
    profile: placeless, comparison: buildAreaComparison(buildMatchPack(placeless), ids, placeless), comparisonError: null,
    candidates: [], viewing: [], costs: null, metrics: METRICS, redaction: { includeDestinations: false, includeNotes: false },
  });
  assert.match(lines(legacy, "assumed").join("\n"), /Left out of your score:.*commute/);
});

test("the brief opens with three lines per area: price against the limit, the commute, one open question", () => {
  const input = demoInput();
  input.profile.maximumBudget = 450_000;
  input.profile.places = [{ id: "work", label: "Office", target: { kind: "point", latitude: 51.5, longitude: -0.12 }, mode: "transit", targetMinutes: 30, weight: 4, must: false }];
  const pack = buildMatchPack(input.profile);
  input.comparison = buildAreaComparison(pack, [NORTH, SOUTH], input.profile, { redactPlaces: true });
  input.viewing = [{ candidateName: "South Bank preview", items: [
    { id: "total-cost", text: "Total-cost unknowns still open: price.", status: "unvisited" as const, note: null },
    { id: "evening-visit", text: "Revisit South Bank preview in the evening.", status: "unvisited" as const, note: null },
  ] }];
  const brief = buildDecisionBrief(input);
  assert.deepEqual(brief.verdicts.map((verdict) => verdict.area), ["North London preview", "South Bank preview"]);
  const [north, south] = brief.verdicts;
  assert.equal(north!.price, "~£440k · £10k under your £450k limit");
  assert.equal(south!.price, "~£510k · £60k over your £450k limit");
  assert.match(north!.commute, /^\d+ min to Your place 1 \((within|over) your 30 min\)$/);
  // The area's own question, not the general cost one.
  assert.equal(south!.question, "Revisit South Bank preview in the evening.");
  const markdown = renderBriefMarkdown(brief);
  // v4.4 (CUJ03 board): the heading carries the match score, then what the area gains in your search.
  assert.match(markdown, /^## At a glance\n\n### North London preview · \d+\n\n(- Gains: .+\n)?(- Trade-offs: .+\n)?- ~£440k · £10k under your £450k limit\n- \d+ min to Your place 1/m);
});

test("no caveat appears twice in the brief or its Markdown, and unknowns read the same way", () => {
  const input = demoInput();
  const question = "Total-cost unknowns still open: price, deposit. Confirm each before budgeting.";
  input.viewing = ["North London preview", "South Bank preview"].map((candidateName) => ({
    candidateName, items: [{ id: "total-cost", text: question, status: "unvisited" as const, note: null }],
  }));
  input.costs = { assumptions: { ...EMPTY_ASSUMPTIONS, price: 600_000, deposit: 60_000, annualInterestRatePct: 4.5, termYears: 25 } };
  const brief = buildDecisionBrief(input);
  const lines = brief.sections.flatMap((section) => section.lines.map((line) => line.text));
  assert.equal(new Set(lines).size, lines.length, "a sentence repeats in the brief");
  const markdown = renderBriefMarkdown(brief);
  const bullets = markdown.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.replace(/ — \[.*$/, ""));
  const glance = new Set(brief.verdicts.flatMap((verdict) => [verdict.price, verdict.commute, verdict.question]).map((text) => `- ${text}`));
  const body = bullets.filter((line) => !glance.has(line));
  assert.equal(new Set(body).size, body.length, "a sentence repeats in the Markdown");
  // The shared question names both areas once.
  assert.ok(lines.includes(`Open (North London preview and South Bank preview, not looked into yet): ${question}`));
  // The evidence gaps sit under Limits, each named once.
  const limits = brief.sections.find((section) => section.id === "limits")!;
  assert.equal(limits.heading, "Limits");
  assert.ok(limits.lines.some((line) => line.text === "Commute for North London preview and South Bank preview: we don't know this yet, so we haven't counted it."));
  assert.doesNotMatch(markdown, /never ranked|do not treat as zero|is never zero/);
  assert.match(markdown, /Council tax: we don't know this yet, so we haven't counted it\./);
});

test("the release and data mode sit under Sources, never above it", () => {
  const input = { ...demoInput(), mode: "demo" };
  const brief = buildDecisionBrief(input);
  const markdown = renderBriefMarkdown(brief);
  const sources = markdown.indexOf("## Sources");
  assert.ok(sources > 0);
  assert.equal(markdown.indexOf("Release "), markdown.indexOf(`Release ${brief.release} · Preview data`));
  assert.ok(markdown.indexOf("Release ") > sources, "the release shows above Sources");
  assert.match(markdown, /^A summary you can keep or share\. Nothing leaves this device\./m);
});

// Demo mode: the brief service's ballpark is the scorer's price at every bedroom count, so the row,
// chip, pin, card, compare and brief never show two figures for one area.
test("the preview brief prices each area as the preview scorer does", () => {
  for (const bedrooms of [1, 2, 3, 4, 5]) {
    const profile: PreferenceProfile = { ...structuredClone(DEFAULT_PROFILE), bedrooms };
    const pack = buildMatchPack(profile);
    const fixture: AreaBrief = previewBrief([WESTMINSTER, NORTH, SOUTH], [profile.targetBudget, profile.maximumBudget], bedrooms)!;
    for (const area of fixture.areas) {
      const scored: number = pack.values.find((result) => result.geographyId === area.geographyId)!
        .components.find((part) => part.factorId === "affordability")!.rawValue;
      assert.equal(area.estimatedPrice, scored, `${area.name} at ${bedrooms} bedrooms`);
    }
  }
});
