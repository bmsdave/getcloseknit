"use client";

import { useEffect, useState } from "react";

import { ChartFrame, type ChartTone } from "@/components/charts";
import type { GeographyId } from "@/lib/contracts";
import {
  BOROUGH_NAMES,
  PLANNING_STAGES,
  REVIEWED_PLANNING_SOURCE,
  boroughForSelectedArea,
  boroughLabel,
  checkRecordCurrency,
  councilRegisterUrl,
  searchPlanning,
  withdrawnFor,
  type PlanningCurrencyState,
  type PlanningRecord,
  type PlanningStage,
} from "@/lib/planning-evidence";

import { HelpTip } from "./help-tip";
import { SatinSquare } from "./ramp-knit";

const STAGE_TONE: Record<PlanningStage, ChartTone> = { planned: "c5", approved: "c1", completed: "c3" };
const STAGE_LABEL: Record<PlanningStage, string> = { planned: "Planned", approved: "Approved", completed: "Completed" };

export function PlanningContextSection({ selected }: { selected: GeographyId | null }) {
  const [override, setOverride] = useState<string | null>(null);
  const borough = override ?? boroughForSelectedArea(selected);
  const [stage, setStage] = useState("all");
  const [openReference, setOpenReference] = useState<string | null>(null);
  useEffect(() => { setOverride(null); setOpenReference(null); }, [selected]);
  const result = searchPlanning(borough, stage === "all" ? undefined : stage);
  return (
    <section className="planning-context" data-testid="planning-context" aria-label="Planning context">
      <h2 className="et-plan__title">
        Planning context (pilot) <HelpTip id="planning-records" label="planning records" />
      </h2>
      <div className="et-plan__controls">
        <BoroughSelect
          borough={borough}
          onBorough={(next) => { setOverride(next); setOpenReference(null); }}
        />
        <StageSelect
          stage={stage}
          onStage={(next) => { setStage(next); setOpenReference(null); }}
        />
      </div>
      {result.status === "no-coverage" && <Note testId="planning-coverage" message={result.message} />}
      {result.status === "no-records" && <Note testId="planning-empty" message={result.message} />}
      {result.status === "records" && (
        <ResultsList
          borough={borough}
          records={result.records}
          withdrawnExcluded={result.withdrawnExcluded}
          openReference={openReference}
          onOpen={setOpenReference}
        />
      )}
      <details className="chart-sources">
        <summary>Sources &amp; method</summary>
        <div className="chart-sources__body">
          <p>Source: {REVIEWED_PLANNING_SOURCE.name}.</p>
          <dl data-testid="planning-registry" className="et-plan__registry">
            <div><dt>Authority</dt><dd>{REVIEWED_PLANNING_SOURCE.authority}.</dd></div>
            <div><dt>Dataset</dt><dd>{REVIEWED_PLANNING_SOURCE.dataset}, refreshed {REVIEWED_PLANNING_SOURCE.datasetUpdated}.</dd></div>
            <div><dt>Coverage</dt><dd>{REVIEWED_PLANNING_SOURCE.coverage}.</dd></div>
          </dl>
          <p>Stages stay distinct: planned is not approval, approval is not completion.</p>
        </div>
      </details>
    </section>
  );
}

function BoroughSelect({ borough, onBorough }: {
  borough: string;
  onBorough: (borough: string) => void;
}) {
  return (
    <label>Borough
      <select
        aria-label="Borough planning records"
        data-testid="planning-borough"
        value={borough}
        onChange={(event) => onBorough(event.target.value)}
      >
        {Object.entries(BOROUGH_NAMES).map(([code, name]) => (
          <option key={code} value={code}>{name}</option>
        ))}
      </select>
    </label>
  );
}

function StageSelect({ stage, onStage }: {
  stage: string;
  onStage: (stage: string) => void;
}) {
  return (
    <label>Stage
      <select
        aria-label="Decision stage"
        data-testid="planning-stage"
        value={stage}
        onChange={(event) => onStage(event.target.value)}
      >
        <option value="all">All stages</option>
        {PLANNING_STAGES.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

/** Coverage and empty messages, one sentence per line so none reads as a wall of text. */
function Note({ testId, message }: { testId: string; message: string }) {
  return (
    <div className="et-plan__note" data-testid={testId} role="status">
      {message.split(/(?<=[.;])\s+/).map((sentence) => <p key={sentence}>{sentence}</p>)}
    </div>
  );
}

function ResultsList({ borough, records, withdrawnExcluded, openReference, onOpen }: {
  borough: string;
  records: PlanningRecord[];
  withdrawnExcluded: number;
  openReference: string | null;
  onOpen: (reference: string) => void;
}) {
  return (
    <>
      <ChartFrame title="Applications by stage">
        <StageStrip records={records} withdrawn={withdrawnExcluded} />
        <ul className="et-plan__list" data-testid="planning-results">
          {byStage(records).map((record) => (
            <li key={record.reference}>
              <button
                type="button"
                className="et-plan__record"
                data-chart-tone={STAGE_TONE[record.stage]}
                aria-expanded={openReference === record.reference}
                aria-label={`Open ${record.reference}`}
                onClick={() => onOpen(record.reference)}
              >
                <SatinSquare colour="var(--tone)" size={12} className="chart-swatch chart-swatch--satin" />
                <span className="et-plan__record-text">
                  <strong>{record.reference}</strong>
                  <span>{record.title}</span>
                </span>
                <span className="et-plan__stage">{record.stage}</span>
              </button>
            </li>
          ))}
        </ul>
      </ChartFrame>
      {withdrawnExcluded > 0 && (
        <p className="et-caption" data-testid="planning-withdrawn-note" role="status">
          {withdrawnExcluded} withdrawn in {boroughLabel(borough)} left out: {withdrawnTitles(borough)}. Check the council register.
        </p>
      )}
      {records.map((record) => record.reference === openReference && (
        <ProposalDetail key={record.reference} record={record} />
      ))}
    </>
  );
}

/** Planned → approved → completed, one marker per application in each stage. */
function StageStrip({ records, withdrawn }: { records: PlanningRecord[]; withdrawn: number }) {
  const counts = PLANNING_STAGES.map((stage) => ({ stage, count: records.filter((record) => record.stage === stage).length }));
  const sentence = counts.map(({ stage, count }) => `${count} ${stage}`).join(", ") + (withdrawn > 0 ? `, ${withdrawn} withdrawn left out` : "");
  return (
    <div className="chart et-strip" role="img" aria-label={`Applications by stage: ${sentence}`} data-testid="planning-strip">
      {counts.map(({ stage, count }) => (
        <span key={stage} className="et-strip__stage" data-chart-tone={STAGE_TONE[stage]} data-empty={count === 0 ? "" : undefined}>
          <span className="et-strip__track">
            {/* One satin block per application. */}
            {Array.from({ length: count }, (_, index) => <SatinSquare key={index} colour="var(--tone)" size={12} className="et-strip__marker" />)}
          </span>
          <span className="et-strip__label"><strong>{count}</strong> {STAGE_LABEL[stage].toLowerCase()}</span>
        </span>
      ))}
    </div>
  );
}

function ProposalDetail({ record }: { record: PlanningRecord }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [currency, setCurrency] = useState<PlanningCurrencyState | null>(null);
  return (
    <article className="et-plan__detail" data-testid="planning-proposal-detail">
      <h3>{record.reference}: {record.title}</h3>
      <dl>
        <div><dt>Stage</dt><dd>{record.stage}</dd></div>
        <div><dt>Decision state</dt><dd>{record.decision}</dd></div>
        <div><dt>National entry updated</dt><dd>{record.updated ?? "not dated (unverified)"}</dd></div>
        <div><dt>Overlapping constraints</dt><dd>{constraintText(record)}</dd></div>
      </dl>
      <div className="et-plan__actions">
        <button
          type="button"
          className="chip-button"
          data-testid="planning-source-toggle"
          aria-expanded={sourceOpen}
          onClick={() => setSourceOpen((value) => !value)}
        >
          {sourceOpen ? "Hide source and register link" : "Show source and register link"}
        </button>
        <button
          type="button"
          className="chip-button"
          data-testid="planning-currency-check"
          onClick={() => setCurrency(checkRecordCurrency(record))}
        >
          Check whether this entry is current
        </button>
      </div>
      {sourceOpen && <SourceDetail record={record} />}
      {currency !== null && (
        <p data-testid="planning-currency" data-allow-prose="" role="status">{currency.status}: {currency.explanation}</p>
      )}
    </article>
  );
}

function SourceDetail({ record }: { record: PlanningRecord }) {
  return (
    <div data-testid="planning-source-detail">
      <p>Authority: {REVIEWED_PLANNING_SOURCE.authority}; dataset {REVIEWED_PLANNING_SOURCE.dataset}, refreshed {REVIEWED_PLANNING_SOURCE.datasetUpdated}.</p>
      <p>
        <a data-testid="planning-source-link" href={councilRegisterUrl(record)}>
          Council register entry for {record.reference}
        </a>
        {" "}— the authoritative next step; national entries can lag the register.
      </p>
    </div>
  );
}

/** Planned first, as the strip reads. */
function byStage(records: PlanningRecord[]): PlanningRecord[] {
  return [...records].sort((a, b) => PLANNING_STAGES.indexOf(a.stage) - PLANNING_STAGES.indexOf(b.stage));
}

function withdrawnTitles(borough: string): string {
  return withdrawnFor(borough).map((entry) => entry.reference).join(", ");
}

function constraintText(record: PlanningRecord): string {
  if (record.constraints.length === 0) return "none mapped in this pilot";
  return record.constraints.join(", ");
}
