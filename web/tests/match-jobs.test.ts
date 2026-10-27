import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { createMatchRequest, readMatchJob, resetMatchJobs } from "../src/lib/match-jobs";

test("an uncached commute returns a partial job then a complete match", () => {
  resetMatchJobs();
  const profile = withCommute();

  const queued = createMatchRequest(profile, 1_000);
  assert.ok("jobId" in queued.body);
  const complete = readMatchJob(queued.body.jobId, 2_000);

  assert.equal(queued.status, 202);
  assert.ok("schemaVersion" in queued.body);
  assert.equal(queued.body.schemaVersion, "match-job.v1");
  assert.equal(queued.body.partial?.schemaVersion, "match-pack.v2");
  assert.equal(complete.status, 200);
  assert.ok("schemaVersion" in complete.body);
  assert.equal(complete.body.schemaVersion, "match-pack.v2");
});

test("weight changes reuse a cached destination matrix", () => {
  resetMatchJobs();
  const profile = withCommute();
  const queued = createMatchRequest(profile, 1_000);
  assert.ok("jobId" in queued.body);
  readMatchJob(queued.body.jobId, 2_000);
  profile.factors.find((factor) => factor.factorId === "crime")!.weight = 5;

  const cached = createMatchRequest(profile, 2_001);

  assert.equal(cached.status, 200);
});

function withCommute() {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.commuteDestinations = [{
    id: "work", label: "Work", latitude: 51.5012, longitude: -0.1234,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 40, weight: 3,
  }];
  return profile;
}
