import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackToArea, Breadcrumbs } from "@/components/entity-nav";
import { PrintButton } from "@/components/print-button";
import { SiteHeader } from "@/components/site-header";
import { Term } from "@/components/term";
import { areaTitle } from "@/lib/area-labels";
import type { GeographyId, Carrier } from "@/lib/contracts";
import { loadAreaTrail } from "@/lib/area-pages-data";
import { serverArea, serverAreaPack } from "@/lib/deployment";
import { areaCrumbs, crumbName } from "@/lib/entity-nav";
import { BreadcrumbData } from "@/components/breadcrumb-data";
import { retryLaterForCrawlers } from "@/components/unavailable-page";
import { buildMarketPack, renderPackMarkdown, type PackSection } from "@/lib/market-pack";
import { pageMetadata } from "@/lib/seo";
import { OpenOnPrint } from "./open-on-print";

// Wave 1 / feature 6: a printable, cited evidence pack for one area (and,
// with ?address=, that address's building and street sale aggregates). Server
// rendered so it prints, links and can be read by crawlers without scripts.
// Conclusions first; each section folds; citations are numbered footnotes
// into the Sources list, which carries the release ids.

interface PackPageProps {
  params: Promise<{ carrier: string; code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ADDRESS_PATTERN = /^uk:addr:[0-9a-f]{12}$/;

/** Sections that start folded: the limits are for checking, not first reading. */
const FOLDED: ReadonlySet<PackSection["id"]> = new Set(["limits"]);

export async function generateMetadata({ params }: PackPageProps): Promise<Metadata> {
  const { carrier, code } = await params;
  const path = `/area/${encodeURIComponent(carrier)}/${encodeURIComponent(code)}`;
  // The area by the name people use, as its page and crumbs name it; the code only when the trail is unknown.
  const area = /^(lsoa|msoa|lad)$/.test(carrier) && /^E\d{8}$/.test(code)
    ? (await loadAreaTrail(`uk:${carrier as Carrier}:${code}`)).at(-1) : undefined;
  const name = area ? crumbName(area) : `${carrier.toUpperCase()} ${code}`;
  return pageMetadata({
    title: `${name}: area evidence pack`,
    description: `${name}: local market depth, crime, noise and nearby schools, each figure cited ` +
      "to its public source release. Aggregates only: no valuation and no listings.",
    // The pack's own address filter (?address=) never reaches the canonical or the card.
    path: `${path}/pack`,
    image: `${path}/opengraph-image`,
  });
}

export default async function AreaPackPage({ params, searchParams }: PackPageProps) {
  const { carrier, code } = await params;
  if (!/^(lsoa|msoa|lad)$/.test(carrier) || !/^E\d{8}$/.test(code)) notFound();
  const geography: GeographyId = `uk:${carrier as Carrier}:${code}`;
  const { address: rawAddress } = await searchParams;
  const address = typeof rawAddress === "string" && ADDRESS_PATTERN.test(rawAddress) ? rawAddress : undefined;
  const [result, trail, friendly] = await Promise.all([
    serverAreaPack(geography, address), loadAreaTrail(geography),
    carrier === "lsoa" ? serverArea(geography).then((area) => area.friendly) : null,
  ]);
  if (result.status === 404) notFound();
  // The area's breadcrumbs and (for a neighbourhood) the way back to its page.
  const crumbs = areaCrumbs(trail, friendly?.friendlyName?.trim() || (trail.length ? null : `${carrier.toUpperCase()} ${code}`));
  const back = (
    <div className="no-print">
      <Breadcrumbs crumbs={crumbs} label="Where this area sits" />
      <BreadcrumbData crumbs={[...crumbs, { label: "Evidence pack", href: null }]} path={`/area/${carrier}/${code}/pack`} />
      {carrier === "lsoa" && <BackToArea geographyId={geography} name={friendly?.friendlyName?.trim() || trail.at(-1)?.name || code} />}
    </div>
  );
  if (!result.pack) {
    if (result.status !== 400) await retryLaterForCrawlers(result.status, "evidence pack");
    return (
      <main className="methodology market-pack" data-testid="market-pack-unavailable">
        <SiteHeader />
        {back}
        <h1>Evidence pack unavailable.</h1>
        <p className="methodology-intro">
          {result.status === 400
            ? "That address is not inside this area. Open the pack from the address's own area instead."
            : "The evidence service did not answer. Try again in a moment."}
        </p>
      </main>
    );
  }
  const doc = buildMarketPack(result.pack, { demo: result.mode === "demo" });
  // The heading is the name people use ("Highbury · N5"); the official name sits beneath it.
  const { title, code: officialName } = areaTitle(doc.areaName, friendly);
  // Footnote numbers follow the Sources list order.
  const footnote = new Map(doc.sources.map((source, index) => [source.release, index + 1]));
  return (
    <main className="methodology market-pack" data-testid="market-pack">
      <OpenOnPrint selector=".market-pack" />
      <SiteHeader />
      {back}
      <p className="eyebrow">Area evidence pack</p>
      <h1>{title ?? doc.areaName}</h1>
      {officialName && <p className="market-pack__official" data-testid="market-pack-official">{officialName}</p>}
      <p className="methodology-intro" data-testid="market-pack-meta">
        {carrier.toUpperCase()} {code} · generated {doc.generatedAt.slice(0, 10)}
        {doc.demo ? " · Preview data, not for decisions." : "."}
      </p>
      <section className="methodology-card pack-summary" data-testid="pack-summary" aria-labelledby="pack-summary-heading">
        <h2 id="pack-summary-heading">In short</h2>
        <ul>{doc.summary.map((line) => <li key={line}>{line}</li>)}</ul>
        <p data-testid="pack-scope">
          Recorded <Term id="price-paid">Price Paid</Term> sales, police-recorded crime, modelled noise and nearby
          schools. Counts, shares and medians only: no valuation, no listings and no list of addresses.{" "}
          <Term id="leasehold">Leasehold</Term> is shown as a share of sales, not of homes. Every figure is cited
          below; numbers in brackets point to the sources.
        </p>
        <PrintButton label="Print this pack" />
      </section>
      {doc.sections.map((section) => (
        <details key={section.id} className="methodology-card pack-section" data-testid={`pack-${section.id}`}
          open={!FOLDED.has(section.id)}>
          <summary><h2>{section.heading}</h2></summary>
          <ul>
            {section.lines.map((line, index) => {
              const number = line.source ? footnote.get(line.source.release) : undefined;
              return (
                <li key={index} data-kind={line.kind}>
                  {line.text}
                  {line.source && number !== undefined && (
                    <sup className="pack-cite">
                      <a href={`#pack-source-${number}`} aria-label={`Source ${number}: ${line.source.label}`}>[{number}]</a>
                    </sup>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ))}
      <section className="methodology-card" data-testid="pack-sources">
        <h2>Sources</h2>
        <ol className="pack-sources">
          {doc.sources.map((source, index) => (
            <li key={source.release} id={`pack-source-${index + 1}`}>
              {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : source.label}
              <small> · release {source.release}</small>
            </li>
          ))}
        </ol>
        <p className="quality-note" data-testid="pack-release">
          {doc.geographyId} · product release {doc.release}
        </p>
        <p><Link href="/guide">Guide</Link> · <Link href="/guide/glossary">Glossary</Link></p>
      </section>
      <details className="methodology-card no-print">
        <summary>Markdown copy</summary>
        <pre className="pack-markdown" data-testid="market-pack-markdown">{renderPackMarkdown(doc)}</pre>
      </details>
    </main>
  );
}
