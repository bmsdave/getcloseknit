import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

/** The link from the confirmation e-mail lands here; people are sent on to the privacy page. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const outcome = evidenceServiceUrl()
    ? await fetchEvidence<unknown>(`/api/v1/objections/confirm?token=${encodeURIComponent(token)}`, request)
    : { status: token ? 200 : 404 };
  const fragment = outcome.status === 200 ? "confirmed" : "confirm-failed";
  // Behind a proxy the request origin is the container's bind address; the
  // public URL is what the person's browser must be sent to.
  const origin = (process.env.CLOSE_KNIT_PUBLIC_URL || "").replace(/\/+$/, "") || request.nextUrl.origin;
  return NextResponse.redirect(new URL(`/privacy#${fragment}`, origin), { status: 302 });
}
