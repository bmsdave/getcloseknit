"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { PreferenceProfile, SaleRecord } from "@/lib/contracts";
import type { LeaseholdFacts } from "@/lib/leasehold";
import { toolHref } from "@/lib/tools";
import { AGENT_QUESTIONS_KEY, agentQuestions, type ViewingCandidate } from "@/lib/viewing-checklist";

interface ViewingChecklistProps {
  candidates: ViewingCandidate[];
  profile: PreferenceProfile;
  histories: Record<string, SaleRecord>;
  lease?: LeaseholdFacts;
  costUnknowns?: string[];
}

type Ticks = Record<string, Record<string, boolean>>;

function loadTicks(): { ticks: Ticks; denied: boolean } {
  try {
    const raw = window.localStorage.getItem(AGENT_QUESTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    return { ticks: parsed && typeof parsed === "object" ? parsed as Ticks : {}, denied: false };
  } catch {
    return { ticks: {}, denied: true };
  }
}

function saveTicks(ticks: Ticks): boolean {
  try {
    window.localStorage.setItem(AGENT_QUESTIONS_KEY, JSON.stringify(ticks));
    return true;
  } catch {
    return false;
  }
}

/**
 * "Questions to ask the agent": five short questions (lease length, service
 * charge, ground rent, major works, energy certificate for buyers; damp,
 * deposit, what is included, energy, tenancy for renters) with a tick each,
 * kept on this device, and links to the money tools. It replaces the long
 * viewing and diligence forms: the answers belong with a solicitor.
 */
export function ViewingChecklistPanel({ candidates, profile }: ViewingChecklistProps) {
  const key = candidates[0]?.id ?? "area";
  const [ticks, setTicks] = useState<Ticks>({});
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const loaded = loadTicks();
    setTicks(loaded.ticks);
    setDenied(loaded.denied);
  }, []);
  const questions = agentQuestions(profile.market);
  const mine = ticks[key] ?? {};
  const asked = questions.filter((question) => mine[question.id]).length;
  const toggle = (id: string, checked: boolean) => {
    const next = { ...ticks, [key]: { ...mine, [id]: checked } };
    setTicks(next);
    if (!saveTicks(next)) setDenied(true);
  };
  return (
    <section className="agent-questions" data-testid="viewing-checklist" aria-labelledby="agent-questions-title">
      <h3 id="agent-questions-title">Questions to ask the agent</h3>
      <p className="agent-questions__progress" data-testid="viewing-progress">
        {asked} of {questions.length} asked · a tick is your own note, kept on this device
      </p>
      <ul className="agent-questions__list">
        {questions.map((question) => (
          <li key={question.id}>
            <label>
              <input type="checkbox" checked={Boolean(mine[question.id])}
                onChange={(event) => toggle(question.id, event.target.checked)} data-testid={`agent-question-${question.id}`} />
              <span>
                <strong>{question.question}</strong>
                <small>{question.why}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {denied && <p className="agent-questions__note">This browser blocks saving, so ticks will not survive reload.</p>}
      <p className="agent-questions__tools" data-testid="agent-questions-tools">
        Work out the money: <Link href={toolHref("stamp-duty")}>stamp duty</Link> ·{" "}
        <Link href="/tools/mortgage-rates">mortgage rates</Link> · <Link href={toolHref("investor")}>buy-to-let</Link>
      </p>
    </section>
  );
}
