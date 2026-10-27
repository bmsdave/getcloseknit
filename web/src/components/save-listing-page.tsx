"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { areaDisplayName, type FriendlyAreaFields } from "@/lib/area-labels";
import { fetchAreaNames } from "@/lib/area-names";
import type { GeographyId } from "@/lib/contracts";
import { areaPath, areaSummaryPath, candidateFromListing, decodeListingFragment, nameForListing, type SharedListing } from "@/lib/listing-save";
import { SAVED_HREF } from "@/lib/saved-panel";
import { formatPounds } from "@/lib/evidence-format";
import { checkHomeHref } from "@/lib/tools";
import { emptyCandidateStore, loadUserCandidates, saveUserCandidates } from "@/lib/user-candidates";
import { SaveHeart } from "@/components/area-save-actions";
import { SiteHeader } from "@/components/site-header";
import { CANDIDATES_CHANGED } from "@/components/user-candidates";
import "../styles/decision-brief.css"; // the brief landing's layout and actions, shared

type Outcome =
  | { kind: "loading" }
  | { kind: "broken" }
  | { kind: "denied" }
  | { kind: "saved" | "duplicate"; listing: SharedListing };

/**
 * /save-listing#listing=v1.… — "Save to Close Knit" on the browser extension's card. The home goes
 * straight into ♡ Saved (a user candidate, AE-29, shown on its area page too); nothing is sent.
 * The page is a short "Saved" confirmation with Open Saved and the area.
 */
export function SaveListingPage({ period = null }: {
  /** The release's month for the area call (the server's default period); null when unknown. */
  period?: string | null;
}) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "loading" });
  const ran = useRef(false);
  useEffect(() => {
    // Saving is not idempotent (a second run finds a duplicate), so it runs once per visit.
    if (ran.current) return;
    ran.current = true;
    const listing = decodeListingFragment(window.location.hash);
    if (!listing) {
      setOutcome({ kind: "broken" });
      return;
    }
    const loaded = loadUserCandidates();
    if (loaded.storageDenied) {
      setOutcome({ kind: "denied" });
      return;
    }
    const built = candidateFromListing(listing, loaded.store.candidates);
    if (!built.ok) {
      setOutcome(built.reason === "duplicate-candidate" ? { kind: "duplicate", listing } : { kind: "broken" });
      return;
    }
    const saved = saveUserCandidates({ ...emptyCandidateStore(), candidates: [...loaded.store.candidates, built.candidate] });
    // The header's ♡ N counts it at once.
    if (saved.ok) window.dispatchEvent(new Event(CANDIDATES_CHANGED));
    setOutcome(saved.ok ? { kind: "saved", listing } : { kind: "denied" });
  }, []);
  return (
    <main className="methodology brief-landing" data-testid="save-listing-page">
      <SiteHeader />
      {outcome.kind === "loading" && <p role="status">Saving the home…</p>}
      {outcome.kind === "broken" && (
        <>
          <h1>This saved home can&apos;t be read.</h1>
          <p className="methodology-intro">Nothing was changed. Press Save on the listing again.</p>
        </>
      )}
      {outcome.kind === "denied" && (
        <>
          <h1>This browser won&apos;t let us save.</h1>
          <p className="methodology-intro">Saved homes stay on this device, and its storage is turned off here.</p>
        </>
      )}
      {(outcome.kind === "saved" || outcome.kind === "duplicate") && <Saved outcome={outcome} period={period} />}
    </main>
  );
}

function Saved({ outcome, period }: { outcome: { kind: "saved" | "duplicate"; listing: SharedListing }; period: string | null }) {
  const { listing } = outcome;
  const area = nameForListing(useAreaName(listing.geographyId, period), listing.address);
  const home = listing.address ?? "The home";
  const facts = [
    listing.askingPrice !== null ? `${formatPounds(listing.askingPrice)}${listing.market === "rent" ? " a month" : ""} asking` : null,
    listing.bedrooms !== null ? `${listing.bedrooms} bed` : null,
  ].filter(Boolean).join(" · ");
  return (
    <>
      {/* The board's confirmation: a filled ♡ by the word, as on the header's Saved. */}
      <h1 className="save-listing__title" data-testid="save-listing-title">
        <SaveHeart filled size={28} />{outcome.kind === "saved" ? "Saved" : "Already saved"}
      </h1>
      <p className="methodology-intro" data-testid="save-listing-line">
        {home}{facts ? <> · {facts}</> : null} is in your Saved list.
      </p>
      <p className="brief-landing__actions">
        <a href={SAVED_HREF} className="primary-action brief-landing__start" data-testid="save-listing-open-saved">Open Saved</a>
        {listing.geographyId && (
          <Link href={areaPath(listing.geographyId)} className="brief-landing__claude" data-testid="save-listing-area">
            {area ?? "The area"} →
          </Link>
        )}
        {/* The asking price goes on to Check a home. */}
        {listing.market === "buy" && listing.askingPrice !== null && (
          <Link href={checkHomeHref({ area: listing.geographyId, price: listing.askingPrice, from: listing.address ?? "the listing" })}
            className="brief-landing__claude" data-testid="save-listing-check">
            Check this price →
          </Link>
        )}
        {/* r3 #14 (CUJ09 board step 2): back to the portal's page (decodeListingFragment keeps portal URLs only). */}
        <a href={listing.url} className="brief-landing__claude" rel="noopener noreferrer" data-testid="save-listing-back">
          Back to listing →
        </a>
      </p>
    </>
  );
}

/**
 * The area's name as the site writes it ("Highbury East · N5"), from its own evidence (the
 * call names its metric and month, which the API requires); the names lookup if that fails; null until
 * one answers.
 */
function useAreaName(geographyId: GeographyId | null, period: string | null): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!geographyId) return;
    const controller = new AbortController();
    const init = { signal: controller.signal, headers: { accept: "application/json" } };
    void fetch(areaSummaryPath(geographyId, period), init)
      .then((response) => (response.ok ? response.json() : null))
      .then(async (body: (FriendlyAreaFields & { summary?: { name?: string } }) | null) =>
        (body ? areaDisplayName({ ...body, name: body.summary?.name }) : null)
          ?? (await fetchAreaNames([geographyId], fetch, controller.signal))[geographyId] ?? null)
      .then((found) => { if (!controller.signal.aborted && found) setName(found); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [geographyId, period]);
  return name;
}
