import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { addressId, type NearbySales } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { getNearbySales } from "@/lib/fixtures";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  let validated: string;
  try {
    validated = addressId(decodeURIComponent(id));
  } catch {
    return NextResponse.json({ error: "invalid-address-id" }, { status: 400 });
  }
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<NearbySales>(
      `/api/v1/addresses/${encodeURIComponent(validated)}/nearby-sales`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const nearby = getNearbySales(validated);
  if (!nearby) return NextResponse.json({ error: "address-not-found" }, { status: 404 });
  return NextResponse.json(nearby);
}
