import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { prepareCorrectionReport, type CorrectionInput } from "@/lib/correction-report";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Corrections and hide-my-home requests. Real mode forwards to the evidence
 * service with the caller's address (the API keys its daily objection limits
 * on it); demo mode answers with the prepared preview and never stores anything.
 */
export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ detail: { error: "invalid-correction-report", message: "body must be JSON" } },
      { status: 400, headers: PRIVATE_HEADERS });
  }
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<unknown>("/api/v1/corrections", request, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return NextResponse.json(upstream.body, { status: upstream.status, headers: { ...PRIVATE_HEADERS, ...upstream.headers } });
  }
  return NextResponse.json(demoResponse(payload), { status: 200, headers: PRIVATE_HEADERS });
}

function demoResponse(payload: Record<string, unknown>) {
  if (payload.kind === "privacy-objection") {
    return { status: "pending", kind: "privacy-objection", route: "privacy", id: 0,
      confirmationSent: false, notified: [], demo: true };
  }
  try {
    return { ...prepareCorrectionReport(payload as unknown as CorrectionInput), id: 0, notified: [], demo: true };
  } catch (error) {
    return { detail: { error: "invalid-correction-report", message: (error as Error).message } };
  }
}
