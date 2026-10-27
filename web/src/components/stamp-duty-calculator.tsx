"use client";

import { useEffect, useState } from "react";

import { HelpTip } from "@/components/help-tip";
import { SatinBar, StemDivider } from "@/components/knit/satin";
import { PrefillNote, ToolCheckbox, ToolHandoff, ToolLayout, ToolNumberField, percent, pounds } from "@/components/tools-shell";
import { EXAMPLE_PRICE, carryPrice } from "@/lib/tools";
import { SDLT_ENGLAND_2026_10_05 as TABLE, calculateStampDuty, type SdltBand } from "@/lib/stamp-duty";

export function StampDutyCalculator({ initialPrice, from, sold = null }: { initialPrice: number | null; from: string | null; sold?: string | null }) {
  const [price, setPrice] = useState<number | null>(initialPrice ?? EXAMPLE_PRICE);
  const [firstTimeBuyer, setFirstTimeBuyer] = useState(false);
  const [additionalProperty, setAdditionalProperty] = useState(false);
  const [nonUkResident, setNonUkResident] = useState(false);
  const valid = price !== null && Number.isFinite(price) && price >= 0;
  const result = valid ? calculateStampDuty({ price, firstTimeBuyer, additionalProperty, nonUkResident }) : null;
  // The price rides in the address, so the tabs and the next tool start from it.
  useEffect(() => carryPrice(valid ? price : null), [price, valid]);

  return (
    <>
      <ToolLayout bar={result && <><span>Stamp duty</span> <strong>{pounds(result.total)}</strong> <span>{percent(result.effectiveRatePct)} of the price</span></>}
        inputs={
      <section className="methodology-card tools-card" aria-labelledby="sdlt-inputs">
        <h2 id="sdlt-inputs">Your purchase</h2>
        <PrefillNote price={initialPrice} from={from} sold={sold} />
        <div className="tools-grid">
          <ToolNumberField label="Price" prefix="£" value={price} onChange={setPrice} step="1000" testId="sdlt-price" />
        </div>
        <div className="tools-checks">
          <ToolCheckbox label="I am a first-time buyer" checked={firstTimeBuyer} onChange={setFirstTimeBuyer}>
            <HelpTip id="sdlt-first-time-buyer" />
          </ToolCheckbox>
          <ToolCheckbox label="I will own another home after buying" checked={additionalProperty} onChange={setAdditionalProperty}>
            <HelpTip id="sdlt-additional-property" />
          </ToolCheckbox>
          <ToolCheckbox label="I am not a UK resident" checked={nonUkResident} onChange={setNonUkResident}>
            <HelpTip id="sdlt-non-resident" />
          </ToolCheckbox>
        </div>
      </section>}
        result={
      <section className="methodology-card tools-card" aria-labelledby="sdlt-result" aria-live="polite">
        <h2 id="sdlt-result">Stamp duty to pay</h2>
        {result === null ? (
          <p>Enter a price to see the tax.</p>
        ) : (
          <>
            <p className="tools-headline">
              <strong data-testid="sdlt-total">{pounds(result.total)}</strong>
              <span>{percent(result.effectiveRatePct)} of the price</span>
            </p>
            <p className="tools-subtle">
              {result.regime === "first-time-buyer" ? "First-time buyer rates" : "Standard rates"}
              {result.surchargePct > 0 ? `, plus ${result.surchargePct} percentage points on every band` : ""}.
            </p>
            {result.notes.map((note) => <p key={note} className="tools-note">{note}</p>)}
            <div className="tools-table-wrap">
              <StemDivider className="stem-divider table-stem" />
              <table className="tools-table tools-bands" data-testid="sdlt-bands">
                <caption className="sr-only">Tax for each part of the price</caption>
                <thead><tr><th scope="col">Part of the price</th><th scope="col">Rate</th><th scope="col">Taxed amount</th><th scope="col">Tax</th><th scope="col">Share of tax</th></tr></thead>
                <tbody>
                  {result.bands.map((band) => (
                    <tr key={band.from} className={band.taxable === 0 ? "tools-table__idle" : undefined}>
                      <th scope="row">{bandLabel(band)}</th>
                      <td>{band.ratePct}%</td>
                      <td>{pounds(band.taxable)}</td>
                      <td>{pounds(band.tax, band.tax % 1 === 0 ? 0 : 2)}</td>
                      <td><TaxShare share={result.total > 0 ? band.tax / result.total : 0} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th scope="row" colSpan={3}>Total (rounded down to the pound)</th><td>{pounds(result.total)}</td><td /></tr></tfoot>
              </table>
            </div>
          </>
        )}
        <ToolHandoff price={valid ? price : null} from={price === initialPrice ? from : null} current="stamp-duty" />
      </section>} />
      <RatesTable />
    </>
  );
}

function RatesTable() {
  return (
    <section className="methodology-card tools-card" aria-labelledby="sdlt-rates">
      <h2 id="sdlt-rates">Rates used</h2>
      <p>
        England, residential, for people (not companies). Checked against gov.uk on {longDate(TABLE.inForceOn)}.
        Standard and first-time buyer rates apply from {longDate(TABLE.standardFrom)}; the 5% additional-home
        surcharge from {longDate(TABLE.additionalPropertyFrom)}; the 2% non-resident surcharge from {longDate(TABLE.nonResidentFrom)}.
      </p>
      <div className="tools-rate-tables">
        <BandTable caption="Standard rates" bands={TABLE.standard} />
        <BandTable caption={`First-time buyer (price up to ${pounds(TABLE.firstTimeBuyerMaxPrice)})`} bands={TABLE.firstTimeBuyer} />
      </div>
      <p className="tools-subtle">
        Above {pounds(TABLE.firstTimeBuyerMaxPrice)} first-time buyers pay standard rates on the whole price.
        Not covered: companies, six or more homes, shared ownership and rent on new leases.
      </p>
      <ul className="tools-sources">
        {TABLE.sources.map((source) => <li key={source.url}><a href={source.url} rel="noreferrer" target="_blank">{source.label}</a></li>)}
      </ul>
    </section>
  );
}

/** How much of the whole tax one band carries: a satin meter with the share as text beside it. */
function TaxShare({ share }: { share: number }) {
  return (
    <span className="tools-share">
      <SatinBar value={share} colour="var(--chart-1)" width={48} height={12} />
      <span>{Math.round(share * 100)}%</span>
    </span>
  );
}

function BandTable({ caption, bands }: { caption: string; bands: SdltBand[] }) {
  return (
    <table className="tools-table">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Part of the price</th><th scope="col">Rate</th></tr></thead>
      <tbody>
        {bands.map((band) => <tr key={band.from}><th scope="row">{bandLabel(band)}</th><td>{band.ratePct}%</td></tr>)}
      </tbody>
    </table>
  );
}

function bandLabel(band: { from: number; to: number | null }): string {
  if (band.from === 0 && band.to !== null) return `Up to ${pounds(band.to)}`;
  if (band.to === null) return `Above ${pounds(band.from)}`;
  return `${pounds(band.from + 1)} to ${pounds(band.to)}`;
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
