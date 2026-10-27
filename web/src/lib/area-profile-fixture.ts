import { PROFILE_METRIC_IDS, type AreaLondonRanks, type AreaProfileResponse, type AreaSummary, type GeographyId } from "./contracts";
import { getAreaSchools, getAreaSummary, getMetric } from "./fixtures";

const SCHOOL_RADIUS = 1000;

/**
 * Demo London ranks for neighbourhoods: only the best nearby primary and secondary
 * (illustrative fixture schools, dataMode=demo), so the card's best-school rows and
 * their school links can be seen and tested. Every other rank stays null: "No rating".
 */
const DEMO_SCHOOL_RANKS: AreaLondonRanks = {
  scope: "london-lsoa",
  gettingAround: null,
  quiet: null,
  greenSpace: null,
  bestPrimary: {
    percentile: 88, higherIsBetter: true, value: 79, unit: "percent", ranked: 1265, sourceReleaseId: "demo",
    school: { urn: "100001", name: "Westminster Primary Preview", distanceMetres: null, academicYear: "2024/25" },
  },
  bestSecondary: {
    percentile: 93, higherIsBetter: true, value: 71, unit: "percent", ranked: 520, sourceReleaseId: "demo",
    school: { urn: "100002", name: "North London Secondary Preview", distanceMetres: null, academicYear: "2024/25" },
  },
  sources: [],
};

/** The demo profile: fixtures at each metric's latest period on or before `period`. */
export function fixtureAreaProfile(id: GeographyId, period: string): AreaProfileResponse | null {
  const metrics: AreaSummary[] = [];
  for (const metricId of PROFILE_METRIC_IDS) {
    const latest = getMetric(metricId).periods.filter((candidate) => candidate <= period).at(-1);
    const summary = latest ? getAreaSummary(id, metricId, latest) : null;
    if (summary && summary.value !== null) metrics.push(summary);
  }
  if (metrics.length === 0) return null;
  // Fixture schools carry no distance from the area: all count as nearby.
  const schools = getAreaSchools(metrics[0].geographyId)
    .filter((school) => school.status === "open" && (school.distanceMetres ?? 0) <= SCHOOL_RADIUS);
  return {
    schemaVersion: "area-profile.v1",
    geographyId: metrics[0].geographyId,
    name: metrics[0].name ?? null,
    metrics,
    schools: {
      primary: schools.filter((school) => school.phase === "primary").length,
      secondary: schools.filter((school) => school.phase === "secondary").length,
      radiusMetres: SCHOOL_RADIUS,
    },
    noise: null,
    // The demo ranks schools alone (above). A neighbourhood answered by its wider area (an MSOA)
    // still has a best primary and secondary, from the wider area's schools; boroughs have none.
    regionRanks: /^uk:(lsoa|msoa):/.test(metrics[0].geographyId) ? DEMO_SCHOOL_RANKS : null,
  };
}
