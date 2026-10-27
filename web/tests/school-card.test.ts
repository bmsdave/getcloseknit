import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  academicYears, followUpShare, formatKm, formatMeasure, hasEvidence, inspectionDot, lowestArea, missingLine, offeredGroups, ofstedStanding, polygonCentre, resultsSlots, retryOnce, schoolPath, shownPlaces,
  schoolSchemaType, schoolTitle, shortSchoolName, straightLineKm, type LastOffered, type SchoolCard, type SchoolInspection,
} from "../src/lib/school-card";
import type { GeographyId } from "../src/lib/contracts";
import { getAreaSummary } from "../src/lib/fixtures";
import { DEMO_SCHOOL_CARD_URNS, demoSchoolCard } from "../src/lib/school-card-fixture";
import { schoolJsonLd, sitemapPaths } from "../src/lib/seo";

const inspection = (overrides: Partial<SchoolInspection>): SchoolInspection => ({
  inspectionNumber: "1", inspectedUrn: "101912", startDate: "2023-11-14", publicationDate: "2024-01-18",
  inspectionType: "S5 Inspection", framework: "eif-2019", overall: null, judgements: {}, reportUrl: "https://files.ofsted.gov.uk/v1/file/1",
  ...overrides,
});

test("results by year keep every year, labelling no-exam and unpublished gaps, never a made-up value", () => {
  const slots = resultsSlots({
    id: "ks2-rwm-expected", label: "RWM", unit: "percent",
    series: [
      { academicYear: "2015/16", value: 71, suppressed: false, cohortSize: 84 },
      { academicYear: "2018/19", value: 83, suppressed: false, cohortSize: 82 },
      { academicYear: "2022/23", value: 87, suppressed: false, cohortSize: 80 },
      { academicYear: "2023/24", value: null, suppressed: true, cohortSize: 9 },
      { academicYear: "2024/25", value: 87, suppressed: false, cohortSize: 82 },
    ],
  }, [{ academicYear: "2024/25", value: 72 }]);
  assert.deepEqual(slots.map((slot) => slot.year), academicYears("2015/16", "2024/25"));
  const by = Object.fromEntries(slots.map((slot) => [slot.year, slot]));
  assert.equal(by["2019/20"].gap, "no-exams");
  assert.equal(by["2020/21"].gap, "no-exams");
  assert.equal(by["2021/22"].gap, "not-published");
  assert.equal(by["2016/17"].gap, "not-published");
  assert.deepEqual([by["2023/24"].value, by["2023/24"].suppressed, by["2023/24"].gap], [null, true, null]);
  assert.deepEqual([by["2024/25"].value, by["2024/25"].median], [87, 72]);
  assert.deepEqual(resultsSlots({ id: "x", label: "x", unit: null, series: [] }), []);
});

test("measures format in their unit", () => {
  assert.equal(formatMeasure(87, "percent"), "87%");
  assert.equal(formatMeasure(0.62, "progress"), "+0.62");
  assert.equal(formatMeasure(-0.3, "progress"), "−0.30");
  assert.equal(formatMeasure(53.1, "score"), "53.1");
  // A median beside a school's figure takes its precision: Attainment 8 87.3 · London 50.1, not 50.15.
  assert.equal(formatMeasure(50.15, "score", shownPlaces("87.3")), "50.1");
  assert.equal(formatMeasure(38.456, "score", shownPlaces("38.45")), "38.46");
  assert.equal(shownPlaces("87"), 1);
});

test("a Parent View follow-up says the share it was asked of", () => {
  const question = (id: string, answers: Record<string, number>) => ({ id, question: id, answers, headline: "agree" as const, headlinePercent: null });
  const questions = [question("Q4a", { Yes: 14.75, No: 85.25 }), question("Q4b", { Agree: 27.78 }), question("Q5b", { Agree: 35.29 })];
  assert.equal(followUpShare(questions[1], questions), 14.75);
  assert.equal(followUpShare(questions[0], questions), null);
  assert.equal(followUpShare(questions[2], questions), null); // no Q5a loaded: say nothing
});

test("the standing Ofsted grade skips ungraded visits and never mixes frameworks", () => {
  const legacy = ofstedStanding([
    inspection({ inspectionNumber: "2", startDate: "2025-03-01", overall: null, inspectionType: "Section 8",
      judgements: { "Outcomes for ungraded and monitoring inspections": "School remains Good", "Safeguarding is effective": "Yes" } }),
    inspection({ overall: 2 }),
  ]);
  assert.equal(legacy?.kind, "legacy");
  assert.equal(legacy?.kind === "legacy" && legacy.grade, "Good");

  const card = ofstedStanding([inspection({
    framework: "report-card-2025", judgements: { Inclusion: "Strong standard", Achievement: "Needs attention", "Safeguarding standards": "Met" },
  }), inspection({ overall: 1 })]);
  assert.equal(card?.kind, "areas");
  if (card?.kind === "areas") {
    assert.equal(card.framework, "report-card");
    assert.deepEqual(card.areas.map((area) => [area.name, area.grade, area.tone]), [["Inclusion", "Strong", "good"], ["Achievement", "Needs attention", "bad"]]);
    assert.equal(card.safeguarding, "Met");
  }
  // The Inspections chip for area grades: the lowest area, never just "Report card".
  if (card?.kind === "areas") assert.deepEqual(lowestArea(card), { name: "Achievement", grade: "Needs attention", tone: "bad" });

  const areas = ofstedStanding([inspection({
    framework: "eif-2024-no-overall", judgements: { "Quality of education": 2, "Behaviour and attitudes": 1, "Safeguarding is effective": "Yes" },
  })]);
  assert.equal(areas?.kind === "areas" && areas.framework, "eif-2024");
  assert.equal(ofstedStanding([]), null);
  assert.deepEqual(inspectionDot(inspection({ judgements: { "Outcomes for ungraded and monitoring inspections": "School remains Good (Improving) - S5 Next" } })),
    { label: "Remains Good", tone: "none" });
  // Area grades with no overall grade: the dot takes the lowest area's tone; a report card likewise.
  assert.deepEqual(inspectionDot(inspection({ framework: "eif-2024-no-overall", judgements: { "Quality of education": 2, "Behaviour and attitudes": 3, "Safeguarding is effective": "Yes" } })),
    { label: "Areas graded, lowest Requires improvement", tone: "bad" });
  assert.deepEqual(inspectionDot(inspection({ framework: "eif-2024-no-overall", judgements: { "Quality of education": 1, "Leadership and management": 2 } })),
    { label: "Areas graded, lowest Good", tone: "good" });
  assert.equal(inspectionDot(inspection({ framework: "eif-2024-no-overall", judgements: { "Quality of education": 1, "Behaviour and attitudes": 1 } })).label, "All areas Outstanding");
  assert.equal(inspectionDot(inspection({ framework: "report-card-2025", judgements: { Inclusion: "Strong standard", Achievement: "Expected standard" } })).tone, "neutral");
  assert.deepEqual(inspectionDot(inspection({ inspectionType: "Section 8" })), { label: "Ungraded visit", tone: "none" });
});

test("one Ofsted date: the inspection start date, not the publication date", () => {
  const standing = ofstedStanding([inspection({ overall: 2 })]);
  assert.equal(standing?.date, "2023-11-14");
});

test("straight-line distance from an area's centre", () => {
  const centre = polygonCentre({ type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] });
  assert.deepEqual(centre, [1, 1]);
  assert.ok(Math.abs(straightLineKm([-0.1416, 51.501], [-0.1416, 51.511]) - 1.112) < 0.01);
  assert.equal(formatKm(0.62), "0.6 km");
  assert.equal(formatKm(0.01), "under 0.1 km");
});

test("the page title names Ofsted and results only when known; JSON-LD has no rating", () => {
  const card = demoSchoolCard("100002")!;
  assert.equal(schoolTitle(card), "North London Secondary Preview – Ofsted Good (2023) · GCSE results 2024/25");
  assert.match(schoolTitle(demoSchoolCard("100001")!), /Ofsted report card \(2026\) · KS2 results 2024\/25$/);
  assert.equal(schoolSchemaType("primary"), "ElementarySchool");
  assert.equal(schoolSchemaType("secondary"), "HighSchool");
  const ld = JSON.parse(schoolJsonLd("https://x.test", { type: "HighSchool", name: "A", path: "/school/100002", postcode: "N1 1AA", locality: "Islington", latitude: 51.5, longitude: -0.1 }));
  assert.equal(ld["@type"], "HighSchool");
  assert.equal(ld.url, "https://x.test/school/100002");
  assert.equal(ld.address.postalCode, "N1 1AA");
  assert.equal(ld.geo.latitude, 51.5);
  assert.ok(!("aggregateRating" in ld));
});

test("evidence decides indexing; the sitemap lists school cards", () => {
  const card = demoSchoolCard("100001")!;
  assert.ok(hasEvidence(card));
  assert.ok(!hasEvidence({ history: { ...card.history, inspections: [], measures: card.history.measures.filter((measure) => measure.id === "pupils") } }));
  assert.ok(sitemapPaths([], undefined, ["100001"]).includes("/school/100001"));
  assert.equal(schoolPath("101912", "uk:lsoa:E01000001"), "/school/101912?from=uk%3Alsoa%3AE01000001");
  assert.equal(demoSchoolCard("999999"), null);
});

test("last distance offered groups by council, entry point and site, newest first", () => {
  const row = (academicYear: string, distanceMetres: number | null): LastOffered => ({
    academicYear, entryPoint: "reception", site: "main", council: "Lambeth Council", licence: "OGL-3.0", attribution: "",
    sourceUrl: "https://x", reuseConfirmed: true, measurementMethod: null, distanceMetres, allOffered: null, rules: [],
  });
  const groups = offeredGroups([row("2024/25", 500), row("2026/27", 700), { ...row("2026/27", 900), entryPoint: "nursery" }]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].rows.map((entry) => entry.academicYear), ["2026/27", "2024/25"]);
});

test("grade 3 reads Satisfactory before September 2012 and Requires improvement after", async () => {
  const { legacyGradeLabel } = await import("../src/lib/school-card");
  assert.equal(legacyGradeLabel(3, "2010-02-03"), "Satisfactory");
  assert.equal(legacyGradeLabel(3, "2013-01-10"), "Requires improvement");
  assert.equal(legacyGradeLabel(2, "2007-03-01"), "Good");
});

test("Parent View, workforce, finance and destinations are typed as the API sends them and required in the contract", () => {
  // Vicar's Green Primary (101916), from the local load: CFR 2025-26 and the 2025 workforce census.
  const rows: Pick<SchoolCard, "workforce" | "finance" | "destinations"> = {
    workforce: {
      academicYear: "2025/26", teachersFte: 21.6, teachingAssistantsFte: 8.8, leadershipFte: 4, supportStaffFte: 13.61,
      workforceFte: 35.21, workforceHeadcount: 41, teachersHeadcount: 23, pupilsFte: 424.5, pupilsPerTeacher: 19.7,
      pupilsPerAdult: 13.6, definitions: {}, sourceRelease: "src-dfe-school-workforce-2025",
    },
    finance: {
      accounts: "CFR", accountsLabel: "Maintained school accounts (CFR)", period: "2025-26",
      periodLabel: "April 2025 to March 2026", periodMonths: 12, partialYear: false, pupilsFte: 424.5,
      revenueReserve: 360337, revenueReservePerPupil: 849, inDeficit: false, inYearBalance: 22001,
      totalIncome: 3233570, totalExpenditure: 3211569, incomePerPupil: { grants: 7173, selfGenerated: 444, total: 7617 },
      spendPerPupil: { staff: 5173, premises: 1017, total: 7566 }, missingReason: null, trust: null, federation: null,
      perPupilDefinition: "", notComparable: "", sourceRelease: "src-dfe-cfr-2025-26",
    },
    destinations: null,
  };
  assert.equal(rows.finance?.accounts, "CFR");
  // The generated contract types (contracts/openapi.yaml -> api-types.gen.ts): each section required, null or not.
  const types = readFileSync(new URL("../src/lib/api-types.gen.ts", import.meta.url), "utf8");
  const card = types.slice(types.indexOf("        SchoolCardResponse: {"));
  for (const key of ["inspectionCounts", "parentView", "workforce", "finance", "destinations"]) {
    assert.match(card.slice(0, card.indexOf("\n        };")), new RegExp(`\\n {12}${key}: `), key);
  }
  assert.match(types, /SchoolDestination: \{/);
});

test("the full card's sections: a parent's order, the year once, or No data with the reason; nothing loaded says why everywhere", async () => {
  const { cardSections } = await import("../src/lib/school-card");
  const secondary = cardSections(demoSchoolCard("100002")!);
  assert.deepEqual(secondary.map((section) => [section.id, section.title, section.year, section.missing]), [
    ["results", "Results", "2024/25", null],
    ["getting-in", "Getting in", "2026", null],
    ["links", "Visit & links", null, null],
    ["inspections", "Inspections", "2019–2023", null],
    ["pupils", "Pupils", "2024/25", null],
    ["parent-view", "Parent View", null, null],
    ["workforce", "Workforce", "2025/26", null],
    ["finance", "Financials", "2024/25", null],
    ["destinations", "Destinations", "2023/24 leavers", null],
  ]);
  const primary = cardSections(demoSchoolCard("100001")!);
  const by = Object.fromEntries(primary.map((section) => [section.id, section]));
  // Primaries have no Destinations section (the GLA 2016 Year 6 flows are outdated).
  assert.equal(by.destinations, undefined);
  assert.deepEqual([by["parent-view"].year, by["parent-view"].missing], [null, "Ofsted Parent View is not loaded"]);

  // Nothing loaded: every section says No data and why, never a guess.
  const bare = { ...demoSchoolCard("100002")!, links: undefined, nationalRank: null, profile: undefined, inspectionCounts: null, tldr: null, parentView: null, workforce: null, finance: null,
    destinations: null, kpis: [], admissions: { demand: [], lastOffered: [] }, missing: [{ measure: "workforce", reason: "Not in the 2025 census" }],
    details: { ...demoSchoolCard("100002")!.details, pupils: null }, history: { ...demoSchoolCard("100002")!.history, inspections: [], measures: [] } };
  const empty = cardSections(bare);
  assert.ok(empty.every((section) => section.missing !== null && section.year === null));
  assert.equal(empty.find((section) => section.id === "workforce")!.missing, "Not in the 2025 census");
  assert.equal(empty.find((section) => section.id === "inspections")!.missing, "Not inspected yet");
  assert.equal(empty.find((section) => section.id === "results")!.missing, "No results published");
});

test("an England rank that is missing keeps the Results section; the rank chart keeps no-exam years as a gap", async () => {
  const { cardSections, rankSlots } = await import("../src/lib/school-card");
  const card = demoSchoolCard("100001")!;
  const unranked = { ...card, nationalRank: { ...card.nationalRank!, rank: null, total: null, topPercent: null, missingReason: "Results withheld (fewer than 11 pupils)" } };
  const results = cardSections(unranked).find((section) => section.id === "results")!;
  assert.deepEqual([results.year, results.missing], ["2024/25", null]);
  const slots = rankSlots(card.nationalRank!);
  const byYear = Object.fromEntries(slots.map((slot) => [slot.year, slot]));
  assert.equal(byYear["2019/20"].gap, "no-exams");
  assert.equal(byYear["2023/24"].gap, "not-published");
  assert.equal(byYear["2024/25"].value, 20);
});

test("comparisons print as published and take a colour only where a direction is clearly better", async () => {
  const { compareText, compareTone, distanceVerdict } = await import("../src/lib/school-card");
  assert.equal(compareText(646, "count"), "646");
  assert.equal(compareText(1102, "count"), "1,102");
  assert.equal(compareText(18.69, "percent"), "18.7%");
  assert.equal(compareText(22.4, "ratio"), "22.4");
  // One decimal kept, so "Barnet 12.0" sits beside 13.1 and "Barnet 7.0%" beside 4.9%.
  assert.equal(compareText(12, "ratio"), "12.0");
  assert.equal(compareText(7, "percent"), "7.0%");
  assert.equal(compareText(7246, "pounds"), "£7,246");
  assert.equal(compareText(-1144, "pounds"), "−£1,144");
  const london = { p10: 3.8, median: 5.2, p90: 7.1, n: 1752 };
  // Absence: lower is better. Better than the London median is good, London's worst 10% bad, between neutral.
  assert.equal(compareTone({ value: 5.02, london, betterWhen: "lower" }), "good");
  assert.equal(compareTone({ value: 5.2, london, betterWhen: "lower" }), "neutral");
  assert.equal(compareTone({ value: 7.19, london, betterWhen: "lower" }), "bad");
  assert.equal(compareTone({ value: 9, london: { p10: 8, median: 10, p90: 12, n: 10 }, betterWhen: "higher" }), "neutral");
  assert.equal(compareTone({ value: 7, london: { p10: 8, median: 10, p90: 12, n: 10 }, betterWhen: "higher" }), "bad");
  // Pupils, money, staff: no direction, no colour.
  assert.equal(compareTone({ value: 99, london, betterWhen: null }), null);
  // You against the latest last distance offered.
  assert.equal(distanceVerdict(1000, { distanceMetres: 1328, allOffered: null }), "inside");
  assert.equal(distanceVerdict(1400, { distanceMetres: 1328, allOffered: null }), "outside");
  assert.equal(distanceVerdict(5000, { distanceMetres: null, allOffered: true }), "inside");
  assert.equal(distanceVerdict(500, { distanceMetres: null, allOffered: null }), null);
});

test("money, staff and last-offered figures print as published", async () => {
  const { formatPounds, formatPoundsShort, formatFte, offeredText, oversubscriptionGroups } = await import("../src/lib/school-card");
  assert.equal(formatPounds(360337), "£360,337");
  assert.equal(formatPounds(-202000), "−£202,000");
  assert.equal(formatFte(13.61), "13.61");
  assert.equal(formatFte(4), "4");
  // Rounded for reading in the body; as published in the disclosure.
  assert.equal(formatFte(12.21, 1), "12.2");
  assert.equal(formatPoundsShort(180575, true), "+£181k");
  assert.equal(formatPoundsShort(-120000), "−£120k");
  assert.equal(formatPoundsShort(7246), "£7.2k");
  assert.equal(formatPoundsShort(2_400_000), "£2.4m");
  assert.equal(formatPoundsShort(556), "£556");
  const row = { academicYear: "2026/27", entryPoint: "reception", site: "main", council: "x", licence: "OGL-3.0", attribution: "", sourceUrl: "", reuseConfirmed: true, measurementMethod: null, rules: [] };
  assert.equal(offeredText({ ...row, distanceMetres: 640, allOffered: null }), "640 m");
  assert.equal(offeredText({ ...row, distanceMetres: null, allOffered: true }), "All offered");
  assert.equal(offeredText({ ...row, distanceMetres: null, allOffered: null }), "Not published");
  // A secondary's reception class last seen years ago is history, not a current entry point.
  const demand = (entryPoint: string, entryYear: number) => ({ ...demoSchoolCard("100002")!.admissions.byYear![0], entryPoint, entryYear });
  const groups = oversubscriptionGroups({ demand: [], lastOffered: [], byYear: [demand("year7", 2025), demand("reception", 2019), demand("year7", 2026)] });
  assert.deepEqual(groups.map((group) => [group.entryPoint, group.rows.map((entry) => entry.entryYear)]), [["year7", [2026, 2025]]]);
});

test("short school names drop the type words", () => {
  assert.equal(shortSchoolName("Ark Acton Academy"), "Ark Acton");
  assert.equal(shortSchoolName("Twyford Church of England High School"), "Twyford");
  assert.equal(shortSchoolName("The Ellen Wilkinson School for Girls"), "The Ellen Wilkinson");
  assert.equal(shortSchoolName("Academy"), "Academy");
});

test("an empty section's reason is one short line; the full wording is kept for the menu", () => {
  const reason = "Ofsted Parent View: not published for this school (Ofsted lists only schools with 10 or more responses since the survey changed on 10 November 2025)";
  assert.deepEqual(missingLine(reason), { line: "Not published for this school", detail: reason });
  assert.deepEqual(missingLine("Ofsted Parent View is not loaded"), { line: "Ofsted Parent View is not loaded", detail: null });
  assert.deepEqual(missingLine("Pupils per teacher not published (x or u)"), { line: "Pupils per teacher not published", detail: "Pupils per teacher not published (x or u)" });
});

test("every demo school links to a demo area page that exists", () => {
  for (const urn of DEMO_SCHOOL_CARD_URNS) {
    const areaId = demoSchoolCard(urn)!.areaId;
    assert.ok(areaId && getAreaSummary(areaId as GeographyId, "price-per-square-metre", "2026-06"), `${urn} → ${areaId}`);
  }
});

test("Visit & links: official first, guides last, a link with its flag off or no data draws no tile", async () => {
  const { linkTiles } = await import("../src/lib/school-card");
  const links = demoSchoolCard("100001")!.links!;
  const standing = { kind: "legacy", grade: "Good", overall: 2, tone: "good", date: "2023-05-10", reportUrl: null } as const;
  const all = linkTiles(links, standing);
  assert.deepEqual(all.official.map((tile) => tile.key), ["ofstedReport", "dfePerformance", "parentView", "councilAdmissions", "gias", "eAdmissions"]);
  assert.deepEqual(all.guides.map((tile) => tile.key), ["goodSchoolsGuide", "locrating"]);
  assert.equal(all.official[0].sub, "reports.ofsted.gov.uk · Good, 2023");
  assert.equal(all.official[3].sub, "Westminster primary places · GOV.UK");
  assert.ok([...all.official, ...all.guides].every((tile) => tile.href.startsWith("/go/school-") && tile.href.endsWith("from=web")));
  const off = linkTiles({ ...links, locrating: { ...links.locrating, href: null }, goodSchoolsGuide: { ...links.goodSchoolsGuide, href: null },
    councilAdmissions: { ...links.councilAdmissions, council: null } });
  assert.deepEqual(off.guides, []);
  assert.equal(off.official[0].sub, "reports.ofsted.gov.uk");
  assert.equal(off.official[3].sub, "Find your council · GOV.UK");
});

test("a school card read that failed or timed out is tried once more; a refusal or an answer is not", async () => {
  const cases: [number[], number, number][] = [[[503, 200], 200, 2], [[503, 503], 503, 2], [[200], 200, 1], [[404], 404, 1], [[429], 429, 1]];
  for (const [statuses, status, calls] of cases) {
    let made = 0;
    const result = await retryOnce(async () => ({ status: statuses[made++] ?? 200 }));
    assert.equal(result.status, status);
    assert.equal(made, calls);
  }
});
