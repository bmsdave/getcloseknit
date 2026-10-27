import Link from "next/link";
import type { ReactNode } from "react";

import { HelpTip } from "./help-tip";
import {
  areaPath,
  basisNote,
  buildFaq,
  faqJsonLd,
  formatCrimeRate,
  formatPercent,
  formatPerSquareMetre,
  listPrice,
  LONDON,
  monthLabel,
  RANKINGS,
  type AreaFacts,
  type AreaIndex,
  type Figure,
  type HierarchyArea,
  type RankingDefinition,
} from "@/lib/area-pages";
import { areaDisplayName } from "@/lib/area-labels";
import { formatPounds } from "@/lib/evidence-format";
import type { HelpId } from "@/lib/help-texts";
import type { DataMode } from "@/lib/map-state";
import { SiteHeader } from "@/components/site-header";

const UNKNOWN = "unknown";

export function AreaPageShell({ children, testId, className }: { children: ReactNode; testId: string; className?: string }) {
  return (
    <main className={`methodology area-page${className ? ` ${className}` : ""}`} data-testid={testId}>
      <SiteHeader />
      {children}
    </main>
  );
}

export function DemoNote({ mode }: { mode: DataMode }) {
  if (mode !== "demo") return null;
  return <p className="quality-note area-page__demo">Demo data · not for decisions <HelpTip id="demo-data" label="demo data" /></p>;
}

export function AreaUnavailable() {
  return (
    <AreaPageShell testId="area-page-unavailable">
      <h1>Area figures are unavailable</h1>
      <p className="methodology-intro">The evidence service did not answer. Please try again in a minute, or open the <Link href="/">map</Link>.</p>
    </AreaPageShell>
  );
}

function figureText(figure: Figure | null, format: (value: number) => string): string {
  return figure ? format(figure.value) : UNKNOWN;
}

function schoolsText(schools: { primary: number; secondary: number }): string {
  return `${schools.primary.toLocaleString("en-GB")} primary · ${schools.secondary.toLocaleString("en-GB")} secondary`;
}

interface ProfileRow {
  topic: string;
  here: string;
  note: string;
  london: string;
  help: HelpId;
}

function profileRows(facts: AreaFacts, london: AreaFacts | null): ProfileRow[] {
  const unitName = "neighbourhood";
  const income = (value: number) => `${formatPounds(Math.round(value / 100) * 100)} a year`;
  const percent = (value: number) => `${Math.round(value)}% of homes`;
  return [
    { topic: "Typical price", here: figureText(facts.price, formatPerSquareMetre), note: basisNote(facts.price, unitName), london: figureText(london?.price ?? null, formatPerSquareMetre), help: "scorecard-price" },
    { topic: "Recorded crime per 1,000 residents", here: figureText(facts.crime, formatCrimeRate), note: basisNote(facts.crime, unitName), london: figureText(london?.crime ?? null, formatCrimeRate), help: "scorecard-crime" },
    {
      topic: "Neighbourhoods in England's most deprived fifth",
      here: facts.deprivation ? formatPercent(facts.deprivation.mostDeprived) : UNKNOWN,
      note: facts.deprivation ? `of ${facts.deprivation.count.toLocaleString("en-GB")}` : "",
      london: london?.deprivation ? formatPercent(london.deprivation.mostDeprived) : UNKNOWN,
      help: "scorecard-deprivation",
    },
    { topic: "Household income", here: figureText(facts.income, income), note: basisNote(facts.income, "area"), london: figureText(london?.income ?? null, income), help: "scorecard-income" },
    { topic: "Social renting", here: figureText(facts.socialRenting, percent), note: basisNote(facts.socialRenting, unitName), london: figureText(london?.socialRenting ?? null, percent), help: "scorecard-social-renting" },
    {
      topic: "State schools inside the area",
      here: facts.schools ? schoolsText(facts.schools) : UNKNOWN,
      note: "",
      london: london?.schools ? schoolsText(london.schools) : UNKNOWN,
      help: "area-page-schools",
    },
    { topic: "Homes with road or rail noise", here: facts.noise === null ? UNKNOWN : formatPercent(facts.noise), note: "", london: "—", help: "scorecard-noise" },
  ];
}

/** The area's figures next to its region's (London's), each with a (?) for the method. */
export function AreaProfile({ facts, london }: { facts: AreaFacts; london: AreaFacts | null }) {
  const isLondon = facts.id === LONDON;
  return (
    <section className="methodology-card area-page__profile" aria-labelledby="area-profile-title" data-testid="area-profile">
      <h2 id="area-profile-title">
        {`${facts.name} at a glance`} <HelpTip id="area-page-figures" label="how these figures are made" />
      </h2>
      <table className="area-page__table">
        <thead>
          <tr><th scope="col">Topic</th><th scope="col">{isLondon ? facts.name : "Here"}</th>{!isLondon && <th scope="col">{london?.name ?? "London"}</th>}</tr>
        </thead>
        <tbody>
          {profileRows(facts, london).filter((row) => !(isLondon && row.help === "scorecard-noise")).map((row) => (
            <tr key={row.topic} data-unknown={row.here === UNKNOWN || undefined}>
              <th scope="row">{row.topic} <HelpTip id={row.help} label={row.topic} /></th>
              <td><strong>{row.here}</strong>{row.note && <span className="area-page__note">{row.note}</span>}</td>
              {!isLondon && <td>{row.london}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="area-page__periods">
        Prices: year to {monthLabel(facts.price?.period ?? null)}. Crime: 12 months to {monthLabel(facts.crime?.period ?? null)}.
      </p>
    </section>
  );
}

/** "All areas in …": links to every child area, with its typical price and crime when known. */
export function AreaNavList({ title, areas, index, testId }: {
  title: string; areas: HierarchyArea[]; index: AreaIndex; testId: string;
}) {
  if (areas.length === 0) return null;
  // Each area by the name people use; neighbourhoods of one district can share it, and then
  // the official name follows, small, to tell them apart.
  const names = areas.map((area) => areaDisplayName(area) ?? area.name);
  const shared = new Set(names.filter((name, position) => names.indexOf(name) !== position));
  return (
    <section className="methodology-card area-page__nav" data-testid={testId} aria-label={title}>
      <h2>{title}</h2>
      <ul className="area-page__list">
        {areas.map((area, position) => {
          const price = listPrice(index, area);
          const crime = index.values.crime.get(area.geographyId)?.value;
          const detail = [
            shared.has(names[position]) && names[position] !== area.name ? area.name : null,
            price ? `${formatPerSquareMetre(price.value)}${price.wider ? " (wider area)" : ""}` : null,
            crime != null ? `${formatCrimeRate(crime)} crimes per 1,000` : null,
          ].filter(Boolean).join(" · ");
          return (
            <li key={area.geographyId}>
              <Link href={areaPath(area)}>{names[position]}</Link>
              {detail && <span className="area-page__note">{detail}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Generated questions as <details>, plus the same text as FAQPage JSON-LD. */
export function AreaFaq({ facts, london }: { facts: AreaFacts; london: AreaFacts | null }) {
  const items = buildFaq(facts, london);
  return (
    <section className="methodology-card area-page__faq" aria-labelledby="area-faq-title" data-testid="area-faq">
      <h2 id="area-faq-title">Questions people ask</h2>
      {items.map((item) => (
        <details key={item.id} className="area-page__question" data-faq={item.id}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(items) }} />
    </section>
  );
}

export function RankingLinks({ current, available = RANKINGS }: { current?: string; available?: readonly RankingDefinition[] }) {
  return (
    <section className="methodology-card area-page__nav" aria-label="London rankings" data-testid="ranking-links">
      <h2>London rankings</h2>
      <ul className="area-page__list area-page__list--wide">
        {available.map((ranking) => (
          <li key={ranking.slug}>
            {ranking.slug === current
              ? <span aria-current="page">{ranking.title}</span>
              : <Link href={`/rankings/${ranking.slug}`}>{ranking.title}</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}

