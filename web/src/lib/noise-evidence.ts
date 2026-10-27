// AE-24: reviewed road-traffic noise context with visit prompts.
//
// One reviewed strategic road-noise dataset (modelled exposure, never a
// live measurement). Locations inside a mapped corridor report their
// modelled band; gaps between corridors report no-mapped-exposure, which
// is never a quietness guarantee; anything outside the reviewed coverage
// reports no-coverage. Rail noise is not a reviewed source yet and
// aircraft exposure stays separate, so neither is assessed here. There is
// no nuisance score by design: prompt repeat visits instead.
// Visit notes reuse the shared leasehold checklist question model and
// stay on the device; they describe conditions, never people.
import { addQuestion, type DiligenceQuestion } from "./leasehold";
import type { Sourced } from "./sourced";

export const NOISE_SOURCE_ID = "defra-strategic-road-noise";
export const METHOD_MODELLED = "modelled";
export const NOISE_UNITS = ["dB LAeq,16h", "dB Lnight"] as const;
export type NoiseUnit = (typeof NOISE_UNITS)[number];
export const DEFAULT_NOISE_UNIT: NoiseUnit = "dB LAeq,16h";

export const AIRCRAFT_NOTE =
  "Aircraft exposure stays separate and is not part of this road pilot.";
export const RAIL_NOTE =
  "Rail noise is not a reviewed source yet: unavailable here, never zero.";

export interface ReviewedNoiseSource {
  sourceId: string;
  name: string;
  method: string;
  units: string[];
  sourceDate: string;
  resolution: string;
  timePeriod: string;
  coverage: string;
}

export const REVIEWED_NOISE_SOURCE: ReviewedNoiseSource = {
  sourceId: NOISE_SOURCE_ID,
  name: "Defra strategic road-traffic noise (modelled pilot)",
  method: "Strategic modelled road-traffic exposure, not a live measurement",
  units: [...NOISE_UNITS],
  sourceDate: "2022 strategic mapping round (reviewed 2026-09-06)",
  resolution: "10m modelled grid aggregated to corridor polygons",
  timePeriod: "Day 07:00-23:00 LAeq,16h; night 23:00-07:00 Lnight",
  coverage: "Pilot road corridors around the West London preview areas",
};

export type NoiseStatus = "mapped-exposure" | "no-mapped-exposure" | "no-coverage";

export interface NoiseScreening {
  status: NoiseStatus;
  corridor: string | null;
  band: string | null;
  unit: NoiseUnit;
  method: typeof METHOD_MODELLED;
  explanation: string;
}

type Ring = [number, number][];

interface NoiseCorridor {
  name: string;
  label: string;
  band: string;
  ring: Ring;
}

// Reviewed reference sample: axis-aligned corridor rectangles on the
// publication geometry (EPSG:4326), mirroring the reviewed ingestion
// fixture noise/defra-road-sample.geojson.
export const REVIEWED_NOISE_COVERAGE: Ring = [
  [-0.2, 51.48], [-0.06, 51.48], [-0.06, 51.58], [-0.2, 51.58], [-0.2, 51.48],
];

export const REVIEWED_NOISE_CORRIDORS: NoiseCorridor[] = [
  {
    name: "road-corridor-a",
    label: "Road corridor A (reviewed modelled road-traffic band)",
    band: "55-59",
    ring: [
      [-0.17, 51.49], [-0.11, 51.49], [-0.11, 51.52], [-0.17, 51.52],
      [-0.17, 51.49],
    ],
  },
  {
    name: "road-corridor-b",
    label: "Road corridor B (reviewed modelled road-traffic band)",
    band: "60-64",
    ring: [
      [-0.1, 51.49], [-0.07, 51.49], [-0.07, 51.51], [-0.1, 51.51],
      [-0.1, 51.49],
    ],
  },
];

// Representative points for the preview candidates, from the demo search
// centres: corridor A, a gap between corridors, and corridor B.
const CANDIDATE_POINTS: Record<string, [number, number]> = {
  "uk:lsoa:E01000001": [-0.1416, 51.501],
  "uk:lsoa:E01000002": [-0.094, 51.545],
  "uk:lsoa:E01000003": [-0.089, 51.503],
};

export function assessNoiseLocation(
  lon: number,
  lat: number,
  unit: string = DEFAULT_NOISE_UNIT,
): NoiseScreening {
  const reviewed = requireReviewedUnit(unit);
  const point: [number, number] = [lon, lat];
  if (!inRect(point, REVIEWED_NOISE_COVERAGE)) {
    return {
      status: "no-coverage", corridor: null, band: null,
      unit: reviewed, method: METHOD_MODELLED,
      explanation: "Outside the reviewed road-noise coverage: treat noise " +
        "exposure as unknown here, not quiet.",
    };
  }
  const corridor = REVIEWED_NOISE_CORRIDORS.find((entry) => inRect(point, entry.ring));
  if (corridor === undefined) return gapScreening(reviewed);
  return {
    status: "mapped-exposure", corridor: corridor.name, band: corridor.band,
    unit: reviewed, method: METHOD_MODELLED,
    explanation: `Mapped modelled exposure ${corridor.band} ${reviewed} ` +
      `under ${corridor.name} (strategic modelled road traffic). ` +
      `${AIRCRAFT_NOTE} A mapped band never guarantees what a dwelling ` +
      "sounds like: visit before deciding.",
  };
}

export function assessNoiseCandidate(geographyId: string): NoiseScreening {
  const point = CANDIDATE_POINTS[geographyId];
  if (point === undefined) {
    return {
      status: "no-coverage", corridor: null, band: null,
      unit: DEFAULT_NOISE_UNIT, method: METHOD_MODELLED,
      explanation: `${geographyId} is outside the pilot road-noise boxes: ` +
        "noise exposure is unknown here, not quiet.",
    };
  }
  return assessNoiseLocation(point[0], point[1]);
}

export function describeReadingKind(kind: string): string {
  if (kind === "modelled") {
    return "Strategic modelled road-traffic exposure for the mapped time " +
      "period and indicator: useful for comparing corridors, never a " +
      "prediction of what a visit will sound like.";
  }
  if (kind === "measured") {
    return "A live sound measurement at one place and time: it records " +
      "what the microphone heard, including unmapped sources, and is not " +
      "directly comparable with a modelled strategic band.";
  }
  throw new Error(`unknown reading kind: ${kind}`);
}

export type VisitSlot = "evening" | "weekend" | "event-day";

export interface VisitPrompt {
  concern: string;
  slot: VisitSlot;
  prompt: string;
}

const CONCERN_PROMPTS: VisitPrompt[] = [
  {
    concern: "evening-noise", slot: "evening",
    prompt: "Visit in the evening: road-traffic bands describe the day " +
      "average, not the evening peak outside it.",
  },
  {
    concern: "weekend-noise", slot: "weekend",
    prompt: "Visit at the weekend: fleet mix and congestion differ from " +
      "the modelled weekday pattern.",
  },
  {
    concern: "event-day", slot: "event-day",
    prompt: "Check event-day conditions: matches and events near the " +
      "corridors fall outside the strategic model.",
  },
];

export const VISIT_CONCERNS = CONCERN_PROMPTS.map((prompt) => prompt.concern);

export function visitPromptsForConcerns(concerns: string[]): VisitPrompt[] {
  const wanted = new Set(concerns);
  return CONCERN_PROMPTS.filter((prompt) => wanted.has(prompt.concern));
}

export function toggleConcern(concerns: string[], concern: string, checked: boolean): string[] {
  if (checked) return concerns.includes(concern) ? concerns : [...concerns, concern];
  return concerns.filter((entry) => entry !== concern);
}

export interface AreaVisit {
  id: string;
  slot: VisitSlot;
  noteId: string | null;
}

export interface VisitLog {
  visits: AreaVisit[];
  notes: DiligenceQuestion[];
}

export interface VisitRecord extends VisitLog {
  refusal: string | null;
}

const IDENTIFYING_PATTERNS = [
  /\b(flat|unit|apartment|house)\s+(no\.?\s*)?\d+/i,
  /\b(mr|mrs|ms|miss|dr)\.?\s+[A-Z][a-z]+/i,
  /\bneighbo(u)r/i,
];

export function refuseVisitNote(text: string): string | null {
  if (IDENTIFYING_PATTERNS.some((pattern) => pattern.test(text))) {
    return "Describe the condition and time, not a person or dwelling: " +
      "notes stay private but must not identify neighbours or allege behaviour.";
  }
  return null;
}

export function addVisitNote(
  notes: DiligenceQuestion[],
  text: string,
): { notes: DiligenceQuestion[]; refusal: string | null } {
  const refusal = refuseVisitNote(text);
  if (refusal !== null || text.trim() === "") return { notes, refusal };
  return { notes: addQuestion(notes, text), refusal: null };
}

export function recordVisit(log: VisitLog, slot: VisitSlot, noteText: string): VisitRecord {
  const trimmed = noteText.trim();
  const added = trimmed === "" ? { notes: log.notes, refusal: null } : addVisitNote(log.notes, noteText);
  const attached = trimmed !== "" && added.refusal === null;
  const noteId = attached ? added.notes[added.notes.length - 1].id : null;
  const visit: AreaVisit = { id: nextVisitId(log.visits), slot, noteId };
  return { visits: [...log.visits, visit], notes: added.notes, refusal: added.refusal };
}

export function estimateNuisanceScore(..._args: unknown[]): never {
  throw new Error(
    "speculative nuisance scores are unsupported: show the reviewed " +
    "modelled band with its limits and prompt repeat visits instead",
  );
}

function gapScreening(unit: NoiseUnit): NoiseScreening {
  return {
    status: "no-mapped-exposure", corridor: null, band: null,
    unit, method: METHOD_MODELLED,
    explanation: "Inside the reviewed coverage but between mapped road " +
      "corridors: no modelled band applies here. This absence is not a " +
      "quietness guarantee: strategic modelled exposure is not a live " +
      "sound measurement, and neighbour or night-time sound is not mapped.",
  };
}

function requireReviewedUnit(unit: string): NoiseUnit {
  if (!(NOISE_UNITS as readonly string[]).includes(unit)) {
    throw new Error(
      `incompatible noise unit ${unit}: the reviewed road pilot only ` +
      `compares ${NOISE_UNITS.join(", ")}`,
    );
  }
  return unit as NoiseUnit;
}

function inRect(point: [number, number], ring: Ring): boolean {
  const longitudes = ring.map(([lon]) => lon);
  const latitudes = ring.map(([, lat]) => lat);
  return point[0] >= Math.min(...longitudes) && point[0] <= Math.max(...longitudes)
    && point[1] >= Math.min(...latitudes) && point[1] <= Math.max(...latitudes);
}

function nextVisitId(visits: AreaVisit[]): string {
  const numbers = visits
    .map((visit) => Number(visit.id.replace(/^visit-/, "")))
    .filter((value) => Number.isInteger(value));
  return `visit-${(numbers.length === 0 ? 0 : Math.max(...numbers)) + 1}`;
}

/**
 * London as a whole, from Defra's strategic noise mapping Round 4 (2022):
 * homes at 55 dB+ weighted over the 33 boroughs' area_noise rows, and the
 * median of the LSOA road medians. Shown only beside figures from that
 * release (sourceVersion).
 */
export const LONDON_NOISE: Sourced<{ sourceVersion: string; any55Share: number; roadLdenMedian: number }> = {
  value: { sourceVersion: "src-defra-noise-round4-2022-road-rail-air", any55Share: 0.435, roadLdenMedian: 53.4 },
  kind: "published",
  source: "Defra Round 4",
  asOf: "2022",
};
