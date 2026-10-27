import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ENGLAND_INTRO_STEPS, FirstVisitIntro, INTRO_STEPS, PROOF_STRIP, readReturning, returningVisitor, VALUE_LINE,
} from "../src/components/first-visit-intro";
import { londonWord, rankPlace, valueLine } from "../src/lib/coverage-words";
import { siteDescription, siteTitle } from "../src/lib/seo";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import type { SavedShortlist } from "../src/lib/saved-shortlists";

function shortlist(name: string, updatedAt: string, candidates: string[]): SavedShortlist {
  return {
    schemaVersion: "saved-shortlist.v1", id: name, name, createdAt: updatedAt, updatedAt,
    candidates: candidates as SavedShortlist["candidates"], candidateNames: {}, profile: DEFAULT_PROFILE,
    mode: "demo", release: "demo-fixture-pack", evidence: [],
  };
}

function withStorage(storage: unknown, run: () => void) {
  const global = globalThis as { window?: unknown };
  const previous = global.window;
  global.window = Object.defineProperty({}, "localStorage", { get: () => { if (storage instanceof Error) throw storage; return storage; } });
  try { run(); } finally { global.window = previous; }
}

test("the first view's copy makes no demand or payment claim", () => {
  assert.equal(VALUE_LINE, "What London homes really sold for, and which areas fit your budget and commute");
  assert.deepEqual([...INTRO_STEPS], ["Budget & commute", "Matching areas", "Compare & brief"]);
  assert.match(PROOF_STRIP, /HM Land Registry · police\.uk · Ofsted — every figure sourced · nothing here is paid placement/);
  for (const line of [VALUE_LINE, PROOF_STRIP]) assert.doesNotMatch(line, /thousands|users|join|£\d|free trial|subscribe/i);
});

// CLOSE_KNIT_ENGLAND: England's map names no single place and promises no commute (TfL journeys are London's).
test("the first view's copy follows the coverage: London's words only on London's map", () => {
  assert.equal(valueLine(false), VALUE_LINE);
  assert.equal(valueLine(true), "What homes really sold for, and which areas fit your budget");
  assert.deepEqual([...ENGLAND_INTRO_STEPS], ["Budget & needs", "Matching areas", "Compare & brief"]);
  for (const line of [valueLine(true), ...ENGLAND_INTRO_STEPS, siteTitle(true), siteDescription(true)]) {
    assert.doesNotMatch(line, /London|commute/);
  }
  assert.equal(siteTitle(false), "Close Knit: what London homes really sold for, and which areas fit your budget and commute");
  assert.equal(siteTitle(true), "Close Knit: what homes really sold for, and which areas fit your budget");
  const card = (england: boolean) => renderToStaticMarkup(createElement(FirstVisitIntro, {
    england, onFind: () => undefined, onExample: () => undefined, onClose: () => undefined, onDismiss: () => undefined,
  }));
  assert.match(card(true), /What homes really sold for, and which areas fit your budget<\/h1>/);
  assert.doesNotMatch(card(true), /London|commute/);
  assert.match(card(false), /What London homes really sold for, and which areas fit your budget and commute<\/h1>/);
  assert.equal(rankPlace(true), "its region");
  assert.equal(rankPlace(false), "London");
  assert.equal(londonWord(true), "");
});

// v3 Fix 22: no "Welcome back" card; a returning visitor (a saved shortlist or search) gets no card
// at all, the header's ♡ N being their reminder.
test("a saved shortlist or search makes a returning visitor; nothing saved is a first visit", () => {
  const newer = shortlist("Test move", "2026-10-01T10:00:00.000Z", ["uk:lsoa:E01000001", "uk:lsoa:E01004736"]);
  assert.equal(returningVisitor([newer], false), true);
  assert.equal(returningVisitor([], true), true);
  assert.equal(returningVisitor([], false), false);
});

test("blocked or empty storage counts as a first visit and never throws", () => {
  withStorage(new DOMException("denied", "SecurityError"), () => assert.equal(readReturning(), false));
  const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => undefined };
  withStorage(throwing, () => assert.equal(readReturning(), false));
  const empty = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  withStorage(empty, () => assert.equal(readReturning(), false));
});
