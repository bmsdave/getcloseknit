import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Health (heat, GP access; air once licensed) is real-release evidence only; demo
// mode has nothing to answer here.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!evidenceServiceUrl()) return NextResponse.json({ error: "health-unavailable" }, { status: 404 });
  const upstream = await fetchEvidence(
    `/api/v1/areas/${encodeURIComponent(id)}/health${request.nextUrl.search}`,
    request,
  );
  return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
}
