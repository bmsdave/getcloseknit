import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Nature (greenness, street trees, wildlife) is real-release evidence only; demo
// mode answers "not available" (a 404 would log a console error on every area).
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!evidenceServiceUrl()) return NextResponse.json({ available: false });
  const upstream = await fetchEvidence(
    `/api/v1/areas/${encodeURIComponent(id)}/nature${request.nextUrl.search}`,
    request,
  );
  return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
}
