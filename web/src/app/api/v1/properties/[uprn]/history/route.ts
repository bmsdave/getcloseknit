import { NextResponse } from "next/server";

import { evidenceServiceUrl } from "@/lib/evidence-service";
import { getPropertyHistory } from "@/lib/fixtures";

interface Context {
  params: Promise<{ uprn: string }>;
}

export async function GET(_: Request, context: Context) {
  const { uprn } = await context.params;
  // Real mode: sale history comes from /api/v1/addresses/{id}/history; the
  // preview dossier fixtures must never answer for a real UPRN.
  if (evidenceServiceUrl()) return NextResponse.json({ error: "property-not-found" }, { status: 404 });
  const history = getPropertyHistory(uprn);
  if (!history) return NextResponse.json({ error: "property-not-found" }, { status: 404 });
  return NextResponse.json({ schemaVersion: "property-history.v1", history });
}
