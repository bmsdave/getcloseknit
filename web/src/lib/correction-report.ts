/**
 * Minimal correction-report preparation (AE-32).
 *
 * A report carries only provenance identifiers already shown in the evidence
 * panel (observation, product release, source release), a publisher vs
 * transformation kind, and an optional description. It structurally cannot
 * include the raw search profile or destinations: unknown fields are dropped
 * instead of echoed.
 */

export type CorrectionKind = "publisher-error" | "transformation-error";
export type CorrectionRoute = "publisher" | "transformation";

export interface CorrectionInput {
  observationId?: string;
  productReleaseId?: string;
  sourceReleaseId?: string;
  kind: CorrectionKind;
  description?: string;
}

export interface CorrectionReport {
  status: "received";
  kind: CorrectionKind;
  route: CorrectionRoute;
  observationId?: string;
  productReleaseId?: string;
  sourceReleaseId?: string;
  description?: string;
}

const ROUTES: Record<CorrectionKind, CorrectionRoute> = {
  "publisher-error": "publisher",
  "transformation-error": "transformation",
};

const ID_KEYS = ["observationId", "productReleaseId", "sourceReleaseId"] as const;

export function correctionRoute(kind: CorrectionKind): CorrectionRoute {
  return ROUTES[kind];
}

export function prepareCorrectionReport(input: CorrectionInput): CorrectionReport {
  if (!(input.kind in ROUTES)) {
    throw new Error(`correction kind must be publisher-error or transformation-error`);
  }
  const report: CorrectionReport = {
    status: "received",
    kind: input.kind,
    route: ROUTES[input.kind],
  };
  let identified = false;
  for (const key of ID_KEYS) {
    if (input[key]) {
      report[key] = input[key];
      identified = true;
    }
  }
  if (!identified) {
    throw new Error("correction report needs an observation or release id");
  }
  const description = cleanDescription(input.description);
  if (description !== undefined) report.description = description;
  return report;
}

function cleanDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error("correction description must be text");
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 2000) {
    throw new Error("correction description must fit in 2000 characters");
  }
  return trimmed;
}

/**
 * Submission (AE-privacy): every report — data error or hide-my-home — goes
 * through the same POST. The response is reduced to the states the form
 * renders, so the component never branches on raw HTTP.
 */
export type HomeCorrectionKind = CorrectionKind | "privacy-objection";

export interface HomeCorrectionInput {
  kind: HomeCorrectionKind;
  uprn?: string | null;
  addressId?: string | null;
  productReleaseId?: string | null;
  sourceReleaseId?: string | null;
  email?: string;
  description?: string;
}

export type ConfirmationChannel = "smtp" | "webhook" | null;

export type SubmissionState =
  | { status: "sent"; kind: HomeCorrectionKind; id: number; confirmationSent: boolean; confirmationChannel: ConfirmationChannel }
  | { status: "already-hidden" }
  | { status: "too-many" }
  | { status: "invalid"; message: string }
  | { status: "failed" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function homeCorrectionBody(input: HomeCorrectionInput): Record<string, unknown> {
  const body: Record<string, unknown> = { kind: input.kind };
  if (input.kind === "privacy-objection") {
    if (!input.uprn && !input.addressId) throw new Error("select a home first");
    const email = input.email?.trim() ?? "";
    if (!EMAIL.test(email)) throw new Error("enter the e-mail address we should send the confirmation link to");
    if (input.uprn) body.uprn = input.uprn;
    if (input.addressId) body.addressId = input.addressId;
    body.email = email;
  } else {
    // Data-error reports are keyed by the observation (the dwelling) and its releases.
    body.observationId = input.uprn ? `uprn:${input.uprn}` : input.addressId ? `address:${input.addressId}` : undefined;
    if (input.productReleaseId) body.productReleaseId = input.productReleaseId;
    if (input.sourceReleaseId) body.sourceReleaseId = input.sourceReleaseId;
    if (!body.observationId && !body.productReleaseId && !body.sourceReleaseId) {
      throw new Error("correction report needs an observation or release id");
    }
  }
  const description = cleanDescription(input.description);
  if (description !== undefined) body.description = description;
  return body;
}

export function submissionState(status: number, body: unknown): SubmissionState {
  const detail = (body as { detail?: { error?: string; message?: string } } | null)?.detail;
  if (status === 200) {
    const sent = body as { kind: HomeCorrectionKind; id?: number; confirmationSent?: boolean; confirmationChannel?: ConfirmationChannel };
    return {
      status: "sent", kind: sent.kind, id: sent.id ?? 0,
      confirmationSent: sent.confirmationSent ?? false, confirmationChannel: sent.confirmationChannel ?? null,
    };
  }
  if (status === 409) return { status: "already-hidden" };
  if (status === 429) return { status: "too-many" };
  if (status === 400) return { status: "invalid", message: detail?.message ?? "The request was not valid." };
  return { status: "failed" };
}

export async function submitCorrection(body: Record<string, unknown>): Promise<SubmissionState> {
  try {
    const response = await fetch("/api/v1/corrections", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return submissionState(response.status, await response.json().catch(() => null));
  } catch {
    return { status: "failed" };
  }
}

/** What the person sees after a hide-my-home request, by delivery channel. */
export function objectionOutcomeMessage(state: Extract<SubmissionState, { status: "sent" }>): string {
  if (state.confirmationChannel === "smtp") {
    return "Check your inbox: the home is hidden as soon as you open the confirmation link.";
  }
  if (state.confirmationChannel === "webhook") {
    return "Request queued: we will e-mail you the confirmation link shortly; the home is hidden as soon as you open it.";
  }
  return "Request received but the confirmation e-mail could not be sent; the request stays pending until we confirm it by hand.";
}
