import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RELEASE, describeDataStatus, describePublicDataStatus, REAL_PILOT_RELEASE } from "../src/lib/map-state";

test("demo status names the decision-use warning and release", () => {
  assert.equal(
    describeDataStatus({ mode: "demo", release: DEMO_RELEASE, connection: "online" }),
    `Demo data · not for decisions · ${DEMO_RELEASE}`,
  );
});

test("real status names the pilot and release", () => {
  assert.equal(
    describeDataStatus({ mode: "real", release: REAL_PILOT_RELEASE, connection: "online" }),
    `Real data · ${REAL_PILOT_RELEASE}`,
  );
});

test("offline status leads with offline in either mode", () => {
  assert.equal(
    describeDataStatus({ mode: "demo", release: DEMO_RELEASE, connection: "offline" }),
    `Offline · Demo data · not for decisions · ${DEMO_RELEASE}`,
  );
  assert.equal(
    describeDataStatus({ mode: "real", release: REAL_PILOT_RELEASE, connection: "offline" }),
    `Offline · Real data · ${REAL_PILOT_RELEASE}`,
  );
});

test("the public status keeps the demo warning and offline, never the release", () => {
  assert.equal(describePublicDataStatus({ mode: "demo", connection: "online" }), "Demo data · not for decisions");
  assert.equal(describePublicDataStatus({ mode: "real", connection: "online" }), null);
  assert.equal(describePublicDataStatus({ mode: "real", connection: "offline" }), "Offline");
  assert.equal(describePublicDataStatus({ mode: "demo", connection: "offline" }), "Offline · Demo data · not for decisions");
});
