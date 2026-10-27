import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { DEMO_RELEASE } from "@/lib/map-state";
import { unvalidatedForecast } from "@/lib/fixtures";

interface Context { params: Promise<{ id: string }> }

// Demo only: a real deployment publishes no forecast route (nothing calls it).
export async function GET(request: NextRequest, context: Context) {
  if (evidenceServiceUrl()) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const horizon = request.nextUrl.searchParams.get("horizon");
  if (horizon !== "1y" && horizon !== "5y") {
    return NextResponse.json({ error: "invalid-horizon" }, { status: 400 });
  }
  const { id } = await context.params;
  // No horizon has passed the predeclared validation gate yet (see
  // VALIDATED_FORECAST_HORIZONS): publish the failed gate, never a
  // fixture forecast.
  return NextResponse.json(
    unvalidatedForecast(
      decodeURIComponent(id) as GeographyId,
      horizon,
      request.nextUrl.searchParams.get("release") ?? DEMO_RELEASE,
    ),
  );
}
