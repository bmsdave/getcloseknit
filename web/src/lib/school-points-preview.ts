import type { SchoolSummary } from "./contracts";
import { SCHOOLS } from "./fixtures";
import type { SchoolPoint } from "./map-school-layer";
import type { OfstedMark } from "./school-icons";

const LEGACY: Readonly<Record<string, OfstedMark>> = {
  Outstanding: "outstanding", Good: "good", "Requires improvement": "requires-improvement", Inadequate: "inadequate",
};

/** The preview's results as the point's measures (Schools filter v2): a primary's attainment stands for KS2,
 * a secondary's for Grade 5+ English and maths, its progress for Progress 8. Illustrative, like every preview value. */
function previewMeasures(school: SchoolSummary): SchoolPoint["measures"] {
  const measures: NonNullable<SchoolPoint["measures"]> = {};
  for (const o of school.observations) {
    if (o.kind !== "performance" || typeof o.value !== "number" || o.suppressed) continue;
    if (o.measure === "attainment") measures[school.phase === "primary" ? "ks2RwmExpected" : "grade5EngMaths"] = [o.value, o.academicYear];
    if (o.measure === "progress" && school.phase === "secondary") measures.progress8 = [o.value, o.academicYear];
  }
  return Object.keys(measures).length ? measures : undefined;
}

/** A preview school as the API's point (lib/fixtures.ts): no rank or census in the preview. */
function previewPoint(school: SchoolSummary): SchoolPoint {
  const measures = previewMeasures(school);
  const legacy = school.observations.find((o) => o.kind === "inspection-legacy" && typeof o.value === "string");
  const ofsted = school.inspectionFramework === "report-card" ? "report-card" : LEGACY[String(legacy?.value ?? "")];
  const allThrough = school.ageRange.from < 10 && school.ageRange.to >= 16;
  return {
    urn: school.urn, name: school.name, phase: school.phase, latitude: school.latitude, longitude: school.longitude,
    kind: "state", stage: allThrough ? "all-through" : school.phase,
    ...(ofsted ? { ofsted } : {}), ...(school.selectivity === "Selective" ? { selective: true } : {}),
    ...(school.faith ? { faith: school.faith } : {}), ...(school.ageRange.to > 16 && school.phase === "secondary" ? { sixthForm: true } : {}),
    ...(school.gender === "Girls" || school.gender === "Boys" ? { intake: school.gender } : {}),
    ...(measures ? { measures } : {}),
  };
}

/** A preview private school (GIAS independent, migration 067): no Ofsted badge, no rank. */
const PREVIEW_INDEPENDENT: SchoolPoint = {
  urn: "100009", name: "Hyde Park Independent Preview", phase: "secondary", latitude: 51.509, longitude: -0.163,
  kind: "independent", stage: "all-through", sixthForm: true, intake: "Girls",
};

/** Preview mode's open schools as map points (Show › Schools, /schools): state ones, then the private one. */
export function previewSchoolPoints(): SchoolPoint[] {
  const schools = SCHOOLS.filter((school) => school.status === "open" && school.latitude !== null && school.longitude !== null)
    .map(previewPoint);
  return [...schools, PREVIEW_INDEPENDENT];
}
