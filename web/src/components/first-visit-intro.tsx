"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { LONDON_VALUE_LINE, valueLine } from "@/lib/coverage-words";
import { DEFAULT_PROFILE } from "@/lib/fixtures";
import { isUnsetProfile, loadLocalProfile } from "@/lib/profile-state";
import { listShortlists, type SavedShortlist } from "@/lib/saved-shortlists";
import { INTRO_BOOT_ATTRIBUTE, INTRO_DISMISSED_KEY, isDeepLink } from "@/lib/intro-boot";

/** The first view's value line (#7) on London's map; the default <title> mirrors it. England's: lib/coverage-words. */
export const VALUE_LINE = LONDON_VALUE_LINE;
export const INTRO_STEPS = ["Budget & commute", "Matching areas", "Compare & brief"] as const;
/** England's steps: commute times are London's (TfL), so the first step promises none outside it. */
export const ENGLAND_INTRO_STEPS = ["Budget & needs", "Matching areas", "Compare & brief"] as const;
/** Each step's yarn icon and colour (DESIGN.md: icons are plied yarn in their own colour). */
const STEP_ICONS: Record<(typeof INTRO_STEPS | typeof ENGLAND_INTRO_STEPS)[number], { name: string; colour: string }> = {
  "Budget & commute": { name: "key", colour: "var(--yarn-tangerine)" },
  "Budget & needs": { name: "key", colour: "var(--yarn-tangerine)" },
  "Matching areas": { name: "search", colour: "var(--yarn-sky)" },
  "Compare & brief": { name: "note", colour: "var(--yarn-cherry)" },
};
export const PROOF_STRIP = "HM Land Registry · police.uk · Ofsted — every figure sourced · nothing here is paid placement";
/** The proof strip on one phone line (≤ 640px). */
export const PROOF_STRIP_SHORT = "Land Registry · police.uk · Ofsted · no paid placement";

export { INTRO_DISMISSED_KEY, isDeepLink };

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(INTRO_DISMISSED_KEY) === "1";
  } catch {
    return false; // storage blocked: show the card, it just will not be remembered
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(INTRO_DISMISSED_KEY, "1");
  } catch { /* storage blocked */ }
}

/**
 * Pure: a returning visitor saved a shortlist or a search here. They get no card (no
 * "Welcome back"); the header's ♡ N is their reminder.
 */
export function returningVisitor(shortlists: SavedShortlist[], profileSaved: boolean): boolean {
  return shortlists.length > 0 || profileSaved;
}

/** Reads this browser's saved shortlists and search; any storage failure counts as a first visit. */
export function readReturning(): boolean {
  try {
    const stored = listShortlists();
    if (stored.storageDenied) return false;
    return returningVisitor(stored.shortlists, !isUnsetProfile(loadLocalProfile(DEFAULT_PROFILE)));
  } catch {
    return false;
  }
}

/**
 * Whether the first-visit card shows. It shows once per browser until it is
 * used or closed (remembered), and steps aside for this visit as soon as the
 * visitor gets going: `busy` (they searched, opened the layers, chose an area
 * or turned on places) dismisses it for good; a deep link hides it for the
 * visit, and a returning visitor (something saved) never sees it. The server renders the
 * first-visit card ("boot", so it paints first; lib/intro-boot.ts hides it before that paint where
 * it may not be wanted) and storage is read after mount, so the server render never differs.
 */
export function useIntroCard(busy: boolean) {
  const [state, setState] = useState<"boot" | "show" | "hidden">("boot");
  useEffect(() => {
    if (isDeepLink(window.location.search, window.location.hash)) {
      setState("hidden");
      return;
    }
    setState(!readReturning() && !readDismissed() ? "show" : "hidden");
  }, []);
  const dismiss = useCallback(() => {
    rememberDismissed();
    setState("hidden");
  }, []);
  useEffect(() => {
    if (busy && state === "show") dismiss();
  }, [busy, state, dismiss]);
  // Decided and drawn: the boot script's mark has done its job.
  useEffect(() => {
    if (state !== "boot") document.documentElement.removeAttribute(INTRO_BOOT_ATTRIBUTE);
  }, [state]);
  return { visible: state !== "hidden", dismiss };
}

/**
 * First visit: what the explorer is for (the value line), how it works in
 * three steps, where the figures come from, then a labelled "Find my area" (v4
 * The one primary on screen while the card shows; the round My match
 * button steps back), "Try an example" and Claude as another way in. `onClose`
 * moves focus on after ×, which leaves with the card. `england`: the map covers England (CLOSE_KNIT_ENGLAND).
 */
export function FirstVisitIntro({ england = false, onFind, onExample, onClose, onDismiss }: {
  england?: boolean; onFind: () => void; onExample: () => void; onClose: () => void; onDismiss: () => void;
}) {
  return (
    <section className="first-visit-intro" data-block="intro" data-testid="intro-card" aria-label="Welcome">
      {/* The page's one h1 while the card shows; close-knit.tsx keeps an sr-only copy once it goes. */}
      <h1 className="first-visit-intro__lead" data-testid="intro-value">{valueLine(england)}</h1>
      <ol className="first-visit-intro__steps" data-testid="intro-steps" aria-label="How it works">
        {(england ? ENGLAND_INTRO_STEPS : INTRO_STEPS).map((step) => (
          <li key={step}>
            <KnitIcon name={STEP_ICONS[step].name} colour={STEP_ICONS[step].colour} className="knit-inline first-visit-intro__step-icon" />
            {step}
          </li>
        ))}
      </ol>
      <div className="first-visit-intro__actions">
        <button type="button" className="first-visit-intro__find" data-testid="intro-find" onClick={() => { onDismiss(); onFind(); }}>
          Find my area
        </button>
        <button type="button" className="first-visit-intro__example link-button" data-testid="intro-example"
          onClick={() => {
            onDismiss();
            onExample();
          }}>
          Try an example
        </button>
        <Link href="/agents" className="first-visit-intro__claude" data-testid="intro-claude">
          <span className="first-visit-intro__long">or ask Claude to find it for you →</span>
          <span className="first-visit-intro__short">Ask Claude →</span>
        </Link>
      </div>
      <p className="first-visit-intro__proof" data-testid="intro-proof">
        <span className="first-visit-intro__long" data-testid="intro-proof-full">{PROOF_STRIP}</span>
        <span className="first-visit-intro__short" data-testid="intro-proof-short">{PROOF_STRIP_SHORT}</span>
      </p>
      <CloseButton label="Dismiss introduction" onDismiss={onDismiss} onClose={onClose} />
    </section>
  );
}

function CloseButton({ label, onDismiss, onClose }: { label: string; onDismiss: () => void; onClose: () => void }) {
  return (
    <button type="button" className="first-visit-intro__close" data-testid="intro-dismiss" aria-label={label}
      onClick={() => {
        onDismiss();
        onClose(); // the × goes away with the card: focus must not fall to the page
      }}>
      <span aria-hidden="true">×</span>
    </button>
  );
}
