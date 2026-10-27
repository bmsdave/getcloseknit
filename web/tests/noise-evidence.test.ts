import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRCRAFT_NOTE,
  METHOD_MODELLED,
  NOISE_SOURCE_ID,
  REVIEWED_NOISE_SOURCE,
  addVisitNote,
  assessNoiseCandidate,
  assessNoiseLocation,
  describeReadingKind,
  estimateNuisanceScore,
  recordVisit,
  refuseVisitNote,
  toggleConcern,
  visitPromptsForConcerns,
} from "../src/lib/noise-evidence";
import * as noiseEvidence from "../src/lib/noise-evidence";
import { addQuestion } from "../src/lib/leasehold";

test("incompatible noise units are rejected", () => {
  for (const unit of ["ug/m3", "dB Lden", "dB"]) {
    assert.throws(() => assessNoiseLocation(-0.14, 51.5, unit), /incompatible.*unit/);
  }
});

test("the reviewed units assess the same mapped point", () => {
  for (const unit of ["dB LAeq,16h", "dB Lnight"] as const) {
    const result = assessNoiseLocation(-0.14, 51.5, unit);
    assert.equal(result.status, "mapped-exposure");
    assert.equal(result.unit, unit);
    assert.equal(result.corridor, "road-corridor-a");
    assert.equal(result.method, METHOD_MODELLED);
  }
});

test("a location on the corridor boundary counts as mapped", () => {
  const result = assessNoiseLocation(-0.17, 51.505);

  assert.equal(result.status, "mapped-exposure");
  assert.equal(result.method, "modelled");
});

test("a gap between corridors is never a quietness guarantee", () => {
  const result = assessNoiseLocation(-0.105, 51.505);

  assert.equal(result.status, "no-mapped-exposure");
  assert.equal(result.corridor, null);
  assert.match(result.explanation.toLowerCase(), /not a quietness guarantee/);
  assert.match(result.explanation.toLowerCase(), /modelled/);
});

test("out-of-coverage noise is distinct from a corridor gap", () => {
  const outside = assessNoiseLocation(-0.3, 51.51);
  const gap = assessNoiseLocation(-0.105, 51.505);

  assert.equal(outside.status, "no-coverage");
  assert.equal(gap.status, "no-mapped-exposure");
  assert.notEqual(outside.status, gap.status);
  assert.match(outside.explanation.toLowerCase(), /coverage/);
});

test("the reviewed source record keeps model type, units, dates, and resolution", () => {
  assert.equal(REVIEWED_NOISE_SOURCE.sourceId, NOISE_SOURCE_ID);
  assert.match(REVIEWED_NOISE_SOURCE.method.toLowerCase(), /modelled/);
  assert.ok(REVIEWED_NOISE_SOURCE.units.includes("dB LAeq,16h"));
  assert.ok(REVIEWED_NOISE_SOURCE.sourceDate.length > 0);
  assert.ok(REVIEWED_NOISE_SOURCE.resolution.length > 0);
  assert.ok(REVIEWED_NOISE_SOURCE.timePeriod.length > 0);
  assert.match(AIRCRAFT_NOTE.toLowerCase(), /separate/);
});

test("modelled exposure is distinct from a live measurement", () => {
  const modelled = describeReadingKind("modelled");
  const measured = describeReadingKind("measured");

  assert.match(modelled.toLowerCase(), /strategic/);
  assert.doesNotMatch(modelled.toLowerCase(), /live/);
  assert.match(measured.toLowerCase(), /live/);
  assert.notEqual(modelled, measured);
  assert.throws(() => describeReadingKind("satellite"), /unknown reading kind/);
});

test("no speculative nuisance score exists", () => {
  assert.throws(() => estimateNuisanceScore(-0.14, 51.5), /unsupported/);
  assert.equal((noiseEvidence as Record<string, unknown>)["nuisanceScore"], undefined);
  assert.equal((noiseEvidence as Record<string, unknown>)["nuisance_score"], undefined);
});

test("visit prompts follow concerns while unrelated topics add nothing", () => {
  const partial = visitPromptsForConcerns(["evening-noise", "lease-length"]);
  assert.deepEqual(partial.map((prompt) => prompt.slot), ["evening"]);

  const full = visitPromptsForConcerns(["evening-noise", "weekend-noise", "event-day"]);
  assert.deepEqual(full.map((prompt) => prompt.slot).sort(), ["evening", "event-day", "weekend"]);

  assert.deepEqual(visitPromptsForConcerns(["lease-length"]), []);
  assert.deepEqual(visitPromptsForConcerns([]), []);
});

test("visit notes reuse the shared checklist question model", () => {
  const text = "Traffic audible with the windows open in the evening.";
  assert.deepEqual(addVisitNote([], text).notes, addQuestion([], text));
  assert.equal(addVisitNote([], text).refusal, null);
});

test("visit notes refuse neighbour identification and allegations", () => {
  for (const text of ["Flat 4 plays drums all night", "Mr Smith shouts", "The neighbours were loud"]) {
    const result = addVisitNote([], text);
    assert.deepEqual(result.notes, []);
    assert.match((result.refusal ?? "").toLowerCase(), /condition/);
    assert.equal(refuseVisitNote(text) !== null, true);
  }
  assert.equal(refuseVisitNote("Road hum after 11pm, windows closed."), null);
});

test("two visits at different times record with distinct slots", () => {
  const first = recordVisit({ visits: [], notes: [] }, "evening", "Road hum after 11pm.");
  assert.equal(first.refusal, null);
  assert.equal(first.visits.length, 1);

  const second = recordVisit(first, "weekend", "Quieter on Sunday morning.");
  assert.equal(second.visits.length, 2);
  assert.deepEqual(second.visits.map((visit) => visit.slot), ["evening", "weekend"]);
  assert.notEqual(second.visits[0].noteId, second.visits[1].noteId);
});

test("concern toggles add once and remove cleanly", () => {
  assert.deepEqual(toggleConcern([], "evening-noise", true), ["evening-noise"]);
  assert.deepEqual(toggleConcern(["evening-noise"], "evening-noise", true), ["evening-noise"]);
  assert.deepEqual(toggleConcern(["evening-noise", "event-day"], "evening-noise", false), ["event-day"]);
});

test("candidates map to mapped, gap, and outside-coverage states", () => {
  const mapped = assessNoiseCandidate("uk:lsoa:E01000001");
  assert.equal(mapped?.status, "mapped-exposure");

  const gap = assessNoiseCandidate("uk:lsoa:E01000002");
  assert.equal(gap?.status, "no-mapped-exposure");
  assert.match((gap?.explanation ?? "").toLowerCase(), /not a quietness guarantee/);

  const outside = assessNoiseCandidate("uk:lad:E09000001");
  assert.equal(outside?.status, "no-coverage");
  assert.match((outside?.explanation ?? "").toLowerCase(), /outside the pilot/);
});
