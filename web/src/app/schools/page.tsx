import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { AreaPageShell, DemoNote } from "@/components/area-pages";
import { Breadcrumbs } from "@/components/entity-nav";
import { SchoolFilterChips, SchoolSearch } from "@/components/schools/school-filters";
import { SchoolList } from "@/components/schools/school-list";
import { Schools101Grid } from "@/components/schools/schools-101-grid";
import { availableRankings, RANKING_TILES, rankingBySlug, rankingPreview, tileGoodPair } from "@/lib/area-pages";
import { loadAreaPages } from "@/lib/area-pages-data";
import { councilWord } from "@/lib/coverage-words";
import { SCHOOLS_101_PATH } from "@/lib/schools-101";
import {
  filterSchools, hubBoroughs, hubPhase, hubScope, listsSchools, NO_FILTERS, readSchoolFilters, schoolsHref, type LondonBorough, type SchoolFilters,
} from "@/lib/schools-hub";
import { loadSchoolDirectory } from "@/lib/schools-hub-data";
import { pageMetadata } from "@/lib/seo";

import { RankingTileCard, type TileVariant } from "../rankings/ranking-tile";
import "../rankings/rankings.css";
import "@/styles/school-filter.css";
import "@/styles/schools-hub.css";

type Search = Promise<Record<string, string | string[] | undefined>>;

const YARN = "var(--yarn-sun)";
/** A hub-wide search or filter shows this many rows; a borough shows all of its schools. */
const LONDON_ROWS = 100;

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const boroughs = hubBoroughs((await loadSchoolDirectory())?.schools ?? []);
  const { borough } = readSchoolFilters(await searchParams, boroughs);
  const scope = hubScope(boroughs);
  return pageMetadata({
    title: borough ? `Schools in ${borough.name}` : `Schools in ${scope}`,
    description: borough
      ? `Every state school in ${borough.name}: Ofsted grades, results and a page for each school.`
      : `${scope}'s state schools: search a school, top lists by results and Ofsted, every ${councilWord(scope === "London")}'s schools, and Schools 101 for families new to the UK system.`,
    path: borough ? `/schools?borough=${borough.slug}` : "/schools",
  });
}

/**
 * /schools (Menu v5 board, owner-reviewed): the entry page for every school. Search, filter chips,
 * the London top lists (the 8 school rankings), every borough's schools (?borough=) and Schools 101.
 * Server-rendered; the chips and the search are plain GET links and a form.
 */
export default async function SchoolsPage({ searchParams }: { searchParams: Search }) {
  await connection();
  const [loaded, directory] = await Promise.all([loadAreaPages(), loadSchoolDirectory()]);
  // Every local authority the school index names (London's 33 always); England's once its schools are loaded.
  const boroughs = hubBoroughs(directory?.schools ?? []);
  const scope = hubScope(boroughs);
  const london = scope === "London";
  const filters = readSchoolFilters(await searchParams, boroughs);
  const index = loaded?.index ?? null;
  const available = new Set(availableRankings(index).map((ranking) => ranking.slug));
  const variant = (slug: string): TileVariant | null => {
    const ranking = rankingBySlug(slug);
    if (!ranking || !available.has(slug)) return null;
    const phase = hubPhase(filters);
    if (phase !== "all" && "phase" in ranking && ranking.phase !== phase) return null;
    return { slug, title: ranking.title, level: ranking.kind === "school" ? "Schools" : "Areas", top: index ? rankingPreview(index, ranking) : [] };
  };
  const tiles = RANKING_TILES.filter((tile) => tile.group === "Schools")
    .map((tile) => ({ tile, variants: tile.slugs.map((row) => row.map(variant)) }))
    .filter(({ variants }) => variants.flat().some(Boolean));
  const { borough } = filters;
  const shown = directory && listsSchools(filters) ? filterSchools(directory.schools, filters) : [];
  const rows = borough ? shown : shown.slice(0, LONDON_ROWS);
  const mode = directory?.mode ?? loaded?.mode;
  return (
    <AreaPageShell testId="schools-page" className="rankings-index schools-hub">
      <Breadcrumbs label="Where this sits" crumbs={[
        { label: scope, href: scope === "London" ? "/area/london" : "/area/england" },
        { label: "Schools", href: borough ? "/schools" : null },
        ...(borough ? [{ label: borough.name, href: null }] : []),
      ]} />
      <div className="rankings-index__head">
        <h1>{borough ? `Schools in ${borough.name}` : `Schools in ${scope}`}</h1>
        <p>Inspections, results, admissions. Living nearby is not a place.</p>
      </div>
      {directory && (
        <p className="schools-hub__stats" data-testid="schools-stats">
          <strong>{directory.schools.length.toLocaleString("en-GB")}</strong> state schools
          <span aria-hidden="true"> · </span><strong>{boroughs.length}</strong> {councilWord(london, true)}
        </p>
      )}
      {mode && <DemoNote mode={mode} />}
      <SchoolSearch filters={filters} />
      <SchoolFilterChips filters={filters} />

      {listsSchools(filters) && (
        <section id="schools-list" className="rankings-group schools-hub__list" aria-labelledby="schools-list-title" data-testid="schools-list">
          <GroupHead id="schools-list" label={borough ? borough.name : filters.q ? `“${filters.q}”` : scope}
            count={directory ? countWords(shown.length) : undefined}>
            {(borough || filters.q) && <Link href={schoolsHref(filters, { borough: null, q: "" })} className="schools-hub__clear">All {scope}</Link>}
          </GroupHead>
          {!directory && <p className="area-page__note">School lists are unavailable. Please try again in a minute.</p>}
          {directory && rows.length === 0 && (
            <p className="area-page__note" data-testid="schools-none">
              No school matches. <Link href={schoolsHref(NO_FILTERS, { borough })}>Clear filters</Link>
            </p>
          )}
          {rows.length > 0 && <SchoolList schools={rows} />}
          {rows.length < shown.length && (
            <p className="area-page__note">First {rows.length} of {shown.length}. Pick a {councilWord(london)} for all.</p>
          )}
        </section>
      )}

      <div className="rankings-index__groups">
        <section id="schools-top" className="rankings-group" aria-labelledby="schools-top-title" data-testid="schools-top-lists">
          {/* The top lists rank London's schools alone: on England's hub they say so (DESIGN.md §6). */}
          <GroupHead id="schools-top" label={london ? "London top lists" : "Top lists"}
            count={`${tiles.reduce((sum, { variants }) => sum + variants.flat().filter(Boolean).length, 0)} lists${london ? "" : " · London only"}`} />
          <ul className="rankings-tiles">
            {tiles.map(({ tile, variants }) => (
              <RankingTileCard key={tile.id} id={tile.id} label={tile.label} typeLabels={tile.typeLabels} pair={tile.pair} types={tile.types}
                yarn={YARN} variants={variants} start={tileGoodPair(tile)} />
            ))}
          </ul>
          {/* Your tops (custom top-N lists) are the board's next step; out of scope for now. */}
          <button type="button" className="schools-chip schools-hub__own" disabled data-testid="schools-own-top">Build your own top · soon</button>
        </section>

        <section id="schools-boroughs" className="rankings-group" aria-labelledby="schools-boroughs-title" data-testid="schools-boroughs">
          <GroupHead id="schools-boroughs" label={london ? "By borough" : "By council"} count={`${boroughs.length}`} />
          <ul className="schools-boroughs">
            {boroughs.map((entry) => (
              <li key={entry.slug}>
                <Link href={`${boroughHref(filters, entry)}#schools-list`} className="schools-borough" data-testid={`schools-borough-${entry.slug}`}
                  aria-current={borough?.slug === entry.slug ? "page" : undefined}>
                  {entry.name}<span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section id="schools-101" className="rankings-group" aria-labelledby="schools-101-title" data-testid="schools-101">
          <GroupHead id="schools-101" label="Schools 101" count="new to the UK system">
            <Link href={SCHOOLS_101_PATH} className="schools-hub__clear">Full guide</Link>
          </GroupHead>
          <Schools101Grid />
        </section>
      </div>
      <p className="area-page__note schools-hub__sources">
        Sources: Department for Education (Get Information About Schools, performance tables), Ofsted. Distance is not a catchment;
        places depend on each school&apos;s admissions.
      </p>
    </AreaPageShell>
  );
}

function boroughHref(filters: SchoolFilters, borough: LondonBorough): string {
  return schoolsHref(filters, { borough, q: "" });
}

function countWords(n: number): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? "school" : "schools"}`;
}

function GroupHead({ id, label, count, children }: { id: string; label: string; count?: string; children?: ReactNode }) {
  return (
    <div className="rankings-group__head">
      <span className="rankings-dot" aria-hidden="true" style={{ background: YARN }} />
      <h2 id={`${id}-title`}>{label}</h2>
      {count && <span className="rankings-group__count">{count}</span>}
      {children}
    </div>
  );
}
