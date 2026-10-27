/**
 * Reading a shared `#profile=` link: read what can be read (the budget, places, criteria), drop the
 * rest, and say so. Never a blank panel: a link that cannot be read at all opens the household's own search (or the
 * three start rows) with a toast. Links: `#profile=v1.` (full v1 array), `#profile=v2.` (the site's compact v1 array)
 * and `#profile=v3.` (preference-profile.v2, lib/profile-v2.ts).
 *
 * The analytics event carries the failure kind and the count only, never the link or anything in it.
 */
import type { PreferenceProfile, PreferenceProfileV2 } from "./contracts";
import { contractProfile } from "./match-model";
import { unpackProfileLenient } from "./profile-state";
import { fragmentValue, toPanelProfile, unpackV2Lenient, V3_PREFIX } from "./profile-v2";

const PREFIXES = { "#profile=v1.": "v1", "#profile=v2.": "v2", [V3_PREFIX]: "v3" } as const;

/** none: no #profile= in the address; ok: read in full; partial: some parts skipped; failed: nothing usable. */
export type ProfileLinkStatus = "none" | "ok" | "partial" | "failed";
/** Why a link failed, for the analytics event (never its contents). */
export type ProfileLinkFailure = "not-base64" | "not-json" | "no-budget" | "parts-skipped";

export interface ProfileLinkRead {
  status: ProfileLinkStatus;
  /** The link format: v1, v2 (the site's compact v1) or v3 (ordered criteria). */
  version: "v1" | "v2" | "v3" | null;
  /** The search as the current panel reads it (preference-profile.v1). */
  profile: PreferenceProfile | null;
  /** The search as preference-profile.v2 (the match model, the panel rewrite). */
  profileV2: PreferenceProfileV2 | null;
  /** Parts that could not be read (criteria, places, zones, marks …). */
  skipped: number;
  failure: ProfileLinkFailure | null;
}

/** Reads a `#profile=…` fragment as far as it goes (the address's hash, "&compare=…" and all). */
export function readProfileLink(fragment: string): ProfileLinkRead {
  const entry = Object.entries(PREFIXES).find(([prefix]) => fragment.startsWith(prefix));
  if (!entry) return { status: "none", version: null, profile: null, profileV2: null, skipped: 0, failure: null };
  const [prefix, version] = entry;
  const failed = (failure: ProfileLinkFailure, skipped = 0): ProfileLinkRead =>
    ({ status: "failed", version, profile: null, profileV2: null, skipped, failure });
  let value: unknown;
  try {
    value = fragmentValue(fragment, prefix);
  } catch (error) {
    return failed(error instanceof SyntaxError ? "not-json" : "not-base64");
  }
  if (version === "v3") {
    const { profile, skipped } = unpackV2Lenient(value);
    if (!profile) return failed("no-budget", skipped);
    const panel = toPanelProfile(profile);
    return done(version, panel.profile, profile, skipped + panel.skipped);
  }
  const { profile, skipped } = unpackProfileLenient(value);
  if (!profile) return failed("no-budget", skipped);
  return done(version, profile, contractProfile(profile), skipped);
}

function done(version: ProfileLinkRead["version"], profile: PreferenceProfile, profileV2: PreferenceProfileV2, skipped: number): ProfileLinkRead {
  return { status: skipped ? "partial" : "ok", version, profile, profileV2, skipped, failure: skipped ? "parts-skipped" : null };
}

/** The toast for a link that did not open in full (board V4-10 MapToast); null when it did. */
export function profileLinkToast(read: ProfileLinkRead): { text: string; kind: string } | null {
  if (read.status === "partial") {
    return { text: `Part of this link couldn't be opened · ${read.skipped} ${read.skipped === 1 ? "criterion" : "criteria"} skipped`, kind: "profile-link-partial" };
  }
  if (read.status === "failed") return { text: "This link couldn't be opened · Start fresh", kind: "profile-link-failed" };
  return null;
}

/** The first-party analytics props for a link that did not open in full: the kind and the count only. */
export function profileLinkEvent(read: ProfileLinkRead): { result: string; version: string; skipped: number } | null {
  if (read.status !== "partial" && read.status !== "failed") return null;
  return { result: read.failure ?? read.status, version: read.version ?? "", skipped: read.skipped };
}
