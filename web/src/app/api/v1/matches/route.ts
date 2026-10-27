import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertPreferenceProfile, assertPreferenceProfileV2, type PreferenceProfile, type PreferenceProfileV2 } from "@/lib/contracts";
import { clientHeaders, evidenceServiceUrl } from "@/lib/evidence-service";
import { createMatchRequest } from "@/lib/match-jobs";
import { matchRequestProfile } from "@/lib/profile-state";

const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  // Only a body that is not a preference profile is the caller's error (400). An API that cannot be reached or
  // answers garbage is ours (502): the client then says it is offline instead of dropping the search silently.
  let profile: PreferenceProfile | PreferenceProfileV2;
  try {
    // preference-profile.v1 (the current panel) or v2 (ordered criteria).
    const body = await request.json() as PreferenceProfile | PreferenceProfileV2;
    profile = body.schemaVersion === "preference-profile.v2" ? assertPreferenceProfileV2(body) : assertPreferenceProfile(body);
  } catch {
    return NextResponse.json({ error: "invalid-preference-profile" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  if (!evidenceServiceUrl()) {
    const response = createMatchRequest(profile);
    return NextResponse.json(response.body, { status: response.status, headers: PRIVATE_HEADERS });
  }
  try {
    const upstream = await fetch(`${evidenceServiceUrl()}/api/v1/matches${request.nextUrl.search}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", ...clientHeaders(request.headers) },
      body: JSON.stringify(profile.schemaVersion === "preference-profile.v2" ? profile : matchRequestProfile(profile)),
      signal: request.signal,
    });
    if (request.signal.aborted) return NextResponse.json({ error: "request-aborted" }, { status: 499, headers: PRIVATE_HEADERS });
    if (!upstream.ok) {
      const body = (await upstream.json().catch(() => ({ error: "match-service-unavailable" }))) as { error?: string };
      return NextResponse.json(body, { status: upstream.status, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json(await upstream.json(), { status: upstream.status, headers: PRIVATE_HEADERS });
  } catch {
    if (request.signal.aborted) return NextResponse.json({ error: "request-aborted" }, { status: 499, headers: PRIVATE_HEADERS });
    return NextResponse.json({ error: "match-service-unavailable" }, { status: 502, headers: PRIVATE_HEADERS });
  }
}
