import type { Metadata } from "next";
import { connection } from "next/server";

import { AreaPageShell, DemoNote } from "@/components/area-pages";
import { BreadcrumbData } from "@/components/breadcrumb-data";
import { Breadcrumbs } from "@/components/entity-nav";
import {
  availableRankings, boroughTable, RANKING_GROUPS, RANKING_TILES, rankingBySlug, rankingGroupAnchor, rankingPreview, tileGoodPair, type RankingGroup,
} from "@/lib/area-pages";
import { loadAreaPages } from "@/lib/area-pages-data";
import { pageMetadata } from "@/lib/seo";

import { RankingTileCard, type TileVariant } from "./ranking-tile";
import "./rankings.css";

export const metadata: Metadata = pageMetadata({
  title: "London area rankings: best areas to live",
  description: "London areas ranked by house prices, crime, schools, transport, deprivation and income; state schools by results and Ofsted; and boroughs side by side.",
  path: "/rankings",
});

const CRUMBS = [{ label: "London", href: "/area/london" }, { label: "Rankings", href: null }];

/** Each group's yarn: the dot by its name and its tiles' mini bars. */
const GROUP_YARN: Record<RankingGroup | "Boroughs", string> = {
  Boroughs: "var(--yarn-sky)", Cost: "var(--yarn-tangerine)", Safety: "var(--yarn-cherry)", Schools: "var(--yarn-sun)",
  "Getting around": "var(--yarn-cobalt)", "Going out": "var(--yarn-pink)", "Everyday life": "var(--yarn-sky)",
  "Homes & area": "var(--yarn-leaf)",
};

const anchor = rankingGroupAnchor;

/**
 * One compact page. A sticky row of group chips; each group a section of tiles, mirror
 * pairs and home types merged into one tile with a switch, each with its top three. A phone has one
 * column of tiles, a desktop the same tiles in columns (one page at both widths). Boroughs are
 * one table on /area/london.
 */
export default async function RankingsPage() {
  // A ranking whose data is empty is left out (a lens pack not served yet).
  await connection();
  const loaded = await loadAreaPages();
  const index = loaded?.index ?? null;
  const available = new Set(availableRankings(index).map((ranking) => ranking.slug));
  const variant = (slug: string): TileVariant | null => {
    const ranking = rankingBySlug(slug);
    if (!ranking || !available.has(slug)) return null;
    return { slug, title: ranking.title, level: ranking.kind === "school" ? "Schools" : "Areas", top: index ? rankingPreview(index, ranking) : [] };
  };
  const sections = RANKING_GROUPS.map((group) => ({
    group,
    tiles: RANKING_TILES.filter((tile) => tile.group === group)
      .map((tile) => ({ tile, variants: tile.slugs.map((row) => row.map(variant)) }))
      .filter(({ variants }) => variants.flat().some(Boolean)),
  })).filter((section) => section.tiles.length > 0);
  const boroughs = index ? boroughTable(index).slice(0, 3).map((row) => ({ name: row.area.name, display: row.cells.price.display, value: row.cells.price.value })) : [];
  const count = (n: number) => `${n} ${n === 1 ? "ranking" : "rankings"}`;
  return (
    <AreaPageShell testId="rankings-page" className="rankings-index">
      <Breadcrumbs label="Where this sits" crumbs={CRUMBS} />
      <BreadcrumbData crumbs={CRUMBS} path="/rankings" />
      <div className="rankings-index__head">
        <h1>Rankings</h1>
        <p>London areas and schools, best and worst first.</p>
      </div>
      {loaded && <DemoNote mode={loaded.mode} />}
      <nav className="rankings-index__bar" aria-label="Ranking groups" data-testid="ranking-chips">
        <a href={`#${anchor("Boroughs")}`} className="rankings-chip">Boroughs</a>
        {sections.map(({ group }) => <a key={group} href={`#${anchor(group)}`} className="rankings-chip">{group}</a>)}
      </nav>
      <div className="rankings-index__groups">
        <section id={anchor("Boroughs")} className="rankings-group rankings-group--boroughs" aria-labelledby={`${anchor("Boroughs")}-title`}>
          <GroupHead id={anchor("Boroughs")} label="Boroughs" yarn={GROUP_YARN.Boroughs} />
          <ul className="rankings-tiles">
            <RankingTileCard id="boroughs" label="Boroughs side by side" yarn={GROUP_YARN.Boroughs} variants={[[{
              slug: null, href: "/area/london", title: "London boroughs side by side: price, crime, income, schools, families, going out",
              level: "Boroughs", top: boroughs,
            }]]} />
          </ul>
        </section>
        {sections.map(({ group, tiles }) => (
          <section key={group} id={anchor(group)} className="rankings-group" aria-labelledby={`${anchor(group)}-title`}>
            <GroupHead id={anchor(group)} label={group} yarn={GROUP_YARN[group]}
              count={count(tiles.reduce((sum, { variants }) => sum + variants.flat().filter(Boolean).length, 0))} />
            <ul className="rankings-tiles">
              {tiles.map(({ tile, variants }) => (
                <RankingTileCard key={tile.id} id={tile.id} label={tile.label} typeLabels={tile.typeLabels} pair={tile.pair} types={tile.types}
                  yarn={GROUP_YARN[group]} variants={variants} start={tileGoodPair(tile)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AreaPageShell>
  );
}

function GroupHead({ id, label, count, yarn }: { id: string; label: string; count?: string; yarn: string }) {
  return (
    <div className="rankings-group__head">
      <span className="rankings-dot" aria-hidden="true" style={{ background: yarn }} />
      <h2 id={`${id}-title`}>{label}</h2>
      {count && <span className="rankings-group__count">{count}</span>}
    </div>
  );
}
