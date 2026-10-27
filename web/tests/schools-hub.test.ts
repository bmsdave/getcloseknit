import assert from "node:assert/strict";
import test from "node:test";

import { GUIDE_ARTICLES } from "../src/components/guide/articles";
import { sitemapPaths } from "../src/lib/seo";
import { SCHOOLS_101, schools101Href } from "../src/lib/schools-101";
import { DEFAULT_SCHOOL_FILTER, schoolFilterChipRows, type SchoolFilter } from "../src/lib/school-filter";
import {
  boroughBySlug, filterSchools, HUB_CHIP_ROWS, hubPhase, joinDirectory, listsSchools, LONDON_BOROUGHS, NO_FILTERS, readSchoolFilters, schoolsHref,
} from "../src/lib/schools-hub";

test("London has 33 boroughs, each with a GSS code and a slug the GIAS name slugs to", () => {
  assert.equal(LONDON_BOROUGHS.length, 33);
  assert.equal(new Set(LONDON_BOROUGHS.map((borough) => borough.code)).size, 33);
  for (const borough of LONDON_BOROUGHS) assert.match(borough.code, /^E09000\d{3}$/);
  assert.equal(boroughBySlug("hammersmith-and-fulham")?.code, "E09000013");
  assert.equal(boroughBySlug("city-of-london")?.code, "E09000001");
  assert.equal(boroughBySlug("nowhere"), null);
});

test("the query reads into filters and back, defaults left out; older hub links still read", () => {
  const filters = readSchoolFilters({ borough: "hackney", schools: "t.s_o.out.good_m.top.10", q: "  St Mary " });
  assert.equal(filters.borough?.name, "Hackney");
  assert.equal(filters.q, "St Mary");
  assert.equal(schoolsHref(filters), "/schools?q=St+Mary&borough=hackney&schools=t.s_o.out.good_m.top.10");
  assert.equal(schoolsHref(filters, { borough: null, q: "", school: { ...filters.school, ofsted: DEFAULT_SCHOOL_FILTER.ofsted } }),
    "/schools?schools=t.s_m.top.10");
  // ?phase=secondary&ofsted=good&top=10 (the hub before the shared filter) is the same filter.
  assert.deepEqual(readSchoolFilters({ borough: "hackney", phase: "secondary", ofsted: "good", top: "10", q: "St Mary" }), filters);
  assert.deepEqual(readSchoolFilters({ phase: "college", ofsted: "great", top: "5", borough: "x" }), NO_FILTERS);
  assert.equal(schoolsHref(NO_FILTERS), "/schools");
  assert.equal(listsSchools(NO_FILTERS), false);
  const primary = { ...NO_FILTERS, school: { ...DEFAULT_SCHOOL_FILTER, phases: ["primary" as const] } };
  assert.equal(listsSchools(primary), false, "the phase alone narrows the top lists only");
  assert.equal(hubPhase(primary), "primary");
  assert.equal(listsSchools({ ...NO_FILTERS, borough: boroughBySlug("camden") }), true);
  // The chips are the map's: each links to the filter it leads to.
  const [phase, , results] = schoolFilterChipRows(filters.school, HUB_CHIP_ROWS);
  assert.deepEqual(phase.chips.map((chip) => chip.label), ["All", "Primary", "Secondary", "All-through"]);
  assert.equal(results.chips.find((chip) => chip.current)?.label, "Top 10%");
  const ks2 = schoolFilterChipRows({ ...DEFAULT_SCHOOL_FILTER, measure: { id: "ks2RwmExpected", threshold: 75 } }, ["results"])[0];
  assert.equal(ks2.chips.find((chip) => chip.current)?.label, "KS2 expected standard ≥ 75%", "a map measure reads back on the hub");
});

test("the directory joins the index's borough to the points' Ofsted mark and top %, and filters on them", () => {
  const index = [
    { urn: "1", name: "Alpha Primary", phase: "primary", borough: "Hackney", successorUrn: null, hasEvidence: true },
    { urn: "2", name: "Beta Academy", phase: "secondary", borough: "Hackney", successorUrn: null, hasEvidence: true },
    { urn: "3", name: "Gamma School", phase: "secondary", borough: "Islington", successorUrn: null, hasEvidence: true },
    { urn: "4", name: "Closed School", phase: "primary", borough: "Hackney", successorUrn: "1", hasEvidence: true },
  ];
  const points = [
    { urn: "1", name: "Alpha Primary", phase: "primary", latitude: 51.5, longitude: -0.1, kind: "state" as const, ofsted: "outstanding" as const,
      measures: { ks2RwmExpected: [81, "2024/25"] as [number, string] } },
    { urn: "2", name: "Beta Academy", phase: "secondary", latitude: 51.5, longitude: -0.1, kind: "state" as const, ofsted: "good" as const, topPercent: 10,
      group: "academy" as const },
    { urn: "3", name: "Gamma School", phase: "secondary", latitude: 51.5, longitude: -0.1, kind: "state" as const, ofsted: "report-card" as const, topPercent: 5 },
    { urn: "9", name: "Private", phase: "secondary", latitude: 51.5, longitude: -0.1, kind: "independent" as const },
  ];
  const schools = joinDirectory(index, points);
  assert.deepEqual(schools.map((school) => school.urn), ["1", "2", "3"], "open state schools only");
  const school = (change: Partial<SchoolFilter>) => ({ ...NO_FILTERS, school: { ...DEFAULT_SCHOOL_FILTER, ...change } });
  const hackney = { ...NO_FILTERS, borough: boroughBySlug("hackney") };
  assert.deepEqual(filterSchools(schools, hackney).map((row) => row.urn), ["2", "1"], "best top % first");
  assert.deepEqual(filterSchools(schools, school({ ofsted: ["out", "good"] })).map((row) => row.urn), ["2", "1"]);
  assert.deepEqual(filterSchools(schools, school({ ofsted: ["rc"] })).map((row) => row.urn), ["3"]);
  assert.deepEqual(filterSchools(schools, school({ measure: { id: "englandTopPercent", threshold: 10 } })).map((row) => row.urn), ["3", "2"]);
  assert.deepEqual(filterSchools(schools, school({ phases: ["primary"] })).map((row) => row.urn), ["1"]);
  assert.deepEqual(filterSchools(schools, school({ measure: { id: "ks2RwmExpected", threshold: 75 } })).map((row) => row.urn), ["1"]);
  assert.deepEqual(filterSchools(schools, school({ establishments: ["academy"] })).map((row) => row.urn), ["2"]);
  assert.deepEqual(filterSchools(schools, { ...NO_FILTERS, q: "beta acad" }).map((row) => row.urn), ["2"]);
  // Without the points feed: the index's schools with no successor, filtered by phase only.
  assert.deepEqual(joinDirectory(index, []).map((row) => row.urn), ["1", "2", "3"]);
});
test("every Schools 101 card opens a section of the Schools 101 guide", () => {
  const article = GUIDE_ARTICLES["schools-101"];
  const anchors = new Set([...(article.sections ?? []).map((section) => section.id), "guide-how"]);
  assert.ok(SCHOOLS_101.length >= 10);
  for (const card of SCHOOLS_101) {
    assert.ok(anchors.has(card.id), `${card.id}: no section`);
    assert.ok(card.text.split(/\s+/).length <= 30, `${card.id}: card over 30 words`);
    assert.match(schools101Href(card), /^\/guide\/schools-101#[a-z0-9-]+$/);
  }
});

test("the sitemap lists /schools and the Schools 101 guide", () => {
  const paths = sitemapPaths([]);
  assert.ok(paths.includes("/schools"));
  assert.ok(paths.includes("/guide/schools-101"));
});
