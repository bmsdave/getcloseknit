"use client";

import { useState } from "react";

import { ChartFrame, ScaleMarker, scalePosition } from "@/components/charts";
import type { GeographyId } from "@/lib/contracts";
import type { DiligenceQuestion } from "@/lib/leasehold";
import {
  AIRCRAFT_NOTE,
  RAIL_NOTE,
  REVIEWED_NOISE_SOURCE,
  VISIT_CONCERNS,
  assessNoiseCandidate,
  describeReadingKind,
  recordVisit,
  toggleConcern,
  visitPromptsForConcerns,
  type AreaVisit,
  type NoiseScreening,
  type VisitSlot,
} from "@/lib/noise-evidence";

import { HelpTip } from "./help-tip";

type NoiseSourceView = "road" | "rail" | "aircraft";

const VISIT_SLOTS: VisitSlot[] = ["evening", "weekend", "event-day"];

const CONCERN_LABELS: Record<string, string> = {
  "evening-noise": "Evening noise concern",
  "weekend-noise": "Weekend noise concern",
  "event-day": "Event-day concern",
};

export function NoiseContextSection({ selected }: { selected: GeographyId | null }) {
  const [view, setView] = useState<NoiseSourceView>("road");
  return (
    <section className="noise-context" data-testid="noise-context" aria-label="Noise context">
      <h2>Noise context (pilot)</h2>
      <SourceViewSwitch view={view} onView={setView} />
      {view === "road" && <RoadSourceView selected={selected} />}
      {view === "rail" && <RailSourceView />}
      {view === "aircraft" && <AircraftSourceView />}
    </section>
  );
}

function SourceViewSwitch({ view, onView }: {
  view: NoiseSourceView;
  onView: (view: NoiseSourceView) => void;
}) {
  return (
    <div className="noise-source-switch" role="group" aria-label="Noise source view">
      {([
        ["road", "Road (reviewed pilot)"],
        ["rail", "Rail (unavailable)"],
        ["aircraft", "Aircraft (separate)"],
      ] as [NoiseSourceView, string][]).map(([id, label]) => (
        <button
          key={id}
          type="button"
          className="chip-button"
          aria-pressed={view === id}
          onClick={() => onView(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const SCALE_MIN = 40;
const SCALE_MAX = 80;

/** "55-59" → [55, 59]; null when the band does not parse. */
function bandRange(band: string | null): [number, number] | null {
  const match = band?.match(/^(\d+)-(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function RoadSourceView({ selected }: { selected: GeographyId | null }) {
  const assessed = selected ? assessNoiseCandidate(selected) : null;
  const [guideOpen, setGuideOpen] = useState(false);
  const range = bandRange(assessed?.band ?? null);
  const unit = assessed?.unit ?? REVIEWED_NOISE_SOURCE.units[0];
  return (
    <div data-testid="noise-source-detail">
      <ChartFrame
        title="Modelled road band"
        help="noise-method"
        unknown={range ? null : "Unknown here, not quiet"}
        sources={(
          <>
            <p>{REVIEWED_NOISE_SOURCE.name}.</p>
            <dl data-testid="noise-registry">
              <div><dt>Method</dt><dd>{REVIEWED_NOISE_SOURCE.method}.</dd></div>
              <div><dt>Units</dt><dd>{REVIEWED_NOISE_SOURCE.units.join(", ")}.</dd></div>
              <div><dt>Source date</dt><dd>{REVIEWED_NOISE_SOURCE.sourceDate}.</dd></div>
              <div><dt>Resolution</dt><dd>{REVIEWED_NOISE_SOURCE.resolution}.</dd></div>
              <div><dt>Time period</dt><dd>{REVIEWED_NOISE_SOURCE.timePeriod}.</dd></div>
            </dl>
            {assessed && <p>{assessed.explanation}</p>}
          </>
        )}
      >
        {range && (
          <ScaleMarker
            position={scalePosition((range[0] + range[1]) / 2, SCALE_MIN, SCALE_MAX)}
            range={[scalePosition(range[0], SCALE_MIN, SCALE_MAX), scalePosition(range[1], SCALE_MIN, SCALE_MAX)]}
            low={`${SCALE_MIN} dB`}
            high={`${SCALE_MAX} dB`}
            label={`Modelled road noise: ${range[0]} to ${range[1]} ${unit}, on a ${SCALE_MIN} to ${SCALE_MAX} dB scale`}
          />
        )}
      </ChartFrame>
      <p className="et-caption" data-testid="noise-assessment" role="status">{assessmentLine(assessed)}</p>
      <button
        type="button"
        className="chip-button"
        data-testid="noise-method-toggle"
        aria-expanded={guideOpen}
        onClick={() => setGuideOpen((value) => !value)}
      >
        {guideOpen ? "Hide modelled-vs-measured guide" : "Show modelled-vs-measured guide"}
      </button>
      {guideOpen && <MethodGuide />}
      <VisitPlanner />
      <p className="quality-note">Your own visit decides, not a score <HelpTip id="noise-no-score" label="noise scores" /></p>
    </div>
  );
}

/** One short line under the chart; the full screening text sits in Sources & method. */
function assessmentLine(assessed: NoiseScreening | null): string {
  if (assessed === null) return "Select an area to screen it against the reviewed road corridors.";
  if (assessed.status === "mapped-exposure") {
    return `Modelled ${assessed.band} ${assessed.unit}, not a measurement. Visit before deciding.`;
  }
  if (assessed.status === "no-mapped-exposure") return "Between mapped corridors: noise exposure is unknown here, not quiet.";
  return "Outside the pilot coverage: noise exposure is unknown here, not quiet.";
}

function MethodGuide() {
  return (
    <div data-testid="noise-method-guide">
      <p><strong>Modelled:</strong> {describeReadingKind("modelled")}</p>
      <p><strong>Measured:</strong> {describeReadingKind("measured")}</p>
    </div>
  );
}

function RailSourceView() {
  return (
    <div data-testid="noise-source-detail">
      <p role="status">{RAIL_NOTE}</p>
    </div>
  );
}

function AircraftSourceView() {
  return (
    <div data-testid="noise-source-detail">
      <p role="status">{AIRCRAFT_NOTE} It is added separately later, never merged into the road bands.</p>
    </div>
  );
}

function VisitPlanner() {
  const [concerns, setConcerns] = useState<string[]>([]);
  const prompts = visitPromptsForConcerns(concerns);
  return (
    <div className="visit-planner">
      <fieldset>
        <legend>What worries you about noise here? (optional)</legend>
        {VISIT_CONCERNS.map((concern) => (
          <label key={concern}>
            <input
              type="checkbox"
              checked={concerns.includes(concern)}
              onChange={(event) => setConcerns(toggleConcern(concerns, concern, event.target.checked))}
            />
            {CONCERN_LABELS[concern] ?? concern}
          </label>
        ))}
      </fieldset>
      <ul data-testid="noise-prompts">
        {prompts.map((prompt) => <li key={prompt.slot}>{prompt.prompt}</li>)}
      </ul>
      <VisitRecorder />
    </div>
  );
}

function VisitRecorder() {
  const [slot, setSlot] = useState<VisitSlot>("evening");
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<{ visits: AreaVisit[]; notes: DiligenceQuestion[] }>({ visits: [], notes: [] });
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <div className="visit-recorder">
      <label>Visit time
        <select aria-label="Visit time" value={slot} onChange={(event) => setSlot(event.target.value as VisitSlot)}>
          {VISIT_SLOTS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>Visit note (private, stays on this device)
        <input
          aria-label="Visit note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Describe the conditions and time, not people"
        />
      </label>
      <button type="button" className="chip-button" onClick={() => recordDraft(log, slot, draft, setLog, setDraft, setRefusal)}>
        Record visit
      </button>
      {refusal !== null && <p role="status">{refusal}</p>}
      <ul data-testid="noise-visits">
        {log.visits.map((visit) => (
          <li key={visit.id}>{visit.slot}: {noteText(log.notes, visit)}</li>
        ))}
      </ul>
    </div>
  );
}

function recordDraft(
  log: { visits: AreaVisit[]; notes: DiligenceQuestion[] },
  slot: VisitSlot,
  draft: string,
  setLog: (log: { visits: AreaVisit[]; notes: DiligenceQuestion[] }) => void,
  setDraft: (value: string) => void,
  setRefusal: (value: string | null) => void,
) {
  const recorded = recordVisit(log, slot, draft);
  setLog({ visits: recorded.visits, notes: recorded.notes });
  setRefusal(recorded.refusal);
  if (recorded.refusal === null) setDraft("");
}

function noteText(notes: DiligenceQuestion[], visit: AreaVisit): string {
  if (visit.noteId === null) return "no note recorded";
  return notes.find((note) => note.id === visit.noteId)?.text ?? "no note recorded";
}
