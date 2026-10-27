import type { MatchJob, MatchPack, PreferenceProfile, PreferenceProfileV2 } from "./contracts";
import { buildMatchPack } from "./matching";

type MatchResponse = { status: number; body: MatchPack | MatchJob | { error: string } };
interface StoredJob { profile: PreferenceProfile; signature: string; readyAt: number; createdAt: number }

const jobs = new Map<string, StoredJob>();
const routeCache = new Set<string>();
const JOB_TTL_MS = 5 * 60 * 1000;

export function createMatchRequest(profile: PreferenceProfile | PreferenceProfileV2, now = Date.now()): MatchResponse {
  // A v2 search (ordered criteria) has no legacy commute matrix to wait for: its places are estimated at once.
  if (profile.schemaVersion === "preference-profile.v2") return { status: 200, body: buildMatchPack(profile) };
  evictStaleJobs(now);
  const signature = routeSignature(profile);
  if (!signature || routeCache.has(signature)) return { status: 200, body: buildMatchPack(profile) };
  const jobId = crypto.randomUUID();
  jobs.set(jobId, { profile: structuredClone(profile), signature, readyAt: now + 250, createdAt: now });
  const partialProfile = { ...profile, commuteDestinations: [] };
  return {
    status: 202,
    body: {
      schemaVersion: "match-job.v1", jobId, status: "queued",
      completedFactors: profile.factors.filter((factor) => factor.factorId !== "commute").map((factor) => factor.factorId),
      partial: buildMatchPack(partialProfile),
    },
  };
}

export function readMatchJob(jobId: string, now = Date.now()): MatchResponse {
  const job = jobs.get(jobId);
  if (!job) return { status: 404, body: { error: "match-job-not-found" } };
  if (now < job.readyAt) {
    return {
      status: 202,
      body: { schemaVersion: "match-job.v1", jobId, status: "running", completedFactors: [], partial: buildMatchPack({ ...job.profile, commuteDestinations: [] }) },
    };
  }
  jobs.delete(jobId);
  routeCache.add(job.signature);
  return { status: 200, body: buildMatchPack(job.profile) };
}

export function resetMatchJobs() {
  jobs.clear();
  routeCache.clear();
}

function evictStaleJobs(now: number): void {
  for (const [jobId, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(jobId);
  }
}

function routeSignature(profile: PreferenceProfile): string {
  return profile.commuteDestinations.map((destination) => {
    const minute = Number(destination.arrivalTime.slice(3, 5));
    const band = `${destination.arrivalTime.slice(0, 2)}:${String(Math.floor(minute / 15) * 15).padStart(2, "0")}`;
    return [Math.round(destination.latitude * 1_000), Math.round(destination.longitude * 1_000), destination.mode, band].join(":");
  }).sort().join("|");
}
