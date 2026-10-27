"use client";

import { useMemo, useState } from "react";

import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import {
  PEOPLE_GROUPS,
  PEOPLE_TOPICS,
  areaPeoplePath,
  formatCount,
  readAreaPeople,
  type AreaPeopleState,
  type PeopleTopic,
  type PeopleTopicId,
} from "@/lib/people-profile";
import { accommodationIds, densityWords, leadLine, shareRows, shareScale } from "@/lib/share-rows";
import { scopeName } from "@/lib/scope-name";
import type { PropertyTypeCode } from "@/lib/market";
import { useSectionJson } from "./section-seed";

import { ShareLegend, ShareRowList } from "./share-rows";

const KIND_NOUN = { lsoa: "neighbourhood", msoa: "district", lad: "borough" } as const;

/** The Homes section's Census topics; People takes the rest of PEOPLE_GROUPS (never merged: decisions.md). */
const HOMES_TOPICS: readonly PeopleTopicId[] = ["accommodation", "tenure"];

/** One yarn per topic (chart tokens, 3:1 on the panel); Homes is descriptive grey. */
const TOPIC_COLOUR: Partial<Record<PeopleTopicId, string>> = {
  "household-type": "var(--chart-1)", age: "var(--chart-5)", ethnicity: "var(--chart-6)",
  "country-of-birth": "var(--chart-3)", religion: "var(--chart-4)",
};
const HOMES_COLOUR = "var(--chart-neutral)";

/** Short titles for the rows (the map layers keep the long ones). */
const TOPIC_TITLE: Partial<Record<PeopleTopicId, string>> = {
  "household-type": "Household", age: "Age", accommodation: "Type of home", tenure: "Owned or rented",
};

export type PeoplePart = "homes" | "people";

function partTopics(part: PeoplePart): PeopleTopicId[] {
  return PEOPLE_GROUPS.flatMap((group) => group.topics).filter((id) => HOMES_TOPICS.includes(id) === (part === "homes"));
}

/** The area's Census payload, read once per page (Homes, People and their ⓘ share it); null while loading. */
export function useAreaPeople(geographyId: GeographyId, mode: DataMode): AreaPeopleState | null {
  const payload = useSectionJson(areaPeoplePath(geographyId));
  return useMemo(() => payload === undefined ? null
    : payload === null ? { status: "unavailable", reason: "people-unreachable" } : readAreaPeople(payload, mode), [payload, mode]);
}

/**
 * One Census section of the area page as neutral rows beside London, never rated:
 * "homes" shows the type of home and owned or rented (grey, the household's types marked ▸);
 * "people" shows households, ages, ethnic group, country of birth and religion, each in its own
 * yarn. One row per category, London as a tick on the same scale, a chip for gaps of 5 points or
 * more, the top four plus Other with "Show all", a plain lead line per topic (none for religion)
 * and one legend for the section. Facts (density, households) come first, as plain chips.
 */
export function PeopleSection({ geographyId, mode, part = "people", facts = [], name = "This area", types = [] }: {
  geographyId: GeographyId; mode: DataMode; part?: PeoplePart;
  /** Fact chips the card adds (deprivation in decile words). */
  facts?: readonly string[];
  /** The area's name for the legend. */
  name?: string;
  /** Homes: the household's home types, marked ▸ (never hidden). */
  types?: readonly PropertyTypeCode[];
}) {
  const state = useAreaPeople(geographyId, mode);
  const noun = part === "homes" ? "Homes" : "People";
  return (
    <div className="people" data-testid={part === "homes" ? "homes-section" : "people-section"}>
      {state === null && <p className="people-status">Loading…</p>}
      {state?.status === "unavailable" && <p className="people-status">{noun} figures are unknown for this area.</p>}
      {state?.status === "available" && <PeopleBody people={state.people} part={part} facts={facts} name={name} types={types} />}
    </div>
  );
}

/** The section's ⓘ: the Census basis, the population estimate and every source, word for word. */
export function PeopleNotes({ geographyId, mode, part }: { geographyId: GeographyId; mode: DataMode; part: PeoplePart }) {
  const state = useAreaPeople(geographyId, mode);
  const people = state?.status === "available" ? state.people : null;
  return (
    <>
      <p>
        Shares of this {people ? KIND_NOUN[people.kind] : "area"}&apos;s {part === "homes" ? "households" : "residents and households"}
        {people ? `, ${people.censusYear} Census` : ", Census"}; the tick on each row is {scopeName(people)}. Neutral context, never rated.
      </p>
      {part === "people" && people?.population && (
        <p>People per km²: mid-{people.population.year} population estimate over the area&apos;s land.</p>
      )}
      {people?.sources.map((source) => <p key={source.id}>{source.attribution}</p>)}
    </>
  );
}

function PeopleBody({ people, part, facts, name, types }: {
  people: Extract<AreaPeopleState, { status: "available" }>["people"]; part: PeoplePart;
  facts: readonly string[]; name: string; types: readonly PropertyTypeCode[];
}) {
  const byId = new Map(people.topics.map((topic) => [topic.id, topic]));
  const scope = scopeName(people);
  const topics = partTopics(part).map((id) => byId.get(id)).filter((topic): topic is PeopleTopic => !!topic);
  const households = byId.get("tenure")?.total ?? byId.get("household-type")?.total ?? null;
  // Households appear once, under People.
  const residents = people.population?.residents ?? null;
  const chips = part === "homes" ? [] : [
    { text: residents ? `${formatCount(residents)} people (${people.population!.year})` : "No data for this area", testId: "population" },
    { text: densityWords(people.population, scope), testId: "people-density" },
    { text: households !== null ? `${formatCount(households)} households` : null },
    ...facts.map((text) => ({ text })),
  ].filter((chip): chip is { text: string; testId?: string } => Boolean(chip?.text));
  const legendColour = part === "homes" ? HOMES_COLOUR : "var(--chart-neutral)";
  // Homes is one chart at a time (board V3-33d): Homes | Tenure.
  const [view, setView] = useState<PeopleTopicId>(HOMES_TOPICS[0]);
  const shown = part === "homes" ? topics.filter((topic) => topic.id === view) : topics;
  return (
    <>
      {chips.length > 0 && (
        <ul className="fact-chips" data-testid={`${part}-key-numbers`}>
          {chips.map((chip) => <li key={chip.text} data-testid={chip.testId}>{chip.text}</li>)}
        </ul>
      )}
      {part === "homes" && topics.length > 1 && (
        <div className="phase-toggle" role="group" aria-label="Homes or tenure" data-testid="homes-view">
          {topics.map((topic) => (
            <button key={topic.id} type="button" className="chip-button" aria-pressed={view === topic.id}
              data-testid={`homes-view-${topic.id}`} onClick={() => setView(topic.id)}>
              {HOMES_VIEW_LABEL[topic.id] ?? TOPIC_TITLE[topic.id]}
            </button>
          ))}
        </div>
      )}
      <ShareLegend name={name} colour={legendColour} scope={scope} />
      <div className="share-topics" data-testid={`${part}-chart`}>
        {shown.map((topic) => (
          <TopicRows key={topic.id} scope={scope} topic={topic} colour={part === "homes" ? HOMES_COLOUR : TOPIC_COLOUR[topic.id] ?? "var(--chart-1)"}
            highlight={topic.id === "accommodation" ? accommodationIds(types) : []} titled={part !== "homes"} />
        ))}
      </div>
    </>
  );
}

/** The Homes toggle's words (board V3-33d). */
const HOMES_VIEW_LABEL: Partial<Record<PeopleTopicId, string>> = { accommodation: "Homes", tenure: "Tenure" };

/**
 * One topic: its title (for screen readers only under a toggle), a plain lead line, the rows, and
 * "Show all n categories" when some fold into Other.
 */
function TopicRows({ topic, colour, highlight, titled = true, scope = "London" }: { topic: PeopleTopic; colour: string; highlight: readonly string[]; titled?: boolean; scope?: string }) {
  const [all, setAll] = useState(false);
  const title = TOPIC_TITLE[topic.id] ?? PEOPLE_TOPICS[topic.id].title;
  const known = topic.total !== null && topic.categories.some((category) => category.share !== null);
  const { rows, folded } = shareRows(topic.id, topic.categories, all, highlight);
  const lead = known ? leadLine(topic.id, topic.categories, scope) : null;
  return (
    <section className="share-topic" data-testid={`people-topic-${topic.id}`} aria-label={title}>
      <h3 className={titled ? undefined : "sr-only"}>{title}</h3>
      {lead && <p className="share-topic__lead" data-testid="people-lead">{lead}</p>}
      {known
        ? <ShareRowList rows={rows} scale={shareScale(rows)} colour={colour} label={title} highlight={highlight} />
        : <p className="people-status">Unknown</p>}
      {known && folded && (
        <button type="button" className="text-button share-topic__fold" aria-expanded={all} data-testid="people-show-all" onClick={() => setAll(!all)}>
          {all ? "Show top 4" : `Show all ${topic.categories.length} categories`}
        </button>
      )}
    </section>
  );
}
