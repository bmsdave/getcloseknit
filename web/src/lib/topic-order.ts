/**
 * The one topic order (docs/area-card-2026-10/decisions.md §1), used by every list of topics:
 * map groups, area card sections and tabs, overview tiles, rankings and gains/compromises.
 * It never changes with the household's profile (personalisation-spec.md): a screen without a
 * section for a topic skips it and keeps the rest in this order. My criteria is last (map only).
 */
export const TOPIC_ORDER = [
  "price", "getting-around", "safety", "schools", "local-places", "environment", "health", "homes", "people", "living-costs", "my-criteria",
] as const;

export type TopicId = (typeof TOPIC_ORDER)[number];

/** A topic's place in the order; null (a screen's own lead, such as Overview) sorts first. */
export function topicRank(topic: TopicId | null): number {
  return topic === null ? -1 : TOPIC_ORDER.indexOf(topic);
}

/** A copy of `items` in topic order; items of one topic keep their own order (a stable sort). */
export function sortByTopic<T>(items: readonly T[], topicOf: (item: T) => TopicId | null): T[] {
  return items
    .map((item, index) => ({ item, index, rank: topicRank(topicOf(item)) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.item);
}
