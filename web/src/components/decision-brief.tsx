"use client";

import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";

import { buildAreaComparison } from "@/lib/area-comparison";
import type { AreaBrief } from "@/lib/brief-model";
import type { GeographyId, MatchPack, MetricDefinition, PreferenceProfile, SaleRecord } from "@/lib/contracts";
import {
  buildDecisionBrief,
  privacyNote,
  releaseNote,
  renderBriefMarkdown,
  tradeOffsText,
  verdictHeading,
  type BriefLine,
  type BriefRedaction,
  type BriefViewingEvidence,
  type DecisionBrief,
} from "@/lib/decision-brief";
import { METRICS, PROPERTY_HISTORIES } from "@/lib/fixtures";
import { EMPTY_ASSUMPTIONS, buildCostWorksheet, type CostAssumptions } from "@/lib/housing-cost";
import { EMPTY_LEASEHOLD_FACTS } from "@/lib/leasehold";
import { assessNoiseCandidate } from "@/lib/noise-evidence";
import type { DataMode } from "@/lib/map-state";
import { fetchSectionJson } from "@/lib/section-fetch";
import { readStandouts, standoutsPath } from "@/lib/standouts";
import { areaDisplayName } from "@/lib/area-labels";
import { titleDistrict } from "@/lib/portal-zones";
import { comparedBriefHref, type ShareInclusions } from "@/lib/saved-shortlists";
import { toolHref } from "@/lib/tools";
import { loadUserCandidates, type UserCandidate } from "@/lib/user-candidates";
import { buildViewingChecklist, loadViewingPlan, questionState } from "@/lib/viewing-checklist";
import { KnitIcon } from "./knit/knit-icon";
import { BriefNextSteps } from "./match/portal-links";
import { useShareLink } from "./match/share-link";
import { ShareReview } from "./share-review";
import { useCandidateHistories } from "./user-candidates";
import "../styles/decision-brief.css";

const DEMO_HISTORIES: Record<string, SaleRecord> = Object.fromEntries(
  PROPERTY_HISTORIES.map((history) => [history.uprn, history]),
);

const PRINT_CSS = [
  "@media print {",
  "  body * { visibility: hidden; }",
  '  [data-testid="decision-brief-preview"], [data-testid="decision-brief-preview"] * { visibility: visible; }',
  '  [data-testid="decision-brief-preview"] { position: absolute; inset: 0; }',
  "  [data-print-open][hidden] { display: block !important; }",
  "  .brief-fold__toggle, .brief-actions { display: none !important; }",
  "}",
].join("\n");

interface DecisionBriefProps {
  pack: MatchPack | null;
  profile: PreferenceProfile;
  compared: GeographyId[];
  mode: DataMode;
  /** The search brief behind the result cards: the brief prices areas with the card's figure. */
  brief?: AreaBrief | null;
  /** /brief#shortlist= and Make my brief: the brief shows straight away, with no "Preview" step. */
  autoPreview?: boolean;
  /** The view's own heading in place of "Decision brief" (told whether the brief is ready). */
  header?: (ready: boolean) => ReactNode;
  /** A shared brief opened without its budget: no limit figure anywhere in it. */
  budgetShared?: boolean;
  /**
   * A brief opened from someone else's link: what came with it (exact places, notes). No private-detail
   * ticks, no homes of this device, no Copy link, and "the" limit rather than "your".
   */
  shared?: { places: boolean; notes: boolean };
}

/** Real mode: the release's metric definitions (none until they load); demo: the fixtures'. */
function useBriefMetrics(mode: DataMode): MetricDefinition[] {
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  useEffect(() => {
    if (mode !== "real") return;
    let current = true;
    void fetchSectionJson<{ metrics?: MetricDefinition[] }>("/api/v1/metrics").then((payload) => {
      if (current && payload?.metrics) setMetrics(payload.metrics);
    });
    return () => { current = false; };
  }, [mode]);
  return mode === "real" ? metrics : METRICS;
}

type Assembled =
  | { ok: true; brief: DecisionBrief }
  | { ok: false; reason: string };

export function DecisionBriefPanel(props: DecisionBriefProps) {
  const [candidates, setCandidates] = useState<UserCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [includeDestinations, setIncludeDestinations] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [previewed, setPreviewed] = useState(props.autoPreview ?? false);
  const [assumptions, setAssumptions] = useState<CostAssumptions>(EMPTY_ASSUMPTIONS);
  const metrics = useBriefMetrics(props.mode);
  const profiled = useCandidateHistories(props.mode === "real" ? candidates.map((candidate) => candidate.uprn) : []);
  const histories = props.mode === "real" ? profiled : DEMO_HISTORIES;
  const cons = useAreaCons(props.compared, props.mode);
  useEffect(() => {
    const loaded = loadUserCandidates();
    setCandidates(loaded.store.candidates);
    setSelected(loaded.store.candidates.map((candidate) => candidate.id));
  }, []);
  function openPreview() {
    const loaded = loadUserCandidates();
    setCandidates(loaded.store.candidates);
    setSelected((current) =>
      current.length > 0 ? current : loaded.store.candidates.map((candidate) => candidate.id));
    setPreviewed(true);
  }
  // Someone else's brief: it shows what its link carries, and none of the owner's choices are offered.
  const redaction: BriefRedaction = props.shared
    ? { includeDestinations: props.shared.places, includeNotes: props.shared.notes, includeBudget: props.budgetShared !== false, shared: true }
    : { includeDestinations, includeNotes, includeBudget: props.budgetShared !== false };
  const assembled: Assembled | null = previewed
    ? assembleBrief(props, { candidates: props.shared ? [] : candidates, histories, metrics, cons }, selected, assumptions, redaction)
    : null;
  return (
    <section className="decision-brief" data-testid="decision-brief" data-shared={props.shared ? "" : undefined} aria-label="Decision brief">
      {props.header ? props.header(assembled?.ok ?? false) : <h2>Decision brief</h2>}
      {!props.shared && (
        <>
          <CandidateSelector candidates={candidates} selected={selected} onSelected={setSelected} />
          <RedactionToggles
            includeDestinations={includeDestinations}
            onDestinations={setIncludeDestinations}
            includeNotes={includeNotes}
            onNotes={setIncludeNotes}
          />
        </>
      )}
      {!previewed && <button type="button" className="decision-brief__make" onClick={openPreview}>Preview decision brief</button>}
      {assembled && !assembled.ok && <p className="decision-brief__status" role="status">{assembled.reason}</p>}
      {assembled && assembled.ok && (
        <>
          <BriefPreview brief={assembled.brief} markdown={renderBriefMarkdown(assembled.brief)}
            share={props.pack && !props.shared ? {
              profile: props.profile,
              candidates: nextAreas(props).map((area) => area.name),
              // A shared brief carries only what the review included (budget, exact places, notes).
              href: (inclusions) => comparedBriefHref({ pack: props.pack!, compared: props.compared, profile: props.profile, mode: props.mode, ...inclusions }),
            } : null} />
          {/* No dead end: each area's page and its homes on the portals. */}
          <BriefNextSteps areas={nextAreas(props)} profile={props.profile} />
        </>
      )}
      {/* Costs are optional: the brief stands without them, so they wait folded up after it. They price this device's
          homes, so a shared brief (no homes of its own) has none. */}
      {!props.shared && (
        <Fold label="Add costs (optional)" className="decision-brief__costs" testId="brief-costs">
          <CostCapture market={props.profile.market} assumptions={assumptions} onAssumptions={setAssumptions} />
        </Fold>
      )}
      <style>{PRINT_CSS}</style>
    </section>
  );
}

/** The compared areas with the names people use and their postcode district (for the portals). */
function nextAreas(props: DecisionBriefProps): { geographyId: GeographyId; name: string; outcode: string | null }[] {
  return props.compared.map((id) => {
    const result = props.pack?.values.find((entry) => entry.geographyId === id);
    const area = props.brief?.areas.find((entry) => entry.geographyId === id);
    return {
      geographyId: id,
      name: (result && areaDisplayName(result)) ?? result?.name ?? id,
      outcode: area?.outcodes[0] ?? titleDistrict(result?.title ?? result?.name),
    };
  });
}

interface BriefSources {
  candidates: UserCandidate[];
  histories: Record<string, SaleRecord>;
  metrics: MetricDefinition[];
  /** Each compared area's standout cons, by id (useAreaCons). */
  cons: Record<string, string[]>;
}

/**
 * Each compared area's standout cons ("More polluted than 99% of London"; CUJ03 board: every area shows its
 * trade-offs), from the standouts answer the area view reads (cached per page). People, income and social housing
 * never make a tag (API rule), so none shows here.
 */
function useAreaCons(ids: readonly GeographyId[], mode: DataMode): Record<string, string[]> {
  const key = ids.join(",");
  const [cons, setCons] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!key) return;
    let current = true;
    void Promise.all((key.split(",") as GeographyId[]).map(async (id) => {
      const standouts = readStandouts(await fetchSectionJson<unknown>(standoutsPath(id)), mode);
      return [id, (standouts?.tags ?? []).filter((tag) => tag.kind === "con").map((tag) => tag.text)] as const;
    })).then((found) => {
      if (current) setCons(Object.fromEntries(found));
    });
    return () => { current = false; };
  }, [key, mode]);
  return cons;
}

function assembleBrief(
  props: DecisionBriefProps,
  sources: BriefSources,
  selected: string[],
  assumptions: CostAssumptions,
  redaction: BriefRedaction,
): Assembled {
  try {
    return { ok: true, brief: buildDecisionBrief(briefInput(props, sources, selected, assumptions, redaction)) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Brief unavailable." };
  }
}

function briefInput(
  props: DecisionBriefProps,
  { candidates, histories, metrics, cons }: BriefSources,
  selected: string[],
  assumptions: CostAssumptions,
  redaction: BriefRedaction,
) {
  let comparison = null;
  let comparisonError: string | null = props.pack ? null : "Match results are still loading.";
  if (props.pack) {
    try {
      // AE-09: places travelled to stay "Your place 1" unless the household includes destinations.
      comparison = buildAreaComparison(props.pack, props.compared, props.profile,
        { brief: props.brief, redactPlaces: !redaction.includeDestinations, redactBudget: redaction.includeBudget === false, shared: redaction.shared });
    } catch (error) {
      comparisonError = error instanceof Error ? error.message : "Comparison unavailable.";
    }
  }
  const chosen = candidates.filter((candidate) => selected.includes(candidate.id));
  return {
    profile: props.profile,
    comparison,
    comparisonError,
    candidates: chosen.map((candidate) => ({
      candidate,
      history: candidate.uprn ? (histories[candidate.uprn] ?? null) : null,
      lease: EMPTY_LEASEHOLD_FACTS,
    })),
    viewing: viewingFor(props, buildCostWorksheet(props.profile.market, assumptions).missing, redaction),
    costs: { assumptions },
    metrics,
    cons,
    redaction,
    mode: props.mode,
  };
}

function viewingFor(
  props: DecisionBriefProps,
  costUnknowns: string[],
  redaction: BriefRedaction,
): BriefViewingEvidence[] {
  const store = loadViewingPlan().store;
  return props.compared.map((id) => {
    const name = props.pack?.values.find((result) => result.geographyId === id)?.name ?? id;
    const questions = buildViewingChecklist(
      { id, name },
      {
        profile: props.profile,
        lease: EMPTY_LEASEHOLD_FACTS,
        history: null,
        // The road-noise pilot boxes are demo data; real noise lives on the area page.
        noise: props.mode === "real" ? null : assessNoiseCandidate(id),
        costUnknowns,
      },
      { redactDestinations: !redaction.includeDestinations },
    );
    return {
      candidateName: name,
      items: questions.map((question) => {
        const state = questionState(store, id, question.id);
        return {
          id: question.id,
          text: question.text,
          status: state.status,
          note: redaction.includeNotes && state.note !== "" ? state.note : null,
        };
      }),
    };
  });
}

function CandidateSelector({ candidates, selected, onSelected }: {
  candidates: UserCandidate[];
  selected: string[];
  onSelected: (ids: string[]) => void;
}) {
  if (candidates.length === 0) {
    // Homes with an asking price are saved in Check a home (there is no "Plan & check" any more).
    return (
      <p className="decision-brief__hint" data-testid="brief-candidates-hint">
        To add a home&apos;s asking price, save it in <Link href={toolHref("check-a-home")}>Check a home</Link>.
      </p>
    );
  }
  function toggle(id: string) {
    onSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }
  return (
    <fieldset className="brief-candidates">
      <legend>Homes in this brief</legend>
      {candidates.map((candidate) => (
        <label key={candidate.id}>
          <input
            type="checkbox"
            checked={selected.includes(candidate.id)}
            onChange={() => toggle(candidate.id)}
            aria-label={`Include ${candidate.address.value} in brief`}
          />
          {candidate.address.value} · {candidate.asking ? `asking £${candidate.asking.value.amount.toLocaleString("en-GB")} (your figure)` : "no asking price yet"}
        </label>
      ))}
    </fieldset>
  );
}

function RedactionToggles({ includeDestinations, onDestinations, includeNotes, onNotes }: {
  includeDestinations: boolean;
  onDestinations: (value: boolean) => void;
  includeNotes: boolean;
  onNotes: (value: boolean) => void;
}) {
  return (
    <fieldset className="brief-redaction">
      <legend>Private details (left out unless you tick them)</legend>
      <label>
        <input type="checkbox" checked={includeDestinations} onChange={(event) => onDestinations(event.target.checked)} />
        Include precise commute destinations
      </label>
      <label>
        <input type="checkbox" checked={includeNotes} onChange={(event) => onNotes(event.target.checked)} />
        Include private notes
      </label>
    </fieldset>
  );
}

function CostCapture({ market, assumptions, onAssumptions }: {
  market: "buy" | "rent";
  assumptions: CostAssumptions;
  onAssumptions: (value: CostAssumptions) => void;
}) {
  const set = (changes: Partial<CostAssumptions>) => onAssumptions({ ...assumptions, ...changes });
  return (
    <fieldset className="brief-costs">
      <legend className="sr-only">Cost figures for this brief</legend>
      {market === "buy" ? (
        <>
          <MoneyField label="Price (£)" value={assumptions.price} onChange={(price) => set({ price })} />
          <MoneyField label="Deposit (£)" value={assumptions.deposit} onChange={(deposit) => set({ deposit })} />
          <MoneyField label="Interest rate (% a year)" value={assumptions.annualInterestRatePct} onChange={(annualInterestRatePct) => set({ annualInterestRatePct })} />
          <MoneyField label="Term (years)" value={assumptions.termYears} onChange={(termYears) => set({ termYears })} />
        </>
      ) : (
        <MoneyField label="Monthly rent (£)" value={assumptions.monthlyRent} onChange={(monthlyRent) => set({ monthlyRent })} />
      )}
      <MoneyField label="Council tax (£ a month)" value={assumptions.councilTaxMonthly} onChange={(councilTaxMonthly) => set({ councilTaxMonthly })} />
      <MoneyField label="Utilities (£ a month)" value={assumptions.utilitiesMonthly} onChange={(utilitiesMonthly) => set({ utilitiesMonthly })} />
      <MoneyField label="Moving costs (£, one-off)" value={assumptions.movingCosts} onChange={(movingCosts) => set({ movingCosts })} />
    </fieldset>
  );
}

function MoneyField({ label, value, onChange }: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label>{label}
      <input
        className="knit-field"
        value={value === null ? "" : String(value)}
        inputMode="decimal"
        onChange={(event) => onChange(parseBriefNumber(event.target.value))}
      />
    </label>
  );
}

function parseBriefNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function BriefPreview({ brief, markdown, share = null }: {
  brief: DecisionBrief;
  markdown: string;
  /** The brief's own /brief#shortlist= link (G06), made after the review; no Copy link without it. */
  share?: { profile: PreferenceProfile; candidates: string[]; href: (inclusions: ShareInclusions) => string | null } | null;
}) {
  const sources = brief.sections.find((section) => section.id === "evidence");
  const shared = useShareLink("anyone with it sees these areas and only what you included");
  const [reviewing, setReviewing] = useState(false);
  return (
    <div className="brief-preview" data-testid="decision-brief-preview" aria-label="Decision brief preview" aria-live="polite">
      {/* The panel's heading already says "Decision brief"; the card keeps it for screen readers and print. */}
      <h3 className="brief-preview__title">{brief.title}</h3>
      <p className="brief-preview__meta" data-testid="decision-brief-meta">
        Made {brief.generatedAt.slice(0, 10)} · {privacyNote(brief)}
      </p>
      {brief.verdicts.length > 0 && (
        <section className="brief-glance" aria-label="At a glance" data-testid="brief-glance">
          <h4>At a glance</h4>
          <ul>
            {brief.verdicts.map((verdict) => (
              <li key={verdict.area} data-testid="brief-verdict">
                <strong>{verdictHeading(verdict)}</strong>
                {/* CUJ03 board step 3: what the area wins and gives up in your search, in your order. */}
                {verdict.gains && verdict.gains.length > 0 && (
                  <span className="brief-glance__fit" data-testid="brief-gains"><em>Gains</em> {verdict.gains.join(" · ")}</span>
                )}
                {/* Every area has the row (CUJ03 board), "None found" when nothing gives way. */}
                {verdict.tradeOffs && (
                  <span className="brief-glance__fit" data-testid="brief-trade-offs"><em>Trade-offs</em> {tradeOffsText(verdict.tradeOffs)}</span>
                )}
                <span><KnitIcon name="home" colour="var(--yarn-tangerine)" className="knit-inline" />{verdict.price}</span>
                <span><KnitIcon name="tube" colour="var(--yarn-cobalt)" className="knit-inline" />{verdict.commute}</span>
                <span><KnitIcon name="help" colour="var(--yarn-pink)" className="knit-inline" />{verdict.question}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {brief.sections.filter((section) => section !== sources).map((section, index) => (
        <section key={`${section.id}-${index}`} className={`brief-section brief-section--${section.id}`} aria-label={section.heading}>
          <h4>{section.heading}</h4>
          <BriefLines lines={section.lines} />
        </section>
      ))}
      {sources && (
        <Fold label={sources.heading} className="brief-sources" testId="brief-sources" print>
          <p data-testid="brief-release">{releaseNote(brief)}</p>
          <BriefLines lines={sources.lines} />
        </Fold>
      )}
      <Fold label="Show as Markdown" className="brief-markdown">
        <label>Decision brief Markdown (export preview)
          <textarea className="knit-field" data-testid="decision-brief-markdown" readOnly value={markdown} rows={12} />
        </label>
      </Fold>
      <div className="brief-actions">
        {share && (
          <button type="button" data-testid="brief-copy-link" aria-expanded={reviewing} onClick={() => setReviewing(true)}>Copy link</button>
        )}
        <button type="button" onClick={() => downloadMarkdown(markdown)}>Download decision brief (Markdown)</button>
        <button type="button" onClick={() => window.print()}>Print decision brief</button>
      </div>
      {share && reviewing && (
        <ShareReview profile={share.profile} candidates={share.candidates} onCancel={() => setReviewing(false)}
          onConfirm={(inclusions) => {
            setReviewing(false);
            const href = share.href(inclusions);
            if (href) void shared.share(`${window.location.origin}${href}`, brief.title);
          }} />
      )}
      {share && shared.status}
      {!brief.shared && <p className="decision-brief__hint">Saved on this device only</p>}
    </div>
  );
}

/**
 * A folded part of the brief: a button that opens it (not a nested <details>, which the "Saved
 * areas & costs" fold already is). `print` parts print open.
 */
function Fold({ label, className, testId, print = false, children }: {
  label: string; className: string; testId?: string; print?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`brief-fold ${className}`} data-testid={testId} data-open={open ? "" : undefined}>
      <button type="button" className="brief-fold__toggle link-button" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(!open)}>
        {label}
      </button>
      <div id={id} className="brief-fold__body" hidden={!open} data-print-open={print ? "" : undefined}>{children}</div>
    </div>
  );
}

function BriefLines({ lines }: { lines: BriefLine[] }) {
  return (
    <ul>
      {lines.map((line, lineIndex) => (
        <li key={`${lineIndex}`} data-kind={line.kind}>
          {line.text}
          {line.source?.url && (
            <> <a href={line.source.url}>{line.source.label}</a></>
          )}
        </li>
      ))}
    </ul>
  );
}

function downloadMarkdown(markdown: string): void {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "decision-brief.md";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
