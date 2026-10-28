import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AreaPageShell, AreaUnavailable, DemoNote, RankingLinks } from "@/components/area-pages";
import { BreadcrumbData } from "@/components/breadcrumb-data";
import { Breadcrumbs } from "@/components/entity-nav";
import { HelpTip } from "@/components/help-tip";
import {
  areaPath, availableRankings, buildRanking, buildSchoolRanking, countExplainer, lensExplainer, lensSources, monthLabel, rankingBySlug,
  rankingBoroughsHref, rankingGroupAnchor, rankingMapHref, rankingPairSwitch, rankingScope, rankingTopHref, schoolColumn, schoolRankingMapHref,
  schoolRankingScope,
  type RankingDefinition, type SchoolRanking,
} from "@/lib/area-pages";
import { loadAreaPages, type LoadedAreaPages } from "@/lib/area-pages-data";
import { pageMetadata } from "@/lib/seo";

import { RankingList, type RankingListRow } from "./ranking-list";
import { RANKING_BAR_COLOUR, rankingTakeaway, typicalNeighbourhood } from "./ranking-view";
import { SchoolRankingList } from "./school-ranking-list";
import "./ranking.css";

interface RankingPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: RankingPageProps): Promise<Metadata> {
  const ranking = rankingBySlug((await params).slug);
  return ranking ? pageMetadata({ title: `${ranking.title} in London`, description: ranking.lead, path: `/rankings/${ranking.slug}` }) : {};
}

export default async function RankingPage({ params }: RankingPageProps) {
  const ranking = rankingBySlug((await params).slug);
  if (!ranking) notFound();
  await connection();
  const loaded = await loadAreaPages();
  if (!loaded) return <AreaUnavailable />;
  // A lens, school list or school count without data has no page (and is left out of the sitemap and the lists).
  if (!availableRankings(loaded.index).includes(ranking)) notFound();
  if (ranking.kind === "school") return <SchoolRankingPage ranking={ranking} loaded={loaded} />;
  const { rows, ranked } = buildRanking(loaded.index, ranking);
  const when = ranking.kind === "metric" ? monthLabel(loaded.index.data.periods[ranking.metric] ?? null)
    : ranking.kind === "count" ? "latest Ofsted list" : "latest places on the map";
  const takeaway = rankingTakeaway(ranking, rows);
  const period = ranking.kind === "metric" ? loaded.index.data.periods[ranking.metric] ?? null : null;
  const listRows: RankingListRow[] = rows.map((row) => ({
    rank: row.rank, name: row.name, href: areaPath(row.area), display: row.display, detail: row.detail, value: row.value,
    parentName: row.parentName, colour: RANKING_BAR_COLOUR, compareId: typicalNeighbourhood(loaded.index, ranking, row),
    mapHref: rankingMapHref(ranking, row.area.geographyId, period),
  }));
  const available = availableRankings(loaded.index);
  const sources = ranking.kind === "lens" ? lensSources(loaded.index, ranking.preset) : [];
  return (
    <AreaPageShell testId="ranking-page">
      <RankingHeader ranking={ranking} onMap={rows.length > 0 ? rankingTopHref(ranking, period) : null} />
      <div className="ranking-switches">
        <RankingSwitch slug={ranking.slug} available={available} />
        <LevelSwitch boroughs={rankingBoroughsHref(ranking)} />
      </div>
      {/* The (?) leads the line so its bubble opens at the left edge, inside a phone screen. */}
      <p className="area-page__method" data-testid="ranking-method">
        <HelpTip id={ranking.help} label={`how ${ranking.title.toLowerCase()} are ranked`} />{" "}
        {rankingScope(ranking.level, rows.length, ranked)}, {when}.
      </p>
      <DemoNote mode={loaded.mode} />
      {takeaway && <p className="ranking-takeaway" data-testid="ranking-takeaway">{takeaway}</p>}
      {rows.length > 0
        ? <RankingList rows={listRows} column={ranking.column} showParent={ranking.level !== "lad"} />
        : <p className="methodology-card">These figures are unknown for now.</p>}
      {ranking.kind === "lens" && (
        <section className="methodology-card" aria-labelledby="ranking-explainer-title" data-testid="ranking-explainer">
          <h2 id="ranking-explainer-title">How the figure is made</h2>
          {lensExplainer(ranking, sources).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <p data-testid="ranking-sources">
            Sources: {sources.map((source, i) => (
              <span key={source.name}>{i > 0 && "; "}<a href={source.url}>{source.name}</a> ({source.attribution}, {source.licence})</span>
            ))}.
          </p>
        </section>
      )}
      {ranking.kind === "count" && (
        <section className="methodology-card" aria-labelledby="ranking-explainer-title" data-testid="ranking-explainer">
          <h2 id="ranking-explainer-title">How the figure is made</h2>
          {countExplainer(ranking).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      )}
      <RankingLinks current={ranking.slug} available={available} />
    </AreaPageShell>
  );
}

/**
 * Most | Least on a mirror pair's page: two links, the shown end marked, the other
 * end left out while it has no data.
 */
function RankingSwitch({ slug, available }: { slug: string; available: readonly RankingDefinition[] }) {
  const pair = rankingPairSwitch(slug);
  const shown = pair?.options.filter((option) => available.some((ranking) => ranking.slug === option.slug)) ?? [];
  if (!pair || shown.length < 2) return null;
  return (
    <nav className="ranking-switch" aria-label={`${pair.label}: order`} data-testid="ranking-switch">
      {shown.map((option) => (
        <Link key={option.slug} href={`/rankings/${option.slug}`} aria-current={option.current ? "page" : undefined}>{option.label}</Link>
      ))}
    </nav>
  );
}

/**
 * Areas | Boroughs (CUJ-10 v4): this page is the areas; the same figure for the boroughs is a column of the one
 * boroughs table, opened sorted this ranking's way. No switch where the table has no such column.
 */
function LevelSwitch({ boroughs }: { boroughs: string | null }) {
  if (!boroughs) return null;
  return (
    <nav className="ranking-switch" aria-label="Areas or boroughs" data-testid="ranking-level-switch">
      <Link href="#ranking-list" aria-current="page">Areas</Link>
      <Link href={boroughs} data-testid="ranking-boroughs">Boroughs</Link>
    </nav>
  );
}

/**
 * London › Rankings › Cost, the title and "On map ↗": an area ranking's top 10 numbered on the map; a school
 * ranking's school dots, a full load so the map reads its Show overlays from the address.
 */
function RankingHeader({ ranking, onMap = null }: { ranking: RankingDefinition; onMap?: string | null }) {
  const crumbs = [
    { label: "London", href: "/area/london" }, { label: "Rankings", href: "/rankings" },
    { label: ranking.group, href: `/rankings#${rankingGroupAnchor(ranking.group)}` },
  ];
  return (
    <>
      <Breadcrumbs label="Where this ranking sits" crumbs={crumbs} />
      <BreadcrumbData crumbs={[...crumbs, { label: ranking.title, href: null }]} path={`/rankings/${ranking.slug}`} />
      <div className="ranking-title">
        <h1>{ranking.title}</h1>
        {onMap && ranking.kind !== "school" && (
          <Link className="ranking-title__map" href={onMap} data-testid="ranking-top-on-map">
            On map <span aria-hidden="true">↗</span>
          </Link>
        )}
        {onMap && ranking.kind === "school" && (
          <a className="ranking-title__map" href={onMap} data-testid="ranking-top-on-map">
            On map <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </>
  );
}

/** Schools on one axis, as the API lists them: its caveats (provisional, last year's, legacy grades) and OGL attribution. */
function SchoolRankingPage({ ranking, loaded }: { ranking: SchoolRanking; loaded: LoadedAreaPages }) {
  const response = loaded.index.data.schoolRankings?.[ranking.slug];
  if (!response) notFound();
  return (
    <AreaPageShell testId="ranking-page">
      <RankingHeader ranking={ranking} onMap={schoolRankingMapHref(ranking)} />
      <p className="area-page__method" data-testid="ranking-method">
        <HelpTip id={ranking.help} label={`how ${ranking.title.toLowerCase()} are listed`} />{" "}
        {schoolRankingScope(ranking, response)}.
      </p>
      <DemoNote mode={loaded.mode} />
      <SchoolRankingList rows={buildSchoolRanking(ranking, response)} column={schoolColumn(ranking, response)} />
      <section className="methodology-card" aria-labelledby="ranking-explainer-title" data-testid="ranking-explainer">
        <h2 id="ranking-explainer-title">About these figures</h2>
        {response.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
        <p>Each school&apos;s name links to its own page with the Department for Education or Ofsted.</p>
        <p data-testid="ranking-sources">Sources: Department for Education and Ofsted. {response.attribution}</p>
      </section>
      <RankingLinks current={ranking.slug} available={availableRankings(loaded.index)} />
    </AreaPageShell>
  );
}
