import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_VERSION,
  PREVIOUS_NETWORK_VERSION,
  WEEKDAY_TIMETABLE_DATE,
  WEEKEND_TIMETABLE_DATE,
  arrivalBand,
  buildPreviewJourney,
  cacheStats,
  lookupMatrixJourney,
  redactForLog,
  resetCommuteCache,
  screenCommute,
  serviceBandFor,
} from "../src/lib/journeys";
import type { CommuteDestination } from "../src/lib/contracts";

const CENTRAL: CommuteDestination = {
  id: "central",
  label: "Central London",
  latitude: 51.5074,
  longitude: -0.1278,
  mode: "transit",
  arrivalTime: "08:47",
  targetMinutes: 45,
  weight: 5,
};

const DOCKLANDS: CommuteDestination = {
  id: "docklands",
  label: "Docklands office",
  latitude: 51.503,
  longitude: -0.089,
  mode: "transit",
  arrivalTime: "08:47",
  targetMinutes: 45,
  weight: 5,
};

const WESTMINSTER = "uk:lsoa:E01000001";

function screen(destinations: CommuteDestination[] = [{ ...CENTRAL }], overrides: {
  networkVersion?: string;
  serviceDate?: string;
  signal?: AbortSignal;
} = {}) {
  resetCommuteCache();
  return screenCommute(WESTMINSTER, destinations, {
    networkVersion: overrides.networkVersion ?? NETWORK_VERSION,
    serviceDate: overrides.serviceDate ?? WEEKDAY_TIMETABLE_DATE,
    signal: overrides.signal,
  });
}

test("network version change moves durations", () => {
  const current = screen();
  const previous = screen(undefined, { networkVersion: PREVIOUS_NETWORK_VERSION });

  assert.equal(current.legs[0]?.status, "available");
  assert.equal(previous.legs[0]?.status, "available");
  assert.equal(current.legs[0]?.medianMinutes, 32);
  assert.equal(previous.legs[0]?.medianMinutes, 40);
  assert.notEqual(current.legs[0]?.medianMinutes, previous.legs[0]?.medianMinutes);
});

test("unknown network version is unreachable, never guessed", () => {
  const result = screen(undefined, { networkVersion: "street-network-2099-rtm" });

  assert.equal(result.hasUnreachable, true);
  assert.equal(result.eligible, false);
  assert.equal(result.legs[0]?.medianMinutes, null);
});

test("disconnected destination is exposed, not guessed", () => {
  const result = screen([{ ...DOCKLANDS }]);

  assert.equal(result.legs[0]?.status, "unreachable");
  assert.equal(result.legs[0]?.medianMinutes, null);
  assert.equal(result.hasUnreachable, true);
  assert.equal(result.eligible, false);
  assert.equal(result.weightedMinutes, null);
});

test("arrival band change flips eligibility", () => {
  const reachable = screen();
  const night = screen([{ ...CENTRAL, arrivalTime: "23:10" }]);

  assert.equal(arrivalBand("08:47"), "08:45");
  assert.equal(reachable.legs[0]?.arrivalBand, "08:45");
  assert.equal(reachable.eligible, true);
  assert.equal(night.legs[0]?.arrivalBand, "23:00");
  assert.equal(night.legs[0]?.status, "unreachable");
  assert.equal(night.eligible, false);
});

test("weekday and weekend timetables differ for transit", () => {
  assert.equal(serviceBandFor(WEEKDAY_TIMETABLE_DATE), "weekday");
  assert.equal(serviceBandFor(WEEKEND_TIMETABLE_DATE), "weekend");

  const weekday = screen();
  const weekend = screen(undefined, { serviceDate: WEEKEND_TIMETABLE_DATE });

  assert.equal(weekday.legs[0]?.medianMinutes, 32);
  assert.equal(weekend.legs[0]?.medianMinutes, 45);
});

test("walking is identical across service bands", () => {
  const walking = { ...CENTRAL, mode: "walk" as const, targetMinutes: 90 };
  const weekday = screen([walking]);
  const weekend = screen([walking], { serviceDate: WEEKEND_TIMETABLE_DATE });

  assert.equal(weekday.legs[0]?.medianMinutes, weekend.legs[0]?.medianMinutes);
});

test("zero-weight destinations are ignored", () => {
  const result = screen([{ ...CENTRAL }, { ...DOCKLANDS, weight: 0 }]);

  assert.equal(result.eligible, true);
  assert.deepEqual(result.ignoredDestinationIds, ["docklands"]);
  assert.equal(result.legs.length, 1);
  assert.equal(result.weightedMinutes, 32);
});

test("exceeded maximum commute is ineligible", () => {
  const comfortable = screen();
  const exceeded = screen([{ ...CENTRAL, targetMinutes: 30 }]);

  assert.equal(comfortable.eligible, true);
  assert.equal(comfortable.exceedsMaximum, false);
  assert.equal(exceeded.legs[0]?.exceedsTarget, true);
  assert.equal(exceeded.exceedsMaximum, true);
  assert.equal(exceeded.eligible, false);
});

test("fixed fixtures repeat exactly with components", () => {
  const first = lookupMatrixJourney({
    originAreaId: WESTMINSTER,
    latitude: 51.5074,
    longitude: -0.1278,
    mode: "transit",
    arrivalTime: "08:47",
    networkVersion: NETWORK_VERSION,
    serviceDate: WEEKDAY_TIMETABLE_DATE,
  });
  const second = lookupMatrixJourney({
    originAreaId: WESTMINSTER,
    latitude: 51.5074,
    longitude: -0.1278,
    mode: "transit",
    arrivalTime: "08:53",
    networkVersion: NETWORK_VERSION,
    serviceDate: WEEKDAY_TIMETABLE_DATE,
  });

  assert.deepEqual(first, second);
  assert.equal(first.medianMinutes, 32);
  assert.deepEqual(first.rangeMinutes, [28, 38]);
  assert.equal(first.transfers, 1);
  assert.equal(first.walkingMinutes, 8);
});

test("results are labelled approximate area-origin", () => {
  const result = screen();

  assert.equal(result.approximation, "area-origin");
  assert.match(result.assumptions.join(" "), /approximate/i);
  assert.equal(result.networkVersion, NETWORK_VERSION);
  assert.equal(result.timetableDate, WEEKDAY_TIMETABLE_DATE);
});

test("cancellation aborts screening", () => {
  const controller = new AbortController();
  controller.abort();

  assert.throws(() => screen(undefined, { signal: controller.signal }), /cancelled/);
});

test("unchanged inputs reuse the cache without recomputation", () => {
  resetCommuteCache();
  const options = { networkVersion: NETWORK_VERSION, serviceDate: WEEKDAY_TIMETABLE_DATE };
  screenCommute(WESTMINSTER, [{ ...CENTRAL }], options);
  screenCommute(WESTMINSTER, [{ ...CENTRAL }], options);

  assert.equal(cacheStats().computations, 1);
});

test("logs carry no precise destinations", () => {
  const redacted = JSON.stringify(redactForLog(screen()));

  assert.doesNotMatch(redacted, /Central London|51\.5074|-0\.1278/);
  assert.match(redacted, /51507/);
});

test("precise address routing stays a separate explicit request", () => {
  const approximate = screen();

  assert.match(approximate.assumptions.join(" "), /precise address routing.*separate/i);
  assert.equal(approximate.legs[0]?.destinationCell, "51507:-128");
});

test("driving is outside the public journey contract", () => {
  assert.throws(() => buildPreviewJourney({
    origin: { latitude: 51.5, longitude: -0.14 },
    destination: { latitude: 51.53, longitude: -0.12 },
    mode: "drive" as "transit",
    arrivalTime: "09:00",
  }), /unsupported journey mode/);
});
