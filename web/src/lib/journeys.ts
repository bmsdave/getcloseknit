import type { CommuteDestination, JourneyRequest, JourneyResult } from "./contracts";

export const NETWORK_VERSION = "street-network-2026-09-rtm";
export const PREVIOUS_NETWORK_VERSION = "street-network-2026-08-rtm";
export const WEEKDAY_TIMETABLE_DATE = "2026-09-03";
export const WEEKEND_TIMETABLE_DATE = "2026-09-06";

export type ServiceBand = "weekday" | "weekend";

export interface MatrixJourney extends JourneyResult {
  arrivalBand: string;
  serviceBand: ServiceBand;
  destinationCell: string;
  approximation: "area-origin";
}

export interface CommuteLeg extends MatrixJourney {
  destinationId: string;
  mode: CommuteDestination["mode"];
  targetMinutes: number;
  weight: number;
  exceedsTarget: boolean;
}

export interface CommuteScreen {
  originAreaId: string;
  networkVersion: string;
  timetableDate: string;
  serviceBand: ServiceBand;
  approximation: "area-origin";
  legs: CommuteLeg[];
  ignoredDestinationIds: string[];
  weightedMinutes: number | null;
  utility: number | null;
  hasUnreachable: boolean;
  exceedsMaximum: boolean;
  eligible: boolean;
  assumptions: string[];
}

export interface ScreenOptions {
  networkVersion?: string;
  serviceDate?: string;
  signal?: AbortSignal;
}

export interface LookupInput {
  originAreaId: string;
  latitude: number;
  longitude: number;
  mode: CommuteDestination["mode"];
  arrivalTime: string;
  networkVersion: string;
  serviceDate: string;
  signal?: AbortSignal;
}

const AREA_ORIGIN_CELLS: Record<string, string> = {
  "uk:lsoa:E01000001": "51501:-142",
  "uk:lsoa:E01000002": "51545:-94",
};

interface FixtureEntry {
  minutes: [number, number, number];
  transfers: number;
  walking: number;
}

// Fixed coarse area-origin matrix shared with the Python routing fixtures:
// (origin cell, destination cell, arrival band, mode, service band, network).
const FIXTURE_MATRIX: Record<string, FixtureEntry> = {
  [matrixKey("51501:-142", "51507:-128", "08:45", "transit", "weekday", NETWORK_VERSION)]: { minutes: [28, 32, 38], transfers: 1, walking: 8 },
  [matrixKey("51545:-94", "51507:-128", "08:45", "transit", "weekday", NETWORK_VERSION)]: { minutes: [40, 45, 52], transfers: 2, walking: 10 },
  [matrixKey("51545:-94", "51503:-89", "08:45", "transit", "weekday", NETWORK_VERSION)]: { minutes: [18, 22, 27], transfers: 0, walking: 6 },
  [matrixKey("51501:-142", "51507:-128", "08:45", "walk", "all", NETWORK_VERSION)]: { minutes: [55, 60, 66], transfers: 0, walking: 60 },
  [matrixKey("51501:-142", "51507:-128", "08:45", "cycle", "all", NETWORK_VERSION)]: { minutes: [20, 24, 30], transfers: 0, walking: 0 },
  [matrixKey("51501:-142", "51507:-128", "08:45", "transit", "weekend", NETWORK_VERSION)]: { minutes: [38, 45, 55], transfers: 1, walking: 8 },
  [matrixKey("51501:-142", "51507:-128", "08:45", "transit", "weekday", PREVIOUS_NETWORK_VERSION)]: { minutes: [35, 40, 48], transfers: 1, walking: 9 },
  [matrixKey("51501:-142", "51507:-128", "09:00", "transit", "weekday", NETWORK_VERSION)]: { minutes: [29, 33, 39], transfers: 1, walking: 8 },
};

const matrixCache = new Map<string, MatrixJourney>();
let computeCount = 0;

export function arrivalBand(arrivalTime: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(arrivalTime);
  if (!match) throw new Error(`invalid arrival time: ${arrivalTime}`);
  const total = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`invalid arrival time: ${arrivalTime}`);
  const band = Math.floor(total / 15) * 15;
  return `${String(Math.floor(band / 60)).padStart(2, "0")}:${String(band % 60).padStart(2, "0")}`;
}

export function serviceBandFor(serviceDate: string): ServiceBand {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) throw new Error(`invalid service date: ${serviceDate}`);
  const day = new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
  if (Number.isNaN(day)) throw new Error(`invalid service date: ${serviceDate}`);
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

export function destinationCell(latitude: number, longitude: number): string {
  return `${Math.round(latitude * 1_000)}:${Math.round(longitude * 1_000)}`;
}

export function lookupMatrixJourney(input: LookupInput): MatrixJourney {
  throwIfCancelled(input.signal);
  const band = arrivalBand(input.arrivalTime);
  const cell = destinationCell(input.latitude, input.longitude);
  const key = matrixKey(
    AREA_ORIGIN_CELLS[input.originAreaId] ?? "unknown",
    cell, band, input.mode, serviceBandFor(input.serviceDate), input.networkVersion,
  );
  const cached = matrixCache.get(key);
  if (cached) return cached;
  const journey = computeLeg(key, band, cell, input.networkVersion, input.serviceDate);
  matrixCache.set(key, journey);
  return journey;
}

export function screenCommute(
  originAreaId: string,
  destinations: CommuteDestination[],
  options: ScreenOptions = {},
): CommuteScreen {
  throwIfCancelled(options.signal);
  const networkVersion = options.networkVersion ?? NETWORK_VERSION;
  const serviceDate = options.serviceDate ?? WEEKDAY_TIMETABLE_DATE;
  const serviceBand = serviceBandFor(serviceDate);
  const active = destinations.filter((destination) => destination.weight > 0);
  const ignored = destinations.filter((destination) => destination.weight <= 0);
  const legs = active.map((destination) =>
    screenLeg(originAreaId, destination, networkVersion, serviceDate, options.signal));
  return combineScreen(originAreaId, legs, ignored.map((destination) => destination.id),
    networkVersion, serviceDate, serviceBand);
}

export function redactForLog(screen: CommuteScreen): Record<string, unknown> {
  return {
    originAreaId: screen.originAreaId,
    networkVersion: screen.networkVersion,
    timetableDate: screen.timetableDate,
    serviceBand: screen.serviceBand,
    eligible: screen.eligible,
    hasUnreachable: screen.hasUnreachable,
    exceedsMaximum: screen.exceedsMaximum,
    weightedMinutes: screen.weightedMinutes,
    legs: screen.legs.map((leg) => ({
      destinationCell: leg.destinationCell,
      arrivalBand: leg.arrivalBand,
      mode: leg.mode,
      serviceBand: leg.serviceBand,
      status: leg.status,
      medianMinutes: leg.medianMinutes,
      exceedsTarget: leg.exceedsTarget,
    })),
  };
}

export function cacheStats(): { computations: number; entries: number } {
  return { computations: computeCount, entries: matrixCache.size };
}

export function resetCommuteCache(): void {
  matrixCache.clear();
  computeCount = 0;
}

export function buildPreviewJourney(request: JourneyRequest): JourneyResult {
  if (!["transit", "walk", "cycle"].includes(request.mode)) {
    throw new Error(`unsupported journey mode: ${request.mode}`);
  }
  return lookupMatrixJourney({
    originAreaId: originAreaForCell(destinationCell(request.origin.latitude, request.origin.longitude)),
    latitude: request.destination.latitude,
    longitude: request.destination.longitude,
    mode: request.mode,
    arrivalTime: request.arrivalTime,
    networkVersion: NETWORK_VERSION,
    serviceDate: WEEKDAY_TIMETABLE_DATE,
  });
}

function matrixKey(origin: string, destination: string, band: string, mode: string, band2: string, version: string): string {
  return [origin, destination, band, mode, band2, version].join("|");
}

function computeLeg(key: string, band: string, cell: string, networkVersion: string, serviceDate: string): MatrixJourney {
  computeCount += 1;
  const serviceBand = serviceBandFor(serviceDate);
  const mode = key.split("|")[3] ?? "";
  const entry = FIXTURE_MATRIX[key] ?? fallbackEntry(key, mode, networkVersion);
  const base = entry
    ? { status: "available" as const, medianMinutes: entry.minutes[1], rangeMinutes: [entry.minutes[0], entry.minutes[2]] as [number, number], transfers: entry.transfers, walkingMinutes: entry.walking }
    : { status: "unreachable" as const, medianMinutes: null, rangeMinutes: null, transfers: null, walkingMinutes: null };
  return {
    schemaVersion: "journey-result.v1",
    ...base,
    networkVersion,
    timetableDate: serviceDate,
    arrivalBand: band,
    serviceBand,
    destinationCell: cell,
    approximation: "area-origin",
  };
}

function fallbackEntry(key: string, mode: string, networkVersion: string): FixtureEntry | undefined {
  const parts = key.split("|");
  if (parts[4] !== "all" && (mode === "walk" || mode === "cycle")) {
    return FIXTURE_MATRIX[[parts[0], parts[1], parts[2], mode, "all", networkVersion].join("|")];
  }
  return undefined;
}

function screenLeg(
  originAreaId: string,
  destination: CommuteDestination,
  networkVersion: string,
  serviceDate: string,
  signal?: AbortSignal,
): CommuteLeg {
  throwIfCancelled(signal);
  const journey = lookupMatrixJourney({
    originAreaId,
    latitude: destination.latitude,
    longitude: destination.longitude,
    mode: destination.mode,
    arrivalTime: destination.arrivalTime,
    networkVersion,
    serviceDate,
    signal,
  });
  const target = Math.max(1, destination.targetMinutes || 0);
  return {
    ...journey,
    destinationId: destination.id,
    mode: destination.mode,
    targetMinutes: destination.targetMinutes,
    weight: destination.weight,
    exceedsTarget: journey.medianMinutes !== null && journey.medianMinutes > target,
  };
}

function combineScreen(
  originAreaId: string,
  legs: CommuteLeg[],
  ignoredDestinationIds: string[],
  networkVersion: string,
  serviceDate: string,
  serviceBand: ServiceBand,
): CommuteScreen {
  const reachable = legs.filter((leg) => leg.status === "available");
  const hasUnreachable = reachable.length !== legs.length;
  const exceedsMaximum = reachable.some((leg) => leg.exceedsTarget);
  return {
    originAreaId,
    networkVersion,
    timetableDate: serviceDate,
    serviceBand,
    approximation: "area-origin",
    legs,
    ignoredDestinationIds,
    weightedMinutes: weightedMinutes(reachable),
    utility: weightedUtility(reachable),
    hasUnreachable,
    exceedsMaximum,
    eligible: !hasUnreachable && !exceedsMaximum,
    assumptions: screenAssumptions(originAreaId, networkVersion, serviceDate,
      serviceBand, ignoredDestinationIds, hasUnreachable, exceedsMaximum),
  };
}

function weightedMinutes(reachable: CommuteLeg[]): number | null {
  if (!reachable.length) return null;
  const total = reachable.reduce((sum, leg) => sum + leg.weight, 0);
  return Math.round(reachable.reduce((sum, leg) => sum + (leg.medianMinutes ?? 0) * leg.weight, 0) / total);
}

function weightedUtility(reachable: CommuteLeg[]): number | null {
  if (!reachable.length) return null;
  const total = reachable.reduce((sum, leg) => sum + leg.weight, 0);
  return reachable.reduce((sum, leg) => sum + journeyUtility(leg.medianMinutes ?? 0, leg.targetMinutes) * leg.weight, 0) / total;
}

function journeyUtility(minutes: number, target: number): number {
  return Math.max(0, Math.min(100, 200 - minutes / Math.max(1, target || 0) * 100));
}

function screenAssumptions(
  originAreaId: string,
  networkVersion: string,
  serviceDate: string,
  serviceBand: ServiceBand,
  ignored: string[],
  hasUnreachable: boolean,
  exceedsMaximum: boolean,
): string[] {
  const notes = [
    `Approximate area-origin screening from ${originAreaId} on ${networkVersion} (${serviceBand} timetable ${serviceDate}).`,
    "Destinations are snapped to coarse cells; precise address routing is a separate explicit request.",
    "Unavailable or disconnected routes are reported, never guessed.",
  ];
  if (ignored.length) notes.push(`Ignored zero-weight destinations: ${ignored.join(", ")}.`);
  if (hasUnreachable) notes.push("At least one destination is unreachable from this origin.");
  if (exceedsMaximum) notes.push("At least one destination exceeds its maximum commute.");
  return notes;
}

function originAreaForCell(cell: string): string {
  for (const [areaId, originCell] of Object.entries(AREA_ORIGIN_CELLS)) {
    if (originCell === cell) return areaId;
  }
  return "unknown-area";
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("commute request cancelled");
}
