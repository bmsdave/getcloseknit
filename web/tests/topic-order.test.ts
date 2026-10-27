import assert from "node:assert/strict";
import test from "node:test";

import { AREA_CARDS } from "../src/lib/area-brief";
import { RANKING_GROUPS } from "../src/lib/area-pages";
import { EVIDENCE_SECTIONS } from "../src/lib/evidence-sections";
import { MAP_TOPIC_GROUPS } from "../src/lib/map-topics";
import { sortByTopic, TOPIC_ORDER, topicRank, type TopicId } from "../src/lib/topic-order";

/** Ranks never go down: the list is a subsequence of TOPIC_ORDER (repeats allowed for one topic). */
function assertInTopicOrder(topics: readonly (TopicId | null)[], what: string) {
  const ranks = topics.map(topicRank);
  for (let index = 1; index < ranks.length; index += 1) {
    assert.ok(ranks[index] >= ranks[index - 1], `${what}: ${topics[index - 1]} before ${topics[index]}`);
  }
}

test("the order is the owner's: price, getting around, safety, schools, places, environment, homes, people, costs", () => {
  assert.deepEqual(TOPIC_ORDER, [
    "price", "getting-around", "safety", "schools", "local-places", "environment", "health", "homes", "people", "living-costs", "my-criteria",
  ]);
});

test("sortByTopic is stable and puts a screen's own lead (null) first", () => {
  const items = [{ id: "b", t: "safety" }, { id: "lead", t: null }, { id: "a", t: "price" }, { id: "c", t: "safety" }] as const;
  assert.deepEqual(sortByTopic(items, (item) => item.t).map((item) => item.id), ["lead", "a", "b", "c"]);
});

test("area card sections and tabs follow the order", () => {
  assert.deepEqual(AREA_CARDS.map((card) => card.id), [
    "overview", "price", "getting-around", "safety", "schools", "local-places", "environment", "health", "homes", "people", "living-costs",
  ]);
});

test("map groups follow the order: nearby places are Local places, My criteria last", () => {
  const topic: Record<string, TopicId> = {
    cost: "price", "getting-around": "getting-around", safety: "safety", "food-drink": "local-places", "going-out": "local-places",
    "everyday-life": "local-places", "homes-area": "homes", nature: "environment", people: "people", "my-criteria": "my-criteria",
  };
  assertInTopicOrder(MAP_TOPIC_GROUPS.map((group) => topic[group.id]), "map groups");
  assert.equal(MAP_TOPIC_GROUPS.at(-1)?.id, "my-criteria");
});

test("panel sections and rankings follow the order", () => {
  const section: Record<string, TopicId> = {
    price: "price", transport: "getting-around", crime: "safety", schools: "schools", environment: "environment",
    planning: "homes", property: "homes", people: "people",
  };
  assertInTopicOrder(EVIDENCE_SECTIONS.map((entry) => section[entry.id]), "panel sections");
  const ranking: Record<string, TopicId> = {
    Cost: "price", "Getting around": "getting-around", Safety: "safety", Schools: "schools", "Going out": "local-places",
    "Everyday life": "local-places", "Homes & area": "homes",
  };
  assertInTopicOrder(RANKING_GROUPS.map((group) => ranking[group]), "ranking groups");
});
