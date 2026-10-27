import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

/** The box index of a map piece (lib/area-boxes.ts): a carrier, a chunk and the release it was built for. */
const PARAMETERS = ["carrier", "chunk", "v"] as const;

export async function GET(request: NextRequest) {
  if (!evidenceServiceUrl()) return NextResponse.json({ error: "real-boxes-unavailable" }, { status: 404 });
  const query = new URLSearchParams();
  for (const name of PARAMETERS) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) query.set(name, value);
  }
  const upstream = await fetchEvidence<unknown>(`/api/v1/areas/boxes?${query}`, request);
  return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
}
