/**
 * Demo school cards (school-card.v1) for the preview schools in fixtures.ts: made-up figures,
 * labelled demo on the page, never shown with the API. The primary has no Parent View (its section says
 * "No data") and Destinations as secondary schools its Year 6 pupils went to; the secondary has every section, its
 * Parent View from the earlier survey and no borough medians (fewer than 10 schools, as for a small borough). One primary under the report-card framework and one secondary with a
 * legacy grade that earns the Top school badge, so every part of the card renders without the API.
 */
import { SCHOOLS } from "./fixtures";
import type {
  CompareKey, CompareMeasure, LastOffered, NationalRankPoint, ProfileFigure, SchoolCard, SchoolCompare, SchoolDemand, SchoolInspection, SchoolMeasure,
  SchoolLinks, SchoolProfile, SchoolSeriesPoint,
} from "./school-card";

const OGL = "Contains public sector information licensed under the Open Government Licence v3.0.";
const OFSTED_ATTRIBUTION = "Ofsted inspection report extracts, Crown copyright, licensed under the Open Government Licence v3.0.";
const PREVIEW_REPORT = "https://reports.ofsted.gov.uk/";

const series = (rows: [string, number | null, number | null, boolean?][]): SchoolSeriesPoint[] =>
  rows.map(([academicYear, value, cohortSize, suppressed]) => ({ academicYear, value, cohortSize, suppressed: Boolean(suppressed) }));

const measure = (id: string, label: string, unit: string | null, rows: [string, number | null, number | null, boolean?][]): SchoolMeasure =>
  ({ id, label, unit, series: series(rows) });

const RESULT_YEARS = ["2015/16", "2016/17", "2017/18", "2018/19", "2021/22", "2022/23", "2023/24", "2024/25"];
const medianRows = (values: number[], poolSize: number) =>
  RESULT_YEARS.slice(RESULT_YEARS.length - values.length).map((academicYear, index) => ({ academicYear, value: values[index], poolSize }));

const PRIMARY_INSPECTIONS: SchoolInspection[] = [
  {
    inspectionNumber: "P-2026-1", inspectedUrn: "100001", startDate: "2026-02-03", publicationDate: "2026-03-10",
    inspectionType: "Report card inspection", framework: "report-card-2025", overall: null, reportUrl: PREVIEW_REPORT,
    judgements: {
      "Inclusion": "Strong standard", "Curriculum and teaching": "Expected standard", "Achievement": "Expected standard",
      "Attendance and behaviour": "Strong standard", "Personal development and well-being": "Exceptional",
      "Leadership and governance": "Strong standard", "Early years": "Expected standard", "Safeguarding standards": "Met",
    },
    keyFindings: "Preview: pupils are proud of their school and keen to learn. Leaders have set out what pupils should learn from the early years onwards. Pupils behave calmly and treat each other kindly.",
    improveText: "Preview: in a few subjects, teachers do not check closely enough what pupils remember. Reading books are not always matched to the sounds pupils know.",
  },
  {
    inspectionNumber: "P-2021-1", inspectedUrn: "100003", startDate: "2021-11-09", publicationDate: "2021-12-14",
    inspectionType: "S5 Inspection", framework: "eif-2019", overall: 2, reportUrl: PREVIEW_REPORT,
    judgements: { "Quality of education": 2, "Behaviour and attitudes": 2, "Personal development": 1, "Effectiveness of leadership and management": 2, "Safeguarding is effective": "Yes" },
  },
  {
    inspectionNumber: "P-2016-1", inspectedUrn: "100003", startDate: "2016-06-15", publicationDate: "2016-07-12",
    inspectionType: "S5 Inspection", framework: "cif-2015", overall: 3, reportUrl: PREVIEW_REPORT, judgements: {},
  },
];

const SECONDARY_INSPECTIONS: SchoolInspection[] = [
  {
    inspectionNumber: "S-2023-1", inspectedUrn: "100002", startDate: "2023-05-16", publicationDate: "2023-06-20",
    inspectionType: "S5 Inspection", framework: "eif-2019", overall: 2, reportUrl: PREVIEW_REPORT,
    judgements: { "Quality of education": 2, "Behaviour and attitudes": 1, "Personal development": 1, "Effectiveness of leadership and management": 2, "Sixth form provision (where applicable)": 1, "Safeguarding is effective": "Yes" },
    keyFindings: "Preview: pupils work hard and expect a lot of themselves. The sixth form is a real strength of the school. Pupils say that bullying is rare and dealt with quickly.",
    improveText: "Preview: the curriculum in a few subjects is not yet as well planned as in the rest of the school.",
  },
  {
    inspectionNumber: "S-2019-1", inspectedUrn: "100002", startDate: "2019-01-22", publicationDate: "2019-02-26",
    inspectionType: "Section 8 inspection of good and outstanding schools", framework: "eif-2019", overall: null, reportUrl: PREVIEW_REPORT,
    judgements: { "Outcomes for ungraded and monitoring inspections": "School remains Good", "Safeguarding is effective": "Yes" },
  },
];

const offered = (council: string, entryPoint: string, rows: [string, number | null, boolean?][]): LastOffered[] => rows.map(([academicYear, distanceMetres, allOffered]) => ({
  academicYear, entryPoint, site: "main", council, licence: "OGL-3.0",
  attribution: `Source: ${council}, ${academicYear}. ${OGL}`,
  sourceUrl: "https://www.westminster.gov.uk/school-admissions",
  reuseConfirmed: true, measurementMethod: "straight-line", distanceMetres, allOffered: allOffered ?? null,
  rules: [{ rule: entryPoint, criterion: null, distanceMetres, rawValue: distanceMetres === null ? null : String(distanceMetres), allOffered: allOffered ?? null }],
}));

/** Visit & links as the API builds them (school_links.py); the demo has no real website or phone. */
function demoLinks(urn: string, council: string, phase: "primary" | "secondary", host: string | null): SchoolLinks {
  const go = (target: string) => ({ href: `/go/school-${target}?urn=${urn}&from=web`, portal: `school-${target}` });
  return {
    website: host ? { ...go("website"), host } : null,
    admissions: { ...go("admissions"), via: host ? "website" : "council" },
    phone: host ? { href: "tel:+442000000000", number: "020 0000 0000" } : null,
    ofstedReport: go("ofsted"), dfePerformance: go("dfe-performance"), parentView: go("parent-view"),
    councilAdmissions: { ...go("council-admissions"), council, phase }, gias: go("gias"), eAdmissions: go("eadmissions"),
    goodSchoolsGuide: go("gsg"), locrating: go("locrating"),
  };
}

const SOURCES = [
  { id: "preview-dfe-performance", licence: "OGL-3.0", attribution: `Department for Education, Compare school and college performance (preview). ${OGL}`, caveats: [] },
  { id: "preview-ofsted", licence: "OGL-3.0", attribution: `Ofsted, state-funded school inspections and outcomes (preview). ${OGL}`, caveats: [] },
  { id: "preview-council-admissions", licence: "OGL-3.0", attribution: `Westminster City Council, how places were offered (preview). ${OGL}`, caveats: [] },
];

const POOL = "England's state-funded mainstream schools with a published figure that year (preview)";
const rankHistory = (rows: [string, number, number][]): NationalRankPoint[] => rows.map(([academicYear, rank, total]) => ({
  academicYear, rank, total, topPercent: Math.ceil((rank / total) * 100), value: 0, tiebreakValue: null, rankedUrn: "", sourceRelease: "preview",
}));
const figure = (measure: string, label: string, value: number | null, academicYear = "2024/25"): ProfileFigure =>
  ({ measure, label, value, suppressed: value === null, academicYear, sourceRelease: "preview" });
const profile = (gender: "Mixed" | "Girls" | "Boys", capacity: number, pupils: number, figures: (number | null)[], perTeacher: number): SchoolProfile => ({
  gias: { gender, trust: null, capacity, pupils, censusDate: "2026-01-15", percentFull: Number(((pupils / capacity) * 100).toFixed(1)), sourceRelease: "preview" },
  girlsPercent: figure("census-girls-percent", "Girls on roll (%)", figures[0]),
  boysPercent: figure("census-boys-percent", "Boys on roll (%)", figures[1]),
  fsm6Percent: figure("census-fsm6-percent", "FSM in the past 6 years (%)", figures[2]),
  ealPercent: figure("census-eal-percent", "First language not English (%)", figures[3]),
  senSupportPercent: figure("census-sen-support-percent", "SEN support (%)", figures[4]),
  ehcpPercent: figure("census-ehcp-percent", "EHC plan (%)", figures[5]),
  overallAbsencePercent: figure("absence-overall-percent", "Overall absence (%)", figures[6]),
  persistentAbsencePercent: figure("absence-persistent-percent", "Persistent absentees (%)", figures[7]),
  pupilsPerTeacher: { value: perTeacher, academicYear: "2025/26", sourceRelease: "preview" },
});
const demandYear = (entryPoint: string, entryYear: number, first: number, firstOffers: number, rest: Partial<SchoolDemand> = {}): SchoolDemand => ({
  entryYear, entryPoint, firstPreferences: first, anyPreferences: null, offers: null, firstPreferenceOffers: firstOffers, pan: null,
  applicationsPerPlace: null, firstPreferencesPerPlace: null, applicationsPerOffer: null, missingReason: null,
  firstChoiceNotOfferedPercent: Number((100 * (1 - firstOffers / first)).toFixed(1)), ...rest,
});
const OVERSUBSCRIBED = "First-choice applications not offered a place on national offer day (preview).";
const WORKFORCE_DEFINITIONS = { pupilsPerAdult: "DfE: FTE pupils ÷ FTE teachers, teaching assistants, other school support staff and technicians; administrative, auxiliary and business staff are not counted" };
const NOT_COMPARABLE = "CFR (maintained schools) and AAR (academies) are different accounts and years: do not compare them.";

/** Preview comparisons: [key, unit, value, year, [London p10, median, p90], borough median or null, betterWhen, accounts]. */
type CompareRowSpec = [CompareKey, CompareMeasure["unit"], number, string, [number, number, number], number | null, ("lower" | null)?, ("CFR" | "AAR")?];
const ACCOUNTS_NOTE = { CFR: "Compared only with maintained schools' accounts (CFR), same financial year", AAR: "Compared only with academies' accounts (AAR), same academic year" };
const compare = (phase: SchoolCompare["phase"], borough: string, rows: CompareRowSpec[]): SchoolCompare => ({
  phase, pool: "London state schools in Close Knit with a published figure, same phase and year (preview)",
  method: "10th, 50th and 90th percentiles (preview)", minBoroughSchools: 10,
  measures: Object.fromEntries(rows.map(([key, unit, value, year, [p10, median, p90], boroughMedian, betterWhen, accounts]) => [key, {
    label: key, unit, value, year, london: { p10, median, p90, n: 1700 }, borough: boroughMedian === null ? null : { name: borough, median: boroughMedian, n: 40 },
    betterWhen: betterWhen ?? null, sourceRelease: "preview", ...(accounts ? { accounts, accountsNote: ACCOUNTS_NOTE[accounts] } : {}),
  }])),
});

function primaryCard(): SchoolCard {
  const school = SCHOOLS.find((candidate) => candidate.urn === "100001")!;
  const measures = [
    measure("ks2-rwm-expected", "Expected standard in reading, writing and maths (%)", "percent",
      [["2015/16", 58, 52], ["2016/17", 63, 55], ["2017/18", 66, 56], ["2018/19", 70, 57], ["2022/23", 74, 58], ["2023/24", null, 9, true], ["2024/25", 79, 58]]),
    measure("ks2-rwm-higher", "Higher standard in reading, writing and maths (%)", "percent",
      [["2015/16", 6, 52], ["2016/17", 9, 55], ["2017/18", 11, 56], ["2018/19", 13, 57], ["2022/23", 14, 58], ["2023/24", null, 9, true], ["2024/25", 17, 58]]),
    measure("ks2-reading-score", "Average reading scaled score", "score",
      [["2018/19", 105, 57], ["2022/23", 106, 58], ["2024/25", 107, 58]]),
    measure("ks2-maths-score", "Average maths scaled score", "score",
      [["2018/19", 104, 57], ["2022/23", 105, 58], ["2024/25", 108, 58]]),
    measure("pupils", "Pupils on roll", "pupils",
      [["2018/19", 382, null], ["2019/20", 390, null], ["2020/21", 398, null], ["2021/22", 401, null], ["2022/23", 405, null], ["2023/24", 409, null], ["2024/25", 412, null]]),
  ];
  return {
    schemaVersion: "school-card.v1", productReleaseId: "preview", urn: school.urn, areaId: "uk:lsoa:E01000001",
    school,
    details: { localAuthority: "Westminster", postcode: "SW1A 2AA", sixthForm: "Does not have a sixth form", pupils: 412, predecessorUrn: "100003", successorUrn: null },
    history: { schemaVersion: "school-history.v1", urn: school.urn, measures, inspections: PRIMARY_INSPECTIONS, demand: [], distances: [], sources: SOURCES },
    percentiles: {},
    regionMedian: {
      "ks2-rwm-expected": medianRows([61, 69, 72, 73, 68, 70, 72], 1265),
      "ks2-rwm-higher": medianRows([7, 11, 12, 13, 10, 11, 12], 1265),
      "ks2-reading-score": medianRows([106, 106, 107], 1265),
      "ks2-maths-score": medianRows([106, 106, 107], 1265),
    },
    pool: { description: "London state primaries, same year, cohort 30+, suppressed figures left out", minCohort: 30 },
    kpis: [
      { measure: "ks2-rwm-expected", label: "Expected standard, RWM", valueText: "79%", value: 79, cohortSize: 58, percentile: 81, score10: 8.1, trend: { direction: "up", deltaPoints: 12, fromYear: "2018/19" }, year: "2024/25", basis: "vs 1,265 London primaries, cohort 30+", regionMedian: 72, missingReason: null, note: null },
      { measure: "ks2-rwm-higher", label: "Higher standard, RWM", valueText: "17%", value: 17, cohortSize: 58, percentile: 77, score10: 7.7, trend: { direction: "flat", deltaPoints: 2, fromYear: "2018/19" }, year: "2024/25", basis: "vs 1,265 London primaries, cohort 30+", regionMedian: 12, missingReason: null, note: null },
      { measure: "ks2-reading-score", label: "Reading score", valueText: "107", value: 107, cohortSize: 58, percentile: 52, score10: 5.2, trend: null, year: "2024/25", basis: "vs 1,265 London primaries, cohort 30+", regionMedian: 107, missingReason: null, note: null },
      { measure: "ks2-maths-score", label: "Maths score", valueText: "108", value: 108, cohortSize: 58, percentile: 66, score10: 6.6, trend: null, year: "2024/25", basis: "vs 1,265 London primaries, cohort 30+", regionMedian: 107, missingReason: null, note: null },
    ],
    topBadge: school.topBadge!,
    tldr: {
      strengths: ["Preview: pupils are proud of their school and keen to learn.", "Leaders have set out what pupils should learn from the early years onwards.", "Pupils behave calmly and treat each other kindly."],
      improve: ["Preview: in a few subjects, teachers do not check closely enough what pupils remember.", "Reading books are not always matched to the sounds pupils know."],
      inspectionDate: "2026-02-03", publicationDate: "2026-03-10", reportUrl: PREVIEW_REPORT,
      label: "From Ofsted report, 2026-03-10", inspectedAsPredecessor: false, inspectedUrn: "100001", attribution: OFSTED_ATTRIBUTION,
    },
    parentView: null,
    admissions: {
      demand: [{ entryYear: 2026, entryPoint: "reception", firstPreferences: 96, anyPreferences: 274, offers: 60, firstPreferenceOffers: 55, pan: null, applicationsPerPlace: null, firstPreferencesPerPlace: null, applicationsPerOffer: 4.57, missingReason: "No published admission number" }],
      lastOffered: offered("Westminster City Council", "reception", [["2026/27", 640], ["2025/26", 712], ["2024/25", 590], ["2023/24", null, true], ["2022/23", 805]]),
      byYear: [
        demandYear("reception", 2026, 96, 55, { anyPreferences: 274, offers: 60, secondPreferences: 70, thirdPreferences: 48, secondPreferenceOffers: 4, thirdPreferenceOffers: 1 }),
        demandYear("reception", 2025, 90, 58), demandYear("reception", 2024, 84, 60), demandYear("reception", 2023, 70, 60),
      ],
      oversubscriptionDefinition: OVERSUBSCRIBED,
    },
    nationalRank: {
      rank: 2950, total: 15057, topPercent: 20, year: "2024/25", measure: "KS2: % meeting the expected standard in reading, writing and maths (preview)",
      measureId: "ks2-rwm-expected", value: 79, tiebreakValue: 17, rankedUrn: "100001", sourceRelease: "preview",
      line: "Ranked 2,950 of 15,057 primaries in England, 2024/25 (top 20%)", missingReason: null, pool: POOL,
      history: rankHistory([["2016/17", 6900, 14633], ["2017/18", 5600, 14756], ["2018/19", 4300, 14850], ["2022/23", 3500, 14980], ["2024/25", 2950, 15057]]),
    },
    profile: profile("Mixed", 420, 412, [49.5, 50.5, 31.2, 44.8, 13.1, 2.4, 4.6, 9.8], 20.6),
    inspectionCounts: {
      framework: "report-card", graded: 7, strengths: 4, weaknesses: 0,
      strengthAreas: ["Inclusion", "Attendance and behaviour", "Personal development and well-being", "Leadership and governance"], weaknessAreas: [],
      safeguarding: "Met", improvePoints: 2, inspectionDate: "2026-02-03", publicationDate: "2026-03-10", reportUrl: PREVIEW_REPORT,
      inspectedUrn: "100001", inspectedAsPredecessor: false, definition: "Areas graded Exceptional or Strong, and Needs attention or Urgent improvement (preview).",
    },
    workforce: {
      academicYear: "2025/26", teachersFte: 20, teachingAssistantsFte: 9.5, leadershipFte: 3, supportStaffFte: 12.4, workforceFte: 32.4,
      workforceHeadcount: 38, teachersHeadcount: 22, pupilsFte: 412, pupilsPerTeacher: 20.6, pupilsPerAdult: 12.7,
      definitions: WORKFORCE_DEFINITIONS, sourceRelease: "preview",
    },
    finance: {
      accounts: "CFR", accountsLabel: "Maintained school accounts (CFR)", period: "2025-26", periodLabel: "April 2025 to March 2026", periodMonths: 12,
      partialYear: false, pupilsFte: 412, revenueReserve: 251000, revenueReservePerPupil: 609, inDeficit: false, inYearBalance: 18000,
      totalIncome: 3050000, totalExpenditure: 3032000, incomePerPupil: { grants: 6950, selfGenerated: 453, total: 7403 },
      spendPerPupil: { staff: 5210, premises: 690, total: 7359 }, missingReason: null, trust: null, federation: null,
      perPupilDefinition: "Published total ÷ FTE pupils in the same return (preview).", notComparable: NOT_COMPARABLE, sourceRelease: "preview",
    },
    destinations: null,
    compare: compare("primary", "Westminster", [
      ["pupils", "count", 412, "2026-01-15", [181, 366, 641], 300], ["fsm6Percent", "percent", 31.2, "2024/25", [8.9, 28.3, 51.9], 40.1],
      ["ealPercent", "percent", 44.8, "2024/25", [19.4, 44.5, 77.6], 61.2], ["senSupportPercent", "percent", 13.1, "2024/25", [7.8, 13.6, 21.9], 14.9],
      ["ehcpPercent", "percent", 2.4, "2024/25", [1.8, 3.8, 7.9], 3.5], ["overallAbsencePercent", "percent", 4.6, "2024/25", [3.8, 5.2, 7.1], 5.4, "lower"],
      ["persistentAbsencePercent", "percent", 9.8, "2024/25", [6.3, 13.6, 23.2], 15.2, "lower"],
      ["pupilsPerTeacher", "ratio", 20.6, "2025/26", [16, 20.2, 24.3], 18.1], ["pupilsPerAdult", "ratio", 12.7, "2025/26", [8.2, 10.9, 14.1], 9.9],
      ["incomePerPupil", "pounds", 7403, "2025-26", [7306, 8965, 11547], 10210, null, "CFR"], ["spendPerPupil", "pounds", 7359, "2025-26", [7321, 9039, 11841], 10340, null, "CFR"],
      ["staffSpendPerPupil", "pounds", 5210, "2025-26", [5467, 6657, 8732], 7420, null, "CFR"], ["reservePerPupil", "pounds", 609, "2025-26", [-1144, 334, 1359], 410, null, "CFR"],
      ["firstChoiceOfferedPercent", "percent", 57.29, "2026", [72.4, 100, 100], 96.4],
    ]),
    links: demoLinks("100001", "Westminster", "primary", "preview.example.org"),
    missing: [
      { measure: "ks2-reading-progress", reason: "Not published for 2023/24 or 2024/25" },
      { measure: "parent-view", reason: "Ofsted Parent View is not loaded" },
    ],
    sources: SOURCES,
  };
}

function secondaryCard(): SchoolCard {
  const school = SCHOOLS.find((candidate) => candidate.urn === "100002")!;
  const measures = [
    measure("ks4-attainment8", "Attainment 8", "score",
      [["2015/16", 52.1, 180], ["2016/17", 54.3, 182], ["2017/18", 55.0, 185], ["2018/19", 56.2, 190], ["2021/22", 60.4, 192], ["2022/23", 59.1, 195], ["2023/24", 60.8, 196], ["2024/25", 61.5, 198]]),
    measure("ks4-em-grade5", "Grade 5+ in English and maths (%)", "percent",
      [["2016/17", 55, 182], ["2017/18", 58, 185], ["2018/19", 60, 190], ["2021/22", 68, 192], ["2022/23", 66, 195], ["2023/24", 69, 196], ["2024/25", 71, 198]]),
    measure("ks4-progress8", "Progress 8", "progress",
      [["2016/17", 0.31, 182], ["2017/18", 0.35, 185], ["2018/19", 0.42, 190], ["2022/23", 0.51, 195], ["2023/24", 0.48, 196]]),
    measure("ks5-alevel-aps", "A level average point score per entry", "score",
      [["2018/19", 36.2, 110], ["2021/22", 40.5, 118], ["2022/23", 38.9, 120], ["2023/24", 39.4, 121], ["2024/25", 40.1, 124]]),
    measure("ks5-students", "Students aged 16-18 in the sixth form", "pupils", [["2023/24", 262, null], ["2024/25", 270, null]]),
    measure("pupils", "Pupils on roll", "pupils",
      [["2018/19", 1012, null], ["2019/20", 1030, null], ["2020/21", 1041, null], ["2021/22", 1055, null], ["2022/23", 1061, null], ["2023/24", 1068, null], ["2024/25", 1074, null]]),
  ];
  return {
    schemaVersion: "school-card.v1", productReleaseId: "preview", urn: school.urn, areaId: "uk:lsoa:E01000001",
    school,
    details: { localAuthority: "Islington", postcode: "N1 1AA", sixthForm: "Has a sixth form", pupils: 1074, predecessorUrn: null, successorUrn: null },
    history: { schemaVersion: "school-history.v1", urn: school.urn, measures, inspections: SECONDARY_INSPECTIONS, demand: [], distances: [], sources: SOURCES },
    percentiles: {},
    regionMedian: {
      "ks4-attainment8": medianRows([52.0, 49.3, 49.0, 49.5, 52.8, 50.6, 50.6, 50.2], 494),
      "ks4-em-grade5": medianRows([46, 47, 48, 55, 52, 52, 52], 494),
      "ks5-alevel-aps": medianRows([33.5, 37.9, 35.1, 34.7, 34.7], 352),
    },
    pool: { description: "London state secondaries, same year, cohort 30+, suppressed figures left out", minCohort: 30 },
    kpis: [
      { measure: "ks4-attainment8", label: "Attainment 8", valueText: "61.5", value: 61.5, cohortSize: 198, percentile: 93, score10: 9.3, trend: { direction: "flat", deltaPoints: 3, fromYear: "2021/22" }, year: "2024/25", basis: "vs 494 London secondaries, cohort 30+", regionMedian: 50.15, missingReason: null, note: null },
      { measure: "ks4-em-grade5", label: "Grade 5+ English and maths", valueText: "71%", value: 71, cohortSize: 198, percentile: 89, score10: 8.9, trend: null, year: "2024/25", basis: "vs 494 London secondaries, cohort 30+", regionMedian: 51.75, missingReason: null, note: null },
      { measure: "ks4-ebacc-aps", label: "EBacc point score", valueText: "Not enough data", value: null, cohortSize: null, percentile: null, score10: null, trend: null, year: "2024/25", basis: "vs 494 London secondaries, cohort 30+", regionMedian: 4.56, missingReason: "No results published for 2024/25", note: null },
      { measure: "ks4-progress8", label: "Progress 8", valueText: "+0.48", value: 0.48, cohortSize: 196, percentile: 84, score10: 8.4, trend: null, year: "2023/24", basis: "vs 490 London secondaries, cohort 30+", regionMedian: 0.32, missingReason: null, note: "Not published for 2024/25: Progress 8 returns with 2026/27 results" },
      { measure: "ks5-alevel-aps", label: "A level points per entry", valueText: "40.1", value: 40.1, cohortSize: 124, percentile: 86, score10: 8.6, trend: null, year: "2024/25", basis: "vs 352 London secondaries, cohort 30+", regionMedian: 34.7, missingReason: null, note: null },
    ],
    topBadge: school.topBadge!,
    tldr: {
      strengths: ["Preview: pupils work hard and expect a lot of themselves.", "The sixth form is a real strength of the school.", "Pupils say that bullying is rare and dealt with quickly."],
      improve: ["Preview: the curriculum in a few subjects is not yet as well planned as in the rest of the school."],
      inspectionDate: "2023-05-16", publicationDate: "2023-06-20", reportUrl: PREVIEW_REPORT,
      label: "From Ofsted report, 2023-06-20", inspectedAsPredecessor: false, inspectedUrn: "100002", attribution: OFSTED_ATTRIBUTION,
    },
    admissions: {
      demand: [{ entryYear: 2026, entryPoint: "year7", firstPreferences: 412, anyPreferences: 1150, offers: 210, firstPreferenceOffers: 190, pan: null, applicationsPerPlace: null, firstPreferencesPerPlace: null, applicationsPerOffer: 5.48, missingReason: "No published admission number" }],
      lastOffered: offered("Islington Council", "year7", [["2026/27", 1420], ["2025/26", 1342], ["2024/25", 1310], ["2023/24", 1378], ["2022/23", 1593]]),
      byYear: [
        demandYear("year7", 2026, 412, 190, { anyPreferences: 1150, offers: 210, secondPreferences: 260, thirdPreferences: 180, secondPreferenceOffers: 14, thirdPreferenceOffers: 6 }),
        demandYear("year7", 2025, 398, 192), demandYear("year7", 2024, 360, 195), demandYear("year7", 2023, 341, 200),
      ],
      oversubscriptionDefinition: OVERSUBSCRIBED,
    },
    nationalRank: {
      rank: 162, total: 3280, topPercent: 5, year: "2024/25", measure: "KS4: Attainment 8 average score (preview)",
      measureId: "ks4-attainment8", value: 61.5, tiebreakValue: null, rankedUrn: "100002", sourceRelease: "preview",
      line: "Ranked 162 of 3,280 secondaries in England, 2024/25 (top 5%)", missingReason: null, pool: POOL,
      history: rankHistory([["2015/16", 420, 3092], ["2016/17", 350, 3125], ["2017/18", 330, 3156], ["2018/19", 300, 3180], ["2021/22", 210, 3220], ["2022/23", 240, 3250], ["2023/24", 190, 3265], ["2024/25", 162, 3280]]),
    },
    combinedSixthFormRank: {
      measure: "A level: average points per entry (preview)", measureId: "ks5-alevel-aps", year: "2024/25",
      value: 38.21, cohortSize: 132, regionRank: 45, regionPool: 480, englandRank: 310, englandPool: 2600,
      selectionNote: "Independent and selective (grammar) schools choose their pupils, so high results partly reflect who gets in, not only teaching. Some independent schools don't publish results.",
      line: "#45 of 480 London sixth forms, state and independent, 2024/25", sourceRelease: "preview",
    },
    profile: profile("Mixed", 1100, 1074, [51.2, 48.8, 38.4, 41.0, 11.5, 3.1, 6.2, null], 15.2),
    inspectionCounts: {
      framework: "legacy", graded: 5, strengths: 5, weaknesses: 0,
      strengthAreas: ["Quality of education", "Behaviour and attitudes", "Personal development", "Effectiveness of leadership and management", "Sixth form provision (where applicable)"],
      weaknessAreas: [], safeguarding: "Yes", improvePoints: 1, inspectionDate: "2023-05-16", publicationDate: "2023-06-20", reportUrl: PREVIEW_REPORT,
      inspectedUrn: "100002", inspectedAsPredecessor: false, definition: "Judgements graded Outstanding or Good, and Requires improvement or Inadequate (preview).",
    },
    parentView: {
      surveyEra: "earlier", surveyLabel: "Earlier survey (before Nov 2025)",
      responses: 146, responseRate: 13.6, question: "My child is happy at this school", agreePercent: 88.4, happyPercent: 88.4, recommendPercent: 86.3,
      period: "4 Sep 2023 to 2 Sep 2024", periodStart: "2023-09-04", asAt: "2024-09-02", survey: "pre-2025-11",
      sourceUrl: "https://parentview.ofsted.gov.uk/", definition: "Share of the parents who answered, as Ofsted publishes it (preview).",
      questions: [
        { id: "Q1", question: "My child is happy at this school", answers: {}, headline: "agree", headlinePercent: 88.4 },
        { id: "Q2", question: "My child feels safe at this school", answers: {}, headline: "agree", headlinePercent: 91.1 },
        { id: "Q4a", question: "Has your child been bullied at this school?", answers: {}, headline: "yes", headlinePercent: 12.3 },
        { id: "Q10", question: "Would you recommend this school to another parent?", answers: {}, headline: "yes", headlinePercent: 86.3 },
        { id: "Q6", question: "When I have raised concerns with the school they have been dealt with properly", answers: {}, headline: "agree",
          headlinePercent: 88.2, notApplicable: { option: "Not applicable", percent: 32.3 } },
      ],
    },
    workforce: {
      academicYear: "2025/26", teachersFte: 70.5, teachingAssistantsFte: 6, leadershipFte: 8.2, supportStaffFte: 31.4, workforceFte: 101.9,
      workforceHeadcount: 118, teachersHeadcount: 78, pupilsFte: 1074, pupilsPerTeacher: 15.2, pupilsPerAdult: 10.5,
      definitions: WORKFORCE_DEFINITIONS, sourceRelease: "preview",
    },
    finance: {
      accounts: "AAR", accountsLabel: "Academy accounts (AAR)", period: "2024-25", periodLabel: "September 2024 to August 2025", periodMonths: 12,
      partialYear: false, pupilsFte: 1070, revenueReserve: -120000, revenueReservePerPupil: -112, inDeficit: true, inYearBalance: -310000,
      totalIncome: 8700000, totalExpenditure: 9010000, incomePerPupil: { grants: 7620, selfGenerated: 511, total: 8131 },
      spendPerPupil: { staff: 6480, premises: 520, total: 8421 }, missingReason: null,
      trust: { kind: "MAT", name: "North London Preview Trust", companyNumber: null, academies: 6, revenueReserve: 2400000, note: null }, federation: null,
      perPupilDefinition: "Published total ÷ FTE pupils in the same return (preview).", notComparable: NOT_COMPARABLE, sourceRelease: "preview",
    },
    destinations: {
      ks4: { cohortYear: "2023/24", destinationYear: "2024/25", cohort: 196, version: "Provisional", reportedUrn: "100002", sustainedPercent: 95, educationPercent: 91,
        higherEducationPercent: null, apprenticeshipPercent: 2, employmentPercent: 2, notSustainedPercent: 4, unknownPercent: 1, sourceRelease: "preview" },
      post16: { cohortYear: "2023/24", destinationYear: "2024/25", cohort: 121, version: "Provisional", reportedUrn: "100002", sustainedPercent: 90, educationPercent: 78,
        higherEducationPercent: 72, apprenticeshipPercent: 4, employmentPercent: 8, notSustainedPercent: 7, unknownPercent: 3, sourceRelease: "preview" },
      definition: "Sustained = at least six months in education, an apprenticeship or employment (preview).",
    },
    compare: compare("secondary", "Islington", [
      ["pupils", "count", 1074, "2026-01-15", [568, 1102, 1681], null], ["fsm6Percent", "percent", 38.4, "2024/25", [13.8, 35.4, 56.7], null],
      ["ealPercent", "percent", 41, "2024/25", [15.4, 37.3, 65.8], null], ["senSupportPercent", "percent", 11.5, "2024/25", [5.8, 12.2, 18.9], null],
      ["ehcpPercent", "percent", 3.1, "2024/25", [1.4, 3.1, 5.6], null], ["overallAbsencePercent", "percent", 6.2, "2024/25", [5, 7.2, 10.1], null, "lower"],
      ["pupilsPerTeacher", "ratio", 15.2, "2025/26", [13.3, 15.8, 18.6], null], ["pupilsPerAdult", "ratio", 10.5, "2025/26", [9.5, 11.8, 14.3], null],
      ["incomePerPupil", "pounds", 8131, "2024-25", [7859, 9253, 11624], null, null, "AAR"], ["spendPerPupil", "pounds", 8421, "2024-25", [7509, 8785, 11215], null, null, "AAR"],
      ["staffSpendPerPupil", "pounds", 6480, "2024-25", [5835, 6871, 8396], null, null, "AAR"], ["reservePerPupil", "pounds", -112, "2024-25", [-1, 484, 2236], null, null, "AAR"],
      ["firstChoiceOfferedPercent", "percent", 46.12, "2026", [48.5, 90.6, 100], null],
    ]),
    links: demoLinks("100002", "Islington", "secondary", null),
    missing: [
      { measure: "ks4-progress8", reason: "Not published for 2024/25: Progress 8 returns with 2026/27 results" },
    ],
    sources: SOURCES,
  };
}

/** The demo card for a preview school, or null (the page then 404s). */
export function demoSchoolCard(urn: string): SchoolCard | null {
  if (urn === "100001") return primaryCard();
  if (urn === "100002") return secondaryCard();
  return null;
}

/** Preview URNs with a card, for the demo sitemap. */
export const DEMO_SCHOOL_CARD_URNS = ["100001", "100002"] as const;
