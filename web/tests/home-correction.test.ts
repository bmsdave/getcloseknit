import assert from "node:assert/strict";
import test from "node:test";

import { homeCorrectionBody, objectionOutcomeMessage, submissionState } from "../src/lib/correction-report";

const HOME = { uprn: "100023336956", addressId: "uk:addr:a1b2c3d4e5f6", productReleaseId: "rel-1", sourceReleaseId: "src-1" };

test("hide-my-home request carries the dwelling and the e-mail, nothing else", () => {
  const body = homeCorrectionBody({ kind: "privacy-objection", ...HOME, email: " Owner@Example.com ", description: "I live here" });
  assert.deepEqual(body, {
    kind: "privacy-objection", uprn: HOME.uprn, addressId: HOME.addressId,
    email: "Owner@Example.com", description: "I live here",
  });
  assert.throws(() => homeCorrectionBody({ kind: "privacy-objection", ...HOME, email: "nope" }), /e-mail/);
  assert.throws(() => homeCorrectionBody({ kind: "privacy-objection", email: "a@b.co" }), /select a home/);
});

test("data-error reports about a home are keyed by its UPRN and releases, no e-mail", () => {
  const body = homeCorrectionBody({ kind: "transformation-error", ...HOME, email: "a@b.co", description: "  " });
  assert.deepEqual(body, {
    kind: "transformation-error", observationId: "uprn:100023336956", productReleaseId: "rel-1", sourceReleaseId: "src-1",
  });
  assert.equal(homeCorrectionBody({ kind: "publisher-error", addressId: HOME.addressId }).observationId,
    "address:uk:addr:a1b2c3d4e5f6");
  assert.throws(() => homeCorrectionBody({ kind: "publisher-error" }), /observation or release id/);
});

test("HTTP outcomes map to the states the form renders", () => {
  assert.deepEqual(submissionState(200, { kind: "privacy-objection", id: 7, confirmationSent: true, confirmationChannel: "smtp" }),
    { status: "sent", kind: "privacy-objection", id: 7, confirmationSent: true, confirmationChannel: "smtp" });
  assert.deepEqual(submissionState(409, { detail: { error: "objection-exists" } }), { status: "already-hidden" });
  assert.deepEqual(submissionState(429, null), { status: "too-many" });
  assert.deepEqual(submissionState(400, { detail: { error: "invalid-objection", message: "invalid uprn" } }),
    { status: "invalid", message: "invalid uprn" });
  assert.deepEqual(submissionState(503, null), { status: "failed" });
});

test("the outcome copy matches the delivery channel and never overpromises", () => {
  const sent = (confirmationChannel: "smtp" | "webhook" | null) =>
    ({ status: "sent", kind: "privacy-objection", id: 1, confirmationSent: confirmationChannel !== null, confirmationChannel }) as const;
  assert.match(objectionOutcomeMessage(sent("smtp")), /Check your inbox/);
  assert.match(objectionOutcomeMessage(sent("webhook")), /queued.*e-mail you the confirmation link/);
  assert.match(objectionOutcomeMessage(sent(null)), /could not be sent.*pending/);
});
