"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { decodeBrief } from "@/lib/brief-model";
import { areaDisplayName } from "@/lib/area-labels";
import type { MatchPack } from "@/lib/contracts";
import { DEFAULT_PROFILE } from "@/lib/fixtures";
import { briefToProfile } from "@/lib/match-brief";
import { searchCriteria, searchKey, withCriteria } from "@/lib/match-search";
import { encodeSearchLink, saveLocalProfile } from "@/lib/profile-state";
import {
  decodeSharedShortlist, DEFAULT_SHORTLIST_NAME, importSharedShortlist, ownBrief, saveShortlist, SHORTLIST_FRAGMENT_PREFIX,
  fragmentWithScores, packScores, withSentScores, type SharedShortlist,
} from "@/lib/saved-shortlists";
import { DecisionBriefPanel } from "@/components/decision-brief";
import { BriefHeader } from "@/components/brief/brief-header";
import { useMatchBrief } from "@/components/match/use-match-brief";
import { useSearchPack } from "@/components/match/use-search-pack";
import { Breadcrumbs } from "@/components/entity-nav";
import { compareHref } from "@/lib/compare-table";
import { SAVED_HREF } from "@/lib/saved-panel";
import { SiteHeader } from "@/components/site-header";

type Landing =
  | { kind: "loading" }
  | { kind: "explainer" }
  | { kind: "broken"; what: "brief" | "shortlist" }
  | { kind: "shortlist"; share: SharedShortlist };

/**
 * /brief, by its fragment:
 * - `#brief=` (an agent's answer): the brief becomes this browser's profile (as if set up in the
 *   wizard, never written to the URL) and My match opens on the first area, ranked by budget tier.
 * - `#shortlist=` (Compare › Brief; a shared shortlist): its decision brief, ready to read.
 * - nothing: what a brief is and how to get one, never an error.
 */
export function BriefPage() {
  const [landing, setLanding] = useState<Landing>({ kind: "loading" });
  // Another brief's link pasted over this one opens same-document: read it afresh (whose it is may change too).
  useEffect(() => {
    const reread = () => window.location.reload();
    window.addEventListener("hashchange", reread);
    return () => window.removeEventListener("hashchange", reread);
  }, []);
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith(SHORTLIST_FRAGMENT_PREFIX)) {
      const decoded = decodeSharedShortlist(hash);
      setLanding(decoded.ok ? { kind: "shortlist", share: decoded.share } : { kind: "broken", what: "shortlist" });
      return;
    }
    if (!hash.startsWith("#brief=")) {
      setLanding({ kind: "explainer" });
      return;
    }
    const brief = decodeBrief(hash);
    if (!brief) {
      setLanding({ kind: "broken", what: "brief" });
      return;
    }
    saveLocalProfile(briefToProfile(brief, structuredClone(DEFAULT_PROFILE)));
    window.location.replace(`/?layer=personal-match&selected=${encodeURIComponent(brief.areas[0])}`);
  }, []);
  return (
    <main className="methodology brief-landing" data-testid="brief-page">
      <SiteHeader />
      {landing.kind === "loading" && (
        <>
          <p className="sr-only" role="status">Opening your brief…</p>
          {/* Most visits land on the explainer: hold its space so the page does not shift when it appears. */}
          <div className="brief-landing__placeholder" aria-hidden="true"><BriefExplainer /></div>
        </>
      )}
      {landing.kind === "explainer" && <BriefExplainer />}
      {landing.kind === "broken" && (
        <>
          <h1>{landing.what === "brief" ? "This brief link is incomplete." : "This shortlist link can't be read."}</h1>
          <p className="methodology-intro">
            {landing.what === "brief"
              ? "Ask Claude for the link again, or set up Find my area yourself."
              : "Nothing was changed. Open Find my area to make the brief again from your saved areas."}
          </p>
          <StartLink />
        </>
      )}
      {landing.kind === "shortlist" && <ShortlistBrief share={landing.share} />}
    </main>
  );
}

function StartLink() {
  return (
    <p className="brief-landing__actions">
      <Link href="/?layer=personal-match" className="primary-action brief-landing__start" data-testid="brief-start">Start Find my area</Link>
      <Link href="/agents" className="brief-landing__claude">or ask Claude to make one →</Link>
    </p>
  );
}

export function BriefExplainer() {
  return (
    <>
      <h1>Your decision brief</h1>
      <p className="methodology-intro" data-testid="brief-explainer">
        Made on this device. Nothing is sent anywhere.
      </p>
      <ol className="brief-landing__steps">
        <li>Tell Find my area your budget and where you travel.</li>
        <li>Tick two to four areas to compare.</li>
        <li>Open <strong>Saved areas &amp; costs</strong> and preview your brief.</li>
      </ol>
      <StartLink />
    </>
  );
}

/**
 * A saved shortlist's brief: its own search, ranked again here, comparing its areas. The link carries no private
 * detail by default; on the device that made it, its full search is read back (ownBrief) and the
 * brief is "your" brief. Anyone else (a partner) gets the Shared brief: what the link carries, Save all and Open
 * map, and none of the owner's private choices (CUJ03 step 4).
 */
function ShortlistBrief({ share }: { share: SharedShortlist }) {
  // Read after hydration: the device's own store decides whose brief this is.
  const [own, setOwn] = useState<ReturnType<typeof ownBrief> | undefined>(undefined);
  useEffect(() => setOwn(ownBrief(share.ref)), [share]);
  const profile = own?.profile ?? share.profile;
  // The search as Compare and Saved ask for it (v2, searchKey), so all three score alike; none until whose brief it
  // is is known. The v1 JSON was refused by the API (ranges carry scale and must), and nothing rendered.
  const pack = useSearchPack(own === undefined ? null : searchKey(profile), share.mode, share.release);
  const compared = useMemo(() => share.candidates.slice(0, 4), [share]);
  const shown = useMemo(() => (pack === "failed" || pack === null ? []
    : compared.filter((id) => pack.values.some((result) => result.geographyId === id))), [pack, compared]);
  // The brief prices areas with the result card's figure: ask for the shortlisted areas first.
  const pinned = useMemo(() => ({
    ...profile, marks: { liked: compared.slice(1), excluded: [], notes: {} },
  }), [profile, compared]);
  // CUJ03 step 4: a partner sees the sender's scores, not ones re-ranked without the places left out.
  const ranked = pack !== null && pack !== "failed" ? pack : null;
  const ready = useMemo(() => (ranked && own === null ? withSentScores(ranked, share.scores) : ranked), [ranked, own, share]);
  // The owner's brief writes its scores into its own address, so the link copied from the address bar carries them.
  useEffect(() => {
    if (!own || !ranked) return;
    const next = fragmentWithScores(window.location.hash, packScores(ranked, share.candidates));
    if (next) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${next}`);
  }, [own, ranked, share]);
  const areaBrief = useMatchBrief(pinned, ready, compared[0] ?? null, share.mode, compared.length > 1);
  const titled = compared.length >= 2 && ready !== null && shown.length >= 2;
  const mine = Boolean(own);
  const title = mine ? share.name : sharedBriefTitle(share, ready);
  const eyebrow = mine ? "Decision brief" : `Shared brief${share.name !== DEFAULT_SHORTLIST_NAME ? ` · ${share.name}` : ""}`;
  return (
    <>
      {!titled && (
        <>
          <p className="eyebrow">{eyebrow}</p>
          <h1 data-testid="brief-shortlist-name">{title}</h1>
          {/* The partner keeps Save all and Open map while the brief ranks, or when it can't (CUJ03 step 4). */}
          {own === null && <SharedBriefActions share={share} />}
        </>
      )}
      {compared.length < 2 ? (
        <>
          <p className="methodology-intro">A brief compares two to four areas, and this shortlist has {compared.length === 1 ? "one" : "none"}. Add another in Find my area.</p>
          <StartLink />
        </>
      ) : pack === "failed" ? (
        <>
          <p className="methodology-intro" role="status">We couldn&apos;t rank these areas just now. Open Find my area to try again.</p>
          <StartLink />
        </>
      ) : ready === null ? (
        <p className="methodology-intro" role="status">Ranking {mine ? "your" : "these"} areas…</p>
      ) : shown.length < 2 ? (
        <>
          <p className="methodology-intro" role="status">
            Only {shown.length === 1 ? "one" : "none"} of this shortlist&apos;s areas is in today&apos;s results, and a brief compares two to four.
            Open Find my area to choose another.
          </p>
          <StartLink />
        </>
      ) : (
        <DecisionBriefPanel pack={ready} profile={profile} compared={shown} mode={share.mode} brief={areaBrief} autoPreview
          budgetShared={mine ? true : share.budgetShared}
          shared={mine ? undefined : { places: share.placesShared, notes: Boolean(share.notes) }}
          header={(done) => (
            <>
              {/* CUJ03 board step 3: your brief sits under Saved › Compare. */}
              {mine && <Breadcrumbs crumbs={[{ label: "Saved", href: SAVED_HREF }, { label: "Compare", href: compareHref("places", compared) },
                { label: "Brief", href: null }]} />}
              <BriefHeader eyebrow={eyebrow} title={title} level={1} testId="brief-shortlist-name" ready={done} announce={mine} />
              {!mine && <SharedBriefActions share={share} />}
            </>
          )} />
      )}
    </>
  );
}

/** "Highbury East vs Stoke Newington" (three or four: "A, B and C"), by today's names, else the link's. */
function sharedBriefTitle(share: SharedShortlist, pack: MatchPack | null): string {
  const names = share.candidates.slice(0, 4).map((id) => {
    const result = pack?.values.find((entry) => entry.geographyId === id);
    const name = (result && (areaDisplayName(result) ?? result.name)) || share.candidateNames[id] || "An area";
    return name.split(" · ")[0];
  });
  if (names.length < 2) return names[0] ?? share.name;
  return names.length === 2 ? `${names[0]} vs ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The partner's two actions (CUJ03 v4 step 4): keep these areas on this device, or see the search on the map. */
function SharedBriefActions({ share }: { share: SharedShortlist }) {
  const [saved, setSaved] = useState<"idle" | "saved" | "failed">("idle");
  const mapHref = useMemo(() => sharedMapHref(share), [share]);
  return (
    <div className="brief-shared-actions" data-testid="brief-shared-actions">
      <button type="button" className="primary-action" data-testid="brief-save-all" disabled={saved === "saved"}
        onClick={() => setSaved(saveShortlist(importSharedShortlist(share)).ok ? "saved" : "failed")}>
        {saved === "saved" ? "Saved" : "Save all"}
      </button>
      <a className="area-save-actions__button" href={mapHref} data-testid="brief-open-map">Open map</a>
      {/* The scores are the sender's (their places and budget may not be in the link). */}
      {share.scores && <p className="brief-shared-actions__note" data-testid="brief-scores-sent">Scores as sent</p>}
      <p className="brief-shared-actions__status" role="status">
        {saved === "saved" ? `${share.candidates.length} areas saved on this device.` : saved === "failed" ? "This browser won't save. Try again." : ""}
      </p>
    </div>
  );
}

/** The map with the shared search (its order and Musts) and these areas compared; an unshared budget stays out. */
function sharedMapHref(share: SharedShortlist): string {
  const profile = share.budgetShared ? share.profile : {
    ...withCriteria(share.profile, searchCriteria(share.profile).filter((item) => item.kind !== "budget")),
    targetBudget: DEFAULT_PROFILE.targetBudget, maximumBudget: DEFAULT_PROFILE.maximumBudget,
  };
  try {
    return `/?layer=personal-match${encodeSearchLink(profile, share.candidates)}`;
  } catch {
    return "/?layer=personal-match";
  }
}

