import { NextResponse } from "next/server";

import type { JourneyRequest } from "@/lib/contracts";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { buildPreviewJourney } from "@/lib/journeys";

const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  // Real mode: no routing network is loaded, so commute stays unavailable
  // rather than answering with the preview journey matrix.
  if (evidenceServiceUrl()) {
    return NextResponse.json({ error: "commute-routing-unavailable" }, { status: 503, headers: PRIVATE_HEADERS });
  }
  try {
    const journey = await request.json() as JourneyRequest;
    return NextResponse.json(buildPreviewJourney(journey), { headers: PRIVATE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid journey" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
}
