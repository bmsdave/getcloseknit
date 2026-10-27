"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BarList } from "@/components/charts";
import { HelpTip } from "@/components/help-tip";
import {
  civicBreadcrumb, civicCodes, civicPath, formatCivicDate, formatCouncilTax, formatShare, otherWards, readCivic,
  type CivicPerson, type CivicResponse, type CivicState, type CivicTarget,
} from "@/lib/civic";
import type { DataMode } from "@/lib/map-state";
import { councilTaxBandLabel } from "@/lib/property-profile";
import { fetchSectionJson } from "@/lib/section-fetch";

/**
 * Local government for an area or a postcode: where it sits (England › London
 * › borough › ward › area), the borough's council tax bands, the ward
 * councillors and MP with the day we checked, and the official area codes.
 * compact (Overview): a card with the ward, the MP and council tax Band D,
 * linking to the full details on /civic.
 */
export function CivicSection({ target, mode, compact = false }: { target: CivicTarget; mode: DataMode; compact?: boolean }) {
  const [state, setState] = useState<CivicState>({ status: "loading" });
  const path = civicPath(target);
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void fetchSectionJson<unknown>(path).then((payload) => {
      if (current) setState(payload === null ? { status: "unavailable", reason: "civic-unreachable" } : readCivic(payload, mode));
    });
    return () => { current = false; };
  }, [path, mode]);

  if (compact) return <CivicCard target={target} state={state} />;
  return (
    <section className="civic" data-testid="civic-section" aria-label="Local council and representatives">
      <h2>Local council <HelpTip id="civic-place" label="About where this area sits" /></h2>
      {state.status === "loading" && <p>Loading local council details…</p>}
      {state.status === "unavailable" && <p data-testid="civic-unavailable">Local council details are unknown for this area.</p>}
      {state.status === "available" && <CivicBody civic={state.civic} />}
    </section>
  );
}

function CivicBody({ civic }: { civic: CivicResponse }) {
  const crumbs = civicBreadcrumb(civic);
  const others = otherWards(civic);
  return (
    <>
      <nav aria-label="Where this is">
        <ol className="civic-crumbs" data-testid="civic-breadcrumb">
          {crumbs.map((crumb, index) => (
            <li key={`${crumb.label}-${index}`} aria-current={index === crumbs.length - 1 ? "location" : undefined}>{crumb.label}</li>
          ))}
        </ol>
      </nav>
      {others.length > 0 && (
        <p className="civic-note" data-testid="civic-other-wards">
          Mostly in {civic.wards[0].name ?? civic.wards[0].code} ({formatShare(civic.wards[0].share)} of postcodes); also{" "}
          {others.map((ward) => `${ward.name ?? ward.code} (${formatShare(ward.share)})`).join(", ")}.
        </p>
      )}
      <CouncilTaxTable civic={civic} />
      <Representatives civic={civic} />
      <CodesList civic={civic} />
      <p className="licence-note" data-testid="civic-sources">
        {civic.sources.map((source) => source.attribution).join(" ")}
      </p>
    </>
  );
}

export function CouncilTaxTable({ civic }: { civic: CivicResponse }) {
  const tax = civic.councilTax;
  const band = councilTaxBandLabel(civic.councilTaxBand, civic.withheld);
  return (
    <div className="civic-block" data-testid="civic-council-tax">
      <h3>Council tax{tax ? ` ${tax.financialYear}` : ""} <HelpTip id="council-tax" label="About council tax bands" /></h3>
      {!tax ? <p>Council tax for this borough is unknown.</p> : (
        <>
          <p className="civic-sub">
            Yearly bill by band in {tax.boroughName ?? "this borough"}, {tax.boroughCode?.startsWith("E09") ? "including the Mayor of London's share." : "including every precept levied here."}
            {band ? `This home: ${band}.` : "Your home's band is on the Valuation Office Agency's website."}
          </p>
          <table className="civic-tax">
            <thead><tr><th scope="col">Band</th><th scope="col">Per year</th></tr></thead>
            <tbody>
              {tax.bands.map((band) => (
                <tr key={band.band} className={band.band === "D" ? "civic-tax__d" : undefined}>
                  <th scope="row">{band.band}</th>
                  <td>{formatCouncilTax(band.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Representatives({ civic }: { civic: CivicResponse }) {
  const checked = [civic.fetchedOn.councillors, civic.fetchedOn.mps].filter(Boolean).sort().at(-1) ?? null;
  return (
    <div className="civic-block" data-testid="civic-representatives">
      <h3>Who represents you <HelpTip id="representatives" label="About councillors and MPs" /></h3>
      {civic.subject.kind === "borough" && <p className="civic-sub">Pick a neighbourhood to see its ward councillors.</p>}
      {civic.representedWards.map((ward) => (
        <PeopleList key={ward.code} title={`Councillors for ${ward.name ?? ward.code} ward`}
          people={civic.councillors.filter((person) => person.areaCode === ward.code)}
          empty="Councillors for this ward are unknown." />
      ))}
      {civic.representedConstituencies.map((seat) => (
        <PeopleList key={seat.code} title={`MP for ${seat.name ?? seat.code}`}
          people={civic.mps.filter((person) => person.areaCode === seat.code)}
          empty="No MP is listed for this seat. It may be empty until a by-election." />
      ))}
      <p className="civic-fetched" data-testid="civic-fetched">Checked on {formatCivicDate(checked)}.</p>
    </div>
  );
}

function PeopleList({ title, people, empty }: { title: string; people: CivicPerson[]; empty: string }) {
  return (
    <div className="civic-people">
      <h4>{title}</h4>
      {people.length === 0 ? <p>{empty}</p> : (
        <ul>
          {people.map((person) => (
            <li key={person.name} data-testid="civic-person">
              {person.profileUrl ? <a href={person.profileUrl} rel="noopener noreferrer" target="_blank">{person.name}</a> : <strong>{person.name}</strong>}
              <small>
                {person.party ?? "Party unknown"}
                {person.role === "councillor" ? ` · elected ${formatCivicDate(person.electedOn)}` : ` · MP since ${formatCivicDate(person.electedOn)}`}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CodesList({ civic }: { civic: CivicResponse }) {
  const { subject } = civic;
  return (
    <div className="civic-block" data-testid="civic-codes">
      <h3>Official area codes <HelpTip id="civic-codes" label="About official area codes" /></h3>
      <dl className="civic-codes">
        {civicCodes(civic).map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.code ? <>{row.name ?? "Name unknown"} <code>{row.code}</code></> : "unknown"}</dd>
          </div>
        ))}
        {subject.kind === "postcode" && (
          <div>
            <dt>Postcode first used</dt>
            <dd>{formatCivicDate(subject.introduced)}{subject.terminated ? ` (no longer used since ${formatCivicDate(subject.terminated)})` : ""}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function civicHref(target: CivicTarget): string {
  return "geographyId" in target ? `/civic?area=${encodeURIComponent(target.geographyId)}` : `/civic?postcode=${encodeURIComponent(target.postcode)}`;
}

/** Overview card: who represents the area and what Band D costs; the rest is one link away. */
function CivicCard({ target, state }: { target: CivicTarget; state: CivicState }) {
  return (
    <section className="overview-card civic-card" data-testid="civic-section" aria-labelledby="civic-card-title">
      <div className="overview-card__head">
        <h2 id="civic-card-title">Local council</h2>
        <HelpTip id="civic-place" label="About where this area sits" />
      </div>
      {state.status === "loading" && <p className="civic-card__status">Loading…</p>}
      {state.status === "unavailable" && <p className="civic-card__status" data-testid="civic-unavailable">Local council details are unknown.</p>}
      {state.status === "available" && <CivicCardBody civic={state.civic} />}
      <Link className="civic-card__more" href={civicHref(target)} data-testid="civic-more">All council details</Link>
    </section>
  );
}

function CivicCardBody({ civic }: { civic: CivicResponse }) {
  const ward = civic.representedWards[0] ?? civic.place.ward;
  const seat = civic.representedConstituencies[0] ?? civic.place.constituency;
  const mp = seat ? civic.mps.find((person) => person.areaCode === seat.code) ?? null : null;
  const tax = civic.councilTax;
  const bandD = tax?.bands.find((band) => band.band === "D")?.amount ?? null;
  const rows = (tax?.bands ?? [])
    .filter((band): band is typeof band & { amount: number } => band.amount !== null)
    .map((band) => ({ id: band.band, label: band.band, value: band.amount, display: formatCouncilTax(band.amount) }));
  return (
    <>
      <dl className="civic-card__who" data-testid="civic-compact-who">
        <div><dt>Ward</dt><dd>{ward ? ward.name ?? ward.code : "unknown"}</dd></div>
        <div><dt>MP</dt><dd>{mp ? <>{mp.name}{mp.party && <small> {mp.party}</small>}</> : "unknown"}</dd></div>
      </dl>
      <div className="civic-card__tax" data-testid="civic-band-d">
        <span className="civic-card__tax-label">Council tax, Band D{tax ? ` ${tax.financialYear}` : ""}</span>
        <span className="civic-card__tax-value">{formatCouncilTax(bandD)}{bandD !== null && <small> a year</small>}</span>
      </div>
      {rows.length > 0 && (
        <div className="civic-card__bands">
          <BarList rows={rows} label={`Council tax a year by band in ${tax?.boroughName ?? "this borough"}`} />
        </div>
      )}
      <details className="chart-sources">
        <summary>Sources &amp; method</summary>
        <div className="chart-sources__body" data-testid="civic-sources">
          {civic.sources.map((source) => <p key={source.id}>{source.attribution}</p>)}
        </div>
      </details>
    </>
  );
}
