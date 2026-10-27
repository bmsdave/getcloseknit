import { NextResponse } from "next/server";

import { readMatchJob } from "@/lib/match-jobs";

interface Context { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const response = readMatchJob(id);
  return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
}
