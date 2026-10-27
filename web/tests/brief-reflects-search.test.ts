// v4.4 brief-compare track: the Brief reflects the search as set (finding 52), a shortlist link is redacted
// by default (Task 38, finding 53), and a partner's view says "the" limit, never "your" (finding 54).
import assert from "node:assert/strict";
import test from "node:test";

import { buildAreaComparison } from "../src/lib/area-comparison";
import type { GeographyId, MatchCriterion, PreferenceProfile } from "../src/lib/contracts";
import { buildDecisionBrief, renderBriefMarkdown, type BriefRedaction } from "../src/lib/decision-brief";
import { DEFAULT_PROFILE, METRICS } from "../src/lib/fixtures";
import { contractProfile } from "../src/lib/match-model";
import { MATCH_CHIPS } from "../src/lib/match-ranges";
import { addCriterion, freshSearch, searchItems, setBudget, setMust } from "../src/lib/match-search";
import { buildMatchPack } from "../src/lib/matching";
import {
  areasBriefHref, comparedBriefHref, decodeSharedShortlist, fragmentWithScores, OWN_BRIEFS_KEY, ownBrief, packScores,
  UNSHARED_BUDGET, withSentScores,
} from "../src/lib/saved-shortlists";

const NORTH: GeographyId = "uk:lsoa:E01000002";
const SOUTH: GeographyId = "uk:lsoa:E01000003";
const chip = (id: string) => MATCH_CHIPS.find((entry) => entry.id === id)!.criterion;
const kingsCross: MatchCriterion = {
  kind: "place", id: "kings-cross", label: "King's Cross", target: { kind: "point", latitude: 51.5306, longitude: -0.1239 },
  mode: "transit", targetMinutes: 35, must: false,
};

/** CUJ03: Budget £650k (Must), King's Cross #1, Safer streets #2, Good schools #3. */
function cuj03(): PreferenceProfile {
  let profile = setBudget(freshSearch(structuredClone(DEFAULT_PROFILE)), { market: "buy", maximum: 650_000 });
  profile = addCriterion(profile, kingsCross);
  profile = addCriterion(profile, chip("safer-streets"));
  return addCriterion(profile, chip("good-schools"));
}

function brief(profile: PreferenceProfile, redaction: BriefRedaction = { includeDestinations: false, includeNotes: false }) {
  const pack = buildMatchPack(contractProfile(profile));
  return buildDecisionBrief({
    profile, comparison: buildAreaComparison(pack, [NORTH, SOUTH], profile,
      { redactPlaces: !redaction.includeDestinations, redactBudget: redaction.includeBudget === false, shared: redaction.shared }),
    comparisonError: null, candidates: [], viewing: [], costs: null, metrics: METRICS, redaction,
  });
}

/** A browser's localStorage for the own-brief store. */
function withStorage(run: () => void) {
  const store = new Map<string, string>();
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) },
  };
  try {
    run();
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
}

test("the brief names the ordered search, never 'left out: crime, schools' or 'no priorities'", () => {
  const markdown = renderBriefMarkdown(brief(cuj03()));
  assert.doesNotMatch(markdown, /Left out of your score/);
  assert.doesNotMatch(markdown, /haven't picked any priorities/);
  assert.doesNotMatch(markdown, /standard weight/);
  assert.match(markdown, /What matters, most important first: Your place 1 \(#1\), Safer streets \(#2\), Good schools \(#3\)\./);
  assert.match(markdown, /You asked us to weigh, most important first: Your place 1, Safer streets, Good schools\./);
  // The budget Must reads as the chip, not "Price scores at least 1 out of 100".
  assert.match(markdown, /Budget ≤ £600k–£650k\./);
  assert.doesNotMatch(markdown, /scores at least 1 out of 100/);
  // With destinations included the place has its name.
  assert.match(renderBriefMarkdown(brief(cuj03(), { includeDestinations: true, includeNotes: false })), /King's Cross \(#1\)/);
});

test("each area in the brief has its match score, gains and trade-offs (CUJ03 board step 3)", () => {
  const made = brief(cuj03());
  for (const verdict of made.verdicts) {
    assert.equal(typeof verdict.score, "number");
    assert.ok(Array.isArray(verdict.gains) && Array.isArray(verdict.tradeOffs));
    for (const gain of verdict.gains!) assert.doesNotMatch(gain, /King's Cross/);
  }
  assert.ok(made.verdicts.some((verdict) => verdict.gains!.length > 0));
  assert.match(renderBriefMarkdown(made), /### .+ · \d+/);
});

test("a Must range stays a Must in the brief", () => {
  const profile = setMust(cuj03(), searchItems(cuj03()).find((item) => item.id.includes("crime"))!.id, true);
  const markdown = renderBriefMarkdown(brief(profile));
  assert.match(markdown, /Safer streets \(must\)/);
});

test("a partner's brief says 'the' limit, never 'your'", () => {
  const markdown = renderBriefMarkdown(brief(cuj03(), { includeDestinations: false, includeNotes: false, shared: true }));
  assert.match(markdown, /the £650k limit/);
  assert.doesNotMatch(markdown, /your £650k limit/);
  // Nothing asks the partner to do what only the sender can (add a place, add a home, tick a box).
  assert.doesNotMatch(markdown, /add a place you travel to|Homes you're considering|Add a price|unless you tick|you didn't set/);
  assert.match(markdown, /unless the sender included them/);
});

test("Compare › Brief: the link is redacted; the full search stays on this device under its ref", () => {
  withStorage(() => {
    const profile = cuj03();
    const href = areasBriefHref({ candidates: [NORTH, SOUTH], candidateNames: {}, profile, mode: "demo", release: "r1" })!;
    const decoded = decodeSharedShortlist(href.slice("/brief".length));
    assert.ok(decoded.ok);
    const { share } = decoded;
    // Nothing private in the link (finding 53).
    assert.equal(share.redacted, true);
    assert.equal(share.budgetShared, false);
    assert.equal(share.placesShared, false);
    assert.equal(share.profile.maximumBudget, UNSHARED_BUDGET);
    assert.equal((share.profile.places ?? []).length, 0);
    assert.doesNotMatch(href, /650000|51\.53/);
    const envelope = JSON.parse(Buffer.from(href.slice("/brief#shortlist=v1.".length), "base64url").toString()) as Record<string, unknown>;
    assert.deepEqual(envelope.include, { places: false, budget: false, notes: false });
    assert.equal(envelope.redacted, true);
    // The order and Musts travel (v3 fragment): the partner's brief reads the same search.
    assert.deepEqual(searchItems(share.profile).map((item) => item.id), ["affordability", "range:crime", "range:schools"]
      .map((id) => searchItems(profile).find((item) => item.id.startsWith(id))?.id ?? id));
    // This device reads its full search back; another device (no store) cannot.
    assert.equal(ownBrief(share.ref)?.profile.maximumBudget, 650_000);
    assert.ok(ownBrief(share.ref)?.profile.places?.length);
    // The same search makes the same ref (no growing store on every visit).
    const again = decodeSharedShortlist(areasBriefHref({ candidates: [NORTH, SOUTH], candidateNames: {}, profile, mode: "demo", release: "r1" })!.slice(6));
    assert.equal(again.ok && again.share.ref, share.ref);
    assert.equal(JSON.parse((globalThis as unknown as { window: Window }).window.localStorage.getItem(OWN_BRIEFS_KEY)!).length, 1);
  });
  assert.equal(ownBrief("abcdefgh12345678"), null);
});

// ---- v4.6 (check round 3, CUJ03) ---------------------------------------------------------------

test("every area shows trade-offs: the search's shortfalls first, then its standout cons, two at most", () => {
  const profile = cuj03();
  const pack = buildMatchPack(contractProfile(profile));
  const redaction: BriefRedaction = { includeDestinations: false, includeNotes: false };
  const made = buildDecisionBrief({
    profile, comparison: buildAreaComparison(pack, [NORTH, SOUTH], profile, { redactPlaces: true }),
    comparisonError: null, candidates: [], viewing: [], costs: null, metrics: METRICS, redaction,
    cons: { [NORTH]: ["More polluted than 99% of London", "73% of homes over 55 dB", "a third"], [SOUTH]: [] },
  });
  const [north] = made.verdicts;
  assert.ok(north.tradeOffs!.length > 0 && north.tradeOffs!.length <= 2);
  assert.ok(north.tradeOffs!.includes("More polluted than 99% of London"));
  assert.ok(!north.tradeOffs!.includes("a third"));
  assert.match(renderBriefMarkdown(made), /- Trade-offs: .*More polluted than 99% of London/);
  // An area the search marks short keeps those first.
  const plain = brief(profile).verdicts;
  plain.forEach((verdict, index) => {
    for (const [at, line] of verdict.tradeOffs!.entries()) assert.equal(made.verdicts[index].tradeOffs![at], line);
  });
});

test("a partner reads 'their' must-haves, never 'your'", () => {
  const profile = setMust(cuj03(), searchItems(cuj03()).find((item) => item.id.includes("crime"))!.id, true);
  const shared = renderBriefMarkdown(brief(profile, { includeDestinations: false, includeNotes: false, shared: true }));
  assert.match(shared, /^## Their must-haves/m);
  assert.doesNotMatch(shared, /your must-haves|Your must-haves/);
  assert.match(renderBriefMarkdown(brief(profile)), /^## Your must-haves/m);
});

test("the link carries the sender's scores, and the partner's brief shows them (same numbers both sides)", () => {
  const profile = cuj03();
  const pack = buildMatchPack(contractProfile(profile));
  const href = comparedBriefHref({ pack, compared: [NORTH, SOUTH], profile, mode: "demo" })!;
  const decoded = decodeSharedShortlist(href.slice("/brief".length));
  assert.ok(decoded.ok);
  const sender = Object.fromEntries(pack.values.filter((result) => result.geographyId === NORTH || result.geographyId === SOUTH)
    .map((result) => [result.geographyId, result.score]));
  assert.deepEqual(decoded.share.scores, sender);
  // The partner re-ranks without the place (left out of the link): other scores, until the sent ones are applied.
  const partner = buildMatchPack(contractProfile(decoded.share.profile));
  const shown = withSentScores(partner, decoded.share.scores);
  for (const id of [NORTH, SOUTH]) assert.equal(shown.values.find((result) => result.geographyId === id)!.score, sender[id]);
  // Only the shortlist's own areas, as numbers 0-100; a damaged entry is dropped, never shown.
  const envelope = JSON.parse(Buffer.from(href.slice("/brief#shortlist=v1.".length), "base64url").toString()) as Record<string, unknown>;
  const damaged = `#shortlist=v1.${Buffer.from(JSON.stringify({ ...envelope, scores: { [NORTH]: 140, [SOUTH]: "80", "uk:lsoa:E01009999": 50 } })).toString("base64url")}`;
  const read = decodeSharedShortlist(damaged);
  assert.ok(read.ok);
  assert.equal(read.share.scores, undefined);
  assert.equal(withSentScores(partner, undefined), partner);
});

test("the owner's address-bar link gains the scores once ranked, and nothing else changes", () => {
  withStorage(() => {
    const profile = cuj03();
    const pack = buildMatchPack(contractProfile(profile));
    const fragment = areasBriefHref({ candidates: [NORTH, SOUTH], candidateNames: {}, profile, mode: "demo", release: "r1" })!.slice("/brief".length);
    const before = decodeSharedShortlist(fragment);
    assert.ok(before.ok && before.share.scores === undefined);
    const scores = packScores(pack, [NORTH, SOUTH]);
    assert.deepEqual(Object.keys(scores).sort(), [NORTH, SOUTH]);
    const next = fragmentWithScores(fragment, scores)!;
    const after = decodeSharedShortlist(next);
    assert.ok(after.ok);
    assert.deepEqual(after.share.scores, scores);
    assert.deepEqual({ ...after.share, scores: undefined }, { ...before.share, scores: undefined });
    // Already there: nothing to write again.
    assert.equal(fragmentWithScores(next, scores), null);
    assert.equal(fragmentWithScores("#brief=abc", scores), null);
  });
});
