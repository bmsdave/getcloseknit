"use client";

/**
 * Visit & links (board "School page · Visit & links"): every onward place for one school. The website
 * is the one dark button, Admissions and Call sit under it, then Official and Guides. Every link is a /go click-out
 * the API built (it rebuilds the destination from the URN), counted here as a portal_click (lib/usage.ts honours
 * Analytics off); the phone is a tel: link, counted the same way. The ☰ menu keeps sources and method only.
 */
import { KnitIcon } from "@/components/knit/knit-icon";
import { linkTiles, type LinkTile, type OfstedStanding, type SchoolLinks } from "@/lib/school-card";
import { track } from "@/lib/usage";

const count = (portal: string) => () => track("portal_click", { portal, kind: "school", from: "school" });

const TILE_ICON: Record<string, string> = {
  ofstedReport: "note", dfePerformance: "trend", parentView: "heart", councilAdmissions: "key", gias: "building-school",
  eAdmissions: "check", goodSchoolsGuide: "book", locrating: "pin",
};

function Row({ tile }: { tile: LinkTile }) {
  return (
    <a className="sc-link-row" href={tile.href} target="_blank" rel="noopener" onClick={count(tile.portal)} data-testid="school-link" data-link={tile.key}>
      <KnitIcon name={TILE_ICON[tile.key] ?? "arrow-out"} className="sc-link-row__icon" />
      <span className="sc-link-row__text">
        <span className="sc-link-row__title">{tile.title}</span>
        <span className="sc-link-row__sub">{tile.sub}</span>
      </span>
      <KnitIcon name="arrow-out" colour="currentColor" className="sc-link-row__out" />
    </a>
  );
}

export function SchoolLinksBody({ links, standing }: { links: SchoolLinks; standing: OfstedStanding | null }) {
  const { official, guides } = linkTiles(links, standing);
  const { website, admissions, phone } = links;
  return (
    <div className="sc-links" data-testid="school-links">
      <div className="sc-links__visit">
        {website?.href ? (
          <a className="sc-link-site" href={website.href} target="_blank" rel="noopener" onClick={count(website.portal)} data-testid="school-website">
            <KnitIcon name="globe" colour="currentColor" className="sc-link-site__icon" />
            <span className="sc-link-row__text">
              <span className="sc-link-site__title">School website</span>
              <span className="sc-link-site__sub">{website.host} · from GIAS</span>
            </span>
            <KnitIcon name="arrow-out" colour="currentColor" className="sc-link-row__out" />
          </a>
        ) : <p className="sc-unknown" data-testid="school-website">No website listed on GIAS</p>}
        <div className="sc-links__pair">
          {admissions.href && (
            <a className="sc-link-tile" href={admissions.href} target="_blank" rel="noopener" onClick={count(admissions.portal)} data-testid="school-admissions-link">
              <span className="sc-link-tile__title"><KnitIcon name="calendar" className="sc-link-tile__icon" />Admissions &amp; open days</span>
              <span className="sc-link-row__sub">{admissions.via === "website" ? "See the school website" : "See the council's page"}</span>
            </a>
          )}
          {phone && (
            <a className="sc-link-tile" href={phone.href} onClick={count("school-phone")} data-testid="school-phone">
              <span className="sc-link-tile__title"><KnitIcon name="phone" className="sc-link-tile__icon" />Call</span>
              <span className="sc-link-row__sub">{phone.number}</span>
            </a>
          )}
        </div>
        <p className="sc-fine">Open days aren&apos;t open data: the school site lists them.</p>
      </div>
      <div className="sc-links__more">
        <h3 className="sc-links__eyebrow">Official</h3>
        <div className="sc-links__grid" data-testid="school-links-official">{official.map((tile) => <Row key={tile.key} tile={tile} />)}</div>
        {guides.length > 0 && (
          <>
            <h3 className="sc-links__eyebrow">Guides</h3>
            <div className="sc-links__grid" data-testid="school-links-guides">{guides.map((tile) => <Row key={tile.key} tile={tile} />)}</div>
          </>
        )}
        <p className="sc-fine">Links open in a new tab. Close Knit counts the click, never what you do there.</p>
      </div>
    </div>
  );
}
