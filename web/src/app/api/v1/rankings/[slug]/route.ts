import { NextResponse } from "next/server";

import { buildRanking, rankingBySlug, availableRankings } from "@/lib/area-pages";
import { loadAreaPages } from "@/lib/area-pages-data";
import type { Carrier, GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { areaGeoJson } from "@/lib/fixtures";
import { boxCenter, RANKING_TOP_SIZE, type RankingTopResponse } from "@/lib/ranking-top";

interface Context { params: Promise<{ slug: string }> }

/**
 * GET /api/v1/rankings/{slug}: a ranking's top 10 for the map (CUJ-05/10 "On map ↗"), the same rows and figures
 * as /rankings/{slug}, each with where to pin it (the API's area centre; the demo shapes' middle). Public data only.
 */
export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  const ranking = rankingBySlug(slug);
  if (!ranking || ranking.kind === "school") return NextResponse.json({ error: "unknown-ranking" }, { status: 404 });
  const loaded = await loadAreaPages();
  if (!loaded) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!availableRankings(loaded.index).includes(ranking)) return NextResponse.json({ error: "unknown-ranking" }, { status: 404 });
  const { rows } = buildRanking(loaded.index, ranking, RANKING_TOP_SIZE);
  const ids = rows.map((row) => row.area.geographyId);
  const centers = loaded.mode === "demo" || !evidenceServiceUrl() ? demoCenters(ranking.level as Carrier) : await realCenters(ids, request);
  const body: RankingTopResponse = {
    schemaVersion: "ranking-top.v1", slug: ranking.slug, title: ranking.title,
    rows: rows.map((row) => ({
      rank: row.rank, geographyId: row.area.geographyId, name: row.name, display: row.display, center: centers[row.area.geographyId] ?? null,
    })),
  };
  return NextResponse.json(body, { headers: { "cache-control": "public, max-age=300" } });
}

function demoCenters(carrier: Carrier): Record<string, [number, number]> {
  return Object.fromEntries(areaGeoJson(carrier).features.flatMap((feature) => {
    const center = boxCenter(feature.geometry.coordinates);
    return center ? [[feature.properties.geography_id, center]] : [];
  }));
}

async function realCenters(ids: GeographyId[], request: Request): Promise<Record<string, [number, number]>> {
  if (!ids.length) return {};
  try {
    const upstream = await fetchEvidence<{ centers?: Record<string, [number, number]> }>(
      `/api/v1/areas/names?ids=${encodeURIComponent(ids.join(","))}`, request);
    return upstream.status === 200 && upstream.body && typeof upstream.body === "object" ? upstream.body.centers ?? {} : {};
  } catch {
    // No centres: the card still lists the ten, only the pins wait.
    return {};
  }
}
