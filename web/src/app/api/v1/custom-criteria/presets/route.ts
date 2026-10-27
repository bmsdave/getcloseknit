import { NextResponse } from "next/server";

import { PLACES_NOT_PEOPLE } from "@/lib/custom-criteria";
import { CUSTOM_PRESETS } from "@/lib/custom-presets";

// The same list the API serves (api/area_api/fixtures/custom-presets.json); static, so served here.
export function GET() {
  return NextResponse.json({ schemaVersion: "custom-criterion-presets.v1", presets: CUSTOM_PRESETS, caveats: [PLACES_NOT_PEOPLE] },
    { headers: { "Cache-Control": "public, max-age=3600" } });
}
