import assert from "node:assert/strict";
import test from "node:test";

import { HELP } from "../src/lib/help-texts";
import { fixtureAreaPeople } from "../src/lib/people-fixture";
import {
  PEOPLE_GROUPS,
  PEOPLE_TOPIC_IDS,
  PEOPLE_TOPICS,
  barScale,
  densityComparison,
  formatShare,
  orderedCategories,
  readAreaPeople,
  visibleCategories,
  type PeopleCategory,
} from "../src/lib/people-profile";

const category = (id: string, count: number | null, share: number | null, regionShare: number | null = 0.1): PeopleCategory =>
  ({ id, label: id, count, share, regionShare });

test("rows are largest first, top five with the rest behind show all", () => {
  const categories = [10, 50, 30, 20, 40, 60, 5].map((count, index) => category(`c${index}`, count, count / 215));
  const top = visibleCategories(categories, false);
  assert.deepEqual(top.rows.map((row) => row.count), [60, 50, 40, 30, 20]);
  assert.equal(top.hidden, 2);
  assert.equal(visibleCategories(categories, true).rows.length, 7);
  // One extra row is shown rather than hidden behind a button.
  assert.equal(visibleCategories(categories.slice(0, 6), false).hidden, 0);
});

test("unknown counts sort last and read unknown, never 0%", () => {
  const rows = visibleCategories([category("a", null, null), category("b", 0, 0), category("c", 3, 1)], false).rows;
  assert.deepEqual(rows.map((row) => row.id), ["c", "b", "a"]);
  assert.equal(formatShare(null), "unknown");
  assert.equal(formatShare(0), "0.0%");
  assert.equal(formatShare(0.0004), "<0.1%");
  assert.equal(formatShare(0.052), "5.2%");
  assert.equal(formatShare(0.5577), "56%");
});

test("bars share one scale so the larger of area and London fills the track", () => {
  assert.equal(barScale([category("a", 1, 0.2, 0.5), category("b", 1, 0.4, 0.1)]), 0.5);
  assert.equal(barScale([category("a", null, null, null)]), 1);
});

test("density compares with London in plain words", () => {
  const population = (density: number | null, london: number | null) =>
    ({ residents: 1, year: 2024, areaKm2: 1, densityPerKm2: density, regionDensityPerKm2: london, sourceVersion: "s" });
  assert.equal(densityComparison(population(16_232, 5_776)), "2.8 times the London average");
  assert.equal(densityComparison(population(7_000, 5_776)), "21% more than the London average");
  assert.equal(densityComparison(population(5_900, 5_776)), "about the London average");
  assert.equal(densityComparison(population(2_000, 5_776)), "65% less than the London average");
  assert.equal(densityComparison(null), "London comparison unknown");
});

test("demo fixtures add up, cover every topic and are refused in real mode", () => {
  for (const id of ["uk:lsoa:E01000001", "uk:msoa:E02000002", "uk:lad:E09000003"] as const) {
    const people = fixtureAreaPeople(id);
    assert.ok(people, id);
    assert.deepEqual(people.topics.map((topic) => topic.id), [...PEOPLE_TOPIC_IDS]);
    for (const topic of people.topics) {
      if (topic.total === null) continue;
      assert.equal(topic.categories.reduce((sum, row) => sum + (row.count ?? 0), 0), topic.total, `${id} ${topic.id}`);
    }
    assert.equal(readAreaPeople(people, "demo").status, "available");
    assert.deepEqual(readAreaPeople(people, "real"), { status: "unavailable", reason: "fixture-people-in-real-mode" });
  }
  const southBank = fixtureAreaPeople("uk:lsoa:E01000003");
  assert.equal(southBank?.topics.find((topic) => topic.id === "religion")?.total, null);
  assert.equal(fixtureAreaPeople("uk:lsoa:E01009999"), null);
  assert.equal(readAreaPeople({ schemaVersion: "area-profile.v1" }, "demo").status, "unavailable");
});

test("every topic has a title and a help text; homes, households, ages, ethnic group, country of birth and religion are shown", () => {
  const grouped = PEOPLE_GROUPS.flatMap((group) => group.topics);
  // Ethnic group and religion are the full breakdown behind their map layers; qualifications, jobs and work stay off the page.
  assert.deepEqual([...grouped].sort(), ["accommodation", "age", "country-of-birth", "ethnicity", "household-type", "religion", "tenure"]);
  for (const id of PEOPLE_TOPIC_IDS) assert.ok(HELP[PEOPLE_TOPICS[id].help], id);
});

test("age bands keep their order; other topics are largest first", () => {
  const bands = [category("0-14", 10, 0.1), category("15-24", 5, 0.05), category("25-44", 50, 0.5)];
  assert.equal(PEOPLE_TOPICS.age.ordered, true);
  assert.deepEqual(orderedCategories("age", bands).map((row) => row.id), ["0-14", "15-24", "25-44"]);
  assert.deepEqual(orderedCategories("tenure", bands).map((row) => row.id), ["25-44", "0-14", "15-24"]);
});
