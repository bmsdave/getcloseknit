import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { previewCustomPack } from "@/lib/custom-criteria";
import { CUSTOM_PRESETS } from "@/lib/custom-presets";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context {
  params: Promise<{ id: string }>;
}

/** A ready-made criterion's pack (custom:<id> on the map): the same for everyone, so a cacheable GET. */
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const preset = CUSTOM_PRESETS.find((entry) => entry.criterion.id === id);
  if (!preset) return NextResponse.json({ error: "preset-not-found" }, { status: 404 });
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence(`/api/v1/custom-criteria/presets/${encodeURIComponent(id)}/pack${request.nextUrl.search}`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  return NextResponse.json(previewCustomPack(preset.criterion), { headers: { "Cache-Control": "public, max-age=300" } });
}
