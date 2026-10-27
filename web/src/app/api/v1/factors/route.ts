import { NextResponse } from "next/server";

import { FACTORS } from "@/lib/fixtures";

export function GET() {
  return NextResponse.json({ schemaVersion: "factor-definitions.v1", factors: FACTORS });
}
