import { fetchApi } from "./deployment";
import { evidenceServiceUrl } from "./evidence-service";
import type { SchoolPointsResponse } from "./map-school-layer";
import { previewSchoolPoints } from "./school-points-preview";
import { joinDirectory, type DirectorySchool, type SchoolIndexRow } from "./schools-hub";

interface SchoolIndexResponse {
  schemaVersion: "school-index.v1";
  schools: SchoolIndexRow[];
}

export interface SchoolDirectory {
  mode: "real" | "demo";
  schools: DirectorySchool[];
}

/** The two feeds change once a release: kept for a few minutes so /schools does not refetch them per view. */
const KEEP_MS = 10 * 60 * 1000;
let kept: { at: number; directory: SchoolDirectory } | null = null;

/**
 * /schools' open state schools (lib/schools-hub.ts joinDirectory): GET /api/v1/schools/index (borough) and
 * /api/v1/schools/points (Ofsted mark, top %); the preview schools (all in the Westminster preview borough)
 * without the API. Null when the index does not answer.
 */
export async function loadSchoolDirectory(now = Date.now()): Promise<SchoolDirectory | null> {
  if (!evidenceServiceUrl()) {
    const points = previewSchoolPoints();
    const index = points.map((point) => ({ urn: point.urn, name: point.name, phase: point.phase, borough: "Westminster", successorUrn: null, hasEvidence: true }));
    return { mode: "demo", schools: joinDirectory(index, points) };
  }
  if (kept && now - kept.at < KEEP_MS) return kept.directory;
  const [index, points] = await Promise.all([
    fetchApi<SchoolIndexResponse>("/api/v1/schools/index"),
    fetchApi<SchoolPointsResponse>("/api/v1/schools/points"),
  ]);
  if (index.body?.schemaVersion !== "school-index.v1") return null;
  const directory: SchoolDirectory = {
    mode: "real",
    schools: joinDirectory(index.body.schools, points.body?.schemaVersion === "school-points.v1" ? points.body.schools : []),
  };
  kept = { at: now, directory };
  return directory;
}
